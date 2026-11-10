# 寻宝 · The Treasure Hunt（非官方互动版）

**在线玩（GitHub Pages）：<https://colorlessboy.github.io/murdoku-teacher/contest/>**


这是把 **Murdoku Contest #1「The Treasure Hunt」** 原题 PDF 做成网页互动版的页面，用于在浏览器里查看棋盘、做笔记、打叉和核对答案坐标。

## 来源与版权（重要）

- **原题 / Puzzle**：《The Treasure Hunt》，作者 **Manuel Garand**，发布于 **murdoku.com**（Murdoku Contest #1）
  - 竞赛页：https://murdoku.com/contest/
  - 原题 PDF：https://murdoku.com/contest/murdoku-contest1-treasurehunt-EN.pdf
- **美术 / Art**：Valentyna Bezdushna 与 Manuel Garand
- 本页的棋盘图是由原题 PDF 渲染而来，线索文字来自原题 PDF；**题目、线索与美术版权归原作者所有**。
- 本仓库的互动页面（笔记 / 打叉 / 判对）是粉丝自制，**非官方**，与 murdoku.com 无隶属关系；仅用于个人解题辅助，不用于商业用途。
- 如果原作者认为此页不妥，请告知，会立即删除相关内容。

## 页面功能

- 24×24 原题棋盘（含房间、物件、行列标记），可点击做笔记 / 打叉 / 橡皮擦
- **操作记录**：按时间列出每一次笔记 / 打叉 / 撤销 / 重做 / 清空，点条目可定位到对应格子（可跨刷新保留）
- **撤销 / 重做**：撤销最近的标记修改，重做被撤销的一步；新操作会清空重做栈
- **手机端排版**：≤760px 自动切换为「棋盘 / 线索 / 答案」三页标签（吸顶），工具栏与嫌疑人横向滑动，棋盘满宽自适应，答案输入框加大到触控尺寸；选人后自动回到棋盘页
- 右侧完整线索列表，点选嫌疑人后在棋盘上标注首字母
- 答案判对（ROW / COLUMN），答案来自竞赛官方统计页公布的坐标
- 所有标记保存在浏览器本地（localStorage），刷新不丢

## 技术说明

- `index.html` — 单页应用（无构建依赖）
- `board.png` — 原题 PDF 第 2 页棋盘区域渲染图
- `clues.json` — 从原题 PDF 提取的 24 条线索
- `treasure-hunt-EN.pdf` — 原题 PDF（保留用于对照与署名）

数据文件（棋盘图、线索、PDF）均为原题内容的转换，遵循上述版权说明使用。

## 端到端（E2E）闭环检测

页面带一套无头浏览器 E2E，覆盖：加载与资源、24×24 覆盖层几何对齐、线索完整性与原文一致性、笔记/叉/橡皮/撤销/**重做**/隐藏/缩放/**操作记录面板**、刷新持久化、答案判对（非法/错误/行对/接近/正确）、提示阶梯与记忆、清空、控制台零报错（共 30 项断言，含手机端 390×844 视口与桌面端恢复）。

```bash
# 测仓库内页面（脚本自带静态服务器）
node scripts/e2e-contest.mjs

# 测线上页面
node scripts/e2e-contest.mjs --url https://colorlessboy.github.io/murdoku-teacher/contest/
```

CI：`.github/workflows/e2e-contest.yml` 在推送 `docs/contest/**` 时自动跑；也可在 Actions 里手动触发并填入线上 URL 做线上回归。
