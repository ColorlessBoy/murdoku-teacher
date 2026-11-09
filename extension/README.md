# 墨墨 · Murdoku 陪练（Chrome 扩展）

在 Murdoku 页面右侧注入墨墨侧栏，支持**教学模式**与**考试模式**，并带事件溯源内核。

当前版本：**0.8.75**

## 安装

1. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选本目录；
2. 打开 Murdoku 关卡页，右侧出现侧栏；
3. 点 ⚙ 配置 API Key / Base URL / 模型（任意 OpenAI 兼容端点）。

## 模式

- **教学**：老师解题并直接操作盘面（笔记/放置/X），每步用 2-4 句说清理由；做完停下等学生明确“接受/继续”。学生质疑时先解释，不改盘、不跳到下一步。
- **考试**：学生解题，老师只审计（VALID/INVALID/GAP），不替学生落子，不泄露答案。

## 命令

- `/clear`：清盘面（放置/笔记/X），由 content 实际清完后再推进 session 状态；
- `/new`：清空聊天、账本、旧上下文，盘面保留；教学模式下自动开场；
- `/new logs`：同上并清空日志；
- `/eventlog`：查看事件线条数与最近类型；
- `/corechat`：chat 读取切到 SessionEvent 投影（默认已开）；
- `/coreboard`：board 上下文切到 BoardProjection（默认已开）；
- `/coreboardwrite`：board 写入切 core（默认已开，可 `off` 回退）；
- `/coreledger`：ledger 读取切 core（默认已开）；
- `/coreledgerwrite`：ledger 写入 backend（默认开，`off` 回退）；
- `/corequeue`：queue 写入 projection（默认开，`off` 回退）；
- `/reload`：开发用，重载扩展并刷新页面。

## 发布说明

[0.8.69 发布说明](docs/release-0.8.68.md)

## 事件内核

事件线重构见 [docs/event-core-refactor.md](docs/event-core-refactor.md)。

- SessionEvent append-only 日志 + 投影（board/chat/marks/queue/ledger/turn）；
- turn/step、LLM request/response、tool call/result；
- ToolPipeline（pre/execute/post）；
- session/clear/new 状态机；
- 事件持久化 `mm_events_*`，reload 后 restore chat+board；
- LLM binding 绑定 session/request，前后 epoch 校验。

## 开发与测试

```bash
node --test test/*.test.mjs test/core/*.test.mjs
```

当前：**86 pass / 0 fail**（含 core/session/projection/tool/turn/ledger/queue/llm 测试）。

端到端（真实扩展 + 真实盘面 + mock LLM）：

```bash
PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
CHROME_PATH="/path/to/Google Chrome for Testing" \
node scripts/e2e-mock.mjs      # 教学两步 + challenge/exam/clear/new/eventlog
node scripts/e2e-full.mjs      # 整题：连落 10 人 + SUBMIT → CASE SOLVED
node scripts/e2e-queue.mjs     # 考试队列：第一批 audit，第二批排队
```

覆盖：教学 B/E、accept、challenge、exam、clear、new、eventlog；整题闭环；
options 页/日志下载；考试 core queue。

## 发布状态

- 三条用户主路径（教学 accept / challenge / 考试 audit）已通过 mock E2E；
- 整题闭环已通过 full E2E：10 人落位、SUBMIT、游戏判定 `CASE SOLVED`；
- 清盘、新会话、reload restore、board 100/100、thinking/keepalive 已 live/mock 验证；
- 真实 API Key 的最新 0.8.69 live 回归仍需在加载了 Key 的 Chrome 手动 reload 后执行；
- 已知限制：
  - 单轮模型延迟 30-50 秒；
  - options 页/日志下载已由 E2E 覆盖，仍建议 live 手动复核；
  - 旧 storage 双写保留作为 fallback；
  - 事件日志 cap 1200/关卡，未做 30 天归档。

## 隐私

API Key 只存 `chrome.storage.local`；日志里对 Key/Authorization 脱敏；除所配置模型端点外不发送盘面/对话。

## Pre-commit 本地 E2E

```bash
cd extension
npm run hooks:install
```

之后每次 `git commit` 会自动跑：

1. 85 个单元测试；
2. 本地 fixture E2E（mock LLM，不需要真实 Key / murdoku.com）。

详见 [docs/pre-commit-e2e.md](docs/pre-commit-e2e.md)。

## 真实双模型交互

```bash
cd extension
cp .env.model.example .env.model   # 填真实教师/学生模型
node scripts/e2e-real-models.mjs
```

不使用官方解脚本或 mock；详见 [docs/real-model-interaction.md](docs/real-model-interaction.md)。
