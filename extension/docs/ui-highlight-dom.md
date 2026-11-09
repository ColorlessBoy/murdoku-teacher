# Murdoku UI 高亮：DOM 识别经验

> 结论先行：**选中嫌疑人时，游戏不会给 clue 对应的格子加 class。可见高亮是“当前嫌疑人候选笔记/cell”的行内样式。** clue 的空间格（例如 C 的 31 个角落）必须从游戏数据 `puzzle.suspects[].analyzedKeywords[].data.cellIndices` 读取，不能从高亮反推。

## 标记约定

- **【通用】**：跨关卡可复用的方法、引擎机制、读法；换关卡仍然成立。
- **【本关】**：只对 `puzzle-minigolf-hard` 有效。格子编号、角色颜色、房间/地形布局、C 的 31 格、F/V 线索、当前盘面都属于本关；换关必须重新读取。**禁止把本关数据套到别的关卡。**

---

## 1. 排查过程（【通用】方法）

对 Burma 选中 → Craig 选中做前后 DOM diff（角色名只是本关示例，方法是通用的）：

| 层 | 结果 |
|---|---|
| 200 个 `[data-cell-index]` 的 class / inline style / innerHTML / children | 0 变化 |
| clue 格（本关为 C 的 31 个角落） | 0 变化 |
| cell 的 `::before` / `::after` 伪元素 | 0 变化 |
| 所有 `<canvas>` 的 `toDataURL()` | 完全一致 |
| `<svg>` / board root / body class | 0 变化 |
| 选中嫌疑人 portrait button | **变了**：`border: 2px solid var(--select-primary); outline: 2px solid var(--select-primary)` |
| `grid-container` 的 `outerHTML` | **变了**：出现候选笔记的行内高亮 |

## 2. 可见高亮实际落在哪（【通用】机制 + 【本关】示例）

`grid-container.outerHTML` 前后 diff 中，变化段是：

```html
transform: scale(1.4); z-index: 10;
filter: drop-shadow(rgb(92, 172, 181) 0px 0px 3px);
```

- **【通用】** 选中嫌疑人后，**该嫌疑人已写下的候选笔记**（`.grid-note-letter`）获得行内 `transform: scale(1.4)`、`z-index: 10`、`filter: drop-shadow(<嫌疑人颜色> 0 0 3px)`；对应 cell 可能还有行内 `background` 变化。
- **【通用】** 高亮的是**候选笔记/cell**，不是 clue 的格子。
- **【本关】** 这里的 `<嫌疑人颜色>` 具体是 C 的 `rgb(92,172,181)`；其他角色颜色要读本关数据，不能复用。

### 识别代码（【通用】）

```js
// 选中嫌疑人后，找带行内高亮的笔记
[...document.querySelectorAll('.grid-note-letter')]
  .filter(el => /drop-shadow|scale\(1\.4\)/.test(el.getAttribute('style') || ''))

// 或直接 diff board 容器
const board = document.querySelector('.grid-container');
// 对比选中前后 board.outerHTML
```

## 3. clue 空间格：读游戏数据（【通用】读法 + 【本关】数据）

```js
// 从 cell 的 React fiber 找 puzzle.suspects（读法通用）
const suspects = puzzle.suspects;
const c = suspects.find(s => s.symbol === 'C');
const k = c.analyzedKeywords.find(x => x.term === '角落');
k.data.definition;  // 术语定义
k.data.cellIndices; // clue 对应的本关格子
```

**【本关】C 的 31 个角落格：**

```text
0,4,5,9,14,22,30,31,35,38,39,40,49,50,55,59,60,62,63,65,66,69,73,75,85,90,93,94,95,96,99
```

**【通用】注意：**

- 不是棋盘四角（本关四角 0,9,90,99 只是本关示例）；
- 角落是房间的两面墙交汇处，包含凹角；**每关的格子编号都不同，必须现场读**；
- 手动用房间边界算容易错；优先读 `analyzedKeywords[].data.cellIndices`。

## 4. 游戏语义：通用规则 vs 本关数据

### 【通用】

- **椅子/床可坐**：不要用 `objIdByIndex` 预过滤物件格。正确做法：把所有 clue-valid 格都点一遍笔记，游戏会拒绝不能坐的格。
- **房间与地形是两种东西**：房间是房间（有墙/角落语义），sand/path/water 这类是地形；判断“same room / 区域”前先确认游戏用的是房间还是地形。
- **`analyzedKeywords` 的定义优先于手算**：F 的“独自”、V 的“被害者”、H 的“旁边”等，以游戏返回的 `definition` 为准。
- **区域组成约束不能直接推出固定区域**：例如“某人所在区域没有其他人”只能说明该区域不能有别人，不能直接说一定在哪个房间。

### 【本关】

- **F 独自**：`该人所在的区域内没有其他人（连被害者也不算）`。这是区域组成约束，不能直接推出岛屿。
- **V 被害者**：`和凶手单独在一起`，即 V 所在区域包含 V + 凶手。不能直接推出木桶区；凶手和 V 的具体区域要另行确定。
- **C 不在角落**：本关角落 = 两面墙交汇处，31 格；C 候选 = 非角落、非小径、非沙漠、可坐的格子。
- **房间**：本关 5 个房间——入口、木桶区、岛屿、步道、沙漠；沙地/小径/水域是地形，不是房间。**这是本关布局，换关重读。**
- **角色颜色/坐标/当前盘面**：全部是本关数据，不能套用。

## 5. 易错点清单

- [ ] 【通用】不要用 cell 的 class 找选中高亮：class diff 为 0。
- [ ] 【通用】不要用 canvas `toDataURL` 找高亮：canvas 不变。
- [ ] 【通用】不要用伪元素找高亮：伪元素不变。
- [ ] 【通用】高亮 = 当前嫌疑人候选笔记的行内 `drop-shadow/scale`，不是 clue 格子。
- [ ] 【通用】clue 格子从 `analyzedKeywords[].data.cellIndices` 读。
- [ ] 【通用】不要把“没有候选笔记”说成“线索已满足”：笔记是候选，线索约束的是最终落子。
- [ ] 【本关】棋盘四角 ≠ 本关房间角落；C 用本关 31 格。
- [ ] 【通用】椅子/床可坐；点笔记让游戏拒绝阻挡格，不要预过滤 `objId`。
- [ ] 【本关】F/V 的“区域”是组成约束，不能直接锁岛屿/木桶区。
- [ ] 【本关】房间 5 个；沙地/小径/水域是地形（本关布局）。

## 6. 当前盘面状态（【本关】，会变）

```text
B 3, E 6, D 13, G 4, H 4, A 23, I 4, C 45, F 0, V 0
总候选 102，落子 0
```

- F/V 的岛屿/木桶区推导已撤回；
- A/C/E 因错误区域容量被撤的候选已恢复；
- 下一步可继续做 F/V 的区域约束，但必须先证明区域，不能直接假设。

## 7. 全局线索：计数约束（【通用】）

`puzzle.generalClues` 是**不绑定人物的全局线索**，本质是“最终盘面的计数约束”，不是某个角色的候选线索。

- 例：`桌子旁边正好有一个人` = 最终盘面里，所有“桌子旁边”的格子中恰好有 1 个有人；
- 例：`木桶旁边正好有一个人` = 木桶旁边格中恰好 1 个有人；
- “旁边”沿用同一区域的正交相邻定义；
- **不能**把全局线索直接写成“某角色在某格”的候选，也不能单独用它排除某人的笔记；它只能和别的约束一起用。

**【本关】数据（本关专用）：**

- 桌子格：7、8、69、77、78、79；
- 木桶格：37、48；
- 之前写的“桌旁候选 A/C 在 67/68/76”不是推导，已撤回；全局线索目前没有推出具体的人/格。

**【错误经验】**：把全局计数约束写成角色候选，会让学生无法理解；先说明“这是最终盘面计数”，再谈和其他约束的组合。

## 8. 读取笔记（【通用】）

笔记在 DOM 的 `.grid-note-letter` 里，但有两个坑：

1. 200 个 `[data-cell-index]` 是两层、100 个唯一格，必须只读**可见层**（`el.offsetWidth`）；
2. 同格可能重复，要 **dedupe**。

```js
function readNotes() {
  const out = {};
  for (const el of document.querySelectorAll('[data-cell-index]')) {
    if (!el.offsetWidth) continue;           // 只读可见层
    const i = +el.dataset.cellIndex;
    const notes = [...el.querySelectorAll('.grid-note-letter')]
      .map(x => x.textContent.trim()).filter(Boolean);
    if (notes.length) out[i] = [...new Set(notes)];  // dedupe
  }
  return out;
}
```

不要用 `document.querySelectorAll('.grid-note-letter').length` 直接当“笔记数”：两层会重复。

## 9. 房间 vs 地形（【通用】）

**关键区别：**

- `puzzle.wallRoomIdByIndex`：**真正的房间**（墙围起来的区域），clue 里的 “room / 区域 / alone / victim” 用它；
- `puzzle.roomIdByIndex`：**地形/地板**（沙漠、沙地、小径、水域、步道等），不是房间；
- `roomLabels[].isSubarea === true` 的项是子区域（地形）；子区域可以属于更大的房间。

**【本关】示例：**

- 沙漠房间 = `0,1,2,3,4,10,11,12,13,14,20,21,30,31`；
- 其中 11、12、20、21 是沙地砖，但**属于沙漠房间**；
- 步道房间包含小径格；岛屿房间包含水域格；
- 所以 I 的沙漠候选必须包含 11、12、20、21，否则会漏。

**【错误经验】**：用 `roomIdByIndex`（地形）当房间去推 I/H/F/V，会把“沙地砖在沙漠房间里”这件事完全漏掉。房间只看 `wallRoomIdByIndex`。

## 10. 无条件空格：候选行/列的交叉（【通用】）

当线索说“某人站在某类格子上”，而这类格子的候选只剩少数几个时，这些候选的**行/列交叉格**可以无条件为空：

- 例：旗上的人只能在 R2C5 或 R9C1；
- R2C1 同时在 R2（候选旗 1 的行）和 C1（候选旗 2 的列）；
- R9C5 同时在 R9（候选旗 2 的行）和 C5（候选旗 1 的列）；
- 无论哪面旗有人，这两格都会被某一行/列占用，所以必空。

**【错误经验】** 不要因为“某面旗可能有人”就把整行/整列全叉掉；只有交叉格是无条件的。本例：R2C1（i10）和 R9C5（i84）无条件空；整行 R9、整列 C1 的其他格不是无条件的。

## 11. 落子与撤销的自动行为（【通用】）

- 落子会自动把该格所在的**整行**和**整列**打 X；
- **撤销**只退回落子，**不会恢复**被落子消耗的笔记（单候选格撤销后仍然没有笔记）；
- 所以撤销后要手动补回丢失的笔记，再继续推理；不要假设撤销等于"回到上一步"。

## 12. 本关参考解（【本关】puzzle-minigolf-hard）

```text
G=1(R1C2)  I=14(R2C5)  B=23(R3C4)  V=38(R4C9)  H=42(R5C3)
E=57(R6C8) D=65(R7C6)  C=76(R8C7)  F=80(R9C1)  A=99(R10C10)
凶手 = E（Elyana），受害者 = V（Valeria）
```

关键推理捷径：C8 列只剩 E 的 57、C9 列只剩 V 的 38（列唯一候选）；C7–C9 三列 = E + 桌旁人 + 桶旁人。

## 13. 会话台账（【通用】state/action/state'）

- 读取：`node scripts/murdoku-state.mjs`（CDP 读 `mrd_progress_<puzzle>` + 可见 DOM 笔记，输出 placed/notes/xMarks）；
- 台账：`progress/ledger/<puzzle>.jsonl`，每行 `{state_before, action, user, state_after}`；
- 命令：`node scripts/murdoku-ledger.mjs init|state|append|verify|rollback --puzzle <id>`；
- 压缩/恢复：先 `verify`；`ok:true` 从最后 state_after 继续；不一致以 DOM 为准并写 resync；
- 会话复盘见 `docs/session-2026-11-10-minigolf.md`，完整台账见 `extension/lessons/puzzle-minigolf-hard-ledger.json`。
