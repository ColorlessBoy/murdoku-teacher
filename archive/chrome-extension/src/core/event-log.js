export const DEFAULT_EVENT_CAP = 1200;

export function compactEvent(e) {
  return {
    id: e.id, type: e.type, status: e.status, seq: e.seq, ts: e.ts,
    sessionId: e.sessionId || null, stepId: e.stepId || null,
    requestId: e.requestId || null, toolId: e.toolId || null,
    payload: e.payload || {},
  };
}

export function appendCapped(events, event, { max = DEFAULT_EVENT_CAP } = {}) {
  const out = (events || []).concat(compactEvent(event));
  return out.length > max ? out.slice(out.length - max) : out;
}
