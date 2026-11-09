# Murdoku 陪练发布清单

版本：0.8.59  
目标：事件线重构 + 教学/考试闭环 + live 回归

## 自动测试

- `node --test test/*.test.mjs test/core/*.test.mjs`
- 结果：84 pass / 0 fail（2026-11-09）

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

## Live 已验证

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

1. board 写入仍走旧 state/storage；core 只读上下文。
2. ledger 写入仍走旧 storage；core ledger 只 shadow。
3. 旧 storage 双写：chat/queue/board。
4. 单轮 30–50 秒，接近 65 秒超时；模型工具轮次多。
5. 模型可能返回空 content，现有 contextual fallback 未完全消除。
6. core queue 仅 flag，完整考试队列消费未 live 验证。
7. 设置页/日志导出/回退未做最新回归。

## 发布前必须完成

- [x] ledger 读 cutover（core，mm_core_ledger，live challenge 通过）
- [ ] ledger 写入 cutover（旧 storage 仍权威，core 已镜像）
- [x] board 写入 cutover（flag，live；core board 权威，工具读 core）
- [ ] 删除旧 epoch/延迟补丁
- [ ] 考试模式 core queue 完整消费
- [ ] 设置页/日志导出/回退回归
- [ ] 30 天事件日志/容量策略
- [ ] 版本号与 README 发布说明

## 当前结论

三条用户主路径可用；架构核心（事件线、投影、turn/step、工具流水线）已接入并 live 验证。  
但按“单一事件线”目标，board/ledger 写入尚未 cutover，**不能标发布完成**。
