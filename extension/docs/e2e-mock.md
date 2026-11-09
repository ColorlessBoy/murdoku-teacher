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

## 选项页/日志下载

产品路径是侧栏 ⚙ → `chrome.runtime.openOptionsPage`。  
在 Playwright 独立 Chromium 里该调用没有被捕获为新 page，E2E 目前只记录、不判失败。  
发布前需要手动回归：打开设置页，确认日志列表和“下载 JSON”。

## 0.8.67 options

- 侧栏 ⚙ 现在通过 `chrome.tabs.create(options.html)` 兜底打开设置页。
- E2E 已能打开 options：
  - title「墨墨 · Murdoku 陪练 · 设置」
  - baseUrl/model 正确
  - 下载按钮生成 JSON
- 日志下载是**数组**，不是 `{logs}`；E2E 断言已修正。

## 0.8.67 options 复跑

```
options: title 设置 / baseUrl 127.0.0.1 / model mock / hasDownload true
download: murdoku-logs-*.json logs 129
E2E3 OK calls 11 turns 3
```

## 0.8.69 fast path

mock 在 tool_call 消息里同时返回 text；agent 直接使用，不再二次请求：

```
0.8.68: 11 mock calls
0.8.69: 8 mock calls
step1/step2/new 各少一次 LLM 调用
E2E3 OK
```

真实模型是否配合取决于 prompt；不配合时回退原路径。
