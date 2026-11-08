(() => {
  if (window.__mmInjected) return;
  window.__mmInjected = true;

  const AV_M = '<svg viewBox="0 0 40 40" width="26" height="26"><circle cx="20" cy="20" r="19" fill="#2a2333"/><path d="M9 15l5 4M31 15l-5 4" stroke="#c9a84c" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="20" r="12.5" fill="#c9a84c"/><circle cx="15" cy="19" r="4.2" fill="#fff"/><circle cx="25" cy="19" r="4.2" fill="#fff"/><circle cx="15" cy="19" r="2.1" fill="#1a1520"/><circle cx="25" cy="19" r="2.1" fill="#1a1520"/><path d="M20 22.5l-2.2 3.2h4.4z" fill="#1a1520"/><path d="M20 9l-1.5 3h3z" fill="#c9a84c"/></svg>';
  const AV_U = '<svg viewBox="0 0 40 40" width="26" height="26"><circle cx="20" cy="20" r="19" fill="#3a3f4a"/><circle cx="20" cy="15" r="7" fill="#cfd6e2"/><path d="M7 35c2-7 7-10 13-10s11 3 13 10" fill="#cfd6e2"/></svg>';

  const PUZZLE = location.pathname.split('/').pop() || 'murdoku';
  let mode = 'exam';
  let boardCache = [];
  let lastSnap = '';
  let lastCount = 0;
  let observer = null;
  let reconcile = null;
  let extDead = false;
  let enabled = true;
  let reactCache = null;
  let lastReactTry = 0;
  const pendingChanges = new Map();
  let flushTimer = 0;
  let pendingSince = 0;

  function markDead() {
    if (extDead) return;
    extDead = true;
    try {
      if (!sb.querySelector('.mm-stale')) {
        const b = document.createElement('div');
        b.className = 'mm-stale';
        b.textContent = '扩展已更新：请刷新页面（F5）';
        sb.prepend(b);
      }
    } catch (e) {}
    try { if (observer) observer.disconnect(); } catch (e) {}
    try { if (reconcile) clearInterval(reconcile); } catch (e) {}
    addMsg('me', '扩展已更新，当前面板已失效。请刷新页面（F5）后继续。', true);
  }

  function sendMsg(payload) {
    if (extDead || !chrome.runtime?.id) { markDead(); return Promise.resolve(null); }
    try {
      return Promise.resolve(chrome.runtime.sendMessage(payload)).catch((e) => {
        if (String(e?.message || e).includes('invalidated')) markDead();
        return null;
      });
    } catch (e) {
      if (String(e?.message || e).includes('invalidated')) markDead();
      return Promise.resolve(null);
    }
  }

  const dbgEl = document.createElement('pre');
  dbgEl.id = 'mm-debug';
  dbgEl.style.display = 'none';
  document.documentElement.appendChild(dbgEl);

  function clientLog(event, data = {}) {
    sendMsg({ type: 'mm:client-log', event, data });
  }

  async function publishDebug() {
    try {
      if (!chrome.storage?.local) return;
      const all = await chrome.storage.local.get(null);
      const logs = (all.mm_logs || []).slice(-140).map((l) => ({ ts: l.ts, level: l.level, event: l.event, data: l.data }));
      const lk = Object.keys(all).filter((k) => k.startsWith('mm_ledger_'));
      const led = lk.length ? all[lk[lk.length - 1]] : null;
      const safe = encodeURIComponent(PUZZLE).slice(0, 90);
      const st = all['mm_state_' + safe] || null;
      const queue = all['mm_queue_' + safe] || [];
      const qs = led ? (led.questions || []) : [];
      const unresolved = qs.filter((q) => q.status !== 'closed').length;
      if (!boardCache.length && changesState) changesState.textContent = '等待游戏盘面…';
      const prepEl = root.querySelector('#mm-prep');
      if (prepEl && st) {
        const prepStale = st.prepStatus === 'running' && st.prepAt && Date.now() - st.prepAt > 120000;
        prepEl.textContent = prepStale ? '备课超时' : st.prepStatus === 'running' ? '备课中' : st.prepStatus === 'done' ? '备课✓' : st.prepStatus === 'failed' ? '备课×' : '备课—';
        prepEl.dataset.status = prepStale ? 'failed' : (st.prepStatus || 'idle');
        prepEl.title = st.prep && st.prep.chain ? `备课 ${st.prep.chain.length} 步` : '';
      }
      dbgEl.textContent = JSON.stringify({
        ts: new Date().toISOString(), puzzle: PUZZLE, mode,
        cells: boardCache.length,
        notes: boardCache.filter((c) => c.notes.length).length,
        x: boardCache.filter((c) => c.x).length,
        pending: document.querySelector('#mm-sidebar .mm-pending')?.textContent || null,
        clues: clues().slice(0, 1600),
        extDead,
        unresolved,
        questions: qs.slice(-4).map((q) => ({ id: q.id, status: q.status, cells: q.cells?.length, answer: q.answer || null })),
        ledgerSeq: led ? led.seq : null,
        prepStatus: st ? st.prepStatus : null,
        prepChain: st && st.prep ? (st.prep.chain || []).length : 0,
        queue: Array.isArray(queue) ? queue.length : 0,
        logs,
      });
    } catch (e) {
      dbgEl.textContent = JSON.stringify({ error: String(e) });
    }
  }
  let warmup = true;
  let debounce = null;
  let marks = [];
  let raf = 0;

  const root = document.createElement('div');
  root.id = 'mm-root';
  root.innerHTML = `
    <div id="mm-sidebar" class="exam">
      <div class="mm-hd">
        <div class="mm-title"><span class="mm-dot"></span>墨墨 <span class="mm-sub">Murdoku 陪练</span></div>
        <div class="mm-tabs"><span class="mm-tab t on">教学</span><span class="mm-tab e">考试</span></div>
        <span class="mm-pending" title="未解决审计项">待审 0</span><button class="mm-gear" title="设置">⚙</button>
        <button class="mm-min" title="收起">«</button>
      </div>
      <div class="mm-mascot" aria-hidden="true">
        <div class="mm-owl">
          <svg viewBox="0 0 100 100">
            <defs>
              <radialGradient id="mmBody" cx="35%" cy="28%" r="80%">
                <stop offset="0" stop-color="#e6c56e"/><stop offset="1" stop-color="#a8823a"/>
              </radialGradient>
              <radialGradient id="mmBelly" cx="40%" cy="30%" r="80%">
                <stop offset="0" stop-color="#f6e3b0"/><stop offset="1" stop-color="#d8b96a"/>
              </radialGradient>
              <linearGradient id="mmBeak" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#e07a1f"/>
              </linearGradient>
            </defs>
            <ellipse class="mm-shadow" cx="50" cy="94" rx="24" ry="5" fill="#000" opacity=".3"/>
            <g class="mm-pillow" opacity="0">
              <ellipse cx="50" cy="87" rx="27" ry="8" fill="#b9afc9"/>
              <ellipse cx="50" cy="84" rx="24" ry="6" fill="#ddd4ea"/>
              <path d="M30 84c8-3 32-3 40 0" stroke="#a99cbd" stroke-width="1.2" fill="none"/>
            </g>
            <g class="mm-feet" stroke="#e07a1f" stroke-width="3" stroke-linecap="round" fill="none">
              <path d="M40 87l-4 6"/><path d="M43 88l0 6"/><path d="M46 87l3 6"/>
              <path d="M60 87l-3 6"/><path d="M57 88l0 6"/><path d="M54 87l-4 6"/>
            </g>
            <path class="mm-wing mm-wing-l" d="M22 52c-8 7-9 20-2 25 4 3 9 0 9-5V54z" fill="#96702f"/>
            <g class="mm-wing-r-group">
              <path class="mm-wing mm-wing-r" d="M78 52c8 7 9 20 2 25-4 3-9 0-9-5V54z" fill="#96702f"/>
              <g class="mm-cloth" opacity="0">
                <path d="M73 65h13l-3 11H72z" fill="#ece4d2"/>
                <path d="M73.5 68h11.5M73 72h11" stroke="#b9a87a" stroke-width="1.2" stroke-linecap="round"/>
                <path d="M77 65v11M82 65v11" stroke="#d4c8ab" stroke-width=".7"/>
              </g>
              <g class="mm-dust" opacity="0" fill="#e6d3a0">
                <circle cx="85" cy="72" r="2.4"/>
                <circle cx="90" cy="77" r="1.8"/>
                <circle cx="84" cy="80" r="1.5"/>
              </g>
            </g>
            <path class="mm-wing-line" d="M24 60c2 5 3 9 6 12M76 60c-2 5-3 9-6 12" stroke="#7a5a24" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>
            <ellipse cx="50" cy="60" rx="29" ry="32" fill="url(#mmBody)"/>
            <ellipse cx="50" cy="65" rx="17" ry="21" fill="url(#mmBelly)"/>
            <g class="mm-belly-feathers" stroke="#c9a84c" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".8">
              <path d="M42 61c3 2.5 13 2.5 16 0"/>
              <path d="M43 67c3 2.5 11 2.5 14 0"/>
              <path d="M44 73c2.5 2 9 2 12 0"/>
            </g>
            <circle cx="50" cy="36" r="27" fill="url(#mmBody)"/>
            <path d="M29 17l3-12 9 8z" fill="#8f6a2c"/>
            <path d="M71 17l-3-12-9 8z" fill="#8f6a2c"/>
            <g class="mm-eyes">
              <circle cx="39" cy="36" r="10.5" fill="#fff"/>
              <circle cx="61" cy="36" r="10.5" fill="#fff"/>
              <g class="mm-pupils">
                <circle cx="39" cy="36" r="4.6" fill="#241a10"/>
                <circle cx="61" cy="36" r="4.6" fill="#241a10"/>
                <circle cx="40.5" cy="34.5" r="1.3" fill="#fff"/>
                <circle cx="62.5" cy="34.5" r="1.3" fill="#fff"/>
              </g>
            </g>
            <path class="mm-brow" d="M29 24c4-3 10-3 14 0" stroke="#8f6a2c" stroke-width="3" fill="none" stroke-linecap="round"/>
            <path class="mm-brow" d="M57 24c4-3 10-3 14 0" stroke="#8f6a2c" stroke-width="3" fill="none" stroke-linecap="round"/>
            <path d="M50 45l-5.5 7h11z" fill="url(#mmBeak)"/>
            <path d="M46 48l3-2 3 2" stroke="#ffd9a3" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".8"/>
            <path d="M43 53c3 3 11 3 14 0" stroke="#7a5a24" stroke-width="2" fill="none" stroke-linecap="round"/>
            <g class="mm-blush" fill="#e88a7a" opacity=".55">
              <ellipse cx="26" cy="47" rx="5" ry="2.8"/><ellipse cx="74" cy="47" rx="5" ry="2.8"/>
            </g>
            <g class="mm-glass">
              <circle cx="82" cy="60" r="9" fill="rgba(150,210,255,.16)" stroke="#d8c48a" stroke-width="2.2"/>
              <path d="M88.5 66.5l6 7" stroke="#d8c48a" stroke-width="4" stroke-linecap="round"/>
              <path class="mm-glint" d="M77.5 55.5l4-3" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
            </g>
            <ellipse cx="50" cy="86" rx="13" ry="4" fill="#7a5a24" opacity=".45"/>
            <g class="mm-wake-spark" opacity="0" fill="#e6d3a0">
              <path d="M80 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
              <path d="M22 30l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z"/>
              <path d="M86 42l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>
            </g>
          </svg>
        </div>
        <div class="mm-scan"></div>
        <div class="mm-zzz"><span>z</span><span>z</span><span>z</span></div>
      </div>
      <div class="mm-changes open">
        <button class="mm-changes-hd"><span>盘面检测</span><b class="mm-changes-n">0</b><span class="mm-changes-ver" id="mm-ver">v0.7.12</span><span class="mm-prep" id="mm-prep">备课—</span><span class="mm-changes-state">待机</span></button>
        <div class="mm-changes-body"></div>
      </div>
      <div class="mm-log"></div>
      <div class="mm-composer">
        <textarea placeholder="回答墨墨…（Enter 发送；/clear 清盘；/new 清空上下文）"></textarea>
        <div class="mm-row"><button class="mm-send">发送</button><span class="mm-hint">/clear 只清盘 · /new 清空聊天/上下文</span></div>
      </div>
    </div>
    <div id="mm-marks"></div>
  `;
  document.documentElement.appendChild(root);
  const sb = root.querySelector('#mm-sidebar');
  const logEl = root.querySelector('.mm-log');
  const ta = root.querySelector('.mm-composer textarea');
  const badgeEl = root.querySelector('.mm-pending');
  function setPending(n) {
    if (!badgeEl) return;
    const nv = Number(n) || 0;
    if (badgeEl.textContent !== '待审 ' + nv) {
      badgeEl.textContent = '待审 ' + nv;
      badgeEl.classList.remove('pulse');
      void badgeEl.offsetWidth;
      badgeEl.classList.add('pulse');
    }
    badgeEl.title = '未解决审计项；点击查看账本';
    badgeEl.onclick = () => sendMsg({ type: 'mm:open-options' });
  }
  const marksEl = root.querySelector('#mm-marks');
  const owl = root.querySelector('.mm-owl');
  try {
    const verEl = root.querySelector('#mm-ver');
    if (verEl) verEl.textContent = 'v' + chrome.runtime.getManifest().version;
  } catch (e) {}
  const mascotEl = root.querySelector('.mm-mascot');
  const changesEl = root.querySelector('.mm-changes');
  const changesBody = root.querySelector('.mm-changes-body');
  const changesN = root.querySelector('.mm-changes-n');
  const changesState = root.querySelector('.mm-changes-state');
  root.querySelector('.mm-changes-hd').onclick = () => changesEl.classList.toggle('open');

  function fmtState(s) {
    if (!s) return '空';
    if (s.big) return '落子 ' + s.big;
    if (s.notes && s.notes.length) return '笔记 ' + s.notes.join('');
    if (s.x) return 'X';
    return '空';
  }

  const CHANGES_KEY = 'mm_changes_' + encodeURIComponent(PUZZLE).slice(0, 90);
  let changeLog = [];

  function renderChanges() {
    if (!changesBody) return;
    changesBody.innerHTML = '';
    for (const b of changeLog.slice(-40).reverse()) {
      const hh = new Date(b.ts).toLocaleTimeString('zh-CN', { hour12: false });
      const isReset = b.kind === 'reset';
      const row = document.createElement('div');
      row.className = 'mm-change' + (isReset ? ' reset' : '') + (b.status === 'done' ? ' done' : '');
      const status = b.status === 'done' ? '墨墨已回复' : isReset ? '已重置（未送审）' : '已送审';
      row.innerHTML = `<div class="mm-change-hd"><span>${hh}</span><b>${b.cells.length} 格</b><i>${status}</i></div><div class="mm-change-x"></div>`;
      const list = b.cells.slice(0, 8).map((c) => `R${c.r}C${c.c} ${fmtState(c.before)}→${fmtState(c.after)}`).join('；');
      row.querySelector('.mm-change-x').textContent = list + (b.cells.length > 8 ? ` 等 ${b.cells.length} 格` : '');
      changesBody.appendChild(row);
    }
    changesN.textContent = changeLog.length;
    const last = changeLog[changeLog.length - 1];
    changesState.textContent = !last ? '待机' : (last.status === 'done' ? '墨墨已回复' : last.kind === 'reset' ? '已重置，未送审' : '已送审，等待墨墨…');
  }

  function saveChanges() {
    try { chrome.storage.local.set({ [CHANGES_KEY]: changeLog.slice(-60) }); } catch (e) {}
  }

  async function loadChanges() {
    try {
      const { [CHANGES_KEY]: list = [] } = await chrome.storage.local.get(CHANGES_KEY);
      changeLog = Array.isArray(list) ? list : [];
      renderChanges();
    } catch (e) {}
  }

  function addChangeBatch(changed, kind = 'sent') {
    const isReset = kind === 'reset';
    changeLog.push({
      ts: Date.now(), kind, status: isReset ? 'reset' : 'sent',
      cells: changed.map((c) => ({ r: c.r, c: c.c, before: c.before, after: c.after })),
    });
    if (changeLog.length > 60) changeLog = changeLog.slice(-60);
    saveChanges();
    renderChanges();
    changesEl.classList.add('open');
    if (!isReset) {
      mascotEl.classList.add('busy');
      owl.classList.add('detected', 'thinking');
      setTimeout(() => owl.classList.remove('detected'), 1300);
    }
  }

  function markChangesDone() {
    const b = [...changeLog].reverse().find((x) => x.status === 'sent');
    if (!b) return;
    b.status = 'done';
    saveChanges();
    renderChanges();
  }

  function applyLayout() {
    const game = document.getElementById('root');
    const sbW = !enabled ? 0 : (sb.classList.contains('min') ? 44 : 380);
    if (!game) {
      document.body.style.paddingLeft = sbW + 'px';
      document.body.style.boxSizing = 'border-box';
      return;
    }
    const w = Math.max(640, window.innerWidth);
    const scale = Math.max(0.55, (w - sbW) / w);
    game.style.width = w + 'px';
    game.style.height = (window.innerHeight / scale) + 'px';
    game.style.transformOrigin = 'top left';
    game.style.transition = 'transform .3s cubic-bezier(.2,.8,.2,1)';
    game.style.transform = `translateX(${sbW}px) scale(${scale})`;
    document.body.style.overflow = 'hidden';
  }

  function applyEnabled(on) {
    enabled = on !== false;
    sb.style.display = enabled ? '' : 'none';
    marksEl.style.display = enabled ? '' : 'none';
    if (ta) ta.disabled = !enabled;
    if (!enabled) clearMarks();
    applyLayout();
    if (enabled) check();
  }

  function addMsg(role, text, system = false, ts = Date.now(), replyTo = null) {
    const msg = document.createElement('div');
    msg.className = 'mm-msg ' + (role === 'you' ? 'you' : 'me') + (system ? ' system' : '');
    const av = document.createElement('div');
    av.className = 'mm-avatar';
    av.innerHTML = role === 'you' ? AV_U : AV_M;
    const b = document.createElement('div');
    b.className = 'mm-bubble';
    const meta = document.createElement('div');
    meta.className = 'mm-meta';
    const hhmm = (x) => { try { return new Date(x).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
    meta.textContent = (role === 'you' ? '你' : '墨墨') + ' · ' + (mode === 'exam' ? '考试' : '教学') + ' · ' + hhmm(ts) + (role === 'me' && replyTo ? ' · 回复你 ' + hhmm(replyTo) : '');
    const t = document.createElement('div');
    t.className = 'mm-text';
    if (text.length > 320) {
      const summary = document.createElement('div');
      summary.textContent = text.slice(0, 200).trimEnd() + '…';
      const full = document.createElement('div');
      full.className = 'mm-full';
      full.textContent = text;
      full.style.display = 'none';
      const more = document.createElement('button');
      more.className = 'mm-more';
      more.textContent = `展开全文（${text.length} 字）`;
      more.onclick = () => {
        const open = full.style.display !== 'none';
        full.style.display = open ? 'none' : 'block';
        summary.style.display = open ? 'block' : 'none';
        more.textContent = open ? `展开全文（${text.length} 字）` : '收起';
      };
      t.append(summary, full, more);
    } else {
      t.textContent = text;
    }
    b.appendChild(meta); b.appendChild(t);
    msg.appendChild(av); msg.appendChild(b);
    logEl.appendChild(msg);
    logEl.scrollTo({ top: logEl.scrollHeight, behavior: 'smooth' });
  }

  function setMode(m) {
    mode = m === 'tutor' ? 'tutor' : 'exam';
    sb.classList.toggle('exam', mode === 'exam');
    root.querySelectorAll('.mm-tab').forEach((el) => {
      el.classList.toggle('on', el.classList.contains('t') ? mode === 'tutor' : mode === 'exam');
    });
  }

  function reactBoard() {
    if (!reactCache) return null;
    const names = reactCache.names || [];
    const labels = reactCache.roomLabels || [];
    const rooms = reactCache.roomIds || [];
    const roomName = {};
    for (const l of labels) roomName[l.idx] = l.name;
    const out = {};
    for (let i = 0; i < 100; i++) out[i] = { objName: names[i] || '', area: roomName[rooms[i]] || '', roomId: rooms[i] };
    return out;
  }

  async function loadReactBridge() {
    lastReactTry = Date.now();
    try {
      const res = await sendMsg({ type: 'mm:get-react' });
      if (res?.ok && res.data && Array.isArray(res.data.names)) {
        reactCache = res.data;
        clientLog('react.board', {
          objects: (res.data.names || []).filter(Boolean).length,
          areas: (res.data.roomLabels || []).length,
        });
        readBoardSafe();
        lastCount = boardCache.length;
        lastSnap = snapText();
        sendMsg({ type: 'mm:board-sync', puzzle: PUZZLE, title: document.title, board: boardCache, clues: clues() });
        return true;
      }
    } catch (e) {}
    return false;
  }

  function readBoard() {
    const byIdx = new Map();
    for (const el of document.querySelectorAll('[data-cell-index]')) {
      const i = +el.dataset.cellIndex;
      if (!byIdx.has(i) && el.offsetWidth) byIdx.set(i, el);
    }
    const n = byIdx.size || 100;
    const cols = Math.round(Math.sqrt(n)) || 9;
    const cells = [];
    const rdm = reactBoard();
    for (const [i, el] of byIdx) {
      const notes = [...el.querySelectorAll('.grid-note-letter')].map((x) => x.textContent.trim()).filter(Boolean);
      const text = el.innerText.trim();
      const big = !notes.length && text.length === 1 && /[A-Z]/.test(text) ? text : '';
      const imgs = [...el.querySelectorAll('img')];
      const x = imgs.some((im) => (im.getAttribute('src') || '').includes('87.7'));
      const objImgs = imgs.filter((im) => !(im.getAttribute('src') || '').includes('87.7'));
      const rc = rdm ? rdm[i] : null;
      let objName = objImgs.map((im) => {
        const alt = im.getAttribute('alt') || im.getAttribute('title') || '';
        if (alt) return alt;
        const src = im.getAttribute('src') || '';
        const m = src.match(/obj_([a-zA-Z0-9_]+?)(?:-[a-zA-Z0-9_]+)?\.svg/);
        return m ? m[1] : '';
      }).filter(Boolean).slice(0, 2).join('|');
      if (rc && rc.objName) objName = rc.objName;
      const obj = objImgs.length > 0 || !!objName;
      const inner = el.querySelector('[data-cell-index]') || el;
      let bg = '';
      try { bg = getComputedStyle(inner).backgroundColor || ''; } catch (e) {}
      const cls = String(inner.className || '').slice(0, 80);
      cells.push({ i, r: Math.floor(i / cols) + 1, c: (i % cols) + 1, big, notes, x, obj, objName, bg, area: rc?.area || '', roomId: rc?.roomId ?? null });
    }
    cells.sort((a, b) => a.i - b.i);
    boardCache = cells;
    return cells;
  }

  function readBoardSafe() {
    try { return readBoard(); }
    catch (e) { clientLog('read_error', { message: e.message }); return boardCache; }
  }


  function snapText() {
    return boardCache.map((c) => `${c.i}|${c.big}|${c.notes.join('')}|${c.x ? 1 : 0}`).join(';');
  }

  function diff() {
    const prev = new Map();
    for (const p of lastSnap.split(';').filter(Boolean)) {
      const [i, big, notes, x] = p.split('|');
      prev.set(+i, { big, notes, x: x === '1' });
    }
    const changed = [];
    for (const c of boardCache) {
      const p = prev.get(c.i);
      const now = { big: c.big, notes: c.notes.join(''), x: c.x };
      const hasNow = !!(c.big || c.notes.length || c.x);
      const hasBefore = !!(p && (p.big || p.notes || p.x));
      if (!hasNow && !hasBefore) continue;
      if (!p && !hasNow) continue;
      if (!p || p.big !== now.big || p.notes !== now.notes || p.x !== now.x) {
        const before = p ? { big: p.big || '', notes: p.notes ? p.notes.split('') : [], x: !!p.x } : null;
        const after = { big: c.big || '', notes: c.notes || [], x: !!c.x };
        changed.push({ r: c.r, c: c.c, text: c.big || c.notes.join('') || (c.x ? 'X' : ''), x: c.x, before, after });
      }
    }
    return changed;
  }

  function clues() {
    const parts = [document.title];
    const symBy = {};
    for (const x of (reactCache && reactCache.suspects) || []) symBy[x.name] = x.symbol;
    const btns = [...document.querySelectorAll('button[title]')];
    const isName = (t) => /^[\p{L}][\p{L}'-]+$/u.test(t) && t.length <= 24 && !/back|submit|hint|help|settings|close|puzzle/i.test(t);
    const seen = new Set();
    for (let i = 0; i < btns.length; i++) {
      const name = (btns[i].title || '').trim();
      if (!isName(name) || seen.has(name)) continue;
      for (let j = i + 1; j < btns.length; j++) {
        const clue = (btns[j].title || '').trim();
        if (isName(clue)) break;
        if (clue && clue.length > 2) {
          parts.push(`${symBy[name] ? symBy[name] + ' = ' : ''}${name}：${clue}`);
          seen.add(name);
          break;
        }
      }
    }
    return [...new Set(parts)].slice(0, 40).join('\n').slice(0, 4000);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


  function check() {
    if (!enabled) return;
    if (!reactCache && Date.now() - lastReactTry > 4000) loadReactBridge();
    try { readBoard(); }
    catch (e) {
      clientLog('read_error', { message: e.message });
      if (changesState) changesState.textContent = '读盘失败：' + e.message;
      return;
    }
    if (!boardCache.length) {
      if (changesState) changesState.textContent = '等待游戏盘面…';
      return;
    }
    if (lastCount && boardCache.length !== lastCount) {
      lastCount = boardCache.length;
      lastSnap = snapText();
      pendingChanges.clear();
      clearTimeout(flushTimer); flushTimer = 0; pendingSince = 0;
      return;
    }
    lastCount = boardCache.length;
    const now = snapText();
    if (now === lastSnap) return;
    const changed = diff();
    lastSnap = now;
    if (!changed.length || warmup) return;

    // 短窗口合并：同一格保留最初 before + 最后 after；空净改动丢弃
    for (const c of changed) {
      const key = `${c.r},${c.c}`;
      const prev = pendingChanges.get(key);
      if (prev) {
        prev.after = c.after;
        prev.text = c.text;
        prev.x = c.x;
      } else {
        pendingChanges.set(key, { ...c });
      }
    }
    if (!pendingSince) {
      pendingSince = Date.now();
      changesState.textContent = '检测到改动，合并中…';
      changesEl.classList.add('open');
      owl.classList.add('detected');
      setTimeout(() => owl.classList.remove('detected'), 1300);
    }
    clearTimeout(flushTimer);
    const wait = Date.now() - pendingSince > 2500 ? 0 : 1400;
    flushTimer = setTimeout(flushChanges, wait);
  }

  function sig(s) {
    return s ? `${s.big || ''}|${(s.notes || []).join('')}|${s.x ? 1 : 0}` : '∅';
  }

  function flushChanges() {
    flushTimer = 0;
    pendingSince = 0;
    const changed = [];
    for (const c of pendingChanges.values()) {
      if (sig(c.before) !== sig(c.after)) changed.push(c);
    }
    pendingChanges.clear();
    if (!changed.length) {
      changesState.textContent = '待机';
      return;
    }
    changed.sort((a, b) => (a.r - b.r) || (a.c - b.c));
    clientLog('batch', { cells: changed.length, sample: changed.slice(0, 4), notes: boardCache.filter((c) => c.notes.length).length });
    const allEmpty = changed.every((c) => c.after && !c.after.big && !(c.after.notes || []).length && !c.after.x);
    const remaining = boardCache.filter((c) => c.big || c.notes.length || c.x).length;
    const isReset = allEmpty && remaining === 0;
    addChangeBatch(changed, isReset ? 'reset' : 'sent');
    sendMsg({
      type: 'mm:board-changes', puzzle: PUZZLE, title: document.title,
      board: boardCache, changes: changed, clues: clues(),
    }).then((res) => {
      if (res?.queued) {
        changesState.textContent = '排队中（等上一问解决）';
        const i = changesBody.firstElementChild?.querySelector('i');
        if (i) i.textContent = '排队中';
      }
    });
    publishDebug();
  }

  observer = new MutationObserver(() => {
    if (window.__mmGen !== 1) return;
    clearTimeout(debounce);
    debounce = setTimeout(check, 700);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  window.__mmGen = 1;
  reconcile = setInterval(check, 5000);

  function cellEl(r, c) {
    const n = boardCache.length || 100;
    const cols = Math.round(Math.sqrt(n)) || 9;
    const i = (r - 1) * cols + (c - 1);
    return document.querySelector(`[data-cell-index="${i}"]`);
  }

  function showMarks(list) {
    marks = Array.isArray(list) ? list.slice(0, 30) : [];
    marksEl.innerHTML = '';
    if (!marks.length) { if (raf) clearInterval(raf); raf = 0; return; }
    for (const [i, m] of marks.entries()) {
      const box = document.createElement('div');
      box.className = 'mm-mark ' + (m.kind || 'ask');
      box.innerHTML = `<span class="mm-badge">${i + 1}</span><span class="mm-tag"></span>`;
      box.querySelector('.mm-tag').textContent = m.label || `R${m.r}C${m.c}`;
      marksEl.appendChild(box);
      m._el = box;
    }
    place();
    if (!raf) loop();
  }

  function place() {
    for (const m of marks) {
      const el = cellEl(m.r, m.c);
      if (!el || !m._el) continue;
      const b = el.getBoundingClientRect();
      m._el.style.left = b.x + 'px';
      m._el.style.top = b.y + 'px';
      m._el.style.width = b.width + 'px';
      m._el.style.height = b.height + 'px';
    }
  }

  function loop() {
    if (raf) return;
    raf = setInterval(place, 200);
  }

  function clearMarks() {
    marks = [];
    marksEl.innerHTML = '';
    if (raf) clearInterval(raf); raf = 0;
  }

  async function clearBoard() {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('清除所有格子'));
    if (!btn) return { ok: false, reason: 'button_not_found' };
    const opts = { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, buttons: 1 };
    btn.dispatchEvent(new PointerEvent('pointerdown', opts));
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
    await new Promise((r) => setTimeout(r, 1300));
    btn.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
    await new Promise((r) => setTimeout(r, 600));
    readBoard();
    const left0 = boardCache.filter((c) => c.big || c.notes.length || c.x).length;
    if (left0) { try { btn.click(); } catch (e) {} await new Promise((r) => setTimeout(r, 500)); }
    const remaining = boardCache.filter((c) => c.big || c.notes.length || c.x).length;
    clearMarks();
    clientLog('clear', { remaining });
    sendMsg({ type: 'mm:clear', puzzle: PUZZLE, remaining });
    return { ok: remaining === 0, remaining };
  }

  async function send() {
    if (!enabled) return;
    const t = ta.value.trim();
    if (!t) return;
    ta.value = '';
    if (t === '/reload') {
      addMsg('you', '/reload');
      sendMsg({ type: 'mm:reload-extension' });
      setTimeout(() => location.reload(), 900);
      return;
    }
    if (t === '/clear') {
      addMsg('you', '/clear');
      sendMsg({ type: 'mm:epoch-bump', puzzle: PUZZLE });
      owl.classList.add('wiping');
      const r = await clearBoard();
      owl.classList.remove('thinking');
      if (mascotEl) mascotEl.classList.remove('busy');
      setTimeout(() => owl.classList.remove('wiping'), 2400);
      addMsg('me', r.ok ? '已清空盘面：放置 / 笔记 / X 全部清除。' : `清空失败（剩余 ${r.remaining ?? '?'} 格）。`, true);
      return;
    }
    if (t === '/new' || t === '/new logs') {
      addMsg('you', t);
      sendMsg({ type: 'mm:epoch-bump', puzzle: PUZZLE });
      owl.classList.add('sleeping');
      if (mascotEl) mascotEl.classList.add('sleeping');
      const pending = sendMsg({
        type: 'mm:new-session', puzzle: PUZZLE, title: document.title,
        board: readBoardSafe(), clues: clues(), clearLogs: t === '/new logs',
      });
      await sleep(1700);
      owl.classList.remove('sleeping');
      owl.classList.remove('thinking');
      if (mascotEl) { mascotEl.classList.remove('sleeping'); mascotEl.classList.remove('busy'); }
      owl.classList.add('waking');
      setTimeout(() => owl.classList.remove('waking'), 1600);
      const r = await pending;
      if (r?.ok) {
        logEl.innerHTML = '';
        addMsg('me', '新会话已开始：聊天记录、账本和旧上下文已清空；盘面保留。' + (t === '/new logs' ? ' 日志也清空了。' : ''), true);
        setPending(0);
        lastCount = boardCache.length;
        lastSnap = snapText();
        showMarks([]);
        changeLog = [];
        try { chrome.storage.local.remove(CHANGES_KEY); } catch (e) {}
        renderChanges();
        mascotEl.classList.remove('busy');
        clientLog('new-session', { clearLogs: t === '/new logs' });
        publishDebug();
      } else {
        addMsg('me', '新会话失败：后台未响应。', true);
      }
      return;
    }
    addMsg('you', t, false, Date.now());
    if (owl) owl.classList.add('thinking');
    readBoard();
    sendMsg({
      type: 'mm:user-message', puzzle: PUZZLE, text: t, title: document.title,
      board: readBoardSafe(), changes: [], clues: clues(),
    });
  }

  root.querySelector('.mm-send').onclick = send;
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  root.querySelector('.mm-gear').onclick = () => sendMsg({ type: 'mm:open-options' });
  const minBtn = root.querySelector('.mm-min');
  minBtn.onclick = () => {
    sb.classList.toggle('min');
    const collapsed = sb.classList.contains('min');
    minBtn.textContent = collapsed ? '»' : '«';
    minBtn.title = collapsed ? '展开' : '收起';
    applyLayout();
  };
  root.querySelector('.mm-tab.t').onclick = async () => {
    setMode('tutor');
    await sendMsg({ type: 'mm:set-mode', mode: 'tutor' });
  };
  root.querySelector('.mm-tab.e').onclick = async () => {
    setMode('exam');
    await sendMsg({ type: 'mm:set-mode', mode: 'exam' });
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'mm:read-board') {
      const b = readBoardSafe();
      sendResponse({ ok: true, board: b, clues: clues(), title: document.title });
      return;
    }
    if (msg?.type === 'mm:pending') { setPending(msg.unresolved || 0); return; }
    if (msg?.type === 'mm:assistant') {
      if (owl) { owl.classList.remove('thinking'); owl.classList.add('happy'); setTimeout(() => owl.classList.remove('happy'), 650); }
      if (mascotEl) mascotEl.classList.remove('busy');
      if (changesState) changesState.textContent = '墨墨已回复';
      markChangesDone();
      clientLog('assistant', { length: msg.text?.length || 0, unresolved: msg.unresolved ?? null, system: !!msg.system });
      addMsg('me', msg.text, !!msg.system, msg.ts || Date.now(), msg.replyTo || null);
      publishDebug();
      showMarks(msg.marks || []);
      if (typeof msg.unresolved === 'number') setPending(msg.unresolved);
    }
  });

  sb.style.display = 'none';
  marksEl.style.display = 'none';
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.mm_enabled) applyEnabled(changes.mm_enabled.newValue !== false);
  });

  (async () => {
    await loadChanges();
    await loadReactBridge();
    setTimeout(loadReactBridge, 1500);
    setTimeout(loadReactBridge, 4000);
    try {
      const { mm_enabled = true } = await chrome.storage.local.get('mm_enabled');
      applyEnabled(mm_enabled !== false);
    } catch (e) {}
    try {
      const res = await sendMsg({ type: 'mm:hello', puzzle: PUZZLE, title: document.title, board: readBoardSafe(), clues: clues() });
      if (res?.ok) {
        setMode(res.mode || 'exam');
        setPending(res.ledger?.counts?.unresolved || 0);
        for (const m of res.chat || []) addMsg(m.role, m.text, false, m.ts || Date.now());
        if (!res.chat?.length) {
          const keyed = !!res.settings?.apiKey;
          addMsg('me', keyed
            ? '我是墨墨。考试模式下我只提问、不给答案；你动盘面，我会圈出有疑问的格。'
            : '我是墨墨。考试模式下我只提问、不给答案；先点 ⚙ 配置 API Key。', true);
        }
      } else {
        addMsg('me', '扩展后台没有响应；打开设置页检查。', true);
      }
    } catch (e) {
      addMsg('me', '初始化失败：' + e.message, true);
    }
    applyLayout();
    clientLog('init', { puzzle: PUZZLE, cells: boardCache.length });
    publishDebug();
    setInterval(publishDebug, 3000);
    window.addEventListener('resize', applyLayout);
    setTimeout(applyLayout, 800);
    readBoard();
    lastCount = boardCache.length;
    lastSnap = snapText();
    setTimeout(() => { readBoard(); lastCount = boardCache.length; lastSnap = snapText(); warmup = false; }, 3000);
  })();
})();
