# Live 回归前置

当前 Chromium 里加载的扩展仍是 0.8.61；磁盘代码已 0.8.62。
通过 CDP 无法 reload chrome:// 页面，也不能访问 chrome.developerPrivate，所以需要手动重载。

## 手动步骤

1. 打开 `chrome://extensions`
2. 找到「墨墨 · Murdoku 陪练」
3. 点「重新加载」按钮
4. 回到 Murdoku 页面刷新一次
5. 确认右下角 badge 是 `v0.8.62`
6. 确认侧栏可见；如果不可见，打开扩展 popup，把「启用」打开

## 重载后要跑的回归

- `/coreboardwrite on`
- `/coreledgerwrite on`：应出现 “core ledger write 已开启”
- 教学 accept：老师下一步，无静默/fallback/divergence
- 教学 challenge：老师解释，不动盘面
- 考试 audit：老师只审计
- `/clear` → notes 0
- `/new logs` → auto-start 3 notes
- reload → restore chat+board，无 divergence
- 考试 queue：学生连续改动，老师 audit，accept 后 dequeue
- `/eventlog` 条数增长
- 设置页/日志导出

## 若侧栏仍隐藏

0.8.62 已把 `applyEnabled` 提前到 React bridge 之前，并 timebox 2.5s；
若仍隐藏，检查：

- `mm_enabled` 是否为 false（popup）
- content script 是否加载（badge/侧栏 DOM）
- service worker 是否正常（设置页测试 LLM）
