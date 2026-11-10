# Murdoku Companion

给 Murdoku（谋杀谜题 × 数独）用的 AI 陪玩：**教学（Tutor）** 一步一步带你推，**考官（Examiner）** 只审你的推理、不剧透答案。

当前唯一维护的方案是 **集成进 DSH 的侧边栏插件**（`dsh-webpane/`）：离线站挂在 DSH 自己的 origin 上，右侧栏 iframe 与 agent 同源，agent 可直接读棋盘 DOM、落子、打笔记、打叉、提交，并把进度镜像到本地 `progress/`（不依赖登录）。

## 在线试玩（GitHub Pages）

**寻宝 · The Treasure Hunt（24×24 竞赛关互动版）**

### 👉 <https://colorlessboy.github.io/murdoku-teacher/>

- 原题棋盘高清图 + 24×24 可点格子：笔记 / 打叉 / 橡皮 / 撤销 / 重做 / 操作记录
- **三栏同页**：左栏 24 张原题 PDF 裁切立绘（密集网格）+ 选中线索中英同显；中栏棋盘尽量大；右栏动作 + 规则 + 答案提示
- 答案判对（四档反馈）、6 级提示阶梯、撤销/重做/操作记录、进度自动保存
- 同页排版：手机端**棋盘吸顶**、人物卡与答案在下方滚动；电脑端三栏，棋盘默认「适应窗口」
- 非官方互动版：原题 by Manuel Garand（murdoku.com），美术 by Valentyna Bezdushna & Manuel Garand，署名与说明见页面底部
- 源码在 `docs/contest/`；26 项 E2E 检测（`scripts/e2e-contest.mjs`），CI 每次推送自动跑

## 目录

```
dsh-webpane/                  ⇐ DSH 插件本体（Host + Client + 自带指南/规则）
├── index.js                   Host：静态托管 /play /play_puzzles、SSE 桥、webpane 工具、系统提示片段、台账导出
├── client.js                  侧边栏面板（每 session 一个「网页 · Murdoku」标签）
├── headless.js                面板不可见时的后台 headless Chromium（CDP）
├── history.js / locale/ / icon.svg / package.json / cordis.patch.yml
└── README.md                  操作指南（含规则速查、DOM 契约、账本、排错）

.agents/skills/murdoku-webpane/   ⇐ 面板操作 skill + 教学流程
├── SKILL.md                    架构/动作表/配方/坑位/交互三段式（前摇→接受→执行）
└── scripts/
    ├── webpane.sh              命令行桥（eval-file / cli）
    ├── teaching-step.mjs       每步台账：(state, action, state') + 教学记录
    ├── highlight-step.js       改动格子的高亮（方框/圆圈 + 坐标标签）
    ├── annotate-step.js        前摇板书渲染器（全部用格子坐标）
    └── prelude.mjs             一条命令画板书

.agents/skills/live-logic-puzzle-coach/   tutor 工作流资料（CDP 旧路线，已弃用，仅历史参考）
.agents/skills/murdoku-exam-coach/        examiner 协议（仍可用）
scripts/                     插件路线的台账工具（murdoku-ledger / murdoku-state）
progress/                    本地存档
├── local-storage.json        mrd_* 快照
├── history.json              通关记录
├── puzzles/<id>.json         每题盘面
├── state/<id>.json           插件导出的标准盘面
├── ledger/<id>-plugin.jsonl  每步 (state, action, state')
├── lessons/<id>.jsonl|md     可回放教学记录
└── archive/<id>.json         单文件归档（教完一局合并）

contest 互动页                竞赛关「寻宝」(24×24)：原题棋盘图 + 24×24 笔记板 + 线索栏 + 答案判对
                             （文件在 .worktree/original-app/public/play_puzzles/contest/，从右侧栏右下角金色按钮进入）

docs/                        产品与复盘
archive/                     已放弃的旧路线（Chrome 扩展 + Playwright/CDP），仅参考
.worktree/original-app/      离线站源码 worktree（插件静态托管的 root，别删）
```

## 快速开始

```bash
# 一次性安装（profile 级；bundle 指向本目录下的插件）
plugin_manager install_bundle  →  target: /Users/penglingwei/Documents/murdoku/dsh-webpane

# 打开 DSH 右侧栏「网页 · Murdoku」标签即可；agent 用 webpane 工具操作
# 改 Host 代码后用 plugin_manager set_bundle 重载；改 Client 后刷新页面
```

## 教学交互（当前约定）

每步 = **前摇（板书：圈哪一行/哪几列/哪些格子 + 要做什么 + 理由）→ 用户接受 → 执行操作**，执行后自动记 `(state, action, state')`。板书元素全部用格子坐标描述（行/列带、矩形区域、格子圆圈/方块、人物候选），像素与几何由渲染器算。

## 状态

- DSH 侧边栏路线可用：同源托管 + 每 session 隔离面板 + 本地存档（通关记录、`✓ 案件已破`、`progress/history.json` 不需要登录）；
- 已通关并归档：海滩篝火、读书俱乐部、猪圈、24小时送货、Fresh Paint、迷你高尔夫（含完整 65 步台账）；
- 旧 Chrome 扩展 + Playwright 路线已归档到 `archive/chrome-extension/`（见 `archive/README.md`），不再维护；
- 竞赛关「寻宝」互动页已发布在 GitHub Pages：<https://colorlessboy.github.io/murdoku-teacher/>（源码 `docs/contest/`，CI 见 `.github/workflows/e2e-contest.yml`）；
- 仓库不含游戏素材或答案文件；关卡数据来自 `.worktree/original-app/public/play_puzzles/`。

## License

TBD.
