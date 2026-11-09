import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '../../src/core/context.js';

test('context exposes services', () => {
  const ctx = new Context();
  ctx.service('board', { cells: 1 });
  assert.equal(ctx.get('board').cells, 1);
  assert.equal(ctx.require('board').cells, 1);
  assert.throws(() => ctx.require('missing'));
});

test('effect disposers run in reverse on dispose', async () => {
  const ctx = new Context();
  const order = [];
  ctx.effect(() => () => order.push('a'));
  ctx.effect(() => () => order.push('b'));
  await ctx.dispose();
  assert.deepEqual(order, ['b', 'a']);
});

test('listeners can observe and detach', async () => {
  const ctx = new Context();
  const seen = [];
  const off = ctx.on('x', (v) => seen.push(v));
  await ctx.emit('x', 1);
  off();
  await ctx.emit('x', 2);
  assert.deepEqual(seen, [1]);
});

test('waterfall composes middleware and tail', async () => {
  const ctx = new Context();
  ctx.on('x', async (v, next) => next(v + 1));
  ctx.on('x', async (v, next) => next(v * 2));
  const out = await ctx.waterfall('x', 1, async (v) => v + 100);
  assert.equal(out, 104);
});

test('waterfall short-circuits when a listener does not call next', async () => {
  const ctx = new Context();
  ctx.on('x', async () => 42);
  ctx.on('x', async () => 99);
  assert.equal(await ctx.waterfall('x', 1), 42);
});
