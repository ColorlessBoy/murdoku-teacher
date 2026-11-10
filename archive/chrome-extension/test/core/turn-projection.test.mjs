import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnProjection } from '../../src/core/projections/turn.js';
import { E, COMMITTED } from '../../src/core/events.js';

const ev = (type, payload = {}, meta = {}) => ({
  id: meta.id || `${type}_${Math.random()}`, type, payload, status: COMMITTED, ts: 1000,
  sessionId: 's1', stepId: meta.stepId || null, requestId: meta.requestId || null, toolId: meta.toolId || null,
});

test('turn/step projects requests, tools, assistant, review', () => {
  const p = new TurnProjection();
  p.apply(ev(E.turnStart, { text: 'go', mode: 'tutor' }));
  p.apply(ev(E.stepStart, { no: 1 }));
  p.apply(ev(E.llmRequest, { round: 0 }, { requestId: 'r1' }));
  p.apply(ev(E.llmResponse, { toolCalls: 1 }, { requestId: 'r1' }));
  p.apply(ev(E.toolCall, { name: 'board_note' }, { toolId: 't1', requestId: 'r1' }));
  p.apply(ev(E.toolResult, { ok: true }, { toolId: 't1', requestId: 'r1' }));
  p.apply(ev(E.assistantMessage, { text: 'done' }));
  p.apply(ev(E.reviewAccept, { verdict: 'VALID' }));
  const s = p.currentStep;
  assert.equal(p.current.status, 'open');
  assert.equal(s.status, 'accepted');
  assert.equal(s.requests[0].status, 'responded');
  assert.equal(s.tools[0].status, 'done');
  assert.equal(s.review.type, 'accept');
  assert.deepEqual(p.pendingTools(), []);
});

test('challenge stays on same step', () => {
  const p = new TurnProjection();
  p.apply(ev(E.turnStart, {}));
  p.apply(ev(E.stepStart, { no: 1 }));
  p.apply(ev(E.assistantMessage, { text: 'claim' }));
  p.apply(ev(E.reviewChallenge, {}));
  assert.equal(p.current.steps.length, 1);
  assert.equal(p.currentStep.status, 'challenged');
});

test('orphan tool result is recorded, not applied', () => {
  const p = new TurnProjection();
  p.apply(ev(E.turnStart, {}));
  p.apply(ev(E.stepStart, {}));
  p.apply(ev(E.toolResult, { ok: true }, { toolId: 'nope' }));
  assert.equal(p.orphans.length, 1);
  assert.deepEqual(p.pendingTools(), []);
});

test('turn end closes current', () => {
  const p = new TurnProjection();
  p.apply(ev(E.turnStart, {}));
  p.apply(ev(E.stepStart, {}));
  p.apply(ev(E.turnEnd, {}));
  assert.equal(p.turns.length, 1);
  assert.equal(p.turns[0].status, 'ended');
  assert.equal(p.current, null);
});
