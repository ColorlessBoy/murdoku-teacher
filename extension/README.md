# 墨墨 · Murdoku 陪练（浏览器扩展）

扩展内独立运行的 agent：不依赖 CDP、不依赖本地服务。你配置自己的 API Key（任意 OpenAI 兼容端点），侧栏的墨墨就能在 Murdoku 上做教学/考试陪练，并留下完整的聊天与结构化日志。

## 安装

1. 打开 Chrome → `chrome://extensions` → 打开「开发者模式」。
2. 「加载已解压的扩展程序」→ 选择本目录 `extension/`。
3. 首次安装会自动打开设置页；也可以点扩展图标 →「打开设置 / 日志」。
4. 填 Base URL、API Key、模型 → 保存 →「测试连接」。

默认值：`https://api.openai.com/v1`，模型 `gpt-4o-mini`。任何兼容 `/chat/completions` 的网关都可以。

## 使用

- 打开 `https://murdoku.com/play/...`，左侧出现墨墨。
- **教学**：一步一步讲，只给最小提示。
- **考试**：你动盘面，墨墨自动圈出改动并提问；你在底部输入框回答，墨墨审你的逻辑（VALID / GAP / INVALID / UNPROVEN），不泄题。
- `/clear`：长按原网站的「清除所有格子」按钮清盘，保留聊天与日志。
- `/new`：清空本关的聊天记录、账本、facts、旧上下文与高亮，保留当前盘面；用于清掉测试产生的无效记录。
- `/new logs`：在 `/new` 基础上同时清空诊断日志。
- ⚙：设置与日志。

## 日志

所有关键事件写入 `chrome.storage.local`（最多 4000 条，自动轮转），设置页可筛选、刷新、下载 JSON、清空。

事件包括：

- `extension.installed` / `startup`
- `content.hello`（模式、是否配置 Key）
- `board.changes`（每次盘面改动与坐标）
- `agent.run` / `agent.reply` / `agent.queued` / `agent.failed`
- `llm.request` / `llm.response` / `llm.http` / `llm.network` / `llm.no_json`
- `settings.saved` / `mode.set` / `board.clear` / `logs.cleared`

API Key、Authorization、token 等字段自动替换为 `«redacted»`；日志只存在本机，除非你主动下载。

## 架构

```
murdoku.com 页面
  content.js            侧栏 UI / 读盘 / 观察改动 / 红框 / /clear
      │ chrome.runtime
      ▼
background.js (MV3 service worker)
  ├─ agent 循环：批量改动 → prompt → LLM → 回复 + marks
  ├─ 聊天记录：chrome.storage.local（按 puzzle 分键）
  ├─ 设置：API Key / Base URL / 模型
  └─ src/log.js 结构化日志
      │
      ▼
options.html/js          设置、测试连接、日志查看/下载
popup.html/js            状态、快捷入口
src/llm.js               OpenAI 兼容调用、超时、错误分类
src/prompt.js            教学/考试 system prompt、盘面格式化
```

一次考试提问的流程：

1. content 观察盘面，700ms 批量，把 `board + changes + clues` 发给 background；
2. background 若没有挂起问题，构建 prompt 调 LLM；
3. LLM 返回 JSON `{text, marks, verdict}`；
4. content 追加气泡、画红框；问题挂起，直到你回答或墨墨回复；
5. 你回答 → 清挂起 → 带着最新盘面和聊天再调 LLM。

## 隐私

- API Key 只存 `chrome.storage.local`，不上传、不写日志。
- 盘面、聊天、线索会发送到**你配置的模型端点**；用第三方网关时请确认其隐私政策。
- 日志在本机，可随时导出/清空。

## 已知限制 / 下一步

- 侧栏是覆盖层（宽 380px），不挤压游戏布局；小屏可能挡住左侧卡片。
- 线索抓取是 best-effort（`clue`/`victim` 类名）；抓不全时墨墨会以盘面和聊天为准。
- 放置识别以单字母文本为主；纯头像放置可能漏读。
- `/clear` 用合成 pointer 事件长按清除按钮；个别页面版本可能需要手动点一次。
- 回滚/事件级历史尚未接入扩展（原型在 CDP 版本里）；日志已足够复盘。

版本：0.1.0
