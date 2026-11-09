# 真实浏览器全解 E2E

`scripts/e2e-full.mjs`：真实 Chrome + 真实 Murdoku 盘面 + 真实扩展 + 本地 mock LLM。

## 为什么需要它

`board_note` 的合成 click 能写笔记，但 Murdoku 的“落子”要求 press & hold；
只测 note 会误以为盘面操作通过。全解 harness 是唯一能验证“10 个落子 + SUBMIT + CASE SOLVED”的回归。

## 修复

`board_place` 改为：

1. content 发 `mm:place-cell`；
2. background 用 `chrome.scripting.executeScript({world:'MAIN'})`；
3. 直接调用人物按钮的 React `onClick`（绕过 pointer 计时器）；
4. 在可见 cell 上派发 pointer/mouse 长按 1600ms。

真实浏览器探针确认：合成 DOM click 选不中人物、合成长按只写笔记；React onClick + 主世界 pointer 才能落子。

## 0.8.71 结果

```
tutor: 10 个 board_place；CASE SOLVED；Elyana (E) killed Valeria (V)
exam: 新 profile 重开；学生完整解；mock VALID；CASE SOLVED
FULL E2E OK calls 12 tutorMsgs 10 examMsgs 2
```

## 运行

```bash
PLAYWRIGHT_CORE=... CHROME_PATH=... node scripts/e2e-full.mjs
```

默认 headless。需要网络访问 murdoku.com。  
这不是模型能力测试：mock 按官方 lesson solution 落子，exam mock 返回 VALID；真实模型/Key 仍需要 live 回归。
