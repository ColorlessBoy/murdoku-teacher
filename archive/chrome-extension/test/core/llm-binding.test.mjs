import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../../src/core/session.js';
import { requestBound } from '../../src/core/llm-binding.js';
import { E } from '../../src/core/events.js';

const session = () => { const s = new Session('s', { now: () => 1000 }); s.append(E.sessionStart, {}); return s; };

test('binds request and response to the active session', async () => {
  const s = session();
  const r = await requestBound({ session: s, requestId: 'r1', stepId: 'st1', messages: [{}, {}], call: async () => ({ text: 'hi' }) });
  assert.equal(r.ok, true);
  assert.equal(s.events.filter((e) => e.type === E.llmRequest).length, 1);
  assert.equal(s.events.filter((e) => e.type === E.llmResponse).length, 1);
});

test('rejects inactive session', async () => {
  const s = session(); s.end('clear');
  const r = await requestBound({ session: s, requestId: 'r1', stepId: 'st1', call: async () => ({}) });
  assert.equal(r.rejected, 'session_not_active');
});

test('rejects stale before and after', async () => {
  const s = session();
  let current = false;
  const r1 = await requestBound({ session: s, requestId: 'r1', stepId: 'st1', call: async () => ({}), isCurrent: () => current });
  assert.equal(r1.rejected, 'stale_before_call');
  current = true;
  let calls = 0;
  const r2 = await requestBound({ session: s, requestId: 'r1', stepId: 'st1', call: async () => { calls++; current = false; return {}; }, isCurrent: () => current });
  assert.equal(r2.rejected, 'stale_after_call');
  assert.equal(calls, 1);
  assert.equal(s.events.filter((e) => e.type === E.llmResponse).length, 0);
});

test('llm error is recorded and returned', async () => {
  const s = session();
  const r = await requestBound({ session: s, requestId: 'r1', stepId: 'st1', call: async () => { throw new Error('boom'); } });
  assert.equal(r.ok, false);
  assert.equal(r.rejected, 'llm_error');
  const resp = s.events.find((e) => e.type === E.llmResponse);
  assert.equal(resp.payload.status, 'error');
});

test('requires ids and call', async () => {
  const s = session();
  assert.equal((await requestBound({ session: s, requestId: '', stepId: 'st1', call: async () => ({}) })).rejected, 'missing_ids');
  assert.equal((await requestBound({ session: s, requestId: 'r1', stepId: 'st1' })).rejected, 'missing_call');
});
