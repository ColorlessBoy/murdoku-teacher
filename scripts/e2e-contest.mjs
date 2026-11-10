#!/usr/bin/env node
/**
 * 单页游戏 E2E 闭环检测：寻宝互动页（docs/contest/index.html）
 *
 * 覆盖：加载与资源 / 三栏排版 / 覆盖层几何 / 线索逐字一致与中英同显 / 人物头像 /
 *       笔记·叉·橡皮·撤销·重做·隐藏·缩放·操作记录 / 刷新持久化 / 判对四档反馈 /
 *       提示阶梯记忆 / 清空 / 手机端吸顶棋盘与密集人物卡 / 控制台零报错。
 *
 * 用法：
 *   node scripts/e2e-contest.mjs                 # 自带静态服务器测 docs/contest
 *   node scripts/e2e-contest.mjs --url https://colorlessboy.github.io/murdoku-teacher/contest/
 *   node scripts/e2e-contest.mjs --chrome /path --json report.json
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'

if (typeof WebSocket === 'undefined') {
  console.error('需要 Node.js ≥ 22（全局 WebSocket）。当前版本: ' + process.version)
  process.exit(1)
}
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback }
const SERVE_DIR = arg('serve', 'docs')
const PORT = Number(arg('port', '4173'))
const JSON_OUT = arg('json', '')
const VERBOSE = argv.includes('--verbose')
let BASE_URL = arg('url', '')

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.css': 'text/css' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let server = null
async function startServer() {
  if (BASE_URL) return
  server = createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0])
    if (p.endsWith('/')) p += 'index.html'
    try {
      const body = readFileSync(join(SERVE_DIR, p))
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch { res.writeHead(404).end('not found') }
  })
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  BASE_URL = `http://127.0.0.1:${PORT}/contest/`
}

function findChrome() {
  const explicit = arg('chrome', process.env.CHROME_PATH || '')
  if (explicit) return explicit
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ]
  for (const c of candidates) if (existsSync(c)) return c
  const home = process.env.HOME || ''
  for (const v of ['chromium-1217', 'chromium-1208', 'chromium-1200']) {
    for (const arch of ['chrome-mac-arm64', 'chrome-mac-x64']) {
      const app = join(home, 'Library/Caches/ms-playwright', v, arch, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
      if (existsSync(app)) return app
    }
  }
  return ''
}

async function connect(port) {
  let target = null
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(250)
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page') } catch { /* retry */ }
  }
  if (!target) throw new Error('无法连接 Chrome DevTools（端口 ' + port + '）')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error))); else resolve(msg.result)
      return
    }
    events.push(msg)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params }))
  })
  return { ws, send, events }
}

const cases = []
const record = (name, ok, detail) => {
  cases.push({ name, ok: !!ok, detail: detail === undefined ? null : detail })
  if (VERBOSE) console.log((ok ? 'PASS' : 'FAIL') + ' · ' + name + (detail ? ' — ' + String(JSON.stringify(detail)).slice(0, 220) : ''))
}

const KEYS = ['mrdc1_marks_v1', 'mrdc1_marks_v1_saved', 'mrdc1_answer_v1', 'mrdc1_tries_v1', 'mrdc1_hint_v1', 'mrdc1_log_v1']
const EXPECT_NAMES = ['Augustus', 'Bart', 'Cedric', 'Dudley', 'Eiko', 'Fleur', 'Griselda', 'Hyacinth', 'Isolde', 'Julius', 'Kathleen', 'Linus', 'Mortimer', 'Nehemiah', 'Orville', 'Pedro', 'Quincy', 'Rosalind', 'Seraphina', 'Ursula', 'Wilfred', 'Yannis', 'Zoe', 'Treasure']
const EXPECT_CLUE_FRAGMENTS = {
  Cedric: 'Someone exactly eight rows north of him was beside the tombstone.',
  Isolde: 'She was siting in a chair. She was in a Cabin with someone wearing an eyepatch.',
  Mortimer: 'He was on a ship, beside some rope.',
  Nehemiah: 'He was in the Water, beside a ship.',
  Orville: 'He was on a ship.',
  Zoe: 'She was beside a shrub.',
  Treasure: 'In the last square. It can be buried beneath an object that cannot otherwise be occupied.',
}

async function main() {
  await startServer()
  const chrome = findChrome()
  if (!chrome) throw new Error('未找到 Chrome（可用 --chrome 指定）')
  const devtoolsPort = 9500 + Math.floor(Math.random() * 300)
  const profile = mkdtempSync(join(tmpdir(), 'e2e-contest-'))
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--hide-scrollbars', `--remote-debugging-port=${devtoolsPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  let cdp = null
  try {
    cdp = await connect(devtoolsPort)
    const { send, events } = cdp
    await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })

    const evalJS = async (expression) => {
      const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (res.exceptionDetails) throw new Error('页面脚本异常: ' + (res.exceptionDetails.text || '') + ' ' + (res.exceptionDetails.exception?.description || ''))
      return res.result?.value
    }
    const ready = async (timeout = 20000) => {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        try {
          const ok = await evalJS(`(() => {
            const img = document.getElementById('boardimg')
            return document.querySelectorAll('.cell').length === 576 &&
              document.querySelectorAll('.char-card').length === 24 &&
              !!img && img.complete && img.naturalWidth > 0
          })()`)
          if (ok) return true
        } catch { /* navigating */ }
        await sleep(200)
      }
      return false
    }
    const nav = async (url) => { await send('Page.navigate', { url }); return ready() }
    const consoleErrors = () => {
      const errs = []
      for (const e of events) {
        if (e.method === 'Runtime.exceptionThrown') errs.push('EXCEPTION: ' + String(e.params.exceptionDetails?.text || '').slice(0, 160))
        if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errs.push('log: ' + String(e.params.entry.text || '').slice(0, 160))
        if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) errs.push('HTTP ' + e.params.response.status + ' ' + String(e.params.response.url || '').slice(0, 140))
      }
      return [...new Set(errs)]
    }

    // 1) 加载 + 基础资源 + 三栏
    const loaded = await nav(BASE_URL)
    record('页面加载完成（576 格 / 24 人物卡就绪）', loaded, loaded ? null : '等待 DOM 就绪超时')
    await evalJS(`[${KEYS.map((k) => JSON.stringify(k)).join(',')}].forEach((k) => localStorage.removeItem(k))`)

    const basic = await evalJS(`(() => {
      const img = document.getElementById('boardimg')
      const left = document.querySelector('.left-panel').getBoundingClientRect()
      const center = document.querySelector('.center').getBoundingClientRect()
      const right = document.querySelector('.right-panel').getBoundingClientRect()
      return JSON.stringify({
        cells: document.querySelectorAll('.cell').length,
        cards: document.querySelectorAll('.char-card').length,
        avatars: document.querySelectorAll('.char-card .avatar').length,
        avatarLoaded: [...document.querySelectorAll('.char-card .avatar')].filter((i) => i.complete && i.naturalWidth > 0).length,
        img: img ? [img.naturalWidth, img.naturalHeight] : null,
        threeCols: left.right <= center.left + 1 && center.right <= right.left + 1,
        centerWidth: Math.round(center.width),
        credit: (document.querySelector('.credit')?.innerText || ''),
        howto: (() => { const d = document.querySelector('.howto'); if (!d) return ''; d.open = true; return d.innerText })(),
        hasChips: !!document.querySelector('.chips'),
        hasLangToggle: !!document.getElementById('lang-toggle'),
        boardWidth: Math.round(img.getBoundingClientRect().width),
      })
    })()`).then(JSON.parse)
    record('棋盘 / 人物卡 / 头像数量正确（576 格 · 24 卡 · 24 头像加载）', basic.cells === 576 && basic.cards === 24 && basic.avatars === 24 && basic.avatarLoaded === 24, { cells: basic.cells, cards: basic.cards, loaded: basic.avatarLoaded })
    record('桌面三栏排版：人物左 · 棋盘中 · 动作右，棋盘尽量大', basic.threeCols && basic.centerWidth > 520 && basic.boardWidth > 480, { threeCols: basic.threeCols, centerWidth: basic.centerWidth, boardWidth: basic.boardWidth })
    record('棋盘图加载正确（1542×1473）', basic.img && basic.img[0] === 1542 && basic.img[1] === 1473, basic.img)
    record('来源署名完整（作者 / 美术 / 非官方）', /Manuel Garand/.test(basic.credit) && /Valentyna/.test(basic.credit) && /非官方/.test(basic.credit), null)
    record('规则区含原题要点（最后一格 / 可占用）', /最后一格/.test(basic.howto) && /可占用/.test(basic.howto), null)
    record('已移除棋盘上方人名按钮与中英切换按钮', !basic.hasChips && !basic.hasLangToggle, { hasChips: basic.hasChips, hasLangToggle: basic.hasLangToggle })

    // 2) 覆盖层几何对齐
    const geom = await evalJS(`(() => {
      const cells = [...document.querySelectorAll('.cell')]
      const img = document.getElementById('boardimg')
      const ir = img.getBoundingClientRect()
      const expX = ir.left + ir.width * ((52.8 - 28) * 3.472 / 1542)
      const expY = ir.top + ir.height * ((29.5 - 22) * 3.472 / 1473)
      const cw = ir.width * (16.7458 * 3.472 / 1542)
      const ch = ir.height * (16.7458 * 3.472 / 1473)
      const delta = (r, c) => { const b = cells[r * 24 + c].getBoundingClientRect(); return [Math.round((b.left - (expX + c * cw)) * 100) / 100, Math.round((b.top - (expY + r * ch)) * 100) / 100] }
      return JSON.stringify({ p00: delta(0,0), pLast: delta(23,23), pTarget: delta(3,10) })
    })()`).then(JSON.parse)
    const maxDelta = Math.max(...[geom.p00, geom.pLast, geom.pTarget].flat().map(Math.abs))
    record('24×24 覆盖层与棋盘图对齐（误差 ≤1px）', maxDelta <= 1, { maxDelta })

    // 3) 线索数据（从 clues.json 校验逐字 + 翻译 + 头像）
    const clueData = await evalJS(`fetch('clues.json?t=' + Date.now()).then((r) => r.json()).then((rows) => JSON.stringify(rows))`).then(JSON.parse)
    const namesOk = JSON.stringify(clueData.map((c) => c.name)) === JSON.stringify(EXPECT_NAMES)
    record('24 名角色顺序与 PDF 一致', namesOk, namesOk ? null : clueData.map((c) => c.name).join(','))
    const clueOk = Object.entries(EXPECT_CLUE_FRAGMENTS).every(([name, frag]) => clueData.some((c) => c.name === name && c.clue === frag))
    record('关键线索与 PDF 原文逐字一致（含 siting 原拼写）', clueOk, null)
    record('中文线索：24 条全部有中文翻译', clueData.every((c) => c.clue_zh && c.clue_zh.trim().length > 0) && clueData.length === 24, null)
    record('线索头像字段齐全（24 个 portraits/*.png）', clueData.every((c) => /^portraits\/.+\.png$/.test(c.img || '')) && clueData.length === 24, null)

    // 4) 选中人物：中英同显 + 字号清晰
    const sel = await evalJS(`(() => {
      const out = {}
      document.querySelector('.char-card[data-name="Cedric"]').click()
      out.name = document.getElementById('sel-name').textContent
      out.zh = document.getElementById('sel-zh').textContent
      out.en = document.getElementById('sel-en').textContent
      out.zhFont = parseFloat(getComputedStyle(document.getElementById('sel-zh')).fontSize)
      out.enFont = parseFloat(getComputedStyle(document.getElementById('sel-en')).fontSize)
      out.enColor = getComputedStyle(document.getElementById('sel-en')).color
      out.avatar = document.getElementById('sel-avatar').getAttribute('src')
      out.selectedCard = !!document.querySelector('.char-card[data-name="Cedric"].on')
      return JSON.stringify(out)
    })()`).then(JSON.parse)
    record('选中人物：中文 + 英文同时显示（不切换）', sel.name === 'Cedric' && /墓碑/.test(sel.zh) && /tombstone/.test(sel.en) && /portraits\/cedric/.test(sel.avatar) && sel.selectedCard, sel)
    record('英文可读性：字号 ≥12px、颜色非浅灰', sel.enFont >= 12 && !/rgba\(60, 42, 16, 0\.[0-5]/.test(sel.enColor), { enFont: sel.enFont, enColor: sel.enColor })

    // 5) 标记闭环：笔记 / 撤销 / 重做 / 打叉 / 橡皮
    const mark = await evalJS(`(() => {
      const out = {}
      const cells = [...document.querySelectorAll('.cell')]
      document.querySelector('.char-card[data-name="Cedric"]').click()
      cells[82].click()   // R4C11
      out.note = (JSON.parse(localStorage.getItem('mrdc1_marks_v1') || '{}')['82'] || {}).notes || null
      out.letter = (cells[82].textContent || '').trim()
      document.getElementById('undo').click()
      out.afterUndo = JSON.parse(localStorage.getItem('mrdc1_marks_v1') || '{}')['82'] || null
      document.getElementById('redo').click()
      out.afterRedo = (JSON.parse(localStorage.getItem('mrdc1_marks_v1') || '{}')['82'] || {}).notes || null
      document.getElementById('mode-x').click()
      cells[0].click()
      out.xAt0 = (JSON.parse(localStorage.getItem('mrdc1_marks_v1') || '{}')['0'] || {}).x || false
      document.getElementById('mode-erase').click()
      cells[0].click()
      out.afterErase = JSON.parse(localStorage.getItem('mrdc1_marks_v1') || '{}')['0'] || null
      document.getElementById('mode-erase').click()
      cells[82].click()   // 清掉 R4C11，保持后续测试干净
      document.getElementById('mode-note').click()
      out.afterCleanup = JSON.parse(localStorage.getItem('mrdc1_marks_v1') || '{}')['82'] || null
      return JSON.stringify(out)
    })()`).then(JSON.parse)
    record('笔记：点格子写入并显示首字母', mark.note && mark.note[0] === 'Cedric' && mark.letter === 'C', mark)
    record('撤销 / 重做：恢复与重做一致', mark.afterUndo === null && mark.afterRedo && mark.afterRedo[0] === 'Cedric' && mark.afterCleanup === null, mark)
    record('打叉 / 橡皮模式生效', mark.xAt0 === true && mark.afterErase === null, mark)

    // 6) 隐藏 / 记录 / 缩放
    const hideTest = await evalJS(`(() => {
      const cellAt = (i) => document.querySelectorAll('.cell')[i]
      document.querySelector('.char-card[data-name="Augustus"]').click()
      cellAt(5).click()
      const shown = (cellAt(5).textContent || '').trim()
      document.getElementById('toggle-hide').click()
      const hidden = (cellAt(5).textContent || '').trim()
      document.getElementById('toggle-hide').click()
      const reshown = (cellAt(5).textContent || '').trim()
      return JSON.stringify({ shown, hidden, reshown })
    })()`).then(JSON.parse)
    record('隐藏 / 显示标记切换', hideTest.shown === 'A' && hideTest.hidden === '' && hideTest.reshown === 'A', hideTest)

    const logTest = await evalJS(`(() => {
      const out = {}
      document.getElementById('log-btn').click()
      out.open = document.getElementById('log-modal').classList.contains('on')
      out.count = document.querySelectorAll('.log-item').length
      out.text = document.getElementById('log-list').innerText
      const first = document.querySelector('.log-item')
      if (first) first.click()
      out.closed = !document.getElementById('log-modal').classList.contains('on')
      return JSON.stringify(out)
    })()`).then(JSON.parse)
    record('操作记录：可打开、有条目、点条目定位并关闭', logTest.open && logTest.count > 0 && /笔记|撤销|重做/.test(logTest.text) && logTest.closed, { count: logTest.count })

    await sleep(350)
    const zoomTest = await evalJS(`(() => {
      const out = {}
      const plate = document.getElementById('board-plate')
      const wrap = document.getElementById('board-wrap')
      out.label0 = document.getElementById('zoom-level').textContent
      out.width0 = Math.round(plate.getBoundingClientRect().width)
      out.availW = Math.round(wrap.clientWidth - 24)
      out.availH = Math.round(wrap.clientHeight - 24)
      out.imgHeight = Math.round(document.getElementById('boardimg').getBoundingClientRect().height)
      out.fits = out.imgHeight <= out.availH + 2 && out.width0 <= out.availW + 2
      document.getElementById('zoom-in').click()
      out.labelIn = document.getElementById('zoom-level').textContent
      out.widthIn = Math.round(plate.getBoundingClientRect().width)
      for (let i = 0; i < 25; i += 1) document.getElementById('zoom-out').click()
      out.labelMin = document.getElementById('zoom-level').textContent
      out.widthMin = Math.round(plate.getBoundingClientRect().width)
      out.minDisabled = document.getElementById('zoom-out').disabled
      document.getElementById('zoom-fit').click()
      out.labelFit = document.getElementById('zoom-level').textContent
      out.widthFit = Math.round(plate.getBoundingClientRect().width)
      return JSON.stringify(out)
    })()`).then(JSON.parse)
    record('棋盘默认「适应窗口」：整盘可见、居中尽量大', zoomTest.label0 === '适应' && zoomTest.fits, zoomTest)
    record('缩放可放大 / 缩小（下限 30%）并可一键恢复适应', zoomTest.widthIn > zoomTest.width0 && /%/.test(zoomTest.labelIn) && /30%/.test(zoomTest.labelMin) && zoomTest.widthMin < zoomTest.width0 && zoomTest.minDisabled && zoomTest.labelFit === '适应' && Math.abs(zoomTest.widthFit - zoomTest.width0) <= 2, zoomTest)

    // 7) 刷新持久化
    const before = await evalJS(`JSON.stringify({ marks: localStorage.getItem('mrdc1_marks_v1'), log: localStorage.getItem('mrdc1_log_v1') })`).then(JSON.parse)
    await evalJS(`localStorage.setItem('mrdc1_tries_v1', '2')`)
    await send('Page.reload'); await ready()
    const after = await evalJS(`JSON.stringify({
      marks: localStorage.getItem('mrdc1_marks_v1'),
      log: localStorage.getItem('mrdc1_log_v1'),
      tries: localStorage.getItem('mrdc1_tries_v1'),
      saved: document.getElementById('save-state')?.textContent || '',
      cell5: (document.querySelectorAll('.cell')[5].textContent || '').trim(),
    })`).then(JSON.parse)
    record('刷新后笔记 / 记录 / 尝试次数保留', after.marks === before.marks && after.log === before.log && after.tries === '2' && after.cell5 === 'A', { cell5: after.cell5, tries: after.tries })

    // 8) 判对四档 + 提示阶梯
    const answer = await evalJS(`(() => {
      const out = {}
      const set = (r, c) => { document.getElementById('ans-row').value = r; document.getElementById('ans-col').value = c }
      const check = () => { document.getElementById('ans-check').click(); return document.getElementById('ans-result').textContent }
      set('', ''); out.empty = check()
      set('1', '1'); out.wrong = check()
      set('4', '20'); out.rowRight = check()
      set('5', '10'); out.near = check()
      set('4', '11'); out.right = check()
      return JSON.stringify(out)
    })()`).then(JSON.parse)
    record('判对：非法输入被拦下并提示', /请输入/.test(answer.empty), answer.empty)
    record('判对：错误 / 行对 / 接近三档有区分度', /不对/.test(answer.wrong) && /行已经对了/.test(answer.rowRight) && /非常接近/.test(answer.near), answer)
    record('判对：正确给出 R4 C11 且带提交入口', /R4 C11/.test(answer.right) && /murdoku\.com\/contest/.test(answer.right), answer.right)

    const hint = await evalJS(`(() => {
      localStorage.removeItem('mrdc1_hint_v1')
      document.getElementById('ans-hint').click()
      const h1 = document.getElementById('hintbox').textContent
      document.getElementById('ans-hint').click()
      const h2 = document.getElementById('hintbox').textContent
      return JSON.stringify({ h1, h2, level: localStorage.getItem('mrdc1_hint_v1') })
    })()`).then(JSON.parse)
    record('提示阶梯：逐级推进且记住进度', /提示 1 \/ 6/.test(hint.h1) && /提示 2 \/ 6/.test(hint.h2) && hint.level === '2', hint)
    await send('Page.reload'); await ready()
    const hintAfterReload = await evalJS(`JSON.stringify({ box: document.getElementById('hintbox').textContent, level: localStorage.getItem('mrdc1_hint_v1') })`).then(JSON.parse)
    record('刷新后提示进度保留', /已解锁 2/.test(hintAfterReload.box) && hintAfterReload.level === '2', hintAfterReload)

    // 9) 清空
    const reset = await evalJS(`(() => {
      window.confirm = () => true
      document.getElementById('reset').click()
      return JSON.stringify({ marks: localStorage.getItem('mrdc1_marks_v1'), cell5: (document.querySelectorAll('.cell')[5].textContent || '').trim(), log: JSON.parse(localStorage.getItem('mrdc1_log_v1') || '[]').length })
    })()`).then(JSON.parse)
    record('清空：标记全部移除、记录只留 reset', reset.marks === '{}' && reset.cell5 === '' && reset.log === 1, reset)

    // 10) 手机端：棋盘吸顶 + 密集人物卡 + 英文线索
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await send('Page.reload'); await ready()
    const mobile = await evalJS(`(() => {
      const out = {}
      const center = document.querySelector('.center')
      const centerCS = getComputedStyle(center)
      const cardGrid = document.getElementById('char-grid')
      const cardGridCS = getComputedStyle(cardGrid)
      const imgs = [...document.querySelectorAll('.char-card .avatar')]
      out.centerPosition = centerCS.position
      out.cardGridCols = (cardGridCS.gridTemplateColumns || '').trim().split(' ').filter(Boolean).length
      out.cardCount = document.querySelectorAll('.char-card').length
      out.avatarLoaded = imgs.filter((i) => i.complete && i.naturalWidth > 0).length
      const img = document.getElementById('boardimg').getBoundingClientRect()
      out.boardWidth = Math.round(img.width)
      out.boardVisible = img.top >= -1 && img.width > 0
      out.overflow = document.documentElement.scrollWidth - innerWidth
      document.querySelector('.char-card[data-name="Treasure"]').click()
      out.zh = document.getElementById('sel-zh').textContent
      out.en = document.getElementById('sel-en').textContent
      // 滚动后棋盘应仍在屏幕内（吸顶）
      window.scrollTo(0, Math.round(center.offsetHeight + 260))
      const img2 = document.getElementById('boardimg').getBoundingClientRect()
      out.stickyTop = Math.round(img2.top)
      out.stickyVisible = img2.top >= -2 && img2.top < innerHeight * 0.7
      out.inputSize = (() => { const r = document.getElementById('ans-row').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })()
      return JSON.stringify(out)
    })()`).then(JSON.parse)
    record('手机端：棋盘吸顶始终可见、无横向溢出', mobile.centerPosition === 'sticky' && mobile.boardVisible && mobile.stickyVisible && Math.abs(mobile.overflow) <= 2, mobile)
    record('手机端：人物卡密集网格（4 列以上）', mobile.cardCount === 24 && mobile.cardGridCols >= 4, { cols: mobile.cardGridCols, cards: mobile.cardCount })
    record('手机端：24 头像加载 + 中英线索同显', mobile.avatarLoaded === 24 && /最后一格/.test(mobile.zh) && mobile.en.length > 10, { loaded: mobile.avatarLoaded })
    record('手机端：答案输入框触控尺寸足够', mobile.inputSize[1] >= 36 && mobile.inputSize[0] >= 60, mobile.inputSize)

    // 11) 桌面恢复
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
    await send('Page.reload'); await ready()
    const desktop = await evalJS(`JSON.stringify((() => {
      const left = document.querySelector('.left-panel').getBoundingClientRect()
      const center = document.querySelector('.center').getBoundingClientRect()
      const right = document.querySelector('.right-panel').getBoundingClientRect()
      const avatars = [...document.querySelectorAll('.char-card .avatar')]
      return {
        threeCols: left.right <= center.left + 1 && center.right <= right.left + 1,
        centerWidth: Math.round(center.width),
        avatarLoaded: avatars.filter((i) => i.complete && i.naturalWidth > 0).length,
        overflow: document.documentElement.scrollWidth - innerWidth,
      }
    })())`).then(JSON.parse)
    record('切回桌面：三栏同屏、棋盘居中尽量大、无横向溢出', desktop.threeCols && desktop.centerWidth > 520 && desktop.avatarLoaded === 24 && Math.abs(desktop.overflow) <= 2, desktop)

    // 12) 控制台与网络
    const errs = consoleErrors()
    record('无控制台报错 / 无 404', errs.length === 0, errs.slice(0, 5))

    await evalJS(`[${KEYS.map((k) => JSON.stringify(k)).join(',')}].forEach((k) => localStorage.removeItem(k))`)

    const failed = cases.filter((c) => !c.ok)
    const report = { url: BASE_URL, passed: cases.length - failed.length, failed: failed.length, cases }
    if (JSON_OUT) await import('node:fs').then((fs) => fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2)))
    console.log(JSON.stringify({ url: report.url, passed: report.passed, failed: report.failed, failures: failed.map((f) => ({ name: f.name, detail: f.detail })) }, null, 2))
    if (failed.length > 0) process.exitCode = 1
  } finally {
    try { cdp?.ws.close() } catch { /* ignore */ }
    try { proc.kill('SIGKILL') } catch { /* ignore */ }
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
    if (server) await new Promise((resolve) => server.close(resolve))
  }
}

main().catch((error) => { console.error('E2E 运行失败:', error.message); process.exit(1) })
