const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

async function load() {
  const { mm_enabled = true } = await chrome.storage.local.get('mm_enabled');
  $('enabled').checked = mm_enabled !== false;
  $('enabledState').textContent = mm_enabled !== false ? '已启用' : '已关闭';
  let res = null; try { res = await send({ type: 'mm:get-settings' }); } catch (e) {}
  const key = res?.settings?.apiKey;
  $('key').textContent = key ? '已配置' : '未配置';
  $('key').className = key ? 'ok' : 'bad';
  $('mode').textContent = res?.mode === 'tutor' ? '教学' : '考试';
  let s = null; try { s = await send({ type: 'mm:stats' }); } catch (e) {}
  $('logs').textContent = s?.stats ? `${s.stats.total} 条` : (res ? '—' : '后台未运行');
}

$('openOptions').onclick = () => chrome.runtime.openOptionsPage();
$('reloadExt').onclick = () => chrome.runtime.reload();
$('openPuzzle').onclick = () => chrome.tabs.create({ url: 'https://murdoku.com/play/puzzle-the-panic-room-hard' });

$('enabled').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ mm_enabled: e.target.checked });
  $('enabledState').textContent = e.target.checked ? '已启用' : '已关闭';
});

load();
