# Murdoku Companion

An AI companion for live logic puzzles (Murdoku / murder-mystery Sudoku):

- **Tutor mode** — walks the deduction step by step, with visible notation and a chat sidebar.
- **Examiner mode** — audits the player's own reasoning, challenges gaps, and never reveals the answer.

## What's inside

- `.agents/skills/live-logic-puzzle-coach/` — tutor workflow, the chat sidebar server, and the attach helper.
- `.agents/skills/murdoku-exam-coach/` — examiner protocol: claim capture, four-dimension audit, verdicts, hint ladder.
- `docs/murdoku-companion-modes.md` — product reflection: tutor vs examiner, the shared substrate, roadmap.

## Architecture

- **Interaction layer (main agent)**: owns the sidebar server, chat panel, board reading, action execution, and persistence.
- **Logic layer (subagent)**: receives a clean brief (rules, rooms, objects, placements, X, notes), returns one forced deduction at a time, and has no UI/execution context.
- **Message loop**: board snapshot → deduction card → challenge → revision; sync after every placement, rejection, or stall.

## Quick start

Dependencies:

- **Playwriter Chrome extension** — CDP bridge at `http://127.0.0.1:19988`. This is the browser bridge, not the Python `playwright` package.
- **Node `playwright-core`** — used only as a CDP client.

```bash
export PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs
export MURDOKU_URL_MATCH=wine-cellar
export CDP_URL=http://127.0.0.1:19988

node .agents/skills/live-logic-puzzle-coach/assets/attach.mjs
node .agents/skills/live-logic-puzzle-coach/assets/sidebar-server.mjs
```

## Status

- Launch/attach is manual today: open the puzzle tab, then attach. Auto-launch, health checks, and reconnect are a known gap.
- No game assets or puzzle solution files are included. The case study in the tutor skill is a writeup of a solved puzzle.

## License

TBD.
