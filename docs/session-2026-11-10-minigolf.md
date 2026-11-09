# Session 2026-11-10 · 迷你高尔夫（困难）教学闭环复盘

会话：`session-2d961e8f-48ae-490f-a5ed-468bab64f9c6`（DSH，325 turns）
日志：`~/.dsh/sessions/--Users-penglingwei-Documents-murdoku--/session-2d961e8f-.../session.v4.jsonl.zstd`（20342 条事件；16 次 compaction/start、9 次 compaction/summary）

## 0. 会话结构（压缩前 vs 压缩后）

| 阶段 | turn 范围 | 事件 | 结果 |
|---|---|---|---|
| 学站点/做 Wine Cellar | 1–约 250 | 早期 7 次 compaction | 前期经验固化 |
| 教学尝试（B/E/D/G/H/A） | 约 252–270 | 第 8 次 compaction（18519） | B/E/D/G/H/A 候选、G 落子被否、回滚 |
| 最终闭环（本题） | 约 270–324 | 第 9 次 compaction（19969）后继续 | 10 人落齐、提交、案件已破 |
| 复盘（本文件） | 325 | — | 台账 + 机制 + skill |

压缩把“盘面/推理过程”反复截断，导致过：把旧笔记当当前盘面、越界删笔记、用官方解倒推。解决方式见第 2 节。

## 1. 做题过程：(state, action, state') 台账

完整机器可读版：`extension/lessons/puzzle-minigolf-hard-ledger.json`、`progress/ledger/puzzle-minigolf-hard.jsonl`（31 步）。
state = `{placed, notes, xMarks, notesTotal}`；action = `{kind, who, cells, reason}`；user = `accept / reject / none / rollback`。

| # | state（before） | action | state'（after） | 用户 |
|---|---|---|---|---|
| 1 | 空盘 | B 椅子候选 23/96/97 | B3 | accept |
| 2 | B3 | E 沙地候选 11/12/20/21/56/57 | B3+E6 | accept |
| 3 | 9 | D 小径候选 15 格 | 24 | accept |
| 4 | 24 | G 顶行候选 0/1/2/3 | 28 | accept |
| 5 | 28 | H 花旁候选 19/42/43/94 | 32 | accept |
| 6 | 32 | A 旗下行候选（第 3/7/10 行 23 格） | 55 | accept |
| 7 | 55 | G 落 R1C2（“列唯一”——倒推官方解） | G@1 | **reject 胡说八道** |
| 8 | G@1 | 撤销 G（撤销不恢复 G@1 笔记） | 54 | rollback |
| 9 | 54 | 补回 G@1 笔记 | 55 | accept |
| 10 | 55 | 房间改用 wallRoomIdByIndex；沙漠房间含沙地 11/12/20/21；I 候选补齐 8 格，删沙漠 C/E/A 冲突 | 96 | accept |
| 11 | 96 | 第 6 行 = E；X 50/51/53/54/55/58/59 | E2 | accept |
| 12 | E2 | 第 1 行 = G；X 5/6 | G4 | accept |
| 13 | G4 | V 三个可能房间全写（木桶/岛屿/入口） | V35 | accept（候选多） |
| 14 | V35 | A 第 7 行删除（旗 55 下一行不可能） | A15 | accept |
| 15 | A15 | A 的 24/90 删除（同列正下方违背每列一人） | A13 | accept |
| 16 | A13 | 用户叉 R2C1、R9C5：旗 14/80 两面候选，交叉格必空 | I7 C35 | accept（用户自己） |
| 17 | 113 | C7–C9 三列 = E+桌旁人+桶旁人；删 A/B 的 96/97/98 | A12 B1 | accept |
| 18 | 110 | B 落 23（唯一椅子） | B@23 | accept 我理解了 |
| 19 | B@23 | G 落 1（列1旗、列3 H、列4 B） | G@1 | accept（先质疑后继续） |
| 20 | B@23 G@1 | I 落 14（列唯一） | I@14 | accept 理解 |
| 21 | … | A 落 99（91 列2、94 列5 排掉） | A@99 | none |
| 22 | … | D 落 65（唯一小径格） | D@65 | none |
| 23 | … | H 落 42（唯一候选、花旁） | H@42 | none |
| 24 | … | E 落 57（C8 列唯一） | E@57 | **reject** |
| 25 | … | 回滚 E（撤销丢 57 笔记，手动补回） | E 候选 56/57 | rollback |
| 26 | … | E 重新落 57（用户：第 9 列只剩一个位置） | E@57 | accept |
| 27 | … | V 落 38（C9 列唯一；V+E 同木桶区 → 凶手 E） | V@38 | accept |
| 28 | … | C 落 76（第 8 行唯一；C80 排掉 → 旗 80 只剩 F） | C@76 | none |
| 29 | … | H 落 42、F 落 80 | 10 人齐 | done |
| 30 | 全落 | 提交 | 案件已破：Elyana(E) 杀 Valeria(V) | accept |

## 2. 机制：压缩不丢盘面

### 文件

- `scripts/murdoku-state.mjs`：从 CDP 读游戏 `mrd_progress_<puzzle>`（落子/X）+ 可见 DOM 笔记，输出 `{puzzle, placed, notes, xMarks, notesTotal}`。
- `scripts/murdoku-ledger.mjs`：`init | state | append | verify | rollback`。
- `progress/ledger/<puzzle>.jsonl`：每步 `state_before → action → state_after (+ user)`。
- `extension/lessons/puzzle-minigolf-hard-ledger.json`：人类可读台账（31 步）。

### 每步协议

1. `node scripts/murdoku-ledger.mjs verify --puzzle <id>`（压缩后必做；`ok:true` 才继续）；
2. 只做一步盘面操作；
3. 回读盘面；
4. `append --action '<json>' --user accept|reject|none --note '...'`。

### 压缩/恢复

- 上下文被压缩后：`state` 取最后 `state_after`；`verify` 与实时盘面比对；不一致以 DOM 为准，写一条 `resync`。
- 撤销/回滚：`rollback --to <step>` 记录引用；**撤销不会恢复被落子消耗的笔记，必须手动补**（本会话 H@42、E@56/57、G@1 都踩过）。
- 被否的步骤保留（`user:"reject"`），不能从历史里删掉。

## 3. 本次踩坑（均已进 skill）

1. 倒推官方解 → 编“列唯一”理由 → 被“胡说八道”驳回。**禁止 answer-driven。**
2. 整行/整列过度 X（旗 80 的 9 行/1 列未证先删）→ 用户撤回。**只有交叉格无条件空。**
3. 落子自动 X 整行整列；撤销只退落子、不恢复笔记。
4. 讲太复杂被拒：C8 列“只剩一个位置”一句话即可，不要逐格罗列排除。
5. 压缩后不要把“旧笔记/旧盘面”当当前状态；以 ledger/实时盘面为准。
