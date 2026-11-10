# Pre-commit 本地 E2E

`scripts/e2e-precommit.mjs` 不依赖 murdoku.com、真实 API Key 或外部网络。

## 它做什么

1. 起本地 HTTP server：
   - `/fixture.html`：100 格 fixture 盘面、Burma 按钮、clear 按钮；
   - `/v1/chat/completions`：mock LLM，返回 `board_note` + 同消息文本。
2. 复制扩展为临时目录，给 manifest 加 `http://127.0.0.1/*` 的 content match/host permission，并注入 mock settings。
3. Playwright 启动 Chromium（默认 headless）。
4. 断言：
   - `v0.8.70`、侧栏可见、100 格、教学模式；
   - 发送“开始教学”后写入 1 条 B 笔记；
   - 老师回复包含“请审查”；
   - 只调用一次 mock LLM（tool+text fast path）；
   - `/clear` 后笔记为 0，出现“已清空”。

headless 下扩展不可用时，脚本自动重试 headed；也可 `E2E_HEADED=1` 强制 headed。

## 安装 hook

```bash
cd extension
npm run hooks:install
```

等价于：

```bash
git config core.hooksPath .githooks
```

## 运行

```bash
cd extension
npm test          # 85 unit
npm run test:e2e  # fixture e2e
npm run precommit # both
```

`playwright-core` / Chrome 不在默认路径时，复制 `.env.precommit.example` 为 `.env.precommit` 并填绝对路径；该文件已被 gitignore。

## 跳过

```bash
SKIP_E2E=1 git commit ...
```

## 边界

- 这是本地 fixture 冒烟，不验证真实 Murdoku DOM、真实模型质量、真实 Key。
- 这些仍由 `scripts/e2e-mock.mjs`（真实站点）和 `scripts/e2e-queue.mjs`（考试队列）覆盖。
