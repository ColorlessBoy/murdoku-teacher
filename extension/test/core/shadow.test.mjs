import test from 'node:test';
import assert from 'node:assert/strict';
import { ShadowCore } from '../../src/core/shadow.js';
import { E, COMMITTED } from '../../src/core/events.js';

test('shadow matches board and chat', () => {
  const divergences = [];
  const s = new ShadowCore('p1', { now: () => 1000, onDivergence: (d) => divergences.push(d) });
  s.start({ board: [{ r: 3, c: 4, notes: ['B'] }], chat: [{ role: 'you', text: 'hi' }, { role: 'me', text: 'hello' }] });
  s.observeBoard([{ r: 3, c: 4, notes: ['B', 'D'] }], [{ r: 3, c: 4, after: { r: 3, c: 4, notes: ['B', 'D'] } }]);
  s.appendChat('me', 'next');
  s.observeChat([{ role: 'you', text: 'hi' }, { role: 'me', text: 'hello' }, { role: 'me', text: 'next' }]);
  assert.deepEqual(divergences, []);
  assert.equal(s.snapshot().board, 1);
  assert.equal(s.snapshot().chat, 3);
});

test('shadow reports board divergence and resyncs', () => {
  const divergences = [];
  const s = new ShadowCore('p1', { now: () => 1000, onDivergence: (d) => divergences.push(d) });
  s.start({ board: [{ r: 3, c: 4, notes: ['B'] }] });
  s.observeBoard([{ r: 5, c: 3, notes: ['H'] }], []);
  assert.equal(divergences.length, 1);
  assert.equal(divergences[0].kind, 'board');
  s.observeBoard([{ r: 5, c: 3, notes: ['H'] }], []);
  assert.equal(divergences.length, 1);
});

test('shadow reports chat divergence', () => {
  const divergences = [];
  const s = new ShadowCore('p1', { now: () => 1000, onDivergence: (d) => divergences.push(d) });
  s.start({ chat: [{ role: 'you', text: 'hi' }] });
  s.observeChat([{ role: 'you', text: 'hi' }, { role: 'me', text: 'extra' }]);
  assert.equal(divergences.length, 1);
  assert.equal(divergences[0].kind, 'chat');
});

test('shadow session ends and restarts', () => {
  const s = new ShadowCore('p1', { now: () => 1000 });
  s.start({ board: [], chat: [] });
  s.end('clear');
  assert.equal(s.session.status, 'ended');
  s.start({ board: [], chat: [] });
  assert.equal(s.session.status, 'active');
});

test('shadow records turn/step/llm/tool events and audits cleanly', () => {
  const s = new ShadowCore('p1', { now: () => 1000 });
  s.start({ board: [], chat: [] });
  s.turnStart({ text: 'hi', mode: 'tutor' });
  s.stepStart({ no: 1 });
  s.llmRequest({ requestId: 'r1', round: 0, messageCount: 3 });
  s.llmResponse({ requestId: 'r1', toolCalls: 1 });
  s.toolCall({ toolId: 't1', requestId: 'r1', name: 'board_note', args: { r: 3, c: 4 } });
  s.toolResult({ toolId: 't1', requestId: 'r1', name: 'board_note', ok: true, cell: { r: 3, c: 4 } });
  s.stepEnd();
  s.turnEnd();
  assert.deepEqual(s.session.audit(), []);
  const types = s.session.events.map((e) => e.type);
  for (const t of ['turn/start', 'step/start', 'llm/request', 'llm/response', 'tool/call', 'tool/result', 'step/end', 'turn/end']) {
    assert.ok(types.includes(t), t);
  }
});

test('static area/object fields do not cause board divergence', () => {
  const divergences = [];
  const s = new ShadowCore('p1', { now: () => 1000, onDivergence: (d) => divergences.push(d) });
  s.start({ board: [{ r: 3, c: 4, notes: ['B'], area: '步道', objName: '椅子' }] });
  s.observeBoard([{ r: 3, c: 4, notes: ['B'] }], [{ r: 3, c: 4, after: { notes: ['B'] } }]);
  assert.deepEqual(divergences, []);
});

test('summary turnSteps uses the last ended turn', () => {
  const s = new ShadowCore('p1', { now: () => 1000 });
  s.start({ board: [], chat: [] });
  s.turnStart({ text: 'go' });
  s.stepStart({ no: 1 });
  s.stepEnd();
  s.turnEnd();
  assert.equal(s.snapshot().turnSteps, 1);
});

test('restart persists session end and restore rebuilds projections', () => {
  const seen = [];
  const s = new ShadowCore('p1', { now: () => 1000, onEvent: (e) => seen.push(e) });
  s.start({ board: [{ r: 3, c: 4, notes: ['B'] }], chat: [{ role: 'you', text: 'hi' }] });
  s.start({ board: [], chat: [] });
  assert.ok(seen.some((e) => e.type === 'session/end'));
  const endIdx = seen.findIndex((e) => e.type === 'session/end');
  const firstSession = seen.slice(0, endIdx);
  const r = new ShadowCore('p1', { now: () => 1000 });
  r.restore(firstSession);
  assert.equal(r.chat.snapshot().length, 1);
  assert.equal(r.board.snapshot().length, 1);
  assert.equal(r.queueSeeded, true);
});
