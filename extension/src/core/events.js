/**
 * 事件名与事件工厂。SessionEvent 是持久事实；agent/* 与 tools/* 是实时扩展点。
 */
export const E = {
  sessionStart: 'session/start',
  sessionEnd: 'session/end',
  turnStart: 'turn/start',
  turnEnd: 'turn/end',
  stepStart: 'step/start',
  stepEnd: 'step/end',
  userMessage: 'user/message',
  assistantMessage: 'assistant/message',
  assistantAttempt: 'assistant/attempt',
  toolCall: 'tool/call',
  toolResult: 'tool/result',
  boardSnapshot: 'board/snapshot',
  boardDiff: 'board/diff',
  reviewAccept: 'review/accept',
  reviewChallenge: 'review/challenge',
  queueEnqueue: 'queue/enqueue',
  queueDequeue: 'queue/dequeue',
  queueExpire: 'queue/expire',
  prepLoaded: 'prep/loaded',
  eventRejected: 'event/rejected',
  llmRequest: 'llm/request',
  llmResponse: 'llm/response',
  agentPreStep: 'agent/pre-step',
  agentRequest: 'agent/request',
  llmStream: 'llm/stream',
  toolsPreExecute: 'tools/pre-execute',
  toolsExecute: 'tools/execute',
  toolsPostExecute: 'tools/post-execute',
  agentTurnStopping: 'agent/turn-stopping',
};

export const COMMITTED = 'committed';
export const PENDING = 'pending';
export const EXPIRED = 'expired';
export const REJECTED = 'rejected';

export const SESSION_EVENT_TYPES = new Set([
  E.sessionStart, E.sessionEnd, E.turnStart, E.turnEnd, E.stepStart, E.stepEnd,
  E.userMessage, E.assistantMessage, E.assistantAttempt, E.toolCall, E.toolResult,
  E.boardSnapshot, E.boardDiff, E.reviewAccept, E.reviewChallenge,
  E.queueEnqueue, E.queueDequeue, E.queueExpire, E.prepLoaded,
]);

let localId = 0;
export function makeEvent(type, payload = {}, meta = {}) {
  const seq = meta.seq || 0;
  return {
    id: meta.id || `${meta.sessionId || 's'}:${seq}:${type}:${++localId}`,
    type,
    payload,
    sessionId: meta.sessionId || null,
    stepId: meta.stepId || null,
    requestId: meta.requestId || null,
    toolId: meta.toolId || null,
    cause: meta.cause || null,
    seq,
    ts: meta.ts ?? Date.now(),
    status: meta.status || COMMITTED,
    ttl: meta.ttl || 0,
    reason: meta.reason || null,
  };
}
