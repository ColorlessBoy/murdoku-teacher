# Mock LLM 端到端冒烟

`scripts/e2e-mock.mjs` 用真实扩展 + 真实 Murdoku 盘面 + 本地 mock LLM 验证：

- 侧栏显示
- hello 初始化
- 教学模式 auto-start / 用户消息
- LLM binding（mock 返回 tool_call）
- ToolPipeline → board_note
- 盘面实际出现笔记
- 老师文本回复
- 版本 badge

它不验证真实模型质量，只验证扩展链路。

```bash
PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
CHROME_PATH="/path/to/Google Chrome for Testing" \
node scripts/e2e-mock.mjs
```

当前已通过 0.8.65：

- cells 200
- 老师写 R3C4 B
- notes 1
- 回复含“请审查”
- mock 两轮（tool + text）
