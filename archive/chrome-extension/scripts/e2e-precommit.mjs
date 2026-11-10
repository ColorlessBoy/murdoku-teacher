import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const FIXTURE = path.join(SRC, 'test', 'e2e', 'fixture.html');
const PW = process.env.PLAYWRIGHT_CORE || 'playwright-core';

let chromium;
try {
  ({ chromium } = await import(PW));
} catch (e) {
  console.error(`[precommit-e2e] cannot load playwright-core: ${PW}`);
  console.error('  set PLAYWRIGHT_CORE to playwright-core/index.mjs, or npm i -D playwright-core');
  process.exit(2);
}

const fixtureHtml = fs.readFileSync(FIXTURE, 'utf8');
let mockCalls = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); res.end(); return; }
  if (req.url === '/fixture.html' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fixtureHtml);
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      mockCalls++;
      const reqJson = (() => { try { return JSON.parse(body); } catch (e) { return {}; } })();
      const messages = reqJson.messages || [];
      const hasToolResult = messages.some((m) => m.role === 'tool');
      const text = 'B 坐在一把椅子上。三把椅子 R3C4、R10C7、R10C8 都能坐，先把 B 写在 R3C4 作为候选。请审查；接受后我走下一步。';
      const message = { role: 'assistant', content: text };
      if (!hasToolResult) {
        message.tool_calls = [{
          id: 'call_precommit_1', type: 'function',
          function: { name: 'board_note', arguments: JSON.stringify({ r: 3, c: 4, who: 'B' }) },
        }];
      }
      const data = {
        id: 'mock', object: 'chat.completion', model: 'mock',
        choices: [{ index: 0, message, finish_reason: hasToolResult ? 'stop' : 'tool_calls' }],
        usage: {},
      };
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(data));
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const tmpExt = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-precommit-ext-'));
const dst = path.join(tmpExt, 'extension');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-precommit-profile-'));
const skip = (p) => p === path.join(SRC, 'test') || p === path.join(SRC, 'scripts') || p === path.join(SRC, 'docs') || p.includes(`${path.sep}node_modules`) || p.includes(`${path.sep}.git`) || p.endsWith('.env.precommit');
fs.cpSync(SRC, dst, { recursive: true, filter: (p) => !skip(p) });
if (!fs.existsSync(path.join(dst, 'manifest.json'))) { console.error('[precommit-e2e] extension copy failed', dst); process.exit(2); }
const mf = JSON.parse(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf8'));
mf.content_scripts[0].matches.push('http://127.0.0.1/*');
mf.host_permissions = [...(mf.host_permissions || []), 'http://127.0.0.1/*'];
fs.writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify(mf, null, 2));
let bg = fs.readFileSync(path.join(dst, 'background.js'), 'utf8');
bg = `chrome.storage.local.set({ mm_settings: { apiKey: "test", baseUrl: "${base}/v1", model: "mock", maxTokens: 2048 }, mm_mode: "tutor", mm_enabled: true });\n` + bg;
fs.writeFileSync(path.join(dst, 'background.js'), bg);

const exe = process.env.CHROME_PATH || (() => { try { return chromium.executablePath(); } catch (e) { return undefined; } })();

async function run(headless) {
  const ctx = await chromium.launchPersistentContext(profile + (headless ? '-h' : '-g'), {
    executablePath: exe, headless, acceptDownloads: true,
    args: [`--disable-extensions-except=${dst}`, `--load-extension=${dst}`, '--no-first-run', '--no-default-browser-check'],
  });
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/fixture.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForFunction(() => {
      const sb = document.getElementById('mm-sidebar');
      return !!sb && getComputedStyle(sb).display !== 'none';
    }, null, { timeout: 8000 }).catch(() => {});
    const pre = await page.evaluate(() => ({
      ver: document.querySelector('#mm-ver')?.textContent || null,
      sidebar: !!document.getElementById('mm-sidebar') && getComputedStyle(document.getElementById('mm-sidebar')).display !== 'none',
      cells: document.querySelectorAll('[data-cell-index]').length,
      mode: document.querySelector('#mm-sidebar .mm-tab.on')?.textContent || null,
    }));
    console.log('[precommit-e2e] pre', headless ? 'headless' : 'headed', JSON.stringify(pre));
    if (!pre.sidebar) { await ctx.close(); return { ok: false, reason: 'sidebar_missing', pre }; }
    if (pre.cells !== 100) { await ctx.close(); return { ok: false, reason: 'cells', pre }; }

    const ta = page.locator('#mm-sidebar .mm-composer textarea');
    console.log('[precommit-e2e] sending start');
    await ta.fill('开始教学，第一步。');
    await ta.press('Enter');
    console.log('[precommit-e2e] start sent; wait note');
    await page.waitForFunction(() => document.querySelectorAll('.grid-note-letter').length === 1, null, { timeout: 15000 });
    console.log('[precommit-e2e] note ok');
    await page.waitForFunction(() => [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].some((x) => x.textContent.includes('请审查')), null, { timeout: 15000 });
    const after = await page.evaluate(() => ({
      notes: [...document.querySelectorAll('.grid-note-letter')].length,
      messages: [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].map((x) => x.textContent),
      state: document.querySelector('#mm-sidebar .mm-changes-state')?.textContent || null,
    }));
    assert.equal(after.notes, 1, 'one board note');
    assert.ok(after.messages.some((m) => m.includes('请审查')), 'teacher text');
    assert.equal(mockCalls, 1, 'tool text fast path should use one LLM call');

    console.log('[precommit-e2e] sending clear');
    await ta.fill('/clear');
    await ta.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.grid-note-letter').length === 0, null, { timeout: 10000 });
    await page.waitForFunction(() => [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].some((x) => x.textContent.includes('已清空')), null, { timeout: 10000 });
    const cleared = await page.evaluate(() => ({
      notes: document.querySelectorAll('.grid-note-letter').length,
      messages: [...document.querySelectorAll('#mm-sidebar .mm-msg .mm-text')].map((x) => x.textContent),
    }));
    assert.equal(cleared.notes, 0, 'clear board');
    assert.ok(cleared.messages.some((m) => m.includes('已清空')), 'clear message');
    await ctx.close();
    return { ok: true, pre, after, cleared };
  } catch (e) {
    await ctx.close().catch(() => {});
    return { ok: false, reason: e.message, pre: null };
  }
}

let result = await run(process.env.E2E_HEADED !== '1');
let headed = false;
if (!result.ok && result.reason === 'sidebar_missing' && process.env.E2E_HEADED !== '1') {
  console.log('[precommit-e2e] headless did not load the extension; retrying headed');
  result = await run(false);
  headed = true;
}
if (!result.ok) {
  console.error('[precommit-e2e] FAIL', result.reason, result.pre ? JSON.stringify(result.pre) : '');
  server.close();
  process.exit(1);
}
console.log('[precommit-e2e] OK', JSON.stringify({
  headed: process.env.E2E_HEADED === '1' || headed,
  ver: result.pre.ver,
  mode: result.pre.mode,
  notes: result.after.notes,
  state: result.after.state,
  mockCalls,
}));
server.close();
