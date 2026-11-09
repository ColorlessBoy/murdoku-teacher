#!/usr/bin/env node
/**
 * Durable (state, action, state') ledger for a live Murdoku puzzle.
 *
 * Why: the chat context gets compacted; the board does not. Every board
 * operation is recorded here so a new turn / a compacted context can resume
 * from the last state instead of re-deriving (and corrupting) the board.
 *
 * Usage:
 *   node scripts/murdoku-ledger.mjs init    [--puzzle <id>]
 *   node scripts/murdoku-ledger.mjs state   [--puzzle <id>]     # last state_after
 *   node scripts/murdoku-ledger.mjs append  [--puzzle <id>] --action '<json>' [--user accept] [--note '...']
 *   node scripts/murdoku-ledger.mjs verify  [--puzzle <id>]     # live vs last state_after
 *   node scripts/murdoku-ledger.mjs rollback [--puzzle <id>] --to <step> [--note '...']
 *
 * The ledger lives at progress/ledger/<puzzle>.jsonl (one JSON per line):
 *   {"type":"header","version":1,"puzzle":...}
 *   {"type":"step","step":1,"ts":...,"state_before":{...},"action":{...},"user":"accept","note":"...","state_after":{...}}
 *
 * Protocol (also documented in the live-logic-puzzle-coach skill):
 *   1. read the ledger `state` (or `verify`) BEFORE doing anything;
 *   2. perform ONE board operation / deduction;
 *   3. `append` with the action + the user feedback;
 *   4. after a context compaction, `verify` and continue from the last state.
 * Reminder: placements auto-X the row/column, and the game's Undo does NOT
 * restore the notes a placement consumed — re-add them manually and record it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readState } from './murdoku-state.mjs';

const ROOT = process.cwd();
const LEDGER_DIR = path.join(ROOT, 'progress', 'ledger');

function parseArgs(argv) {
  const args = { cmd: argv[0], _: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--puzzle') args.puzzle = argv[++i];
    else if (a === '--action') args.action = argv[++i];
    else if (a === '--user') args.user = argv[++i];
    else if (a === '--note') args.note = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--verdict') args.verdict = argv[++i];
    else if (a === '--ledger') args.ledger = argv[++i];
    else if (a === '--force') args.force = true;
    else args._.push(a);
  }
  return args;
}

function ledgerPath(args, puzzle) {
  if (args.ledger) return args.ledger;
  return path.join(LEDGER_DIR, `${puzzle}.jsonl`);
}

function readLedger(file) {
  if (!fs.existsSync(file)) return { header: null, steps: [] };
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let header = null;
  const steps = [];
  for (const ln of lines) {
    let rec;
    try { rec = JSON.parse(ln); } catch { continue; }
    if (rec.type === 'header') header = rec;
    else if (rec.type === 'step') steps.push(rec);
  }
  return { header, steps };
}

function writeHeader(file, puzzle) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ type: 'header', version: 1, puzzle, createdAt: Date.now() }) + '\n');
}

function appendRecord(file, rec) {
  fs.appendFileSync(file, JSON.stringify(rec) + '\n');
}

function lastState(steps, floor) {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].step >= (floor || 0)) return steps[i].state_after;
  }
  return { placed: {}, notes: {}, xMarks: [], notesTotal: 0 };
}

function diffStates(a, b) {
  const d = { placed: {}, notes: {}, xMarks: {} };
  const roles = new Set([...Object.keys(a.placed || {}), ...Object.keys(b.placed || {})]);
  for (const r of roles) if (a.placed?.[r] !== b.placed?.[r]) d.placed[r] = [a.placed?.[r] ?? null, b.placed?.[r] ?? null];
  for (const r of new Set([...Object.keys(a.notes || {}), ...Object.keys(b.notes || {})])) {
    const x = (a.notes?.[r] || []).join(','), y = (b.notes?.[r] || []).join(',');
    if (x !== y) d.notes[r] = [a.notes?.[r] || [], b.notes?.[r] || []];
  }
  const ax = new Set(a.xMarks || []), bx = new Set(b.xMarks || []);
  d.xMarks.added = [...bx].filter((i) => !ax.has(i));
  d.xMarks.removed = [...ax].filter((i) => !bx.has(i));
  return d;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cmd) { console.error('usage: init|state|append|verify|rollback'); process.exit(2); }
  // `state` and `rollback` are pure-file operations: no live board read needed.
  const needsLive = ['init', 'append', 'verify'].includes(args.cmd);
  const live = needsLive ? await readState({ puzzle: args.puzzle }) : null;
  const puzzle = args.puzzle || (live && live.puzzle) || 'unknown';
  const file = ledgerPath(args, puzzle);

  if (args.cmd === 'init') {
    if (fs.existsSync(file)) { console.error('ledger exists: ' + file); process.exit(1); }
    writeHeader(file, puzzle);
    appendRecord(file, { type: 'step', step: 0, ts: Date.now(), state_before: { placed: {}, notes: {}, xMarks: [], notesTotal: 0 }, action: { kind: 'init', reason: 'start' }, user: 'none', note: '', state_after: live });
    console.log('initialized ' + file);
    console.log(JSON.stringify(live, null, 1));
    return;
  }

  const { steps } = readLedger(file);
  const last = lastState(steps);

  if (args.cmd === 'state') {
    console.log(JSON.stringify(last, null, 1));
    return;
  }

  if (args.cmd === 'status') {
    const lastRec = steps[steps.length - 1];
    console.log(JSON.stringify({
      puzzle,
      steps: steps.length,
      lastStep: lastRec ? lastRec.step : 0,
      lastUser: lastRec ? lastRec.user : 'none',
      awaitingUser: !lastRec || lastRec.user === 'none',
      state: lastRec ? lastRec.state_after : { placed: {}, notes: {}, xMarks: [], notesTotal: 0 },
    }, null, 1));
    return;
  }

  if (args.cmd === 'feedback') {
    const verdict = args.verdict;
    if (!['accept', 'reject', 'rollback'].includes(verdict)) { console.error('--verdict accept|reject|rollback required'); process.exit(2); }
    const lastRec = steps[steps.length - 1];
    if (!lastRec) { console.error('empty ledger'); process.exit(1); }
    if (lastRec.user !== 'none') { console.log('last step already has user: ' + lastRec.user); return; }
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const obj = JSON.parse(lines[lines.length - 1]);
    obj.user = verdict;
    if (args.note) obj.note = args.note;
    lines[lines.length - 1] = JSON.stringify(obj);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    console.log(JSON.stringify({ updated: obj.step, user: verdict }, null, 1));
    return;
  }

  if (args.cmd === 'verify') {
    const d = diffStates(last, live);
    const changed = Object.keys(d.placed).length || Object.keys(d.notes).length || d.xMarks.added.length || d.xMarks.removed.length;
    console.log(JSON.stringify({ ok: !changed, ledgerSteps: steps.length, puzzle, diff: d, live }, null, 1));
    return;
  }

  if (args.cmd === 'append') {
    let action;
    try { action = JSON.parse(args.action || '{}'); } catch { console.error('--action must be JSON'); process.exit(2); }
    // ONE-STEP GATE: block a new operation while the previous step awaits the user's verdict.
    const lastRec = steps[steps.length - 1];
    const gateExempt = ['rollback', 'resync', 'init'].includes(action.kind) || args.force;
    if (lastRec && lastRec.user === 'none' && !gateExempt) {
      console.error('WAIT: step ' + lastRec.step + ' is awaiting the user verdict (user:"none").');
      console.error('Ask the user (能理解吗？接受吗？), then run: node scripts/murdoku-ledger.mjs feedback --puzzle ' + puzzle + ' --verdict accept|reject');
      process.exit(3);
    }
    const step = (steps.length ? steps[steps.length - 1].step : 0) + 1;
    const rec = { type: 'step', step, ts: Date.now(), state_before: last, action, user: args.user || 'none', note: args.note || '', state_after: live };
    appendRecord(file, rec);
    console.log(JSON.stringify({ appended: step, diff: diffStates(last, live), state_after: live }, null, 1));
    return;
  }

  if (args.cmd === 'rollback') {
    const to = parseInt(args.to, 10);
    const target = steps.find((s) => s.step === to);
    if (!target) { console.error('no such step: ' + args.to); process.exit(1); }
    const step = (steps.length ? steps[steps.length - 1].step : 0) + 1;
    const rec = { type: 'step', step, ts: Date.now(), state_before: last, action: { kind: 'rollback', to, reason: args.note || ('rollback to step ' + to) }, user: 'rollback', note: args.note || '', state_after: target.state_before };
    appendRecord(file, rec);
    console.log('rollback recorded; restore the board to step ' + to + ' state_before:');
    console.log(JSON.stringify(target.state_before, null, 1));
    return;
  }

  console.error('unknown cmd: ' + args.cmd);
  process.exit(2);
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
