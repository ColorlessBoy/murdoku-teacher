import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setLedgerBackend, setLedgerEventSink, recordChanges, answerQuestion,
  closeQuestion, getLedger, clearLedger,
} from '../../src/ledger.js';

test('ledger write backend stores state and emits events', async () => {
  let st = { seq: 0, batches: [], cells: {}, questions: [] };
  let cleared = false;
  const events = [];
  setLedgerEventSink((e) => events.push(e));
  setLedgerBackend({
    load: async () => (cleared ? { seq: 0, batches: [], cells: {}, questions: [] } : st),
    save: async (_p, next) => { st = next; return true; },
    clear: async () => { cleared = true; st = { seq: 0, batches: [], cells: {}, questions: [] }; return true; },
  });
  try {
    const rec = await recordChanges({ puzzle: 'p', changes: [{ r: 3, c: 4, after: { notes: ['B'] } }] });
    assert.ok(rec.question);
    assert.equal(events.filter((e) => e.type === 'ledger/question').length, 1);
    const answered = await answerQuestion('p', 'why R3C4');
    assert.equal(answered.answer, 'why R3C4');
    assert.ok(events.some((e) => e.type === 'ledger/answered'));
    const closed = await closeQuestion('p', 'INVALID');
    assert.equal(closed.status, 'closed');
    assert.ok(events.some((e) => e.type === 'ledger/closed'));
    const led = await getLedger('p');
    assert.equal(led.counts.questions, 1);
    assert.equal(led.counts.unresolved, 0);
    await clearLedger('p');
    assert.ok(events.some((e) => e.type === 'ledger/cleared'));
    const after = await getLedger('p');
    assert.equal(after.counts.questions, 0);
  } finally {
    setLedgerBackend(null);
    setLedgerEventSink(null);
  }
});
