import { info, warn, error, getLogs, clearLogs, stats } from './src/log.js';
import { callLLM, normalizeSettings, extractJson } from './src/llm.js';
import { recall, loadState, addFact, buildBrief, clearFacts, resetBoardState, saveMarks, savePrep, savePrepStatus } from './src/state.js';
import { getBundledLesson } from './src/lessons.js';
import { mergeBatches } from './src/queue.js';
import { tighten, condense } from './src/format.js';
import { toolsForMode, execTool } from './src/tools.js';
import { buildMessages } from './src/prompt.js';
import { ShadowCore } from './src/core/shadow.js';
import { E } from './src/core/events.js';
import { initSession, reduceSession, PHASE } from './src/core/session-machine.js';
import { ToolPipeline } from './src/core/tool-pipeline.js';
import { requestBound } from './src/core/llm-binding.js';
import { appendCapped } from './src/core/event-log.js';
import { recordChanges, answerQuestion, closeQuestion, getLedger, ledgerText, closeAllUnresolved, clearLedger, markAsked } from './src/ledger.js';

const SETTINGS_KEY = 'mm_settings';
const CHAT_PREFIX = 'mm_chat_';
const MODE_KEY = 'mm_mode';
const LAST_PUZZLE_KEY = 'mm_last_puzzle';
const EPOCH_PREFIX = 'mm_epoch_';

async function getEpoch(puzzle) {
  const key = EPOCH_PREFIX + encodeURIComponent(String(puzzle || 'unknown')).slice(0, 90);
  const { [key]: v = 0 } = await chrome.storage.local.get(key);
  return Number(v) || 0;
}

async function bumpEpoch(puzzle) {
  const key = EPOCH_PREFIX + encodeURIComponent(String(puzzle || 'unknown')).slice(0, 90);
  const next = Date.now();
  await chrome.storage.local.set({ [key]: next });
  return next;
}

const QUEUE_PREFIX = 'mm_queue_';

function queueKey(puzzle) {
  return QUEUE_PREFIX + encodeURIComponent(String(puzzle || 'unknown')).slice(0, 90);
}

async function loadQueue(puzzle) {
  const { [queueKey(puzzle)]: q = [] } = await chrome.storage.local.get(queueKey(puzzle));
  return Array.isArray(q) ? q : [];
}

async function saveQueue(puzzle, q) {
  await chrome.storage.local.set({ [queueKey(puzzle)]: (q || []).slice(-8) });
}

async function enqueueBoard(puzzle, batch) {
  if (coreQueueEnabled) {
    const sh = shadows.get(puzzle);
    if (sh && sh.session && sh.queue) {
      sh.queueEnqueue(batch);
      const q = sh.queue.snapshot();
      await saveQueue(puzzle, q);
      shadowObserveQueue(puzzle, q);
      return q.length;
    }
  }
  const q = mergeBatches(await loadQueue(puzzle), 600000);
  const keys = new Set((batch.changes || []).map((c) => `${c.r},${c.c}`));
  const hit = q.find((x) => (x.changes || []).some((c) => keys.has(`${c.r},${c.c}`)));
  if (hit) {
    const map = new Map((hit.changes || []).map((c) => [`${c.r},${c.c}`, c]));
    for (const c of batch.changes || []) map.set(`${c.r},${c.c}`, c);
    hit.changes = [...map.values()];
    hit.board = batch.board;
    hit.clues = batch.clues;
    hit.title = batch.title;
    hit.tabId = batch.tabId;
    hit.ts = Date.now();
  } else {
    q.push({ ...batch, ts: Date.now() });
  }
  await saveQueue(puzzle, q);
  const target = hit || q[q.length - 1];
  if (target) shadowQueueEvent(puzzle, E.queueEnqueue, { batch: target });
  shadowObserveQueue(puzzle, q);
  return q.length;
}

async function clearQueue(puzzle) {
  await chrome.storage.local.remove(queueKey(puzzle));
  shadowQueueEvent(puzzle, E.queueExpire, { all: true });
  shadowObserveQueue(puzzle, []);
}

async function processQueue(puzzle) {
  if (coreQueueEnabled) {
    const sh = shadows.get(puzzle);
    if (sh && sh.session && sh.queue) {
      const q = sh.queue.snapshot();
      if (!q.length) return;
      const led = await getLedger(puzzle);
      if (led.unresolved.length) return;
      const next = q[0];
      sh.queueDequeue(next.id);
      const after = sh.queue.snapshot();
      await saveQueue(puzzle, after);
      shadowObserveQueue(puzzle, after);
      await info('board.dequeue', { puzzle, remaining: after.length, source: 'core' });
      await handleBoardChanges(next);
      return;
    }
  }
  const q = mergeBatches(await loadQueue(puzzle), 600000);
  await saveQueue(puzzle, q);
  if (!q.length) return;
  const led = await getLedger(puzzle);
  if (led.unresolved.length) return;
  const next = q.shift();
  await saveQueue(puzzle, q);
  shadowQueueEvent(puzzle, E.queueDequeue, { id: next?.id || null });
  shadowObserveQueue(puzzle, q);
  await info('board.dequeue', { puzzle, remaining: q.length });
  await handleBoardChanges(next);
}


const sessionMachines = new Map();

function sessionDispatch(puzzle, type, payload = {}) {
  const st = sessionMachines.get(puzzle) || initSession();
  const r = reduceSession(st, { type, ...payload });
  sessionMachines.set(puzzle, r.state);
  info('core.session.transition', {
    puzzle, type, phase: r.state.phase,
    effects: r.effects.map((e) => e.type),
    rejected: r.rejected ? r.rejected.reason : null,
  });
  return r;
}

const SHADOW_EVENT_PREFIX = 'mm_events_';
const eventLogChains = new Map();

function shadowEventKey(puzzle) {
  return SHADOW_EVENT_PREFIX + encodeURIComponent(String(puzzle || 'unknown')).slice(0, 80);
}

function persistShadowEvent(puzzle, event) {
  const key = shadowEventKey(puzzle);
  const prev = eventLogChains.get(puzzle) || Promise.resolve();
  const next = prev.then(async () => {
    const { [key]: events = [] } = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: appendCapped(events, event) });
  }).catch((e) => warn('core.event_log.failed', { puzzle, message: e.message }));
  eventLogChains.set(puzzle, next);
  return next;
}

const shadows = new Map();
let shadowEnabled = true;
let coreChatEnabled = true;
let coreQueueEnabled = false;

function shadowFor(puzzle) {
  let sh = shadows.get(puzzle);
  if (!sh) {
    sh = new ShadowCore(puzzle, { onDivergence: (d) => warn('core.divergence', d), onEvent: (e) => persistShadowEvent(puzzle, e) });
    shadows.set(puzzle, sh);
  }
  return sh;
}

function shadowStart(puzzle, opts = {}) {
  if (!shadowEnabled) return;
  try {
    shadowFor(puzzle).start(opts);
    info('core.shadow.start', { puzzle, board: (opts.board || []).length, chat: (opts.chat || []).length });
  } catch (e) { warn('core.shadow.start_failed', { puzzle, message: e.message }); }
}

function shadowAppendChat(puzzle, role, text) {
  if (!shadowEnabled) return;
  const sh = shadows.get(puzzle);
  if (!sh || !sh.session) return;
  try { sh.appendChat(role, text); } catch (e) { warn('core.shadow.chat_failed', { puzzle, message: e.message }); }
}

function shadowQueueEvent(puzzle, type, payload = {}) {
  shadowEvent(puzzle, type, payload);
}

function shadowObserveQueue(puzzle, queue) {
  if (!shadowEnabled) return;
  const sh = shadows.get(puzzle);
  if (!sh || !sh.session) return;
  try { sh.observeQueue(queue || []); } catch (e) { warn('core.shadow.queue_failed', { puzzle, message: e.message }); }
}

function shadowObserveLedger(puzzle, ledger) {
  if (!shadowEnabled) return;
  const sh = shadows.get(puzzle);
  if (!sh || !sh.session) return;
  try { sh.observeLedger(ledger); } catch (e) { warn('core.shadow.ledger_failed', { puzzle, message: e.message }); }
}

async function shadowSeedQueue(puzzle, queue) {
  if (!shadowEnabled || !coreQueueEnabled) return;
  const sh = shadows.get(puzzle);
  if (!sh || !sh.session || sh.queueSeeded) return;
  sh.queueSeeded = true;
  for (const b of queue || []) sh.queueEnqueue(b);
  sh.observeQueue(queue || []);
}

async function shadowRestoreFromStore(puzzle, board, chat) {
  if (!shadowEnabled) return false;
  try {
    const key = shadowEventKey(puzzle);
    const { [key]: events = [] } = await chrome.storage.local.get(key);
    if (!Array.isArray(events) || !events.length) return false;
    let lastStart = -1;
    for (let i = events.length - 1; i >= 0; i--) if (events[i].type === E.sessionStart) { lastStart = i; break; }
    if (lastStart < 0) return false;
    const sessionEvents = events.slice(lastStart);
    if (sessionEvents.some((e) => e.type === E.sessionEnd)) return false;
    const sh = shadowFor(puzzle);
    sh.restore(sessionEvents);
    sh.compareBoard(board, 'restore');
    sh.compareChat(chat, 'restore');
    await info('core.shadow.restore', { puzzle, events: sessionEvents.length, board: sh.board.snapshot().length, chat: sh.chat.snapshot().length });
    return true;
  } catch (e) {
    await warn('core.shadow.restore_failed', { puzzle, message: e.message });
    return false;
  }
}

async function shadowSummary(puzzle) {
  if (!shadowEnabled) return;
  const sh = shadows.get(puzzle);
  if (!sh || !sh.session) return;
  try {
    const snap = sh.snapshot();
    await info('core.shadow.summary', { puzzle, session: snap.session?.status, board: snap.board, chat: snap.chat, marks: snap.marks, turnSteps: snap.turnSteps, audit: snap.audit });
  } catch (e) { warn('core.shadow.summary_failed', { puzzle, message: e.message }); }
}

function shadowEvent(puzzle, type, payload = {}, meta = {}) {
  if (!shadowEnabled) return;
  const sh = shadows.get(puzzle);
  if (!sh || !sh.session) return;
  try { sh.appendEvent(type, payload, meta); } catch (e) { warn('core.shadow.event_failed', { puzzle, type, message: e.message }); }
}

function shadowObserveChat(puzzle, chat) {
  if (!shadowEnabled) return;
  const sh = shadows.get(puzzle);
  if (!sh || !sh.session) return;
  try { sh.observeChat(chat); } catch (e) { warn('core.shadow.chat_failed', { puzzle, message: e.message }); }
}

function shadowSyncBoard(puzzle, board, chat) {
  if (!shadowEnabled) return;
  try {
    const sh = shadowFor(puzzle);
    const projected = sh.board ? sh.board.snapshot().length : 0;
    if (!sh.session) {
      sh.start({ board, chat, title: 'board-sync' });
      info('core.shadow.sync', { puzzle, board: (board || []).length, mode: 'start' });
      return;
    }
    if (projected === 0 && Array.isArray(board) && board.length) {
      sh.syncBoard(board);
      info('core.shadow.sync', { puzzle, board: board.length, mode: 'restore-snapshot' });
      return;
    }
    sh.observeBoard(board, []);
  } catch (e) { warn('core.shadow.board_failed', { puzzle, message: e.message }); }
}

function shadowObserveBoard(puzzle, board, changes) {
  if (!shadowEnabled) return;
  const sh = shadows.get(puzzle);
  if (!sh || !sh.session) return;
  try { sh.observeBoard(board, changes); } catch (e) { warn('core.shadow.board_failed', { puzzle, message: e.message }); }
}

async function getSettings() {
  const { [SETTINGS_KEY]: s = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(s);
}

async function saveSettings(s) {
  const cur = await getSettings();
  const next = normalizeSettings({ ...cur, ...s, apiKey: s.apiKey && s.apiKey !== '«saved»' ? s.apiKey : cur.apiKey });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  await info('settings.saved', { baseUrl: next.baseUrl, model: next.model, hasKey: !!next.apiKey });
  return next;
}

async function getMode() {
  const { [MODE_KEY]: m = 'exam' } = await chrome.storage.local.get(MODE_KEY);
  return m === 'tutor' ? 'tutor' : 'exam';
}

async function setMode(mode) {
  const m = mode === 'tutor' ? 'tutor' : 'exam';
  await chrome.storage.local.set({ [MODE_KEY]: m });
  await info('mode.set', { mode: m });
  return m;
}

function chatKey(puzzle) {
  return CHAT_PREFIX + (puzzle || 'unknown').slice(0, 120);
}

async function getChat(puzzle) {
  if (coreChatEnabled) {
    const sh = shadows.get(puzzle);
    if (sh && sh.session && sh.chat) {
      return sh.chat.snapshot().map((m) => ({ role: m.role === 'user' ? 'you' : 'me', text: m.text, ts: m.ts }));
    }
  }
  const key = chatKey(puzzle);
  const { [key]: chat = [] } = await chrome.storage.local.get(key);
  return Array.isArray(chat) ? chat : [];
}

async function addChat(puzzle, role, text) {
  if (!text) return;
  const key = chatKey(puzzle);
  const chat = await getChat(puzzle);
  chat.push({ role, text, ts: Date.now() });
  if (chat.length > 300) chat.splice(0, chat.length - 300);
  await chrome.storage.local.set({ [key]: chat });
  shadowAppendChat(puzzle, role, text);
  shadowObserveChat(puzzle, chat);
}

async function clearChat(puzzle) {
  await chrome.storage.local.set({ [chatKey(puzzle)]: [] });
}

async function sendToTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    await info('tab.sent', { tabId, type: msg?.type });
  } catch (e) {
    await warn('tab.send_failed', { tabId, type: msg?.type, message: e.message });
  }
}

async function ensureAssistant(payload) {
  const json = payload?.json;
  if (json && typeof json === 'object') {
    return {
      text: String(json.text || '').trim() || '（空回复）',
      marks: Array.isArray(json.marks) ? json.marks.slice(0, 30) : [],
      verdict: json.verdict || null,
    };
  }
  const text = String(payload?.text || '').trim() || '（模型没有返回内容）';
  return { text, marks: [], verdict: null };
}

function focusText(q, board) {
  if (!q || !Array.isArray(q.cells) || !q.cells.length) return '';
  const map = new Map((board || []).map((c) => [`${c.r},${c.c}`, c]));
  return q.cells.slice(-5).map((c) => {
    const st = map.get(`${c.r},${c.c}`);
    const state = !st ? '未读取' : st.big ? `落子 ${st.big}` : (st.notes && st.notes.length) ? `笔记 ${st.notes.join('')}` : st.x ? 'X' : '空';
    const nb = [[-1, 0, '上'], [1, 0, '下'], [0, -1, '左'], [0, 1, '右']].map(([dr, dc, name]) => {
      const n = map.get(`${c.r + dr},${c.c + dc}`); if (!n) return '';
      const v = n.big ? n.big : (n.notes && n.notes.length) ? n.notes.join('') : n.x ? 'X' : n.obj ? '物件' : '';
      return v ? `${name}${v}` : '';
    }).filter(Boolean).join(' ');
    return `R${c.r}C${c.c}: ${state}${nb ? `；邻格 ${nb}` : ''}`;
  }).join('\n');
}

async function ensurePrep(puzzle, board, clues, settings, force = false) {
  const lesson = getBundledLesson(puzzle);
  if (!lesson) return null;
  const st = await loadState(puzzle);
  if (!st.prep || st.prep.source !== 'bundled') {
    await savePrep(puzzle, lesson);
    await info('prep.bundled', { puzzle, chain: (lesson.chain || []).length, solution: (lesson.solution || []).length });
  }
  return lesson;
}

async function readLiveBoard(tabId, puzzle) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'mm:read-board' });
    if (r?.ok && Array.isArray(r.board)) {
      await recall(puzzle, { title: r.title, clues: r.clues, board: r.board });
      return { board: r.board, clues: r.clues, title: r.title };
    }
  } catch (e) {}
  return null;
}

async function runAgent({ tabId, puzzle, board, changes, userText, clues, ledger, autoStart = false }) {
  let tab = null; try { tab = await chrome.tabs.get(tabId); } catch (e) {}
  if (!tab) { await warn('agent.tab_gone', { tabId, puzzle }); return; }
  const mode = await getMode();
  const settings = await getSettings();
  const runEpoch = await getEpoch(puzzle);
  const chat = await getChat(puzzle);
  if (userText) await addChat(puzzle, 'you', userText);
  const live = await readLiveBoard(tabId, puzzle);
  const boardNow = (live && Array.isArray(live.board) && live.board.length) ? live.board : board;
  const cluesNow = (live && Array.isArray(live.clues)) ? live.clues : clues;
  if (settings.apiKey) await ensurePrep(puzzle, boardNow, cluesNow, settings, true);
  const ledState = await getLedger(puzzle);
  const focusQ = (ledState.unresolved || []).slice(-1)[0];
  const focus = focusText(focusQ, boardNow);
  const puzzleType = /minigolf|高尔夫/i.test(String(puzzle)) ? 'minigolf' : 'murdoku';
  const st = await loadState(puzzle);
  const chatNow = await getChat(puzzle);
  const brief = buildBrief(st, { focus, ledger, userText, chat: chatNow });
  const messages = buildMessages({ mode, brief, userText, puzzle, autoStart });
  shadowEvent(puzzle, E.turnStart, { text: userText || '', mode, autoStart: !!autoStart });
  shadowEvent(puzzle, E.stepStart, { no: 1 });
  await info('agent.run', { tabId, mode, puzzle, changes: changes?.length || 0, boardCells: boardNow.length, userText: userText || null, hasKey: !!settings.apiKey });

  if (!settings.apiKey) {
    const text = '还没有配置 API Key。点侧栏右上角 ⚙ 打开设置，填入 Key（支持任意 OpenAI 兼容端点）。';
    await addChat(puzzle, 'me', text);
    await sendToTab(tabId, { type: 'mm:assistant', text, marks: [], verdict: null, system: true });
    await warn('agent.no_key', { tabId });
    await shadowSummary(puzzle);
    return;
  }

  let lastReqEpoch = null;
  try {
    const baseMessages = messages;
    let rawText = '';
    const llmSettings = mode === 'tutor'
      ? { ...settings, maxTokens: Math.max(Number(settings.maxTokens) || 0, 8192) }
      : settings;
    let toolsUsed = 0;
    let boardActions = 0;
    let nudged = false;
    const actionMarks = new Map();
    let useTools = true;
    for (let round = 0; round < 3; round++) {
      if (await getEpoch(puzzle) !== runEpoch) {
        await info('agent.stale_discarded', { tabId, puzzle, epoch: runEpoch, stage: 'pre_llm' });
        return;
      }
      const reqEpoch = await getEpoch(puzzle);
      lastReqEpoch = reqEpoch;
      const shadowReq = `req_${puzzle}_${round}_${Date.now()}`;
      await info('agent.request', { tabId, puzzle, epoch: reqEpoch, round });
      const llmCall = () => callLLM({
        messages, settings: llmSettings, expectJson: false,
        session: 'ses_' + encodeURIComponent(puzzle).slice(0, 60), puzzle,
        tools: useTools ? toolsForMode(mode) : null,
      });
      let payload;
      const sh = shadows.get(puzzle);
      if (sh && sh.session && sh.session.status === 'active') {
        const isCurrent = async () => { const e = await getEpoch(puzzle); return e === reqEpoch && e === runEpoch; };
        const bound = await requestBound({
          session: sh.session, requestId: shadowReq, stepId: 'step1', messages, isCurrent, call: llmCall,
        });
        if (!bound.ok) {
          if (bound.rejected === 'llm_error') {
            if (useTools) {
              useTools = false;
              await warn('agent.tools_fallback', { code: bound.original?.code, message: bound.error });
              continue;
            }
            throw bound.original || new Error(bound.error || 'llm error');
          }
          if (['stale_before_call', 'stale_after_call', 'session_not_active'].includes(bound.rejected)) {
            await info('agent.stale_discarded', { tabId, puzzle, epoch: runEpoch, stage: 'llm_binding', reason: bound.rejected });
            return;
          }
          throw new Error(bound.rejected);
        }
        payload = bound.result;
      } else {
        try {
          payload = await llmCall();
        } catch (e) {
          if (useTools) {
            useTools = false;
            await warn('agent.tools_fallback', { code: e.code, message: e.message });
            continue;
          }
          throw e;
        }
      }
      const afterReqEpoch = await getEpoch(puzzle);
      if (afterReqEpoch !== reqEpoch || afterReqEpoch !== runEpoch) {
        await info('agent.stale_discarded', { tabId, puzzle, epoch: runEpoch, nowEpoch: afterReqEpoch, stage: 'llm' });
        return;
      }
      if (payload.toolCalls && payload.toolCalls.length) {
        toolsUsed += payload.toolCalls.length;
        messages.push(payload.message);
        for (const tc of payload.toolCalls) {
          if (await getEpoch(puzzle) !== runEpoch) {
            await info('agent.stale_discarded', { tabId, puzzle, epoch: runEpoch, stage: 'tool' });
            return;
          }
          let args = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}
          if (String(tc.function?.name || '').startsWith('board_')) boardActions++;
          shadowEvent(puzzle, E.toolCall, { name: tc.function?.name, args }, { toolId: tc.id, requestId: shadowReq });
          const pipeline = new ToolPipeline({
            execute: async (call) => execTool(puzzle, call.name, call.args, tabId, runEpoch),
          });
          pipeline.usePre(async () => (await getEpoch(puzzle) !== runEpoch ? { rejected: 'stale_session' } : null));
          pipeline.usePost((result) => (result && result.stale ? { rejected: 'stale_tool' } : null));
          const toolRes = await pipeline.run(
            { name: tc.function?.name, args },
            { sessionId: `${puzzle}:${runEpoch}`, stepId: 'step1', requestId: shadowReq, toolId: tc.id || `${shadowReq}:${boardActions}` },
          );
          if (toolRes.rejected) {
            await info('agent.stale_discarded', { tabId, puzzle, epoch: runEpoch, stage: 'tool_pipeline', reason: toolRes.rejected });
            return;
          }
          const out = toolRes.ok ? toolRes.result : { error: toolRes.error };
          shadowEvent(puzzle, E.toolResult, { name: tc.function?.name, ok: !!out?.ok, cell: out?.cell || null, error: out?.error || null, action: tc.function?.name, content: out?.ok ? 'ok' : (out?.error || 'error') }, { toolId: tc.id, requestId: shadowReq });
          if (out?.ok && /^board_(note|place|x|erase)$/.test(String(tc.function?.name))) {
            const rr = Number(args.r), cc = Number(args.c);
            if (rr && cc) actionMarks.set(`${rr},${cc}`, { r: rr, c: cc, label: `R${rr}C${cc}`, kind: tc.function.name === 'board_x' ? 'excl' : tc.function.name === 'board_erase' ? 'ask' : 'cand' });
          }
          if (out && out.stale) {
            await info('agent.stale_discarded', { tabId, puzzle, epoch: runEpoch, stage: 'tool_epoch' });
            return;
          }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
        }
        continue;
      }
      const accepting = /接受|继续|对|同意|开始教学|开始上课/.test(String(userText || ''));
      const correcting = /擦|重标|标错|写错|错了|修正|改一下/.test(String(userText || ''));
      if (mode === 'tutor' && (autoStart || accepting || correcting) && boardActions === 0 && !nudged) {
        nudged = true;
        messages.push({ role: 'assistant', content: payload.text || '（本轮还没有操作盘面）' });
        const nudge = correcting
          ? '学生指出这一步理解错了。请不要只解释：先用 board_erase 擦掉错误笔记，再用 board_note 按正确语义重标，然后回复。'
          : '你刚才只说了，没有真的写盘。请先调用 board_note / board_place / board_x 把这一步操作到盘面上，再回复；marks 只是圈选，不算板书。';
        messages.push({ role: 'user', content: nudge });
        await info('agent.tool_nudge', { tabId, puzzle, mode, autoStart: !!autoStart, accepting, correcting });
        continue;
      }
      rawText = payload.text;
      break;
    }
    if (!rawText) {
      const reqEpoch = await getEpoch(puzzle);
      lastReqEpoch = reqEpoch;
      const payload = await callLLM({ messages: baseMessages, settings: llmSettings, expectJson: false, session: 'ses_' + encodeURIComponent(puzzle).slice(0, 60), puzzle });
      const afterEpoch = await getEpoch(puzzle);
      if (afterEpoch !== reqEpoch || afterEpoch !== runEpoch) {
        await info('agent.stale_discarded', { tabId, puzzle, epoch: runEpoch, nowEpoch: afterEpoch, stage: 'fallback' });
        return;
      }
      rawText = payload.text;
    }
    await info('agent.tools', { tabId, puzzle, toolsUsed, epoch: lastReqEpoch });
    const assistant = await ensureAssistant({ text: rawText, json: extractJson(rawText) });
    let text = tighten(condense(assistant.text), mode);
    if (!userText && (assistant.verdict === 'INVALID' || assistant.verdict === 'VALID')) {
      assistant.verdict = 'GAP';
      text = text.replace(/结论[:：]\s*(INVALID|VALID)/i, '结论：GAP');
    }
    let marks = [...actionMarks.values()];
    let markSource = actionMarks.size ? 'tools' : 'none';
    if (!marks.length && Array.isArray(assistant.marks) && assistant.marks.length) {
      marks = assistant.marks;
      markSource = 'model';
    }
    const markSh = shadows.get(puzzle);
    if (markSh && markSh.marks) {
      const coreMarks = markSh.marks.snapshot();
      if (coreMarks.length) {
        const sig = (list) => list.map((m) => `${m.r},${m.c}:${m.kind || ''}`).sort().join('|');
        if (sig(coreMarks) !== sig(marks)) await info('core.marks.divergence', { puzzle, old: sig(marks), core: sig(coreMarks) });
        marks = coreMarks;
        markSource = 'core';
      }
    }
    await info('agent.marks', { tabId, puzzle, mode, source: markSource, marks });
    if (/不要标注|别标|取消标注|不用标/.test(userText || '')) marks = [];
    if (mode !== 'tutor' && marks.length && !/R\d+C\d+/.test(text)) {
      text += `\n（圈出：${marks.map((m) => `R${m.r}C${m.c}`).join('、')}）`;
    }
    if (await getEpoch(puzzle) !== runEpoch) {
      await info('agent.stale_discarded', { tabId, puzzle, epoch: runEpoch, stage: 'final' });
      return;
    }
    const chat2 = await getChat(puzzle);
    const lastUser = [...chat2].reverse().find((m) => m.role === 'you');
    const resolved = assistant.verdict === 'VALID' || assistant.verdict === 'VALID BUT INCOMPLETE';
    if (resolved) {
      await closeQuestion(puzzle, assistant.verdict);
      shadowEvent(puzzle, E.reviewAccept, { verdict: assistant.verdict });
    } else await markAsked(puzzle);
    const after = await getLedger(puzzle);
    if (userText) await addFact(puzzle, userText, assistant.verdict || null);
    await addChat(puzzle, 'me', text);
    await saveMarks(puzzle, marks);
    await sendToTab(tabId, { type: 'mm:assistant', text, marks, verdict: assistant.verdict, replyTo: lastUser?.ts || null, ts: Date.now(), unresolved: after.counts.unresolved });
    shadowObserveLedger(puzzle, after);
    await info('agent.reply', { tabId, mode, verdict: assistant.verdict, length: assistant.text.length, marks: marks.length, unresolved: after.counts.unresolved });
  } catch (e) {
    if (await getEpoch(puzzle) !== runEpoch) {
      await info('agent.stale_discarded', { tabId, puzzle, epoch: runEpoch, error: e.code || e.message });
      return;
    }
    const text = e.code === 'NO_API_KEY'
      ? '未配置 API Key。'
      : e.code === 'HTTP'
        ? `模型接口返回 HTTP ${e.status}。检查 Key、模型名和 Base URL；详情见日志。`
        : e.code === 'NETWORK'
          ? '连不上模型接口。检查 Base URL、网络或代理；若 Base URL 是自定义域名，扩展还需要该域名的 host_permissions（常见原因）。详情见日志。'
          : '模型返回无法解析。已写入日志，可在设置页下载日志排查。';
    await addChat(puzzle, 'me', text);
    await sendToTab(tabId, { type: 'mm:assistant', text, marks: [], verdict: null, system: true });
    await error('agent.failed', { tabId, code: e.code, message: e.message, detail: e.detail });
  } finally {
    shadowEvent(puzzle, E.stepEnd, { reason: 'done' });
    shadowEvent(puzzle, E.turnEnd, { reason: 'done' });
    await shadowSummary(puzzle);
  }
}

async function handleBoardChanges({ tabId, puzzle, board, changes, clues, title }) {
  const mode = await getMode();
  if (puzzle) chrome.storage.local.set({ [LAST_PUZZLE_KEY]: puzzle });
  await recall(puzzle, { title, clues, board });
  shadowObserveBoard(puzzle, board, changes);
  const remaining = Array.isArray(board) ? board.filter((c) => c.big || (c.notes || []).length || c.x).length : -1;
  const allEmpty = Array.isArray(changes) && changes.length > 0 &&
    changes.every((c) => c.after && !c.after.big && !(c.after.notes || []).length && !c.after.x);
  if (allEmpty && remaining === 0) {
    await bumpEpoch(puzzle);
    await closeAllUnresolved(puzzle, 'board_cleared');
    await clearFacts(puzzle);
    await resetBoardState(puzzle);
    await clearQueue(puzzle);
    await recall(puzzle, { board: [] });
    await addChat(puzzle, 'me', '盘面已清空（站点清除）：清空前的推理作废，不再追问。');
    await sendToTab(tabId, { type: 'mm:pending', unresolved: 0 });
    await info('board.reset', { tabId, puzzle, cells: changes.length });
    return { ok: true, reset: true };
  }
  const led = await recordChanges({ puzzle, changes, source: 'observed' });
  const state = await getLedger(puzzle);
  shadowObserveLedger(puzzle, state);
  await info('ledger.record', { tabId, mode, puzzle, created: led.created, changes: changes?.length || 0, counts: state.counts, cells: led.batch?.changes || [] });
  if (mode !== 'exam') return { ok: true, skipped: 'tutor', ledger: state.counts };
  if (!led.created) return { ok: true, appended: true, ledger: state.counts };
  await runAgent({ tabId, puzzle, board, changes, clues, ledger: ledgerText(state) });
  const after = await getLedger(puzzle);
  if (!after.unresolved.length) await processQueue(puzzle);
  return { ok: true, ledger: state.counts };
}

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    if (details.reason === 'update' || details.reason === 'install') {
      const tabs = await chrome.tabs.query({ url: 'https://murdoku.com/*' });
      for (const t of tabs) {
        try { await chrome.tabs.reload(t.id); } catch (e) {}
      }
    }
  } catch (e) {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id;
    try {
      switch (msg?.type) {
        case 'mm:hello': {
          try {
            const flags = await chrome.storage.local.get(['mm_core_shadow', 'mm_core_chat', 'mm_core_queue']);
            shadowEnabled = flags.mm_core_shadow !== false;
            coreChatEnabled = flags.mm_core_chat !== false;
            coreQueueEnabled = flags.mm_core_queue === true;
          } catch (e) {}
          const [settings, mode, ledgerState] = await Promise.all([getSettings(), getMode(), getLedger(msg.puzzle)]);
          let chat = await getChat(msg.puzzle);
          if (msg.puzzle) chrome.storage.local.set({ [LAST_PUZZLE_KEY]: msg.puzzle });
          await recall(msg.puzzle, { title: msg.title, clues: msg.clues, board: msg.board });
          await ensurePrep(msg.puzzle, msg.board, msg.clues, settings);
          const helloEpoch = await getEpoch(msg.puzzle);
          await sendToTab(tabId, { type: 'mm:epoch', epoch: helloEpoch });
          const restored = await shadowRestoreFromStore(msg.puzzle, msg.board, chat);
          if (restored) {
            chat = await getChat(msg.puzzle);
          } else {
            shadowStart(msg.puzzle, { board: msg.board, chat, title: msg.title });
            shadowSeedQueue(msg.puzzle, await loadQueue(msg.puzzle));
          }
          sessionMachines.set(msg.puzzle, initSession({ phase: PHASE.active, sessionId: msg.puzzle + ':hello' }));
          sendResponse({ ok: true, epoch: helloEpoch, settings: { ...settings, apiKey: settings.apiKey ? '«saved»' : '' }, mode, chat, ledger: ledgerState });
          await info('content.hello', { tabId, puzzle: msg.puzzle, hasKey: !!settings.apiKey, mode });
          break;
        }
        case 'mm:save-settings': {
          const next = await saveSettings(msg.settings || {});
          sendResponse({ ok: true, settings: { ...next, apiKey: next.apiKey ? '«saved»' : '' } });
          break;
        }
        case 'mm:get-settings': {
          const cur = await getSettings(); sendResponse({ settings: { ...cur, apiKey: cur.apiKey ? '«saved»' : '' }, mode: await getMode() });
          break;
        }
        case 'mm:set-mode': {
          const mode = await setMode(msg.mode);
          sendResponse({ ok: true, mode });
          break;
        }
        case 'mm:board-changes': {
          const puzzle = msg.puzzle || 'unknown';
          const gate = await getLedger(puzzle);
          if (gate.unresolved.length) {
            const n = await enqueueBoard(puzzle, { tabId, puzzle, board: msg.board, changes: msg.changes, clues: msg.clues, title: msg.title });
            await info('board.queued', { tabId, puzzle, changes: msg.changes?.length || 0, queue: n });
            sendResponse({ ok: true, queued: true, queue: n });
            break;
          }
          const result = await handleBoardChanges({ tabId, puzzle, board: msg.board, changes: msg.changes, clues: msg.clues, title: msg.title });
          sendResponse(result || { ok: true });
          break;
        }
        case 'mm:user-message': {
          const puzzle = msg.puzzle || 'unknown';
          await recall(puzzle, { title: msg.title, clues: msg.clues, board: msg.board });
          await addFact(puzzle, msg.text);
          const q = await answerQuestion(puzzle, msg.text);
          const state = await getLedger(puzzle);
          await info('ledger.answer', { tabId, puzzle, question: q?.id || null, answer: msg.text, counts: state.counts });
          sendResponse({ ok: true });
          await runAgent({
            tabId, puzzle,
            board: msg.board,
            changes: msg.changes || [],
            clues: msg.clues,
            userText: msg.text,
            ledger: ledgerText(state),
          });
          const after = await getLedger(puzzle);
          if (!after.unresolved.length) await processQueue(puzzle);
          break;
        }
        case 'mm:clear': {
          const puzzle = msg.puzzle || 'unknown';
          await bumpEpoch(puzzle);
          await clearQueue(puzzle);
          await closeAllUnresolved(puzzle, 'board_cleared');
          await clearFacts(puzzle);
          await resetBoardState(puzzle);
          await addChat(puzzle, 'you', '/clear');
          await addChat(puzzle, 'me', msg.remaining === 0 ? '已清空盘面：放置 / 笔记 / X 全部清除。清空前的推理不再追问。' : `清空未完成：盘面还剩 ${msg.remaining ?? '?'} 格。`);
          await info('board.clear', { tabId, puzzle, remaining: msg.remaining, reset: true });
          sendResponse({ ok: true });
          break;
        }
        case 'mm:event-log': {
          const key = shadowEventKey(msg.puzzle || 'unknown');
          const { [key]: events = [] } = await chrome.storage.local.get(key);
          sendResponse({ ok: true, count: events.length, last: events.slice(-3).map((e) => ({ type: e.type, ts: e.ts, seq: e.seq })) });
          break;
        }
        case 'mm:core-queue': {
          const cur = await chrome.storage.local.get('mm_core_queue');
          const on = msg.on == null ? !cur.mm_core_queue : !!msg.on;
          await chrome.storage.local.set({ mm_core_queue: on });
          coreQueueEnabled = on;
          if (on) shadowSeedQueue(msg.puzzle || 'unknown', await loadQueue(msg.puzzle || 'unknown'));
          await info('core.queue.toggle', { tabId, on });
          sendResponse({ ok: true, on });
          break;
        }
        case 'mm:core-chat': {
          const cur = await chrome.storage.local.get('mm_core_chat');
          const on = msg.on == null ? !cur.mm_core_chat : !!msg.on;
          await chrome.storage.local.set({ mm_core_chat: on });
          coreChatEnabled = on;
          await info('core.chat.toggle', { tabId, on });
          sendResponse({ ok: true, on });
          break;
        }
        case 'mm:teacher-action': {
          sendResponse({ ok: true });
          break;
        }
        case 'mm:clear-done': {
          const pz = msg.puzzle || 'unknown';
          const r = sessionDispatch(pz, 'clear/boardDone', { token: msg.token });
          sendResponse({ ok: !r.rejected, error: r.rejected ? r.rejected.reason : null, remaining: msg.remaining ?? null });
          break;
        }
        case 'mm:clear-start': {
          const pz = msg.puzzle || 'unknown';
          const clearToken = String(Date.now());
          const clearGate = sessionDispatch(pz, 'clear/request', { token: clearToken });
          if (clearGate.rejected) { sendResponse({ ok: false, error: clearGate.rejected.reason }); break; }
          const ce = await bumpEpoch(pz);
          await clearQueue(pz);
          await closeAllUnresolved(pz, 'board_cleared');
          await resetBoardState(pz);
          shadowStart(pz, { board: [], chat: await getChat(pz), title: 'cleared' });
          if (tabId) await sendToTab(tabId, { type: 'mm:epoch', epoch: ce });
          await info('clear.start', { tabId, puzzle: pz, epoch: ce });
          sendResponse({ ok: true, epoch: ce, token: clearToken });
          break;
        }
        case 'mm:reload-extension': {
          sendResponse({ ok: true });
          setTimeout(() => { try { chrome.runtime.reload(); } catch (e) {} }, 120);
          break;
        }
        case 'mm:epoch-bump': {
          const epoch = await bumpEpoch(msg.puzzle || 'unknown');
          sendResponse({ ok: true, epoch });
          break;
        }
        case 'mm:board-sync': {
          const puzzle = msg.puzzle || 'unknown';
          await recall(puzzle, { title: msg.title, clues: msg.clues, board: msg.board });
          const settings = await getSettings();
          await ensurePrep(puzzle, msg.board, msg.clues, settings);
          shadowSyncBoard(puzzle, msg.board, await getChat(puzzle));
          sendResponse({ ok: true });
          break;
        }
        case 'mm:get-react': {
          if (!tabId) { sendResponse({ ok: false, error: 'no_tab' }); break; }
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
              const cells = [...document.querySelectorAll('[data-cell-index]')];
              let sawFiber = false;
              for (const cell of cells) {
                const fk = Object.keys(cell).find((k) => k.startsWith('__reactFiber$'));
                if (!fk) continue;
                sawFiber = true;
                let f = cell[fk];
                for (let d = 0; f && d < 18; d++, f = f.return) {
                  const p = f.memoizedProps || {};
                  if (p.puzzle && p.objIdByIndex && p.roomIdByIndex) {
                    const pz = p.puzzle;
                    return { names: pz.objectNameByIndex || [], roomLabels: pz.roomLabels || [], roomIds: p.roomIdByIndex, suspects: (pz.suspects || p.suspects || []).map((x) => ({ name: x.name, symbol: x.symbol, clue: x.clue })) };
                  }
                }
              }
              return { debug: true, cells: cells.length, sawFiber };
            },
          });
          const raw = results?.[0]?.result || null;
          const data = raw && Array.isArray(raw.names) ? raw : null;
          await info('react.board.read', { tabId, ok: !!data, objects: data ? (data.names || []).filter(Boolean).length : 0, cells: raw?.cells ?? null, sawFiber: raw?.sawFiber ?? null });
          sendResponse({ ok: !!data, data: data || raw });
          break;
        }
        case 'mm:new-session': {
          const puzzle = msg.puzzle || 'unknown';
          await bumpEpoch(puzzle);
          await clearQueue(puzzle);
          await clearChat(puzzle);
          await clearLedger(puzzle);
          await clearFacts(puzzle);
          await resetBoardState(puzzle);
          await recall(puzzle, { title: msg.title, clues: msg.clues, board: msg.board });
          shadowStart(puzzle, { board: msg.board, chat: [], title: msg.title });
          const settings = await getSettings();
          await ensurePrep(puzzle, msg.board, msg.clues, settings);
          if (msg.clearLogs) await clearLogs();
          const newToken = String(Date.now());
          const newGate = sessionDispatch(puzzle, 'new/request', { token: newToken });
          if (newGate.rejected) { sendResponse({ ok: false, error: newGate.rejected.reason }); break; }
          const newEpoch = await getEpoch(puzzle);
          await sendToTab(tabId, { type: 'mm:epoch', epoch: newEpoch });
          const welcome = '新会话已开始：聊天记录、账本和旧上下文已清空；盘面保留。' + (msg.clearLogs ? ' 日志已清空。' : '');
          await addChat(puzzle, 'me', welcome);
          const mode = await getMode();
          await sendToTab(tabId, { type: 'mm:pending', unresolved: 0 });
          const boardClean = Array.isArray(msg.board) && msg.board.length && !msg.board.some((c) => c.big || (c.notes || []).length || c.x);
          sessionDispatch(puzzle, 'new/started', { token: newToken, sessionId: puzzle + ':' + newEpoch });
          if (mode === 'tutor' && boardClean) {
            await new Promise((r) => setTimeout(r, 2000));
            sessionDispatch(puzzle, 'auto/started', {});
            await runAgent({ tabId, puzzle, board: msg.board, clues: msg.clues, changes: [], userText: null, ledger: await getLedger(puzzle), autoStart: true });
          }
          await shadowSummary(puzzle);
          await info('session.new', { tabId, puzzle, clearLogs: !!msg.clearLogs });
          sendResponse({ ok: true, mode, epoch: newEpoch, chat: await getChat(puzzle), ledger: await getLedger(puzzle) });
          break;
        }
        case 'mm:get-logs': {
          sendResponse({ ok: true, logs: await getLogs({ level: msg.level, limit: msg.limit }) });
          break;
        }
        case 'mm:clear-logs': {
          await clearLogs();
          await info('logs.cleared', { by: 'options' });
          sendResponse({ ok: true });
          break;
        }
        case 'mm:stats': {
          sendResponse({ ok: true, stats: await stats() });
          break;
        }
        case 'mm:test-llm': {
          try {
            const settings = await getSettings();
            const out = await callLLM({
              messages: [{ role: 'user', content: '只回复两个字母：OK' }],
              settings, expectJson: false, timeoutMs: 25000, session: 'ses_mm-test', puzzle: 'test',
            });
            sendResponse({ ok: true, text: out.text.slice(0, 200) });
          } catch (e) {
            sendResponse({ ok: false, code: e.code, message: e.message, detail: e.detail });
          }
          break;
        }
        case 'mm:client-log': {
          await info('client.' + (msg.event || 'unknown'), { ...(msg.data || {}), tabId });
          sendResponse({ ok: true });
          break;
        }
        case 'mm:open-options': {
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        }
        case 'mm:get-ledger': {
          let p = msg.puzzle;
          if (!p) { const { [LAST_PUZZLE_KEY]: last } = await chrome.storage.local.get(LAST_PUZZLE_KEY); p = last; }
          sendResponse({ ok: true, ledger: await getLedger(p), puzzle: p });
          break;
        }
        case 'mm:close-ledger': {
          let p = msg.puzzle;
          if (!p) { const { [LAST_PUZZLE_KEY]: last } = await chrome.storage.local.get(LAST_PUZZLE_KEY); p = last; }
          const n = await closeAllUnresolved(p);
          const state = await getLedger(p);
          await info('ledger.closed_all', { puzzle: p, closed: n, counts: state.counts });
          try { const tabs = await chrome.tabs.query({ url: 'https://murdoku.com/*' }); for (const t of tabs) await sendToTab(t.id, { type: 'mm:pending', unresolved: state.counts.unresolved }); } catch (e) { await warn('tabs.query_failed', { message: e.message }); }
          sendResponse({ ok: true, closed: n, counts: state.counts });
          break;
        }
        case 'mm:clear-ledger': {
          let p = msg.puzzle;
          if (!p) { const { [LAST_PUZZLE_KEY]: last } = await chrome.storage.local.get(LAST_PUZZLE_KEY); p = last; }
          await clearLedger(p);
          await info('ledger.cleared', { puzzle: p });
          try { const tabs = await chrome.tabs.query({ url: 'https://murdoku.com/*' }); for (const t of tabs) await sendToTab(t.id, { type: 'mm:pending', unresolved: 0 }); } catch (e) { await warn('tabs.query_failed', { message: e.message }); }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown_type' });
      }
    } catch (e) {
      await error('background.message_failed', { type: msg?.type, message: e.message, stack: e.stack });
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await info('extension.installed', { reason: details.reason, version: chrome.runtime.getManifest().version });
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => info('extension.startup', { version: chrome.runtime.getManifest().version }));
