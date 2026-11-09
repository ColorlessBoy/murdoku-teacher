import { E, COMMITTED } from '../events.js';

/**
 * turn/step 投影：turn/start → step/start → llm/request/response →
 * tool/call/result → assistant/message → review/* → turn/end。
 * 只做事实归组；不决定下一步，不执行副作用。
 */
export class TurnProjection {
  constructor() { this.turns = []; this.current = null; this.orphans = []; }

  apply(event) {
    if (!event || event.status !== COMMITTED) return;
    if (event.type === E.turnStart) {
      if (this.current && this.current.status === 'open') this.current.status = 'abandoned';
      this.current = {
        id: event.id, text: event.payload?.text || '', mode: event.payload?.mode || '',
        status: 'open', steps: [], createdAt: event.ts,
      };
      this.turns.push(this.current);
      return;
    }
    if (event.type === E.turnEnd) {
      if (this.current) { this.current.status = 'ended'; this.current.endedAt = event.ts; }
      this.current = null;
      return;
    }
    if (event.type === E.stepStart) {
      if (!this.current) { this.orphans.push(event.id); return; }
      const step = {
        id: event.id, no: event.payload?.no || this.current.steps.length + 1,
        status: 'active', requests: [], tools: [], assistant: null, review: null,
        startedAt: event.ts,
      };
      this.current.steps.push(step);
      return;
    }
    const step = this.current && this.current.steps[this.current.steps.length - 1];
    if (!step) { this.orphans.push(event.id); return; }

    if (event.type === E.llmRequest) {
      step.requests.push({ id: event.requestId || event.id, round: event.payload?.round || 0, status: 'pending', at: event.ts });
      return;
    }
    if (event.type === E.llmResponse) {
      const req = step.requests.find((r) => r.id === (event.requestId || event.id)) || step.requests[step.requests.length - 1];
      if (!req) { this.orphans.push(event.id); return; }
      req.status = event.payload?.status === 'error' ? 'error' : 'responded';
      req.toolCalls = event.payload?.toolCalls || 0;
      req.textLength = event.payload?.textLength || 0;
      req.respondedAt = event.ts;
      return;
    }
    if (event.type === E.toolCall) {
      step.tools.push({ id: event.toolId || event.id, requestId: event.requestId || null, name: event.payload?.name || '', status: 'pending', at: event.ts });
      return;
    }
    if (event.type === E.toolResult) {
      const tool = step.tools.find((t) => t.id === (event.toolId || event.id));
      if (!tool) { this.orphans.push(event.id); return; }
      tool.status = event.payload?.ok ? 'done' : 'error';
      tool.resultAt = event.ts;
      return;
    }
    if (event.type === E.assistantMessage) {
      step.assistant = { text: event.payload?.text || '', ts: event.ts };
      step.status = 'waiting_review';
      return;
    }
    if (event.type === E.reviewAccept) {
      step.status = 'accepted';
      step.review = { type: 'accept', verdict: event.payload?.verdict || null, at: event.ts };
      return;
    }
    if (event.type === E.reviewChallenge) {
      step.status = 'challenged';
      step.review = { type: 'challenge', at: event.ts };
      return;
    }
  }

  get currentStep() {
    return this.current && this.current.steps.length ? this.current.steps[this.current.steps.length - 1] : null;
  }

  pendingTools() {
    const s = this.currentStep;
    return s ? s.tools.filter((t) => t.status === 'pending') : [];
  }

  snapshot() {
    const clone = (x) => JSON.parse(JSON.stringify(x));
    return { turns: clone(this.turns), current: clone(this.current), orphans: [...this.orphans] };
  }
}
