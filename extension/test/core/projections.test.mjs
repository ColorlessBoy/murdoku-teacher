import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardProjection } from '../../src/core/projections/board.js';
import { ChatProjection } from '../../src/core/projections/chat.js';
import { MarksProjection } from '../../src/core/projections/marks.js';
import { E, COMMITTED, EXPIRED } from '../../src/core/events.js';
import { Session } from '../../src/core/session.js';

const ev = (type, payload = {}, meta = {}) => ({
  id: meta.id || `${type}:${Math.random()}`,
  type, payload, sessionId: 's1', stepId: meta.stepId || null,
  requestId: null, toolId: meta.toolId || null, cause: null, seq: meta.seq || 1,
  ts: 1000, status: meta.status || COMMITTED, ttl: 0, reason: null,
});

test('board projection applies snapshot and diff, ignores expired', () => {
  const p = new BoardProjection();
  p.apply(ev(E.boardSnapshot, { cells: [{ r: 3, c: 4, notes: ['B'] }] }));
  assert.deepEqual(p.get(3, 4).notes, ['B']);
  p.apply(ev(E.boardDiff, { changes: [{ r: 3, c: 4, after: { notes: ['B', 'D'] } }, { r: 5, c: 3, after: { notes: ['H'] } }] }));
  assert.deepEqual(p.get(3, 4).notes, ['B', 'D']);
  assert.deepEqual(p.get(5, 3).notes, ['H']);
  p.apply(ev(E.boardDiff, { changes: [{ r: 6, c: 7, after: { x: true } }] }, { status: EXPIRED }));
  assert.equal(p.get(6, 7), null);
  p.apply(ev(E.sessionEnd, {}));
  assert.equal(p.snapshot().length, 0);
});

test('chat projection only includes committed messages', () => {
  const p = new ChatProjection();
  p.apply(ev(E.userMessage, { text: 'hi' }));
  p.apply(ev(E.assistantMessage, { text: 'old' }, { status: EXPIRED }));
  p.apply(ev(E.assistantMessage, { text: 'hello' }));
  assert.deepEqual(p.snapshot().map((m) => [m.role, m.text]), [['user', 'hi'], ['assistant', 'hello']]);
});

test('marks come from committed board tool results and clear on step end', () => {
  const p = new MarksProjection();
  p.apply(ev(E.toolResult, { ok: true, action: 'board_note', cell: { r: 3, c: 4 } }, { toolId: 't1', stepId: 'st1' }));
  p.apply(ev(E.toolResult, { ok: true, action: 'board_x', cell: { r: 6, c: 7 } }, { toolId: 't2', stepId: 'st1' }));
  p.apply(ev(E.toolResult, { ok: true, action: 'board_note', cell: { r: 9, c: 9 } }, { toolId: 't3', status: EXPIRED }));
  assert.deepEqual(p.snapshot().map((m) => [m.r, m.c, m.kind]), [[3, 4, 'cand'], [6, 7, 'excl']]);
  p.apply(ev(E.stepEnd, {}));
  assert.deepEqual(p.snapshot(), []);
});

test('replay drives projections deterministically', () => {
  const s = new Session('s1', { now: () => 1000 });
  s.append(E.boardSnapshot, { cells: [{ r: 3, c: 4, notes: ['B'] }] });
  s.append(E.userMessage, { text: 'hi' });
  s.append(E.assistantMessage, { text: 'hello' });
  s.append(E.toolCall, { name: 'board_note' }, { toolId: 't1', stepId: 'st1' });
  s.append(E.toolResult, { ok: true, action: 'board_note', cell: { r: 3, c: 4 } }, { toolId: 't1', stepId: 'st1' });

  const board = new BoardProjection();
  const chat = new ChatProjection();
  const marks = new MarksProjection();
  for (const e of s.events) { board.apply(e); chat.apply(e); marks.apply(e); }

  const r = Session.replay('r', s.events, { now: () => 1000 });
  assert.deepEqual(r.deriveMessages(), s.deriveMessages());
  assert.deepEqual(board.get(3, 4).notes, ['B']);
  assert.deepEqual(chat.snapshot().map((m) => m.text), ['hi', 'hello']);
  assert.deepEqual(marks.snapshot().map((m) => [m.r, m.c]), [[3, 4]]);
});

test('board diff preserves static area/object fields', () => {
  const b = new BoardProjection();
  b.apply({ type: E.boardSnapshot, status: COMMITTED, payload: { cells: [{ r: 3, c: 4, area: '沙地', objName: '椅子', notes: ['B'] }] } });
  b.apply({ type: E.boardDiff, status: COMMITTED, payload: { changes: [{ r: 3, c: 4, after: { notes: ['E'] } }] } });
  const c = b.get(3, 4);
  assert.equal(c.area, '沙地');
  assert.equal(c.objName, '椅子');
  assert.deepEqual(c.notes, ['E']);
});
