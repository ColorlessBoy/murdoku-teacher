# Murdoku 陪练发布清单

版本：0.8.71  
目标：事件线重构 + 教学/考试闭环 + 整题 E2E + live 回归

## 自动测试

- 单测：86 pass / 0 fail（2026-11-09）
- mock E2E：B/E → accept → challenge → exam INVALID → clear → new → eventlog 65；options 日志下载 121 条
- 整题 E2E：教学连落 10 人 → `SUBMIT` → `CASE SOLVED`（`FULL E2E OK calls 20 turns 10`）
- exam queue E2E：第一批 audit INVALID，第二批排队，模型只调一次

覆盖：

- Context / Event / Session / projections
- 过期、撤销、session end
- turn/step
- tool pipeline
- session state machine
- queue / ledger projections
- chat/board/marks shadow
- event log cap
- LLM binding
- 旧工具/prompt/lesson tests

## Live 已验证（0.8.56–0.8.65）

- 教学 accept → 下一步（E、G、A 步）
- 教学 challenge → 解释且不动盘面
- 考试 audit → INVALID，不改盘面
- `/clear` → 0 notes
- `/new logs` → 3 notes + auto-start
- reload → 事件线 restore chat+board
- board context 100/100
- thinking status / 65s timeout
- MV3 keepalive：agent 完成后才 sendResponse

## 发布阻塞（未达发布级）

1. 真实 API Key 的 0.8.69 live 回归未跑（需主 Chrome 手动 reload）。
2. 单轮 30–50 秒，接近 65 秒超时；模型工具轮次多。
3. 旧 storage 双写保留：chat/queue/board（0.8.68 后默认 core，仍作 fallback）。
4. 事件日志 cap 1200/关卡，未做 30 天归档。
5. 143 个提交只在本地，GitHub 仍停在初始提交（交付/备份风险）。

## 发布前必须完成

- [x] board 读/写 cutover（默认 core，可 `off` 回退）
- [x] ledger 读/写入 cutover（默认 core，可 `off` 回退）
- [x] queue 写入 cutover（默认 core）
- [x] chat 读 cutover（默认 core）
- [x] 整题 E2E（10 人 → SUBMIT → CASE SOLVED）
- [x] 考试 core queue E2E
- [x] options/日志下载 E2E
- [ ] 真实 API live 回归（0.8.69）
- [ ] 删除旧 epoch/延迟补丁
- [ ] 30 天事件日志/容量策略
- [ ] 版本号/README/发布说明一致性（0.8.69）
- [ ] 推送本地提交到 GitHub

## 最新 E2E

- [x] 教学 step1/accept step2
- [x] challenge 不动盘
- [x] clear/new
- [x] eventlog
- [x] exam audit 不改盘
- [x] ledger/queue write 默认值
- [x] **整题 10 人 + SUBMIT → CASE SOLVED**
- [x] options/日志下载
- [x] exam core queue

## 当前结论

三模式主路径 + 整题闭环已自动验证通过；事件线核心已接入并 live 验证。  
仍不能标发布完成：0.8.69 真实 API live 回归未跑，旧 storage 双写/事件日志归档未收口，
本地 143 个提交未推送。
