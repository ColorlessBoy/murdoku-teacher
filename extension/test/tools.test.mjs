import test from 'node:test';
import assert from 'node:assert/strict';
import { toolsForMode } from '../src/tools.js';

test('exam mode is read-only: no board action tools', () => {
  const names = toolsForMode('exam').map((t) => t.function.name);
  assert.ok(names.includes('get_board'));
  assert.ok(!names.some((n) => n.startsWith('board_')));
});

test('tutor mode can operate the board', () => {
  const names = toolsForMode('tutor').map((t) => t.function.name);
  for (const n of ['board_note', 'board_place', 'board_x', 'board_erase']) assert.ok(names.includes(n), n);
});
