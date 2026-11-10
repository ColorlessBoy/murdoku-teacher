#!/usr/bin/env node
/**
 * 单页游戏 E2E 闭环检测：寻宝互动页（docs/contest/index.html）
 *
 * 覆盖：加载与资源 / 覆盖层几何对齐 / 线索完整性 / 笔记·叉·橡皮·撤销·隐藏·缩放 /
 *       刷新持久化 / 答案判对（非法、错、行对、接近、正确）/ 提示阶梯与记忆 /
 *       清空 / 控制台零报错。
 *
 * 用法：
 *   node scripts/e2e-contest.mjs                        # 自带静态服务器，测 docs/contest/
 *   node scripts/e2e-contest.mjs --url https://...      # 测线上页面
 *   node scripts/e2e-contest.mjs --chrome /path/to/chrome --json report.json
 *
 * 退出码：0 全过；1 有失败。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const SERVE_DIR = arg('serve', 'docs')
const PORT = Number(arg('port', '4173'))
const JSON_OUT = arg('json', '')
const VERBOSE = argv.includes('--verbose')
let BASE_URL = arg('url', '')

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.css': 'text/css' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------- 静态服务器（默认自测 docs/） ---------- */
let server = null
async function startServer() {
  if (BASE_URL) return
  server = createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0])
    if (p.endsWith('/')) p += 'index.html'
    const file = join(SERVE_DIR, p)
    try {
      const body = readFileSync(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  BASE_URL = `http://127.0.0.1:${PORT}/contest/`
}

/* ---------- Chrome 探测与启动 ---------- */
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
  const pw = join(home, 'Library/Caches/ms-playwright')
  for (const dir of [pw]) {
    if (!existsSync(dir)) continue
    const entries = readFileSync ? null : null
    // 用 shell 列表会简单些，但这里手写探测：
    for (const v of ['chromium-1217', 'chromium-1208', 'chromium-1200']) {
      for (const arch of ['chrome-mac-arm64', 'chrome-mac-x64']) {
        const base = join(dir, v, arch)
        if (!existsSync(base)) continue
        const app = join(base, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
        if (existsSync(app)) return app
      }
    }
  }
  return ''
}

function launchChrome(chromePath, port) {
  const profile = mkdtempSync(join(tmpdir(), 'e2e-contest-'))
  const proc = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' })
  return { proc, profile }
}

/* ---------- CDP ---------- */
async function connect(port) {
  let target = null
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(250)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find((t) => t.type === 'page')
    } catch { /* retry */ }
  }
  if (!target) throw new Error('无法连接 Chrome DevTools（端口 ' + port + '）')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else resolve(msg.result)
      return
    }
    events.push(msg)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  return { ws, send, events }
}

/* ---------- 断言与报告 ---------- */
const cases = []
const record = (name, ok, detail) => {
  cases.push({ name, ok: !!ok, detail: detail === undefined ? null : detail })
  if (VERBOSE) console.log((ok ? 'PASS' : 'FAIL') + ' · ' + name + (detail ? ' — ' + String(detail).slice(0, 200) : ''))
}

const KEYS = ['mrdc1_marks_v1', 'mrdc1_marks_v1_saved', 'mrdc1_answer_v1', 'mrdc1_tries_v1', 'mrdc1_hint_v1']
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
  const { proc, profile } = launchChrome(chrome, devtoolsPort)
  let cdp = null
  try {
    cdp = await connect(devtoolsPort)
    const { send, events } = cdp
    await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable')

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
              document.querySelectorAll('.clue').length === 24 &&
              !!img && img.complete && img.naturalWidth > 0
          })()`)
          if (ok) return true
        } catch { /* navigating */ }
        await sleep(200)
      }
      return false
    }
    const nav = async (url, timeout) => {
      await send('Page.navigate', { url })
      return ready(timeout)
    }
    const consoleErrors = () => {
      const errs = []
      for (const e of events) {
        if (e.method === 'Runtime.exceptionThrown') errs.push('EXCEPTION: ' + String(e.params.exceptionDetails?.text || '').slice(0, 160))
        if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errs.push('log: ' + String(e.params.entry.text || '').slice(0, 160))
        if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) errs.push('HTTP ' + e.params.response.status + ' ' + String(e.params.response.url || '').slice(0, 140))
      }
      return [...new Set(errs)]
    }

    // 1) 加载 + 基础资源
    const loaded = await nav(BASE_URL)
    record('页面加载完成（576 格 / 24 线索就绪）', loaded, loaded ? null : '等待 DOM 就绪超时')
    await evalJS(`[${KEYS.map((k) => JSON.stringify(k)).join(',')}].forEach((k) => localStorage.removeItem(k))`)

    const basic = await evalJS(`(() => {
      const img = document.getElementById('boardimg')
      return JSON.stringify({
        title: document.title,
        cells: document.querySelectorAll('.cell').length,
        clues: document.querySelectorAll('.clue').length,
        chips: document.querySelectorAll('.chip').length,
        img: img ? [img.naturalWidth, img.naturalHeight] : null,
        hasUndo: !!document.getElementById('undo'),
        hasZoom: !!document.getElementById('zoom-in'),
        hasHint: !!document.getElementById('ans-hint'),
        hasHowto: !!document.querySelector('.howto'),
        credit: (document.querySelector('.credit')?.innerText || ''),
        howto: (() => { const d = document.querySelector('.howto'); if (!d) return ''; d.open = true; return d.innerText }) (),
        hintRow: (document.querySelector('.hint-row')?.innerText || ''),
      })
    })()`).then(JSON.parse)
    record('题目与线索数量正确（576 格 / 24 条）', basic.cells === 576 && basic.clues === 24 && basic.chips === 24, { cells: basic.cells, clues: basic.clues, chips: basic.chips })
    record('棋盘图加载正确（1542×1473）', basic.img && basic.img[0] === 1542 && basic.img[1] === 1473, basic.img)
    record('来源署名完整（作者 / 美术 / 非官方）', /Manuel Garand/.test(basic.credit) && /Valentyna/.test(basic.credit) && /非官方/.test(basic.credit), basic.credit.slice(0, 120))
    record('规则区含原题要点（最后一格 / 可占用）', /最后一格/.test(basic.howto) && /可占用/.test(basic.howto) && /ROW/.test(basic.hintRow), null)
    record('工具栏完整（撤销 / 缩放 / 提示 / 规则面板）', basic.hasUndo && basic.hasZoom && basic.hasHint && basic.hasHowto, null)

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
    record('24×24 覆盖层与棋盘图对齐（误差 ≤1px）', maxDelta <= 1, { geom, maxDelta })

    // 3) 线索内容完整性
    const clueData = await evalJS(`(() => {
      const names = [...document.querySelectorAll('.clue .name')].map((e) => e.textContent.trim().replace(/\\s+[A-Z]$/, '').trim())
      const texts = [...document.querySelectorAll('.clue .txt')].map((e) => e.textContent)
      return JSON.stringify({ names, texts })
    })()`).then(JSON.parse)
    const namesOk = JSON.stringify(clueData.names) === JSON.stringify(EXPECT_NAMES)
    record('24 名角色顺序与 PDF 一致', namesOk, namesOk ? null : clueData.names.join(','))
    const clueOk = Object.entries(EXPECT_CLUE_FRAGMENTS).every(([name, frag]) => {
      const i = clueData.names.indexOf(name)
      return i >= 0 && clueData.texts[i] === frag
    })
    record('关键线索与 PDF 原文逐字一致（含 siting 原拼写）', clueOk, null)

    // 4) 标记闭环：笔记 / 撤销 / 打叉 / 橡皮
    const mark = await evalJS(`(() => {
      const cells = [...document.querySelectorAll('.cell')]
      const out = {}
      document.querySelectorAll('.chip')[2].click()   // Cedric
      cells[82].click()                                // R4C11
      out.note = (JSON.parse(localStorage.getItem('mrdc1_marks_v1') || '{}')['82'] || {}).notes || null
      out.letter = (cells[82].textContent || '').trim()
      document.getElementById('undo').click()
      out.afterUndo = JSON.parse(localStorage.getItem('mrdc1_marks_v1') || '{}')['82'] || null
      document.getElementById('mode-x').click()
      cells[0].click()
      out.xAt0 = (JSON.parse(localStorage.getItem('mrdc1_marks_v1') || '{}')['0'] || {}).x || false
      document.getElementById('mode-erase').click()
      cells[0].click()
      out.afterErase = JSON.parse(localStorage.getItem('mrdc1_marks_v1') || '{}')['0'] || null
      document.getElementById('mode-note').click()
      return JSON.stringify(out)
    })()`).then(JSON.parse)
    record('笔记：点格子写入并显示首字母', mark.note && mark.note[0] === 'Cedric' && mark.letter === 'C', mark)
    record('撤销：恢复上一步（清掉刚写的笔记）', mark.afterUndo === null, mark.afterUndo)
    record('打叉 / 橡皮模式生效', mark.xAt0 === true && mark.afterErase === null, mark)

    // 5) 隐藏标记 + 缩放
    const view = await evalJS(`(() => {
      const cellAt = (i) => document.querySelectorAll('.cell')[i]
      document.querySelectorAll('.chip')[0].click()
      cellAt(5).click()
      const shown = (cellAt(5).textContent || '').trim()
      document.getElementById('toggle-hide').click()
      const hidden = (cellAt(5).textContent || '').trim()
      document.getElementById('toggle-hide').click()
      const reshown = (cellAt(5).textContent || '').trim()
      const z0 = document.getElementById('zoom-level').textContent
      document.getElementById('zoom-in').click()
      const z1 = document.getElementById('zoom-level').textContent
      document.getElementById('zoom-out').click()
      const z2 = document.getElementById('zoom-level').textContent
      document.getElementById('zoom-out').click()
      const z3 = document.getElementById('zoom-level').textContent
      return JSON.stringify({ shown, hidden, reshown, z0, z1, z2, z3, plate: document.getElementById('board-plate').style.width })
    })()`).then(JSON.parse)
    record('隐藏/显示标记切换', view.shown === 'A' && view.hidden === '' && view.reshown === 'A', view)
    record('缩放闭环（100→130→100，下限生效）', view.z0 === '100%' && view.z1 === '130%' && view.z2 === '100%' && view.z3 === '100%', view)

    // 6) 刷新持久化
    const before = await evalJS(`JSON.stringify({ marks: localStorage.getItem('mrdc1_marks_v1'), tries: localStorage.getItem('mrdc1_tries_v1') })`).then(JSON.parse)
    await evalJS(`localStorage.setItem('mrdc1_tries_v1', '2')`)
    await send('Page.reload')
    await ready()
    const after = await evalJS(`JSON.stringify({
      marks: localStorage.getItem('mrdc1_marks_v1'),
      tries: localStorage.getItem('mrdc1_tries_v1'),
      saved: document.getElementById('save-state')?.textContent || '',
      cell5: (document.querySelectorAll('.cell')[5].textContent || '').trim(),
    })`).then(JSON.parse)
    record('刷新后笔记与尝试次数保留', after.marks === before.marks && after.tries === '2' && after.cell5 === 'A', after)

    // 7) 答案判对闭环
    const answer = await evalJS(`(() => {
      const out = {}
      const set = (r, c) => { document.getElementById('ans-row').value = r; document.getElementById('ans-col').value = c }
      const check = () => { document.getElementById('ans-check').click(); return document.getElementById('ans-result').textContent }
      set('', ''); out.empty = check()
      set('1', '1'); out.wrong = check()
      set('4', '20'); out.rowRight = check()
      set('5', '10'); out.near = check()
      set('4', '11'); out.right = check()
      out.tries = localStorage.getItem('mrdc1_tries_v1')
      return JSON.stringify(out)
    })()`).then(JSON.parse)
    record('判对：非法输入被拦下并提示', /请输入/.test(answer.empty), answer.empty)
    record('判对：错误/行对/接近三种提示有区分度', /不对/.test(answer.wrong) && /行已经对了/.test(answer.rowRight) && /非常接近/.test(answer.near), { wrong: answer.wrong, rowRight: answer.rowRight, near: answer.near })
    record('判对：正确答案给出 R4 C11 且带提交入口', /R4 C11/.test(answer.right) && /murdoku\.com\/contest/.test(answer.right), answer.right)

    // 8) 提示阶梯与记忆
    const hint = await evalJS(`(() => {
      localStorage.removeItem('mrdc1_hint_v1')
      document.getElementById('ans-hint').click()
      const h1 = document.getElementById('hintbox').textContent
      document.getElementById('ans-hint').click()
      const h2 = document.getElementById('hintbox').textContent
      const level = localStorage.getItem('mrdc1_hint_v1')
      return JSON.stringify({ h1, h2, level })
    })()`).then(JSON.parse)
    record('提示阶梯：逐级推进且记住进度', /提示 1 \/ 6/.test(hint.h1) && /提示 2 \/ 6/.test(hint.h2) && hint.level === '2', hint)
    await send('Page.reload')
    await ready()
    const hintAfterReload = await evalJS(`JSON.stringify({ box: document.getElementById('hintbox').textContent, level: localStorage.getItem('mrdc1_hint_v1') })`).then(JSON.parse)
    record('刷新后提示进度保留', /已解锁 2/.test(hintAfterReload.box) && hintAfterReload.level === '2', hintAfterReload)

    // 9) 清空闭环
    const reset = await evalJS(`(() => {
      window.confirm = () => true
      document.getElementById('reset').click()
      return JSON.stringify({ marks: localStorage.getItem('mrdc1_marks_v1'), cell5: (document.querySelectorAll('.cell')[5].textContent || '').trim() })
    })()`).then(JSON.parse)
    record('清空：标记全部移除', reset.marks === '{}' && reset.cell5 === '', reset)

    // 10) 控制台与网络
    const errs = consoleErrors()
    record('无控制台报错 / 无 404', errs.length === 0, errs.slice(0, 5))

    // 结束清理
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

main().catch((error) => {
  console.error('E2E 运行失败:', error.message)
  process.exit(1)
})
