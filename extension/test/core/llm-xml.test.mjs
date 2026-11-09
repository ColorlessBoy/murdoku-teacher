import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXmlToolCalls } from '../../src/llm.js';

test('parse XML tool calls with JSON args', () => {
  const raw = '<tool_call>board_erase{"r":1,"c":6}</tool_call>\n<tool_call>board_note{"r":2,"c":2,"who":"E"}</tool_call>\n{"text":"ok"}';
  const p = parseXmlToolCalls(raw);
  assert.equal(p.calls.length, 2);
  assert.equal(p.calls[0].function.name, 'board_erase');
  assert.deepEqual(JSON.parse(p.calls[0].function.arguments), { r: 1, c: 6 });
  assert.equal(p.calls[1].function.name, 'board_note');
  assert.equal(p.calls[1].function.arguments.includes('"E"'), true);
  assert.equal(p.text.includes('<tool_call>'), false);
  assert.equal(p.text.includes('"text":"ok"'), true);
});

test('ignore malformed XML tool call', () => {
  const p = parseXmlToolCalls('<tool_call>board_note{bad}</tool_call>text');
  assert.equal(p.calls.length, 0);
  assert.equal(p.text.includes('bad'), true);
});
