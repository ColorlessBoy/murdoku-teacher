#!/usr/bin/env node
/**
 * 单页游戏 E2E 闭环检测：寻宝互动页（docs/contest/index.html，单文件离线版）
 *
 * 覆盖：加载与资源 / 桌面三栏与手机单栏 / 内嵌数据完整性（24 人物 + 全解 + 区域 + 不可占格）/
 *       署名 / 中英切换 / 笔记 / 放置 / 撤销 / 打叉 / 橡皮 / 缩放 / 提示弹窗 /
 *       **按内嵌全解走完整盘并通过 SUBMIT 判对** / 刷新持久化 / 控制台零报错。
 *
 * 用法：
 *   node scripts/e2e-contest.mjs
 *   node scripts/e2e-contest.mjs --url https://colorlessboy.github.io/murdoku-teacher/contest/
 *   node scripts/e2e-contest.mjs --chrome /path --json report.json --verbose
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const STORAGE_KEY = 'murdoku-treasure-hunt-v1'
const EXPECT_NAMES = ['Augustus', 'Bart', 'Cedric', 'Dudley', 'Eiko', 'Fleur', 'Griselda', 'Hyacinth', 'Isolde', 'Julius', 'Kathleen', 'Linus', 'Mortimer', 'Nehemiah', 'Orville', 'Pedro', 'Quincy', 'Rosalind', 'Seraphina', 'Ursula', 'Wilfred', 'Yanis', 'Zoe', 'Treasure']
const TREASURE = [4, 11]
const N = 24
const I = (r, c) => (r - 1) * N + c - 1
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
  if (VERBOSE) console.log((ok ? 'PASS' : 'FAIL') + ' · ' + name + (detail ? ' — ' + String(JSON.stringify(detail)).slice(0, 260) : ''))
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
    const ready = async (timeout = 25000) => {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        try {
          const ok = await evalJS(`(() => document.querySelectorAll('#grid .cell').length === 576 && document.querySelectorAll('#cards .card').length === 24)()`)
          if (ok) return true
        } catch { /* navigating */ }
        await sleep(200)
      }
      return false
    }
    const nav = async (url) => { await send('Page.navigate', { url }); return ready() }
    const state = () => evalJS(`JSON.stringify(JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null'))`).then((v) => JSON.parse(v || 'null'))
    const dialog = () => evalJS(`(() => { const d = document.getElementById('dialog'); return JSON.stringify({ open: d.open, title: document.getElementById('dialogTitle').textContent, body: document.getElementById('dialogBody').innerText }) })()`).then(JSON.parse)
    const closeDialog = () => evalJS(`document.getElementById('dialog').close()`)
    const selectCard = (k) => evalJS(`(() => {
      const p = document.querySelectorAll('#cards .portrait')[${k}]
      if (p.getAttribute('aria-pressed') === 'true') p.click()
      p.click()
    })()`)
    const longPress = (cellIndex) => evalJS(`new Promise((resolve) => {
      const el = document.querySelector('.cell[data-i="${cellIndex}"]')
      if (!el) return resolve(false)
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + 5, clientY: r.top + 5 }))
      setTimeout(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        setTimeout(() => resolve(true), 80)
      }, 430)
    })`)
    const shortClick = (cellIndex) => evalJS(`new Promise((resolve) => {
      const el = document.querySelector('.cell[data-i="${cellIndex}"]')
      if (!el) return resolve(false)
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + 5, clientY: r.top + 5 }))
      setTimeout(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        setTimeout(() => resolve(true), 80)
      }, 60)
    })`)
    const consoleErrors = () => {
      const errs = []
      for (const e of events) {
        if (e.method === 'Runtime.exceptionThrown') errs.push('EXCEPTION: ' + String(e.params.exceptionDetails?.text || '').slice(0, 160))
        if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
          const t = String(e.params.entry.text || '')
          if (/navigator\.vibrate|favicon/i.test(t)) continue
          errs.push('log: ' + t.slice(0, 160))
        }
        if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) errs.push('HTTP ' + e.params.response.status + ' ' + String(e.params.response.url || '').slice(0, 140))
      }
      return [...new Set(errs)]
    }

    // 0) 干净开局
    await nav(BASE_URL)
    await evalJS(`localStorage.removeItem(${JSON.stringify(STORAGE_KEY)}); location.reload()`)
    await ready()

    // 1) 加载与桌面三栏
    const basic = await evalJS(`(() => {
      const q = (s) => document.querySelectorAll(s)
      const left = document.getElementById('left').getBoundingClientRect()
      const field = document.getElementById('field').getBoundingClientRect()
      const tools = document.getElementById('tools').getBoundingClientRect()
      return JSON.stringify({
        title: document.title,
        cells: q('#grid .cell').length,
        cards: q('#cards .card').length,
        portraits: q('#cards .portrait').length,
        cell0: document.querySelector('.cell[data-i="0"]')?.title || '',
        threeCols: left.right <= field.left + 1 && field.right <= tools.left + 1,
        leftW: Math.round(left.width), fieldW: Math.round(field.width), toolsW: Math.round(tools.width),
        overflow: document.documentElement.scrollWidth - innerWidth,
        clock: document.getElementById('clock').textContent,
        submitDisabled: document.getElementById('submit').disabled,
      })
    })()`).then(JSON.parse)
    record('页面加载：标题 / 576 格 / 24 人物卡 / 计时器启动', /The Treasure Hunt/.test(basic.title) && basic.cells === 576 && basic.cards === 24 && basic.portraits === 24 && /\d+:\d\d/.test(basic.clock), basic)
    record('桌面布局：左线索栏 · 中棋盘 · 右工具列（比例接近原站）', basic.threeCols && Math.abs(basic.leftW - 495) <= 12 && basic.toolsW === 168 && basic.fieldW > 600 && Math.abs(basic.overflow) <= 2, basic)
    record('棋盘格标题正确（R1 · C1）且 SUBMIT 初始禁用', /^R1 · C1/.test(basic.cell0) && basic.submitDisabled === true, { cell0: basic.cell0 })

    // 2) 内嵌数据完整性
    const data = await evalJS(`(() => {
      const D = JSON.parse(document.getElementById('game-data').textContent)
      const C = D.cards, sz = 24, I = (r, c) => (r - 1) * sz + c - 1
      const blocked = new Set(D.blocked.map((p) => I(p[0], p[1])))
      const sols = C.map((c, k) => (k === 23 ? [4, 11] : D.solutions[0][c.n]))
      const idxs = sols.map((p) => I(p[0], p[1]))
      return JSON.stringify({
        names: C.map((c) => c.n),
        cardsOk: C.every((c) => c.en && c.zh && String(c.p || '').startsWith('data:image/png;base64,')),
        solutionsOk: C.slice(0, 23).every((c) => Array.isArray(D.solutions[0][c.n]) && D.solutions[0][c.n].length === 2),
        treasure: sols[23],
        unique: new Set(idxs).size,
        inBounds: idxs.every((i) => i >= 0 && i < 576),
        suspectConflicts: idxs.slice(0, 23).filter((i) => blocked.has(i)).length,
        treasureBlocked: blocked.has(idxs[23]) ? 1 : 0,
        areas: D.areas.length,
        areaRowLen: [...new Set(D.areas.map((r) => r.length))],
        blockedCount: D.blocked.length,
        boardImg: String(D.board || '').startsWith('data:image/png;base64,'),
        legendImg: String(D.legend || '').startsWith('data:image/png;base64,'),
      })
    })()`).then(JSON.parse)
    record('角色顺序与名称正确（24 张，含 Treasure）', JSON.stringify(data.names) === JSON.stringify(EXPECT_NAMES), data.names)
    record('卡面数据完整：英文 / 中文 / 头像 base64', data.cardsOk, null)
    record('全解数据完整：23 个位置 + 宝藏 R4C11、互不重复、嫌疑人不落在物件格', data.solutionsOk && JSON.stringify(data.treasure) === JSON.stringify(TREASURE) && data.unique === 24 && data.inBounds && data.suspectConflicts === 0, { treasure: data.treasure, unique: data.unique, suspectConflicts: data.suspectConflicts, treasureBlocked: data.treasureBlocked })
    record('区域 / 不可占格 / 棋盘图 / 图例数据齐全', data.areas === 24 && data.areaRowLen.length === 1 && data.areaRowLen[0] === 24 && data.blockedCount > 50 && data.boardImg && data.legendImg, { areas: data.areas, blocked: data.blockedCount })

    // 3) 署名 About
    const aboutInfo = await evalJS(`(() => { document.getElementById('about').click(); const d = document.getElementById('dialog'); const b = document.getElementById('dialogBody'); const out = { open: d.open, title: document.getElementById('dialogTitle').textContent, text: b.innerText, href: String(b.innerHTML).includes('murdoku.com/contest') }; document.getElementById('dialog').close(); out.closed = !d.open; return JSON.stringify(out) })()`).then(JSON.parse)
    record('About 署名：作者 / 美术 / 官方赛事页链接', aboutInfo.open && /Manuel Garand/.test(aboutInfo.text) && /Valentyna/.test(aboutInfo.text) && aboutInfo.href && aboutInfo.closed, aboutInfo.title)

    // 4) 中英切换
    const lang = await evalJS(`(() => {
      const out = {}
      const sel = document.getElementById('lang')
      const en = document.querySelector('#cards .clue')?.textContent || ''
      sel.value = 'zh'; sel.dispatchEvent(new Event('change'))
      const zh = document.querySelector('#cards .clue')?.textContent || ''
      out.en = en; out.zh = zh
      sel.value = 'en'; sel.dispatchEvent(new Event('change'))
      return JSON.stringify(out)
    })()`).then(JSON.parse)
    record('中英切换：线索卡显示中文 / 英文', /篝火/.test(lang.zh) && /fire/i.test(lang.en), lang)

    // 5) 笔记：点卡片选人 + 短点格子写笔记
    const note = await evalJS(`(() => {
      const D = JSON.parse(document.getElementById('game-data').textContent)
      const sz = 24, I = (r, c) => (r - 1) * sz + c - 1
      const blocked = new Set(D.blocked.map((p) => I(p[0], p[1])))
      let target = -1
      for (let i = 0; i < 576; i += 1) if (!blocked.has(i)) { target = i; break }
      document.querySelectorAll('#cards .portrait')[0].click()
      return new Promise((resolve) => {
        const el = document.querySelector('.cell[data-i="' + target + '"]')
        const r = el.getBoundingClientRect()
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + 5, clientY: r.top + 5 }))
        setTimeout(() => {
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
          setTimeout(() => {
            const st = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null')
            resolve(JSON.stringify({ target, notes: st ? st.s.notes : null, html: el.textContent.trim() }))
          }, 150)
        }, 60)
      })
    })()`).then(JSON.parse)
    record('笔记：短点格子写入首字母并保存', note.notes && Object.keys(note.notes).length >= 1 && /A/.test(note.html), note)

    // 6) 放置 + 撤销
    const place = await evalJS(`(() => {
      const D = JSON.parse(document.getElementById('game-data').textContent)
      const sz = 24, I = (r, c) => (r - 1) * sz + c - 1
      const p = D.solutions[0]['Augustus']
      const idx = I(p[0], p[1])
      const portrait = document.querySelectorAll('#cards .portrait')[0]
      if (portrait.getAttribute('aria-pressed') === 'true') portrait.click()
      portrait.click()
      return new Promise((resolve) => {
        const el = document.querySelector('.cell[data-i="' + idx + '"]')
        const r = el.getBoundingClientRect()
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + 5, clientY: r.top + 5 }))
        setTimeout(() => {
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
          setTimeout(() => {
            const st = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null')
            resolve(JSON.stringify({ idx, placed: st ? st.s.placed : null }))
          }, 150)
        }, 430)
      })
    })()`).then(JSON.parse)
    record('放置：长按格子放下人物（Augustus → R9C4）', place.placed && place.placed['0'] === place.idx, place)
    const undo = await evalJS(`(() => { document.getElementById('undo').click(); return new Promise((resolve) => setTimeout(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null'); resolve(JSON.stringify({ placed: st ? st.s.placed : null })) }, 200)) })()`).then(JSON.parse)
    record('撤销：撤掉刚放的人物', undo.placed && Object.keys(undo.placed).length === 0, undo)

    // 7) 打叉 + 橡皮
    const tools = await evalJS(`(() => {
      const D = JSON.parse(document.getElementById('game-data').textContent)
      const sz = 24, I = (r, c) => (r - 1) * sz + c - 1
      const blocked = new Set(D.blocked.map((p) => I(p[0], p[1])))
      let target = -1
      for (let i = 0; i < 576; i += 1) if (!blocked.has(i)) { target = i; break }
      document.getElementById('x').click()
      const el = document.querySelector('.cell[data-i="' + target + '"]')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: el.getBoundingClientRect().left + 5, clientY: el.getBoundingClientRect().top + 5 }))
      return new Promise((resolve) => {
        setTimeout(() => { window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); setTimeout(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null'); resolve(JSON.stringify({ target, marks: st ? st.s.marks : null, html: el.textContent.trim() })) }, 150) }, 60)
      })
    })()`).then(JSON.parse)
    record('打叉：X 工具在空格上打叉', tools.marks && Object.keys(tools.marks).length >= 1 && /×|✕|X/i.test(tools.html), tools)
    const eraseTest = await evalJS(`(() => {
      document.getElementById('undo').click()
      return new Promise((resolve) => setTimeout(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null'); resolve(JSON.stringify({ marks: st ? st.s.marks : null })) }, 200))
    })()`).then(JSON.parse)
    record('橡皮 / 撤销：清掉刚打的叉', eraseTest.marks && Object.keys(eraseTest.marks).length === 0, eraseTest)

    // 8) 缩放 + 提示
    const zoomInfo = await evalJS(`(() => {
      const out = {}
      out.fit0 = document.getElementById('fit').textContent
      document.getElementById('plus').click()
      out.afterPlus = document.getElementById('fit').textContent
      document.getElementById('fit').click()
      out.back = document.getElementById('fit').textContent
      return JSON.stringify(out)
    })()`).then(JSON.parse)
    record('缩放：＋ / 适应 百分比切换', zoomInfo.fit0 === '100%' && zoomInfo.afterPlus !== '100%' && zoomInfo.back === '100%', zoomInfo)
    const hintInfo = await evalJS(`(() => { document.getElementById('hint').click(); return JSON.stringify({ status: document.getElementById('status').textContent, suggest: document.querySelectorAll('#grid .cell.suggest').length, dialog: document.getElementById('dialog').open }) })()`).then(JSON.parse)
    record('提示：状态栏给出角色 + 高亮目标格（不弹窗）', /Try |试着/.test(hintInfo.status) && hintInfo.suggest >= 1 && hintInfo.dialog === false, hintInfo)

    // 9) 按内嵌全解走完整盘 → SUBMIT 判对
    const sols = data.treasure ? await evalJS(`(() => { const D = JSON.parse(document.getElementById('game-data').textContent); return JSON.stringify(D.cards.map((c, k) => (k === 23 ? [4, 11] : D.solutions[0][c.n]))) })()`).then(JSON.parse) : []
    record('全解坐标列表可读取（24 个）', sols.length === 24, null)
    for (let k = 0; k < 24; k += 1) {
      await selectCard(k)
      await longPress(I(sols[k][0], sols[k][1]))
    }
    const solved = await state()
    const submitState = await evalJS(`JSON.stringify({ disabled: document.getElementById('submit').disabled, text: document.getElementById('submit').textContent })`)
    record('完整盘：24 个位置全部放下、SUBMIT 可用', solved && Object.keys(solved.s.placed).length === 24 && JSON.parse(submitState).disabled === false, { placed: solved ? Object.keys(solved.s.placed).length : 0, submit: submitState })
    await evalJS(`document.getElementById('submit').click()`)
    await sleep(250)
    const win = await dialog()
    await closeDialog()
    const wonState = await state()
    record('SUBMIT 判对：找到宝藏 R4C11、won=true', win.open && /R4 · C11/.test(win.body) && /Treasure found|找到宝藏/.test(win.title) && wonState && wonState.s.won === true, { title: win.title, body: win.body.slice(0, 120) })

    // 10) 刷新持久化
    await send('Page.reload'); await ready()
    await sleep(300)
    const persisted = await evalJS(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null'); return JSON.stringify({ placed: st ? Object.keys(st.s.placed).length : 0, won: st ? st.s.won : false, submitText: document.getElementById('submit').textContent }) })()`).then(JSON.parse)
    record('刷新后：24 个位置与通关状态保留', persisted.placed === 24 && persisted.won === true, persisted)

    // 11) 手机端单栏
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await send('Page.reload'); await ready()
    await sleep(250)
    const mobile = await evalJS(`(() => {
      const game = getComputedStyle(document.getElementById('game'))
      const cards = getComputedStyle(document.getElementById('cards'))
      const board = document.getElementById('board').getBoundingClientRect()
      return JSON.stringify({
        cols: (game.gridTemplateColumns || '').trim().split(' ').filter(Boolean).length,
        cardCols: (cards.gridTemplateColumns || '').trim().split(' ').filter(Boolean).length,
        boardW: Math.round(board.width), boardH: Math.round(board.height),
        overflow: document.documentElement.scrollWidth - innerWidth,
        toolsVisible: document.getElementById('tools').getBoundingClientRect().height > 10,
      })
    })()`).then(JSON.parse)
    record('手机端：单栏布局、人物卡 4 列、棋盘与工具可见、无横向溢出', mobile.cols === 1 && mobile.cardCols === 4 && mobile.boardW > 100 && mobile.toolsVisible && Math.abs(mobile.overflow) <= 2, mobile)

    // 12) 控制台
    const errs = consoleErrors()
    record('无控制台报错 / 无 404', errs.length === 0, errs.slice(0, 5))

    await evalJS(`localStorage.removeItem(${JSON.stringify(STORAGE_KEY)})`)

    const failed = cases.filter((c) => !c.ok)
    const report = { url: BASE_URL, passed: cases.length - failed.length, failed: failed.length, cases }
    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2))
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
