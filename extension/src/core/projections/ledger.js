import { E, COMMITTED } from '../events.js';

/**
 * 简化账本投影：board/diff 开/并当前问题；review/accept 关闭；session/end 清空。
 * 旧账本的 asked/answered 细分仍由 legacy 管，core 先跟 unresolved 对齐。
 */
export class LedgerProjection {
  constructor() { this.questions = []; this.seq = 0; }

  apply(event) {
    if (!event || event.status !== COMMITTED) return;
    if (event.type === E.sessionEnd) { this.questions = []; return; }
    if (event.type === E.reviewAccept) {
      for (const q of this.questions) if (q.status !== 'closed') { q.status = 'closed'; q.closedAt = event.ts; }
      return;
    }
    if (event.type !== E.boardDiff) return;
    const cells = (event.payload?.changes || [])
      .filter((c) => c.after && (c.after.big || (c.after.notes || []).length || c.after.x))
      .map((c) => ({ r: c.r, c: c.c, after: c.after }));
    if (!cells.length) return;
    const open = this.questions.find((q) => q.status !== 'closed');
    if (open) {
      const map = new Map((open.cells || []).map((c) => [`${c.r},${c.c}`, c]));
      for (const c of cells) map.set(`${c.r},${c.c}`, c);
      open.cells = [...map.values()];
      open.updatedAt = event.ts;
      return;
    }
    this.questions.push({ id: `q_${++this.seq}`, stepId: event.stepId || null, status: 'open', cells, createdAt: event.ts, updatedAt: event.ts });
  }

  unresolved() { return this.questions.filter((q) => q.status !== 'closed'); }

  snapshot() { return this.questions.map((q) => ({ ...q, cells: (q.cells || []).map((c) => ({ ...c })) })); }
}
