# 整题 E2E：老师连落 10 人并提交判定

`scripts/e2e-full.mjs`：真实扩展 + 真实迷你高尔夫盘面 + mock LLM。

mock 按内置教案 `lessons/puzzle-minigolf-hard.json` 的 `solution`，每次接受返回下一步
`board_place`；测试在每一步后发送“接受，继续下一步”，十人落齐后点游戏 `SUBMIT`，
断言结果弹窗出现 `CASE SOLVED` / `You've found the murderer!`。

## 覆盖

- 首次进入的 `Welcome, detective` 教学弹窗用真实 `Skip` 关闭（不绕过点击屏障）；
- 10/10 角色经产品工具 `board_place` 落位，盘面逐步推进；
- 每一步助手卡片要求审查，接受后才走下一步；
- 游戏 `SUBMIT` → 判定 `CASE SOLVED`（Elyana 杀 Valeria）。

## 0.8.69 结果

```
step 1 … step 10 placed G I B V H E D C F A
submit SUBMIT
RESULT TAIL: … CASE SOLVED … You've found the murderer! Elyana (E) killed Valeria (V)! …
FULL E2E OK calls 20 turns 10
```

## 运行

```bash
PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
CHROME_PATH="/path/to/Google Chrome for Testing" \
node scripts/e2e-full.mjs
```

这是对 `e2e-mock.mjs`（教学两步 + challenge/exam/clear/new/eventlog）的补充：
后者验证模式与链路，本脚本验证“整题闭环”。

## 已知限制

- mock LLM 只回放内置教案的既定解，不验证真实模型的推理质量；
- 游戏页需要联网加载；页面首次打开会弹 Welcome 教学，脚本用真实 `Skip` 关闭；
- 单次运行约 40–60 秒（十步，每步一次 mock 轮次）。
