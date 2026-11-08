// Verify the Playwriter Chrome-extension bridge and list/attach puzzle tabs.
//
// This is NOT the Python `playwright` package and NOT a browser download.
// It talks to the Playwriter Chrome extension over CDP.
//
// Usage:
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
//   CDP_URL=http://127.0.0.1:19988 \
//   MURDOKU_URL_MATCH=wine-cellar \
//   node attach.mjs
//
// Optional: MURDOKU_OPEN=https://murdoku.com/play/puzzle-... opens a new tab
// through the extension when no matching tab exists.

const CDP = process.env.CDP_URL || 'http://127.0.0.1:19988';
const MATCH = process.env.MURDOKU_URL_MATCH || 'murdoku.com';

let info;
try {
  const res = await fetch(CDP + '/json/version');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  info = await res.json();
} catch (e) {
  console.error('Playwriter bridge not reachable at ' + CDP);
  console.error('Start Chrome with the Playwriter extension, then retry.');
  console.error(String(e));
  process.exit(1);
}

console.log('bridge:', info.Browser || '(unknown)', info.webSocketDebuggerUrl || '');

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];

let pages = ctx.pages();
for (const p of pages) console.log('tab:', p.url());

let page = pages.find(p => p.url().includes(MATCH));
if (!page && process.env.MURDOKU_OPEN) {
  page = await ctx.newPage();
  await page.goto(process.env.MURDOKU_OPEN);
  console.log('opened:', page.url());
}
if (!page) {
  console.error('no tab matching "' + MATCH + '"');
  console.error('open the puzzle tab in this Chrome profile, or set MURDOKU_OPEN');
  await browser.close();
  process.exit(2);
}

console.log('attached:', page.url());
await browser.close();
