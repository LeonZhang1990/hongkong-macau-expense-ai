/**
 * 多厂商 LLM 调用抽象层
 *
 * 统一入口：callLLM({ provider, apiKey, model, baseURL }, { prompt, image? })
 *   image: { data: base64, mimeType } - 可选，传入则走多模态
 *   返回：模型输出的字符串
 *
 * 支持：
 *   - gemini:      Google Gemini (原生 SDK，多模态)
 *   - openai:      OpenAI GPT 系列（多模态 image_url）
 *   - anthropic:   Claude 系列（多模态 base64）
 *   - openai-compat: 兼容 OpenAI 协议的第三方（DeepSeek、Kimi、智谱 等），用户填 baseURL
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

// ─── Gemini ───────────────────────────────────────────────
async function callGemini({ apiKey, model }, { prompt, image }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model });
  const parts = image
    ? [prompt, { inlineData: { data: image.data, mimeType: image.mimeType } }]
    : [prompt];
  const r = await m.generateContent(parts);
  return r.response.text();
}

// ─── OpenAI 及兼容 ────────────────────────────────────────
async function callOpenAILike({ apiKey, model, baseURL }, { prompt, image }) {
  const client = new OpenAI({ apiKey, baseURL: baseURL || undefined });

  const content = image
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
      ]
    : prompt;

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content }],
    temperature: 0.1,
  });
  return completion.choices?.[0]?.message?.content || '';
}

// ─── Anthropic Claude ─────────────────────────────────────
async function callAnthropic({ apiKey, model, baseURL }, { prompt, image }) {
  const url = (baseURL || 'https://api.anthropic.com') + '/v1/messages';
  const content = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } },
        { type: 'text', text: prompt },
      ]
    : [{ type: 'text', text: prompt }];

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.content?.map(c => c.text || '').join('') || '';
}

// ─── 统一入口 ──────────────────────────────────────────────
export async function callLLM(cfg, { prompt, image }) {
  const provider = cfg.provider || 'gemini';
  if (!cfg.apiKey) throw new Error('未配置 API Key');
  if (!cfg.model) throw new Error('未配置模型名');

  switch (provider) {
    case 'gemini':
      return callGemini(cfg, { prompt, image });
    case 'openai':
      return callOpenAILike({ ...cfg, baseURL: cfg.baseURL || 'https://api.openai.com/v1' }, { prompt, image });
    case 'anthropic':
      return callAnthropic(cfg, { prompt, image });
    case 'openai-compat':
      if (!cfg.baseURL) throw new Error('OpenAI 兼容模式必须填写 Base URL');
      return callOpenAILike(cfg, { prompt, image });
    default:
      throw new Error(`不支持的 provider: ${provider}`);
  }
}

// ─── 厂商元信息（供前端展示用） ────────────────────────────
export const PROVIDERS = [
  {
    id: 'gemini', name: 'Google Gemini', requiresBaseURL: false, supportsVision: true,
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    apiKeyPlaceholder: 'AIza...',
    docUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'openai', name: 'OpenAI', requiresBaseURL: false, supportsVision: true,
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4.1', 'gpt-4.1-mini'],
    apiKeyPlaceholder: 'sk-...',
    docUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic', name: 'Anthropic Claude', requiresBaseURL: false, supportsVision: true,
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest', 'claude-sonnet-4-20250514'],
    apiKeyPlaceholder: 'sk-ant-...',
    docUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai-compat', name: 'OpenAI 兼容 (DeepSeek / Kimi / 智谱 / 自建)',
    requiresBaseURL: true, supportsVision: true,
    models: [
      'deepseek-chat', 'deepseek-reasoner',
      'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k',
      'glm-4-plus', 'glm-4v-plus',
      'qwen-vl-max', 'qwen-vl-plus',
    ],
    apiKeyPlaceholder: '第三方平台的 API Key',
    docUrl: '',
    baseURLPlaceholder: '如：https://api.deepseek.com/v1',
  },
];
