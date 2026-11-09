import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || '/Users/penglingwei/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs');

const PORT = 18082;
let calls = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let body = '';
  req.on('data', (c) => body += c);
  req.on('end', () => {
    calls++;
    console.log('mock call', calls);
    const data = {
      id: 'mock', object: 'chat.completion', model: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content: '结论：INVALID\n证据不足，先说明你的排除理由。' }, finish_reason: 'stop' }],
      usage: {},
    };
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(data));
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const src = path.resolve(HERE, '..');
const dst = '/tmp/mm-e2e-queue-ext';
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (s) => !s.includes('/.git') && !s.includes('/docs') && !s.includes('/scripts') });
const mf = JSON.parse(fs.readFileSync(`${dst}/manifest.json`, 'utf8'));
mf.host_permissions = [...(mf.host_permissions || []), 'http://127.0.0.1/*'];
fs.writeFileSync(`${dst}/manifest.json`, JSON.stringify(mf, null, 2));
let bg = fs.readFileSync(`${dst}/background.js`, 'utf8');
const flagOverrides = process.env.E2E_DEFAULT_FLAGS === '1' ? '' : ', mm_core_queue: true, mm_core_ledger_write: true';
bg = `chrome.storage.local.set({ mm_settings: { apiKey: "test", baseUrl: "http://127.0.0.1:${PORT}/v1", model: "mock", maxTokens: 2048 }, mm_mode: "exam", mm_enabled: true${flagOverrides} });\n` + bg;
fs.writeFileSync(`${dst}/background.js`, bg);

const exe = process.env.CHROME_PATH || '/Users/penglingwei/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const profile = '/tmp/mm-e2e-queue-profile';
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: exe, headless: false,
  args: [`--disable-extensions-except=${dst}`, `--load-extension=${dst}`, '--no-first-run', '--no-default-browser-check'],
});
const page = await ctx.newPage();
let cells = 0;
for (let i = 0; i < 5 && !cells; i++) {
  try { await page.goto('https://murdoku.com/play/puzzle-minigolf-hard', { waitUntil: 'commit', timeout: 25000 }); } catch (e) {}
  await page.waitForTimeout(5000);
  cells = await page.evaluate(() => document.querySelectorAll('[data-cell-index]').length).catch(() => 0);
  console.log('cells', i, cells);
}
await page.waitForTimeout(3000);
await page.keyboard.press('Escape').catch(()=>{});
await page.evaluate(() => { document.querySelectorAll('.mrd-modal-backdrop').forEach((x) => x.remove()); document.querySelectorAll('.mrd-modal').forEach((x) => x.remove()); });
await page.waitForTimeout(2000);
const pre = await page.evaluate(() => ({
  ver: document.querySelector('#mm-ver')?.textContent || null,
  mode: [...document.querySelectorAll('#mm-sidebar .mm-tab.on')].map((x) => x.textContent),
  sidebar: !!document.getElementById('mm-sidebar'),
}));
console.log('pre', JSON.stringify(pre));

async function note(r, c, who = 'Burma') {
  await page.locator(`button[title="${who}"]`).first().click({ timeout: 5000 });
  const idx = (r - 1) * 10 + (c - 1);
  await page.locator(`[data-cell-index="${idx}"]`).last().click({ timeout: 5000 });
}
await note(3, 4);
await page.waitForTimeout(16000);
const after1 = await page.evaluate(() => ({
  notes: [...document.querySelectorAll('.grid-note-letter')].length,
  state: document.querySelector('#mm-sidebar .mm-changes-state')?.textContent || null,
  msgs: [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].slice(-2).map((x) => x.textContent.slice(0, 220)),
}));
console.log('after1', JSON.stringify(after1));

await note(2, 2);
await page.waitForTimeout(9000);
const after2 = await page.evaluate(() => ({
  notes: [...document.querySelectorAll('.grid-note-letter')].length,
  state: document.querySelector('#mm-sidebar .mm-changes-state')?.textContent || null,
  msgs: [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].slice(-2).map((x) => x.textContent.slice(0, 220)),
}));
console.log('after2', JSON.stringify(after2));
console.log('calls', calls);
assert.ok(after2.notes >= 2, 'two notes');
assert.ok(/排队/.test(after2.state || ''), 'second change queued');
assert.equal(calls, 1, 'only first audit called model');

await ctx.close(); server.close();
console.log('QUEUE E2E OK');
process.exit(0);
