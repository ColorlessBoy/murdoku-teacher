const KEY = 'mm_logs';
const MAX = 4000;

export const SESSION = 's_' + Date.now().toString(36);

const SECRET = /key|token|authorization|secret|password/i;

function redact(value, depth = 0) {
  if (depth > 4 || value == null) return value;
  if (typeof value === 'string') return value.length > 4000 ? value.slice(0, 4000) + '…' : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET.test(k) ? '«redacted»' : redact(v, depth + 1);
    return out;
  }
  return value;
}

export async function log(level, event, data = {}) {
  const entry = { ts: new Date().toISOString(), session: SESSION, level, event, data: redact(data) };
  try {
    const { [KEY]: logs = [] } = await chrome.storage.local.get(KEY);
    logs.push(entry);
    if (logs.length > MAX) logs.splice(0, logs.length - MAX);
    await chrome.storage.local.set({ [KEY]: logs });
  } catch (e) {
    console.error('[mm-log] storage failed', e);
  }
  const line = `[mm ${level}] ${event}`;
  if (level === 'error') console.error(line, data);
  else if (level === 'warn') console.warn(line, data);
  else console.log(line, data);
  return entry;
}

export const info = (e, d) => log('info', e, d);
export const warn = (e, d) => log('warn', e, d);
export const error = (e, d) => log('error', e, d);
export const debug = (e, d) => log('debug', e, d);

export async function getLogs({ level, limit = 2000 } = {}) {
  const { [KEY]: logs = [] } = await chrome.storage.local.get(KEY);
  let out = logs;
  if (level && level !== 'all') out = out.filter((l) => l.level === level);
  return out.slice(-limit);
}

export async function clearLogs() {
  await chrome.storage.local.set({ [KEY]: [] });
}

export async function stats() {
  const { [KEY]: logs = [] } = await chrome.storage.local.get(KEY);
  const byLevel = {};
  const byEvent = {};
  for (const l of logs) {
    byLevel[l.level] = (byLevel[l.level] || 0) + 1;
    byEvent[l.event] = (byEvent[l.event] || 0) + 1;
  }
  return { total: logs.length, byLevel, byEvent, session: SESSION };
}
