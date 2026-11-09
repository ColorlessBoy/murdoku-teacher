import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_SRC = path.resolve(HERE, '..');
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || '/Users/penglingwei/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs');

const lesson = JSON.parse(fs.readFileSync(path.join(EXT_SRC, 'lessons/puzzle-minigolf-hard.json'), 'utf8'));
const solution = lesson.solution;
assert.equal(solution.length, 10, 'lesson solution has 10 placements');

const PORT = 18082;
let calls = 0, turns = 0;
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
    const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
    const lastTool = msgs.map((m) => m.role).lastIndexOf('tool');
    const newTurn = lastUser > lastTool;
    const lastUserText = String(msgs[lastUser]?.content || '');
    const isChallenge = !isExam && /质疑|为什么|解释/.test(lastUserText);
    let text = '';
    let tool = null;
    if (!isExam && !isChallenge && newTurn && turns < solution.length) {
      turns++;
      const s = solution[turns - 1];
      tool = { id: `call_full_${turns}`, type: 'function', function: { name: 'board_place', arguments: JSON.stringify({ r: s.r, c: s.c, who: s.who }) } };
      text = `第 ${turns} 步：${s.who} 落在 R${s.r}C${s.c}。请审查；接受后我走下一步。`;
    } else if (isChallenge) {
      text = '这是候选/已定位置；依据写在盘面上，先按线索保留。请审查；接受后我走下一步。';
    } else {
      text = '已按方案落位，等待接受。';
    }
    const data = {
      id: 'mock-full', object: 'chat.completion', model: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content: text, ...(tool ? { tool_calls: [tool] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }],
      usage: {},
    };
    console.log('mock', calls, 'exam', isExam, 'newTurn', newTurn, 'turn', turns, 'tool', !!tool);
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(data));
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const src = EXT_SRC;
const dst = process.env.E2E_EXT_DIR || '/tmp/mm-e2e-full-ext';
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (s) => !s.includes('/.git') && !s.includes('/docs') && !s.includes('/scripts') });
const mf = JSON.parse(fs.readFileSync(`${dst}/manifest.json`, 'utf8'));
mf.host_permissions = [...(mf.host_permissions || []), 'http://127.0.0.1/*'];
fs.writeFileSync(`${dst}/manifest.json`, JSON.stringify(mf, null, 2));
let bg = fs.readFileSync(`${dst}/background.js`, 'utf8');
bg = `chrome.storage.local.set({ mm_settings: { apiKey: "test", baseUrl: "http://127.0.0.1:${PORT}/v1", model: "mock", maxTokens: 2048 }, mm_mode: "tutor", mm_enabled: true });\n` + bg;
fs.writeFileSync(`${dst}/background.js`, bg);

const exe = process.env.CHROME_PATH || '/Users/penglingwei/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const profile = process.env.E2E_PROFILE || '/tmp/mm-e2e-full-profile';
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: exe, headless: false, acceptDownloads: true,
  args: [`--disable-extensions-except=${dst}`, `--load-extension=${dst}`, '--no-first-run', '--no-default-browser-check'],
});
const page = await ctx.newPage();
const cells = async () => page.evaluate(() => { const m = new Map(); for (const el of document.querySelectorAll('[data-cell-index]')) { const i = +el.dataset.cellIndex; if (!m.has(i) && el.offsetWidth) m.set(i, el); } return m.size; });
for (let i = 0; i < 5 && !(await cells()); i++) {
  try { await page.goto('https://murdoku.com/play/puzzle-minigolf-hard', { waitUntil: 'commit', timeout: 25000 }); } catch (e) { console.log('goto retry', i, e.message.split('\n')[0]); }
  await page.waitForTimeout(5000);
  console.log('cells', i, await cells());
}
await page.waitForTimeout(9000);

// Dismiss the first-visit "Welcome, detective" tutorial so the real SUBMIT button is clickable.
const skip = page.getByText(/^Skip$|^跳过$/i).first();
if (await skip.count()) {
  await skip.click({ timeout: 5000 }).catch((e) => console.log('skip failed', e.message.split('\n')[0]));
  await page.waitForTimeout(800);
}

const snapshot = async () => page.evaluate(() => {
  const byIdx = new Map();
  for (const el of document.querySelectorAll('[data-cell-index]')) { const i = +el.dataset.cellIndex; if (!byIdx.has(i) && el.offsetWidth) byIdx.set(i, el); }
  const placed = [...byIdx.values()].filter((el) => { const t = el.innerText.trim(); return t.length === 1 && /[A-Z]/.test(t) && !el.querySelector('.grid-note-letter'); }).map((el) => el.innerText.trim());
  return {
    placed,
    notes: [...document.querySelectorAll('.grid-note-letter')].length,
    msgs: [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].map((x) => x.textContent.slice(0, 200)),
    ver: document.querySelector('#mm-ver')?.textContent || null,
    display: document.getElementById('mm-sidebar') ? getComputedStyle(document.getElementById('mm-sidebar')).display : null,
  };
});
const pre = await snapshot();
console.log('pre', JSON.stringify({ placed: pre.placed.length, msgs: pre.msgs.length, ver: pre.ver, display: pre.display }));
assert.equal(pre.display, 'flex');
assert.equal(await cells(), 100);
const expectVer = 'v' + JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')).version;
assert.equal(pre.ver, expectVer, 'extension version badge');

const ta = page.locator('#mm-sidebar .mm-composer textarea');
if (!pre.msgs.length) { await ta.fill('开始教学，第一步。'); await ta.press('Enter'); }

for (let step = 0; step < solution.length; step++) {
  await page.waitForFunction((n) => {
    const byIdx = new Map();
    for (const el of document.querySelectorAll('[data-cell-index]')) { const i = +el.dataset.cellIndex; if (!byIdx.has(i) && el.offsetWidth) byIdx.set(i, el); }
    const placed = [...byIdx.values()].filter((el) => { const t = el.innerText.trim(); return t.length === 1 && /[A-Z]/.test(t) && !el.querySelector('.grid-note-letter'); }).length;
    return placed >= n;
  }, step + 1, { timeout: 30000 });
  await page.waitForFunction((n) => [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].filter((x) => x.textContent.includes('请审查')).length >= n, step + 1, { timeout: 30000 });
  const s = await snapshot();
  console.log(`step ${step + 1}`, JSON.stringify({ placed: s.placed, expect: solution[step] }));
  if (step < solution.length - 1) { await ta.fill('接受，继续下一步。'); await ta.press('Enter'); }
}

const final = await snapshot();
console.log('final', JSON.stringify({ placed: final.placed, msgs: final.msgs.slice(-3) }));
assert.equal(final.placed.length, solution.length, 'all ten characters placed');

const sub = page.getByText(/^提交|^Submit/i).first();
console.log('submit', (await sub.innerText()).replace(/\n/g, ' '));
await sub.click();
await page.waitForTimeout(8000);
const body = await page.evaluate(() => document.body.innerText);
console.log('RESULT TAIL:', body.slice(-700).replace(/\n+/g, ' | '));
assert.ok(/案件已破|你找到了凶手|Congrat|Solved/i.test(body), 'puzzle solved');

await ctx.close(); server.close();
console.log('FULL E2E OK calls', calls, 'turns', turns);
process.exit(0);
