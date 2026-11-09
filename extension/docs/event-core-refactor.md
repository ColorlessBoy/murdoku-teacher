# 事件核心重构（对齐 DSH）

目标：把扩展从“分散直写 + 多处 epoch 补丁”改成 **单一事件线**：
所有改变都是 SessionEvent 或 agent 事件；状态是事件投影；副作用由 effect shell 执行；
过期事件强制退出模型上下文，冲突变成可定位的 `event/rejected`。

参考：DSH `docs/architecture.zh.md`、`docs/cordis-primer.zh.md`、
`packages/core/{session,agent-loop,tools,system-prompt}`。

## 1. 不变量

1. 唯一写入口 `dispatch(event)`；chat/board/ledger/queue/marks/epoch 不再各自直写。
2. 纯 reducer / 纯投影；不 fetch、不碰 DOM、不写 storage。
3. 副作用只由 effect shell 执行，结果再作为事件回来。
4. 每个事件带 `sessionId / seq / cause / ttl / status`。
5. **模型可见即已记录**：`deriveMessages()` 只从当前 session 的 committed SessionEvent 投影。
6. 过期事件可留在 UI 历史，但绝不进模型上下文。
7. 非法事件 = `event/rejected {reason, cause}`，不静默、不互相覆盖。

## 2. DSH 映射

| DSH | 本扩展 |
|---|---|
| Cordis Context / Service / inject | 轻量 `Context`；服务 `sessions/board/chat/ledger/queue/marks/prep/llm/tools/ui/agentLoop` |
| emit / waterfall / parallel / serial / bail | 同一套事件总线；`agent/pre-step`、`agent/request`、`llm/stream`、`tools/*` 用 waterfall |
| `ctx.effect()` 可逆副作用 | 监听器、定时器、marks、队列、UI 清理都返回 disposer |
| SessionEvent 日志 | 只追加 `SessionEvent`；`deriveMessages()` |
| turn / step | 一轮 = 用户输入到无欠工作；一步 = 一次 LLM + 它调用的工具 |
| 工具流水线 | `tools/pre-execute → execute → post-execute`；工具结果带 `requestId/toolId` |
| 能力 seam | `llm`、`board`、`prep` 可替换 provider；测试用 fake |
| 投影 seam | board/chat/ledger/queue/marks 注册式投影；UI 读 snapshot |

不 vendor 完整 Cordis：MV3 service worker 无构建链，实现 Cordis-shaped 的轻量核心。

## 3. 事件分域

### 持久会话事件（append-only）

```
session/start | session/end
turn/start | turn/end
step/start | step/end
user/message
assistant/message | assistant/attempt
tool/call | tool/result
board/snapshot | board/diff
review/accept | review/challenge
queue/enqueue | queue/dequeue | queue/expire
prep/loaded
event/rejected
```

### 实时 agent 事件（waterfall / emit，不持久）

```
agent/pre-step
agent/request
llm/stream
tools/pre-execute
tools/execute
tools/post-execute
agent/turn-stopping
```

### 能力事件（seam）

```
board/read | board/action
llm/request | llm/response
prep/get
ui/render | ui/marks | ui/reset
```

## 4. turn / step

```
user/message
→ turn/start
→ agent/pre-step（准入；非当前 session 直接 reject）
→ step/start
→ agent/request → llm/stream → assistant/message
→ tool/call* → tools/pre-execute → execute → post-execute → tool/result*
→ step/end
→ 有工具欠请求 / 有下一输入 → 下一步
→ 无欠工作 → turn/end
```

- 学生“接受” = `review/accept`；只有 `waiting_review` 才允许下一步。
- 学生“质疑” = `review/challenge`；留在同一 step，开新请求解释。
- `/clear`、`/new` = `session/end`：取消 in-flight；过期所有 pending；不提交 assistant/tool 结果；
  只有 `session/end` 完成后才接受 `session/start`。
- 自动开场 = `session/start` 的一个 `step/start`，只发一次。

## 5. 上下文过期与删除

| 上下文 | 来源 | 过期 | 处理 |
|---|---|---|---|
| 模型消息 | user/assistant/tool result | session/request 过期 | `deriveMessages()` 只取当前 session committed；旧 UI 历史保留 |
| 盘面 | board/snapshot、committed tool/result | session/step 变 | 旧 diff/笔记/队列不进 projection |
| 账本问题 | step/start、review/* | step 结束 / session 变 | 旧问题关闭，不进 prompt |
| 队列 | queue/enqueue | clear/new / TTL | 整批过期，不重问 |
| marks | committed tool/result | step 结束 / 新回复 | 上一步 marks 清空 |
| prep | prep/loaded | 静态教案保留；LLM prep 按 session | 旧 session prep 丢弃 |

## 6. 工具流水线

```
tool/call {toolId, requestId, sessionId, stepId}
→ tools/pre-execute：session/step/request 不匹配 → reject
→ tools/execute：content 执行 board_note/place/x/erase，回显 toolId
→ tools/post-execute：读盘校验
→ tool/result：只有 committed 才进 board projection
```

## 7. 阶段

- **P0 基线**：tag；`core_enabled` flag；live 基线三条。
- **P1 纯核心**：Context/Event/Session/Projection + 测试；不改产品。
- **P2 Shadow**：旧逻辑镜像事件；core 投影对比；`core.divergence`。
- **P3 session/clear/new**：命令走 session/end→start；删除延迟/epoch 补丁。
- **P4 board/tools/queue/ledger**：board/diff + 工具流水线；投影。
- **P5 LLM/prompt/chat/agentLoop**：turn/step；deriveMessages；取消。
- **P6 marks/prep/UI**：marks 投影；静态教案；事件查看器。
- **P7 Cutover**：删旧直写；replay + live 回归。

## 8. 验收

- state/chat/board/ledger/queue/marks 只有 core 写入口。
- `deriveMessages` 是模型上下文唯一来源。
- 冲突日志可定位 `eventId + cause + reason`。
- stale LLM/tool 不产生消息/板书。
- clear/new 不污染新 session。
- live：`/clear`→`/new`→B→接受→E→质疑→接受，消息/板书/marks 一致。
- replay 复现任意时刻状态。

## 9. 文件

```
src/core/context.js
src/core/events.js
src/core/session.js
src/core/projections/{board,chat,marks,ledger,queue}.js
src/core/services/{llm,tools,prep,ui}.js
src/core/agent-loop.js
src/core/prompt.js
test/core/*.test.mjs
```

## 10. Phase 1 进度

- 已实现：
  - `src/core/context.js`：服务、emit/serial/parallel/waterfall、effect disposer；
  - `src/core/events.js`：事件名、状态、`makeEvent`；
  - `src/core/session.js`：append-only、pending/commit/expire/sweep、deriveMessages、audit、replay、EventStore；
  - `src/core/projections/{board,chat,marks,host}.js`；
  - `test/core/*.test.mjs`：context/session/projections/host/replay。
- 测试命令：`node --test test/core/*.test.mjs`。
- 未接入现有产品（Phase 1 无行为变化）。

## 11. Phase 2 进度（shadow）

- `src/core/shadow.js`：把旧链路的 board/chat/session 镜像进 core；
  - `board/snapshot` / `board/diff` 投影对比，divergence 时重同步并记 `core.divergence`；
  - chat 事件对比；
  - session start/end/restart。
- 接入：
  - `mm:hello`、`mm:board-sync`、`mm:clear-start`、`mm:new-session`、`handleBoardChanges`、`addChat`；
  - `mm_core_shadow` 开关默认 true，只记日志，不影响产品。
- 实测：0.8.23 页面 `core.shadow.sync board:100`，未出现 `core.divergence`。
- 尚未 shadow：LLM 请求/响应、tool call/result、turn/step；下一轮补。

### Phase 2 补充（LLM/tool/turn shadow）

- `ShadowCore` 增加 `turnStart/stepStart/llmRequest/llmResponse/toolCall/toolResult/stepEnd/turnEnd`。
- background 在 `runAgent` 每个 turn/step、每次 LLM 请求/响应、每个 tool call/result 写入 shadow；turn 结束记 `core.shadow.summary`（session/board/chat/marks/audit）。
- 单元测试覆盖事件序列 + audit 成对。
- live：`core.shadow.sync board:100`，无 `core.divergence`；LLM/tool summary 待下一轮在真实 agent run 中确认。

## 12. Phase 3 进度（session 状态机）

- 新增 `src/core/session-machine.js`：`idle → clearing → cleared → starting → active`；
  - `clear/request / clear/boardDone / new/request / new/started / auto/started`；
  - 重复 clear、clear 中 new、stale token、重复 new/started 都被 reject；
  - 只产出 effects 描述符，不执行副作用。
- `test/core/session-machine.test.mjs` 7 条全过。
- background shadow：`core.session.transition` 日志（phase/effects/rejected），不接管行为。
- live：attempted `/clear`→`/new`，CDP/page 在刷新后关闭，未拿到本轮 transition 样本；下一轮重试。

### Phase 3 gate cutover

- `/clear`、`/new` 现在先经过 session 状态机门控：
  - clear 进行中 new → 直接拒绝；
  - 重复 clear / stale token / 重复 new 被拒绝；
  - 通过后才执行旧副作用。
- 旧副作用（清盘/清 chat/epoch/auto-start）暂留，下一阶段再搬到 effects。
- 单元测试 7 条全过。
- live gate 复测受 CDP 页面挂起影响，待重试。

## 13. Phase 4 进度（tools）

- 新增 `src/core/tool-pipeline.js`：`tools/pre-execute → execute → post-execute`，
  - 缺 session/request/tool id 直接拒绝；
  - pre 可拒绝/改写 call；
  - execute 异常不崩；
  - post 可拒绝/改写 result。
- 测试 `test/core/tool-pipeline.test.mjs` 5 条全过。
- agent 工具执行已切到 `ToolPipeline`：pre 校验 epoch，execute 调 `execTool`，post 拒绝 stale。
- live：gate 序列 `clear/request → clear/boardDone → new/request → new/started → auto/started`，无 rejected。
- shadow 假阳性：board diff 不带 area/objName，比较改为只比 big/notes/x；已修并加测试。

### Phase 4 队列投影

- `src/core/projections/queue.js`：queue/enqueue/dequeue/expire、重叠合并、session end 清空。
- 测试 `test/core/queue-projection.test.mjs` 3 条全过；shadow queue 匹配/divergence。
- background `enqueueBoard` / `processQueue` / `clearQueue` 写入 shadow queue 事件并对比。
- 未接管真实队列；仅 shadow。

### Phase 4 账本投影

- `src/core/projections/ledger.js`：board/diff 开/并问题，review/accept 关闭，session/end 清空。
- `test/core/ledger-projection.test.mjs` 3 条全过。
- background `handleBoardChanges`、agent resolved 时写 shadow，比较 unresolved 计数，记 `core.divergence kind:ledger`。
- 旧账本 asked/answered 细分仍由 legacy；core 先对齐 unresolved。

### Phase 5 turn/step 投影

- `src/core/projections/turn.js`：turn/start → step/start → llm/request/response → tool/call/result → assistant/message → review/accept|challenge → turn/end。
- 记录 requests/tools/assistant/review、pendingTools、orphan 事件。
- 测试 `test/core/turn-projection.test.mjs` 4 条全过。
- shadow 注册 turn 投影；summary 增加 turnSteps。

### Phase 3 修正：clear/boardDone 由 content 驱动

- 之前 background 在 reset 后立即发 `clear/boardDone`，但盘面实际还没清完，状态机提前 cleared，
  导致 `/new` 的 boardClean=false、老师静默。
- 现在：
  - content `/clear` 先请求 `mm:clear-start`，拿到 token；
  - 实际清盘完成后发 `mm:clear-done`；
  - background 只在这之后 `clear/boardDone`。
- live：`/clear` 后 notes=0；`/new logs` 后 notes=3（B 自动开场），无 `core.divergence`。
- shadow summary 之前调用 `info()` 未 await，worker idle 可能丢日志；已改 `await info`。

### Phase 5 live summary

- 0.8.35 干净跑 `/clear → /new logs` 得到 `core.shadow.summary`：
  - board: 100, chat: 2, marks: 0, audit: [], divergence: 0。
- turnSteps 统计 bug：turn 结束后 current=null；改为取最后一个 turn 的 steps。
- 0.8.36 修复并加测试。

## 14. Phase 5 聊天读取 cutover（flag）

- `mm_core_chat` 开关：`getChat` 优先从 `ShadowCore.chat`（SessionEvent 投影）读；
- 旧 `mm_chat_` storage 继续双写，可随时回退；
- `/corechat` 开发命令切换，`mm:core-chat` 持久化；
- `mm:hello` 先读 flag 再 getChat，避免 reload 后回退。
- live 0.8.37：`/corechat` 开启 → 用户消息 → 老师回复 B 候选；ChatProjection 正常，`core.divergence` 为空。
- 未默认开启；先 dogfood。

### Phase 5 LLM binding + chat 默认

- `src/core/llm-binding.js`：`requestBound({session, requestId, stepId, messages, call, isCurrent})`
  - session 非 active 拒绝；
  - 缺 id/call 拒绝；
  - 调用前 stale 检查；
  - 调用后 stale 不写 response；
  - LLM 异常写 `llm/response status:error` 并返回。
- 测试 5 条全过。
- `mm_core_chat` 默认开启（`!== false` 才关）；旧 storage 仍双写。
- live：0.8.37 `/corechat` 开启后用户/老师消息正常，无 divergence；0.8.38 默认走同一路径。

### Phase 5 LLM binding 接入 agent

- agent 每次 LLM 请求通过 `requestBound` 绑定到 shadow Session：
  - requestId/stepId；
  - 调用前后 epoch 校验；
  - stale 不写 response；
  - LLM 异常写 error event 并保留原始错误。
- 无 shadow session 时回退旧 callLLM，保持可用。
- live 0.8.39：接受后 E 步，9 个笔记；`agent.failed/stale`、`core.divergence` 均为空。

### Phase 5 marks 读取 cutover

- agent 回复的 marks 改为优先读 `MarksProjection`（tool result 来源）；旧 actionMarks 作为 fallback。
- 旧/新不一致记 `core.marks.divergence`，不阻断回复。
- live 0.8.40：E 步 9 notes、6 个高亮；无 agent.failed/stale/divergence。

### Phase 4 队列写入 cutover（flag）

- `mm_core_queue`：开启后 `enqueueBoard` / `processQueue` 由 `QueueProjection` 决定合并/出队；
- 旧 `mm_queue_` storage 仍持久化，用于 reload 后 seed；
- `mm:hello` 和开启开关时从 storage seed，避免丢队列；
- `/corequeue` 可切换；默认关闭。
- 未 live 验证完整队列消费（需要考试模式产生排队）。

### Phase 5 SessionEvent 持久化

- `src/core/event-log.js`：compactEvent + appendCapped（默认 1200 条）。
- `ShadowCore` 增加 `onEvent`；每个 committed event 写入 `mm_events_<puzzle>`。
- 写入按 puzzle 串行链，避免并发覆盖。
- `/eventlog` 查询条数与最近事件类型。
- live 0.8.43：21 条事件，最近 assistant/user/assistant。
- 目前是 append-only 审计；尚未在 hello 时 replay/restore 投影。
