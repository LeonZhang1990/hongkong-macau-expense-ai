import express from 'express';
import multer from 'multer';
import cors from 'cors';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { callLLM, PROVIDERS } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ─── 配置持久化 ────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  provider: 'gemini',
  apiKey: '',
  model: 'gemini-2.5-flash',
  baseURL: '',
};

// 如果设置了环境变量，优先覆盖默认值（便于 Railway 等平台预置 Key）
function applyEnvOverrides(cfg) {
  const envProvider = process.env.LLM_PROVIDER;
  const envModel = process.env.LLM_MODEL;
  const envBase = process.env.LLM_BASE_URL;
  if (envProvider) cfg.provider = envProvider;
  if (envModel) cfg.model = envModel;
  if (envBase !== undefined) cfg.baseURL = envBase;

  // Key：按当前 provider 优先读对应 env
  const provider = cfg.provider;
  const envKey =
    (provider === 'gemini' && process.env.GEMINI_API_KEY) ||
    (provider === 'openai' && process.env.OPENAI_API_KEY) ||
    (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) ||
    process.env.LLM_API_KEY;
  if (envKey) cfg.apiKey = envKey;
  return cfg;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch (e) {
    console.warn('[config] load failed, using default:', e.message);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

let config = applyEnvOverrides(loadConfig());

// ─── 识别历史持久化 ────────────────────────────────────────
const HISTORY_PATH = path.join(__dirname, 'history.json');
const HISTORY_MAX = 500;

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('[history] load failed:', e.message);
  }
  return [];
}

function saveHistory(list) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(list, null, 2), 'utf8');
}

let history = loadHistory();

function addHistory(entry) {
  history.unshift(entry);
  if (history.length > HISTORY_MAX) history = history.slice(0, HISTORY_MAX);
  try { saveHistory(history); } catch (e) { console.warn('[history] save failed:', e.message); }
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 12) return '*'.repeat(key.length);
  return key.slice(0, 8) + '*'.repeat(Math.max(0, key.length - 12)) + key.slice(-4);
}

// ─── PDF 文本提取 ──────────────────────────────────────────
async function extractPdfText(buffer) {
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join('\n');
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json());

// ─── HTTP Basic Auth（可选，通过环境变量开启）────────────────
// 设置 AUTH_USER + AUTH_PASS 即可开启；留空则不启用（适合本机开发）
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';
if (AUTH_USER && AUTH_PASS) {
  console.log(`🔐 Basic Auth enabled for user: ${AUTH_USER}`);
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      try {
        const [u, p] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
        if (u === AUTH_USER && p === AUTH_PASS) return next();
      } catch {}
    }
    res.set('WWW-Authenticate', 'Basic realm="Reimbursement System"');
    res.status(401).send('Authentication required');
  });
}

// ─── Prompt ───────────────────────────────────────────────
const JSON_SCHEMA = `
返回格式为 JSON 数组，每个元素结构如下（一次可返回多条，如一张图含往返票）：
[
  {
    "date": "x月x日",
    "type": "高铁票" | "Uber行程" | "滴滴" | "微信乘车码" | "船票",
    "route": "起点->终点",
    "amount": 数字
  }
]
规则：
- date: 出行/支付日期，只写"x月x日"（如"1月6日"），不含年份
- type: 严格五选一 "高铁票" / "Uber行程" / "滴滴" / "微信乘车码" / "船票"
- route: 保留完整站名/地址，高铁用"A站->B站"，Uber/滴滴/船票用"A->B"；若图片中无起讫信息则留空字符串
- amount: 纯数字，不含货币符号；微信乘车码请取**人民币 RMB** 金额（如 -39.00 取 39）；港币/澳币直接取数字；船票取"成人票"或"单程"栏的人民币金额；识别不确定填 0
- 只输出 JSON 数组，不要 markdown 代码块，不要额外解释`;

const IMAGE_PROMPT = (hint) => `你是差旅报销单据识别助手。这是一张${hint ? `【${hint}】` : '交通'}票据截图，请提取所有行程记录。
${hint === '微信乘车码' ? '说明：这是微信支付凭证截图，商品栏通常写"港鐵乘車/地铁乘车"等；金额请使用人民币 RMB 最终支付金额（标价单位若是港币请忽略，取顶部"-39.00"这类实际扣款）。截图本身一般不含起点终点，route 请留空字符串，由系统从文件名补齐。\n' : ''}${hint === '船票' ? '说明：这是船票/邮轮票订单截图，请识别：①出发日期 ②起点码头/港口->终点码头/港口（如"澳门氹仔->深圳蛇口"）③人民币金额（通常是"¥179"或"成人票"一栏）。\n' : ''}${JSON_SCHEMA}`;

const TEXT_PROMPT = (hint, text) => `你是差旅报销单据识别助手。以下是从${hint ? `【${hint}】` : '滴滴'}行程单 PDF 中提取的文字内容，请从中识别所有行程记录。
${JSON_SCHEMA}

PDF 文字内容：
${text}`;

// ─── 从文件名里提取起点终点 ────────────────────────────────
// 支持的分隔符： -> / 到 / - / — / ～ / 以及中文连字符
// 例：
//   "港铁付费截图39元 香港办公室-福田口岸 4月1日.jpg"  => "香港办公室->福田口岸"
//   "微信乘车码 香港办公室 -> 福田口岸 4月2日 39.jpg"   => "香港办公室->福田口岸"
//   "WeChat 4月2日 深圳北站到香港西九龙 68.jpg"         => "深圳北站->香港西九龙"
function extractRouteFromFilename(name) {
  if (!name) return '';
  // 去掉扩展名
  const base = name.replace(/\.[^.]+$/, '');
  // 先去掉常见"无关词"和金额/日期片段，避免它们被当成起点/终点
  const cleaned = base
    .replace(/港铁付费截图\d*元?/g, ' ')
    .replace(/微信乘车码/g, ' ')
    .replace(/wechat[\s_-]*(mtr)?/gi, ' ')
    .replace(/mtr/gi, ' ')
    .replace(/\d+月\d+日/g, ' ')
    .replace(/\d+\.\d+|\d+元|hk\$?\s*\d+(\.\d+)?|rmb\s*\d+(\.\d+)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 按常见分隔符尝试分割：-> → ⇒ 到 ~ ～ — –
  const patterns = [
    /([^\s\->→⇒~～—–-]+)\s*(?:->|→|⇒|到|~|～|—|–|-)\s*([^\s\->→⇒~～—–-]+)/,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m && m[1] && m[2]) {
      return `${m[1].trim()}->${m[2].trim()}`;
    }
  }
  return '';
}

function extractJSON(raw) {
  const cleaned = (raw || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('模型未返回有效 JSON 数组，原始输出：' + cleaned.slice(0, 200));
  const records = JSON.parse(match[0]);
  const allowed = ['高铁票', 'Uber行程', '滴滴', '微信乘车码', '船票'];
  return records.map((r) => ({
    date: String(r.date || ''),
    type: allowed.includes(r.type) ? r.type : '滴滴',
    route: String(r.route || ''),
    amount: parseFloat(r.amount) || 0,
  }));
}

// ─── GET /api/config ─ 返回脱敏后的当前配置 + 厂商元信息 ──
app.get('/api/config', (_req, res) => {
  res.json({
    provider: config.provider || 'gemini',
    apiKey: maskKey(config.apiKey),
    apiKeyConfigured: !!config.apiKey,
    model: config.model,
    baseURL: config.baseURL || '',
    providers: PROVIDERS,
  });
});

// ─── POST /api/config ─ 保存新配置 ─────────────────────────
app.post('/api/config', (req, res) => {
  const { provider, apiKey, model, baseURL } = req.body || {};
  if (typeof provider === 'string' && provider.trim()) {
    config.provider = provider.trim();
  }
  if (typeof apiKey === 'string' && apiKey.trim()) {
    config.apiKey = apiKey.trim();
  }
  if (typeof model === 'string' && model.trim()) {
    config.model = model.trim();
  }
  // baseURL 允许清空
  if (typeof baseURL === 'string') {
    config.baseURL = baseURL.trim();
  }
  try {
    saveConfig(config);
    res.json({
      ok: true,
      provider: config.provider,
      apiKey: maskKey(config.apiKey),
      model: config.model,
      baseURL: config.baseURL || '',
    });
  } catch (e) {
    res.status(500).json({ error: '保存失败：' + e.message });
  }
});

// ─── POST /api/config/test ─ 测试连接 ──────────────────────
app.post('/api/config/test', async (req, res) => {
  const body = req.body || {};
  const testCfg = {
    provider: body.provider || config.provider || 'gemini',
    apiKey: (body.apiKey || config.apiKey || '').trim(),
    model: (body.model || config.model || '').trim(),
    baseURL: (body.baseURL !== undefined ? body.baseURL : config.baseURL || '').trim(),
  };
  if (!testCfg.apiKey) return res.status(400).json({ ok: false, error: '未填写 API Key' });
  if (!testCfg.model) return res.status(400).json({ ok: false, error: '未选择模型' });

  try {
    const text = await callLLM(testCfg, { prompt: 'Reply with only the word OK' });
    res.json({ ok: true, provider: testCfg.provider, model: testCfg.model, response: (text || '').trim().slice(0, 50) });
  } catch (err) {
    const msg = err.message || String(err);
    const short = msg.length > 300 ? msg.slice(0, 300) + '...' : msg;
    res.status(400).json({ ok: false, error: short });
  }
});

// ─── POST /api/parse ──────────────────────────────────────
app.post('/api/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  if (!config.apiKey) {
    return res.status(400).json({ error: '未配置 API Key，请在「API 管理」页面填写' });
  }

  // 修复 multer 将 multipart 文件名按 latin1 解码导致的中文乱码
  let originalname = req.file.originalname || 'unknown';
  try {
    // 检测是否疑似被 latin1 错误解码的 UTF-8：所有字符码位都 < 256 且包含 >= 0x80
    let allLatin1 = true, hasHigh = false;
    for (let i = 0; i < originalname.length; i++) {
      const c = originalname.charCodeAt(i);
      if (c >= 256) { allLatin1 = false; break; }
      if (c >= 0x80) hasHigh = true;
    }
    if (allLatin1 && hasHigh) {
      const reEncoded = Buffer.from(originalname, 'latin1').toString('utf8');
      if (!reEncoded.includes('\uFFFD')) originalname = reEncoded;
    }
  } catch {}

  const hint = (req.body.hint || '').trim();
  const mime = req.file.mimetype;
  const isPDF = mime === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf');

  try {
    let raw;
    if (isPDF) {
      const text = await extractPdfText(req.file.buffer);
      if (!text?.trim()) return res.status(422).json({ error: 'PDF 无法提取文字，请尝试截图' });
      raw = await callLLM(config, { prompt: TEXT_PROMPT(hint, text) });
    } else {
      raw = await callLLM(config, {
        prompt: IMAGE_PROMPT(hint),
        image: { data: req.file.buffer.toString('base64'), mimeType: mime },
      });
    }

    const records = extractJSON(raw);

    // 针对微信乘车码：截图中通常没有起讫站点，自动从文件名补齐
    // 同时如果 hint 是"微信乘车码"但模型返回了别的 type，强制修正
    const routeFromName = extractRouteFromFilename(originalname);
    for (const r of records) {
      if (hint === '微信乘车码') r.type = '微信乘车码';
      if (r.type === '微信乘车码' && !r.route && routeFromName) {
        r.route = routeFromName;
      }
    }

    addHistory({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      filename: originalname,
      hint,
      isPDF,
      fileSize: req.file.size,
      provider: config.provider,
      model: config.model,
      records,
    });

    return res.json({ records });
  } catch (err) {
    console.error('[parse error]', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// ─── GET /api/history ─────────────────────────────────────
app.get('/api/history', (_req, res) => {
  res.json({ history, total: history.length });
});

// ─── DELETE /api/history ──────────────────────────────────
app.delete('/api/history', (req, res) => {
  const id = req.query.id;
  if (id) history = history.filter(h => h.id !== id);
  else history = [];
  try {
    saveHistory(history);
    res.json({ ok: true, total: history.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Health ───────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ─── 静态文件服务 ──────────────────────────────────────────
const distPath = path.join(__dirname, '../app/dist');
app.use(express.static(distPath));
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    next();
  }
});

app.listen(PORT, HOST, () => {
  console.log(`✅ Server running on http://${HOST}:${PORT}`);
  console.log(`✅ Config: provider=${config.provider}, model=${config.model}, key=${maskKey(config.apiKey)}`);
});
