# Murdoku 陪练扩展 · 开发日志

## 0.7.12
- `#mm-debug` 增加 `prepStatus` / `prepChain` / `queue`，便于无 UI 诊断。
- 版本徽标改为运行时读取 manifest，不再硬编码。

## 0.7.11
- 备课状态持久化（idle/running/done/failed + prepAt），防止 service worker 重启后重复备课。
- 备课显式 60s 超时；失败后 60s 内不重试，之后由 board change / agent run 兜底重试。
- 队列批次按重叠格合并，避免同一个 D 笔记重复出队。

## 0.7.10
- 备课（私有 solve）：参考解 + 推理链 + 易错点，只在 brief 中给考官，不允许泄给学生。
- 盘面实时刷新：`runAgent` 前 `mm:read-board`，不再使用检测时的快照。
- 串行闸门：未解决问题时新批次入队；VALID/关闭后出队。
- `/reload` 开发命令 + `onInstalled` 自动 reload Murdoku 页面，闭环开发。

## 0.7.9
- 游戏规则按关卡类型注入：迷你高尔夫只有每行/每列各一人，没有“每区域必须有人”。
- 玩法说明确认：点击=笔记，长按=放置，X=排除；嫌疑人不能放物件格。

## 0.7.7
- 无理由的盘面改动，`INVALID/VALID` 降为 `GAP`，先问理由。
- `tighten` 检测到“应标/应放/正确的是/下一步”时强制改为“你的依据是什么？”。

## 测试记录
- 2026-11-09 00:23：D 笔记 R1C6 被正确检测；老师抓出 Ginny 顶行矛盾，但直接说“应标 X”泄答案 → 0.7.6/0.7.7 修。
- 2026-11-09 00:23：学生提交“Ginny 在最顶行，R1C6 不能是 D”，老师回 `结论：VALID` + 一个问题，合格。
- 2026-11-09 00:23：队列出现 7 个重复 D 笔记批次 → 0.7.11 合并重叠队列。
- 2026-11-09 01:xx：游戏页卡在“正在同步进度”，外部站点/网络问题，暂停 live 测试。

## 待办
- 备课实际质量评估（当前游戏同步失败，未拿到 prep.done）。
- 队列在页面重载后的陈旧批次清理策略。
- 迷你高尔夫规则下，老师对“区域/小径”类线索的审题回归。
- UI 自动化回归脚本（不依赖 live 游戏时用 mock board）。

## 0.7.14
- 抽出纯函数模块：`src/queue.js`（批次合并）、`src/format.js`（tighten/condense），便于离线测试。
- 新增 `test/queue.test.mjs`、`test/format.test.mjs`、`test/brief.test.mjs`，共 10 条测试全过。
- 回归覆盖：重叠队列合并、考试模式防泄答案、未证明枚举压缩、迷你高尔夫规则 brief、备课 brief。
- 测试命令：`node --test test/*.test.mjs`。

## 0.7.17
- 备课 watchdog：`chrome.alarms` 每分钟唤醒；stale running 90s 后允许重试。
- 备课 fetch 超时 30s，避免 service worker 挂起导致永远 `running`。
- 新增 `alarms` 权限。

## 0.7.17 tests
- 新增 `test/ledger.test.mjs`：首次开问题、同批合并、asked 被新改动 supersede、answer+VALID 关闭、关闭后新问题。
- 共 14 条测试全过。

## 0.8.10
- 教学模式反转为“老师解题，学生质疑”：
  - 老师主动开场（`/new` 后自动说“今天我们来玩迷你高尔夫”并直接开始第一步）；
  - 老师用 `board_note` / `board_place` / `board_x` / `board_erase` 直接操作盘面；
  - 老师做完一步必须停下等学生明确“接受/继续/对/同意”；
  - 学生质疑/不接受时，只解释同一步直到接受，不跳下一步；
  - 教学输出不再被 `tighten` 截断，tutor 输出上限 8192。
- 老师动作触发审查提示“老师动作：…请审查这条推理”。
- `/new` 后按后台完整 chat 重绘，保留老师开场和动作审查。
- 实测：
  - `/new` → 老师开场 + B 笔记 R3C4/R10C7/R10C8；
  - 学生质疑“只标 R3C4 行不行” → 老师同一步逐条解释，未跳步；
  - 学生“接受，继续” → 老师走 E 沙地一步，写 6 个 e 笔记并继续等接受。

## 0.8.23
- Phase 2 shadow：`src/core/shadow.js` + background 接入。
- shadow 覆盖 session/board/chat；`core.shadow.start/sync`、`core.divergence` 日志。
- `mm_core_shadow` 可关闭；默认只观察，不影响产品。
- live：`core.shadow.sync board:100`，无 divergence。

## 0.8.24
- Phase 2 shadow 扩展：turn/step、llm request/response、tool call/result、summary。
- `core.shadow.summary` 输出 session/board/chat/marks/audit。
- core 单元测试全过；live board sync 无 divergence。

## 0.8.25
- Phase 3 session 状态机纯核心 + 7 条测试。
- background shadow 记 `core.session.transition`，不接管 clear/new。
- live transition 样本受 CDP 页面关闭影响，待重试。
