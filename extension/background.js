import { info, warn, error, getLogs, clearLogs, stats } from './src/log.js';
import { callLLM, normalizeSettings, extractJson } from './src/llm.js';
import { recall, loadState, addFact, buildBrief, clearFacts, resetBoardState, saveMarks, savePrep, savePrepStatus } from './src/state.js';
import { prepare } from './src/prep.js';
import { mergeBatches } from './src/queue.js';
import { tighten, condense } from './src/format.js';
import { TOOL_DEFS, execTool } from './src/tools.js';
import { buildMessages } from './src/prompt.js';
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
  const q = mergeBatches(await loadQueue(puzzle));
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
  return q.length;
}

async function clearQueue(puzzle) {
  await chrome.storage.local.remove(queueKey(puzzle));
}

async function processQueue(puzzle) {
  const q = mergeBatches(await loadQueue(puzzle));
  await saveQueue(puzzle, q);
  if (!q.length) return;
  const led = await getLedger(puzzle);
  if (led.unresolved.length) return;
  const next = q.shift();
  await saveQueue(puzzle, q);
  await info('board.dequeue', { puzzle, remaining: q.length });
  await handleBoardChanges(next);
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

const prepBusy = new Set();

async function ensurePrep(puzzle, board, clues, settings) {
  if (!settings?.apiKey || !Array.isArray(board) || !board.length || prepBusy.has(puzzle)) return;
  const st = await loadState(puzzle);
  if (st.prep) return;
  const age = Date.now() - (st.prepAt || 0);
  if (st.prepStatus === 'running' && age < 120000) return;
  if (st.prepStatus === 'failed' && age < 60000) return;
  prepBusy.add(puzzle);
  await savePrepStatus(puzzle, 'running');
  await info('prep.start', { puzzle, board: board.length, clues: String(clues || '').length });
  try {
    const prep = await prepare({ puzzle, board, clues, settings });
    if (prep) {
      await savePrep(puzzle, prep);
      await info('prep.done', { puzzle, chain: (prep.chain || []).length, solution: (prep.solution || []).length });
    } else {
      await savePrepStatus(puzzle, 'failed');
      await warn('prep.empty', { puzzle });
    }
  } catch (e) {
    await savePrepStatus(puzzle, 'failed');
    await warn('prep.failed', { puzzle, code: e.code, message: e.message });
  } finally {
    prepBusy.delete(puzzle);
  }
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

async function runAgent({ tabId, puzzle, board, changes, userText, clues, ledger }) {
  const epoch = await getEpoch(puzzle);
  let tab = null; try { tab = await chrome.tabs.get(tabId); } catch (e) {}
  if (!tab) { await warn('agent.tab_gone', { tabId, puzzle }); return; }
  const mode = await getMode();
  const settings = await getSettings();
  const chat = await getChat(puzzle);
  if (settings.apiKey) ensurePrep(puzzle, board, clues, settings);
  if (userText) await addChat(puzzle, 'you', userText);
  const live = await readLiveBoard(tabId, puzzle);
  const boardNow = (live && Array.isArray(live.board) && live.board.length) ? live.board : board;
  const cluesNow = (live && Array.isArray(live.clues)) ? live.clues : clues;
  const ledState = await getLedger(puzzle);
  const focusQ = (ledState.unresolved || []).slice(-1)[0];
  const focus = focusText(focusQ, boardNow);
  const puzzleType = /minigolf|高尔夫/i.test(String(puzzle)) ? 'minigolf' : 'murdoku';
  const st = await loadState(puzzle);
  const chatNow = await getChat(puzzle);
  const brief = buildBrief(st, { focus, ledger, userText, chat: chatNow });
  const messages = buildMessages({ mode, brief, userText, puzzle });
  await info('agent.run', { tabId, mode, puzzle, changes: changes?.length || 0, boardCells: boardNow.length, userText: userText || null, hasKey: !!settings.apiKey });

  if (!settings.apiKey) {
    const text = '还没有配置 API Key。点侧栏右上角 ⚙ 打开设置，填入 Key（支持任意 OpenAI 兼容端点）。';
    await addChat(puzzle, 'me', text);
    await sendToTab(tabId, { type: 'mm:assistant', text, marks: [], verdict: null, system: true });
    await warn('agent.no_key', { tabId });
    return;
  }

  try {
    const baseMessages = messages;
    let rawText = '';
    let toolsUsed = 0;
    let useTools = true;
    for (let round = 0; round < 3; round++) {
      let payload;
      try {
        payload = await callLLM({
          messages, settings, expectJson: false,
          session: 'ses_' + encodeURIComponent(puzzle).slice(0, 60), puzzle,
          tools: useTools ? TOOL_DEFS : null,
        });
      } catch (e) {
        if (useTools) {
          useTools = false;
          await warn('agent.tools_fallback', { code: e.code, message: e.message });
          continue;
        }
        throw e;
      }
      if (payload.toolCalls && payload.toolCalls.length) {
        toolsUsed += payload.toolCalls.length;
        messages.push(payload.message);
        for (const tc of payload.toolCalls) {
          let args = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}
          const out = await execTool(puzzle, tc.function?.name, args);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
        }
        continue;
      }
      rawText = payload.text;
      break;
    }
    if (!rawText) {
      const payload = await callLLM({ messages: baseMessages, settings, expectJson: false, session: 'ses_' + encodeURIComponent(puzzle).slice(0, 60), puzzle });
      rawText = payload.text;
    }
    await info('agent.tools', { tabId, puzzle, toolsUsed, epoch });
    const nowEpoch = await getEpoch(puzzle);
    if (nowEpoch !== epoch) {
      await info('agent.stale_discarded', { tabId, puzzle, epoch, nowEpoch });
      return;
    }
    const assistant = await ensureAssistant({ text: rawText, json: extractJson(rawText) });
    let text = tighten(condense(assistant.text), mode);
    if (!userText && (assistant.verdict === 'INVALID' || assistant.verdict === 'VALID')) {
      assistant.verdict = 'GAP';
      text = text.replace(/结论[:：]\s*(INVALID|VALID)/i, '结论：GAP');
    }
    let marks = Array.isArray(assistant.marks) ? assistant.marks : [];
    if (!marks.length) {
      const found = [...new Set(text.match(/R\d+C\d+/g) || [])].slice(0, 5).map((s) => {
        const m = s.match(/R(\d+)C(\d+)/);
        return { r: Number(m[1]), c: Number(m[2]), label: s, kind: 'ask' };
      });
      marks = found;
      if (!marks.length && focusQ) marks = (focusQ.cells || []).slice(-3).map((c) => ({ r: c.r, c: c.c, label: `R${c.r}C${c.c}`, kind: 'ask' }));
    }
    if (/不要标注|别标|取消标注|不用标/.test(userText || '')) marks = [];
    if (marks.length && !/R\d+C\d+/.test(text)) {
      text += `\n（圈出：${marks.map((m) => `R${m.r}C${m.c}`).join('、')}）`;
    }
    const chat2 = await getChat(puzzle);
    const lastUser = [...chat2].reverse().find((m) => m.role === 'you');
    const resolved = assistant.verdict === 'VALID' || assistant.verdict === 'VALID BUT INCOMPLETE';
    if (resolved) await closeQuestion(puzzle, assistant.verdict);
    else await markAsked(puzzle);
    const after = await getLedger(puzzle);
    if (userText) await addFact(puzzle, userText, assistant.verdict || null);
    await addChat(puzzle, 'me', text);
    await saveMarks(puzzle, marks);
    await sendToTab(tabId, { type: 'mm:assistant', text, marks, verdict: assistant.verdict, replyTo: lastUser?.ts || null, ts: Date.now(), unresolved: after.counts.unresolved });
    await info('agent.reply', { tabId, mode, verdict: assistant.verdict, length: assistant.text.length, marks: assistant.marks.length, unresolved: after.counts.unresolved });
  } catch (e) {
    if (await getEpoch(puzzle) !== epoch) {
      await info('agent.stale_discarded', { tabId, puzzle, epoch, error: e.code || e.message });
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
  }
}

async function handleBoardChanges({ tabId, puzzle, board, changes, clues, title }) {
  const mode = await getMode();
  if (puzzle) chrome.storage.local.set({ [LAST_PUZZLE_KEY]: puzzle });
  await recall(puzzle, { title, clues, board });
  getSettings().then((settings) => ensurePrep(puzzle, board, clues, settings));
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
          const [settings, mode, chat, ledgerState] = await Promise.all([getSettings(), getMode(), getChat(msg.puzzle), getLedger(msg.puzzle)]);
          if (msg.puzzle) chrome.storage.local.set({ [LAST_PUZZLE_KEY]: msg.puzzle });
          await recall(msg.puzzle, { title: msg.title, clues: msg.clues, board: msg.board });
          ensurePrep(msg.puzzle, msg.board, msg.clues, settings);
          sendResponse({ ok: true, settings: { ...settings, apiKey: settings.apiKey ? '«saved»' : '' }, mode, chat, ledger: ledgerState });
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
          getSettings().then((settings) => ensurePrep(puzzle, msg.board, msg.clues, settings));
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
          getSettings().then((settings) => ensurePrep(puzzle, msg.board, msg.clues, settings));
          if (msg.clearLogs) await clearLogs();
          const welcome = '新会话已开始：聊天记录、账本和旧上下文已清空；盘面保留。' + (msg.clearLogs ? ' 日志已清空。' : '');
          await addChat(puzzle, 'me', welcome);
          const mode = await getMode();
          await sendToTab(tabId, { type: 'mm:pending', unresolved: 0 });
          await info('session.new', { tabId, puzzle, clearLogs: !!msg.clearLogs });
          sendResponse({ ok: true, mode, chat: await getChat(puzzle), ledger: await getLedger(puzzle) });
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
