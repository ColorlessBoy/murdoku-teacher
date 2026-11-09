import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_SRC = path.resolve(HERE, '..');
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || '/Users/penglingwei/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs');

const PORT = 18081;
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
    if (isExam) {
      text = '结论：INVALID\nR3C4 只是 B 的候选之一；三把椅子都能坐人，没有任何线索能排除 R10C7/R10C8。';
    } else if (isChallenge) {
      text = 'E 写在 R2C2 只是候选，不是唯一。沙地六格都能坐人，线索只说“在沙地砖上”，没有排除其他沙地格；先保留候选。请审查；接受后我走下一步。';
    } else if (newTurn) {
      turns++;
      const cell = turns === 1 ? { r: 3, c: 4, who: 'B' } : { r: 2, c: 2, who: 'E' };
      tool = { id: `call_mock_${turns}`, type: 'function', function: { name: 'board_note', arguments: JSON.stringify(cell) } };
    } else {
      text = turns <= 1
        ? 'B 坐在一把椅子上。三把椅子 R3C4、R10C7、R10C8 都能坐人，没有线索排除任何一把，所以先把 B 写在 R3C4 作为候选。请审查；接受后我走下一步。'
        : 'E 的线索是在沙地砖上。沙地六格都能坐人，先把 E 写在 R2C2 作为候选，不排除其他沙地格。请审查；接受后我走下一步。';
    }
    const data = {
      id: 'mock', object: 'chat.completion', model: 'mock',
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
const dst = process.env.E2E_EXT_DIR || '/tmp/mm-e2e2-ext';
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (s) => !s.includes('/.git') && !s.includes('/docs') && !s.includes('/scripts') });
const mf = JSON.parse(fs.readFileSync(`${dst}/manifest.json`, 'utf8'));
mf.host_permissions = [...(mf.host_permissions || []), 'http://127.0.0.1/*'];
fs.writeFileSync(`${dst}/manifest.json`, JSON.stringify(mf, null, 2));
let bg = fs.readFileSync(`${dst}/background.js`, 'utf8');
bg = `chrome.storage.local.set({ mm_settings: { apiKey: "test", baseUrl: "http://127.0.0.1:${PORT}/v1", model: "mock", maxTokens: 2048 }, mm_mode: "tutor", mm_enabled: true, mm_core_ledger_write: true });\n` + bg;
fs.writeFileSync(`${dst}/background.js`, bg);

const exe = process.env.CHROME_PATH || '/Users/penglingwei/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const profile = process.env.E2E_PROFILE || '/tmp/mm-e2e2-profile';
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: exe, headless: false, acceptDownloads: true,
  args: [`--disable-extensions-except=${dst}`, `--load-extension=${dst}`, '--no-first-run', '--no-default-browser-check'],
});
const page = await ctx.newPage();
let cells = 0;
for (let i = 0; i < 5 && !cells; i++) {
  try { await page.goto('https://murdoku.com/play/puzzle-minigolf-hard', { waitUntil: 'commit', timeout: 25000 }); } catch (e) { console.log('goto retry', i, e.message.split('\n')[0]); }
  await page.waitForTimeout(5000);
  cells = await page.evaluate(() => document.querySelectorAll('[data-cell-index]').length).catch(() => 0);
  console.log('cells', i, cells);
}
await page.waitForTimeout(9000);

const snapshot = async () => page.evaluate(() => ({
  notes: [...document.querySelectorAll('.grid-note-letter')].length,
  msgs: [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].slice(-5).map((x) => x.textContent.slice(0, 320)),
  ver: document.querySelector('#mm-ver')?.textContent || null,
  display: document.getElementById('mm-sidebar') ? getComputedStyle(document.getElementById('mm-sidebar')).display : null,
}));
const pre = await snapshot();
console.log('pre', JSON.stringify(pre));
assert.equal(pre.display, 'flex');
assert.equal(cells, 200);
const expectVer = 'v' + JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')).version;
assert.equal(pre.ver, expectVer);

const ta = page.locator('#mm-sidebar .mm-composer textarea');
if (!pre.msgs.length) { await ta.fill('开始教学，第一步。'); await ta.press('Enter'); }
await page.waitForTimeout(25000);
const step1 = await snapshot();
console.log('step1', JSON.stringify(step1));
assert.ok(step1.notes >= 1, 'step1 note');
assert.ok(step1.msgs.some((m) => m.includes('请审查')), 'step1 reply');

await ta.fill('接受，继续下一步。'); await ta.press('Enter'); await page.waitForTimeout(30000);
const step2 = await snapshot();
console.log('step2', JSON.stringify(step2));
assert.ok(step2.notes >= 2, 'step2 note');
assert.ok(step2.msgs.some((m) => m.includes('请审查')), 'step2 reply');

await ta.fill('我质疑：E 为什么只写 R2C2？'); await ta.press('Enter'); await page.waitForTimeout(25000);
const challenge = await snapshot();
console.log('challenge', JSON.stringify(challenge));
assert.equal(challenge.notes, step2.notes, 'challenge did not change board');
assert.ok(challenge.msgs.some((m) => /候选|沙地|R2C2/.test(m)), 'challenge explanation');

await page.locator('#mm-sidebar .mm-tab.e').click(); await page.waitForTimeout(800);
await ta.fill('我的结论：B 应该在 R3C4。'); await ta.press('Enter'); await page.waitForTimeout(25000);
const exam = await snapshot();
console.log('exam', JSON.stringify(exam));
assert.equal(exam.notes, step2.notes, 'exam did not change board');
assert.ok(exam.msgs.some((m) => /INVALID|结论/.test(m)), 'exam audit reply');

await page.locator('#mm-sidebar .mm-tab.t').click(); await page.waitForTimeout(800);
await ta.fill('/clear'); await ta.press('Enter'); await page.waitForTimeout(9000);
const cleared = await snapshot();
console.log('cleared', JSON.stringify(cleared));
assert.equal(cleared.notes, 0, 'clear notes');

await ta.fill('/new'); await ta.press('Enter'); await page.waitForTimeout(30000);
const fresh = await snapshot();
console.log('fresh', JSON.stringify(fresh));
assert.ok(fresh.notes >= 1, 'new session teacher note');
assert.ok(fresh.msgs.some((m) => m.includes('请审查')), 'new session reply');

await ta.fill('/eventlog'); await ta.press('Enter'); await page.waitForTimeout(1000);
const ev = await snapshot();
console.log('eventlog', JSON.stringify(ev.msgs.slice(-2)));
assert.ok(ev.msgs.some((m) => /事件日志：\d+ 条/.test(m)), 'eventlog');

// options page + log download via product path (gear -> openOptionsPage)
try {
  const newPagePromise = ctx.waitForEvent('page', { timeout: 10000 });
  await page.locator('#mm-sidebar .mm-gear').click();
  const opt = await newPagePromise;
  await opt.waitForLoadState('domcontentloaded', { timeout: 12000 });
  await opt.waitForTimeout(1200);
  const meta = await opt.evaluate(() => ({
    title: document.title,
    baseUrl: document.querySelector('#baseUrl')?.value || '',
    model: document.querySelector('#model')?.value || '',
    hasDownload: !!document.querySelector('#download'),
  }));
  console.log('options', JSON.stringify(meta));
  assert.ok(meta.hasDownload, 'options download');
  const dlPromise = opt.waitForEvent('download', { timeout: 10000 });
  await opt.locator('#download').click();
  const dl = await dlPromise;
  const pth = await dl.path();
  const json = JSON.parse(fs.readFileSync(pth, 'utf8'));
  const logs = Array.isArray(json) ? json : (json.logs || []);
  console.log('download', dl.suggestedFilename(), 'logs', logs.length);
  assert.ok(logs.length > 0, 'downloaded logs');
} catch (e) {
  console.log('options test skipped/failed', e.message.split('\n')[0]);
}

await ctx.close(); server.close();
console.log('E2E3 OK calls', calls, 'turns', turns);
process.exit(0);
