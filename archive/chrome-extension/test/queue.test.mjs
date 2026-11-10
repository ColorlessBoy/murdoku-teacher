import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBatches } from '../src/queue.js';

const cell = (r, c, note = 'D') => ({ r, c, after: { notes: [note], big: '', x: false } });

test('merges two batches touching the same cell', () => {
  const a = { changes: [cell(1, 6)], board: ['a'] };
  const b = { changes: [cell(1, 6)], board: ['b'] };
  const out = mergeBatches([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].changes.length, 1);
  assert.deepEqual(out[0].board, ['b']);
});

test('keeps disjoint batches', () => {
  const a = { changes: [cell(1, 6)] };
  const b = { changes: [cell(2, 5)] };
  assert.equal(mergeBatches([a, b]).length, 2);
});

test('unions overlapping batches but keeps latest after', () => {
  const a = { changes: [cell(1, 6, 'D'), cell(1, 7, 'D')] };
  const b = { changes: [cell(1, 7, 'B')] };
  const out = mergeBatches([a, b]);
  assert.equal(out.length, 1);
  const map = new Map(out[0].changes.map((c) => [`${c.r},${c.c}`, c]));
  assert.equal(map.get('1,6').after.notes[0], 'D');
  assert.equal(map.get('1,7').after.notes[0], 'B');
});

test('drops stale batches when maxAge is set', () => {
  const old = { changes: [cell(1, 6)], ts: Date.now() - 20 * 60 * 1000 };
  const fresh = { changes: [cell(2, 5)], ts: Date.now() };
  assert.equal(mergeBatches([old, fresh], 10 * 60 * 1000).length, 1);
});
