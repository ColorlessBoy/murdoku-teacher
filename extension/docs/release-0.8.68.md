# 墨墨 · Murdoku 陪练 0.8.69 发布说明

## 升级

1. `chrome://extensions`
2. 找到「墨墨 · Murdoku 陪练」
3. 点「重新加载」
4. 刷新 Murdoku 页面
5. badge 应为 `v0.8.69`

## 本版核心

- 事件线：SessionEvent 日志、投影（board/chat/marks/queue/ledger/turn）、turn/step、ToolPipeline、LLM binding。
- 事件持久化 + reload restore（chat/board）。
- board 读/写默认 core；
- chat 读默认 core；
- ledger 读/写默认 core；
- queue 写默认 core；
- 旧 storage 作为 fallback/双写保留。
- 教学：老师动盘 + 2-4 句解释 + 等待接受；challenge 不动盘。
- 考试：只 audit，不改盘。
- `/clear` / `/new` 由 session 状态机驱动，content 清盘完成才推进。
- `/eventlog` 查看事件线。
- 英文 UI 的 clear/erase 选择器。

## 本版修复

- background TDZ（coreBoardWriteEnabled 声明顺序）导致 service worker 启动失败；
- hello 的 const ledgerState 重赋值；
- hello 冷启动重试；
- 侧栏先显示再加载 React bridge；
- 英文 `hold to clear all squares` 清盘；
- options 用 tabs.create 兜底；
- stale clearedAt 导致老师反复说“盘面刚被清空”。

## 自动验证

- `node --test test/*.test.mjs test/core/*.test.mjs`：86 pass。
- mock E2E：B → accept E → challenge → exam INVALID → clear → new → eventlog 65。
- 整题 E2E：教学连落 10 人 → SUBMIT → 游戏判定 `CASE SOLVED`（`FULL E2E OK calls 20 turns 10`）。
- options：设置页、日志下载 121 条。
- exam queue：第一批 audit INVALID，第二批排队，模型只调一次；默认 flag 下通过。

## 已知限制

- 真实 API Key 的 0.8.69 live 回归需在重载后的主 Chrome 跑；
- 单轮模型延迟 30–50 秒；
- 旧 storage 双写仍保留作为 fallback；
- 事件日志 cap 1200/关卡，未做 30 天归档。

## 回退

- `/coreboardwrite off`：恢复旧 board 写入；
- `/coreledgerwrite off`：恢复旧 ledger 写入；
- `/corequeue off`：恢复旧 queue 写入；
- `/corechat off`：chat 读回退 storage；
- `/coreledger off` / `/coreboard off`：读回退。
