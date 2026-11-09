import { E, COMMITTED } from '../events.js';

/**
 * 简化账本投影：board/diff 开/并当前问题；review/accept 关闭；session/end 清空。
 * 旧账本的 asked/answered 细分仍由 legacy 管，core 先跟 unresolved 对齐。
 */
export class LedgerProjection {
  constructor() { this.questions = []; this.batches = []; this.seq = 0; this.hasLedger = false; }

  apply(event) {
    if (!event || event.status !== COMMITTED) return;
    if (event.type === E.sessionEnd) { this.questions = []; return; }
    if (event.type === E.ledgerSnapshot) {
      this.hasLedger = true;
      this.questions = (event.payload?.questions || []).map((q) => JSON.parse(JSON.stringify(q)));
      return;
    }
    if (event.type === E.ledgerBatch) {
      this.hasLedger = true;
      if (event.payload?.batch) this.batches.push(event.payload.batch);
      if (this.batches.length > 600) this.batches.splice(0, this.batches.length - 600);
      return;
    }
    if (event.type === E.ledgerQuestion) {
      this.hasLedger = true;
      const q = event.payload?.question;
      if (q) {
        const i = this.questions.findIndex((x) => x.id === q.id);
        if (i >= 0) this.questions[i] = JSON.parse(JSON.stringify(q));
        else this.questions.push(JSON.parse(JSON.stringify(q)));
      }
      return;
    }
    if (event.type === E.ledgerAnswered || event.type === E.ledgerAsked || event.type === E.ledgerClosed) {
      this.hasLedger = true;
      const q = this.questions.find((x) => x.id === event.payload?.id);
      if (q) {
        if (event.type === E.ledgerAnswered) { q.status = 'answered'; q.answer = event.payload?.answer || ''; q.answeredAt = event.ts; }
        if (event.type === E.ledgerAsked) { q.status = 'asked'; q.askedAt = event.ts; }
        if (event.type === E.ledgerClosed) { q.status = 'closed'; q.verdict = event.payload?.verdict || null; q.closedAt = event.ts; }
      }
      return;
    }
    if (event.type === E.ledgerCleared) { this.hasLedger = true; this.questions = []; this.batches = []; return; }
    if (event.type === E.reviewAccept) {
      for (const q of this.questions) if (q.status !== 'closed') { q.status = 'closed'; q.closedAt = event.ts; }
      return;
    }
    if (event.type !== E.boardDiff || this.hasLedger) return;
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

  fullSnapshot() { return { questions: this.snapshot(), batches: this.batches.map((b) => JSON.parse(JSON.stringify(b))) }; }
}
