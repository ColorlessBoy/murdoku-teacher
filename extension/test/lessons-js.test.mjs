import test from 'node:test';
import assert from 'node:assert/strict';
import { getBundledLesson } from '../src/lessons.js';

test('bundled lesson loads synchronously for minigolf', () => {
  const l = getBundledLesson('puzzle-minigolf-hard');
  assert.ok(l);
  assert.equal(l.murderer, 'Elyana');
  assert.equal(l.solution.length, 10);
});

test('unknown puzzle has no bundled lesson', () => {
  assert.equal(getBundledLesson('puzzle-unknown'), null);
});
