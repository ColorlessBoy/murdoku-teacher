import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolPipeline } from '../../src/core/tool-pipeline.js';

const ctx = { sessionId: 's1', requestId: 'r1', toolId: 't1', stepId: 'st1' };

test('requires session/request/tool ids', async () => {
  const p = new ToolPipeline({ execute: async () => 'x' });
  const r = await p.run({}, {});
  assert.equal(r.ok, false);
  assert.equal(r.rejected, 'missing_ids');
});

test('pre-execute can reject before execute', async () => {
  let called = 0;
  const p = new ToolPipeline({ execute: async () => { called++; return 'x'; } });
  p.usePre(() => ({ rejected: 'stale_session' }));
  const r = await p.run({}, ctx);
  assert.equal(r.rejected, 'stale_session');
  assert.equal(called, 0);
});

test('pre-execute can rewrite the call', async () => {
  const p = new ToolPipeline({ execute: async (call) => call });
  p.usePre((call) => ({ call: { ...call, args: { ...call.args, r: 3 } } }));
  const r = await p.run({ name: 'board_note', args: { r: 1 } }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.call.args.r, 3);
});

test('post-execute can reject or transform', async () => {
  const p = new ToolPipeline({ execute: async () => ({ cell: { r: 3, c: 4 } }) });
  p.usePost((result) => ({ result: { ...result, checked: true } }));
  const r = await p.run({}, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.result.checked, true);

  const q = new ToolPipeline({ execute: async () => ({}) });
  q.usePost(() => ({ rejected: 'board_mismatch' }));
  const bad = await q.run({}, ctx);
  assert.equal(bad.rejected, 'board_mismatch');
});

test('execute errors do not crash the pipeline', async () => {
  const p = new ToolPipeline({ execute: async () => { throw new Error('boom'); } });
  const r = await p.run({}, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'boom');
});
