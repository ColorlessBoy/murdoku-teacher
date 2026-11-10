/**
 * 投影宿主：注册式 projection seam。
 * UI / context 只读 stateOf/snapshot，不直接读事件日志。
 */
export class SessionProjections {
  constructor() { this.units = new Map(); }

  register(name, unit) {
    if (!unit || typeof unit.apply !== 'function' || typeof unit.snapshot !== 'function') {
      throw new Error('projection_must_have_apply_and_snapshot:' + name);
    }
    this.units.set(name, unit);
    return unit;
  }

  apply(event) {
    for (const unit of this.units.values()) unit.apply(event);
    return this;
  }

  stateOf(name) {
    const unit = this.units.get(name);
    return unit ? unit.snapshot() : null;
  }

  snapshot() {
    const out = {};
    for (const [name, unit] of this.units) out[name] = unit.snapshot();
    return out;
  }
}
