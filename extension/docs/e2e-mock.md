# Mock LLM 端到端冒烟

`scripts/e2e-mock.mjs`：真实扩展 + 真实 Murdoku 盘面 + 本地 mock LLM。

## 覆盖

1. 教学 step1：mock tool_call → board_note B R3C4 → 文本
2. accept step2：mock tool_call → board_note E R2C2 → 文本
3. challenge：mock 不发工具，解释候选；盘面不变
4. exam：mock 只 audit；盘面不变
5. `/clear`：清盘，notes 0
6. `/new`：自动开场，notes 1
7. `/eventlog`：65 条
8. `mm_core_ledger_write=true` 下的 ledger 事件

## 0.8.66 结果

```
step1 notes 1
step2 notes 2
challenge notes 2（未改盘）
exam notes 2（未改盘，INVALID）
cleared notes 0
fresh notes 1
eventlog 65 条
E2E3 OK calls 11 turns 3
```

## 运行

```bash
PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
CHROME_PATH="/path/to/Google Chrome for Testing" \
node scripts/e2e-mock.mjs
```
