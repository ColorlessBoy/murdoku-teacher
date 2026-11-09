/**
 * Cordis-shaped 轻量上下文：服务注册、类型化事件、可逆副作用。
 * 纯 JS，无 chrome / DOM / fetch 依赖，可在 Node 中测试。
 */
export class Context {
  constructor() {
    this.services = new Map();
    this.listeners = new Map();
    this.effects = [];
    this.disposed = false;
  }

  service(name, value) {
    if (this.disposed) throw new Error('context_disposed');
    this.services.set(name, value);
    return value;
  }

  get(name) {
    return this.services.get(name);
  }

  require(name) {
    const v = this.services.get(name);
    if (!v) throw new Error('missing_service:' + name);
    return v;
  }

  on(event, listener) {
    if (this.disposed) throw new Error('context_disposed');
    const arr = this.listeners.get(event) || [];
    arr.push(listener);
    this.listeners.set(event, arr);
    return () => {
      const cur = this.listeners.get(event) || [];
      const i = cur.indexOf(listener);
      if (i >= 0) cur.splice(i, 1);
    };
  }

  effect(fn) {
    if (this.disposed) throw new Error('context_disposed');
    const dispose = fn();
    if (typeof dispose === 'function') this.effects.push(dispose);
    return dispose;
  }

  async emit(event, payload) {
    for (const fn of [...(this.listeners.get(event) || [])]) await fn(payload);
  }

  async serial(event, payload) {
    for (const fn of [...(this.listeners.get(event) || [])]) await fn(payload);
  }

  async parallel(event, payload) {
    await Promise.all([...(this.listeners.get(event) || [])].map((fn) => fn(payload)));
  }

  async waterfall(event, payload, tail = async (v) => v) {
    const list = [...(this.listeners.get(event) || [])];
    const run = async (i, value) => {
      if (i >= list.length) return tail(value);
      let called = false;
      const next = async (v = value) => { called = true; return run(i + 1, v); };
      const result = await list[i](value, next);
      if (called) return result;
      return result !== undefined ? result : value;
    };
    return run(0, payload);
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.effects.reverse()) {
      try { await d(); } catch (e) {}
    }
    this.effects.length = 0;
    this.listeners.clear();
  }
}

export function plugin(ctx, apply) {
  return apply(ctx);
}
