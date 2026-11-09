import { Session } from './session.js';
import { E } from './events.js';
import { SessionProjections } from './projections/host.js';
import { BoardProjection } from './projections/board.js';
import { ChatProjection } from './projections/chat.js';
import { MarksProjection } from './projections/marks.js';
import { QueueProjection } from './projections/queue.js';
import { LedgerProjection } from './projections/ledger.js';
import { TurnProjection } from './projections/turn.js';

function normBoard(board = []) {
  return board
    .filter((c) => c && (c.big || (c.notes || []).length || c.x))
    .map((c) => `${c.r},${c.c}:${c.big || ''}|${(c.notes || []).join('')}|${c.x ? 1 : 0}`)
    .sort()
    .join('\n');
}

function chatRole(role) {
  return role === 'you' || role === 'user' ? 'user' : 'assistant';
}

function normChat(chat = []) {
  return chat.map((m) => `${chatRole(m.role)}:${m.text || ''}`).join('\n');
}

/**
 * Phase 2 shadow：把旧链路的事实镜像进新 core，只对比/记日志，不影响产品。
 */
export class ShadowCore {
  constructor(puzzle, { now = () => Date.now(), onDivergence = null } = {}) {
    this.puzzle = puzzle;
    this.now = now;
    this.onDivergence = onDivergence;
    this.session = null;
    this.queueSeeded = false;
    this.host = null;
    this.board = null;
    this.chat = null;
    this.marks = null;
    this.queue = null;
    this.ledger = null;
    this.turn = null;
  }

  _append(type, payload = {}, meta = {}) {
    const e = this.session.append(type, payload, meta);
    this.host.apply(e);
    return e;
  }

  ensure() {
    if (this.session && this.session.status === 'active') return this.session;
    this.start({});
    return this.session;
  }

  start({ board = [], chat = [], title = '' } = {}) {
    if (this.session && this.session.status === 'active') this.session.end('restart');
    this.queueSeeded = false;
    this.session = new Session(`shadow:${this.puzzle}:${this.now()}`, { now: this.now });
    this.host = new SessionProjections();
    this.board = this.host.register('board', new BoardProjection());
    this.chat = this.host.register('chat', new ChatProjection());
    this.marks = this.host.register('marks', new MarksProjection());
    this.queue = this.host.register('queue', new QueueProjection());
    this.ledger = this.host.register('ledger', new LedgerProjection());
    this.turn = this.host.register('turn', new TurnProjection());
    this._append(E.sessionStart, { title, puzzle: this.puzzle });
    this._append(E.boardSnapshot, { cells: board });
    for (const m of chat || []) {
      this._append(chatRole(m.role) === 'user' ? E.userMessage : E.assistantMessage, {
        text: m.text || '',
        system: !!m.system,
      });
    }
    this.compareBoard(board, 'start');
    this.compareChat(chat, 'start');
    return this;
  }

  appendEvent(type, payload = {}, meta = {}) {
    this.ensure();
    return this._append(type, payload, meta);
  }

  turnStart({ text = '', mode = '' } = {}) {
    return this.appendEvent(E.turnStart, { text, mode });
  }

  stepStart({ no = 1 } = {}) {
    return this.appendEvent(E.stepStart, { no });
  }

  llmRequest({ requestId = null, round = 0, messageCount = 0 } = {}) {
    return this.appendEvent(E.llmRequest, { round, messageCount }, { requestId });
  }

  llmResponse({ requestId = null, toolCalls = 0, textLength = 0, status = 'ok' } = {}) {
    return this.appendEvent(E.llmResponse, { toolCalls, textLength, status }, { requestId });
  }

  toolCall({ toolId = null, requestId = null, name = '', args = {} } = {}) {
    return this.appendEvent(E.toolCall, { name, args }, { toolId, requestId });
  }

  toolResult({ toolId = null, requestId = null, name = '', ok = false, cell = null, error = null } = {}) {
    return this.appendEvent(E.toolResult, { name, ok, cell, error, action: name, content: ok ? 'ok' : (error || 'error') }, { toolId, requestId });
  }

  stepEnd({ reason = 'done' } = {}) {
    return this.appendEvent(E.stepEnd, { reason });
  }

  turnEnd({ reason = 'done' } = {}) {
    return this.appendEvent(E.turnEnd, { reason });
  }

  end(reason = 'ended') {
    if (this.session) { const e = this.session.end(reason); if (e) this.host.apply(e); }
  }

  queueEnqueue(batch) {
    this.ensure();
    return this._append(E.queueEnqueue, { batch });
  }

  queueDequeue(id = null) {
    this.ensure();
    return this._append(E.queueDequeue, { id });
  }

  queueExpire({ all = false, ids = [] } = {}) {
    this.ensure();
    return this._append(E.queueExpire, { all, ids });
  }

  observeQueue(batches = []) {
    this.ensure();
    return this.compareQueue(batches);
  }

  compareQueue(batches = []) {
    const norm = (q) => (q || []).map((b) => (b.changes || []).map((c) => `${c.r},${c.c}:${c.after?.big || ''}|${(c.after?.notes || []).join('')}|${c.after?.x ? 1 : 0}`).sort().join(',')).sort().join('\n');
    const expected = norm(batches);
    const actual = norm(this.queue ? this.queue.snapshot() : []);
    if (expected === actual) return true;
    this.onDivergence?.({ kind: 'queue', puzzle: this.puzzle, expected: expected.slice(0, 2000), actual: actual.slice(0, 2000) });
    return false;
  }

  observeLedger(ledger = null) {
    this.ensure();
    const oldUnresolved = Array.isArray(ledger?.unresolved) ? ledger.unresolved.length : (ledger?.counts?.unresolved || 0);
    const coreUnresolved = this.ledger ? this.ledger.unresolved().length : 0;
    if (oldUnresolved !== coreUnresolved) {
      this.onDivergence?.({ kind: 'ledger', puzzle: this.puzzle, expected: String(oldUnresolved), actual: String(coreUnresolved) });
      return false;
    }
    return true;
  }

  appendChat(role, text) {
    this.ensure();
    const type = chatRole(role) === 'user' ? E.userMessage : E.assistantMessage;
    this._append(type, { text: text || '' });
  }

  observeBoard(board = [], changes = []) {
    this.ensure();
    if (Array.isArray(changes) && changes.length) {
      this._append(E.boardDiff, { changes });
    }
    this.compareBoard(board, 'observe');
  }

  observeChat(chat = []) {
    this.ensure();
    this.compareChat(chat, 'observe');
  }

  compareBoard(board = [], stage = '') {
    const actual = normBoard(board);
    const projected = normBoard(this.board ? this.board.snapshot() : []);
    if (actual === projected) return true;
    this.onDivergence?.({
      kind: 'board', stage, puzzle: this.puzzle,
      expected: actual.slice(0, 2000), actual: projected.slice(0, 2000),
    });
    // 重新同步 shadow，避免一次 divergence 后连续误报；真实状态仍以旧链路为准。
    this._append(E.boardSnapshot, { cells: board });
    return false;
  }

  compareChat(chat = [], stage = '') {
    const expected = normChat(chat);
    const projected = normChat(this.chat ? this.chat.snapshot() : []);
    if (expected === projected) return true;
    this.onDivergence?.({
      kind: 'chat', stage, puzzle: this.puzzle,
      expected: expected.slice(0, 2000), actual: projected.slice(0, 2000),
    });
    return false;
  }

  snapshot() {
    return {
      puzzle: this.puzzle,
      session: this.session ? this.session.snapshot() : null,
      board: this.board ? this.board.snapshot().length : 0,
      chat: this.chat ? this.chat.snapshot().length : 0,
      marks: this.marks ? this.marks.snapshot().length : 0,
      turnSteps: (() => { if (!this.turn) return 0; const t = this.turn.snapshot(); return t.turns.length ? t.turns[t.turns.length - 1].steps.length : 0; })(),
      audit: this.session ? this.session.audit() : [],
    };
  }
}
