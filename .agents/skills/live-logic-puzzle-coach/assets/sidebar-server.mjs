// Murdoku sidebar/HUD server — bundled with live-logic-puzzle-coach.
// Connects through the Playwriter Chrome extension over CDP (not the Python playwright package).
// Usage:
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
//   MURDOKU_DIR=/tmp/murdoku MURDOKU_URL_MATCH=wine-cellar \
//   CDP_URL=http://127.0.0.1:19988 PORT=7791 \
//   node sidebar-server.mjs [plan.json]
// Endpoints: GET /state, GET /board, POST /act, POST /decide
import http from 'http';
import fs from 'fs';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const PORT = Number(process.env.PORT || 7791);
const DIR = process.env.MURDOKU_DIR || process.cwd();
fs.mkdirSync(DIR, { recursive: true });
const LOG = DIR + '/sidebar.log';
const log = (o) => { const l = JSON.stringify({ ts: new Date().toISOString(), ...o }); fs.appendFileSync(LOG, l + '\n'); console.log(l); };

const MARKS = () => {
  if (window.__marks && window.__marks.v === 2) return;
  const o1 = document.getElementById('mg-root'), o2 = document.getElementById('mg-style');
  if (o1) o1.remove(); if (o2) o2.remove();
  const root = document.createElement('div'); root.id = 'mg-root'; document.documentElement.appendChild(root);
  const style = document.createElement('style'); style.id = 'mg-style';
  style.textContent = `
  #mg-root{position:fixed;inset:0;z-index:2147483646;pointer-events:none;font-family:Inter,-apple-system,"PingFang SC",sans-serif}
  #mg-root .mark{position:absolute;border:3px solid #e0a63c;border-radius:8px;box-shadow:0 0 0 3px rgba(224,166,60,.16),0 0 14px rgba(224,166,60,.55)}
  #mg-root .mark.excl{border-color:#8a8394;box-shadow:none;opacity:.75}
  #mg-root .mark.place{border-color:#2fbf71;box-shadow:0 0 0 3px rgba(47,191,113,.18),0 0 14px rgba(47,191,113,.6)}
  #mg-root .badge{position:absolute;top:-11px;left:-11px;width:22px;height:22px;border-radius:11px;background:#e0a63c;color:#1a1206;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:12px;border:2px solid #120e18}
  #mg-root .mark.excl .badge{background:#8a8394;color:#fff}
  #mg-root .mark.place .badge{background:#2fbf71}
  #mg-root .tag{position:absolute;top:calc(100% + 3px);left:50%;transform:translateX(-50%);white-space:nowrap;background:#120e18;color:#f4efe8;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:5px;border:1px solid #3a3345}
  #mg-root .mark.above .tag{top:auto;bottom:calc(100% + 3px)}
  #mg-root .ring{position:absolute;border:3px solid #6ea8ff;border-radius:10px;box-shadow:0 0 0 3px rgba(110,168,255,.16)}
  `;
  document.documentElement.appendChild(style);
  let items = [], ringEl = null, ringCard = null, raf = 0;
  const place = () => {
    for (const it of items) {
      const cell = document.querySelector(`[data-cell-index="${it.idx}"]`);
      if (!cell) { it.el.style.display = 'none'; continue; }
      it.el.style.display = 'block';
      const r = cell.getBoundingClientRect();
      it.el.style.left = r.left + 'px'; it.el.style.top = r.top + 'px';
      it.el.style.width = r.width + 'px'; it.el.style.height = r.height + 'px';
      it.el.classList.toggle('above', r.bottom > innerHeight - 28);
    }
    if (ringEl && ringCard) { const r = ringCard.getBoundingClientRect(); ringEl.style.left = (r.left - 3) + 'px'; ringEl.style.top = (r.top - 3) + 'px'; ringEl.style.width = r.width + 'px'; ringEl.style.height = r.height + 'px'; }
  };
  const loop = () => { place(); raf = requestAnimationFrame(loop); };
  window.__marks = { v: 2, clear() { items = []; ringEl = null; ringCard = null; root.innerHTML = ''; cancelAnimationFrame(raf); raf = 0; }, show(p) { this.clear(); if (p.focusName) { const card = document.querySelector(`button[title="${p.focusName}"]`); if (card) { ringCard = card; ringEl = document.createElement('div'); ringEl.className = 'ring'; root.appendChild(ringEl); } } (p.marks || []).forEach((m, i) => { const idx = (m.r - 1) * 9 + (m.c - 1); const el = document.createElement('div'); el.className = 'mark ' + (m.kind || 'cand'); el.innerHTML = `<div class="badge">${i + 1}</div><div class="tag">${m.label || ''}</div>`; root.appendChild(el); items.push({ el, idx }); }); place(); loop(); } };
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  if (window.visualViewport) { visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
};

const CHAT = () => {
  if (window.__chat && window.__chat.v === 2) return;
  const old = document.getElementById('mg-sidebar'), oldS = document.getElementById('mg-sidebar-style');
  if (old) old.remove(); if (oldS) oldS.remove();
  const style = document.createElement('style'); style.id = 'mg-sidebar-style';
  style.textContent = `
  #mg-sidebar{position:fixed;left:0;top:0;bottom:0;width:390px;background:#0b0910;color:#f4efe8;border-right:2px solid #221b2d;box-shadow:10px 0 34px rgba(0,0,0,.45);z-index:2147483647;display:flex;flex-direction:column;font-family:Inter,-apple-system,"PingFang SC",sans-serif;pointer-events:auto}
  #mg-sidebar .hd{padding:12px 14px;border-bottom:2px solid #221b2d;display:flex;justify-content:space-between;align-items:center;gap:10px}
  #mg-sidebar .hd .ttl{font-size:13px;font-weight:800;letter-spacing:.02em;display:flex;align-items:center;gap:7px}
  #mg-sidebar .hd .dot{width:8px;height:8px;border-radius:50%;background:#2fbf71;box-shadow:0 0 8px rgba(47,191,113,.8)}
  #mg-sidebar .hd .sub{font-size:10.5px;color:#8d8499;margin-top:3px}
  #mg-sidebar .hd button{background:#221b2d;color:#f4efe8;border:0;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;font-weight:700}
  #mg-sidebar .log{flex:1;overflow:auto;padding:14px 12px;display:flex;flex-direction:column;gap:12px}
  #mg-sidebar .msg{display:flex;gap:8px;align-items:flex-end;max-width:100%}
  #mg-sidebar .msg.you{flex-direction:row-reverse}
  #mg-sidebar .avatar{width:26px;height:26px;border-radius:50%;flex:0 0 26px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;background:#2a2235;color:#c9a45c;border:1px solid #3a3345}
  #mg-sidebar .msg.you .avatar{background:#243b2c;color:#bff0cf;border-color:#2f5a3d}
  #mg-sidebar .bubble{max-width:calc(100% - 44px);background:#1c1626;border:1px solid #2f2740;border-radius:14px;border-bottom-left-radius:4px;padding:9px 11px;font-size:13px;line-height:1.62}
  #mg-sidebar .msg.you .bubble{background:#243b2c;border-color:#2f5a3d;border-bottom-left-radius:14px;border-bottom-right-radius:4px;color:#bff0cf;font-weight:700}
  #mg-sidebar .msg.you.bad .bubble{background:#3a2430;border-color:#6b3345;color:#ffc9d6}
  #mg-sidebar .meta{font-size:10px;color:#8d8499;margin-bottom:4px;display:flex;gap:6px;align-items:center}
  #mg-sidebar .t{font-weight:800;font-size:13.5px;margin-bottom:4px}
  #mg-sidebar .w{white-space:pre-wrap;color:#ddd5e8}
  #mg-sidebar .marks{margin-top:7px;font-size:11.5px;color:#bdb4c9;line-height:1.8}
  #mg-sidebar .c{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}
  #mg-sidebar .cand{background:#e0a63c}#mg-sidebar .excl{background:#8a8394}#mg-sidebar .place{background:#2fbf71}
  #mg-sidebar .form{margin-top:9px;border-top:1px dashed #3a3345;padding-top:9px}
  #mg-sidebar .row{display:flex;gap:7px}
  #mg-sidebar .row button{flex:1;border:0;border-radius:8px;padding:8px;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit}
  #mg-sidebar .ok{background:#2fbf71;color:#07120b}#mg-sidebar .no{background:#3a3345;color:#f4efe8}
  #mg-sidebar textarea{width:100%;margin-top:8px;min-height:54px;background:#0b0810;color:#f4efe8;border:2px solid #3a3345;border-radius:8px;padding:7px;font-family:inherit;font-size:12.5px;box-sizing:border-box;resize:vertical}
  #mg-sidebar .send{margin-top:5px;background:#c9a45c;color:#1a1206;border:0;border-radius:7px;padding:7px 12px;font-weight:800;cursor:pointer;font-family:inherit}
  #mg-sidebar .sys{text-align:center;font-size:10.5px;color:#8d8499;letter-spacing:.04em}
  #mg-sidebar.min{width:0;overflow:hidden;border:0}
  #mg-sidebar #mg-resize{position:absolute;right:-3px;top:0;bottom:0;width:7px;cursor:col-resize;background:transparent;z-index:5}
  #mg-sidebar #mg-resize:hover{background:#c9a45c}
  html,body{overflow:hidden !important}
  #mg-tab{position:fixed;left:0;top:42%;width:26px;height:96px;background:#c9a45c;color:#1a1206;border-radius:0 8px 8px 0;z-index:2147483647;display:none;align-items:center;justify-content:center;font-weight:900;font-size:12px;cursor:pointer;writing-mode:vertical-rl}
  `;
  document.documentElement.appendChild(style);
  const sb = document.createElement('div'); sb.id = 'mg-sidebar'; document.documentElement.appendChild(sb);
  const savedW = parseInt(localStorage.getItem('mg_w') || '390', 10);
  sb.style.width = Math.max(280, Math.min(680, savedW)) + 'px';
  const handle = document.createElement('div'); handle.id = 'mg-resize'; sb.appendChild(handle);
  const tab = document.createElement('div'); tab.id = 'mg-tab'; tab.textContent = '推理记录'; tab.onclick = () => { sb.classList.remove('min'); tab.style.display = 'none'; apply(); }; document.documentElement.appendChild(tab);
  const apply = () => {
    const r = document.getElementById('root'); if (!r) return;
    const W = sb.getBoundingClientRect().width || parseInt(sb.style.width, 10) || 390;
    const paneW = Math.max(100, innerWidth - W), paneH = Math.max(100, innerHeight);
    const rw = r.offsetWidth || innerWidth || 1, rh = r.offsetHeight || innerHeight || 1;
    const sc = Math.max(0.2, Math.min(1, paneW / rw, paneH / rh));
    const dx = W + (paneW - rw * sc) / 2, dy = (paneH - rh * sc) / 2;
    r.style.transformOrigin = 'top left';
    r.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  };
  const reset = () => { const r = document.getElementById('root'); if (r) r.style.transform = ''; };
  let dragging = false;
  handle.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); });
  window.addEventListener('mousemove', e => { if (!dragging) return; const W = Math.max(280, Math.min(680, e.clientX)); sb.style.width = W + 'px'; apply(); });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; localStorage.setItem('mg_w', String(Math.round(sb.getBoundingClientRect().width))); } });
  window.addEventListener('resize', () => { if (!sb.classList.contains('min')) apply(); });
  if (window.visualViewport) visualViewport.addEventListener('resize', () => { if (!sb.classList.contains('min')) apply(); });
  const fmt = (ts) => { if (!ts) return ''; const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  window.__chat = {
    v: 2,
    apply, reset,
    render(data) {
      sb.innerHTML = '';
      const hd = document.createElement('div'); hd.className = 'hd';
      const pending = data.pendingId ? data.entries.find(e => e.id === data.pendingId) : null;
      hd.innerHTML = '<div><div class="ttl"><span class="dot"></span>Murdoku 伴侣</div><div class="sub">' + (pending ? ('老师在讲解第 ' + pending.id + ' 步 · 等你确认') : '推理记录已同步') + '</div></div><button>收起 «</button>';
      hd.querySelector('button').onclick = () => { sb.classList.add('min'); tab.style.display = 'flex'; reset(); };
      sb.appendChild(hd);
      const lg = document.createElement('div'); lg.className = 'log'; sb.appendChild(lg);
      for (const e of data.entries) {
        if (e.status === 'aborted') {
          const s = document.createElement('div'); s.className = 'sys'; s.textContent = '（第 ' + e.id + ' 步已作废）'; lg.appendChild(s); continue;
        }
        const msg = document.createElement('div'); msg.className = 'msg me';
        const av = document.createElement('div'); av.className = 'avatar'; av.textContent = '师'; msg.appendChild(av);
        const b = document.createElement('div'); b.className = 'bubble';
        const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = '老师 · 第 ' + e.id + ' 步' + (e.ts ? ' · ' + fmt(e.ts) : ''); b.appendChild(meta);
        const t = document.createElement('div'); t.className = 't'; t.textContent = e.payload.title || ''; b.appendChild(t);
        const w = document.createElement('div'); w.className = 'w'; w.textContent = e.payload.reason || ''; b.appendChild(w);
        if ((e.payload.marks || []).length) {
          const m = document.createElement('div'); m.className = 'marks';
          m.innerHTML = e.payload.marks.map((x, i) => '<div><span class="c ' + (x.kind || 'cand') + '"></span><b>' + (i + 1) + '</b> ' + (x.label || '') + '</div>').join('');
          b.appendChild(m);
        }
        if (e.status === 'pending') {
          const f = document.createElement('div'); f.className = 'form';
          f.innerHTML = '<div class="row"><button class="ok">确定执行</button><button class="no">不执行</button></div><textarea placeholder="有疑问写在这里，提交后会停在这一步"></textarea><button class="send">提交反馈</button>';
          const ta = f.querySelector('textarea'); ta.value = localStorage.getItem('draft_' + e.id) || '';
          ta.oninput = () => localStorage.setItem('draft_' + e.id, ta.value);
          const send = (ok) => { window.__mdecide(e.id, ok, ok ? '' : (ta.value.trim() || '(未填写)')); localStorage.removeItem('draft_' + e.id); };
          f.querySelector('.ok').onclick = () => send(true);
          f.querySelector('.no').onclick = () => send(false);
          f.querySelector('.send').onclick = () => send(false);
          b.appendChild(f);
        }
        msg.appendChild(b); lg.appendChild(msg);
        if (e.status !== 'pending') {
          const um = document.createElement('div'); um.className = 'msg you' + (e.status === 'rejected' ? ' bad' : '');
          const ua = document.createElement('div'); ua.className = 'avatar'; ua.textContent = '你'; um.appendChild(ua);
          const ub = document.createElement('div'); ub.className = 'bubble';
          const umeta = document.createElement('div'); umeta.className = 'meta'; umeta.textContent = '你 · ' + (e.status === 'approved' ? '确认' : '反馈'); ub.appendChild(umeta);
          const ut = document.createElement('div'); ut.textContent = e.status === 'approved' ? '✓ 确定执行' : '✗ ' + (e.feedback || '不执行'); ub.appendChild(ut);
          um.appendChild(ub); lg.appendChild(um);
        }
      }
      lg.scrollTop = lg.scrollHeight;
      apply();
    }
  };
};
const MARKS_SRC = '(' + MARKS.toString() + ')()';
const CHAT_SRC = '(' + CHAT.toString() + ')()';

const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:19988');
const ctx = browser.contexts()[0];
const match = process.env.MURDOKU_URL_MATCH || 'murdoku.com';
let page = null;
for (const p of ctx.pages()) if (p.url().includes(match)) page = p;
if (!page) page = ctx.pages()[0];
if (!page) { console.error('NO page'); process.exit(1); }
await page.exposeFunction('__mdecide', (id, approved, feedback) => decide(id, approved, feedback));
await page.addInitScript({ content: MARKS_SRC });
await page.addInitScript({ content: CHAT_SRC });
await page.evaluate(MARKS_SRC);
await page.evaluate(CHAT_SRC);
console.log('game attached', page.url());

const HIST_FILE = DIR + '/chat-history.json';
const history = [];
let seq = 0;
const state = { pending: null };
function save() { try { fs.writeFileSync(HIST_FILE, JSON.stringify(history.map(e => ({ id: e.id, payload: e.payload, status: e.status, feedback: e.feedback, ts: e.ts })), null, 1)); } catch (e) {} }
function push(payload, status = 'pending', feedback = '') { const e = { id: ++seq, payload, status, feedback, ts: Date.now() }; history.push(e); save(); return e; }
let loaded = false;
if (fs.existsSync(HIST_FILE)) {
  try {
    const arr = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8'));
    for (const e of arr) { e.status = e.status === 'pending' ? 'aborted' : e.status; e.resolve = null; history.push(e); seq = Math.max(seq, e.id); }
    loaded = true;
  } catch (e) {}
}
if (!loaded) save();

function render() {
  page.evaluate(d => window.__chat && window.__chat.render(d), {
    entries: history.map(e => ({ id: e.id, payload: e.payload, status: e.status, feedback: e.feedback, ts: e.ts })),
    pendingId: state.pending ? state.pending.id : null
  }).catch(() => {});
}
function decide(id, approved, feedback) {
  const e = history.find(x => x.id === id && x.status === 'pending');
  if (!e) return false;
  e.status = approved ? 'approved' : 'rejected'; e.feedback = feedback || '';
  state.pending = null;
  page.evaluate(() => window.__marks && window.__marks.clear()).catch(() => {});
  e.resolve({ approved, feedback: e.feedback });
  save();
  log({ decision: { id, approved, feedback } });
  render();
  return true;
}
function ask(payload) {
  return new Promise((resolve) => {
    const e = push(payload); e.resolve = resolve; state.pending = e;
    page.evaluate(p => window.__marks && window.__marks.show(p), payload).catch(() => {});
    render();
    log({ asking: { id: e.id, title: payload.title } });
  });
}
page.on('load', () => { render(); if (state.pending) page.evaluate(p => window.__marks && window.__marks.show(p), state.pending.payload).catch(() => {}); });

const wait = ms => page.waitForTimeout(ms);
const cellIdx = (r, c) => (r - 1) * 9 + (c - 1);
async function cellBox(idx) { return await page.evaluate(i => { const e = document.querySelector(`[data-cell-index="${i}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, idx); }
async function execute(a) {
  if (a.type === 'select') { await page.locator(`button[title="${a.name}"]`).first().click(); await wait(300); return 'select'; }
  if (a.type === 'place' || a.type === 'note' || a.type === 'notes') {
    await page.locator(`button[title="${a.name}"]`).first().click(); await wait(300);
    const cells = a.type === 'notes' ? a.cells : [{ r: a.r, c: a.c }];
    for (const c of cells) { const b = await cellBox(cellIdx(c.r, c.c)); if (!b) continue; if (a.type === 'place') { await page.mouse.move(b.x, b.y); await page.mouse.down(); await wait(850); await page.mouse.up(); } else { await page.mouse.click(b.x, b.y); } await wait(400); }
    return a.type + ' ' + a.name;
  }
  if (a.type === 'xmark') { const xb = page.locator('[title="X 标记"]').first(); if (await xb.count()) await xb.click(); await wait(250); const b = await cellBox(cellIdx(a.r, a.c)); if (b) await page.mouse.click(b.x, b.y); await wait(350); return 'xmark'; }
  if (a.type === 'xmarks') {
    const xb = page.locator('[title="X 标记"]').first();
    if (await xb.count()) await xb.click();
    await wait(250);
    for (const c of (a.cells || [])) { const b = await cellBox(cellIdx(c.r, c.c)); if (b) { await page.mouse.click(b.x, b.y); await wait(300); } }
    if (await xb.count()) await xb.click();
    await wait(250);
    return 'xmarks';
  }
  if (a.type === 'submit') {
    try {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /^(提交|Submit|Check)/.test(x.innerText.trim()));
        if (b) b.click();
      });
    } catch (e) {}
    await wait(800);
    return 'submit';
  }
  return 'unknown';
}
let chain = Promise.resolve();
async function runAction(a) {
  const d = await ask(a);
  if (!d.approved) { fs.writeFileSync(DIR + '/last-feedback.json', JSON.stringify({ a, d }, null, 1)); return { approved: false, ...d, stop: true }; }
  const r = await execute(a); log({ executed: r }); return { approved: true, executed: r };
}
http.createServer(async (req, res) => {
  if (req.url === '/board') {
    try {
      const st = await page.evaluate(() => [...document.querySelectorAll('[data-cell-index]')].map(c => ({ i: +c.dataset.cellIndex, t: c.innerText.trim(), imgs: c.querySelectorAll('img').length })));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(st.filter(x => x.t || x.imgs)));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
    return;
  }
  if (req.url === '/state') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ pending: state.pending ? state.pending.id : null, count: history.length })); return; }
  if (req.method === 'POST') {
    let b = ''; req.on('data', d => b += d);
    req.on('end', async () => { try { const j = JSON.parse(b || '{}'); const list = j.actions || [j]; const out = []; chain = chain.then(async () => { for (const a of list) { const r = await runAction(a); out.push(r); if (r.stop) break; } }); await chain; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out, null, 1)); } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); } }); return;
  }
  res.writeHead(200); res.end('sidebar server');
}).listen(PORT, '127.0.0.1', () => console.log('sidebar http on', PORT));

const planFile = process.argv[2];
if (planFile && fs.existsSync(planFile)) {
  const raw = JSON.parse(fs.readFileSync(planFile, 'utf8')); const plan = raw.actions || raw;
  chain = chain.then(async () => { for (const a of plan) { const r = await runAction(a); if (r.stop) { console.log('STOPPED'); break; } } console.log('PLAN DONE'); });
}
