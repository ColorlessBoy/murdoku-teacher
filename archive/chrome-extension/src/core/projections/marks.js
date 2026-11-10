import { E, COMMITTED } from '../events.js';

export class MarksProjection {
  constructor() { this.marks = new Map(); }

  static key(r, c) { return `${r},${c}`; }

  apply(event) {
    if (!event || event.status !== COMMITTED) return;
    if (event.type === E.stepEnd || event.type === E.sessionEnd) {
      this.marks.clear();
      return;
    }
    if (event.type !== E.toolResult) return;
    const action = event.payload?.action;
    const name = typeof action === 'string' ? action : action?.name;
    if (!event.payload?.ok || !name || !name.startsWith('board_')) return;
    const cell = event.payload?.cell || action?.cell || {};
    const r = Number(cell.r ?? action?.r);
    const c = Number(cell.c ?? action?.c);
    if (!r || !c) return;
    this.marks.set(MarksProjection.key(r, c), {
      toolId: event.toolId || event.payload?.toolId || null,
      stepId: event.stepId || null,
      r, c,
      kind: name === 'board_x' ? 'excl' : name === 'board_erase' ? 'ask' : 'cand',
    });
  }

  snapshot() { return [...this.marks.values()]; }
}
