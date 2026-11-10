import test from 'node:test';
import assert from 'node:assert/strict';
import { tighten, condense } from '../src/format.js';

test('exam mode strips next-move leak and asks for reason', () => {
  const out = tighten('结论：INVALID\nG 独占最顶行，D 不能占 R1C6；应标 X，不是候选。', 'exam');
  assert.match(out, /^结论：INVALID/);
  assert.match(out, /你的依据是什么/);
  assert.doesNotMatch(out, /应标 X/);
});

test('exam mode appends a question when verdict has none', () => {
  const out = tighten('结论：GAP\nR1C6 与 Ginny 在顶行矛盾。', 'exam');
  assert.match(out, /你的依据是什么/);
});

test('keeps a genuine question', () => {
  const out = tighten('结论：GAP\nR1C6 在顶行，你把 D 放这里的理由是什么？', 'exam');
  assert.match(out, /理由是什么/);
});

test('condense removes per-cell unproven enumerations', () => {
  const out = condense('结论：GAP\nR1C1:G——未证明；R1C2:G——未证明。\n请先回答 R2C6。');
  assert.match(out, /2 格“未证明”已省略/);
  assert.match(out, /请先回答 R2C6/);
  assert.doesNotMatch(out, /R1C1:G——未证明/);
});

test('condense leaves short text unchanged', () => {
  const text = '结论：VALID\n可以。';
  assert.equal(condense(text), text);
});

test('tutor keeps full long explanation (no tightening)', () => {
  const long = '今天我们来玩迷你高尔夫。\n' + '这是很长的逻辑解释，'.repeat(40) + '请审查这一步；你接受后我再走下一步。';
  assert.equal(tighten(long, 'tutor'), long);
});
