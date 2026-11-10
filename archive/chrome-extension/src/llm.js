import { info, warn, error } from './log.js';

export const DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 700,
};

export function normalizeSettings(s = {}) {
  return {
    baseUrl: (s.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, ''),
    apiKey: s.apiKey || '',
    model: s.model || DEFAULTS.model,
    temperature: s.temperature ?? DEFAULTS.temperature,
    maxTokens: s.maxTokens ?? DEFAULTS.maxTokens,
  };
}

export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); } catch {}
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch {}
  }
  return null;
}


export function parseXmlToolCalls(text) {
  const calls = [];
  let cleaned = String(text || '');
  cleaned = cleaned.replace(/<tool_call>\s*([A-Za-z0-9_]+)\s*(\{[\s\S]*?\})\s*<\/tool_call>/g, (m, name, args) => {
    try { JSON.parse(args); } catch (e) { return m; }
    calls.push({ id: `call_xml_${calls.length}_${Date.now().toString(36)}`, type: 'function', function: { name, arguments: args } });
    return '';
  });
  return { text: cleaned.trim(), calls };
}

export async function callLLM({ messages, settings, expectJson = true, timeoutMs = 120000, session, puzzle, tools }) {
  session = session || 'ses_' + Date.now().toString(36);
  const s = normalizeSettings(settings);
  if (!s.apiKey) {
    const e = new Error('NO_API_KEY');
    e.code = 'NO_API_KEY';
    throw e;
  }
  const url = `${s.baseUrl}/chat/completions`;
  const baseBody = {
    model: s.model,
    messages,
    temperature: s.temperature,
    ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
  };
  let res = null;
  let raw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = { ...baseBody, ...(attempt === 0 ? { max_tokens: s.maxTokens } : {}) };
    await info('llm.request', { url, model: s.model, session, puzzle, tools: tools ? tools.length : 0, attempt, maxTokens: body.max_tokens ?? null, messages });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}`, 'x-opencode-session': session },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      await error('llm.network', { message: e.message, url, attempt });
      const err = new Error('NETWORK');
      err.code = 'NETWORK';
      throw err;
    }
    clearTimeout(timer);
    raw = await res.text();
    if (res.ok) break;
    if (res.status === 400 && /max_tokens/i.test(raw) && attempt === 0) {
      await warn('llm.max_tokens_retry', { status: 400, detail: raw.slice(0, 400), url });
      continue;
    }
    await error('llm.http', { status: res.status, body: raw.slice(0, 800), url, attempt });
    const err = new Error(`HTTP ${res.status}`);
    err.code = 'HTTP';
    err.status = res.status;
    err.detail = raw.slice(0, 800);
    throw err;
  }
  if (!res || !res.ok) {
    const err = new Error(`HTTP ${res ? res.status : 'UNKNOWN'}`);
    err.code = 'HTTP';
    err.status = res ? res.status : 0;
    err.detail = raw.slice(0, 800);
    throw err;
  }
  let data;
  try { data = JSON.parse(raw); } catch {
    await error('llm.bad_json', { body: raw.slice(0, 800) });
    const err = new Error('BAD_JSON');
    err.code = 'BAD_JSON';
    throw err;
  }
  const message = data?.choices?.[0]?.message || {};
  let text = message?.content ?? data?.choices?.[0]?.text ?? '';
  const reasoning = message?.reasoning_content || message?.reasoning || '';
  let toolCalls = message?.tool_calls || null;
  if (!toolCalls && typeof text === 'string' && text.includes('<tool_call>')) {
    const parsed = parseXmlToolCalls(text);
    if (parsed.calls.length) {
      toolCalls = parsed.calls;
      text = parsed.text;
      message.tool_calls = toolCalls;
      message.content = text;
    }
  }
  const usage = data?.usage || null;
  await info('llm.response', { text, reasoning: reasoning ? reasoning.slice(0, 4000) : '', toolCalls: toolCalls ? toolCalls.length : 0, usage, model: data?.model, puzzle });
  let json = null;
  if (expectJson) {
    json = extractJson(text) || extractJson(reasoning);
    if (!json) await warn('llm.no_json', { text: text.slice(0, 500), reasoning: reasoning.slice(0, 500) });
  }
  return { text, reasoning, json, usage, raw: data, message, toolCalls };
}
