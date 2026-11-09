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
