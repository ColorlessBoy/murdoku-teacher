import { E, COMMITTED } from '../events.js';

export class BoardProjection {
  constructor() { this.cells = new Map(); }

  static key(r, c) { return `${r},${c}`; }

  apply(event) {
    if (!event || event.status !== COMMITTED) return;
    if (event.type === E.sessionEnd) { this.cells.clear(); return; }
    if (event.type === E.boardSnapshot) {
      this.cells.clear();
      for (const c of event.payload?.cells || []) this.cells.set(BoardProjection.key(c.r, c.c), { ...c });
      return;
    }
    if (event.type === E.boardDiff) {
      for (const ch of event.payload?.changes || []) {
        const key = BoardProjection.key(ch.r, ch.c);
        if (!ch.after) this.cells.delete(key);
        else this.cells.set(key, { ...ch.after, r: ch.r, c: ch.c });
      }
    }
  }

  get(r, c) { return this.cells.get(BoardProjection.key(r, c)) || null; }

  snapshot() {
    return [...this.cells.values()].sort((a, b) => (a.r - b.r) || (a.c - b.c));
  }
}
