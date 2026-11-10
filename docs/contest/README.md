# 寻宝 · The Treasure Hunt（官方单文件离线版镜像）

**在线玩（GitHub Pages）：<https://colorlessboy.github.io/murdoku-teacher/contest/>**

这是 **Murdoku Contest #1「The Treasure Hunt」** 的单文件交互版页面：在浏览器里完整还原原题棋盘、24 位角色线索、笔记/打叉/撤销、计时、提示与 **SUBMIT 判对**，全部逻辑离线运行（无外部请求）。

## 来源与版权（重要）

- **原题 / Puzzle**：《The Treasure Hunt》，作者 **Manuel Garand**，发布于 **murdoku.com**（Murdoku Contest #1）
  - 竞赛页：<https://murdoku.com/contest/>
  - 原题 PDF：<https://murdoku.com/contest/murdoku-contest1-treasurehunt-EN.pdf>
- **美术 / Art**：Valentyna Bezdushna 与 Manuel Garand
- 本页是**由原纸质谜题改编的单文件离线版**，页面内 About 弹窗已署原作者与美术；题目、线索、美术与页面代码版权归原作者所有。
- 本仓库仅做**镜像托管**，用于在 GitHub Pages 上在线访问；非官方、与 murdoku.com 无隶属关系、不用于商业用途。
- 如果原作者认为此镜像不妥，请告知，会立即删除。

## 页面功能

- **24×24 原题棋盘**（含房间、物件、行列刻度），点击落子 / 做笔记 / 打叉 / 橡皮
- **线索 → 地图高亮**：点人物立绘时高亮线索相关的物件（如 Augustus → 篝火 ×2）、提到的区域（如 Hyacinth → Cliff 悬崖）以及该人物的候选格
- **棋盘本地缩放 / 平移**：触控板 ctrl+滚轮（或双指捏合）只缩放棋盘，双指滑动平移地图，不滚动整页；＋/－/适应 按钮同步
- **悬浮气泡**：鼠标悬停格子弹出气泡，显示「R15C13 点 · 椅子（chair） · CABIN B（小屋 B）」这类信息（坐标 + 物件名 + 区域中英名）
- **物件配对**：已配对椅子 ×9 / 床 ×6 / 吊床 ×5（可占用）+ 篝火 ×2 / 树 / 猪 / 鲨鱼 / 书架 / 花丛 / 绳索 / 木桶；其余物件格显示「物件（object）」
- **图例弹窗**：右侧「图例」按钮显示原题 PDF 图例图 + 19 个物件中英对照（地图物件名是英文）
- **24 张角色立绘卡**（内嵌原题美术）：点卡片选角色，长按格子上人物、短点写首字母笔记
- **中英双语**：右上角切换 English / 简体中文，线索与界面同步切换；中文线索中的地名 / 物件补英文括注（悬崖（Cliff）、树林（Woods）、水域（Water）…）
- **右栏工具**：笔记 / 打叉 / 橡皮 / 撤销 / 重做 / 记录 / 隐藏 / 清空 + 提示 / 提交 / 玩法 / 图例（精简掉分享、打印、音效、设置等）
- **缩放**：− / 适应 / ＋，棋盘大图可滚动查看
- **计时器 + SUBMIT 判对**：23 位人物 + 宝藏全部放对后提交，弹出「找到宝藏 · R4 · C11」
- **进度自动保存**：localStorage（`murdoku-treasure-hunt-v1`），刷新不丢；含撤销历史
- **响应式**：≥851px 三栏（左线索 / 中棋盘 / 右工具，左栏可拖拽调宽）；≤850px 收窄三栏；≤640px 手机单栏，人物卡 4 列
- **紧凑顶栏**：去掉 logo 与返回按钮，标题 + 语言 + 计时同一行，给棋盘留空间
- 另有 How to Play / Options（音效、深色模式、触感、棋子样式等）/ Share / Print / About

## 技术说明

- `index.html` — **单文件**：CSS、JS、棋盘图、图例、24 张头像、24 条线索（中英）、区域数据与**完整解**全部内嵌（`#game-data`），无外部依赖、无网络请求
- `treasure-hunt-EN.pdf` — 原题 PDF（保留用于对照与署名）
- `board-thumb.png` — 侧边栏插件卡片缩略图
- localStorage key：`murdoku-treasure-hunt-v1`（进度 `s.placed/notes/marks/won`、偏好 `p`、用时 `t`、撤销历史 `h`）

## 端到端（E2E）闭环检测

`scripts/e2e-contest.mjs` 用 Chrome DevTools Protocol 无头驱动，**22 项断言**覆盖：

- 加载：标题 / 576 格 / 24 人物卡 / 计时器
- 桌面三栏比例（左 38.7% · 中棋盘 · 右工具 168px）与零横向溢出
- **内嵌数据完整性**：24 角色顺序、卡面 en/zh/头像、23 个嫌疑人全解 + 宝藏 R4C11、互不重复、嫌疑人不落在物件格、24×24 区域图、不可占格、棋盘图与图例
- About 署名与官方赛事页链接
- 中英切换（线索卡「篝火」/「beside a fire」）
- 笔记 / 放置 / 撤销 / 打叉 / 橡皮 / 缩放 / 提示（状态栏 + 高亮）
- **按内嵌全解走完 24 步 → SUBMIT → 判对弹窗「R4 · C11」+ won=true**
- 刷新后 24 个位置与通关状态保留
- 手机 390×844：单栏、人物卡 4 列、棋盘/工具可见、零横向溢出
- 控制台零报错 / 零 404

```bash
# 测仓库内页面（脚本自带静态服务器）
node scripts/e2e-contest.mjs

# 测线上页面
node scripts/e2e-contest.mjs --url https://colorlessboy.github.io/murdoku-teacher/contest/

# 额外输出 JSON 报告 / 详细进度
node scripts/e2e-contest.mjs --json /tmp/e2e-contest.json --verbose
```

CI：`.github/workflows/e2e-contest.yml` 在推送 `docs/contest/**`、`scripts/e2e-contest.mjs`、workflow 自身时自动跑；也可在 Actions 里手动触发并填入线上 URL 做线上回归。
