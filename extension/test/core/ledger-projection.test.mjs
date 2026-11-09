import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerProjection } from '../../src/core/projections/ledger.js';
import { E, COMMITTED } from '../../src/core/events.js';
import { ShadowCore } from '../../src/core/shadow.js';

const diff = (changes, meta = {}) => ({ type: E.boardDiff, payload: { changes }, status: COMMITTED, ts: 1000, ...meta });
const cell = (r, c, note = 'B') => ({ r, c, after: { big: '', notes: [note], x: false } });

test('board diff opens one question and merges cells', () => {
  const p = new LedgerProjection();
  p.apply(diff([cell(3, 4)]));
  p.apply(diff([cell(5, 3, 'H')]));
  assert.equal(p.unresolved().length, 1);
  assert.equal(p.unresolved()[0].cells.length, 2);
});

test('review accept closes; session end clears', () => {
  const p = new LedgerProjection();
  p.apply(diff([cell(3, 4)]));
  p.apply({ type: E.reviewAccept, payload: {}, status: COMMITTED, ts: 2000 });
  assert.equal(p.unresolved().length, 0);
  p.apply(diff([cell(5, 3, 'H')]));
  assert.equal(p.unresolved().length, 1);
  p.apply({ type: E.sessionEnd, payload: {}, status: COMMITTED });
  assert.equal(p.snapshot().length, 0);
});

test('shadow ledger compares unresolved counts', () => {
  const ds = [];
  const s = new ShadowCore('p1', { now: () => 1000, onDivergence: (d) => ds.push(d) });
  s.start({ board: [], chat: [] });
  s.observeBoard([{ r: 3, c: 4, notes: ['B'] }], [{ r: 3, c: 4, after: { notes: ['B'] } }]);
  assert.equal(s.observeLedger({ unresolved: [{}] }), true);
  s.observeLedger({ unresolved: [] });
  assert.equal(ds.length, 1);
  assert.equal(ds[0].kind, 'ledger');
});
