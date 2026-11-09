import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, EventStore } from '../../src/core/session.js';
import { E, PENDING, EXPIRED, REJECTED } from '../../src/core/events.js';

const fixedNow = () => 1000;

test('session derives model messages from committed events only', () => {
  const s = new Session('s1', { now: fixedNow });
  s.append(E.userMessage, { text: 'hi' });
  s.append(E.assistantMessage, { text: 'hello' });
  assert.deepEqual(s.deriveMessages(), [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);
});

test('expired pending events never enter messages', () => {
  const s = new Session('s1', { now: fixedNow });
  const e = s.append(E.toolResult, { content: 'secret' }, { toolId: 't1', status: PENDING, ttl: 10 });
  assert.equal(e.status, PENDING);
  assert.deepEqual(s.deriveMessages(), []);
  s.sweep(1020);
  assert.equal(e.status, EXPIRED);
  assert.deepEqual(s.deriveMessages(), []);
});

test('session end rejects later appends; rejected events are not messages', () => {
  const s = new Session('s1', { now: fixedNow });
  s.append(E.userMessage, { text: 'before' });
  s.end('test');
  const late = s.append(E.userMessage, { text: 'after' });
  assert.equal(late.status, REJECTED);
  assert.deepEqual(s.deriveMessages(), [{ role: 'user', content: 'before' }]);
  assert.deepEqual(s.audit(), []);
});

test('audit flags tool result without tool call', () => {
  const s = new Session('s1', { now: fixedNow });
  s.append(E.toolResult, { content: 'x' }, { toolId: 't1' });
  assert.ok(s.audit().some((e) => e.startsWith('tool_result_without_call')));
  s.append(E.toolCall, { name: 'get_board' }, { toolId: 't1' });
  assert.deepEqual(s.audit(), []);
});

test('assistant tool calls and tool results are projected', () => {
  const s = new Session('s1', { now: fixedNow });
  s.append(E.assistantMessage, { text: '', toolCalls: [{ id: 'c1', name: 'get_board', arguments: {} }] });
  s.append(E.toolResult, { content: '{"cells":100}' }, { toolId: 'c1' });
  assert.deepEqual(s.deriveMessages(), [
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_board', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"cells":100}' },
  ]);
});

test('new session does not inherit old messages', () => {
  const store = new EventStore({ now: fixedNow });
  store.start('a');
  store.append(E.userMessage, { text: 'old' });
  store.end('clear');
  store.start('b');
  assert.deepEqual(store.deriveMessages(), []);
});

test('replay reconstructs messages', () => {
  const s = new Session('s1', { now: fixedNow });
  s.append(E.userMessage, { text: 'a' });
  s.append(E.assistantMessage, { text: 'b' });
  const r = Session.replay('r', s.events, { now: fixedNow });
  assert.deepEqual(r.deriveMessages(), s.deriveMessages());
});
