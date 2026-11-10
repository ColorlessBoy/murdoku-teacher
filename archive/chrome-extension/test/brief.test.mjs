import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief } from '../src/state.js';

test('minigolf brief uses row/column rules and no room-fill rule', () => {
  const st = {
    title: '迷你高尔夫', type: 'minigolf',
    clues: ['B = Burma：坐在一把椅子上。', 'G = Ginny：在最顶行。'],
    board: [
      { r: 1, c: 6, notes: ['D'], big: '', x: false, area: '小径', objName: '', bg: '' },
      { r: 3, c: 4, notes: ['B'], big: '', x: false, area: '沙地', objName: '椅子', bg: '' },
    ],
    facts: [], lastMarks: [], prep: null, clearedAt: 0,
  };
  const out = buildBrief(st, { ledger: '无未解决项' });
  assert.match(out, /【本关规则】/);
  assert.match(out, /每行、每列各一人/);
  assert.match(out, /没有“每间区域必须有人”/);
  assert.doesNotMatch(out, /每间房不能空/);
  assert.match(out, /小径/);
  assert.match(out, /椅子/);
});

test('brief includes private prep chain and solution', () => {
  const st = {
    title: '迷你高尔夫', type: 'minigolf', clues: [], board: [], facts: [], lastMarks: [],
    prep: { chain: ['G 必在最顶行'], solution: [{ r: 1, c: 1, who: 'G' }], pitfalls: ['别把笔记当落子'] },
    clearedAt: 0,
  };
  const out = buildBrief(st, { ledger: '无未解决项' });
  assert.match(out, /【备课（私有/);
  assert.match(out, /G 必在最顶行/);
  assert.match(out, /参考解/);
  assert.match(out, /别把笔记当落子/);
});
