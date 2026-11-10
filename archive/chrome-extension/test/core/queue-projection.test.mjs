import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueProjection } from '../../src/core/projections/queue.js';
import { E, COMMITTED } from '../../src/core/events.js';
import { ShadowCore } from '../../src/core/shadow.js';

const batch = (r, c, note = 'B', id = `q${r}${c}`) => ({ id, changes: [{ r, c, after: { big: '', notes: [note], x: false } }] });
const ev = (type, payload, meta = {}) => ({ type, payload, status: COMMITTED, seq: 1, ...meta });

test('queue merges overlapping cells and keeps disjoint batches', () => {
  const p = new QueueProjection();
  p.apply(ev(E.queueEnqueue, { batch: batch(3, 4, 'B') }));
  p.apply(ev(E.queueEnqueue, { batch: batch(3, 4, 'D') }));
  p.apply(ev(E.queueEnqueue, { batch: batch(5, 3, 'H') }));
  assert.equal(p.snapshot().length, 2);
  assert.equal(p.snapshot()[0].changes.length, 1);
  assert.equal(p.snapshot()[0].changes[0].after.notes[0], 'D');
});

test('queue dequeue and expire clear', () => {
  const p = new QueueProjection();
  p.apply(ev(E.queueEnqueue, { batch: batch(3, 4, 'B', 'a') }));
  p.apply(ev(E.queueEnqueue, { batch: batch(5, 3, 'H', 'b') }));
  p.apply(ev(E.queueDequeue, { id: 'a' }));
  assert.equal(p.snapshot().length, 1);
  p.apply(ev(E.queueExpire, { all: true }));
  assert.equal(p.snapshot().length, 0);
  p.apply(ev(E.queueEnqueue, { batch: batch(3, 4, 'B', 'a') }));
  p.apply(ev(E.sessionEnd, {}));
  assert.equal(p.snapshot().length, 0);
});

test('shadow queue matches and reports divergence', () => {
  const ds = [];
  const s = new ShadowCore('p1', { now: () => 1000, onDivergence: (d) => ds.push(d) });
  s.start({ board: [], chat: [] });
  s.queueEnqueue(batch(3, 4, 'B', 'a'));
  assert.equal(s.observeQueue([{ id: 'a', changes: [{ r: 3, c: 4, after: { notes: ['B'] } }] }]), true);
  assert.deepEqual(ds, []);
  s.observeQueue([]);
  assert.equal(ds.length, 1);
  assert.equal(ds[0].kind, 'queue');
});
