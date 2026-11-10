const $ = (id) => document.getElementById(id);
const statusEl = $('status');
let lastLogs = [];

async function refreshLedger() {
  const res = await send({ type: 'mm:get-ledger' });
  const led = res?.ledger;
  if (!led) { $('ledger').textContent = '（还没有账本；打开盘面并动一格后生成）'; return; }
  $('ledgerStats').textContent = `批次 ${led.counts.batches} · 格子 ${led.counts.cellsTracked} · 未解决 ${led.counts.unresolved}`;
  const lines = [];
  lines.push('未解决：');
  for (const q of led.unresolved) {
    lines.push(`[${q.id}] ${q.status} 批次 ${q.batches.join(',')} 创建 ${new Date(q.createdAt).toLocaleString()}`);
    for (const c of q.cells.slice(0, 40)) {
      const b = c.before ? `${c.before.big || ''}${(c.before.notes || []).join('')}${c.before.x ? 'X' : ''}` || '空' : '空';
      const a = `${c.after.big || ''}${(c.after.notes || []).join('')}${c.after.x ? 'X' : ''}` || '空';
      lines.push(`  R${c.r}C${c.c}: ${b} → ${a}  [${c.source || '?'}]`);
    }
    if (q.answer) lines.push('  回答：' + q.answer);
  }
  lines.push('', '最近批次：');
  for (const b of led.recentBatches.slice(-6)) {
    lines.push(`batch ${b.id} ${new Date(b.ts).toLocaleTimeString()}  ${b.changes.map((c) => `R${c.r}C${c.c}:${c.before ? '?' : '空'}→${c.after.big || (c.after.notes || []).join('') || (c.after.x ? 'X' : '空')}`).join('  ')}`);
  }
  $('ledger').textContent = lines.join('\n');
}


function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = 'status ' + (ok === true ? 'ok' : ok === false ? 'bad' : '');
}

function updateEndpoint() {
  const base = ($('baseUrl').value || '').trim().replace(/\/+$/, '');
  const el = $('endpointPreview');
  if (!el) return;
  if (!base) { el.textContent = ''; return; }
  if (base.endsWith('/chat/completions')) { el.textContent = '⚠ Base 不要再带 /chat/completions，会拼成两遍'; return; }
  el.textContent = '实际请求：' + base + '/chat/completions';
}

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function load() {
  const res = await send({ type: 'mm:get-settings' });
  const s = res?.settings || {};
  $('baseUrl').value = s.baseUrl || '';
  $('model').value = s.model || '';
  $('temperature').value = s.temperature ?? 0.3;
  $('maxTokens').value = s.maxTokens ?? 700;
  $('apiKey').value = '';
  $('apiKey').placeholder = s.apiKey ? '已保存；留空不修改' : '粘贴 API Key';
  updateEndpoint();
}

async function save() {
  const settings = {
    baseUrl: $('baseUrl').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    temperature: Number($('temperature').value),
    maxTokens: Number($('maxTokens').value),
  };
  const res = await send({ type: 'mm:save-settings', settings });
  if (res?.ok) {
    setStatus('已保存', true);
    $('apiKey').value = '';
    $('apiKey').placeholder = '已保存；留空不修改';
    await refreshLogs();
  } else {
    setStatus('保存失败：' + (res?.error || '未知'), false);
  }
}

async function test() {
  setStatus('测试中…');
  const res = await send({ type: 'mm:test-llm' });
  if (res?.ok) setStatus('连接正常：' + (res.text || '').slice(0, 40), true);
  else setStatus('失败：' + (res?.message || res?.code || '未知') + (res?.detail ? ' · ' + String(res.detail).slice(0, 240) : ''), false);
  await refreshLogs();
}

function renderLogs(logs) {
  const box = $('logs');
  box.innerHTML = '';
  if (!logs.length) { box.textContent = '（暂无日志）'; return; }
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>时间</th><th>级别</th><th>关卡</th><th>事件</th><th>数据</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const l of logs.slice().reverse()) {
    const tr = document.createElement('tr');
    const ts = document.createElement('td'); ts.textContent = (l.ts || '').replace('T', ' ').slice(0, 19);
    const lv = document.createElement('td'); lv.textContent = l.level; lv.className = 'lvl-' + l.level;
    const pz = document.createElement('td'); pz.textContent = l.data?.puzzle || '—';
    const ev = document.createElement('td'); ev.textContent = l.event;
    const da = document.createElement('td'); da.className = 'data';
    da.textContent = JSON.stringify(l.data ?? {});
    tr.append(ts, lv, pz, ev, da);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  box.appendChild(table);
}

async function refreshLogs() {
  const level = $('level').value;
  const res = await send({ type: 'mm:get-logs', level, limit: 1500 });
  const pf = ($('puzzleFilter')?.value || '').trim().toLowerCase();
  lastLogs = (res?.logs || []).filter((l) => !pf || String(l.data?.puzzle || '').toLowerCase().includes(pf));
  renderLogs(lastLogs);
  const s = await send({ type: 'mm:stats' });
  if (s?.stats) {
    const parts = Object.entries(s.stats.byLevel || {}).map(([k, v]) => `${k}:${v}`).join(' · ');
    $('stats').textContent = `共 ${s.stats.total} 条 · ${parts} · session ${s.stats.session}`;
  }
}

async function download() {
  const res = await send({ type: 'mm:get-logs', level: 'all', limit: 4000 });
  const logs = res?.logs || [];
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `murdoku-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function clearLogs() {
  if (!confirm('清空全部日志？')) return;
  await send({ type: 'mm:clear-logs' });
  await refreshLogs();
}

$('baseUrl').addEventListener('input', updateEndpoint);
$('save').onclick = save;
$('test').onclick = test;
$('refresh').onclick = refreshLogs;
$('level').onchange = refreshLogs;
$('puzzleFilter').addEventListener('input', refreshLogs);
$('download').onclick = download;
$('reloadExt').onclick = () => chrome.runtime.reload();
$('clearLogs').onclick = clearLogs;
$('ledgerRefresh').onclick = refreshLedger;
$('ledgerClose').onclick = async () => { await send({ type: 'mm:close-ledger' }); await refreshLedger(); };
$('ledgerClear').onclick = async () => { if (confirm('清空本关账本？不可恢复')) { await send({ type: 'mm:clear-ledger' }); await refreshLedger(); } };

load().then(() => { refreshLogs(); refreshLedger(); });
