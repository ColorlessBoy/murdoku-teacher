/**
 * 工具流水线（DSH tools/pre-execute → execute → post-execute）。
 * 只做校验/编排；真正执行由注入的 execute handler 完成。
 */
export function reject(reason, extra = {}) {
  return { ok: false, rejected: reason, ...extra };
}

export class ToolPipeline {
  constructor({ execute, onEvent = null } = {}) {
    if (typeof execute !== 'function') throw new Error('execute_required');
    this.execute = execute;
    this.onEvent = onEvent;
    this.pre = [];
    this.post = [];
  }

  usePre(fn) { this.pre.push(fn); return this; }
  usePost(fn) { this.post.push(fn); return this; }

  async run(call = {}, context = {}) {
    const missing = ['sessionId', 'requestId', 'toolId'].filter((k) => !context[k]);
    if (missing.length) return reject('missing_ids', { missing });

    let prepared = { ...call };
    for (const fn of this.pre) {
      const r = await fn(prepared, context);
      if (r === false) return reject('pre_execute_rejected');
      if (r && r.rejected) return reject(r.rejected, r);
      if (r && r.call) prepared = r.call;
    }
    this.onEvent?.({ type: 'tools/pre-execute', call: prepared, context });

    let result;
    try {
      result = await this.execute(prepared, context);
    } catch (e) {
      this.onEvent?.({ type: 'tools/failed', error: e.message, context });
      return { ok: false, error: e.message };
    }
    this.onEvent?.({ type: 'tools/execute', call: prepared, result, context });

    for (const fn of this.post) {
      const r = await fn(result, prepared, context);
      if (r === false) return reject('post_execute_rejected');
      if (r && r.rejected) return reject(r.rejected, r);
      if (r && r.result) result = r.result;
    }
    this.onEvent?.({ type: 'tools/post-execute', call: prepared, result, context });
    return { ok: true, call: prepared, result };
  }
}
