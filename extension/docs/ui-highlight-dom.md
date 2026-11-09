# Murdoku UI 高亮：DOM 识别经验

> 结论先行：**选中嫌疑人时，游戏不会给 clue 对应的格子加 class。可见高亮是“当前嫌疑人候选笔记/cell”的行内样式。** clue 的空间格（例如 C 的 31 个角落）必须从游戏数据 `puzzle.suspects[].analyzedKeywords[].data.cellIndices` 读取，不能从高亮反推。

## 1. 排查过程（已验证）

对 Burma 选中 → Craig 选中做前后 DOM diff：

| 层 | 结果 |
|---|---|
| 200 个 `[data-cell-index]` 的 class / inline style / innerHTML / children | 0 变化 |
| 31 个 clue 格（C 的角落） | 0 变化 |
| cell 的 `::before` / `::after` 伪元素 | 0 变化 |
| 所有 `<canvas>` 的 `toDataURL()` | 完全一致 |
| `<svg>` / board root / body class | 0 变化 |
| 选中嫌疑人 portrait button | **变了**：`border: 2px solid var(--select-primary); outline: 2px solid var(--select-primary)` |
| `grid-container` 的 `outerHTML` | **变了**：出现候选笔记的行内高亮 |

## 2. 可见高亮实际落在哪

`grid-container.outerHTML` 前后 diff 中，变化段是：

```html
<!-- 选中后，候选笔记子元素出现 -->
transform: scale(1.4); z-index: 10;
filter: drop-shadow(rgb(92, 172, 181) 0px 0px 3px);
```

即：

- 选中嫌疑人后，**该嫌疑人已写下的候选笔记**（`.grid-note-letter`）获得行内 `transform: scale(1.4)`、`z-index: 10`、`filter: drop-shadow(<嫌疑人颜色> 0 0 3px)`；
- 对应 cell 可能还有行内 `background` 变化；
- 高亮的是**候选笔记/cell**，不是 clue 的 31 个格子；
- 高亮颜色是嫌疑人颜色（C = `rgb(92, 172, 181)`）。

### 识别代码

```js
// 选中嫌疑人后，找带行内高亮的笔记
[...document.querySelectorAll('.grid-note-letter')]
  .filter(el => /drop-shadow|scale\(1\.4\)/.test(el.getAttribute('style') || ''))

// 或直接 diff board 容器
const board = document.querySelector('.grid-container');
// 对比选中前后 board.outerHTML
```

## 3. clue 空间格：读游戏数据

```js
// 从 cell 的 React fiber 找 puzzle.suspects
const suspects = puzzle.suspects;
const c = suspects.find(s => s.symbol === 'C');
const k = c.analyzedKeywords.find(x => x.term === '角落');
k.data.definition;  // "位于两面墙交汇处的格子。"
k.data.cellIndices; // C 的 31 个角落格
```

C 的 31 个角落格：

```text
0,4,5,9,14,22,30,31,35,38,39,40,49,50,55,59,60,62,63,65,66,69,73,75,85,90,93,94,95,96,99
```

注意：

- 不是棋盘四角（0,9,90,99）；
- 是房间的两面墙交汇处，包含凹角；
- 手动用 5 个房间边界算会算错；直接用 `analyzedKeywords`.

## 4. 其他已验证的游戏语义

- **F 独自**：`该人所在的区域内没有其他人（连被害者也不算）`。这是区域组成约束，**不能直接推出岛屿**。
- **V 被害者**：`和凶手单独在一起`，即 V 所在区域包含 V + 凶手。**不能直接推出木桶区**；凶手和 V 的具体区域要另行确定。
- **C 不在角落**：角落 = 两面墙交汇处，31 格；C 候选 = 非角落、非小径、非沙漠、可坐的格子。
- **椅子/床可坐**：不要用 `objIdByIndex` 预过滤物件格。正确做法：**把所有 clue-valid 格都点一遍笔记，游戏会拒绝不能坐的格**。
- **房间/地形**：房间是 5 个（入口、木桶区、岛屿、步道、沙漠）；沙地/小径/水域是地形，不是房间。

## 5. 易错点清单

- [ ] 不要用 cell 的 class 找选中高亮：class diff 为 0。
- [ ] 不要用 canvas `toDataURL` 找高亮：canvas 不变。
- [ ] 不要用伪元素找高亮：伪元素不变。
- [ ] 高亮 = 当前嫌疑人候选笔记的行内 `drop-shadow/scale`，不是 clue 格子。
- [ ] clue 格子从 `analyzedKeywords[].data.cellIndices` 读。
- [ ] 棋盘四角 ≠ 房间角落；C 用 31 格。
- [ ] 椅子/床可坐；点笔记让游戏拒绝阻挡格，不要预过滤 `objId`。
- [ ] F/V 的“区域”是组成约束，不能直接锁岛屿/木桶区。
- [ ] 房间 5 个；沙地/小径/水域是地形。

## 6. 当前盘面状态（本局）

```text
B 3, E 6, D 13, G 4, H 4, A 23, I 4, C 45, F 0, V 0
总候选 102，落子 0
```

- F/V 的岛屿/木桶区推导已撤回；
- A/C/E 因错误区域容量被撤的候选已恢复；
- 下一步可继续做 F/V 的区域约束，但必须先证明区域，不能直接假设。
