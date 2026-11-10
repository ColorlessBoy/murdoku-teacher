# dsh-webpane · Murdoku 侧边栏面板

把本地 Murdoku 离线站挂到 DSH 自己的 origin 下，在右侧栏标签页里打开，并让 agent 通过同源 DOM 直接读盘、落子、提交。

> 这份 README 是插件自带的操作指南。agent 侧的速查版会随插件进入系统提示（`WEBPANE_GUIDE`），
> 更细的操作配方/排错见工作区 skill：`.agents/skills/murdoku-webpane/SKILL.md`。

## 为什么不直接用官方 sidebar browser

官方 `ui-sidebar-browser` 是**跨域** iframe：客户端 JS 拿不到 `contentDocument`，模型侧也没有任何入口（README 里写明 *Model Experience: None*）。本插件改成由 Host 从 **DSH 自己的 origin** 静态托管离线站，iframe 与 DSH 同源，面板 JS 就能直接读 DOM、派发指针事件。

## 组成

| 文件 | 作用 |
|---|---|
| `index.js` | Host：静态托管 `/play`、`/play_puzzles`；`/__webpane/*` 桥（SSE 下行 + POST 上行）；工具 `webpane`；进度镜像；模型可见的操作指南（prompt section） |
| `client.js` | Client：注册右侧栏标签类型 `webpane`；**每个 session 一份** iframe；命令执行器（按 session 路由，不跨 session 弹窗/操作） |
| `history.js` | 注入到 `/play/index.html` 的脚本（原站文件不动）：通关检测 → 写 `mrd_catalog_v2` + `mrd_local_completed` → POST 给 Host |
| `cordis.patch.yml` | `root`（离线站 public 目录）、`entry`（默认打开地址）、`progressDir`（存档目录） |

## 配置

```yaml
- id: dsh-webpane
  name: '@local/dsh-webpane'
  config:
    root: '/Users/penglingwei/Documents/murdoku/.worktree/original-app/public'
    entry: '/play/?lang=zh_hans'
    progressDir: '/Users/penglingwei/Documents/murdoku/progress'
```

装到 profile（影响所有 session）：

```
plugin_manager install_bundle  →  target: <本目录绝对路径>
```

改代码后让改动生效：Host 用 `plugin_manager set_bundle`（false → true）；Client 需要刷新 DSH 页面（命令通道有自管重连，但新 bundle 要 reload）。

## 用法

优先用工具（自动带当前 session）：

```json
{"action":"open","url":"/play/puzzle-book-club-very-easy"}
{"action":"state"}
{"action":"eval","code":"JSON.stringify({path:location.pathname})"}
```

工具没出现时的退路（HTTP 桥，必须带 session）：

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d "{\"action\":\"state\",\"payload\":{},\"session\":\"$DSH_SESSION_ID\"}" \
  http://127.0.0.1:3080/__webpane/cli
```

动作：`open` / `state` / `snapshot` / `text` / `click` / `type` / `press` / `scroll` / `back` / `eval`。

### 落子的正确姿势

1. 选嫌疑人：按钮文本匹配（页面有两套布局）
   - `button.mrdHoverGlow` 文本是 `AAda …`（首字母+名字+线索）；
   - `button.mrdPortraitChild` 名字与线索是**两个**按钮，按 `textContent.trim() === name` 精确匹配。
   - ⚠️ 别用 `includes(name)`：Brigitte 的线索里含 "Cameron"，会把 B 放到 C 的格子上。
2. 长按格子：`[data-cell-index="i"]`（取 `cursor === 'pointer'` 的那个；`i = (row-1)*columns + (col-1)`），`pointerdown` → 900ms → `pointerup`。短按会变成笔记。
3. 提交：点含「提交」的按钮；结算弹窗 `.mrd-modal-body`（下一个谜题 / 返回谜题列表 / 分享）。

## 游戏规则速查

> 源：`assets/zh_hans-*.js` 的 `howToPlay` / `glossary` / `faq` / `advanced` 键（与页面「玩法说明」同一份文案），逐条对照过。

**目标**：确定谁杀了被害者 —— 把每个角色放到案发现场；**凶手曾与受害者单独在一起（同一区域）**。

**规则**

- 每行、每列各有一人（个别关卡类型不同，以线索措辞为准；FAQ 原文是「几乎每个网格」）；
- 「旁边」= 上/下/左/右直接相邻，**且同一区域**；不含对角线；
- 嫌疑人只能放在可放置的格子上（桌子、树木等物件格不行）；
- 方位词（东南西北）指「下方/上方/右侧/左侧的任意格」，**不要求同一区域**；
- 水域默认可以站人，除非线索另有说明；
- 大物件（床/车/船）跨多格，但一个人只占其中一个格子;
- 「在椅子旁边」的人也可以坐在椅子上。

**关键词（glossary）**

| 词 | 含义 |
|---|---|
| 区域 area | 任何封闭的部分 |
| 角落 corner | 区域两面或三面墙相交处 |
| 独自 alone | 该区域内没有其他人（含受害者） |
| 与…一起 with | 与某人同一区域（可能是受害者） |
| 与…单独 alone with | 该区域只有这两个人 |
| 空 empty | 该区域内没有任何人 |
| 嫌疑人 suspect | 除受害者以外的任何人 |

**FAQ 要点**

- 所有线索都为真，没有陷阱；每个谜题都能纯推理解开，**不需要猜**；
- 受害者始终算「人」（线索里的 someone/person 包含受害者）；
- 头像纯装饰，除非线索明确提到视觉元素（眼镜、帽子）；
- 「旁边某物」可能同时挨着多个同类型物件，只有写「恰好一个」才锁定数量；
- 唯一解，但推理路径可能不止一条。

**常用技巧（advanced）**：逐行逐列扫描（只剩一格必有人）→ 行列超载排除（两人占两行/两列则别人不能在那）→ 交叉格排除（某人只能在两格，则两格矩形的另外两角无人）→ 对角/共线约束。

## 盘面 DOM 契约（来自实操验证）

- 每个 `data-cell-index` 有**两个** DOM 节点（两层，位置重合）：按 index 去重再算列数，别用 `sqrt(节点数)`；
- 笔记 = `.grid-note-letter`；X = `src` 含 `87.7` 的 `<img>`；放置后显示为大写字母/头像；
- 「清除」= 长按 `button[title="长按以清除所有格子"]`（约 1.2 s）——**不要用刷新页面代替清盘**，会丢未持久化的笔记；
- 页面上还有 `mg_hist` 之类的历史快照键可作恢复来源（按关卡实现不同，先查 localStorage 再依赖）。

## 可放置格 / 自动 X

- 可放置 = **空格 ∪ 椅子格**；桌子、树、花、架子等物件格放不上去（`room_objects` 里非 2 的物件）；
- 放下一个人后，app 会自动把同行同列标 X（`mrd_auto_x` 默认开）。这是「每行每列一人」的推论，读它、不要重复标；
- 撤销只回退一步；清整个盘面用上面的长按清除。

## 房间 vs 地形（重要）

- 关卡 JSON 的 `room_code_r_c` 多数时候就是房间 id（对应 `room_name_N`），但**有地形的关卡可能编码的是地板/地形**；
- 权威定义以墙体为准（app 内部 `wallRoomIdByIndex` 才是房间，`roomIdByIndex` 是地板；`roomLabels[].isSubarea` 标记属于大房间的子区域）；
- **地形是房间里的子区域**：关卡数据里 `room_subroom_i=1` 的房间是子区域，`room_subroom_mainroom_i` 指向它所属的主房间（例：迷你高尔夫里 Path=9 属 Walkway=4、Sand=7 属 Desert=6、Water=10 属 Island=3）；
- 线索里的「旁边 / 与…同一区域」用的是**主房间**，所以判断「花旁边」时，与花相邻的「小径」格也算（它就是走廊房间里的地形）；
- 用错房间会导致「旁边」判断整盘失效，所以每道新关卡先确认一次房间划分。

## 关卡数据有两种格式（列优先陷阱）

- 旧格式：网格字段在 `CHARACTERS` 里，键是 `room_code_{r}_{c}`（行优先）；
- 新格式（如 24小时送货）：网格在 `GRID` 里，键是 `<字段>_{x}_{y}` —— **列在前、行在后**，即 `room_code_{c}_{r}`；
- 判断方法：拿房间标签坐标 `room_name_xpos_i/ypos_i` 换算（`c=(x-grid_rx)/cellsize`，`r=(y-grid_ry)/cellsize`），标签落点应落在同名房间的格子里；
- 还有一条交叉校验：用 app 实测「可放置格」反推物件表——被拒的格子必须对上阻挡物件。

## 全局线索（general clues）

- 有些线索不挂在具体角色上，而是对**最终排布**的计数约束（如"恰好有一人挨着桌子"）；
- 这类线索不能当成某个角色候选格的笔记，只能在排布层面用；题面里每个角色的 `analyzedKeywords[].data.cellIndices` 是**关卡特定**的，别跨关复用。

## 教练/考试模式边界

插件暴露题面数据（含 `solution_x/y`、`player_hint_*`、`murderer`），这只用于自动化落子/验证：
`live-logic-puzzle-coach` 与 `murdoku-exam-coach` 模式下**禁止读取这些字段**，只能从线索推理；考试模式也不允许替用户落子。

## 解谜台账（ledger）与插件共用

上下文被压缩时，聊天记忆会丢盘面；台账不会。插件负责把**实时盘面**导出成台账可读的形式：

```bash
# 插件导出 canonical state 到 progress/state/<puzzle>.json
./.agents/skills/murdoku-webpane/scripts/webpane.sh ledger-state

# 之后台账脚本在「没有 CDP」的插件模式下也能用
MURDOKU_STATE_SOURCE=plugin node scripts/murdoku-state.mjs --puzzle <id>
MURDOKU_STATE_SOURCE=plugin node scripts/murdoku-ledger.mjs status --puzzle <id>
MURDOKU_STATE_SOURCE=plugin node scripts/murdoku-ledger.mjs append --puzzle <id> --action '{"kind":"place","who":"A","cells":[30],"reason":"..."}'
```

- 导出格式：`{ puzzle, placed:{A:idx…}, notes:{A:[idx…]}, xMarks:[idx…], notesTotal }`，角色字母与游戏显示一致（最后一位受害者是 `V`）；
- `scripts/murdoku-state.mjs` 默认先试 CDP（旧 Chrome 扩展路线），失败再读 `progress/state/`；显式 `MURDOKU_STATE_SOURCE=plugin` 就完全跳过 CDP；
- 协议：`status`（门禁）→ 一步操作 → `ledger-state` 导出 → `append` → 提问 → `feedback`。**一步只做一个逻辑操作**；
- `progress/ledger/<puzzle>.jsonl` 是 `(state, action, state')` 追加日志，压缩后靠 `state`/`verify` 恢复，别从聊天里重建盘面。

## 每步例行（teaching-step，固化到 skill）

执行操作后会在**棋盘正上方**自动弹出一条说明窗（第 N 步 · 动作 · 理由），并保留前摇板书（`annotate-step.js` 的 `banner` 原语，位置由渲染器按棋盘几何计算，不用模型给像素）。

教学/解题时**每做完一个逻辑操作**就跑一次例行脚本——它把原网页路线里 `(state, action, state')` 的经验固化下来：

```bash
node .agents/skills/murdoku-webpane/scripts/teaching-step.mjs \
  --puzzle puzzle-minigolf-hard \
  --action '{"kind":"notes","who":"Ginny","cells":[0,1,2,3,5,6],"reason":"在最顶行"}' \
  --explain 'Ginny 在最顶行 → 候选只可能在第 1 行'

# 用户回话后记录裁决（同时打开下一步的门禁）
node .agents/skills/murdoku-webpane/scripts/teaching-step.mjs \
  --puzzle puzzle-minigolf-hard --feedback accept --note '用户：我能理解'
```

一次调用完成四件事：

1. 通过插件桥刷新 `progress/state/<puzzle>.json`（canonical state）；
2. 调 `scripts/murdoku-ledger.mjs append` 写入 `progress/ledger/<puzzle>-plugin.jsonl` 的 `(state, action, state')`（插件路线单独一份，不覆盖原网页/CDP 路线的台账）；
3. 追加教学 history `progress/lessons/<puzzle>.jsonl`（action + 解释 + 前后 state + 裁决）；
4. 同步生成人类可读的 `progress/lessons/<puzzle>.md`，可回放整堂课。

配合 one-step gate：**一次只记一个逻辑操作**（一个角色的候选集 / 一组打叉 / 一次落子），记完解释一句、提问、停。

## 盘面来源（插件）与旧路线

- **唯一来源**：`webpane.sh ledger-state` 在插件页面（iframe 或后台 headless）里 eval 读盘，导出 `progress/state/<puzzle>.json`；每次动作后 1.2s 防抖自动刷新。
- 台账脚本加 `MURDOKU_STATE_SOURCE=plugin`：`scripts/murdoku-state.mjs` 直接读文件，完全跳过 CDP；`murdoku-ledger.mjs` 的增删查改原样可用。
- 面板不可见时由后台 headless 代跑，导出逻辑不变。
- **旧路线已归档**：Chrome 扩展 + Playwriter/CDP（19988）方案不再维护，见仓库根目录 `archive/README.md`。插件路线不要连 CDP。

## 线索语义两条易错点

- **「正好在 X 上面/下面一行」＝ 行差正好 1，列不限**（不是「正上方 / 正下方」那一格）。例：迷你高尔夫 Albert「在站旗帜格的人下面一行」→ 旗帜在第 2/6/9 行 ⇒ 候选是第 3/7/10 行的所有可站格（28 格），不是 3 格。
- **「旁边」＝ 上下左右相邻 + 同一（主）房间**；方向词（东南西北）**不限房间**。

## 推理纪律（来自迷你高尔夫复盘）

- **禁止 answer-driven**：不许读 `solution_*`/`murderer` 再倒推一个理由；被否过（"胡说八道"）。
- **过度打叉是高频错误**：只有「交叉格」无条件为空；整行/整列没证明就删会被撤回。
- **落子自动 X 整行整列；撤销只退落子，不恢复被消耗的笔记**——要手动补回。
- 解释一行一句（"第 8 列只剩一个位置"），逐格罗列会被判"看不到逻辑"。
- 压缩后：以台账 `state`/`verify` + 实时盘面为准，别把旧笔记当当前状态。

## 题型变体

- 迷你高尔夫（hard）：房间以 `wallRoomIdByIndex` 为准，沙漠房间包含沙地子区域（`room_subroom` 标记的子房间里的人算作大房间）；有些关卡不要求每个区域都有人，只按线索推。
- 每行/每列各一人是主流规则，但**不是所有关卡都有「每个区域必须有人」**——只从线索出发。

## 后台模式（headless）

侧栏面板不可见时（iframe 变成 0×0，DOM 点按与长按落不到盘面上）工具会自动切到**后台 headless Chromium**：

- 用 Playwright 自带的 Chromium（或 `config.chromePath` / 系统 Chrome）以 `--headless=new` 打开同一个 origin（`http://127.0.0.1:3080/play/...`），所以 DOM 与布局都是真实的；
- 动作集与前台一致（open / state / eval / text / snapshot / click / hold / back），行动前先把 `progress/local-storage.json` 里的快照喂进去；
- 每次动作后把页面 localStorage 的 `mrd_*` 拉回来写入 `progress/`，前台面板下次可见时用动作 `__sync` 把磁盘状态写回 iframe 并重载；
- 面板可见时永远优先走 iframe（`probeVisible` 检查 `frameElement` 宽度），你看到的和 agent 操作的是同一个页面；
- Chrome 启动带反节流参数（`--disable-background-timer-throttling` 等）并调 `Page.setWebLifecycleState('active')`，否则后台页的自动存档会被节流拖慢。

**跨命令连续性（已打磨）**

- 已经有后台页面时**绝不重载、绝不改导航**——之前每次命令都按前台 iframe 的地址重新导航，是「上一条命令的落子消失」的根因；
- 每条动作后调用 `settle()`：轮询页面 `mrd_*` 全量快照，等 app 的防抖存档真正落地（变化后再等 150ms 稳定）才写 `progress/`；
- 面板隐藏期间同步会跳过（`lastSync.reason = panel-hidden`），隐藏 iframe 的旧画面不会覆盖磁盘；
- 实测：分开 4 条命令做「写笔记 → 读回 → 落子 → 再读回」，状态全程保持，磁盘快照一致。

## 会话隔离

- Host 命令带 `session`（工具自动取 `exec.agent.session.id`）；
- 只有持有该 session 面板的页面会执行并回包，其它页面**保持沉默**；
- 面板没开时：不广播开标签页，只请「当前正显示该 session」的页面开一次，其余 session 不受影响。

## 本地存档（云端存档的替身）

原站的通关状态只写 Firestore（`saveProgress` 要求登录，匿名直接 return），所以离线时列表恒为 0。插件补了两层：

**页面 localStorage（与 DSH 同源、共享）**

| key | 内容 |
|---|---|
| `mrd_progress_<id>` | `{placed, xMarks, notes}` 盘面 |
| `mrd_timer_<id>` | 计时 |
| `mrd_catalog_v2` | 原站匿名完成状态（`✓ 案件已破`、`已完成 N 个` 读它） |
| `mrd_local_completed` | `history.js` 维护的本地历史 |
| `mrd_catalog_cache` | 题库目录（~68KB，镜像时排除） |

**工作区文件**

```
progress/
├── local-storage.json       # 全部 mrd_* 快照（每 15s + 每条命令后镜像）
├── history.json             # {puzzleId,title,completedAt,elapsedSeconds}
└── puzzles/<id>.json        # 每题盘面
```

- 下行：`syncProgress()` 通过桥 `eval` 读 localStorage → 写文件；
- 上行：面板挂 iframe **之前**先 `GET /__webpane/progress`，把磁盘快照里 localStorage 缺失的键写回去；
- 通关：`history.js` 检测页面出现「案件已破 / Case solved」→ 写 `mrd_catalog_v2`（原生计数和卡片 ✓）→ POST `/__webpane/completed` → `history.json`。

## HTTP 路由

| 路由 | 用途 |
|---|---|
| `GET /play/*`、`GET /play_puzzles/*` | 同源静态托管（HTML 注入 `history.js`） |
| `GET /__webpane/panel` | Client 执行器 SSE |
| `POST /__webpane/result` | 命令结果回传 |
| `POST /__webpane/cli` | 脚本/调试用命令入口（带 `session`） |
| `GET/POST /__webpane/history`、`/__webpane/completed` | 通关历史读写 |
| `GET /__webpane/progress` | 磁盘快照（只读） |
| `GET /__webpane/debug` | 连接数、最近同步、日志、client 插件图 |
| `GET /__webpane/history.js` | 注入脚本本体 |

## 排错

| 现象 | 处理 |
|---|---|
| `当前 session 的「网页」标签页没有打开` | 让用户在当前 session 点一次「网页 · Murdoku」；插件不会跨 session 弹 |
| `面板 state 超时` | 命令带了别的 session id（正常：别处沉默），检查 `$DSH_SESSION_ID` |
| eval 结果解析失败 | Host 可能 double-encode + 默认截断 6000；传 `limit`，解析两次 |
| 点卡片进不去 | 需要第二次点击且等 reveal 动画；用 `card.click()`（元素 rect 可能是 0） |
| 长按变笔记 | 按住 <600ms，给 900ms |
| 改代码不生效 | Host：`set_bundle` 重载；Client：刷新页面 |
| 「提交」偶尔没反应 | 最后一次落子后 React 重渲染，隔 400ms 再点一次，检查 `案件已破` |
| 房间名与 `room_code` 对不上 | 用 `room_name_xpos/ypos` 反查标签所在格子 |
| `lastSync.reason = panel-hidden` | 正常：面板隐藏时不同步磁盘 |

## 边界

- 页面与 DSH 同源 ⇒ 共享 localStorage（这是能读 DOM 的前提）。介意隔离的话可以改独立端口，代价是模型看不到 DOM；
- `open` 对相同 URL 直接返回、不重载；强制重载用 `eval` 执行 `location.reload()`；
- 注入只在 Host serve 时发生，不修改 `.worktree/original-app` 里的原站文件。
