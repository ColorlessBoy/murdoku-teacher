import test from 'node:test';
import assert from 'node:assert/strict';
import { initSession, reduceSession, PHASE } from '../../src/core/session-machine.js';

const run = (events) => events.reduce((s, e) => reduceSession(s, e).state, initSession());

test('clear -> boardDone -> new -> started -> auto', () => {
  let r = reduceSession(initSession(), { type: 'clear/request', token: 'c1' });
  assert.equal(r.state.phase, PHASE.clearing);
  assert.ok(r.effects.some((e) => e.type === 'board.clear'));
  r = reduceSession(r.state, { type: 'clear/boardDone', token: 'c1' });
  assert.equal(r.state.phase, PHASE.cleared);
  r = reduceSession(r.state, { type: 'new/request', token: 'n1' });
  assert.equal(r.state.phase, PHASE.starting);
  r = reduceSession(r.state, { type: 'new/started', token: 'n1', sessionId: 's1' });
  assert.equal(r.state.phase, PHASE.active);
  assert.equal(r.effects.filter((e) => e.type === 'agent.autoStart').length, 1);
  r = reduceSession(r.state, { type: 'auto/started' });
  assert.equal(r.state.autoStarted, true);
  r = reduceSession(r.state, { type: 'auto/started' });
  assert.equal(r.rejected.reason, 'already_auto_started');
});

test('new before clear done is rejected', () => {
  const r = reduceSession(initSession(), { type: 'clear/request', token: 'c1' });
  const n = reduceSession(r.state, { type: 'new/request', token: 'n1' });
  assert.equal(n.rejected.reason, 'clear_in_progress');
  assert.equal(n.effects.length, 0);
});

test('stale clear token is rejected', () => {
  const r = reduceSession(initSession(), { type: 'clear/request', token: 'c1' });
  const done = reduceSession(r.state, { type: 'clear/boardDone', token: 'old' });
  assert.equal(done.rejected.reason, 'stale_clear_token');
});

test('duplicate clear is rejected', () => {
  const r = reduceSession(initSession(), { type: 'clear/request', token: 'c1' });
  const again = reduceSession(r.state, { type: 'clear/request', token: 'c2' });
  assert.equal(again.rejected.reason, 'already_clearing');
});

test('duplicate new/started is rejected', () => {
  let r = reduceSession(run([{ type: 'clear/request', token: 'c1' }, { type: 'clear/done', token: 'c1' }]), { type: 'new/request', token: 'n1' });
  r = reduceSession(r.state, { type: 'new/started', token: 'n1', sessionId: 's1' });
  const again = reduceSession(r.state, { type: 'new/started', token: 'n1', sessionId: 's1' });
  assert.equal(again.rejected.reason, 'not_starting');
});

test('clear from active cancels inflight', () => {
  let s = initSession({ phase: PHASE.active, sessionId: 'old' });
  const r = reduceSession(s, { type: 'clear/request', token: 'c1' });
  assert.equal(r.state.phase, PHASE.clearing);
  assert.ok(r.effects.some((e) => e.type === 'cancel.inflight'));
  assert.equal(r.state.sessionId, null);
});

test('unknown event rejected', () => {
  const r = reduceSession(initSession(), { type: 'nope' });
  assert.equal(r.rejected.reason, 'unknown_event');
});
