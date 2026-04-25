import express from 'express';
import multer from 'multer';
import cors from 'cors';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { callLLM, PROVIDERS } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;

// ─── 配置持久化 ────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  provider: 'gemini',
  apiKey: '',
  model: 'gemini-2.5-flash',
  baseURL: '',
};

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

let config = loadConfig();

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

// ─── Prompt ───────────────────────────────────────────────
const JSON_SCHEMA = `
返回格式为 JSON 数组，每个元素结构如下（一次可返回多条，如一张图含往返票）：
[
  {
    "date": "x月x日",
    "type": "高铁票" | "Uber行程" | "滴滴",
    "route": "起点->终点",
    "amount": 数字
  }
]
规则：
- date: 出行日期，只写"x月x日"（如"1月6日"），不含年份
- type: 严格三选一 "高铁票" / "Uber行程" / "滴滴"
- route: 保留完整站名/地址，高铁用"A站->B站"，Uber/滴滴用"A - B"或"A->B"
- amount: 纯数字，不含货币符号；港币直接取数字；识别不确定填 0
- 只输出 JSON 数组，不要 markdown 代码块，不要额外解释`;

const IMAGE_PROMPT = (hint) => `你是差旅报销单据识别助手。这是一张${hint ? `【${hint}】` : '交通'}票据截图，请提取所有行程记录。
${JSON_SCHEMA}`;

const TEXT_PROMPT = (hint, text) => `你是差旅报销单据识别助手。以下是从${hint ? `【${hint}】` : '滴滴'}行程单 PDF 中提取的文字内容，请从中识别所有行程记录。
${JSON_SCHEMA}

PDF 文字内容：
${text}`;

function extractJSON(raw) {
  const cleaned = (raw || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('模型未返回有效 JSON 数组，原始输出：' + cleaned.slice(0, 200));
  const records = JSON.parse(match[0]);
  return records.map((r) => ({
    date: String(r.date || ''),
    type: ['高铁票', 'Uber行程', '滴滴'].includes(r.type) ? r.type : '滴滴',
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

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ Config: provider=${config.provider}, model=${config.model}, key=${maskKey(config.apiKey)}`);
});
