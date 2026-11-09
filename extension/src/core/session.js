import { E, makeEvent, COMMITTED, PENDING, EXPIRED, REJECTED } from './events.js';

/**
 * 单会话的 append-only 事件日志。
 * 模型历史只从 committed 事件投影（deriveMessages）。
 */
export class Session {
  constructor(id, { now = () => Date.now() } = {}) {
    this.id = id;
    this.status = 'active';
    this.events = [];
    this.seq = 0;
    this.createdAt = now();
    this.endedAt = 0;
    this.now = now;
  }

  append(type, payload = {}, meta = {}) {
    if (this.status !== 'active') {
      return this.reject(type, 'session_ended', payload, meta);
    }
    const seq = ++this.seq;
    const event = makeEvent(type, payload, {
      ...meta,
      sessionId: this.id,
      seq,
      ts: meta.ts ?? this.now(),
      status: meta.status || COMMITTED,
    });
    this.events.push(event);
    return event;
  }

  reject(type, reason, payload = {}, meta = {}) {
    const seq = ++this.seq;
    const event = makeEvent(type, payload, {
      ...meta,
      sessionId: this.id,
      seq,
      ts: meta.ts ?? this.now(),
      status: REJECTED,
      reason,
    });
    this.events.push(event);
    return event;
  }

  find(id) {
    return this.events.find((e) => e.id === id) || null;
  }

  commit(id) {
    const e = this.find(id);
    if (!e) return null;
    if (e.status === PENDING) e.status = COMMITTED;
    return e;
  }

  expire(id, reason = 'expired') {
    const e = this.find(id);
    if (!e) return null;
    if (e.status === PENDING || e.status === COMMITTED) {
      e.status = EXPIRED;
      e.reason = e.reason || reason;
    }
    return e;
  }

  sweep(now = this.now()) {
    let n = 0;
    for (const e of this.events) {
      if (e.status === PENDING && e.ttl > 0 && e.ts + e.ttl <= now) {
        e.status = EXPIRED;
        e.reason = e.reason || 'ttl';
        n++;
      }
    }
    return n;
  }

  end(reason = 'ended') {
    if (this.status !== 'active') {
      return this.reject(E.sessionEnd, 'already_ended', { reason });
    }
    const e = this.append(E.sessionEnd, { reason });
    this.status = 'ended';
    this.endedAt = this.now();
    this.sweep();
    return e;
  }

  /**
   * 模型可见历史：只取当前 session 的 committed 事件。
   * 过期、被拒、pending 一律不进上下文。
   */
  deriveMessages() {
    const out = [];
    for (const e of this.events) {
      if (e.status !== COMMITTED) continue;
      if (e.type === E.userMessage) {
        out.push({ role: 'user', content: String(e.payload.text ?? '') });
      } else if (e.type === E.assistantMessage) {
        const m = { role: 'assistant', content: String(e.payload.text ?? '') };
        const calls = Array.isArray(e.payload.toolCalls) ? e.payload.toolCalls : [];
        if (calls.length) {
          m.tool_calls = calls.map((c, i) => ({
            id: c.id || c.toolId || `call_${e.seq}_${i}`,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.arguments || c.args || {}) },
          }));
        }
        out.push(m);
      } else if (e.type === E.toolResult) {
        const content = typeof e.payload.content === 'string'
          ? e.payload.content
          : JSON.stringify(e.payload.result ?? e.payload);
        out.push({ role: 'tool', tool_call_id: e.toolId || e.payload.toolId || '', content });
      }
    }
    return out;
  }

  /** 检查日志不变量；返回错误列表。 */
  audit() {
    const errors = [];
    const seen = new Set();
    let endedAt = Infinity;
    for (const e of this.events) {
      if (seen.has(e.seq)) errors.push(`duplicate_seq:${e.seq}`);
      seen.add(e.seq);
      if (e.type === E.sessionEnd && e.status === COMMITTED) endedAt = Math.min(endedAt, e.seq);
    }
    const endEvent = this.events.find((e) => e.type === E.sessionEnd && e.status === COMMITTED);
    if (endEvent) {
      for (const e of this.events) {
        if (e.seq > endEvent.seq && e.status === COMMITTED && e.type !== E.sessionEnd) {
          errors.push(`committed_after_end:${e.id}`);
        }
      }
    }
    const calls = new Map();
    for (const e of this.events) {
      if (e.type === E.toolCall && e.status === COMMITTED) calls.set(e.toolId || e.payload.toolId, e);
    }
    for (const e of this.events) {
      if (e.type === E.toolResult && e.status === COMMITTED) {
        const id = e.toolId || e.payload.toolId;
        if (!calls.has(id)) errors.push(`tool_result_without_call:${e.id}`);
      }
    }
    return errors;
  }

  snapshot() {
    return { id: this.id, status: this.status, seq: this.seq, events: this.events.length, createdAt: this.createdAt, endedAt: this.endedAt };
  }

  static replay(id, events, opts = {}) {
    const s = new Session(id, opts);
    s.events = events.map((e) => ({ ...e }));
    s.seq = events.reduce((m, e) => Math.max(m, e.seq || 0), 0);
    if (events.some((e) => e.type === E.sessionEnd && e.status === COMMITTED)) s.status = 'ended';
    return s;
  }
}

export class EventStore {
  constructor({ now = () => Date.now() } = {}) {
    this.sessions = [];
    this.current = null;
    this.now = now;
  }

  start(id) {
    if (this.current && this.current.status === 'active') this.current.end('replaced');
    const s = new Session(id, { now: this.now });
    this.sessions.push(s);
    this.current = s;
    return s;
  }

  append(type, payload = {}, meta = {}) {
    if (!this.current) throw new Error('no_active_session');
    return this.current.append(type, payload, meta);
  }

  end(reason = 'ended') {
    if (!this.current) return null;
    return this.current.end(reason);
  }

  deriveMessages() {
    return this.current ? this.current.deriveMessages() : [];
  }

  sweep() {
    return this.current ? this.current.sweep() : 0;
  }

  snapshot() {
    return this.current ? this.current.snapshot() : null;
  }
}
