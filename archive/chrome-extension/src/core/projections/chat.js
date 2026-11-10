import { E, COMMITTED } from '../events.js';

export class ChatProjection {
  constructor() { this.messages = []; }

  apply(event) {
    if (!event || event.status !== COMMITTED) return;
    if (event.type === E.userMessage) {
      this.messages.push({ eventId: event.id, sessionId: event.sessionId, stepId: event.stepId, role: 'user', text: event.payload?.text || '', ts: event.ts });
    } else if (event.type === E.assistantMessage) {
      this.messages.push({ eventId: event.id, sessionId: event.sessionId, stepId: event.stepId, role: 'assistant', text: event.payload?.text || '', ts: event.ts, system: !!event.payload?.system });
    }
  }

  snapshot() { return [...this.messages]; }
}
