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

test('lesson chain is step-by-step and covers candidates before solution', () => {
  assert.ok(Array.isArray(lesson.chain));
  assert.ok(lesson.chain.length >= 7);
  const joined = lesson.chain.join('\n');
  assert.match(joined, /第1步/);
  assert.match(joined, /候选/);
  assert.match(joined, /官方解/);
  assert.match(joined, /不能直接报/);
  assert.ok(lesson.pitfalls.some((p) => /候选|接受|答案/.test(p)));
});
