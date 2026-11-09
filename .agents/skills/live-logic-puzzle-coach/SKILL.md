---
name: live-logic-puzzle-coach
description: Use when solving or coaching a live logic puzzle (Murdoku, Sudoku-like, murder mystery) on a web board with a chat/HUD side panel, especially when the user requires step-by-step, assumption-free deduction with visible notation and no brute force.
metadata:
  requires:
    chrome-extension: "Playwriter 0.10.0 (CDP bridge at http://127.0.0.1:19988)"
    node-package: "playwright-core (CDP client only; not the Python playwright package)"
---

# Live Logic Puzzle Coach

## When to use

- The puzzle runs on a live web page; placements, notes, and X marks are DOM state.
- A side panel / chat log confirms each step before execution.
- The user forbids brute force, enumeration, backtracking, case splits, or "suppose" reasoning.
- The user wants to see the deduction, not just the answer.

## Dependencies

- **Playwriter Chrome extension** — this is the browser bridge, not the Python `playwright` package and not a bundled browser. It exposes the Chrome profile over CDP at `http://127.0.0.1:19988`. Verify with:
  ```bash
  curl -s http://127.0.0.1:19988/json/version
  ```
  Expect `{"Browser":"Playwriter/..."}`.
- **Node `playwright-core`** — used only as a CDP client. It does not launch Chrome; it connects to the extension's bridge.
- The puzzle tab must already be open in that Chrome profile. Only one CDP client can connect at a time.
- `assets/attach.mjs` verifies the bridge, lists tabs, matches the puzzle URL, and can open a tab via `MURDOKU_OPEN`.

## Non-negotiables

1. **Never read the answer.** Sanitize the puzzle data first: remove `solution_*`, `player_hint_*`, `murderer`, and any answer fields. Work only from clues, rooms, objects, and the live board.
2. **Board state is the source of truth.** Before every proposal, read placements, notes, and X marks. A condition not visible on the board must be marked before it is used.
3. **One action per popup, one condition per step.** If the reason reads like a paragraph, split it. Simple steps get one sentence.
4. **No assumptions.** Only forced elimination or capacity-forced placement. If a step starts with "suppose", it is not forced; find the capacity/single-cell version.
5. **One notation meaning.** A letter in a cell means "this person may be here". Never use a note to mean "this cell may contain one of these people". Delete notes that mix meanings.
6. **The ledger is the board.** Every board operation (note / X / place / undo / rollback) is a `(state, action, state')` record appended to `progress/ledger/<puzzle>.jsonl` by `scripts/murdoku-ledger.mjs`. The chat context may be compacted; the ledger is not. On any resume, read/verify the ledger before touching the board.

## Workflow

### 1. Data and rules

- Extract rooms, blocked objects (tables, shelves, TVs, plants, barrels), occupiable cells, chairs, bed cells.
- **Rooms vs terrain:** the actual room is `puzzle.wallRoomIdByIndex`; `puzzle.roomIdByIndex` is the floor/terrain and must NOT be used as "room". `roomLabels[].isSubarea` marks terrain subareas that belong to a larger room (e.g. sand tiles inside the desert room).
- Pin down every predicate **before** solving:
  - `beside` = orthogonally adjacent **and same room**.
  - `east of` = any column to the right (same row not required unless stated).
  - `spans` = an object may cover multiple cells (a bed may be 2 cells). Verify from data/rendering; do not assume one cell.
  - `exactly one` / `exactly two` apply to the whole board.
- Turn each clue into a unary filter first; then combine.
- **Disjunctive-row/column intersection:** when a clue says "someone is on a flag/type of cell" and the candidate cells for that person are limited to a few, the intersections of their rows and columns can be unconditionally empty. Example: flag person is on R2C5 or R9C1; R2C1 is on R2 and C1, R9C5 is on R9 and C5; whichever flag holds the person, both cells are occupied by that row/column, so both are empty without knowing which flag. Do not over-generalize to the whole row/column: only the intersections are unconditional.
- **Placement auto-X + undo gap:** placing a suspect auto-Xes its whole row and column. The game's Undo reverts the placement but does NOT restore the notes that placement consumed (a single-candidate note stays gone); after undoing, manually re-add the lost notes before reasoning further.
- **Column/row single-position:** when a column (or row) has only one remaining candidate note, that role is placed there; prefer this one-line argument over enumerating every eliminated cell.
- **Read all clue sources:** `suspects[].analyzedKeywords` AND `puzzle.generalClues`. Global clues are not bound to a character; they are **counting constraints on the final arrangement** (e.g. "exactly one person beside a table/barrel") and must not be rewritten as a role's candidate notes. Object cells come from `puzzle.objectNameByIndex`.

### 2. Board reader

- Read the DOM: placed letters, small notes, and X marks. Keep a `/board` endpoint or an equivalent snapshot.
- **Placing a person auto-X's the entire row and column.** Never manually re-X those cells; read them instead.
- Maintain a small state file: placements, X set, notes per person. Re-read after every action.
- Distinguish object images from X images; if unsure, derive the X set from placements (row/column) plus manual X steps.

### 3. Candidate notation

- Add notes only for a person's possible cells; keep the set honest and complete.
- When a deduction narrows a person to a set, rewrite the notes; do not stack a second meaning on the same letters.
- If a note's meaning is ambiguous, delete it and restate the claim in the chat.

### 4. Deduction discipline

- Look for the **logical head**:
  - a row/column/room with a single empty cell;
  - a room whose only possible occupant is one person;
  - a capacity constraint: room must be non-empty, room exactly 2, exactly two chairs, one per row/column.
- Prefer forced moves in this order:
  1. capacity (room cannot be empty; room exactly N);
  2. single remaining cell in a row/column/room;
  3. column/row intersection conflicts;
  4. chair/object counts.
- Each step states: condition → cells → conclusion. No hidden links.
- If a cell is already X'd or occupied, do not propose it.
- Split multiple exclusions into separate popups; one cell or one group per step.

### 5. Execution loop

- One action per popup: `place`, `xmark`, or `notes`.
- Marks in the HUD must match the reason: green = placement, grey = exclusion, amber = candidate.
- After approval: execute, then **read the board back** and verify auto-X/notes before the next step.
- Persist chat history to JSON so feedback and rejected steps survive restarts; mark stale pending entries as aborted on load.
- If a browser click hangs, free the CDP connection and click directly; do not leave queued plans running.

### 6. Context hygiene

- Long sessions pollute reasoning. When it happens, write a clean brief:
  rules, rooms, objects, placements, X set, notes, derived facts, and the ban on assumptions/enumeration.
- Give the brief to a subagent for **one next forced deduction**; the parent executes.
- Ask the subagent to return: the deduction, the one-condition-per-line reason, the key clue, and an explicit "no forced step" if that is the case.

### 7. Durable (state, action, state') ledger — compaction-proof

The conversation gets compacted (this project had 9 compaction summaries in one session); the board does not. Keep the process on disk:

- **State reader:** `node scripts/murdoku-state.mjs` prints the canonical state `{placed, notes, xMarks, notesTotal}` read from the game's own `mrd_progress_<puzzle>` plus the visible DOM notes. Add `--out <file>` to save.
- **Ledger:** `progress/ledger/<puzzle>.jsonl`, one JSON per line:
  - header: `{"type":"header","version":1,"puzzle":...}`
  - step: `{"type":"step","step":n,"state_before":...,"action":{kind,who,cells,reason},"user":"accept|reject|none|rollback","note":"...","state_after":...}`
- **Commands:** `node scripts/murdoku-ledger.mjs init|state|append|verify|rollback --puzzle <id>`
  - `state` prints the last `state_after` (pure file, no CDP);
  - `append --action '<json>' --user accept --note '...'` snapshots the live board and appends the step;
  - `verify` compares the last state with the live board (`ok:true` = in sync; the diff shows what changed);
  - `rollback --to <step>` records the rollback and prints the state to restore.
- **Protocol per step:** (1) `verify`; (2) one operation; (3) read the board; (4) `append` with the reason + user feedback. Never batch several deductions into one record.
- **Resume after compaction:** run `murdoku-ledger.mjs state` / `verify`. If `ok` is true, continue from the last `state_after`. If not, the DOM is the truth: append a `resync` record (the live state) and continue. Never reconstruct the board from the chat.
- **Rejected steps stay in the ledger** (`user:"reject"`), and a `rollback` record references the target step; the restore is manual (the game's Undo does not restore consumed notes).
- **Teaching loop:** execute one step first, then explain, then ask "能理解吗？"; if rejected, roll back to the last accepted state before proposing anything else. Prefer one-line forced arguments (e.g. "column 8 has only one position left") over long enumeration; the student rejects over-complicated reasoning even when the conclusion is right.
- **Never answer-driven:** do not use the official `solution_*`/`murderer` to reverse-engineer a "reason". A step that starts from the known answer and invents a column/row rationale is a hard error (it was rejected as "胡说八道" in this project).

## Architecture: one product, two layers

The companion is one product with two cooperating layers. Do not present them as separate tools.

**Interaction layer (main agent)**

- Owns `assets/sidebar-server.mjs`: chat panel, marks, split layout, action execution, persistence.
- Talks to the user, reads the board, runs one popup at a time.
- Never does deep deduction in a polluted context.

**Logic layer (subagent)**

- Receives a clean brief: rules, rooms, objects, placements, X, notes, derived facts.
- Returns one forced deduction at a time: conclusion, one-condition-per-line reason, key clue, or "no forced step".
- Has no UI/execution context; this keeps the logic module pure.

**Message loop**

- Main → logic: board snapshot + question ("next forced step?") + user feedback/rejection.
- Logic → main: deduction card + key clue.
- Main may challenge: "is this forced? what about <cell>?"; logic revises.
- Sync after every placement, after a rejection, and when stuck — not one-shot.

**Why**

- Context pollution is the main source of reasoning errors; separating layers keeps the logic clean.
- The chat panel is the product surface; the subagent is the engine behind it.

## Chat panel behaviour

The bundled panel is a chat, not a debug console:

- assistant bubble: "老师 · 第 N 步 · HH:MM", title, reason, mark legend;
- user bubble: "你 · 确认" or "你 · 反馈", with ✓/✗ and the feedback text;
- pending card: assistant bubble with an inline form (确定执行 / 不执行 / 反馈输入);
- system line: "（第 N 步已作废）" for aborted entries;
- header: status dot + "老师在讲解第 N 步 · 等你确认" or "推理记录已同步";
- messages scroll to the bottom; the sidebar is resizable and collapses to a tab.

## Current panel (v7)

- Two modes: 教学 (purple/gold) and 考试 (dark red); Momo persona; one log with 教学/考试 labels.
- Endpoints: `/state`, `/board`, `/health`, `/ui`, `/exam/state`, `/exam/wait`, `/exam/reply`, `/clear`, `/new?force=1`, `/reload`, `/snaps`, `/snap?idx=N`, `/localhist`, `/apply?idx=N`, `/rollback?to=N`, `/cells`, `/dupes`, `/tool`, `/labels`.
- `/clear` = the site's clear button `button[title="长按以清除所有格子"]` (long-press ~1.2 s) + clear marks + keep chat. Never reload for clear.
- `/new?force=1` = full reset (chat + board); gated.
- Exam: batches changes over 700 ms; one question pending; 2.5 s warmup after injection; the gate releases on the user's answer or on a verdict.

## Board DOM contract

- 200 `[data-cell-index]` elements, 100 unique indices, two layers at identical rects. Compute columns from **unique** indices (10), not `Math.sqrt(200)` (14).
- Placement: single-letter text or portrait; notes: `.grid-note-letter`; X: `img` with `src` containing `87.7`.
- Read notes per **visible** cell: `[...el.querySelectorAll('.grid-note-letter')]` with `el.offsetWidth`, then dedupe. Raw `.grid-note-letter` count double-counts the two cell layers.
- `clearBoard` long-presses the clear button; never use reload as clear.
- The game may persist some pieces but not all in-progress notation; localStorage `mg_hist` is the recovery source.

## Murdoku UI highlight (verified)

- Selecting a suspect changes only the portrait button (`border/outline: var(--select-primary)`); cell class/inline style/innerHTML/children/pseudo-elements, SVG, board root, body and all canvas `toDataURL()` stay unchanged.
- The visible highlight is inline on the selected suspect's **candidate notes/cells**: `.grid-note-letter` gets `transform: scale(1.4); z-index: 10; filter: drop-shadow(<suspect color> 0 0 3px)`, plus cell inline `background` changes.
- The highlighted cells are the suspect's candidate notes, **not** the clue's highlighted cells.
- Clue spatial cells come from `puzzle.suspects[].analyzedKeywords[].data.cellIndices`. **These are level-specific.** Example (current level only): C's "not in a corner" has 31 room-corner cells, definition "位于两面墙交汇处的格子"; never hardcode this list for another level.
- Identify the highlight by diffing `.grid-container.outerHTML`, or querying `.grid-note-letter` for inline `drop-shadow`/`scale(1.4)`.
- Room/terrain: the current level has 5 rooms (entrance, barrels, island, walkway, desert); sand/path/water are terrain, not rooms. **Room layout is level-specific; read it per level.**
- Never prefilter occupiable objects by `objId`; click every clue-valid cell and let the game reject blocked cells.
- F's "alone" and V's victim clue are area-composition constraints; they do **not** directly fix the island/barrels area.

## Consent and recovery

- Never reload, replay, or clear the board without explicit consent; a reload can wipe in-progress notation.
- Restore: last full snapshot (`/snap?idx=N`) → clear via the site button → placements → note groups (one card click per letter) → X in one batch (skip existing) → verify.
- Do not toggle notes per cell; select a letter once and click all its cells.
- Old MutationObservers survive panel injection; use a generation token and one reload; duplicate questions come from two observers.

## Failure modes

| Symptom | Root cause | Fix |
|---|---|---|
| Bed person assumed to be in row 1 | Bed modeled as one cell; it spans two | Enumerate the object footprint; exactly one of the cells is occupied |
| "Beside" included cross-room cells | Adjacency applied without room check | For each candidate: `room(cell) == room(object)` |
| Used "Gino is in the bathroom" before marking it | Condition not visible on the board | Mark the condition first; then use it |
| Re-X'd cells that were already X'd | Ignored auto row/column X after a placement | Read the board's X; never re-X |
| A/V notes on bed cells meant two different things | Notation semantics collision | One meaning only: "this person may be here" |
| A 4-line chain rejected | Too complex for one popup | Split into one-condition steps; one sentence each |
| Multiple queued plans, UI chaos | Fired plans without waiting | One plan at a time; kill/stop before resending |
| Submit click hung | Selector/action blocked | Free CDP, click directly, verify the result modal |
| User says "you can't see the board" | Reasoning from memory, not DOM | Re-read `/board` before every claim |
| Duplicate questions for one change | Old MutationObserver still running after a version bump | Generation token + one page reload |
| Chat empty after clear | Exam messages were page-local | Server-owned `exam.chat` + `exam-chat.json` |
| Notation wiped by reload | Game does not persist all in-progress marks | Never reload without consent; restore from `mg_hist` |
| Restore toggles notes | Per-cell note clicks toggle | Clear first; group notes by letter; X in one batch |
| Highlight offset | Columns computed from 200 cells (`sqrt`=14) | Use 100 unique indices (10) |
| User sees highlight but cell class diff is 0 | Highlight is inline on the selected suspect's notes/cells | Diff `.grid-container.outerHTML`; query `.grid-note-letter` inline `drop-shadow`/`scale(1.4)`; read clue cells from `analyzedKeywords[].data.cellIndices` |
| Corner defined as the four board corners | Room corner = 2+ thick wall edges, incl. concave | Read the game's `analyzedKeywords` cellIndices per level (current-level C has 31; level-specific) |
| Chair/bed candidate excluded as object | `objId` prefilter also removes occupiable objects | Click all clue-valid cells; let the game reject blocked cells |
| Said a clue was "satisfied" because no candidate notes remained | Notes are candidates; the clue constrains final placements | Say "other roles excluded from this area", not "clue satisfied"; the clue is only satisfied after final placement |
| F forced into island / V forced into barrels | "alone"/"victim" are area-composition constraints, not fixed areas | Do not write area-only candidates until the area is proven; prove room composition first |

## Checklists

Before each step:

- [ ] Read the board: placements, notes, X.
- [ ] Is the target cell already X'd or occupied?
- [ ] Is the reason forced (no "suppose")?
- [ ] Is it one condition and one sentence?
- [ ] Does the notation match the claim?

After each step:

- [ ] Read the board back; did auto-X apply?
- [ ] Clean up notes that are now impossible.
- [ ] Persist history; mark stale pending entries.

## Case study: The Wine Cellar (Murdoku, 9×9)

Final placement:

```
R1C5 Austin   R2C1 Gino    R3C9 Herman
R4C8 Dawn     R5C3 Fred    R6C6 Elodie
R7C2 Vin      R8C4 Chloe   R9C7 Benton
```

Murderer: **Elodie** (alone with Vin in the Basement).

Key chain that worked:

1. Bed = R1C5 + R2C5, exactly one occupied; both cells are column 5, so column 5 is taken.
2. Gino's candidates are all in rows 1–2; the bed person is in row 1 or 2 → rows 1–2 are exactly Gino + the bed person.
3. Main Bedroom then contains only the bed person; Vin's room must contain exactly 2 → Vin cannot be the bed person → **Austin = bed person**.
4. Living Room cannot be empty and only Fred or Vin can be there; Vin there would need a second person (breaking Fred's "alone") → **Fred = R5C3**.
5. After Fred takes row 5, Dining has only R4C8; Vin there cannot form a 2-person room → **Dawn = R4C8**.
6. Row 8 has only R8C4 left → column 4 is taken → **R6C4 is X**.
7. Chairs: Fred + Gino only; G at R2C2 would kill the second chair → **Gino = R2C1**.
8. Then rows/columns force **Austin = R1C5, Elodie = R6C6, Chloe = R8C4, Vin = R7C2**.

Mistakes to remember:

- The bed is two cells, not one.
- "Beside" is same-room; R6C4 and R7C8 were wrong Chloe candidates for that reason.
- R1C3/R2C3 were already auto-X'd by Fred's column 3; do not re-X.
- The logical head was "row 8 has one empty cell", not a deep four-line chain.

## Bundled code: the chat panel

`assets/sidebar-server.mjs` is the working side-panel server used in this session. It attaches through the Playwriter extension (not the Python `playwright` package). It:

- injects `MARKS` (highlight boxes that follow zoom/resize) and `CHAT` (left sidebar chat log, resizable width, split layout);
- serves `GET /state`, `GET /board`, `POST /act`, `POST /decide`;
- persists chat history to `chat-history.json` and marks stale pending entries `aborted`;
- executes actions: `select`, `place`, `notes`, `xmark`, `xmarks`, `submit`.

Run:

```bash
PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
MURDOKU_DIR=/tmp/murdoku MURDOKU_URL_MATCH=wine-cellar \
CDP_URL=http://127.0.0.1:19988 PORT=7791 \
node assets/sidebar-server.mjs plan.json
```

Plan format: `{ "actions": [ ... ] }`, one action per popup. The sidebar's 确定执行/不执行 buttons call `__mdecide`, which resolves the action; a rejection stops the plan and writes `last-feedback.json`.

Action shapes:

```json
{ "type": "select", "name": "Austin", "title": "...", "reason": "...", "marks": [] }
{ "type": "place", "name": "Fred", "r": 5, "c": 3, "title": "...", "reason": "...", "marks": [] }
{ "type": "notes", "name": "Gino", "cells": [{"r":1,"c":4}], "title": "...", "reason": "...", "marks": [] }
{ "type": "xmark", "name": "Gino", "r": 2, "c": 2, "title": "...", "reason": "...", "marks": [] }
{ "type": "xmarks", "cells": [{"r":3,"c":5}], "title": "...", "reason": "...", "marks": [] }
{ "type": "submit", "title": "提交", "reason": "...", "marks": [] }
```

Notes:

- Only one CDP client at a time; kill the previous server before reconnecting.
- `submit` clicks the game's 提交 button via a DOM click (avoids Playwright actionability hangs).
- The sidebar is injected with `addInitScript` so it survives reloads; the page is matched by `MURDOKU_URL_MATCH` (default `murdoku.com`), or the first page if none matches.
- Keep the sidebar resizable and in normal layout (body padding + scaled game root) rather than an overlay.
- For exam mode, reuse `/board` and the sidebar, but replace `POST /act` plans with verdict cards (see `murdoku-exam-coach`).

## Launch and attach (known gap)

There is no reliable programmatic launch for the Chrome extension yet; this is a product gap to close.

Current flow:

1. Start Chrome with the Playwriter extension.
2. Open the puzzle tab (or set `MURDOKU_OPEN` for `attach.mjs`).
3. Run `node assets/attach.mjs` to verify the bridge, list tabs, and match the puzzle URL.
4. Start `assets/sidebar-server.mjs`; it attaches to the matching tab and injects the panel.

Failure modes:

- Bridge down → `attach.mjs` exits 1; start Chrome/extension.
- No matching tab → exits 2; open the puzzle tab or set `MURDOKU_OPEN`.
- Chrome closed → the server loses the page; restart the server.
- Tab reload → `addInitScript` re-injects the panel; the server stays attached.

TODO for productization:

- a launcher that starts Chrome with the extension and the puzzle URL;
- health checks and reconnect with backoff;
- explicit tab selection when multiple puzzle tabs exist;
- a single `npm run attach` entry point.
