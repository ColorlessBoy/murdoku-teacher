# archive/ — 已放弃的旧方案

这里的东西**不再维护**，只作历史参考。当前唯一维护的路线是 `dsh-webpane/`（集成进 DSH 的侧边栏插件）。

## chrome-extension/（原 `extension/`）

早期的 **Chrome 扩展 + Playwright/CDP** 方案：扩展负责在真实 Chrome 里注入内容脚本、经 CDP（Playwriter 桥，`127.0.0.1:19988`）把 DOM 暴露给 agent；agent 再通过 `sidebar-server.mjs` / `attach.mjs` 在侧边开一个聊天面板对弈。

放弃原因：

1. **跨 origin**：扩展页面与 agent 面板不同源，读 DOM 要过 CDP 或 postMessage，链路长、易断；
2. **要手动 attach**：每次打开题目标签页都要 attach，健康检查/断线重连都得自己写；
3. **依赖重**：Playwright 客户端 + 扩展 + 本地服务三件套，跑一次要配一堆环境变量；
4. **状态容易不同步**：落子后 DOM 与 agent 认知要靠轮询刷新。

替代它是 `dsh-webpane/`：把离线站直接挂在 DSH 自己的 origin 上，右侧栏 iframe 与 agent 同源，`iframe.contentDocument` 直接可读；面板不可见时自动切后台 headless Chromium，状态经 `progress/` 双向同步。

## 迁移说明

- 扩展的入口/构建/测试仍在 `chrome-extension/` 里，可读、可跑（`package.json` 原样），但**不再适配**。
- 之前扩展路线产生的课程记录（`chrome-extension/lessons/`）保留下来，仅作资料。
- 新方案的操作指南见 `dsh-webpane/README.md` 与 `.agents/skills/murdoku-webpane/SKILL.md`。
