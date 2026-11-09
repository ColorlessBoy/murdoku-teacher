import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_SRC = path.resolve(HERE, '..');
const lesson = JSON.parse(fs.readFileSync(path.join(EXT_SRC, 'lessons', 'puzzle-minigolf-hard.json'), 'utf8'));
const SOLUTION = lesson.solution;
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || '/Users/penglingwei/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs');

const PORT = Number(process.env.E2E_PORT || 18083);
let calls = 0, tutorTurns = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); res.end(); return; }
  let body = '';
  req.on('data', (c) => body += c);
  req.on('end', () => {
    calls++;
    let payload = {}; try { payload = JSON.parse(body); } catch {}
    const msgs = payload.messages || [];
    const sys = String(msgs[0]?.content || '');
    const isExam = /考试/.test(sys);
    let text = '', tool = null;
    if (isExam) {
      text = '结论：VALID\n完整解 10 个落点与线索一致。';
    } else {
      const move = SOLUTION[Math.min(tutorTurns, SOLUTION.length - 1)];
      tutorTurns++;
      tool = { id: `call_full_${tutorTurns}`, type: 'function', function: { name: 'board_place', arguments: JSON.stringify(move) } };
      text = `第 ${tutorTurns} 步：${move.who} 放到 R${move.r}C${move.c}。请审查；接受后我走下一步。`;
    }
    const data = {
      id: 'mock', object: 'chat.completion', model: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content: text, ...(tool ? { tool_calls: [tool] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }],
      usage: {},
    };
    console.log('mock', calls, 'exam', isExam, 'tutorTurn', tutorTurns, 'tool', !!tool);
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(data));
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const dst = process.env.E2E_EXT_DIR || '/tmp/mm-full-ext';
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(EXT_SRC, dst, { recursive: true, filter: (s) => !s.includes('/.git') && !s.includes('/docs') && !s.includes('/scripts') });
const mf = JSON.parse(fs.readFileSync(`${dst}/manifest.json`, 'utf8'));
mf.host_permissions = [...(mf.host_permissions || []), 'http://127.0.0.1/*'];
fs.writeFileSync(`${dst}/manifest.json`, JSON.stringify(mf, null, 2));
let bg = fs.readFileSync(`${dst}/background.js`, 'utf8');
bg = `chrome.storage.local.set({ mm_settings: { apiKey: "test", baseUrl: "http://127.0.0.1:${PORT}/v1", model: "mock", maxTokens: 2048 }, mm_mode: "tutor", mm_enabled: true, mm_core_ledger_write: true });\n` + bg;
fs.writeFileSync(`${dst}/background.js`, bg);

const exe = process.env.CHROME_PATH || '/Users/penglingwei/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const profile = process.env.E2E_PROFILE || '/tmp/mm-full-profile';
async function launch(profilePath) {
  fs.rmSync(profilePath, { recursive: true, force: true });
  return chromium.launchPersistentContext(profilePath, {
    executablePath: exe, headless: process.env.E2E_HEADED === '1' ? false : true, acceptDownloads: true,
    args: [`--disable-extensions-except=${dst}`, `--load-extension=${dst}`, '--no-first-run', '--no-default-browser-check'],
  });
}
let ctx = await launch(profile);
let page = await ctx.newPage();
let cells = 0;
for (let i = 0; i < 5 && !cells; i++) {
  try { await page.goto('https://murdoku.com/play/puzzle-minigolf-hard', { waitUntil: 'commit', timeout: 25000 }); } catch (e) { console.log('goto retry', i, e.message.split('\n')[0]); }
  await page.waitForTimeout(5000);
  cells = await page.evaluate(() => document.querySelectorAll('[data-cell-index]').length).catch(() => 0);
  console.log('cells', i, cells);
}
await page.waitForTimeout(3000);
await dismissOverlays();
await page.waitForTimeout(3000);

const snap = async () => page.evaluate(() => {
  const cells = [...document.querySelectorAll('[data-cell-index]')];
  const seen = new Map();
  for (const el of cells) { const i = +el.dataset.cellIndex; if (!seen.has(i) && el.offsetWidth) seen.set(i, el); }
  const filled = [];
  for (const [i, el] of seen) {
    const t = el.innerText.trim();
    const imgs = [...el.querySelectorAll('img')].map((im) => im.getAttribute('alt') || im.getAttribute('title') || '').filter(Boolean);
    if (t.length === 1 && /[A-Z]/.test(t)) filled.push({ i, t });
    else if (imgs.length) filled.push({ i, imgs });
  }
  return {
    ver: document.querySelector('#mm-ver')?.textContent || null,
    display: document.getElementById('mm-sidebar') ? getComputedStyle(document.getElementById('mm-sidebar')).display : null,
    mode: [...document.querySelectorAll('#mm-sidebar .mm-tab.on')].map((x) => x.textContent),
    msgs: [...document.querySelectorAll('#mm-sidebar .mm-msg.me:not(.system) .mm-text')].map((x) => x.textContent.slice(0, 160)),
    filled,
    body: document.body.innerText.slice(0, 1500),
  };
});

let ta = page.locator('#mm-sidebar .mm-composer textarea');
async function dismissOverlays() {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    for (const sel of ['.mrd-modal-backdrop', '.mrd-modal', '.mrd-solved-overlay', '.mrd-solved-whomp', '[role="dialog"]', '[class*="modal-backdrop"]', '[class*="solved-overlay"]']) {
      document.querySelectorAll(sel).forEach((x) => x.remove());
    }
  });
  await page.waitForTimeout(300);
}
const submit = async () => {
  const b = page.locator('button[title="Submit"], button:has-text("SUBMIT")').first();
  if (await b.count()) { try { await b.click({ timeout: 4000 }); } catch (e) { console.log('submit click failed', e.message.split('\n')[0]); } await page.waitForTimeout(3000); }
};
const placeOnBoard = async (name, r, c) => {
  await dismissOverlays();
  await page.locator(`button[title="${name}"]`).first().click({ timeout: 8000 });
  const idx = (r - 1) * 10 + (c - 1);
  const cell = page.locator(`[data-cell-index="${idx}"]`).last();
  const box = await cell.boundingBox();
  if (!box) throw new Error('no cell box ' + idx);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.waitForTimeout(500);
};
const send = async (text) => { await ta.fill(text); await ta.press('Enter'); };
const waitMe = async (n, timeout = 20000) => page.waitForFunction((want) => document.querySelectorAll('#mm-sidebar .mm-msg.me:not(.system)').length >= want, n, { timeout });

console.log('pre', JSON.stringify(await snap()));
await send('开始教学，第一步。');
await waitMe(1);
for (let i = 1; i < SOLUTION.length; i++) {
  await send('接受，继续下一步。');
  await waitMe(i + 1);
  console.log('turn', i + 1, 'me', (await snap()).msgs.length);
}
await submit();
await page.waitForTimeout(6000);
const post = await page.evaluate(() => ({
  title: document.title,
  modals: [...document.querySelectorAll('[class*=modal], [class*=result], [class*=win], [class*=solved], [role=dialog]')].map((x) => ({ cls: String(x.className).slice(0, 80), text: (x.innerText || '').slice(0, 300) })).slice(0, 10),
  bodyTail: document.body.innerText.slice(-1200),
  solvedCls: [...document.querySelectorAll('[class*=solved], [class*=win], [class*=result]')].map((x) => String(x.className)).slice(0, 10),
  storage: Object.fromEntries(Object.keys(localStorage).slice(0, 10).map((k) => [k, String(localStorage.getItem(k)).slice(0, 100)])),
  react: (() => { const el=[...document.querySelectorAll('[data-cell-index]')].filter(x=>x.offsetWidth).pop(); const fk=Object.keys(el).find(k=>k.startsWith('__reactFiber$')); let f=el[fk]; for(let d=0;f&&d<10;d++,f=f.return){const p=f.memoizedProps||{}; if('placed' in p) return {placed:p.placed, notes:p.notes, reveal:p.revealResultById, solved:p.solved};} return null; })(),
}));
console.log('post', JSON.stringify(post));
await page.screenshot({ path: '/tmp/mm-full-tutor.png' }).catch(() => {});
const tutor = await snap();
const cellDump = await page.evaluate((sol) => Object.fromEntries(sol.map((m) => {
  const idx = (m.r - 1) * 10 + (m.c - 1);
  const el = [...document.querySelectorAll(`[data-cell-index="${idx}"]`)].filter((x) => x.offsetWidth).pop();
  return [idx, el ? { text: el.innerText.trim().slice(0, 40), cls: String(el.className).slice(0, 80), imgs: [...el.querySelectorAll('img')].map((im) => im.getAttribute('alt') || im.getAttribute('title') || (im.getAttribute('src') || '').split('/').pop()) } : null];
})), SOLUTION);
console.log('solutionCells', JSON.stringify(cellDump));
console.log('changes', await page.evaluate(() => ({ n: document.querySelector('#mm-sidebar .mm-changes-n')?.textContent, body: document.querySelector('#mm-sidebar .mm-changes-body')?.innerText.slice(0, 800) })));
console.log('submit', await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /submit/i.test(x.title || x.innerText)); return b ? { text: b.innerText.slice(0, 60), disabled: b.disabled, title: b.title } : null; }));
console.log('tutor filled', tutor.filled.length, 'msgs', tutor.msgs.length);
console.log('tutor body tail', tutor.body.replace(/\n+/g, ' ').slice(-700));
assert.equal(tutor.msgs.length, SOLUTION.length, 'tutor 10 replies');
assert.ok(/CASE\s*SOLVED|You've found the murderer|You solved/i.test(tutor.body), 'tutor game solved');

// exam: clear, switch exam, student places full solution
// fresh browser profile for exam; a solved board cannot be reused
await ctx.close();
ctx = await launch(profile + '-exam');
page = await ctx.newPage();
for (let i = 0; i < 5; i++) {
  try { await page.goto('https://murdoku.com/play/puzzle-minigolf-hard', { waitUntil: 'commit', timeout: 25000 }); } catch (e) {}
  await page.waitForTimeout(4000);
  if (await page.evaluate(() => document.querySelectorAll('[data-cell-index]').length)) break;
}
await dismissOverlays();
await page.waitForFunction(() => { const sb = document.getElementById('mm-sidebar'); return !!sb && getComputedStyle(sb).display !== 'none'; }, null, { timeout: 12000 });
ta = page.locator('#mm-sidebar .mm-composer textarea');
await page.locator('#mm-sidebar .mm-tab').nth(1).click();
await page.waitForTimeout(1000);
for (const m of SOLUTION) {
  const name = { A: 'Albert', B: 'Burma', C: 'Craig', D: 'Duncan', E: 'Elyana', F: 'Faith', G: 'Ginny', H: 'Hugo', I: 'Idril', V: 'Valeria' }[m.who];
  await placeOnBoard(name, m.r, m.c);
}
await submit();
await page.screenshot({ path: '/tmp/mm-full-exam.png' }).catch(() => {});
await page.waitForTimeout(2000);
await send('我的结论：完整解已经放好。');
await page.waitForTimeout(8000);
const exam = await snap();
console.log('exam filled', exam.filled.length, 'msgs', exam.msgs.length);
console.log('exam last', exam.msgs.slice(-3));
console.log('exam body', exam.body.replace(/\n+/g, ' ').slice(0, 400));
assert.ok(exam.msgs.some((m) => /VALID/.test(m)), 'exam VALID');
assert.ok(/CASE\s*SOLVED|You've found the murderer|You solved/i.test(exam.body), 'exam game solved');

await ctx.close();
server.close();
console.log('FULL E2E OK', JSON.stringify({ calls, tutorMsgs: tutor.msgs.length, examMsgs: exam.msgs.length, filled: tutor.filled.length }));
