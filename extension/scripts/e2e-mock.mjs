#!/usr/bin/env node
/**
 * 端到端冒烟：真实扩展 + 真实 Murdoku 盘面 + 本地 mock LLM。
 * 模型被替换为脚本，只验证扩展的 content/background/session/tool/chat 链路。
 *
 * 用法：
 *   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
 *   CHROME_PATH="/path/to/Google Chrome for Testing" \
 *   node scripts/e2e-mock.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_SRC = path.resolve(HERE, '..');
const PLAYWRIGHT_CORE = process.env.PLAYWRIGHT_CORE
  || '/Users/penglingwei/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs';
const CHROME_PATH = process.env.CHROME_PATH
  || '/Users/penglingwei/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PORT = Number(process.env.MOCK_PORT || 18080);
const EXT_TMP = '/tmp/mm-e2e-ext';
const PROFILE = '/tmp/mm-e2e-profile';
const URL = 'https://murdoku.com/play/puzzle-minigolf-hard';

let calls = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' });
    res.end();
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls++;
    let payload = {};
    try { payload = JSON.parse(body); } catch {}
    const msgs = payload.messages || [];
    const hasTool = msgs.some((m) => m.role === 'tool');
    const text = 'B 坐在一把椅子上。三把椅子 R3C4、R10C7、R10C8 都能坐人，没有线索排除任何一把，所以先把 B 写在 R3C4 作为候选。请审查；接受后我走下一步。';
    const tool = {
      id: 'call_mock_1', type: 'function',
      function: { name: 'board_note', arguments: JSON.stringify({ r: 3, c: 4, who: 'B' }) },
    };
    const data = {
      id: 'mock', object: 'chat.completion', model: 'mock',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: hasTool ? text : '', ...(hasTool ? {} : { tool_calls: [tool] }) },
        finish_reason: hasTool ? 'stop' : 'tool_calls',
      }],
      usage: {},
    };
    console.log('mock request', calls, 'tool?', hasTool, 'last', msgs[msgs.length - 1]?.role);
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(data));
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

fs.rmSync(EXT_TMP, { recursive: true, force: true });
fs.cpSync(EXT_SRC, EXT_TMP, { recursive: true, filter: (src) => !src.includes('/.git') && !src.includes('/docs') });
const mf = JSON.parse(fs.readFileSync(path.join(EXT_TMP, 'manifest.json'), 'utf8'));
mf.host_permissions = [...(mf.host_permissions || []), 'http://127.0.0.1/*'];
fs.writeFileSync(path.join(EXT_TMP, 'manifest.json'), JSON.stringify(mf, null, 2));
let bg = fs.readFileSync(path.join(EXT_TMP, 'background.js'), 'utf8');
bg = 'chrome.storage.local.set({ mm_settings: { apiKey: "test", baseUrl: "http://127.0.0.1:' + PORT + '/v1", model: "mock", maxTokens: 2048 }, mm_mode: "tutor", mm_enabled: true });\n' + bg;
fs.writeFileSync(path.join(EXT_TMP, 'background.js'), bg);

const { chromium } = await import(PLAYWRIGHT_CORE);
fs.rmSync(PROFILE, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME_PATH,
  headless: false,
  args: [`--disable-extensions-except=${EXT_TMP}`, `--load-extension=${EXT_TMP}`, '--no-first-run', '--no-default-browser-check'],
});
const page = await ctx.newPage();
let cells = 0;
for (let i = 0; i < 4 && !cells; i++) {
  try { await page.goto(URL, { waitUntil: 'commit', timeout: 25000 }); } catch (e) { console.log('goto retry', i, e.message.split('\n')[0]); }
  await page.waitForTimeout(5000);
  cells = await page.evaluate(() => document.querySelectorAll('[data-cell-index]').length).catch(() => 0);
  console.log('cells', i, cells);
}
await page.waitForTimeout(9000);

const pre = await page.evaluate(() => {
  const sb = document.getElementById('mm-sidebar');
  const t = sb?.querySelector('.mm-composer textarea');
  return {
    display: sb ? getComputedStyle(sb).display : null,
    w: t ? t.getBoundingClientRect().width : null,
    ver: document.querySelector('#mm-ver')?.textContent || null,
    cells: document.querySelectorAll('[data-cell-index]').length,
    msgs: [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].slice(-3).map((x) => x.textContent.slice(0, 200)),
  };
});
console.log('pre', JSON.stringify(pre));
assert.equal(pre.display, 'flex', 'sidebar visible');
assert.ok(pre.w > 0, 'sidebar width');
assert.equal(pre.cells, 200, 'board cells');
assert.equal(pre.ver, 'v0.8.65', 'version');

if (!pre.msgs.length) {
  const ta = page.locator('#mm-sidebar .mm-composer textarea');
  await ta.fill('开始教学，第一步。');
  await ta.press('Enter');
}
await page.waitForTimeout(25000);

const after = await page.evaluate(() => ({
  notes: [...document.querySelectorAll('.grid-note-letter')].length,
  msgs: [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].slice(-4).map((x) => x.textContent.slice(0, 300)),
  ver: document.querySelector('#mm-ver')?.textContent || null,
}));
console.log('after', JSON.stringify(after));
assert.ok(after.notes >= 1, 'teacher wrote a note');
assert.ok(after.msgs.some((m) => m.includes('请审查')), 'teacher reply present');
assert.ok(calls >= 2, 'mock tool round + text round');

await ctx.close();
server.close();
console.log('E2E OK');
process.exit(0);
