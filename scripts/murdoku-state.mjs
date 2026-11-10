#!/usr/bin/env node
/**
 * Durable board-state snapshot for Murdoku (CDP).
 *
 * Usage:
 *   node scripts/murdoku-state.mjs                 # print state JSON
 *   node scripts/murdoku-state.mjs --puzzle <id>   # force puzzle id
 *   node scripts/murdoku-state.mjs --out <file>    # also write state JSON to file
 *
 * Output (canonical):
 *   { puzzle, placed: {G: 1, ...}, notes: {A: [..], ...}, xMarks: [..], notesTotal }
 *
 * The game's own localStorage progress (mrd_progress_<id>) is the source of
 * truth for placements/X marks; the visible DOM is used for notes (deduped,
 * visible layer only). Roles are the suspect letters in display order.
 */

import fs from 'node:fs';
import path from 'node:path';

const CDP = process.env.MURDOKU_CDP || 'http://127.0.0.1:19988';
const STATE_DIR = process.env.MURDOKU_STATE_DIR || path.join(process.cwd(), 'progress', 'state');
const ROLE_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'V'];

async function loadChromium() {
  const candidates = [
    process.env.PW_CORE,
    'playwright-core',
    '/Users/penglingwei/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const m = await import(c);
      if (m.chromium) return m.chromium;
    } catch { /* try next */ }
  }
  throw new Error('playwright-core not found; set PW_CORE=/path/to/playwright-core/index.mjs');
}

async function getPage() {
  const chromium = await loadChromium();
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages().find((p) => p.url().includes('murdoku.com/play'));
  if (!page) throw new Error('no murdoku play page on CDP ' + CDP);
  return page;
}

function puzzleIdFromUrl(url, forced) {
  if (forced) return forced;
  const m = url.match(/\/play\/([^/?#]+)/);
  return m ? m[1] : 'unknown';
}

/** 读插件导出的 canonical state（dsh-webpane 的 ledger-state 动作写入）。 */
function readPluginStateFile(opts) {
  try {
    if (!fs.existsSync(STATE_DIR)) return null;
    const files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return null;
    const target = opts.puzzle
      ? path.join(STATE_DIR, `${opts.puzzle}.json`)
      : files.length === 1 ? path.join(STATE_DIR, files[0]) : null;
    if (!target || !fs.existsSync(target)) return null;
    const d = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!d || typeof d !== 'object' || !d.placed) return null;
    const out = { puzzle: d.puzzle, placed: {}, notes: {}, xMarks: Array.isArray(d.xMarks) ? d.xMarks.slice().sort((a, b) => a - b) : [], notesTotal: 0, source: 'plugin' };
    for (const r of ROLE_ORDER) {
      if (d.placed[r] !== undefined) out.placed[r] = d.placed[r];
      const ns = Array.isArray(d.notes && d.notes[r]) ? d.notes[r].slice().sort((a, b) => a - b) : [];
      out.notes[r] = ns;
      out.notesTotal += ns.length;
    }
    if (typeof d.notesTotal === 'number') out.notesTotal = d.notesTotal;
    return out;
  } catch {
    return null;
  }
}

export async function readState(opts = {}) {
  // 插件模式下 CDP 不可用：优先读 dsh-webpane 导出的状态文件
  const mode = process.env.MURDOKU_STATE_SOURCE;
  if (mode !== 'cdp') {
    const fromFile = readPluginStateFile(opts);
    if (fromFile && (mode === 'plugin' || process.env.MURDOKU_STATE_PREFER === 'file')) return fromFile;
    if (fromFile) {
      try {
        return await readStateCdp(opts);
      } catch {
        return fromFile;
      }
    }
  }
  return readStateCdp(opts);
}

async function readStateCdp(opts = {}) {
  const page = await getPage();
  const raw = await page.evaluate(() => {
    const progress = {};
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('mrd_progress_')) continue;
      try { progress[k.slice('mrd_progress_'.length)] = JSON.parse(localStorage.getItem(k)); } catch { /* skip */ }
    }
    // visible-layer notes (deduped)
    const notes = {};
    for (const el of document.querySelectorAll('[data-cell-index]')) {
      if (!el.offsetWidth) continue;
      const i = +el.dataset.cellIndex;
      const letters = [...new Set([...el.querySelectorAll('.grid-note-letter')].map((x) => (x.textContent || '').trim()).filter(Boolean))];
      if (letters.length) notes[i] = letters;
    }
    return { url: location.href, progress, domNotes: notes };
  });
  const puzzle = puzzleIdFromUrl(raw.url, opts.puzzle);
  const prog = raw.progress[puzzle] || {};
  const placed = {};
  const charRole = (c) => {
    // char_N follows the suspects' display order: A,B,C,D,E,F,G,H,I,V
    const n = parseInt(String(c).replace('char_', ''), 10);
    return ROLE_ORDER[n] || String(c);
  };
  (prog.placed || []).forEach((c, i) => { if (c) placed[charRole(c)] = i; });
  const xMarks = [];
  (prog.xMarks || []).forEach((v, i) => { if (v) xMarks.push(i); });
  // notes: prefer localStorage notes when they are letters; otherwise DOM
  const notes = {};
  const progNotes = prog.notes || [];
  const progHasLetters = progNotes.some((ns) => Array.isArray(ns) && ns.length && typeof ns[0] === 'string' && ns[0].length <= 2);
  if (progHasLetters) {
    progNotes.forEach((ns, i) => {
      if (!Array.isArray(ns) || !ns.length) return;
      for (const n of ns) {
        const role = String(n).startsWith('char_') ? charRole(n) : String(n);
        (notes[role] = notes[role] || []).push(i);
      }
    });
  } else {
    for (const [i, letters] of Object.entries(raw.domNotes)) {
      for (const l of letters) (notes[l] = notes[l] || []).push(+i);
    }
  }
  const out = { puzzle, placed: {}, notes: {}, xMarks: xMarks.sort((a, b) => a - b), notesTotal: 0 };
  for (const r of ROLE_ORDER) {
    if (placed[r] !== undefined) out.placed[r] = placed[r];
    const ns = (notes[r] || []).sort((a, b) => a - b);
    out.notes[r] = ns;
    out.notesTotal += ns.length;
  }
  if (opts.out) {
    const fs = await import('node:fs');
    fs.writeFileSync(opts.out, JSON.stringify(out, null, 1));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--puzzle') opts.puzzle = args[++i];
    if (args[i] === '--out') opts.out = args[++i];
  }
  readState(opts).then((s) => { console.log(JSON.stringify(s, null, 1)); process.exit(0); })
    .catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
}
