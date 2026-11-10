---
name: murdoku-webpane
description: Use when operating the Murdoku game inside the DSH right sidebar through the local webpane plugin — opening a level, reading the board, placing suspects, notes and X marks, submitting, or checking the locally saved progress and completion history.
---

# Murdoku Webpane 操作

## 何时用

- 用户说「在侧边栏打开/操作 Murdoku」「继续做题」「看看盘面」「存档到本地」；
- 需要读 Murdoku 页面的 DOM、落子、撤销、提交，或核对本地进度文件；
- 给 side panel 写脚本、加自动落子/回归。

**不适用**：`murdoku-exam-coach`（考官模式，不允许落子/泄答案）和 `live-logic-puzzle-coach`（独立 chat 面板）有自己的协议，本 skill 只管「怎么操作那个页面」。

## 架构速览

```
DSH Client (浏览器, 同源!)
└─ 右侧栏 tab kind=webpane  ──iframe──▶ /play/*   (Host 静态托管 = DSH 自己的 origin)
      │  DOM 直接可读（同源，不需要 postMessage 代理）
      └─ EventSource /__webpane/panel  ◀── Host SSE 命令（按 session 路由）
                 └─ POST /__webpane/result ──▶ Host
```

Host 插件 `@local/dsh-webpane`（源码 `/Users/penglingwei/Documents/murdoku/dsh-webpane/`）：

| 部分 | 作用 |
|---|---|
| `index.js` | 静态托管 `/play`、`/play_puzzles`；`/__webpane/*` 桥；工具 `webpane`；进度镜像 `syncProgress` → `progress/` |
| `client.js` | 右侧栏 tab + per-session iframe + DOM 执行器（不会跨 session 弹窗/操作） |
| `history.js` | 注入到 `/play/index.html` 的本地通关记录脚本（原站文件不动） |
| `cordis.patch.yml` | `root`（offline app 目录）、`entry`、`progressDir` |

已验证的 content 目录：`/Users/penglingwei/Documents/murdoku/.worktree/original-app/public`。

## 驱动方式（都属于插件路线）

1. 工具 `webpane`（agent 最常用，直接进对话）；
2. `scripts/webpane.sh`（bash 桥，`state/open/text/eval-file/eval/__sync` …）；
3. 面板不可见时自动落到后台 headless Chromium（见「后台模式」）。

> 旧的 Chrome 扩展 + Playwright/CDP 路线已放弃并归档到 `archive/chrome-extension/`（见 `archive/README.md`），本 skill 不再涉及。

**脚本化时**用 Host HTTP 桥

```bash
SID="$DSH_SESSION_ID"          # 本 session id，必须带上，否则不会路由到你的面板
curl -s -X POST -H 'content-type: application/json' \
  -d "{\"action\":\"state\",\"payload\":{},\"session\":\"$SID\"}" \
  http://127.0.0.1:3080/__webpane/cli
```

> JSON 里带正则、引号、`\s` 时别手拼 —— 用 python 生成 payload 写文件再 `--data-binary @file`，否则转义会坏掉（会看到 `Bad escaped character`）。

## 动作表

| action | payload | 说明 |
|---|---|---|
| `state` | — | 返回 `{url,title,readyState}`；每次操作前先探一下 |
| `open` | `{url}` | 直接设 `iframe.src` 整页加载。**最稳的进入方式**。相同 URL 会直接返回、不重载 |
| `snapshot` | `{limit}` | 可见交互节点 `e1..eN` + 正文（元素 0 尺寸时可能为空，优先 `text`/`eval`） |
| `text` | `{limit}` | `document.body.innerText` 截断 |
| `click` | `{ref\|selector\|text}` | 合成 pointerdown/up + click；按文本匹配最稳 |
| `type` | `{ref\|selector,text,submit}` | 输入 + 可选回车 |
| `press` / `scroll` / `back` | `{key}` / `{dy}` / — | 键盘、滚动、历史后退 |
| `eval` | `{code, limit}` | 在页面里执行（async 可用），返回值 `JSON.stringify` 后回传 |

### 用 eval 造「长按」

```js
(async () => {
  const opts = { bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }
  const cell = [...document.querySelectorAll('[data-cell-index="12"]')].find(e => getComputedStyle(e).cursor === 'pointer')
  cell.dispatchEvent(new PointerEvent('pointerdown', opts))
  await new Promise(r => setTimeout(r, 900))          // < 600ms 会退化成单击（笔记）
  cell.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }))
})()
```

## 标准配方

### 1. 打开一个关卡

优先直接开 URL（列表点卡片要「点两次」：第一次揭开、第二次进入，容易失败）：

```
open  /play/puzzle-book-club-very-easy
```

列表页需要筛选时：点 `非常简单` 等难度按钮 → 等 700ms → 卡片 `div[role=button]` 点两次（第二次用 `card.click()`）→ 轮询 `location.pathname.includes('puzzle-')`。

### 2. 选嫌疑人（两套布局都要兼容）

页面有两种渲染：

- 桌面/紧凑：`button.mrdHoverGlow`，文本是 `AAda …`（首字母 + 名字 + 线索）；
- 竖版：`button.mrdPortraitChild`，名字和线索是**两个**按钮。

通用匹配：

```js
const portrait = (name) => {
  const all = [...document.querySelectorAll('button')]
  return all.find(b => b.textContent.replace(/\s+/g, ' ').trim() === name)        // 竖版
    ?? all.find(b => b.textContent.replace(/\s+/g, ' ').trim().startsWith(name[0] + name))  // 桌面
}
```

⚠️ 不要用 `includes(name)`：Brigitte 的线索里就写着 "在 Cameron 下面"，会把选人点错（实测把 B 放到了 C 的格子上）。

### 3. 格子索引

`index = (row-1) * cols + (col-1)`，`cols` 见棋盘宽度（5×5 / 6×6 / 9×9…）。
格子元素：一个 index 有**两个** DOM 节点，取 `cursor === 'pointer'` 的那个。

### 4. 落子 / 笔记 / X / 撤销 / 提交

- 落子 = 选人 + 长按格子（900ms）；
- 笔记 = 选人 + 单击格子；
- 落子后 app 会自动打 X（`mrd_auto_x`），不要跟它抢；
- 撤销 = 点含「撤销」的按钮；
- 提交 = 点含「提交」的按钮 → 结算弹窗 `.mrd-modal-body`（按钮：下一个谜题 / 返回谜题列表 / 分享）。

每次交互后 `await sleep(350~400)`；页面加载后等 4s 再动手。

### 5. 读盘面（可靠方式）

DOM 文本只在有字时可靠；**权威来源是 localStorage**：

```js
const key = Object.keys(localStorage).find(k => k.startsWith('mrd_progress_') && k.includes('book-club'))
JSON.parse(localStorage.getItem(key))
// { placed: ['char_0'|null…], xMarks: [bool…], notes: [['char_1'], …] }
// char_0..char_5 按关卡 CHARACTERS 顺序（A/B/C/D/E/V）
```

## 线索语义易错点（踩过的坑）

- **「exactly one row north/south of X」＝ 行差正好 1、列不限**，不是「正上/正下方那一格」。迷你高尔夫 Albert 的候选因此是第 3/7/10 行共 28 格，而不是 3 格（用户纠正过一次）。
- 「beside」＝ 相邻 + **主房间**相同（地形子区域算主房间）；
- 方向词（north/south/east/west of）**不限房间、不限列/行**。

## 游戏规则（判定依据）

> 权威文案在 `assets/zh_hans-*.js`：`howToPlay`（目标/规则/操作/工具/关键词）+ `glossary` + `faq` + `advanced`。
> 要重新核对就 `grep` 这几个键，不要凭印象。

- **目标**：把每个角色放到案发现场；**凶手 = 曾与受害者单独处同一区域的人**；
- 每行、每列各一人（个别关卡类型不同，线索措辞优先；FAQ 原文「几乎每个网格」）；
- **旁边 = 上下左右相邻且同一区域**，不含对角；方位词（东南西北）= 任意格的上下左右，不要求同区域；
- 嫌疑人不能放在物件格上（桌子/树等）；水域默认可站；大物件跨格但一人一格；「在椅子旁」可同时坐椅子；
- 关键词：`独自`=区域内没有别人（含受害者）；`与…一起`=同一区域；`与…单独`=区域内只有这两人；`空`=区域没人；
- 受害者永远算「人」；线索全真；无需求解猜测；头像是装饰；
- **落子/笔记语义**：点嫌疑人=选中；点格子=笔记（大写字母显示为主、笔记为小写）；长按格子=放置；X 键=标不可能；橡皮擦=清一格（长按清全部）；撤销=回退。

**推理顺序（够用版）**：逐行逐列扫「只剩一格」→ 行列超载排除 → 交叉格排除（某人只在两格 ⇒ 两格矩形的另两角无人）→ 物件邻接/唯一性 → 最后剩受害者与凶手同区域。

## 盘面读数补充（来自 live-logic-puzzle-coach 的实操记录）

- 每个 index 两个 DOM 节点（两层重合）：**按 index 去重**再算列数，别用 `sqrt(节点数)`；
- 笔记：`[...el.querySelectorAll('.grid-note-letter')]`（合并两层后去重）；X：`img` 且 `src` 含 `87.7`；
- 清除：长按 `button[title="长按以清除所有格子"]` ~1.2 s，**不要 reload**（会丢未持久化笔记）；
- 放置后自动 X 同行同列（`mrd_auto_x`），读它、不要重复标；
- 可放置 = 空格 ∪ 椅子格；其它物件格（桌/树/花/架子）点不上去；大物件跨多格但只占一人。

## 房间 vs 地形、全局线索

- `room_code_{r}_{c}` 往往是**地形**（沙地/小径/水域），真正的房间是主房间：`room_subroom_i=1` 表示子区域，`room_subroom_mainroom_i` 指向主房间（迷你高尔夫：Path 9→Walkway 4、Sand 7→Desert 6、Sand 2→Barrels 1、Water 10→Island 3）；
- 线索「旁边 / 同一区域」按**主房间**算：与花相邻的「小径」格仍属于花所在的步道房间，不能因为地形不同就排除（踩过坑：漏掉 R6C2）；
- 用错房间会让「旁边」全盘失效，每道新关先确认房间划分；
- `generalClues` 是不挂角色的**排布级计数约束**（如"恰好一人挨着桌子"），不能当某人的候选笔记；
- `suspects[].analyzedKeywords[].data.cellIndices` 是关卡特定的，别跨关复用。

## 相关文档（比本 skill 更细的原料）

- `.worktree/original-app/NOTES.md` — 规则/交互映射/进度数据模型/物件 id（chair=2, table=4, carpet=5, tree=10, shelf=13, boulder=43/75, flowers=80）；
- `.worktree/original-app/SOLVE.md` — The Picnic 7×7 的完整推理记录（含"可放置格=空格∪椅子"的实测）；
- `.agents/skills/live-logic-puzzle-coach/SKILL.md` — failure modes 表、bed 跨格、auto-X、房间/地形等坑。

## 后台模式（面板不可见时）

- 侧栏 iframe 被折叠/切走时 `frameElement` 宽度为 0，DOM 事件落不下去；host 探测到后自动改用**后台 headless Chromium**（同一 origin），动作集不变；
- headless 页面布局真实，**指针事件必须带元素真实坐标**（`getBoundingClientRect` 取中心），不能用固定坐标——否则点到别的格子；
- 每次动作后 host 把 `mrd_*` 写进 `progress/`；用户把面板调回来后，用 `webpane.sh __sync`（或工具 action `__sync`）把磁盘快照写回 iframe 并重载；
- 跨命令连续性已打磨：已有后台页时不再重载/导航；每条动作后 `settle()` 等 app 防抖存档落地再写盘；面板隐藏期间跳过目录同步；实测多条命令「笔记→读回→落子→再读回」状态保持；
- 仍然建议把一次「解题大动作」放在一条 `eval` 里（省往返，也避免中途用户把面板调出来时的竞争）；
- 字段名陷阱见下条。

## 关卡数据格式（先判断再解题）

- 旧格式网格在 `CHARACTERS`：`room_code_{r}_{c}` 行优先；
- 新格式网格在 `GRID`：`room_code_{c}_{r}` —— **列优先**（x 在前）。24小时送货就是这种；
- 快速判断：`GRID` 里 `room_code_0_1` 若等于 `room_code_1_0` 则两序无法区分，直接拿房间标签坐标反推：
  `c=(room_name_xpos-grid_rx)/cellsize`、`r=(room_name_ypos-grid_ry)/cellsize`，标签落点必须落在同名房间内；
- 再用「可放置格」实测交叉验证：被 app 拒绝的格子必须正好是阻挡物件格（桌/植物/灌木/箱子），否则说明行列序搞反了。

## 每步例行（必须执行，别每次重新想）

原网页路线的经验：每步都要 `(state, action, state')` 落盘，否则上下文一压缩就丢。插件里固化成一条命令：

```bash
# 每做完一个逻辑操作
node .agents/skills/murdoku-webpane/scripts/teaching-step.mjs \
  --puzzle <id> --action '<json>' --explain '<一句话条件>'
# 用户回话后
node .agents/skills/murdoku-webpane/scripts/teaching-step.mjs --puzzle <id> --feedback accept|reject --note '<用户原话>'
```

- 自动刷新 `progress/state/<id>.json` → 写 `progress/ledger/<id>-plugin.jsonl`（插件路线独立台账）→ 追加 `progress/lessons/<id>.jsonl` → 同步生成 `.md` 教学记录；
- 执行后自动在**棋盘正上方**弹出说明窗（「第 N 步 · 打叉」+ 一句人话理由），并保留前摇画的形状（banner 由教学脚本自动调用 `annotate-step.js` 渲染）；理由要像真人老师说话（例：「这一行只剩 R8C7 一个位置了，第 7 列就归它——我把 R4C7 叉掉。」），不要「理由：… 操作：…」这种条目式；
- 一次只记一个逻辑操作（one-step gate），记完解释一句、提问、停；
- `--feedback` 会打开 ledger 门禁（上一个 `append` 会让下一步阻塞，直到有裁决）；
- 恢复时：`ledger status/state/verify` + `progress/lessons/<id>.md` 就是完整课堂，不靠聊天记忆。

### 交互三段式（用户定义，必须遵守）

每步 = **前摇（板书）→ 用户接受 → 执行操作**。

1. **前摇**：先画板书，说明「看哪里 + 要做什么 + 理由」，然后停下问「接受吗」；
2. **用户接受**后，才执行棋盘操作；
3. 执行后照常用 `teaching-step.mjs` 记 (state, action, state')；前摇本身记 `kind=prelude`。

画图机制（已处理缩放）：棋盘外层常带 CSS `transform: scale(...)`（这里约 1.109×）——`getBoundingClientRect()` 是视觉坐标、absolute 定位是布局坐标，混用会让行带/矩形框「歪」并按比例漂移。`annotate-step.js` / `highlight-step.js` 现在都按 `offsetWidth` 反算 **SCALE**，坐标/尺寸/边框/字号统一换算，模型不用关心缩放。

前摇基础元素（`scripts/prelude.mjs --spec '<json>'`，只画不改盘）：

| 元素 | 字段 | 用途 |
|---|---|---|
| 行/列带 | `bands: [{axis:'col'\|'row', items:[7,8,9], label:'7–9 列'}]` | 圈整列/整行（「只剩这行能填」） |
| 矩形区域 | `regions: [{r1,c1,r2,c2,label:'三列区域', style:'dashed'|'solid', fill:false}]` | 框多行多列（「这三列只有三个人」） |
| 关键格子 | `cells: [{r,c,label:'桶旁', shape:'circle'|'square', size:'s'|'m'|'l'}]` | 按格子画圆/方 + 小标签，大小三档（「只能站这几格」） |
| 批量格子 | `groups: [{cells:[[r,c],...], shape, size, color, label}]` | 同一样式批量套在多个格子上 |
| 人物 | `person: {name:'Elyana', label:'她的候选', showCells:true, cells:[[r,c],...]}` | 圈头像 + 虚线圈出候选格（可自动按笔记推断，也可显式给格子） |
| 说明窗 | `banner: {title, lines:[...], color, offsetCells:1}` | **棋盘上方一格处居中的小窗**（默认离棋盘一格高，可调）（紧凑：内容宽度、最多 2 行、字号 10.5px）：标题 + 一行人话理由（推荐用它代替长文字） |
| 标题/说明 | `title` / `caption` | 左上标题、底部板书说明（可选，少用） |

```bash
node .agents/skills/murdoku-webpane/scripts/prelude.mjs --puzzle <id> --record --spec '{
  "title":"板书 · 第 7/8/9 列",
  "caption":"这三列只能站 3 个人：Elyana、桌旁的人、桶旁的人",
  "bands":[{"axis":"col","items":[7,8,9],"label":"7–9 列"}],
  "regions":[{"r1":1,"c1":7,"r2":10,"c2":9,"label":"三列区域"}],
  "cells":[{"r":4,"c":7,"label":"桶旁"},{"r":4,"c":9},{"r":5,"c":8}],
  "person":{"name":"Elyana","showCells":true}
}'
```

画完停下问「接受吗」，用户接受后再执行并 `teaching-step.mjs` 记执行步。

### 回复协议（硬性，避免歧义）

- 每条教学消息**只问一个问题**：「这一步理解了吗？」
- 禁止预告别一步、禁止问「要不要我做下一步」、禁止给选项清单；
- 用户回「理解」＝我自动继续下一步；回「不理解」＝撤销这一步并换成更小的步子；
- **标注顺序**：先标注「条件最直接」的角色（例：Duncan 的小径格），再用它的条件去删别人的笔记；不要先用条件排除别人、再回头补标注（用户 Mark 过这一点）；
- **整格必空 → 直接打叉（用户反复强调）**：一旦推出「这一格任何人都不能站」，就用 X 覆盖（顺带清掉格上笔记），不要逐个人删笔记——打叉更准确也更快；同理，行/列被某人独占时，该行/列其余格子直接打叉。
- **打叉优先**：X 会直接覆盖/清空该格的笔记；当整格确定无人（行/列归属、区域排除）时，直接打叉一步到位，不要拆成「先删笔记、再打叉」两步（用户 Mark 过）；
- **改动必须高亮**：每步结束后在改动的格子上加彩色边框 + 「＋/－/✕/● R行C列」坐标标签，并在左下角显示「上一步改动 N 格」图例（`teaching-step.mjs` 已自动调用 `highlight-step.js`；用户会走开再回来，数格子很累，用户 Mark 过）；
- **拆分例外（用户补充）**：如果某人只剩**唯一候选**，直接落子（自动清行清列），不要再拆成「先打叉」+「再落子」两步；只有「推出某行/列属于某人、但那人还有多个候选」时才先打叉后落子。
- **步骤拆分（用户明确要求）**：推导出「某行/列属于某人」时，先单独一步把该行/列其余格子打叉，再在下一步落子——不要一步里既落子又隐含清行清列。
- **解释精简（用户明确要求）**：教学消息只写「关键 3–4 条要点 + 结论」，不要展开枝节、不要重复盘面清单；用户原话「下回简单点，说这个就行」。
- **即时落账 + 收尾归档（用户强调：不提醒就会乱）**：每步完成立刻 `teaching-step.mjs` 落账（自动带 state_before/action/state_after，回滚/拒绝也记）；教完一局要跑「台账连续性校验（前步 state_after == 后步 state_before）+ 合并单文件 `progress/archive/<puzzle>.json` + 索引 md」，发现断点用上一记录的 state_after 回填并标注 reconciled。
- **先简后繁（用户明确要求）**：每步先扫「常规简单规则」——专属房间/地形、行/列归属、二选一/三选一覆盖（候选 2-3 个时把每种情况占的行列取交集 = 必空格）、唯一候选落子、必空格打叉；把这些全用完再考虑连锁推理。用户批评过「简单逻辑不走、复杂逻辑炫技」。
- **教学起手式**：开头先做「行/列归属 → 打叉必然空格」。例：某人线索锁死某一行 ⇒ 该行只可能是他，别人不能在该行，行内其他可站格直接打叉（迷你高尔夫第 12 步：R1 属 Ginny ⇒ R1C6/C7 打叉）；
- 不用「接受 / 继续 / 可以」这类多义词向用户要确认。

## 盘面来源与台账

- **唯一来源**：`webpane.sh ledger-state` 从插件页面 eval 读盘，写 `progress/state/<puzzle>.json`；插件每次动作后自动（1.2s 防抖）刷新，台账状态总是新鲜；
- 跑台账脚本时加 `MURDOKU_STATE_SOURCE=plugin`：`murdoku-state.mjs` 直接读文件，`murdoku-ledger.mjs` 的 init/status/state/append/verify/feedback/rollback 原样可用；
- 面板不可见时由后台 headless 代跑，导出逻辑不变；
- 旧的 CDP:19988 读盘路线已随 Chrome 扩展方案归档（`archive/chrome-extension/`），不要再连 CDP。

## 数据与存档

### 页面 localStorage（与 DSH 同源、共享！）

| key | 内容 |
|---|---|
| `mrd_progress_<puzzleId>` | 盘面：`placed` / `xMarks` / `notes` |
| `mrd_timer_<puzzleId>` | 计时（秒） |
| `mrd_catalog_v2` | **原站匿名完成状态**（列表 `✓ 案件已破`、`已完成 N 个` 读它） |
| `mrd_local_completed` | `history.js` 维护的本地历史镜像 |
| `mrd_catalog_cache` | 题库目录缓存（~68KB，镜像时排除） |

### 工作区文件 `progress/`

```
progress/
├── local-storage.json          # 全部 mrd_* 快照（Host 每 15s + 每条命令后镜像）
├── history.json                # 通关记录 {puzzleId,title,completedAt,elapsedSeconds}
└── puzzles/<puzzleId>.json     # 每题盘面
```

- 通关检测：`history.js` 看到页面出现「案件已破 / Case solved」→ 写 `mrd_catalog_v2` + `mrd_local_completed` → POST `/__webpane/completed` → `history.json`；
- 回填：面板挂 iframe 前先 `GET /__webpane/progress`，把磁盘快照里 localStorage 缺的键写回去（换浏览器/清缓存也能续）。

## 解题数据源（比看 DOM 快得多）

- `play_puzzles/en/<puzzleId>.json` 有**完整地图**：
  - `PROPERTIES`: `grid_w`、`grid_h`、`murderer`（char 序号）、`difficulty`
  - `CHARACTERS`: `room_code_r_c`、`room_objects_r_c`、`carpet_objects_r_c`、`char_name_i`、`char_quote_en_i`、`room_name_i`、`solution_x_i` / `solution_y_i`
- `play_puzzles/zh_hans/` 只有翻译文本，**先读 en 再配中文**；
- 物件 id 表在 `assets/puzzle-core-*.js` 里的 `c(id,"Name",layer,"obj_*.svg")`：
  `1 Plant`、`2 Chair`、`4 Table`、`5 Carpet`、`13 Shelf`、`47 Lion`、`48 Pig`、`34/142` = 泥坑一类地形件；
- 规则：每行每列各一人；线索 = 房间 / 邻接物件 / 方位（south of = 更靠下，不强求同列）/ 唯一性；受害者与凶手独处 ⇒ 凶手；
- 解完用 `solution_x/y` 与 `murderer` 对一遍再落子。

## 解谜台账（ledger）与压缩恢复

上下文压缩会丢盘面记忆。台账是持久化的 `(state, action, state')` 追加日志：

- 导出：`webpane.sh ledger-state`（动作名 `ledger-state`）把当前盘面写成 `progress/state/<puzzle>.json`（`{puzzle, placed, notes, xMarks, notesTotal}`，字母与游戏显示一致，受害者是 `V`）；
- 台账脚本：`MURDOKU_STATE_SOURCE=plugin node scripts/murdoku-ledger.mjs <init|status|state|append|verify|feedback|rollback> --puzzle <id>`；`scripts/murdoku-state.mjs` 在 CDP 失败时自动读插件导出的状态文件；
- 协议：`status` 门禁（上一步 `lastUser` 不能是 `none`）→ 一步操作 → 回读 → `append --action '<json>' --note '...'` → 向用户提问 → `feedback --verdict accept|reject`；
- 压缩后：`state` 取最后 `state_after`，`verify` 与实时盘面对比；不一致以盘面为准写 `resync`；**不要用聊天记忆重建盘面**。

## 推理纪律（迷你高尔夫复盘）

- 一步只做一个逻辑操作（一个角色的候选集 / 一组打叉 / 一次落子），然后停下来解释 + 提问；
- 禁止 answer-driven：不读 `solution_*`/`murderer` 倒推理由；被用户判过「胡说八道」；
- 只有「交叉格」无条件为空；整行整列没证明就删会被撤回；
- 落子自动 X 行列；撤销不恢复被消耗的笔记，要手动补；
- 一行一句解释（"第 8 列只剩一个位置"），别逐格罗列；
- 撤销/回滚后把补回的笔记也记一条台账。

## 坑与排查（后台模式新增）

- **提交要点两次**：最后一次落子后 React 重渲染，第一次点「提交」有时不弹结果；间隔 400ms 再点一次，然后读 `案件已破` 与 `mrd_catalog_v2` 确认；
- **不要用固定坐标**派发指针事件：必须 `getBoundingClientRect()` 取元素中心，否则会落到别的格子（尤其 headless 页布局与前台不同）；
- **关卡房间要先做标签反查**：`room_code` 不一定等于 `room_name` 的下标（Fresh Paint 就是乱序的：0=Kitchen、1=Dining Room、2=Living Room、4=Bathroom、5=Bedroom）。用 `room_name_xpos/ypos` 换算成格子，label 落在哪个 code 区域，那个 code 才叫这个名字；
- **新格式 GRID 是列优先**：`room_code_{c}_{r}`；旧格式 CHARACTERS 是行优先；
- 面板隐藏时 `lastSync.reason = panel-hidden` 是正常现象，表示磁盘不会被旧画面覆盖。

## 坑与排查

| 现象 | 原因/处理 |
|---|---|
| `当前 session 的「网页」标签页没有打开` | 面板没开。让用户**在当前 session** 点一次「网页 · Murdoku」；插件不会跨 session 弹 |
| `面板 state 超时` | 命令带了别的 session id（正常：别的页面沉默）。检查 `$DSH_SESSION_ID` |
| eval 结果解析失败 / 被截断 | 默认 `limit` 6000 + Host 可能 double-encode；传 `limit`，读取时 `json.loads` 两次 |
| 页面自己回到 `/play/` | SPA 会重置路由；每次操作前 `state`，必要时 `open` 重进 |
| 点卡片不进去 | 需要第二次点击，且等 reveal 动画；用 `card.click()` 而非坐标点击（元素 rect 可能是 0） |
| 选人点错 | 用了 `includes(name)`；改用 `=== name` / `startsWith(name[0]+name)` |
| 长按变成笔记 | 按住时间不够，给 900ms |
| 改了插件代码不生效 | Host：`plugin_manager set_bundle false→true`；Client：刷新 DSH 页面（EventSource 有自管重连，但新 bundle 需要 reload） |

## 验证清单（交付前自查）

1. `state` 的 `url` 是关键关卡页；
2. 落子后从 localStorage 读回的 `placed` 与预期坐标一致；
3. 提交后结算弹窗出现（或页面含「案件已破 / 找到了凶手」）；
4. `progress/history.json` 多了一条，列表 `已完成 N 个` +1，卡片带 `✓`;
5. 全程只动本 session 的面板（另一 session 无弹窗、无操作）。

## 相关

- 插件源码：`dsh-webpane/`（`index.js` / `client.js` / `history.js` / `cordis.patch.yml`）
- 离线站点：`.worktree/original-app/`（`public/play` 为被托管的 SPA，`OFFLINE.md` 说明用法）
- 解题方法论/教学模式：`live-logic-puzzle-coach`、`murdoku-exam-coach`
