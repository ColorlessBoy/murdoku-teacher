/**
 * 后台 headless 执行器：当侧栏面板不可见（iframe 0×0）时接管操作。
 *
 * 用一个由 Playwright 安装的 Chromium（或系统 Chrome）以 headless 模式打开
 * 同一个源（http://127.0.0.1:3080/play/...），通过 CDP 执行与前台面板相同的
 * 动作脚本。状态用 localStorage 的 mrd_* 键在「前台 iframe ↔ headless ↔ 磁盘」
 * 之间同步（磁盘快照由 index.js 的 syncProgress 维护）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/** 找可用的 Chrome/Chromium 可执行文件。 */
const CANDIDATES = [
  process.env.WEBPANE_CHROME,
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const resolveChrome = (configured) => {
  for (const candidate of [configured, ...CANDIDATES]) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return undefined
}

/** 极简 CDP 客户端（browser 级 WebSocket + flat session）。 */
class Cdp {
  constructor() {
    this.id = 0
    this.pending = new Map()
    this.handlers = new Set()
  }

  async open(url) {
    this.ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = reject
    })
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)(message)
        this.pending.delete(message.id)
        return
      }
      for (const handler of this.handlers) handler(message)
    }
  }

  send(method, params = {}, sessionId, timeoutMs = 15000) {
    const id = ++this.id
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`cdp timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, (message) => {
        clearTimeout(timer)
        if (message.error) reject(new Error(`${method}: ${message.error.message}`))
        else resolve(message.result)
      })
      this.ws.send(JSON.stringify(payload))
    })
  }

  on(handler) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  close() {
    try { this.ws?.close() } catch { /* ignore */ }
  }
}

/**
 * 创建一个懒启动的 headless 执行器。
 * @param {{ chromePath?: string, profileDir: string, baseUrl: string }} options
 */
export function createHeadless(options) {
  const chromePath = resolveChrome(options.chromePath)
  const profileDir = options.profileDir
  const baseUrl = options.baseUrl
  let child = null
  let browser = null
  /** @type {Map<string, { targetId: string, sessionId: string, url: string }>} */
  const pages = new Map()
  let starting = null

  const start = async () => {
    if (browser) return browser
    if (starting) return starting
    if (chromePath === undefined) throw new Error('找不到 Chrome/Chromium 可执行文件，可用 config.chromePath 指定')
    starting = (async () => {
      mkdirSync(profileDir, { recursive: true })
      const profile = mkdtempSync(join(profileDir, 'p-'))
      child = spawn(chromePath, [
        '--headless=new',
        '--remote-debugging-port=0',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--window-size=1280,900',
        'about:blank',
      ], { stdio: 'ignore' })
      const portFile = join(profile, 'DevToolsActivePort')
      for (let i = 0; i < 200 && !existsSync(portFile); i += 1) await sleep(50)
      if (!existsSync(portFile)) throw new Error('headless Chrome 启动超时（DevToolsActivePort 未出现）')
      const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n')
      browser = new Cdp()
      await browser.open(`ws://127.0.0.1:${port}${wsPath}`)
      child.on('exit', () => { browser = null; child = null; pages.clear() })
      return browser
    })()
    try {
      return await starting
    } finally {
      starting = null
    }
  }

  /** 取（必要时新建）某个会话的页面。 */
  const ensurePage = async (key) => {
    const cdp = await start()
    const existing = pages.get(key)
    if (existing && browser) {
      const targets = await cdp.send('Target.getTargets')
      if (targets.targetInfos.some(t => t.targetId === existing.targetId)) return existing
      pages.delete(key)
    }
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const page = { targetId, sessionId: attached.sessionId, url: 'about:blank' }
    await cdp.send('Page.enable', {}, page.sessionId)
    await cdp.send('Runtime.enable', {}, page.sessionId)
    try { await cdp.send('Page.setWebLifecycleState', { state: 'active' }, page.sessionId) } catch { /* 旧版本 Chrome 可能不支持 */ }
    pages.set(key, page)
    return page
  }

  const evaluate = async (page, expression, { awaitPromise = true, timeoutMs = 15000 } = {}) => {
    const cdp = await start()
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    }, page.sessionId, timeoutMs)
    if (result.exceptionDetails !== undefined) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      throw new Error(String(detail).slice(0, 300))
    }
    return result.result?.value
  }

  const waitLoad = async (page, timeoutMs = 15000) => {
    const cdp = await start()
    return new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs)
      const off = cdp.on((message) => {
        if (message.sessionId === page.sessionId && message.method === 'Page.loadEventFired') done()
      })
      function done() {
        clearTimeout(timer)
        off()
        resolve()
      }
    })
  }

  const relative = (url) => {
    try { const parsed = new URL(url, baseUrl); return parsed.pathname + parsed.search } catch { return url }
  }

  const navigate = async (key, url) => {
    const absolute = url.startsWith('http') ? url : baseUrl + url
    const page = await ensurePage(key)
    const cdp = await start()
    const loaded = waitLoad(page)
    await cdp.send('Page.navigate', { url: absolute }, page.sessionId)
    await loaded
    await sleep(800)
    page.url = relative(absolute)
    return page
  }

  const STORAGE_DUMP = `(() => {
    const storage = {}
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith('mrd_') && !/catalog_cache/.test(key)) storage[key] = localStorage.getItem(key)
    }
    return JSON.stringify({ href: location.pathname + location.search, savedAt: Date.now(), storage })
  })()`

  return {
    available: () => chromePath !== undefined,
    chromePath,

    /** 打开（或复用）页面。 */
    async open(key, path) {
      const url = path.startsWith('http') ? path : baseUrl + path
      const page = pages.get(key)
      if (page && page.url === relative(url)) {
        await sleep(200)
        return { url, reused: true }
      }
      await navigate(key, url)
      return { url, reused: false }
    },

    /** 等 app 的防抖存档落地（比较 mrd_* 全量快照，变化后再等 150ms 稳定）。 */
    async settle(key, timeoutMs = 3000) {
      const page = await ensurePage(key)
      const raw = await evaluate(page, `(async () => {
        const snap = () => {
          let out = ''
          for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i)
            if (k && k.startsWith('mrd_')) out += k + '=' + (localStorage.getItem(k) || '') + ';'
          }
          return out
        }
        const before = snap()
        const t0 = performance.now()
        while (performance.now() - t0 < ${Number(timeoutMs)}) {
          await new Promise(r => setTimeout(r, 100))
          if (snap() !== before) { await new Promise(r => setTimeout(r, 150)); break }
        }
        return snap()
      })()`, { timeoutMs: timeoutMs + 5000 })
      return typeof raw === 'string'
    },

    /** 读页面 localStorage 的 mrd_* 快照。 */
    async readStorage(key) {
      const page = await ensurePage(key)
      const raw = await evaluate(page, STORAGE_DUMP)
      try { return JSON.parse(raw) } catch { return null }
    },

    /** 把磁盘快照写进页面 localStorage（加载前调用）。 */
    async writeStorage(key, storage) {
      const page = await ensurePage(key)
      const payload = JSON.stringify(storage ?? {})
      const written = await evaluate(page, `(() => { const data = ${payload}; let n = 0; for (const [k, v] of Object.entries(data)) { if (typeof v === 'string' && localStorage.getItem(k) !== v) { localStorage.setItem(k, v); n += 1 } } return n })()`)
      return Number(written) || 0
    },

    /** 当前页面地址（相对路径），没有页面时返回 null。 */
    pageUrl(key) {
      return pages.get(key)?.url ?? null
    },

    /** 重新加载当前页面。 */
    async reload(key) {
      const page = pages.get(key)
      if (!page) return false
      const target = page.url
      await navigate(key, target)
      return true
    },

    /** 执行一条动作；eval 直接透传，其它动作在页面里用 DOM 实现。 */
    async action(key, action, payload) {
      const page = await ensurePage(key)
      switch (action) {
        case 'eval':
          return evaluate(page, String(payload.code ?? ''), { timeoutMs: 180000 })
        case 'state':
          return evaluate(page, `JSON.stringify({ url: location.pathname + location.search, title: document.title, readyState: document.readyState, viewport: { w: innerWidth, h: innerHeight } })`)
        case 'text':
          return evaluate(page, `(document.body ? document.body.innerText : '').slice(0, ${Number(payload.limit ?? 6000)})`)
        case 'snapshot':
          return evaluate(page, `(() => {
            const rows = []
            for (const el of document.querySelectorAll('button, a, [role="button"], [role="gridcell"], [tabindex], input, select, textarea')) {
              if (rows.length >= 240) break
              const rect = el.getBoundingClientRect()
              if (rect.width === 0 && rect.height === 0) continue
              el.setAttribute('data-dshref', 'e' + (rows.length + 1))
              rows.push('e' + (rows.length + 1) + ' <' + (el.getAttribute('role') || el.tagName.toLowerCase()) + '> ' + (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 70))
            }
            return rows.join('\\n')
          })()`)
        case 'click': {
          const target = { ref: payload.ref, selector: payload.selector, text: payload.text }
          return evaluate(page, `(() => {
            const target = ${JSON.stringify(target)}
            const find = () => {
              if (target.ref) return document.querySelector('[data-dshref="' + target.ref + '"]')
              if (target.selector) return document.querySelector(target.selector)
              const all = [...document.querySelectorAll('button, a, [role="button"], [role="gridcell"], [tabindex], input, select, textarea')]
              return all.find(el => (el.innerText || '').replace(/\\s+/g, ' ').trim() === target.text)
                ?? all.find(el => (el.innerText || '').replace(/\\s+/g, ' ').trim().includes(target.text))
            }
            const el = find()
            if (!el) return 'not found'
            const opts = { bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, button: 0 }
            el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, buttons: 1 }))
            el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }))
            el.dispatchEvent(new MouseEvent('click', opts))
            el.click?.()
            return 'clicked ' + (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40)
          })()`)
        }
        case 'hold': {
          // 长按格子：payload.index（必填）、payload.ms（默认 900）
          return evaluate(page, `(async () => {
            const index = ${Number(payload.index ?? -1)}
            const ms = ${Number(payload.ms ?? 900)}
            const cells = [...document.querySelectorAll('[data-cell-index="' + index + '"]')]
            const el = cells[cells.length - 1]
            if (!el) return 'no cell'
            const opts = { bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, button: 0 }
            el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, buttons: 1 }))
            await new Promise(r => setTimeout(r, ms))
            el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }))
            return 'held ' + index
          })()`)
        }
        case 'back':
          return evaluate(page, `(history.back(), 'back')`)
        case 'open':
          await navigate(key, payload.url?.startsWith('http') ? payload.url : baseUrl + payload.url)
          return { ok: true }
        default:
          throw new Error(`headless 不支持动作 ${action}`)
      }
    },

    async close() {
      try { browser?.close() } catch { /* ignore */ }
      try { child?.kill('SIGKILL') } catch { /* ignore */ }
      child = null
      browser = null
      pages.clear()
    },
  }
}
