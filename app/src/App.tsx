import React, { useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';

// ─── Types ────────────────────────────────────────────────
type ExpenseType = '高铁票' | 'Uber行程' | '滴滴' | '微信乘车码';
type ParseStatus = 'idle' | 'parsing' | 'done' | 'error';

interface ParsedItem { date: string; type: ExpenseType; route: string; amount: number; }

interface PendingFile {
  id: string;
  file: File;
  hint: ExpenseType;
  previewUrl: string | null;
  status: ParseStatus;
  error?: string;
  items: ParsedItem[];
}

interface ExpenseRecord { id: number; date: string; type: ExpenseType; route: string; amount: number; }
interface DailyGroup { date: string; records: ExpenseRecord[]; nonRailTotal: number; }

// ─── Helpers ──────────────────────────────────────────────
function sortRecords(list: ExpenseRecord[]): ExpenseRecord[] {
  const toNum = (d: string) => {
    const m = d.match(/(\d+)月(\d+)日/);
    return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
  };
  return [...list].sort((a, b) => toNum(a.date) - toNum(b.date)).map((r, i) => ({ ...r, id: i + 1 }));
}

function groupByDate(records: ExpenseRecord[]): DailyGroup[] {
  const map = new Map<string, ExpenseRecord[]>();
  for (const r of records) {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date)!.push(r);
  }
  return Array.from(map.entries()).map(([date, recs]) => ({
    date, records: recs,
    nonRailTotal: recs.filter(r => r.type !== '高铁票').reduce((s, r) => s + r.amount, 0),
  }));
}

function exportExcel(records: ExpenseRecord[], groups: DailyGroup[]) {
  const wb = XLSX.utils.book_new();
  const rows: (string | number)[][] = [['序号', '日期', '费用类型', '行程', '金额']];
  const merges: XLSX.Range[] = [];
  const totalRowIndexes: number[] = [];  // 小计行的 0-based 行索引

  let seq = 1;
  for (const g of groups) {
    for (const r of g.records) {
      rows.push([seq++, r.date, r.type, r.route, r.amount]);
    }
    // 小计行：B~D 三列合并，放合计文字；E 列放金额
    const rowIdx = rows.length;   // 下一行的 0-based 索引
    rows.push(['', `${g.date}交通费总额(不含高铁)：`, '', '', +g.nonRailTotal.toFixed(2)]);
    merges.push({ s: { r: rowIdx, c: 1 }, e: { r: rowIdx, c: 3 } });  // B~D
    totalRowIndexes.push(rowIdx);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 60 }, { wch: 12 }];
  ws['!merges'] = merges;

  // 为合计行单元格设置样式（右对齐、加粗）
  for (const r of totalRowIndexes) {
    const labelAddr = XLSX.utils.encode_cell({ r, c: 1 });  // B 列（合并后）
    const amountAddr = XLSX.utils.encode_cell({ r, c: 4 }); // E 列金额
    if (ws[labelAddr]) {
      ws[labelAddr].s = {
        alignment: { horizontal: 'right', vertical: 'center' },
        font: { bold: true },
      };
    }
    if (ws[amountAddr]) {
      ws[amountAddr].s = {
        alignment: { horizontal: 'right', vertical: 'center' },
        font: { bold: true },
      };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, '报销明细');
  XLSX.writeFile(wb, '港澳差旅报销汇总.xlsx');
}

async function parseFile(file: File, hint: ExpenseType): Promise<ParsedItem[]> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('hint', hint);

  let res: Response;
  try { res = await fetch('/api/parse', { method: 'POST', body: fd }); }
  catch { throw new Error('无法连接后端服务，请确认后端已启动'); }

  const text = await res.text();
  if (!text.trim()) throw new Error(`后端返回空响应 (HTTP ${res.status})`);

  let json: { records?: ParsedItem[]; error?: string };
  try { json = JSON.parse(text); }
  catch { throw new Error(`后端返回非 JSON 内容: ${text.slice(0, 100)}`); }

  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return (json.records || []) as ParsedItem[];
}

// ─── SVG Icons ────────────────────────────────────────────
const Ic = {
  Inbox: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>),
  Clock: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>),
  Table: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>),
  Key: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>),
  Upload: () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>),
  Trash: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>),
  Plus: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>),
  Download: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>),
  Check: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>),
  Spinner: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>),
  Warning: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>),
  Eye: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>),
  EyeOff: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>),
  Save: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>),
  Zap: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>),
};

// ─── 识别历史面板 ──────────────────────────────────────────
interface HistoryEntry {
  id: string;
  timestamp: number;
  filename: string;
  hint: ExpenseType;
  isPDF: boolean;
  fileSize: number;
  model: string;
  records: ParsedItem[];
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function HistoryPanel({ onReuse }: { onReuse?: (records: ParsedItem[]) => void }) {
  const [list, setList] = useState<HistoryEntry[] | null>(null);
  const [filter, setFilter] = useState<'all' | ExpenseType>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/history');
      const json = await r.json();
      setList(json.history || []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { reload(); }, []);

  const handleDelete = async (id: string) => {
    await fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    reload();
  };

  const handleClear = async () => {
    if (!confirm('确定要清空全部历史记录吗？此操作不可恢复')) return;
    await fetch('/api/history', { method: 'DELETE' });
    reload();
  };

  if (list === null) {
    return (
      <section className="mt-6 rounded-[28px] border border-white/[0.08] p-10 text-center text-[#7d86a5]"
        style={{ background: 'rgba(23,28,51,0.92)' }}>加载中...</section>
    );
  }

  const filtered = filter === 'all' ? list : list.filter(h => h.hint === filter);
  const stats = {
    total: list.length,
    rail: list.filter(h => h.hint === '高铁票').length,
    uber: list.filter(h => h.hint === 'Uber行程').length,
    didi: list.filter(h => h.hint === '滴滴').length,
    mtr: list.filter(h => h.hint === '微信乘车码').length,
  };

  return (
    <>
      {/* 概览 */}
      <section className="mt-6 rounded-[28px] border border-white/[0.08] p-6"
        style={{ background: 'rgba(23,28,51,0.92)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="m-0 text-[18px] font-extrabold tracking-tight">识别历史</h3>
            <p className="m-0 mt-1.5 text-[#98a1c0] text-[13px]">
              保存在本地 <span className="font-mono text-white/70">server/history.json</span>，最多保留 500 条最近记录
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={reload} disabled={loading}
              className="px-3.5 py-2.5 text-sm rounded-[12px] bg-white/[0.04] border border-white/10 text-white hover:bg-white/[0.08] disabled:opacity-50">
              {loading ? '刷新中...' : '刷新'}
            </button>
            <button onClick={handleClear} disabled={list.length === 0}
              className="px-3.5 py-2.5 text-sm rounded-[12px] bg-[rgba(255,107,129,0.1)] border border-[rgba(255,107,129,0.2)] text-[#ff9fa9] hover:bg-[rgba(255,107,129,0.15)] disabled:opacity-40">
              清空全部
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3">
          {[
            { label: '总记录', value: stats.total, color: 'text-white' },
            { label: '高铁票', value: stats.rail, color: 'text-[#a9b6ff]' },
            { label: 'Uber 行程', value: stats.uber, color: 'text-[#81efba]' },
            { label: '滴滴', value: stats.didi, color: 'text-[#ffcf7b]' },
            { label: '微信乘车码', value: stats.mtr, color: 'text-[#4ad8ff]' },
          ].map((s, i) => (
            <div key={i} className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-4">
              <div className="text-[#98a1c0] text-xs mb-2">{s.label}</div>
              <div className={`text-2xl font-extrabold tracking-tight ${s.color}`}>{String(s.value).padStart(2, '0')}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 列表 */}
      <section className="mt-6 rounded-[28px] border border-white/[0.08] p-6"
        style={{ background: 'rgba(23,28,51,0.92)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div className="flex items-center justify-between mb-5">
          <div className="inline-flex gap-2 bg-white/[0.03] p-1.5 rounded-2xl border border-white/[0.06]">
            {(['all', '高铁票', 'Uber行程', '滴滴', '微信乘车码'] as const).map(k => (
              <button key={k} onClick={() => setFilter(k)}
                className={`border-0 px-4 py-2 rounded-xl font-semibold cursor-pointer text-sm ${
                  filter === k ? 'text-white' : 'bg-transparent text-[#98a1c0] hover:text-white'
                }`}
                style={filter === k
                  ? { background: 'linear-gradient(90deg, var(--purple), var(--blue))', boxShadow: '0 10px 20px rgba(112,86,255,0.28)' }
                  : {}}>
                {k === 'all' ? '全部' : k}
              </button>
            ))}
          </div>
          <div className="text-xs text-[#7d86a5]">共 {filtered.length} 条</div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[#7d86a5]">
            {list.length === 0 ? '尚无识别记录，上传第一张截图开始体验吧' : '当前筛选下无记录'}
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map(h => {
              const isOpen = expanded === h.id;
              const hintColor: Record<ExpenseType, string> = {
                '高铁票': 'text-[#a9b6ff] bg-[rgba(110,120,255,0.12)] border-[rgba(110,120,255,0.2)]',
                'Uber行程': 'text-[#81efba] bg-[rgba(57,217,138,0.12)] border-[rgba(57,217,138,0.2)]',
                '滴滴': 'text-[#ffcf7b] bg-[rgba(255,182,72,0.12)] border-[rgba(255,182,72,0.2)]',
                '微信乘车码': 'text-[#4ad8ff] bg-[rgba(74,216,255,0.12)] border-[rgba(74,216,255,0.2)]',
              };
              return (
                <div key={h.id} className="rounded-2xl border border-white/[0.06] overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <div className="flex items-center gap-4 p-4 cursor-pointer hover:bg-white/[0.02]"
                    onClick={() => setExpanded(isOpen ? null : h.id)}>
                    {/* 类型徽章 */}
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${hintColor[h.hint]} flex-shrink-0`}>
                      {h.isPDF ? 'PDF' : 'IMG'} · {h.hint}
                    </span>
                    {/* 文件信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{h.filename}</div>
                      <div className="text-xs text-[#7d86a5] mt-1 flex gap-3">
                        <span>{formatTime(h.timestamp)}</span>
                        <span>{formatSize(h.fileSize)}</span>
                        <span>{h.records.length} 条记录</span>
                        <span className="font-mono text-[#a9b6ff]">{h.model}</span>
                      </div>
                    </div>
                    {/* 总金额 */}
                    <div className="text-right flex-shrink-0">
                      <div className="text-[11px] text-[#7d86a5] mb-1">合计金额</div>
                      <div className="font-mono font-bold text-white">
                        {h.records.reduce((s, r) => s + (r.amount || 0), 0).toFixed(2)}
                      </div>
                    </div>
                    {/* 删除按钮 */}
                    <button onClick={e => { e.stopPropagation(); handleDelete(h.id); }}
                      className="text-[#7d86a5] hover:text-[#ff6b81] p-2 flex-shrink-0">
                      <Ic.Trash />
                    </button>
                  </div>
                  {/* 展开详情 */}
                  {isOpen && (
                    <div className="border-t border-white/[0.06] p-4 bg-black/20">
                      {h.records.length === 0 ? (
                        <div className="text-center text-[#7d86a5] text-sm py-4">未识别出记录</div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[#7d86a5]">
                              <th className="text-left font-normal px-2 py-1.5">日期</th>
                              <th className="text-left font-normal px-2 py-1.5">类型</th>
                              <th className="text-left font-normal px-2 py-1.5">行程</th>
                              <th className="text-right font-normal px-2 py-1.5">金额</th>
                            </tr>
                          </thead>
                          <tbody>
                            {h.records.map((r, i) => (
                              <tr key={i} className="border-t border-white/[0.04]">
                                <td className="px-2 py-2 whitespace-nowrap">{r.date}</td>
                                <td className="px-2 py-2">{r.type}</td>
                                <td className="px-2 py-2 text-[#a9b6ff]">{r.route}</td>
                                <td className="px-2 py-2 text-right font-mono">{r.amount.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {onReuse && h.records.length > 0 && (
                        <div className="mt-3 flex justify-end">
                          <button onClick={() => onReuse(h.records)}
                            className="px-4 py-2 text-xs rounded-lg bg-white/[0.04] border border-white/10 text-white hover:bg-white/[0.08]">
                            重新加入汇总表
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

// ─── API 配置面板 ──────────────────────────────────────────
interface ProviderMeta {
  id: string;
  name: string;
  requiresBaseURL: boolean;
  supportsVision: boolean;
  models: string[];
  apiKeyPlaceholder?: string;
  baseURLPlaceholder?: string;
  docUrl?: string;
}

interface ApiConfig {
  provider: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  model: string;
  baseURL: string;
  providers: ProviderMeta[];
}

function ApiConfigPanel() {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [provider, setProvider] = useState<string>('gemini');
  const [editingKey, setEditingKey] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [customModel, setCustomModel] = useState<boolean>(false);
  const [baseURL, setBaseURL] = useState<string>('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saveMsg, setSaveMsg] = useState<string>('');

  React.useEffect(() => {
    fetch('/api/config').then(r => r.json()).then((c: ApiConfig) => {
      setConfig(c);
      setProvider(c.provider || 'gemini');
      setModel(c.model);
      setBaseURL(c.baseURL || '');
    }).catch(() => {});
  }, []);

  const currentProvider = config?.providers.find(p => p.id === provider);

  // 切换厂商时重置相关字段
  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    setTestResult(null);
    setSaveMsg('');
    const meta = config?.providers.find(p => p.id === newProvider);
    // 如果当前模型不在新厂商的列表里，切到该厂商的第一个
    if (meta && !meta.models.includes(model)) {
      setModel(meta.models[0] || '');
      setCustomModel(false);
    }
    // 不同厂商间的 apiKey 通常不兼容，清空编辑状态让用户重新填
    if (newProvider !== config?.provider) {
      setEditingKey('');
    }
    // 切到不需要 baseURL 的厂商时，清空
    if (meta && !meta.requiresBaseURL && newProvider !== 'openai') {
      setBaseURL('');
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch('/api/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: editingKey || undefined, model, baseURL }),
      });
      const json = await r.json();
      if (json.ok) setTestResult({ ok: true, msg: `连接成功 · ${json.provider} / ${json.model} 返回：${json.response}` });
      else setTestResult({ ok: false, msg: json.error || '连接失败' });
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const r = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: editingKey || undefined, model, baseURL }),
      });
      const json = await r.json();
      if (json.ok) {
        setSaveMsg('✓ 已保存');
        setConfig(prev => prev ? { ...prev, provider: json.provider, apiKey: json.apiKey, model: json.model, baseURL: json.baseURL, apiKeyConfigured: true } : prev);
        setEditingKey('');
        setTimeout(() => setSaveMsg(''), 3000);
      } else {
        setSaveMsg('✗ ' + (json.error || '保存失败'));
      }
    } catch (e) {
      setSaveMsg('✗ ' + String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!config || !currentProvider) {
    return (
      <section className="mt-6 rounded-[28px] border border-white/[0.08] p-10 text-center text-[#7d86a5]"
        style={{ background: 'rgba(23,28,51,0.92)' }}>加载配置中...</section>
    );
  }

  const showBaseURL = currentProvider.requiresBaseURL || provider === 'openai' || provider === 'anthropic';
  const baseURLRequired = currentProvider.requiresBaseURL;
  const isSameProvider = provider === config.provider;

  return (
    <>
      {/* 厂商选择卡片 */}
      <section className="mt-6 rounded-[28px] border border-white/[0.08] p-7"
        style={{ background: 'rgba(23,28,51,0.92)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="m-0 text-[18px] font-extrabold tracking-tight mb-2">模型服务配置</h3>
            <p className="m-0 text-[#98a1c0] text-[13px]">
              选择你的大模型服务商并填写 API Key，支持 Gemini / OpenAI / Claude / 以及任何 OpenAI 兼容接口
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {config.apiKeyConfigured ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-semibold text-[#81efba] bg-[rgba(57,217,138,0.12)] border border-[rgba(57,217,138,0.16)]">
                <Ic.Check /> 已配置 · {config.provider}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-semibold text-[#ffcf7b] bg-[rgba(255,182,72,0.12)] border border-[rgba(255,182,72,0.16)]">
                <Ic.Warning /> 未配置
              </span>
            )}
          </div>
        </div>

        {/* 厂商选择器 */}
        <div className="mb-6">
          <label className="block text-[#98a1c0] text-[13px] mb-2.5 font-medium">模型服务商</label>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {config.providers.map(p => {
              const selected = provider === p.id;
              return (
                <button key={p.id} onClick={() => handleProviderChange(p.id)}
                  className={`text-left p-4 rounded-2xl border transition-all ${
                    selected
                      ? 'text-white border-transparent'
                      : 'text-[#98a1c0] bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06] hover:text-white'
                  }`}
                  style={selected
                    ? { background: 'linear-gradient(135deg, rgba(124,77,255,0.25), rgba(94,120,255,0.15))',
                        borderColor: 'rgba(159,103,255,0.35)',
                        boxShadow: '0 12px 30px rgba(112,86,255,0.2)' }
                    : {}}>
                  <div className="font-bold text-sm mb-1">{p.name}</div>
                  <div className="text-[11px] opacity-70 leading-snug">
                    {p.supportsVision ? '多模态 · ' : '仅文本 · '}{p.models.length} 个预设模型
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* API Key */}
        <div className="mb-5">
          <label className="block text-[#98a1c0] text-[13px] mb-2.5 font-medium">API Key</label>
          <div className="relative">
            <input
              type={showKey || editingKey ? 'text' : 'password'}
              value={editingKey || (showKey || !isSameProvider ? '' : config.apiKey)}
              placeholder={isSameProvider && config.apiKeyConfigured ? '保持当前 Key 不变，输入新值将覆盖' : (currentProvider.apiKeyPlaceholder || '请输入 API Key')}
              onChange={e => setEditingKey(e.target.value)}
              className="input w-full bg-white/[0.04] text-white rounded-[14px] px-4 py-3.5 text-sm outline-none border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)] focus:shadow-[0_0_0_4px_rgba(124,77,255,0.12)] font-mono pr-12"
            />
            <button type="button" onClick={() => setShowKey(s => !s)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#98a1c0] hover:text-white"
              title={showKey ? '隐藏' : '显示'}>
              {showKey ? <Ic.EyeOff /> : <Ic.Eye />}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-[#7d86a5]">
            <span>
              {currentProvider.docUrl && (
                <>
                  获取 Key：
                  <a href={currentProvider.docUrl} target="_blank" rel="noreferrer"
                     className="text-[#a9b6ff] hover:text-white underline decoration-dotted ml-1">
                    {currentProvider.docUrl.replace(/^https?:\/\//, '')}
                  </a>
                </>
              )}
            </span>
            {isSameProvider && config.apiKeyConfigured && !editingKey && (
              <span>当前：<span className="font-mono text-white/70">{config.apiKey}</span></span>
            )}
          </div>
        </div>

        {/* Base URL (条件显示) */}
        {showBaseURL && (
          <div className="mb-5">
            <label className="block text-[#98a1c0] text-[13px] mb-2.5 font-medium">
              Base URL
              {baseURLRequired ? <span className="text-[#ff9fa9] ml-1">*必填</span>
                : <span className="text-[#7d86a5] ml-1 text-[11px]">（可选，留空使用官方默认）</span>}
            </label>
            <input
              value={baseURL}
              placeholder={currentProvider.baseURLPlaceholder || (provider === 'openai' ? 'https://api.openai.com/v1' : provider === 'anthropic' ? 'https://api.anthropic.com' : '')}
              onChange={e => setBaseURL(e.target.value)}
              className="input w-full bg-white/[0.04] text-white rounded-[14px] px-4 py-3.5 text-sm outline-none border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)] focus:shadow-[0_0_0_4px_rgba(124,77,255,0.12)] font-mono"
            />
            {provider === 'openai-compat' && (
              <div className="mt-2 text-xs text-[#7d86a5] space-y-0.5">
                <div>常用：DeepSeek <span className="font-mono text-white/60">https://api.deepseek.com/v1</span></div>
                <div className="pl-12">Kimi <span className="font-mono text-white/60">https://api.moonshot.cn/v1</span></div>
                <div className="pl-12">智谱 GLM <span className="font-mono text-white/60">https://open.bigmodel.cn/api/paas/v4</span></div>
                <div className="pl-12">阿里通义 <span className="font-mono text-white/60">https://dashscope.aliyuncs.com/compatible-mode/v1</span></div>
              </div>
            )}
          </div>
        )}

        {/* Model */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2.5">
            <label className="text-[#98a1c0] text-[13px] font-medium">模型版本</label>
            <button type="button" onClick={() => setCustomModel(v => !v)}
              className="text-[11px] text-[#a9b6ff] hover:text-white">
              {customModel ? '← 从列表选择' : '自定义模型名 →'}
            </button>
          </div>
          {customModel ? (
            <input
              value={model}
              placeholder="输入自定义模型名，如 gpt-4o-2024-11-20"
              onChange={e => setModel(e.target.value)}
              className="input w-full bg-white/[0.04] text-white rounded-[14px] px-4 py-3.5 text-sm outline-none border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)] font-mono"
            />
          ) : (
            <select
              value={currentProvider.models.includes(model) ? model : currentProvider.models[0] || ''}
              onChange={e => setModel(e.target.value)}
              className="select w-full bg-white/[0.04] text-white rounded-[14px] px-4 py-3.5 text-sm border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)] outline-none"
            >
              {currentProvider.models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-white/[0.06]">
          <div className="text-xs min-w-0 flex-1 truncate">
            {testResult && (
              <span className={testResult.ok ? 'text-[#81efba]' : 'text-[#ff9fa9]'} title={testResult.msg}>
                {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
              </span>
            )}
            {saveMsg && <span className={saveMsg.startsWith('✓') ? 'text-[#81efba]' : 'text-[#ff9fa9]'}>{saveMsg}</span>}
          </div>
          <div className="flex gap-2.5 flex-shrink-0">
            <button onClick={handleTest} disabled={testing}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-[12px] bg-white/[0.04] border border-white/10 text-white hover:bg-white/[0.08] disabled:opacity-50">
              {testing ? <span className="animate-spin inline-block"><Ic.Spinner /></span> : <Ic.Zap />}
              {testing ? '测试中...' : '测试连接'}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="primary-btn flex items-center gap-1.5 px-5 py-2.5 text-sm rounded-[12px] text-white font-bold disabled:opacity-50"
              style={{ background: 'linear-gradient(90deg, var(--purple), var(--blue))', boxShadow: '0 12px 24px rgba(104,92,255,0.28)' }}>
              {saving ? <span className="animate-spin inline-block"><Ic.Spinner /></span> : <Ic.Save />}
              {saving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </section>

      {/* 使用说明 */}
      <section className="mt-4 rounded-2xl border border-white/[0.06] p-5 text-[13px] text-[#98a1c0] leading-relaxed"
        style={{ background: 'rgba(23,28,51,0.5)' }}>
        <div className="font-semibold text-white mb-2 flex items-center gap-2"><Ic.Warning /> 使用说明</div>
        <ul className="list-disc list-inside space-y-1 marker:text-[#7d86a5]">
          <li>截图识别需要厂商支持<b>多模态（视觉）</b>；PDF 会先提取文字再调用模型，仅文本的模型也能用于 PDF</li>
          <li>建议先点「测试连接」再保存，避免填错导致后续识别全部失败</li>
          <li>配置仅保存在本机 <span className="font-mono text-white/80">server/config.json</span>，不会上传到任何第三方</li>
          <li>如需重置，删除 <span className="font-mono text-white/80">server/config.json</span> 并重启后端</li>
        </ul>
      </section>
    </>
  );
}

// ─── Sidebar ──────────────────────────────────────────────
function Sidebar({ active, onChange }: { active: string; onChange: (k: string) => void }) {
  const items = [
    { key: 'upload',  label: '报销处理', icon: <Ic.Inbox /> },
    { key: 'history', label: '识别历史', icon: <Ic.Clock /> },
    { key: 'table',   label: '汇总表格', icon: <Ic.Table /> },
    { key: 'api',     label: 'API 管理', icon: <Ic.Key /> },
  ];
  return (
    <aside className="p-7 border-r border-white/5 hidden md:block"
      style={{ background: 'linear-gradient(180deg, rgba(9,12,24,0.96), rgba(11,15,30,0.92))' }}>
      <div className="text-[18px] font-extrabold tracking-tight mb-2">leonlmzhang</div>
      <div className="text-[#98a1c0] text-[13px] flex items-center gap-2 mb-7">
        Tencent
        <span className="text-xs text-[#d9cbff] bg-[rgba(124,77,255,0.14)] border border-[rgba(159,103,255,0.24)] px-2.5 py-1 rounded-[10px]">
          AI 识别中台
        </span>
      </div>
      <nav className="grid gap-2.5">
        {items.map(it => (
          <button key={it.key} onClick={() => onChange(it.key)}
            className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all text-left text-[14px] ${
              active === it.key
                ? 'text-white border-transparent'
                : 'text-[#98a1c0] border-transparent hover:text-white hover:bg-white/[0.04] hover:-translate-y-px hover:border-white/5'
            }`}
            style={active === it.key
              ? { background: 'linear-gradient(90deg, rgba(124,77,255,0.95), rgba(92,103,255,0.95))', boxShadow: '0 12px 30px rgba(112,86,255,0.28)' }
              : {}}>
            {it.icon}
            <span className="font-medium">{it.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

// ─── Hero Overview ────────────────────────────────────────
function HeroOverview({ total, success, pending, parsing }: {
  total: number; success: number; pending: number; parsing: number;
}) {
  const progress = total === 0 ? 0 : Math.round((success / total) * 100);
  const counts = { rail: 0, uber: 0, didi: 0 }; // 可按需扩展

  return (
    <section className="mt-6 p-7 rounded-[28px] border border-white/[0.08]"
      style={{ background: 'linear-gradient(180deg, rgba(27,33,60,0.98), rgba(21,26,48,0.98))', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-7 items-end">
        <div>
          <h2 className="text-[20px] font-extrabold tracking-tight mb-2.5">本轮识别概览</h2>
          <div className="text-[#98a1c0] text-sm leading-relaxed mb-5">
            当前批次共上传 {total} 个文件，系统已完成预解析与字段抽取。<br />
            待人工确认 {pending} 项，识别成功 {success} 项，可直接加入报销汇总表。
          </div>
          <div className="flex justify-between gap-3 mb-3 text-white font-semibold text-sm">
            <span>识别进度：{progress}% 已自动完成</span>
            <span>{success + pending} / {total} 文件</span>
          </div>
          <div className="h-3 rounded-full bg-white/[0.08] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: 'linear-gradient(90deg, var(--purple), var(--blue))' }} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3.5">
          {[
            { label: '本批文件', value: total, note: `待处理 ${parsing + pending}` },
            { label: '自动通过', value: success, note: '字段完整，可直接并入汇总表' },
            { label: '待补录',   value: pending, note: '重点核对日期、行程与金额信息' },
          ].map((s, i) => (
            <div key={i} className="bg-white/[0.04] border border-white/[0.06] rounded-[20px] p-4 min-h-[118px]">
              <div className="text-[#98a1c0] text-[13px] mb-3">{s.label}</div>
              <div className="text-[28px] font-extrabold tracking-tight mb-2">{String(s.value).padStart(2, '0')}</div>
              <div className="text-[#7d86a5] text-xs leading-relaxed">{s.note}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Dropzone ─────────────────────────────────────────────
function Dropzone({ label, hint, sub, onFiles }: {
  label: string; hint: ExpenseType; sub: React.ReactNode;
  onFiles: (files: File[], h: ExpenseType) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const isPDF = hint === '滴滴';

  const handle = (files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter(f => f.type.startsWith('image/') || (isPDF && f.type === 'application/pdf'));
    if (valid.length) onFiles(valid, hint);
  };

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files); }}
      className={`p-7 rounded-[22px] text-center min-h-[174px] grid place-items-center cursor-pointer transition-all
        ${drag ? '-translate-y-0.5' : 'hover:-translate-y-0.5'}`}
      style={{
        background: 'linear-gradient(180deg, rgba(26,31,56,0.9), rgba(19,24,45,0.94))',
        border: `1px dashed ${drag ? 'rgba(159,103,255,0.6)' : 'rgba(155,164,209,0.22)'}`,
        boxShadow: drag ? '0 16px 34px rgba(65,53,129,0.22)' : undefined,
      }}
    >
      <input ref={ref} type="file" multiple className="hidden"
        accept={isPDF ? 'image/*,application/pdf' : 'image/*'}
        onChange={e => handle(e.target.files)} />
      <div>
        <div className="w-[54px] h-[54px] mx-auto mb-4 rounded-[18px] grid place-items-center text-white"
          style={{ background: 'linear-gradient(180deg, rgba(124,77,255,0.24), rgba(94,120,255,0.15))',
                   border: '1px solid rgba(159,103,255,0.25)' }}>
          <Ic.Upload />
        </div>
        <div className="font-bold text-[18px] mb-2">{label}</div>
        <div className="text-[#98a1c0] text-[13px] leading-relaxed">{sub}</div>
      </div>
    </div>
  );
}

// ─── Result Card (AI 识别结果卡片) ────────────────────────
function ResultCard({ entry, onConfirm, onRemove, onViewSource }: {
  entry: PendingFile;
  onConfirm: (id: string, items: ParsedItem[]) => void;
  onRemove: (id: string) => void;
  onViewSource: (entry: PendingFile) => void;
}) {
  const [items, setItems] = useState<ParsedItem[]>(entry.items);
  React.useEffect(() => { setItems(entry.items); }, [entry.items]);

  const isPDF = entry.file.type === 'application/pdf';
  const isWide = items.length > 1 || isPDF;

  const change = (i: number, f: keyof ParsedItem, v: string | number) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [f]: v } : it));

  const add = () => setItems(prev => [...prev, { date: '', type: entry.hint, route: '', amount: 0 }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  // 状态 pill
  const statusPill = (() => {
    if (entry.status === 'parsing')
      return <span className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold text-[#a9b6ff] bg-[rgba(110,120,255,0.12)] border border-[rgba(110,120,255,0.2)]"><span className="inline-block animate-spin"><Ic.Spinner /></span>AI 识别中...</span>;
    if (entry.status === 'error')
      return <span className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold text-[#ffcf7b] bg-[rgba(255,182,72,0.12)] border border-[rgba(255,182,72,0.16)]"><Ic.Warning />识别失败 · 请手动补录</span>;
    if (items.length === 0)
      return <span className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold text-[#ffcf7b] bg-[rgba(255,182,72,0.12)] border border-[rgba(255,182,72,0.16)]"><Ic.Warning />未识别到字段 · 需手动补录</span>;
    return <span className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold text-[#81efba] bg-[rgba(57,217,138,0.12)] border border-[rgba(57,217,138,0.16)]"><Ic.Check />识别完成 · 请核对后写入汇总表</span>;
  })();

  return (
    <article className={`rounded-3xl border border-white/[0.08] overflow-hidden ${isWide ? 'lg:col-span-2' : ''}`}
      style={{ background: 'linear-gradient(180deg, rgba(23,28,52,0.96), rgba(18,23,43,0.98))' }}>
      {/* Head */}
      <div className="flex gap-3.5 items-start p-[18px] border-b border-white/[0.06]">
        {/* 缩略图 or PDF badge */}
        {isPDF ? (
          <div className="w-[58px] h-[72px] rounded-[14px] grid place-items-center font-extrabold text-sm flex-shrink-0"
            style={{ background: 'linear-gradient(180deg, rgba(255,107,129,0.18), rgba(255,107,129,0.08))',
                     color: '#ff8898', border: '1px solid rgba(255,107,129,0.22)' }}>
            PDF
          </div>
        ) : entry.previewUrl ? (
          <div className="w-[58px] h-[72px] rounded-[14px] overflow-hidden flex-shrink-0 border border-white/10">
            <img src={entry.previewUrl} alt="" className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-[58px] h-[72px] rounded-[14px] flex-shrink-0"
            style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03))',
                     border: '1px solid rgba(255,255,255,0.1)' }} />
        )}

        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold leading-snug mb-1.5 truncate">{entry.file.name}</div>
          <div className="text-[#98a1c0] text-[13px] mb-2.5">{entry.hint}</div>
          {statusPill}
          {entry.status === 'error' && entry.error && (
            <div className="mt-2 text-[11px] text-[#ff9fa9] leading-relaxed line-clamp-2">{entry.error}</div>
          )}
        </div>

        <button onClick={() => onRemove(entry.id)} className="text-[#7d86a5] hover:text-[#ff6b81] flex-shrink-0">
          <Ic.Trash />
        </button>
      </div>

      {/* Fields */}
      <div className="p-[18px] grid gap-3.5">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1.35fr_0.8fr_auto] gap-2.5 items-end">
            <div>
              {i === 0 && <label className="block text-[#98a1c0] text-[11px] mb-2">日期</label>}
              <input className="input w-full bg-white/[0.04] text-white rounded-[14px] px-3.5 py-3 text-sm outline-none border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)] focus:shadow-[0_0_0_4px_rgba(124,77,255,0.12)]"
                value={it.date} placeholder="1月6日" onChange={e => change(i, 'date', e.target.value)} />
            </div>
            <div>
              {i === 0 && <label className="block text-[#98a1c0] text-[11px] mb-2">类型</label>}
              <select className="select w-full bg-white/[0.04] text-white rounded-[14px] px-3.5 py-3 text-sm outline-none border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)]"
                value={it.type} onChange={e => change(i, 'type', e.target.value as ExpenseType)}>
                <option>高铁票</option><option>Uber行程</option><option>滴滴</option><option>微信乘车码</option>
              </select>
            </div>
            <div>
              {i === 0 && <label className="block text-[#98a1c0] text-[11px] mb-2">行程</label>}
              <input className="input w-full bg-white/[0.04] text-white rounded-[14px] px-3.5 py-3 text-sm outline-none border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)] focus:shadow-[0_0_0_4px_rgba(124,77,255,0.12)]"
                value={it.route} placeholder="起点 -> 终点" onChange={e => change(i, 'route', e.target.value)} />
            </div>
            <div>
              {i === 0 && <label className="block text-[#98a1c0] text-[11px] mb-2">金额</label>}
              <input className="input w-full bg-white/[0.04] text-white rounded-[14px] px-3.5 py-3 text-sm outline-none border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)] focus:shadow-[0_0_0_4px_rgba(124,77,255,0.12)] font-mono text-right"
                type="number" value={it.amount || ''} placeholder="0" onChange={e => change(i, 'amount', parseFloat(e.target.value) || 0)} />
            </div>
            {items.length > 1 && (
              <button onClick={() => removeItem(i)} className={`${i === 0 ? 'mt-6' : ''} text-[#7d86a5] hover:text-[#ff6b81] p-2`}>
                <Ic.Trash />
              </button>
            )}
          </div>
        ))}
        {items.length === 0 && entry.status !== 'parsing' && (
          <div className="text-center py-6 text-[#7d86a5] text-sm">未识别到字段，点击下方「添加一行」手动补录</div>
        )}
      </div>

      {/* Actions */}
      <div className="px-[18px] pb-[18px] flex justify-between items-center gap-3">
        <button onClick={isPDF && entry.status === 'done' ? () => onViewSource(entry) : add}
          className="text-[#a9b6ff] font-semibold bg-transparent border-0 py-2.5 cursor-pointer hover:text-white flex items-center gap-1.5">
          {isPDF && entry.status === 'done' ? '查看原始票据' : <><Ic.Plus /> 添加一行</>}
        </button>
        <button onClick={() => onConfirm(entry.id, items)}
          disabled={entry.status === 'parsing' || items.length === 0 || items.every(it => !it.date || !it.amount)}
          className="primary-btn border-0 text-white px-5 py-3 rounded-[14px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(90deg, var(--purple), var(--blue))', boxShadow: '0 12px 24px rgba(104,92,255,0.28)' }}>
          确认添加到表格 ({items.filter(it => it.date && it.amount).length})
        </button>
      </div>
    </article>
  );
}

// ─── Summary Table ────────────────────────────────────────
function SummaryTable({ records, groups, grandTotal, nonRailGrand, onUpdate, onDelete, onAdd }: {
  records: ExpenseRecord[]; groups: DailyGroup[];
  grandTotal: number; nonRailGrand: number;
  onUpdate: (id: number, f: keyof ExpenseRecord, v: string | number) => void;
  onDelete: (id: number) => void;
  onAdd: () => void;
}) {
  return (
    <section className="mt-6 rounded-[28px] border border-white/[0.08] p-6"
      style={{ background: 'rgba(23,28,51,0.92)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
      <div className="flex justify-between items-center mb-5">
        <div>
          <h3 className="text-[18px] font-extrabold tracking-tight m-0">汇总表格</h3>
          <p className="m-0 mt-1.5 text-[#98a1c0] text-[13px]">双击任意单元格即可编辑 · 按日期自动分组</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onAdd}
            className="flex items-center gap-1.5 px-3.5 py-2.5 text-sm rounded-[14px] bg-white/[0.04] border border-white/10 text-white hover:bg-white/[0.08]">
            <Ic.Plus /> 手动添加
          </button>
          <button onClick={() => exportExcel(records, groups)} disabled={records.length === 0}
            className="primary-btn flex items-center gap-1.5 px-5 py-2.5 text-sm rounded-[14px] text-white font-bold disabled:opacity-40"
            style={{ background: 'linear-gradient(90deg, var(--purple), var(--blue))', boxShadow: '0 12px 24px rgba(104,92,255,0.28)' }}>
            <Ic.Download /> 导出 Excel
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[#98a1c0] text-xs font-semibold bg-white/[0.02]">
              <th className="px-4 py-3 border-b border-white/[0.06] w-14 text-center">序号</th>
              <th className="px-4 py-3 border-b border-white/[0.06] w-24 text-center">日期</th>
              <th className="px-4 py-3 border-b border-white/[0.06] w-28 text-center">费用类型</th>
              <th className="px-4 py-3 border-b border-white/[0.06] text-left">行程</th>
              <th className="px-4 py-3 border-b border-white/[0.06] w-28 text-right pr-5">金额</th>
              <th className="px-4 py-3 border-b border-white/[0.06] w-12"></th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16 text-[#7d86a5]">
                暂无数据 — 请先上传截图，或点击「手动添加」
              </td></tr>
            )}
            {groups.map(g => (
              <React.Fragment key={g.date}>
                {g.records.map(r => (
                  <EditableRow key={r.id} record={r} onUpdate={onUpdate} onDelete={onDelete} />
                ))}
                <tr className="bg-white/[0.02]">
                  <td colSpan={4} className="px-4 py-3 border-t border-white/[0.06] text-center text-[13px] font-semibold text-[#98a1c0]">
                    {g.date} 交通费总额 (不含高铁)
                  </td>
                  <td className="px-4 py-3 border-t border-white/[0.06] text-right font-mono font-bold text-[#9f67ff] pr-5">
                    {g.nonRailTotal.toFixed(2)}
                  </td>
                  <td className="border-t border-white/[0.06]"></td>
                </tr>
              </React.Fragment>
            ))}
            {records.length > 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 border-t border-white/[0.1] text-center font-extrabold text-white"
                  style={{ background: 'linear-gradient(90deg, rgba(124,77,255,0.14), rgba(94,120,255,0.14))' }}>
                  总计（含高铁）
                </td>
                <td className="px-4 py-4 border-t border-white/[0.1] text-right font-mono text-lg font-extrabold text-white pr-5"
                  style={{ background: 'linear-gradient(90deg, rgba(124,77,255,0.14), rgba(94,120,255,0.14))' }}>
                  {grandTotal.toFixed(2)}
                </td>
                <td className="border-t border-white/[0.1]"
                  style={{ background: 'linear-gradient(90deg, rgba(124,77,255,0.14), rgba(94,120,255,0.14))' }}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {records.length > 0 && (
        <div className="mt-5 flex gap-6 text-sm text-[#98a1c0]">
          <span>非高铁合计：<span className="font-extrabold text-[#9f67ff] ml-1.5 text-base">{nonRailGrand.toFixed(2)}</span></span>
          <span>总计（含高铁）：<span className="font-extrabold text-white ml-1.5 text-base">{grandTotal.toFixed(2)}</span></span>
        </div>
      )}
    </section>
  );
}

// ─── EditableRow ──────────────────────────────────────────
function EditableRow({ record, onUpdate, onDelete }: {
  record: ExpenseRecord;
  onUpdate: (id: number, f: keyof ExpenseRecord, v: string | number) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState<keyof ExpenseRecord | null>(null);
  const [draft, setDraft] = useState('');

  const start = (f: keyof ExpenseRecord) => { setEditing(f); setDraft(String(record[f])); };
  const confirm = () => {
    if (editing) onUpdate(record.id, editing, editing === 'amount' ? parseFloat(draft) || 0 : draft);
    setEditing(null);
  };

  const cell = (f: keyof ExpenseRecord, cls = '') => (
    <td className={`px-4 py-3 border-t border-white/[0.04] ${cls}`} onDoubleClick={() => start(f)}>
      {editing === f ? (
        <input autoFocus
          className="w-full bg-white/[0.08] text-white rounded-lg px-2 py-1 text-sm border border-[rgba(124,77,255,0.6)] outline-none"
          value={draft} onChange={e => setDraft(e.target.value)}
          onBlur={confirm}
          onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') setEditing(null); }} />
      ) : (
        <span className="cursor-text">{String(record[f])}</span>
      )}
    </td>
  );

  return (
    <tr className="hover:bg-white/[0.02] transition-colors group">
      <td className="px-4 py-3 border-t border-white/[0.04] text-center text-[#7d86a5]">{record.id}</td>
      {cell('date', 'text-center whitespace-nowrap')}
      {cell('type', 'text-center text-[#a9b6ff]')}
      {cell('route', 'text-left')}
      {cell('amount', 'text-right font-mono pr-5')}
      <td className="px-2 py-3 border-t border-white/[0.04] text-center">
        <button onClick={() => onDelete(record.id)}
          className="text-[#7d86a5] hover:text-[#ff6b81] opacity-0 group-hover:opacity-100 transition-opacity">
          <Ic.Trash />
        </button>
      </td>
    </tr>
  );
}

// ─── AddRow Modal ─────────────────────────────────────────
function AddRowModal({ onAdd, onClose }: {
  onAdd: (r: Omit<ExpenseRecord, 'id'>) => void; onClose: () => void;
}) {
  const [date, setDate] = useState('');
  const [type, setType] = useState<ExpenseType>('高铁票');
  const [route, setRoute] = useState('');
  const [amount, setAmount] = useState('');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-[480px] rounded-3xl p-7 border border-white/[0.08]"
        style={{ background: 'linear-gradient(180deg, rgba(27,33,60,0.98), rgba(21,26,48,0.98))',
                 boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold mb-5 tracking-tight">手动添加记录</h3>
        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className="text-[#98a1c0] text-xs mb-2 block">日期</label>
            <input className="input w-full bg-white/[0.04] text-white rounded-[14px] px-3.5 py-3 text-sm border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)] outline-none"
              placeholder="1月6日" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="text-[#98a1c0] text-xs mb-2 block">类型</label>
            <select className="select w-full bg-white/[0.04] text-white rounded-[14px] px-3.5 py-3 text-sm border border-white/[0.08] outline-none"
              value={type} onChange={e => setType(e.target.value as ExpenseType)}>
              <option>高铁票</option><option>Uber行程</option><option>滴滴</option><option>微信乘车码</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-[#98a1c0] text-xs mb-2 block">行程</label>
            <input className="input w-full bg-white/[0.04] text-white rounded-[14px] px-3.5 py-3 text-sm border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)] outline-none"
              placeholder="起点 -> 终点" value={route} onChange={e => setRoute(e.target.value)} />
          </div>
          <div>
            <label className="text-[#98a1c0] text-xs mb-2 block">金额</label>
            <input className="input w-full bg-white/[0.04] text-white rounded-[14px] px-3.5 py-3 text-sm border border-white/[0.08] focus:border-[rgba(124,77,255,0.72)] outline-none font-mono"
              placeholder="0.00" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 mt-6 justify-end">
          <button className="px-4 py-2.5 rounded-[12px] text-sm text-[#98a1c0] hover:bg-white/[0.04]" onClick={onClose}>取消</button>
          <button className="primary-btn px-5 py-2.5 rounded-[12px] text-sm text-white font-bold"
            style={{ background: 'linear-gradient(90deg, var(--purple), var(--blue))', boxShadow: '0 12px 24px rgba(104,92,255,0.28)' }}
            onClick={() => { if (date && amount) { onAdd({ date, type, route, amount: parseFloat(amount) }); onClose(); } }}>
            添加
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────
export default function App() {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [menu, setMenu] = useState<'upload' | 'history' | 'table' | 'api'>('upload');
  const [tabMode, setTabMode] = useState<'upload' | 'table'>('upload');
  const [showAdd, setShowAdd] = useState(false);

  const handleFiles = useCallback(async (files: File[], hint: ExpenseType) => {
    const entries: PendingFile[] = files.map(f => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f, hint,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      status: 'parsing', items: [],
    }));
    setPending(prev => [...prev, ...entries]);

    await Promise.all(entries.map(async (entry) => {
      try {
        const items = await parseFile(entry.file, entry.hint);
        setPending(prev => prev.map(p => p.id === entry.id ? { ...p, status: 'done', items } : p));
      } catch (err) {
        setPending(prev => prev.map(p =>
          p.id === entry.id
            ? { ...p, status: 'error', error: String(err).replace('Error: ', ''), items: [{ date: '', type: entry.hint, route: '', amount: 0 }] }
            : p));
      }
    }));
  }, []);

  const confirmPending = (id: string, items: ParsedItem[]) => {
    const valid = items.filter(it => it.date && it.amount > 0);
    if (!valid.length) return;
    setRecords(prev => sortRecords([
      ...prev,
      ...valid.map(it => ({ id: 0, date: it.date, type: it.type, route: it.route, amount: it.amount })),
    ]));
    setPending(prev => {
      const e = prev.find(p => p.id === id);
      if (e?.previewUrl) URL.revokeObjectURL(e.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  };

  const removePending = (id: string) => {
    setPending(prev => {
      const e = prev.find(p => p.id === id);
      if (e?.previewUrl) URL.revokeObjectURL(e.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  };

  const viewSource = (entry: PendingFile) => {
    if (entry.previewUrl) window.open(entry.previewUrl, '_blank');
    else if (entry.file) window.open(URL.createObjectURL(entry.file), '_blank');
  };

  const updateRecord = (id: number, f: keyof ExpenseRecord, v: string | number) =>
    setRecords(prev => sortRecords(prev.map(r => r.id === id ? { ...r, [f]: v } : r)));
  const deleteRecord = (id: number) => setRecords(prev => sortRecords(prev.filter(r => r.id !== id)));
  const addRecord = (r: Omit<ExpenseRecord, 'id'>) => setRecords(prev => sortRecords([...prev, { ...r, id: 0 }]));

  const groups = groupByDate(records);
  const grandTotal = records.reduce((s, r) => s + r.amount, 0);
  const nonRailGrand = records.filter(r => r.type !== '高铁票').reduce((s, r) => s + r.amount, 0);

  const parsingCount = pending.filter(p => p.status === 'parsing').length;
  const pendingCount = pending.filter(p => p.status !== 'parsing' && (p.status === 'error' || p.items.length === 0)).length;
  const successCount = pending.filter(p => p.status === 'done' && p.items.length > 0).length;

  return (
    <div className="min-h-screen grid md:grid-cols-[240px_1fr]">
      <Sidebar active={menu} onChange={(k) => setMenu(k as any)} />

      <main className="content px-6 py-7 md:px-8 md:py-8 overflow-x-hidden">
        <h1 className="text-[22px] font-extrabold m-0 tracking-tight">
          {menu === 'upload' && '报销处理系统'}
          {menu === 'history' && '识别历史'}
          {menu === 'table' && '汇总表格'}
          {menu === 'api' && 'API 管理'}
        </h1>
        <div className="text-[#98a1c0] mt-2 text-sm">
          {menu === 'upload' && 'AI 自动识别 · 高铁票 · Uber · 滴滴 · 微信乘车码 · 截图 / PDF'}
          {menu === 'history' && '查看近期处理过的票据记录'}
          {menu === 'table' && '按日期归类，导出 Excel 报销明细'}
          {menu === 'api' && '管理大模型服务商与 API Key 配置，支持 Gemini / OpenAI / Claude / OpenAI 兼容接口'}
        </div>

        {/* ─── 报销处理（主页面）──────────────── */}
        {menu === 'upload' && (
          <>
            <HeroOverview
              total={pending.length}
              success={successCount}
              pending={pendingCount}
              parsing={parsingCount}
            />

            {/* 上传面板 */}
            <section className="mt-6 rounded-[28px] border border-white/[0.08] p-6"
              style={{ background: 'rgba(23,28,51,0.92)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
              <div className="flex justify-between items-center gap-4 mb-5">
                <div>
                  <h3 className="m-0 text-[18px] font-extrabold tracking-tight">上传识别</h3>
                  <p className="m-0 mt-1.5 text-[#98a1c0] text-[13px]">拖拽或点击上传截图 / PDF，AI 自动提取日期、行程、金额</p>
                </div>
                <div className="inline-flex gap-2.5 bg-white/[0.03] p-1.5 rounded-2xl border border-white/[0.06]">
                  <button onClick={() => setTabMode('upload')}
                    className={`border-0 px-4 py-2.5 rounded-xl font-semibold cursor-pointer text-sm ${
                      tabMode === 'upload' ? 'text-white' : 'bg-transparent text-[#98a1c0]'
                    }`}
                    style={tabMode === 'upload'
                      ? { background: 'linear-gradient(90deg, var(--purple), var(--blue))', boxShadow: '0 10px 20px rgba(112,86,255,0.28)' }
                      : {}}>
                    上传截图 {pending.length > 0 ? `(${pending.length})` : ''}
                  </button>
                  <button onClick={() => setTabMode('table')}
                    className={`border-0 px-4 py-2.5 rounded-xl font-semibold cursor-pointer text-sm ${
                      tabMode === 'table' ? 'text-white' : 'bg-transparent text-[#98a1c0]'
                    }`}
                    style={tabMode === 'table'
                      ? { background: 'linear-gradient(90deg, var(--purple), var(--blue))', boxShadow: '0 10px 20px rgba(112,86,255,0.28)' }
                      : {}}>
                    汇总表格 {records.length > 0 ? `(${records.length})` : ''}
                  </button>
                </div>
              </div>

              {tabMode === 'upload' && (
                <>
                  <div className="grid lg:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
                    <Dropzone label="高铁票" hint="高铁票"
                      sub={<>支持截图上传<br />自动识别日期、车次与金额</>} onFiles={handleFiles} />
                    <Dropzone label="Uber 行程" hint="Uber行程"
                      sub={<>支持截图上传<br />提取路线、时间与币种金额</>} onFiles={handleFiles} />
                    <Dropzone label="滴滴行程单" hint="滴滴"
                      sub={<>支持截图 / PDF<br />统一清洗中文票据字段</>} onFiles={handleFiles} />
                    <Dropzone label="微信乘车码" hint="微信乘车码"
                      sub={<>港铁 / 地铁支付凭证<br />取 RMB 金额 · 起讫从文件名取</>} onFiles={handleFiles} />
                  </div>
                  <div className="flex justify-between gap-4 text-[#98a1c0] text-[13px] mt-2.5">
                    <span>建议：优先上传清晰、完整截图，系统会自动提取关键字段。</span>
                    <span>当前共 {pending.length} 个文件待核对</span>
                  </div>
                </>
              )}

              {tabMode === 'table' && (
                <SummaryTable records={records} groups={groups}
                  grandTotal={grandTotal} nonRailGrand={nonRailGrand}
                  onUpdate={updateRecord} onDelete={deleteRecord}
                  onAdd={() => setShowAdd(true)} />
              )}
            </section>

            {/* AI 识别结果 */}
            {pending.length > 0 && tabMode === 'upload' && (
              <section className="mt-6 rounded-[28px] border border-white/[0.08] p-6"
                style={{ background: 'rgba(23,28,51,0.92)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
                <div className="flex justify-between items-center gap-4 mb-5">
                  <div>
                    <h3 className="m-0 text-[18px] font-extrabold tracking-tight">AI 识别结果</h3>
                    <p className="m-0 mt-1.5 text-[#98a1c0] text-[13px]">核对字段后点击「确认添加到表格」，即可并入汇总表</p>
                  </div>
                  {records.length > 0 && (
                    <button onClick={() => exportExcel(records, groups)}
                      className="primary-btn border-0 text-white px-5 py-3 rounded-[14px] font-bold cursor-pointer flex items-center gap-1.5"
                      style={{ background: 'linear-gradient(90deg, var(--purple), var(--blue))', boxShadow: '0 12px 24px rgba(104,92,255,0.28)' }}>
                      <Ic.Download /> 导出汇总表
                    </button>
                  )}
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                  {pending.map(e => (
                    <ResultCard key={e.id} entry={e}
                      onConfirm={confirmPending} onRemove={removePending} onViewSource={viewSource} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ─── 汇总表格（独立 Tab）─────────────── */}
        {menu === 'table' && (
          <SummaryTable records={records} groups={groups}
            grandTotal={grandTotal} nonRailGrand={nonRailGrand}
            onUpdate={updateRecord} onDelete={deleteRecord}
            onAdd={() => setShowAdd(true)} />
        )}

        {/* ─── 识别历史 ─────────────────────────── */}
        {menu === 'history' && (
          <HistoryPanel onReuse={(items) => {
            const valid = items.filter(it => it.date && it.amount > 0);
            if (!valid.length) return;
            setRecords(prev => sortRecords([
              ...prev,
              ...valid.map(it => ({ id: 0, date: it.date, type: it.type, route: it.route, amount: it.amount })),
            ]));
            setMenu('table');
          }} />
        )}

        {/* ─── API 管理 ─────────────────────────── */}
        {menu === 'api' && <ApiConfigPanel />}
      </main>

      {showAdd && <AddRowModal onAdd={addRecord} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
