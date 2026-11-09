import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_SRC = path.resolve(HERE, '..');
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv(path.join(EXT_SRC, '.env.precommit'));
loadEnv(path.join(EXT_SRC, '.env.model'));
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const teacher = {
  base: (process.env.MODEL_BASE_URL || '').replace(/\/+$/, ''),
  key: process.env.MODEL_API_KEY || '',
  model: process.env.MODEL_NAME || '',
};
const student = {
  base: (process.env.STUDENT_MODEL_BASE_URL || teacher.base).replace(/\/+$/, ''),
  key: process.env.STUDENT_MODEL_API_KEY || teacher.key,
  model: process.env.STUDENT_MODEL_NAME || teacher.model,
};
if (!teacher.base || !teacher.key || !teacher.model || !student.base || !student.key || !student.model) {
  console.error('[real-model-e2e] missing MODEL_BASE_URL / MODEL_API_KEY / MODEL_NAME in extension/.env.model');
  console.error('  copy .env.model.example to .env.model and fill a real OpenAI-compatible endpoint.');
  console.error('  no mock fallback by design.');
  process.exit(2);
}

async function chat(cfg, messages, { temperature = 0.2, maxTokens = 2000, timeoutMs = 240000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature, max_tokens: maxTokens }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`student model network: ${e.message}`);
  }
  clearTimeout(timer);
  const raw = await res.text();
  if (!res.ok) throw new Error(`student model HTTP ${res.status}: ${raw.slice(0, 500)}`);
  let data; try { data = JSON.parse(raw); } catch { throw new Error('student model bad JSON'); }
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('student model empty text');
  return text;
}

function parseJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1] : String(text);
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

const NAMES = { A: 'Albert', B: 'Burma', C: 'Craig', D: 'Duncan', E: 'Elyana', F: 'Faith', G: 'Ginny', H: 'Hugo', I: 'Idril', V: 'Valeria' };
const dst = process.env.E2E_EXT_DIR || '/tmp/mm-real-ext';
const exe = process.env.CHROME_PATH || (() => { try { return chromium.executablePath(); } catch { return undefined; } })();
const profileRoot = process.env.E2E_PROFILE || '/tmp/mm-real-profile';

async function launch(profilePath) {
  fs.rmSync(profilePath, { recursive: true, force: true });
  return chromium.launchPersistentContext(profilePath, {
    executablePath: exe, headless: process.env.E2E_HEADED === '1' ? false : true, acceptDownloads: true,
    args: [`--disable-extensions-except=${dst}`, `--load-extension=${dst}`, '--no-first-run', '--no-default-browser-check'],
  });
}

async function openGame(ctx) {
  const page = await ctx.newPage();
  let cells = 0;
  for (let i = 0; i < 5 && !cells; i++) {
    try { await page.goto('https://murdoku.com/play/puzzle-minigolf-hard', { waitUntil: 'commit', timeout: 25000 }); } catch (e) {}
    await page.waitForTimeout(4500);
    cells = await page.evaluate(() => document.querySelectorAll('[data-cell-index]').length).catch(() => 0);
  }
  await page.waitForTimeout(2500);
  await dismissOverlays(page);
  await page.waitForFunction(() => { const sb = document.getElementById('mm-sidebar'); return !!sb && getComputedStyle(sb).display !== 'none'; }, null, { timeout: 15000 });
  return page;
}

async function dismissOverlays(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    for (const sel of ['.mrd-modal-backdrop', '.mrd-modal', '.mrd-solved-overlay', '.mrd-solved-whomp', '[role="dialog"]', '[class*="modal-backdrop"]']) {
      document.querySelectorAll(sel).forEach((x) => x.remove());
    }
  });
  await page.waitForTimeout(300);
}

async function send(page, text) {
  const ta = page.locator('#mm-sidebar .mm-composer textarea');
  await ta.fill(text);
  await ta.press('Enter');
}

async function teacherCount(page) {
  return page.locator('#mm-sidebar .mm-msg.me:not(.system)').count();
}

async function waitTeacher(page, prev, timeout = 240000) {
  await page.waitForFunction((n) => document.querySelectorAll('#mm-sidebar .mm-msg.me:not(.system)').length > n, prev, { timeout });
  const text = await page.locator('#mm-sidebar .mm-msg.me:not(.system) .mm-text').last().innerText();
  const count = await teacherCount(page);
  return { text, count };
}

async function gameState(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-cell-index]')];
    const seen = new Map();
    for (const el of cells) { const i = +el.dataset.cellIndex; if (!seen.has(i) && el.offsetWidth) seen.set(i, el); }
    const marks = [];
    for (const [i, el] of seen) {
      const t = el.innerText.trim();
      const notes = [...el.querySelectorAll('.grid-note-letter')].map((x) => x.textContent.trim()).filter(Boolean);
      if (t.length === 1 && /[A-Z]/.test(t)) marks.push({ i, big: t });
      else if (notes.length) marks.push({ i, notes: notes.join('') });
    }
    return {
      solved: !!document.querySelector('.mrd-solved-overlay') || /CASE\s*SOLVED/i.test(document.body.innerText),
      body: document.body.innerText.slice(0, 6000),
      marks: marks.slice(0, 100),
      submit: (() => { const b = [...document.querySelectorAll('button')].find((x) => /submit/i.test(x.title || x.innerText)); return b ? { disabled: b.disabled, text: b.innerText.slice(0, 40) } : null; })(),
    };
  });
}

async function submit(page) {
  const b = page.locator('button[title="Submit"], button:has-text("SUBMIT")').first();
  if (!(await b.count())) return;
  try { await b.click({ timeout: 5000 }); } catch (e) {}
  await page.waitForTimeout(5000);
}

function solvedText(text) {
  return /CASE\s*SOLVED|You've found the murderer|You solved/i.test(text);
}

// ---- build temp extension with real teacher settings ----
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(EXT_SRC, dst, { recursive: true, filter: (p) => !p.includes('/.git') && !p.includes('/docs') && !p.includes('/scripts') && !p.includes('/test') });
const mf = JSON.parse(fs.readFileSync(`${dst}/manifest.json`, 'utf8'));
try { const u = new URL(teacher.base); mf.host_permissions = [...(mf.host_permissions || []), `${u.origin}/*`]; } catch (e) { console.error('[real-model-e2e] bad MODEL_BASE_URL'); process.exit(2); }
fs.writeFileSync(`${dst}/manifest.json`, JSON.stringify(mf, null, 2));
let bg = fs.readFileSync(`${dst}/background.js`, 'utf8');
bg = `chrome.storage.local.set({ mm_settings: { apiKey: ${JSON.stringify(teacher.key)}, baseUrl: ${JSON.stringify(teacher.base)}, model: ${JSON.stringify(teacher.model)}, maxTokens: 1200 }, mm_mode: "tutor", mm_enabled: true });\n` + bg;
fs.writeFileSync(`${dst}/background.js`, bg);

let ctx = await launch(profileRoot);
let page = await openGame(ctx);
let state = await gameState(page);
const tutorLog = [];

console.log('[real-model-e2e] teacher', teacher.model, '@', teacher.base, '; student', student.model);
await send(page, '开始教学，第一步。');
let count = 0;
for (let step = 0; step < 18; step++) {
  const t = await waitTeacher(page, count);
  count = t.count;
  state = await gameState(page);
  tutorLog.push({ role: 'teacher', text: t.text });
  console.log('[teacher]', t.text.replace(/\s+/g, ' ').slice(0, 240));
  if (state.solved) break;
  const s = await chat(student, [
    { role: 'system', content: '你是 Murdoku 教学里的学生。老师墨墨刚讲了一步并操作了盘面。你的任务是审查这一步，不是抢答，也不要说最终凶手。若逻辑成立且你理解了，只回复“接受，继续下一步。”；若有具体问题，只问一个针对这一步的问题。不要落子，不要给其他角色的位置。中文，1-2 句。' },
    { role: 'user', content: `老师刚才说：\n${t.text}\n\n盘面/线索（只读）：\n${state.body.slice(0, 5000)}\n\n当前标记：${JSON.stringify(state.marks.slice(0, 30))}\n\n请审查并回复。` },
  ], { maxTokens: 400 });
  const reply = s.trim().slice(0, 500);
  tutorLog.push({ role: 'student', text: reply });
  console.log('[student]', reply.replace(/\s+/g, ' ').slice(0, 240));
  await send(page, reply);
}
state = await gameState(page);
assert.ok(state.solved, 'tutor: real teacher/student interaction must solve the game');
console.log('[real-model-e2e] TUTOR SOLVED', JSON.stringify({ teacherMsgs: count, log: tutorLog.length }));

// ---- exam: fresh profile, real student solves, real teacher audits ----
await ctx.close();
ctx = await launch(profileRoot + '-exam');
page = await openGame(ctx);
await page.locator('#mm-sidebar .mm-tab').nth(1).click();
await page.waitForTimeout(1000);
state = await gameState(page);
const baseClues = state.body.slice(0, 7000);
const studentPrompt = `你是一名独立解 Murdoku 困难题的学生。不要向老师要答案，不要提最终凶手。\n线索与盘面：\n${baseClues}\n\n请给出完整落子方案，JSON：{"actions":[{"who":"A","r":1,"c":1}, ...]}，who 用 A/B/C/D/E/F/G/H/I/V，10 个角色都要有。只输出 JSON。`;
const planRaw = await chat(student, [{ role: 'user', content: studentPrompt }], { maxTokens: 3000, temperature: 0.1 });
const plan = parseJson(planRaw);
if (!plan?.actions?.length) throw new Error('exam: student did not return a JSON plan: ' + planRaw.slice(0, 500));

async function place(m) {
  const name = NAMES[m.who];
  if (!name) throw new Error('bad who ' + m.who);
  await dismissOverlays(page);
  await page.locator(`button[title="${name}"]`).first().click({ timeout: 8000 });
  const idx = (Number(m.r) - 1) * 10 + (Number(m.c) - 1);
  const cell = page.locator(`[data-cell-index="${idx}"]`).last();
  const box = await cell.boundingBox();
  if (!box) throw new Error('bad cell ' + m.r + ',' + m.c);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

for (const m of plan.actions) await place(m);
await submit(page);
await page.waitForTimeout(4000);
await send(page, '我的结论：完整解已经放好。');
await page.waitForTimeout(15000);
state = await gameState(page);
const examMsgs = await page.locator('#mm-sidebar .mm-msg.me:not(.system) .mm-text').allInnerTexts();
console.log('[real-model-e2e] EXAM', JSON.stringify({ solved: state.solved, actions: plan.actions.length, msgs: examMsgs.slice(-4) }));
assert.ok(state.solved, 'exam: real student plan must solve the game');
assert.ok(examMsgs.some((m) => /VALID/i.test(m)), 'exam: real teacher must audit VALID');

await ctx.close();
console.log('[real-model-e2e] OK', JSON.stringify({ teacher: teacher.model, student: student.model, tutorMsgs: count, tutorLog: tutorLog.length, examActions: plan.actions.length }));
