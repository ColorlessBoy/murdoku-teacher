import test from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_TUTOR, SYSTEM_EXAM, buildMessages } from '../src/prompt.js';

test('tutor prompt enforces acceptance gate and no student questions', () => {
  assert.match(SYSTEM_TUTOR, /只有学生明确说/);
  assert.match(SYSTEM_TUTOR, /请审查/);
  assert.match(SYSTEM_TUTOR, /说人话/);
  assert.doesNotMatch(SYSTEM_TUTOR, /前提 → 规则/);
  assert.match(SYSTEM_TUTOR, /不要向学生提问/);
  assert.doesNotMatch(SYSTEM_TUTOR, /若无异议，我继续下一步/);
});

test('exam prompt bans next-move leaks', () => {
  assert.match(SYSTEM_EXAM, /应标 X/);
  assert.match(SYSTEM_EXAM, /绝不泄露/);
});

test('auto-start adds a tutor opening instruction', () => {
  const m = buildMessages({ mode: 'tutor', brief: 'brief', puzzle: 'p', autoStart: true });
  assert.match(m[1].content, /教学开场/);
  assert.match(m[1].content, /今天我们来玩迷你高尔夫/);
  assert.match(m[1].content, /停下等接受/);
});
