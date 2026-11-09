# 考试 core queue E2E

`scripts/e2e-queue.mjs` 用真实扩展 + 真实盘面 + mock LLM 验证：

- 考试模式，core queue flag on；
- 第一批学生笔记 → 老师 audit INVALID，账本仍未解决；
- 第二批学生笔记 → 不调用模型，进入队列；
- 侧栏状态“排队中（等上一问解决）”。

0.8.67 结果：

```
notes 1, state 墨墨已回复
notes 2, state 排队中（等上一问解决）
calls 1
QUEUE E2E OK
```

运行：

```bash
PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
CHROME_PATH="/path/to/Google Chrome for Testing" \
node scripts/e2e-queue.mjs
```
