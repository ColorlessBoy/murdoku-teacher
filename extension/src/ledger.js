let eventSink = null;
let backend = null;
export function setLedgerBackend(b) { backend = b && typeof b.load === 'function' ? b : null; }
export function setLedgerEventSink(fn) { eventSink = typeof fn === 'function' ? fn : null; }
function emit(puzzle, type, payload = {}) { try { eventSink?.({ puzzle, type, payload }); } catch (e) {} }

const PREFIX = 'mm_ledger_';
const MAX_BATCHES = 600;
const MAX_CELL_HISTORY = 30;

function storeKey(puzzle) {
  return PREFIX + encodeURIComponent(String(puzzle || 'unknown')).slice(0, 90);
}

function cellKey(r, c) {
  return `R${r}C${c}`;
}

const emptyState = () => ({ seq: 0, batches: [], cells: {}, questions: [] });

async function load(puzzle) {
  if (backend) {
    try {
      const st = await backend.load(puzzle);
      if (st) return { ...emptyState(), ...st, cells: st.cells || {}, batches: st.batches || [], questions: st.questions || [] };
    } catch (e) {}
  }
  const key = storeKey(puzzle);
  const { [key]: st } = await chrome.storage.local.get(key);
  if (!st || typeof st !== 'object') return emptyState();
  return { ...emptyState(), ...st, cells: st.cells || {}, batches: st.batches || [], questions: st.questions || [] };
}

async function save(puzzle, st) {
  if (backend) {
    try { if (await backend.save(puzzle, st)) return; } catch (e) {}
  }
  if (st.batches.length > MAX_BATCHES) st.batches.splice(0, st.batches.length - MAX_BATCHES);
  if (st.questions.length > 300) st.questions.splice(0, st.questions.length - 300);
  for (const k of Object.keys(st.cells)) {
    if (st.cells[k].length > MAX_CELL_HISTORY) st.cells[k].splice(0, st.cells[k].length - MAX_CELL_HISTORY);
  }
  await chrome.storage.local.set({ [storeKey(puzzle)]: st });
}

function mergeCells(a = [], b = []) {
  const map = new Map();
  for (const c of [...a, ...b]) map.set(cellKey(c.r, c.c), c);
  return [...map.values()];
}

function unresolvedQuestions(st) {
  return st.questions.filter((q) => q.status !== 'closed');
}

/**
 * 记录一批盘面变动。每个 cell 的 before/after 都落账。
 * 若已有未关闭的问题，新变动并入该问题；否则开一个新问题。
 * 返回当前问题与未解决列表。
 */
export async function recordChanges({ puzzle, changes, source = 'observed' }) {
  const st = await load(puzzle);
  if (!Array.isArray(changes) || !changes.length) {
    return { question: null, unresolved: unresolvedQuestions(st), batch: null };
  }
  const seq = ++st.seq;
  const ts = Date.now();
  const clean0 = changes.map((c) => ({ r: c.r, c: c.c, before: c.before || null, after: c.after || { big: c.text && /^[A-Z]$/.test(c.text) ? c.text : '', notes: [], x: !!c.x } }));
  const placements = clean0.filter((c) => c.after.big);
  const clean = clean0.map((c) => {
    const after = c.after || { big: c.text && /^[A-Z]$/.test(c.text) ? c.text : '', notes: [], x: !!c.x };
    let src = 'observed';
    if (after.big) src = 'user-place';
    else if (after.x && placements.some((p) => p.r === c.r || p.c === c.c)) src = 'auto-x';
    else if ((after.notes || []).length) src = 'user-note';
    else if (after.x) src = 'user-x';
    else if (c.before && (c.before.big || (c.before.notes || []).length || c.before.x)) src = 'user-clear';
    return { r: c.r, c: c.c, before: c.before || null, after, source: src, channel: source };
  });
  const batch = { id: seq, ts, source, changes: clean };
  st.batches.push(batch);
  for (const c of clean) {
    const k = cellKey(c.r, c.c);
    (st.cells[k] = st.cells[k] || []).push({ seq, ts, before: c.before, after: c.after, source });
  }
  const existing = st.questions.find((q) => q.status === 'open' || q.status === 'asked');
  if (existing) {
    const age = ts - (existing.updatedAt || existing.createdAt || ts);
    const tooBig = (existing.cells || []).length > 30;
    const alreadyAsked = existing.status === 'asked';
    if (alreadyAsked || age > 5 * 60 * 1000 || tooBig) {
      existing.status = 'closed';
      existing.verdict = existing.verdict || 'superseded';
      existing.closedAt = ts;
    }
  }
  let question = st.questions.find((q) => q.status === 'open' || q.status === 'asked');
  const created = !question;
  if (question) {
    question.batches.push(seq);
    question.cells = mergeCells(question.cells, clean);
    question.updatedAt = ts;
  } else {
    question = {
      id: 'q' + seq, batches: [seq], cells: clean,
      status: 'open', createdAt: ts, updatedAt: ts,
      answer: null, verdict: null,
    };
    st.questions.push(question);
  }
  await save(puzzle, st);
  emit(puzzle, 'ledger/batch', { batch });
  emit(puzzle, 'ledger/question', { question });
  return { question, batch, created, unresolved: unresolvedQuestions(st) };
}

export async function answerQuestion(puzzle, text) {
  const st = await load(puzzle);
  const q = [...st.questions].reverse().find((x) => x.status === 'open' || x.status === 'asked' || x.status === 'answered');
  if (!q) return null;
  q.answer = String(text || '');
  q.answeredAt = Date.now();
  q.status = 'answered';
  await save(puzzle, st);
  emit(puzzle, 'ledger/answered', { id: q.id, answer: q.answer });
  return q;
}

export async function closeQuestion(puzzle, verdict) {
  const st = await load(puzzle);
  const q = [...st.questions].reverse().find((x) => x.status === 'answered');
  if (!q) return null;
  q.verdict = verdict || null;
  q.closedAt = Date.now();
  q.status = 'closed';
  await save(puzzle, st);
  emit(puzzle, 'ledger/closed', { id: q.id, verdict: q.verdict });
  return q;
}

export async function getLedger(puzzle) {
  const st = await load(puzzle);
  return {
    seq: st.seq,
    unresolved: unresolvedQuestions(st),
    recentBatches: st.batches.slice(-12),
    counts: {
      batches: st.batches.length,
      cellsTracked: Object.keys(st.cells).length,
      questions: st.questions.length,
      unresolved: unresolvedQuestions(st).length,
    },
  };
}

export async function cellHistory(puzzle, r, c) {
  const st = await load(puzzle);
  return st.cells[cellKey(r, c)] || [];
}

export function ledgerText(st) {
  const qs = st?.unresolved || [];
  if (!qs.length) return '（无未解决项）';
  const lines = [];
  for (const q of qs) {
    lines.push(`[${q.id}] 状态=${q.status} 创建=${new Date(q.createdAt).toISOString().slice(11, 19)} 批次=${q.batches.join(',')}`);
    for (const c of q.cells.slice(0, 40)) {
      const b = c.before ? `${c.before.big || ''}${(c.before.notes || []).join('')}${c.before.x ? 'X' : ''}` || '空' : '空';
      const a = c.after ? `${c.after.big || ''}${(c.after.notes || []).join('')}${c.after.x ? 'X' : ''}` || '空' : '空';
      lines.push(`  - ${cellKey(c.r, c.c)}: ${b} → ${a}（batch ${c.batch || '?'}，来源 ${c.source || '?'}）`);
    }
    if (q.answer) lines.push(`  学生回答：${String(q.answer).slice(0, 300)}`);
  }
  return lines.join('\n');
}


export async function closeAllUnresolved(puzzle, reason = 'closed_by_user') {
  const st = await load(puzzle);
  let n = 0;
  for (const q of st.questions) {
    if (q.status !== 'closed') {
      q.status = 'closed';
      q.verdict = q.verdict || reason;
      q.closedAt = Date.now();
      n++;
    }
  }
  await save(puzzle, st);
  for (const q of st.questions) if (q.status === 'closed') emit(puzzle, 'ledger/closed', { id: q.id, verdict: q.verdict });
  return n;
}

export async function clearLedger(puzzle) {
  let clearedByBackend = false;
  if (backend) {
    try { clearedByBackend = !!(await backend.clear(puzzle)); } catch (e) {}
  }
  if (!clearedByBackend) await chrome.storage.local.remove(storeKey(puzzle));
  emit(puzzle, 'ledger/cleared', {});
}


export async function markAsked(puzzle) {
  const st = await load(puzzle);
  const q = [...st.questions].reverse().find((x) => x.status === 'open' || x.status === 'answered');
  if (!q) return null;
  q.status = 'asked';
  q.askedAt = Date.now();
  await save(puzzle, st);
  emit(puzzle, 'ledger/asked', { id: q.id });
  return q;
}
