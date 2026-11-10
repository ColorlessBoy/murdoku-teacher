/**
 * Murdoku 离线页的同源托管 + 右侧栏面板桥。
 *
 * - 把 `root/play` 与 `root/play_puzzles` 挂在 DSH 自己的 origin 上，
 *   于是侧边栏 iframe 与 DSH 同源，面板 JS 可以直接读 document、派发点击。
 * - `/__webpane/*` 上跑一条极简 host→client 通道（SSE 下行 + POST 上行），
 *   工具 `webpane` 把动作推给面板执行，面板回传结果。
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHeadless } from './headless.js'

/** 稳定 Loader 身份。 */
export const name = 'dsh-webpane'

/** 工具与服务依赖。 */
export const inject = ['tools', 'webServer']

/** 让任何 session 都会用这个面板：随插件进系统提示，不依赖 skill 是否安装。 */
const WEBPANE_GUIDE = `## Sidebar web pane (webpane)

A local web page (Murdoku) can be shown in the right sidebar and driven like Playwright.
Call the \`webpane\` tool; it is scoped to this conversation's own session (other sessions are never touched).

- \`{"action":"open","url":"/play/puzzle-<id>"}\` loads a level directly (most reliable); \`state\` reports the current URL/title — call it before acting.
- \`{"action":"eval","code":"…"}\` runs JS in the page. Read the board from \`localStorage["mrd_progress_<id>"]\` = \`{placed, xMarks, notes}\` (\`char_0..\` in the level's character order).
- Board cells are \`[data-cell-index="i"]\` with \`i = (row-1)*columns + (col-1)\`.
- To place a suspect: select the portrait button whose text matches the name, then hold the cell (pointerdown, wait ~900ms, pointerup). A short click writes a note instead.
- Board DOM: every index appears **twice** (two layers); notes are \`.grid-note-letter\`, X marks are \`<img>\` whose \`src\` contains \`87.7\`; clear a cell by long-pressing the button titled \`长按以清除所有格子\` (~1.2 s), never by reloading.
- Placing a suspect auto-Xs its whole row and column (\`mrd_auto_x\`); read those X marks, don't re-mark them.
- Only empty cells ∪ chair cells accept a person (tables, trees, plants… reject placement); in coaching/exam modes never read \`solution_*\`, \`player_hint_*\` or \`murderer\` from the level data.
- \`提交\` submits; \`撤销\` undoes. Completion is recorded locally in \`mrd_catalog_v2\` and mirrored to \`progress/history.json\`.
- Level data (rooms, objects, clues, reference solution) is at \`.worktree/original-app/public/play_puzzles/en/<id>.json\`.
- Two level-file formats: grids live under \`CHARACTERS\` (row-major keys) in older files, or under \`GRID\` in newer ones — there the key is \`<field>_<x>_<y>\`, i.e. **column first** (\`room_code_{c}_{r}\`). Mixing them silently breaks every room/adjacency deduction.
- If the sidebar pane is hidden (its iframe is 0×0) the tool transparently drives a background headless Chromium on the same origin and mirrors state through \`progress/\`; in that mode put a whole multi-step run inside one \`eval\` call (cross-command continuity is best-effort).
- Ledger: \`ledger-state\` exports the live board as canonical JSON to \`progress/state/<puzzle>.json\`; \`scripts/murdoku-state.mjs\` / \`scripts/murdoku-ledger.mjs\` then work without CDP (context compaction loses board memory — the ledger and \`mrd_progress_*\` are the truth).
- In coaching mode one turn = ONE logical board operation (one role's candidate set, one X group, or one placement), then explain it in one condition and ask; never batch "the rest".
- Routine: after each board operation run \`node .agents/skills/murdoku-webpane/scripts/teaching-step.mjs --puzzle <id> --action '<json>' --explain '<one condition>'\` (refreshes the state file, appends the ledger \`(state, action, state')\` record, and saves the lesson history to \`progress/lessons/<id>.jsonl|.md\`), then explain in one line and ask; after the user's reply record \`--feedback accept|reject\`.
- If it answers that this session's web pane is not open, ask the user to open the "网页 · Murdoku" tab once in this session.`

/** 游戏规则速查（源：zh_hans bundle 的 howToPlay/glossary/faq，逐条对照过）。 */
const MURDOKU_RULES = `## Murdoku rules (digest)

Goal: place every character on the board; the murderer was the one alone with the victim (same room).

- Exactly one person per row and per column (level types can vary; trust the clues when they say otherwise).
- "Beside" = orthogonal neighbour (up/down/left/right) **and the same room** — never diagonal.
- Suspects only stand on occupiable cells (not on tables, trees, …).
- North / South / East / West = any cell below / above / right / left, room irrelevant. For "exactly one row north/south of X" the row differs by exactly 1 and the column is free — it is NOT the cell directly above/below X.
- Region words: "alone" = nobody else in the room; "with X" = same room as X; "alone with X" = exactly those two; "empty" = nobody at all.
- The victim counts as a person in every clue.
- "Beside a chair" may also mean sitting on it; large objects (bed/car/boat) cover several cells but hold one person.
- Clues are always true, every puzzle is solvable without guessing, and character portraits are decorative.
- Level files come in two formats: \`CHARACTERS\` holds the grids in the older format, \`GRID\` in the newer one — and in \`GRID\` the keys are \`<field>_<x>_<y>\`, i.e. **column first** (\`room_code_{c}_{r}\`). Mixing the two silently breaks every room/adjacency deduction.
- Data: \`play_puzzles/en/<id>.json\` — \`room_code_r_c\` (room id), \`room_objects_r_c\`, \`carpet_objects_r_c\`, clues in \`char_quote_en_i\`, reference answer in \`solution_x_i\`/\`solution_y_i\` + \`murderer\`. Object ids: 1 Plant, 2 Chair, 4 Table, 5 Carpet, 13 Shelf, 48 Pig …
- "Room" means the walled area: level-data room codes are often *terrain* (sand/path/water); a terrain subarea belongs to its main room (\`room_subroom\` + \`room_subroom_mainroom\`), so "beside" / "same room" uses the main walled room. Verify against wall labels and room names before treating a code as the clue's room.
- General (global) clues are counting constraints on the final arrangement ("exactly one person beside a table"), not per-character candidates; the "every room must be non-empty" idea is not universal — derive constraints from clues only.
- Reasoning discipline: never work backwards from \`solution_*\`/\`murderer\` (an answer-driven "reason" is a hard error); over-X is a known failure — only cross cells are unconditionally empty, don't clear whole rows/columns without proof; a placement auto-Xs its row/column and Undo does NOT restore the notes it consumed (re-add them manually); explain one line per step ("column 8 has only one position left"), not per-cell enumeration.
- If the page offers \`提示\`, it walks the level's intended deduction ladder.`

/** 面板多久没连上就让工具失败（毫秒）。 */
const PANEL_WAIT_MS = 6000
/** 单条面板命令的超时（毫秒）。 */
const COMMAND_TIMEOUT_MS = 20000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx harness context
 * @param {{ root?: string, entry?: string }} config bundle config
 */
export function apply(ctx, config) {
  const root = config?.root ?? '/Users/penglingwei/Documents/murdoku/.worktree/original-app/public'
  const entry = config?.entry ?? '/play/?lang=zh_hans'
  const progressDir = config?.progressDir ?? '/Users/penglingwei/Documents/murdoku/progress'
  const pluginDir = dirname(fileURLToPath(import.meta.url))
  const headless = createHeadless({
    chromePath: config?.chromePath,
    profileDir: config?.headlessProfile ?? join(dirname(progressDir), '.webpane-headless-profile'),
    baseUrl: config?.baseUrl ?? 'http://127.0.0.1:3080',
  })
  const historyFile = join(progressDir, 'history.json')
  const readHistory = () => {
    try { return JSON.parse(readFileSync(historyFile, 'utf8')) } catch { return { updatedAt: null, items: [] } }
  }
  const writeHistory = (data) => {
    mkdirSync(progressDir, { recursive: true })
    writeFileSync(historyFile, JSON.stringify(data, null, 2))
  }

  /** @type {Set<import('node:http').ServerResponse>} */
  const panels = new Set()
  /** @type {Set<import('node:http').ServerResponse>} */
  const controllers = new Set()
  /** @type {Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>} */
  const pending = new Map()
  let sequence = 0
  /** @type {string[]} 客户端自检信标 */
  const logs = []
  /** 让任意已打开的 /play 页面自己跳转（不依赖命令通道，跨浏览器/跨来源都能用） */
  let navRequest = null

  const writeEvent = (res, event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  /** 只服务本页面自己的请求：cross-site 一律挡下（EventSource 的 Origin 可能是 null）。 */
  const sameOrigin = (req) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = req.headers.origin
    if (origin === undefined || origin === 'null') return true
    try {
      return new URL(origin).host === req.headers.host
    } catch {
      return false
    }
  }

  const serveSse = (req, res, sink) => {
    if (!sameOrigin(req)) {
      res.writeHead(403).end('cross-origin')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.flushHeaders?.()
    res.write(': connected\n\n')
    if (sink === panels) {
      try { res.dshClient = new URL(req.url ?? '/', 'http://localhost').searchParams.get('client') || '' } catch { res.dshClient = '' }
    }
    sink.add(res)
    if (sink === panels) setTimeout(() => { void syncProgress() }, 800)
    const keep = setInterval(() => { res.write(': ping\n\n') }, 15000)
    const done = () => { clearInterval(keep); sink.delete(res) }
    req.on('close', done)
    req.on('error', done)
  }

  /** 进程内等待一个面板出现。 */
  const ensurePanel = async () => {
    if (panels.size > 0) return true
    for (const controller of controllers) writeEvent(controller, 'open-tab', {})
    const deadline = Date.now() + PANEL_WAIT_MS
    while (Date.now() < deadline) {
      await sleep(120)
      if (panels.size > 0) return true
    }
    return false
  }

  /** 已连接面板上执行一条命令；不等待面板出现。 */
  const askPanelOnce = (action, payload, timeoutMs) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`面板 ${action} 超时`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value) },
      reject: (error) => { clearTimeout(timer); reject(error) },
    })
    for (const panel of panels) writeEvent(panel, 'command', { id, action, payload })
  })

  /** 发一条命令给所有面板；带 session 时只有持有该 session 面板的页面会执行并回传。 */
  const sendCommand = (action, payload, session, timeoutMs, targetClient) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      const error = new Error(`面板 ${action} 超时`)
      error.noResponse = true
      reject(error)
    }, timeoutMs)
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value) },
      reject: (error) => { clearTimeout(timer); reject(error) },
    })
    const targets = targetClient
      ? [...panels].filter((panel) => panel.dshClient === targetClient)
      : [...panels]
    for (const panel of (targets.length > 0 ? targets : panels)) writeEvent(panel, 'command', { id, action, payload, session })
  })

  /**
   * 执行一条命令。带 session 时只驱动那个 session 自己的面板；
   * 若它还没开，只请“当前正显示该 session”的页面把它开出来，绝不跨 session 弹。
   */
  /** eval 的返回值在链路里会被 JSON.stringify，可能双层编码。 */
  const evalValue = async (session, code) => {
    const raw = await sendCommand('eval', { code }, session, 4000)
    let value = raw
    for (let i = 0; i < 3 && typeof value === 'string'; i += 1) {
      try { value = JSON.parse(value) } catch { break }
    }
    return value
  }

  /** 面板是否真的在布局里（隐藏时 iframe 是 0×0，点按落不下去）。 */
  const probeVisible = async (session) => {
    try {
      const width = await evalValue(session, 'String((window.frameElement && window.frameElement.getBoundingClientRect().width) || 0)')
      return Number(width) > 0
    } catch {
      return false
    }
  }

  /** 正在用 headless 的 session：避免隐藏 iframe 的旧状态同步覆盖磁盘。 */
  const headlessSessions = new Set()

  const readDiskStorage = () => {
    try { return JSON.parse(readFileSync(join(progressDir, 'local-storage.json'), 'utf8')).storage ?? {} } catch { return {} }
  }

  /** 后台执行：把状态从磁盘喂给 headless，动作后在写回磁盘。 */
  const runHeadless = async (action, payload, session) => {
    if (!headless.available()) {
      throw new Error('侧栏面板不可见，且没有可用的 Chrome/Chromium 做后台执行（可用 config.chromePath 指定）')
    }
    const key = String(session)
    headlessSessions.add(key)
    // 已有后台页面时绝不重载/改导航：跨命令的状态就靠这个保住
    const ensureReady = async () => {
      if (headless.pageUrl(key) !== null) return
      let path = null
      try { path = await evalValue(session, 'location.pathname + location.search') } catch { path = null }
      const target = path || entry
      await headless.open(key, target)
      await headless.writeStorage(key, readDiskStorage())
      await headless.reload(key)
    }
    const state = async () => {
      const raw = await headless.action(key, 'state', {})
      try { return JSON.parse(raw) } catch { return raw }
    }
    if (action === 'open') {
      const target = typeof payload.url === 'string' && payload.url !== '' ? payload.url : entry
      const relativeTarget = target.startsWith('http') ? new URL(target).pathname + new URL(target).search : target
      await headless.open(key, target)
      await sleep(700)
      await headless.writeStorage(key, readDiskStorage())
      await headless.reload(key)
      await sleep(900)
      let current = await state()
      // 首屏可能在数据加载前就 boot，SPA 偶尔会退回列表：再导航一次
      if (!String(current?.url ?? '').startsWith(relativeTarget)) {
        await headless.open(key, target)
        await sleep(900)
        current = await state()
      }
      // 让隐藏的前台 iframe 也切到同一关，用户回来时看到的就是这一页
      void sendCommand('open', { url: target }, session, 4000).catch(() => undefined)
      const dump = await headless.readStorage(key)
      if (dump) writeDump(dump)
      return current
    }
    await ensureReady()
    const value = await headless.action(key, action, payload)
    await headless.settle(key, 3000)
    const dump = await headless.readStorage(key)
    if (dump) writeDump(dump)
    return value
  }

  const syncAction = async (session) => {
    const snapshot = readDiskStorage()
    const keys = Object.keys(snapshot)
    if (keys.length === 0) return '磁盘快照为空'
    if (await ensurePanel()) {
      const visible = session !== undefined && session !== null ? await probeVisible(session) : false
      if (visible) {
        const code = `(async () => {
          const response = await fetch('/__webpane/progress')
          const data = await response.json()
          const storage = (data.snapshot && data.snapshot.storage) || {}
          let changed = 0
          for (const [key, value] of Object.entries(storage)) {
            if (typeof value === 'string' && localStorage.getItem(key) !== value) { localStorage.setItem(key, value); changed += 1 }
          }
          if (changed > 0) setTimeout(() => location.reload(), 50)
          return String(changed)
        })()`
        return `已同步 ${await evalValue(session, code)} 个键`
      }
      if (session !== undefined && session !== null) {
        const key = String(session)
        const written = await headless.writeStorage(key, snapshot)
        return `已写入 headless ${written} 个键`
      }
    }
    return '没有可同步的目标'
  }

  /**
   * 把当前盘面导出成 ledger 兼容的 canonical state：
   * progress/state/<puzzle>.json = { puzzle, placed:{A:idx}, notes:{A:[..]}, xMarks:[..], notesTotal }
   * （scripts/murdoku-state.mjs 在 CDP 不可用时会读它，ledger 因此可与插件共用）
   */
  /** 读关卡数据判断受害者序号（char_N 里谁是 V）；读不到就退回「最后一位」。 */
  const readVictimIndex = (puzzle) => {
    for (const lang of ['en', 'zh_hans']) {
      try {
        const file = join(root, 'play_puzzles', lang, `${puzzle}.json`)
        if (!existsSync(file)) continue
        const level = JSON.parse(readFileSync(file, 'utf8'))
        const chars = level.CHARACTERS || {}
        for (let i = 0; i < 16; i += 1) {
          const quote = String(chars[`char_quote_en_${i}`] || chars[`char_quote_zh_${i}`] || '')
          if (/victim|被害者/i.test(quote)) return i
        }
        const total = Number(level.PROPERTIES?.total_chars ?? level.PROPERTIES?.total_char ?? 0)
        if (total > 0) return total - 1
      } catch { /* 下一个语言 */ }
    }
    return -1
  }

  /**
   * 把当前盘面导出成 ledger 兼容的 canonical state：
   * progress/state/<puzzle>.json = { puzzle, placed:{A:idx}, notes:{A:[..]}, xMarks:[..], notesTotal }
   * （scripts/murdoku-state.mjs 在 CDP 不可用时会读它，ledger 因此可与插件共用）
   */
  const ledgerStateAction = async (session, payload = {}) => {
    let puzzle = typeof payload.puzzle === 'string' ? payload.puzzle : ''
    if (puzzle === '') {
      const rawPath = await askPanel('eval', { code: 'location.pathname' }, session)
      let path = rawPath
      for (let i = 0; i < 3 && typeof path === 'string'; i += 1) {
        try { path = JSON.parse(path) } catch { break }
      }
      const match = String(path ?? '').match(/\/play\/([^/?#]+)/)
      if (match === null) throw new Error('ledger-state: 当前页面不在谜题里，请先 open 关卡或传 {"puzzle":"<id>"}')
      puzzle = match[1]
    }
    const victimIndex = readVictimIndex(puzzle)
    const code = `JSON.stringify((() => {
      const puzzle = ${JSON.stringify(puzzle)}
      const victimIndex = ${victimIndex}
      const key = 'mrd_progress_' + puzzle
      const raw = key ? localStorage.getItem(key) : null
      if (!raw) return { puzzle, error: 'no-progress' }
      const p = JSON.parse(raw)
      const letterOf = (n) => (n === victimIndex ? 'V' : String.fromCharCode(65 + n))
      const placed = {}
      const notes = {}
      let notesTotal = 0
      p.placed.forEach((id, idx) => {
        if (!id) return
        placed[letterOf(Number(String(id).replace('char_', '')))] = idx
      })
      p.notes.forEach((ids, idx) => {
        if (!ids || ids.length === 0) return
        for (const id of ids) {
          const letter = letterOf(Number(String(id).replace('char_', '')))
          notes[letter] = notes[letter] || []
          notes[letter].push(idx)
          notesTotal += 1
        }
      })
      return { puzzle, placed, notes, xMarks: p.xMarks.map((v, i) => v ? i : null).filter(v => v !== null), notesTotal, victimIndex, savedAt: Date.now() }
    })())`
    const raw = await askPanel('eval', { code }, session)
    let data = raw
    for (let i = 0; i < 3 && typeof data === 'string'; i += 1) {
      try { data = JSON.parse(data) } catch { break }
    }
    if (data === null || typeof data !== 'object') throw new Error('ledger-state 读取失败')
    if (data.error) throw new Error(`ledger-state: ${data.error}`)
    mkdirSync(join(progressDir, 'state'), { recursive: true })
    const file = join(progressDir, 'state', `${data.puzzle}.json`)
    writeFileSync(file, JSON.stringify(data, null, 2))
    return { file, ...data }
  }

  /** 每次盘面动作后自动刷新 ledger 状态文件（防抖，失败忽略）。 */
  let ledgerExportTimer = null
  const scheduleLedgerExport = (session) => {
    if (config?.autoLedgerState === false) return
    if (session === undefined || session === null) return
    if (ledgerExportTimer !== null) clearTimeout(ledgerExportTimer)
    ledgerExportTimer = setTimeout(() => {
      ledgerExportTimer = null
      void ledgerStateAction(session, {}).catch(() => undefined)
    }, 1200)
  }

  const askPanel = async (action, payload, session, targetClient) => {
    if (action === '__sync') return syncAction(session)
    if (action === 'ledger-state' || action === '__ledger-state') return ledgerStateAction(session, payload)
    if (await ensurePanel()) {
      const scoped = session !== undefined && session !== null
      if (scoped) {
        const visible = await probeVisible(session)
        if (visible) {
          headlessSessions.delete(String(session))
          return sendCommand(action, payload, session, COMMAND_TIMEOUT_MS, targetClient)
        }
        // 不可见：让页面试着把面板调出来；调不出来就走 headless
        for (const panel of panels) writeEvent(panel, 'open-tab', { session })
        await sleep(500)
        if (await probeVisible(session)) return sendCommand(action, payload, session, COMMAND_TIMEOUT_MS, targetClient)
        return runHeadless(action, payload, session)
      }
      return sendCommand(action, payload, session, COMMAND_TIMEOUT_MS, targetClient)
    }
    if (session !== undefined && session !== null) return runHeadless(action, payload, session)
    throw new Error('侧边栏面板没有连上：请在当前 session 的右侧栏引导页点「网页 · Murdoku」打开一次')
  }

  /** 对外入口：动作完成后顺手刷新 ledger 状态文件。 */
  const dispatchAction = async (action, payload, session, targetClient) => {
    const value = await askPanel(action, payload, session, targetClient)
    if (action !== 'ledger-state' && action !== '__ledger-state' && action !== '__sync') {
      scheduleLedgerExport(session)
    }
    return value
  }

  /** 把页面里的 mrd_* 进度镜像到工作区，云端存档的本地替身。 */
  const progressScript = `(() => {
    const storage = {}
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith('mrd_') && !/catalog_cache/.test(key)) storage[key] = localStorage.getItem(key)
    }
    return JSON.stringify({ href: location.pathname + location.search, savedAt: Date.now(), storage })
  })()`

  /** 把一份 {href, savedAt, storage} 快照落到 progress/。 */
  const writeDump = (dump) => {
    const storage = (dump && dump.storage) || {}
    mkdirSync(join(progressDir, 'puzzles'), { recursive: true })
    writeFileSync(join(progressDir, 'local-storage.json'), JSON.stringify(dump, null, 2))
    const puzzles = new Map()
    for (const [key, value] of Object.entries(storage)) {
      const progress = /^mrd_progress_(.+)$/.exec(key)
      if (progress !== null) {
        const entry = puzzles.get(progress[1]) ?? { puzzleId: progress[1] }
        try { entry.progress = JSON.parse(value) } catch { entry.progress = value }
        puzzles.set(progress[1], entry)
      }
      const timer = /^mrd_timer_(.+)$/.exec(key)
      if (timer !== null) {
        const entry = puzzles.get(timer[1]) ?? { puzzleId: timer[1] }
        entry.timerSeconds = Number(value)
        puzzles.set(timer[1], entry)
      }
    }
    for (const [id, entry] of puzzles) {
      writeFileSync(join(progressDir, 'puzzles', `${id}.json`), JSON.stringify({ ...entry, savedAt: dump.savedAt, href: dump.href }, null, 2))
    }
    return puzzles.size
  }

  let syncing = false
  let lastSync = null
  const syncProgress = async () => {
    if (syncing || panels.size === 0) return { ok: false, reason: 'no-panel' }
    // 有会话正在后台执行时，隐藏的 iframe 状态是旧的，跳过同步以免覆盖磁盘快照
    if (headlessSessions.size > 0) return { ok: false, reason: 'headless-active' }
    // 面板不可见时 iframe 里的状态也不可信（可能是旧画面），不要拿它覆盖磁盘
    try {
      const raw = await askPanelOnce('eval', { code: 'String((window.frameElement && window.frameElement.getBoundingClientRect().width) || 0)' }, 5000)
      let width = raw
      for (let i = 0; i < 3 && typeof width === 'string'; i += 1) {
        try { width = JSON.parse(width) } catch { break }
      }
      if (!(Number(width) > 0)) {
        lastSync = { at: Date.now(), ok: false, reason: 'panel-hidden' }
        return lastSync
      }
    } catch {
      lastSync = { at: Date.now(), ok: false, reason: 'panel-probe-failed' }
      return lastSync
    }
    syncing = true
    try {
      const raw = await askPanelOnce('eval', { code: progressScript, limit: 200000 }, 6000)
      // eval 的结果经过 client 的 JSON.stringify，字符串会被再编码一层。
      let dump = typeof raw === 'string' ? JSON.parse(raw) : raw
      while (typeof dump === 'string') dump = JSON.parse(dump)
      writeDump(dump)
      lastSync = { at: Date.now(), ok: true, file: join(progressDir, 'local-storage.json'), written: true }
      return lastSync
    } catch (error) {
      lastSync = { at: Date.now(), ok: false, reason: error instanceof Error ? error.message : String(error) }
      return lastSync
    } finally {
      syncing = false
    }
  }
  const syncTimer = setInterval(() => { void syncProgress() }, 15000)

  const readJson = async (req) => {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 4 * 1024 * 1024) throw new Error('body too large')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  }

  /** 静态文件：目录只认 index.html，找不到且无扩展名时回退 SPA 入口。 */
  const serveStatic = (req, res, baseDir, urlPath) => {
    let decoded
    try {
      decoded = decodeURIComponent(urlPath)
    } catch {
      res.writeHead(400).end('bad path')
      return
    }
    const target = normalize(join(baseDir, decoded))
    if (target !== baseDir && !target.startsWith(baseDir + sep)) {
      res.writeHead(403).end('forbidden')
      return
    }
    let file = target
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    const hasExtension = extname(file) !== ''
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (hasExtension) {
        res.writeHead(404).end('not found')
        return
      }
      file = join(baseDir, 'index.html')
    }
    if (!existsSync(file)) {
      res.writeHead(404).end('not found')
      return
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const cache = type.startsWith('text/html') ? 'no-store' : 'public, max-age=3600'
    res.writeHead(200, { 'content-type': type, 'cache-control': cache })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    if (type.startsWith('text/html')) {
      // 插件侧注入本地历史脚本，原站文件保持不动。
      const html = readFileSync(file, 'utf8').replace('</body>', '<script src="/__webpane/history.js" defer></script></body>')
      res.end(html)
      return
    }
    createReadStream(file).pipe(res)
  }

  const mounts = [
    { path: '/play', dir: join(root, 'play') },
    { path: '/play_puzzles', dir: join(root, 'play_puzzles') },
  ]

  for (const mount of mounts) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: mount.path,
      handler: (req, res) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        const rest = pathname.slice(mount.path.length) || '/'
        serveStatic(req, res, mount.dir, rest)
      },
    }), `dsh-webpane: static ${mount.path}`)
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/__webpane',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === '/__webpane/control' && req.method === 'GET') {
        serveSse(req, res, controllers)
        return
      }
      if (url.pathname === '/__webpane/panel' && req.method === 'GET') {
        serveSse(req, res, panels)
        return
      }
      if (url.pathname === '/__webpane/cli' && req.method === 'POST') {
        if (!sameOrigin(req)) {
          res.writeHead(403).end('cross-origin')
          return
        }
        try {
          const body = await readJson(req)
          const value = await dispatchAction(String(body.action ?? ''), body.payload ?? {}, body.session, body.client ? String(body.client) : undefined)
          void syncProgress()
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, value }))
        } catch (error) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        }
        return
      }
      if (url.pathname === '/__webpane/history.js' && req.method === 'GET') {
        try {
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
          res.end(readFileSync(join(pluginDir, 'history.js')))
        } catch (error) {
          res.writeHead(500).end(String(error))
        }
        return
      }
      if (url.pathname === '/__webpane/history' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(readHistory()))
        return
      }
      if (url.pathname === '/__webpane/completed' && req.method === 'POST') {
        if (!sameOrigin(req)) {
          res.writeHead(403).end('cross-origin')
          return
        }
        try {
          const item = await readJson(req)
          const history = readHistory()
          const items = Array.isArray(history.items) ? history.items : []
          const existing = items.find(row => row && row.puzzleId === item.puzzleId)
          if (existing === undefined) {
            items.push({
              puzzleId: String(item.puzzleId ?? ''),
              title: String(item.title ?? ''),
              completedAt: Number(item.completedAt ?? Date.now()),
              elapsedSeconds: Number(item.elapsedSeconds ?? 0),
            })
          } else if (Number(item.completedAt ?? 0) > 0 && Number(item.completedAt) < Number(existing.completedAt)) {
            existing.completedAt = Number(item.completedAt)
          }
          writeHistory({ updatedAt: Date.now(), items })
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, total: items.length }))
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: String(error) }))
        }
        return
      }
      if (url.pathname === '/__webpane/progress' && req.method === 'GET') {
        // 只读：客户端在挂 iframe 之前要拿磁盘快照，此时还没有可执行的 iframe。
        const result = { ok: true, reason: 'read-only' }
        let snapshot = null
        try { snapshot = JSON.parse(readFileSync(join(progressDir, 'local-storage.json'), 'utf8')) } catch { /* not saved yet */ }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ sync: result, snapshot }))
        return
      }
      if (url.pathname === '/__webpane/progress-push' && req.method === 'POST') {
        if (!sameOrigin(req)) {
          res.writeHead(403).end('cross-origin')
          return
        }
        try {
          const body = await readJson(req)
          const clientId = String(body.clientId ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'unknown'
          const at = Number(body.at ?? Date.now())
          const storage = (body.storage && typeof body.storage === 'object') ? body.storage : {}
          const dir = join(progressDir, 'clients')
          mkdirSync(dir, { recursive: true })
          const file = join(dir, clientId + '.json')
          let prev = null
          try { prev = JSON.parse(readFileSync(file, 'utf8')) } catch { /* none */ }
          // 同一客户端只保留较新的快照；但仍记录最近一次看到的时间
          if (!prev || at >= Number(prev.at ?? 0)) {
            writeFileSync(file, JSON.stringify({ clientId, at, url: body.url ?? '', storage, savedAt: Date.now() }, null, 1))
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, clientId, keys: Object.keys(storage).length }))
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: String(error) }))
        }
        return
      }
      if (url.pathname === '/__webpane/clients' && req.method === 'GET') {
        const dir = join(progressDir, 'clients')
        const clients = []
        try {
          for (const name of readdirSync(dir)) {
            if (!name.endsWith('.json')) continue
            try {
              const row = JSON.parse(readFileSync(join(dir, name), 'utf8'))
              clients.push({ clientId: row.clientId, at: row.at, url: row.url, keys: Object.keys(row.storage || {}).length })
            } catch { /* skip */ }
          }
        } catch { /* no dir */ }
        clients.sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0))
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ ok: true, clients }))
        return
      }
      if (url.pathname === '/__webpane/nav' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ ok: true, nav: navRequest }))
        return
      }
      if (url.pathname === '/__webpane/nav' && req.method === 'POST') {
        if (!sameOrigin(req)) {
          res.writeHead(403).end('cross-origin')
          return
        }
        try {
          const body = await readJson(req)
          const target = String(body.url ?? '')
          if (!target.startsWith('/play/')) {
            res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'url 必须以 /play/ 开头' }))
            return
          }
          navRequest = { url: target, at: Number(body.at ?? Date.now()) }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, nav: navRequest }))
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: String(error) }))
        }
        return
      }
      if (url.pathname === '/__webpane/log' && req.method === 'POST') {
        try {
          const body = await readJson(req)
          logs.push(String(body.message ?? ''))
          if (logs.length > 30) logs.shift()
        } catch { /* ignore malformed beacon */ }
        res.writeHead(204).end()
        return
      }
      if (url.pathname === '/__webpane/result' && req.method === 'POST') {
        if (!sameOrigin(req)) {
          res.writeHead(403).end('cross-origin')
          return
        }
        try {
          const body = await readJson(req)
          const waiter = pending.get(body.id)
          if (waiter !== undefined) {
            pending.delete(body.id)
            if (body.ok) waiter.resolve(body.value)
            else waiter.reject(new Error(body.error ?? 'panel error'))
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: String(error) }))
        }
        return
      }
      res.writeHead(404).end('not found')
    },
  }), 'dsh-webpane: bridge')

  ctx.effect(() => () => {
    clearInterval(syncTimer)
    for (const [, waiter] of pending) waiter.reject(new Error('plugin unloaded'))
    pending.clear()
    for (const res of [...panels, ...controllers]) {
      try { res.end() } catch { /* already closed */ }
    }
    panels.clear()
    controllers.clear()
  }, 'dsh-webpane: sockets')

  // 诊断用：暴露当前浏览器端的插件图（clientModules 由 Host 组合）。
  ctx.inject(['clientModules'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: '/__webpane/debug',
      handler: (_req, res) => {
        try {
          const graph = scope.clientModules.graph()
          const ids = graph.entries.map(entry => entry.id)
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
            rev: graph.rev,
            count: ids.length,
            hasWebpane: ids.some(id => String(id).includes('webpane')),
            controllers: controllers.size,
            panels: panels.size,
            headless: {
              available: headless.available(),
              chromePath: headless.chromePath ?? null,
              activeSessions: [...headlessSessions],
            },
            logs,
            lastSync,
            tools: (() => {
              try {
                return ctx.tools.schemas().map(schema => schema.name)
              } catch (error) {
                return ['<unavailable: ' + String(error) + '>']
              }
            })(),
            entry: ids.some(id => String(id).includes('webpane'))
              ? graph.entries.find(item => String(item.id).includes('webpane'))
              : undefined,
            ids,
          }, null, 2))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'text/plain' }).end(String(error))
        }
      },
    }), 'dsh-webpane: debug')
  })

  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(() => scope.systemPrompt.section({
      name: 'webpane:guide',
      order: 2450,
      text: () => WEBPANE_GUIDE,
    }), 'dsh-webpane: prompt guide')
    scope.effect(() => scope.systemPrompt.section({
      name: 'webpane:rules',
      order: 2460,
      text: () => MURDOKU_RULES,
    }), 'dsh-webpane: prompt rules')
  })

  ctx.tools.register({
    name: 'webpane',
    description: 'Read and drive the web page shown in the DSH right sidebar ("网页" tab). '
      + 'The page is same-origin, so it returns the live DOM: element refs, text, and click/type actions. '
      + 'Actions: open (url), state, snapshot (interactive elements + body text), text, click (ref|selector|text), '
      + 'type (ref|selector, text, submit), press (key), scroll (dy), eval (code, async allowed), back.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'open | state | snapshot | text | click | type | press | scroll | eval | back',
      },
      url: { type: 'string', description: 'open: absolute path on this origin, e.g. /play/?lang=zh_hans' },
      ref: { type: 'string', description: 'Element ref from snapshot, e.g. e12' },
      selector: { type: 'string', description: 'CSS selector, when no ref is known' },
      text: { type: 'string', description: 'click: visible text to match; type: text to enter' },
      key: { type: 'string', description: 'press: key name, e.g. Enter, Escape, ArrowDown' },
      dy: { type: 'number', description: 'scroll: vertical pixels (positive is down)' },
      code: { type: 'string', description: 'eval: JavaScript evaluated in the page, last expression is returned' },
      limit: { type: 'number', description: 'snapshot/text: maximum characters to return, default 6000' },
      submit: { type: 'boolean', description: 'type: press Enter after entering text' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const action = String(args.action ?? '')
      const limit = Number.isFinite(args.limit) ? Number(args.limit) : 6000
      try {
        const session = exec?.agent?.session?.id
        if (action === 'open') {
          const target = typeof args.url === 'string' && args.url !== '' ? args.url : entry
          const state = await askPanel('open', { url: target }, session)
          return `opened ${JSON.stringify(state)}`
        }
        const value = await dispatchAction(action, {
          url: args.url,
          ref: args.ref,
          selector: args.selector,
          text: args.text,
          key: args.key,
          dy: args.dy,
          code: args.code,
          limit,
          submit: args.submit === true,
        }, session)
        void syncProgress()
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        return text
      } catch (error) {
        return `webpane error: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
