import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lesson = JSON.parse(readFileSync(new URL('../lessons/puzzle-minigolf-hard.json', import.meta.url), 'utf8'));

test('bundled lesson is a valid Latin square assignment', () => {
  assert.equal(lesson.solution.length, 10);
  const rows = new Set(), cols = new Set(), who = new Set();
  for (const c of lesson.solution) {
    assert.ok(c.r >= 1 && c.r <= 10 && c.c >= 1 && c.c <= 10);
    rows.add(c.r); cols.add(c.c); who.add(c.who);
  }
  assert.equal(rows.size, 10);
  assert.equal(cols.size, 10);
  assert.deepEqual([...who].sort(), ['A','B','C','D','E','F','G','H','I','V']);
});

test('bundled lesson names murderer and never leaks via flag', () => {
  assert.equal(lesson.murderer, 'Elyana');
  const e = lesson.solution.find((c) => c.who === 'E');
  assert.ok(e);
  assert.match(lesson.chain.join(' '), /凶手/);
});
