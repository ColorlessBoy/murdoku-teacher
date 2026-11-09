import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionProjections } from '../../src/core/projections/host.js';
import { BoardProjection } from '../../src/core/projections/board.js';
import { E, COMMITTED } from '../../src/core/events.js';

test('projection host registers units and applies events', () => {
  const host = new SessionProjections();
  host.register('board', new BoardProjection());
  host.apply({ type: E.boardSnapshot, payload: { cells: [{ r: 3, c: 4, notes: ['B'] }] }, status: COMMITTED });
  assert.deepEqual(host.stateOf('board').map((c) => [c.r, c.c, c.notes]), [[3, 4, ['B']]]);
  assert.ok(host.snapshot().board);
});

test('projection host rejects invalid units', () => {
  const host = new SessionProjections();
  assert.throws(() => host.register('x', {}));
});
