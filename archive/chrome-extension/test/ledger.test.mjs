import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (key == null) return Object.fromEntries(store);
        return { [key]: store.get(key) };
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
      async remove(key) { store.delete(key); },
    },
  },
};

const { recordChanges, markAsked, answerQuestion, closeQuestion, getLedger } = await import('../src/ledger.js');

const note = (r, c, who = 'D') => ({ r, c, before: null, after: { big: '', notes: [who], x: false } });

test('first batch creates one open question; second merges', async () => {
  const p = 'test-a';
  const a = await recordChanges({ puzzle: p, changes: [note(1, 6)] });
  assert.equal(a.created, true);
  assert.equal(a.unresolved.length, 1);
  const b = await recordChanges({ puzzle: p, changes: [note(1, 7)] });
  assert.equal(b.created, false);
  assert.equal(b.unresolved.length, 1);
  assert.equal(b.question.cells.length, 2);
});

test('asked question is superseded by a new board change', async () => {
  const p = 'test-b';
  await recordChanges({ puzzle: p, changes: [note(1, 6)] });
  await markAsked(p);
  const b = await recordChanges({ puzzle: p, changes: [note(2, 5)] });
  assert.equal(b.created, true);
  assert.equal(b.unresolved.length, 1);
});

test('answer + VALID close clears unresolved', async () => {
  const p = 'test-c';
  await recordChanges({ puzzle: p, changes: [note(1, 6)] });
  await answerQuestion(p, 'Ginny 在顶行，所以 D 不能在这里');
  await closeQuestion(p, 'VALID');
  const led = await getLedger(p);
  assert.equal(led.unresolved.length, 0);
});

test('new change after close creates a new question', async () => {
  const p = 'test-d';
  await recordChanges({ puzzle: p, changes: [note(1, 6)] });
  await answerQuestion(p, 'reason');
  await closeQuestion(p, 'VALID');
  const b = await recordChanges({ puzzle: p, changes: [note(3, 4, 'B')] });
  assert.equal(b.created, true);
  assert.equal(b.unresolved.length, 1);
});
