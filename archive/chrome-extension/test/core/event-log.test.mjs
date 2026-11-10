import test from 'node:test';
import assert from 'node:assert/strict';
import { compactEvent, appendCapped } from '../../src/core/event-log.js';

test('compacts meta and caps', () => {
  const e = compactEvent({ id: 'e1', type: 'user/message', status: 'committed', seq: 1, ts: 2, payload: { text: 'hi' }, extra: 'drop' });
  assert.equal(e.extra, undefined);
  assert.deepEqual(e.payload, { text: 'hi' });
  let list = [];
  for (let i = 0; i < 5; i++) list = appendCapped(list, { id: `e${i}`, type: 'x', status: 'committed', seq: i, ts: i, payload: {} }, { max: 3 });
  assert.equal(list.length, 3);
  assert.equal(list[2].id, 'e4');
});
