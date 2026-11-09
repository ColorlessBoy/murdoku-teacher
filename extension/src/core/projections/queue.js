import { E, COMMITTED } from '../events.js';

export class QueueProjection {
  constructor() { this.batches = []; }

  apply(event) {
    if (!event || event.status !== COMMITTED) return;
    if (event.type === E.sessionEnd) { this.batches = []; return; }
    if (event.type === E.queueEnqueue) { this.enqueue(event.payload?.batch); return; }
    if (event.type === E.queueDequeue) { this.dequeue(event.payload?.id); return; }
    if (event.type === E.queueExpire) {
      if (event.payload?.all) this.batches = [];
      else if (Array.isArray(event.payload?.ids)) this.batches = this.batches.filter((b) => !event.payload.ids.includes(b.id));
    }
  }

  enqueue(batch) {
    if (!batch || !Array.isArray(batch.changes) || !batch.changes.length) return;
    const keys = new Set(batch.changes.map((c) => `${c.r},${c.c}`));
    const hit = this.batches.find((b) => (b.changes || []).some((c) => keys.has(`${c.r},${c.c}`)));
    if (hit) {
      const map = new Map((hit.changes || []).map((c) => [`${c.r},${c.c}`, c]));
      for (const c of batch.changes) map.set(`${c.r},${c.c}`, c);
      hit.changes = [...map.values()];
      hit.board = batch.board;
      hit.clues = batch.clues;
      hit.title = batch.title;
      hit.ts = batch.ts || Date.now();
      return;
    }
    this.batches.push({ id: batch.id || `q_${this.batches.length}_${Date.now()}`, ...batch, changes: batch.changes.map((c) => ({ ...c })) });
  }

  dequeue(id) {
    if (this.batches.length === 0) return;
    if (id) {
      const i = this.batches.findIndex((b) => b.id === id);
      if (i >= 0) this.batches.splice(i, 1);
      return;
    }
    this.batches.shift();
  }

  snapshot() { return this.batches.map((b) => ({ ...b, changes: (b.changes || []).map((c) => ({ ...c })) })); }
}
