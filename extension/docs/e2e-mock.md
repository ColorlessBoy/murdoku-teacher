# Mock LLM 端到端冒烟

`scripts/e2e-mock.mjs`：真实扩展 + 真实 Murdoku 盘面 + 本地 mock LLM。

覆盖：

- 侧栏显示 / hello
- 教学第一步：mock tool_call → board_note B R3C4 → 文本
- 接受：第二步 tool_call → board_note E R2C2 → 文本
- 考试：不发工具，只 audit；盘面不变
- `/eventlog` 条数
- `mm_core_ledger_write=true` 下的 ledger 事件

0.8.65 结果：

```
step1 notes 1
step2 notes 2
exam notes 2（未改盘）
exam reply 结论：INVALID
eventlog 28 条
mock calls 5 / turns 2
E2E2 OK
```

运行：

```bash
PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
CHROME_PATH="/path/to/Google Chrome for Testing" \
node scripts/e2e-mock.mjs
```
