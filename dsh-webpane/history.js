/**
 * 本地「已完成」记录：把原本只存在云端（登录用户的 Firestore puzzleProgress）的通关状态
 * 改造成本地存储 + 工作区文件。
 *
 * 原站本来就有匿名本地状态存储 `mrd_catalog_v2`（app-core 里的 Z2/u2），
 * 列表页的「✓ 案件已破」「已完成 N 个」都从它读；只是通关时那条记录没写进去。
 * 所以这里补的就是那一笔：页面出现「案件已破」时写入 `mrd_catalog_v2`，
 * 同时镜像到 `localStorage.mrd_local_completed` 和 Host 的 progress/history.json。
 *
 * 由 Host 在 /play/index.html 里注入（插件侧注入，不改原站文件）。
 */
(() => {
  // ── 竞赛关入口：在关卡列表里注入一张「原生卡片」，点开是寻宝竞赛互动页。
  try {
    const CARD_ID = '__dsh_contest_card'
    const injectCard = () => {
      if (!/^\/play\/?$/.test(location.pathname)) return
      if (document.getElementById(CARD_ID)) return
      const sample = document.querySelector('.puzzle-card-tilt')
      if (!sample || !sample.parentElement) return
      const card = document.createElement('div')
      card.id = CARD_ID
      card.className = 'puzzle-card-tilt'
      card.style.cssText = 'position:relative;overflow:visible;'
      card.innerHTML = [
        '<div role="button" tabindex="0" style="position:relative;display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px;height:340px;',
        'background:linear-gradient(155deg,#f3ede2 0%,#eee8dc 50%,#e8e1d4 100%);border:2px solid rgba(160,140,100,.5);border-radius:12px;cursor:pointer;',
        'color:#2a1f0e;box-shadow:6px 6px 0 rgba(0,0,0,.30);box-sizing:border-box;font-family:inherit;text-align:center;">',
        '<svg width="14" height="14" viewBox="0 0 20 20" style="position:absolute;top:-1px;left:50%;margin-left:-7px;filter:drop-shadow(rgba(0,0,0,.3) 3px 3px 0);">',
        '<circle cx="10" cy="10" r="8" fill="#c9a227" stroke="#000" stroke-width="2"></circle><circle cx="10" cy="10" r="5" fill="#e3c04d"></circle></svg>',
        '<div style="width:100%;border-radius:8px;overflow:hidden;border:2px solid rgba(160,140,100,.45);background:#fffdf6;flex:0 0 auto;">',
        '<img src="/play_puzzles/contest/board-thumb.png" alt="" style="width:100%;height:118px;object-fit:cover;display:block;"></div>',
        '<div style="font-size:15px;font-weight:900;line-height:1.25;">寻宝 · The Treasure Hunt</div>',
        '<div style="font-size:11px;color:rgba(60,42,16,.65);font-weight:700;">竞赛题 · 24×24 · 无凶手 · 找宝藏坐标</div>',
        '<div style="margin-top:auto;display:inline-block;background:#f8f7fb;border:2px solid #000;border-radius:11px;padding:5px 14px;font-weight:900;font-size:12.5px;box-shadow:3px 3px 0 rgba(0,0,0,.35);">开始调查</div>',
        '</div>',
      ].join('')
      card.addEventListener('click', () => { location.href = '/play_puzzles/contest/index.html' })
      sample.parentElement.appendChild(card)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(injectCard, 600), { once: true })
    else setTimeout(injectCard, 600)
    setInterval(injectCard, 1500)
  } catch { /* ignore */ }

  // ── 远端跳转：Host 通过 /__webpane/nav 下发一个目标 URL，任何已打开的 /play 页面都会自己跳过去。
  //    这样即使 agent 的面板通道连不到用户浏览器（远程/多端），也能「替他点开」某一关。
  try {
    const NAV_SEEN = '__webpane_nav_seen'
    const pollNav = () => {
      fetch('/__webpane/nav', { headers: { accept: 'application/json' } })
        .then((response) => response.json())
        .then((payload) => {
          const nav = payload && payload.nav
          if (!nav || !nav.url || !nav.at) return
          const seen = Number(localStorage.getItem(NAV_SEEN) || 0)
          if (Number(nav.at) <= seen) return
          localStorage.setItem(NAV_SEEN, String(nav.at))
          const current = location.pathname + location.search
          if (current === nav.url) return
          location.assign(nav.url)
        })
        .catch(() => {})
    }
    setTimeout(pollNav, 800)
    setInterval(pollNav, 2500)
  } catch { /* ignore */ }

  const CATALOG_KEY = 'mrd_catalog_v2'
  const HISTORY_KEY = 'mrd_local_completed'

  const readJson = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {} } catch { return {} }
  }
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota */ } }

  const puzzleId = () => {
    const match = /\/play\/(puzzle-[^/?#]+)/.exec(location.pathname)
    return match ? match[1] : null
  }
  const pageTitle = () => String(document.title || '').split('|')[0].trim()

  /** 写一条本地通关记录：原站状态 + 我们自己的历史 + 工作区文件。 */
  const record = (item) => {
    const completed = readJson(HISTORY_KEY)
    if (completed[item.puzzleId] && completed[item.puzzleId].completedAt) return
    completed[item.puzzleId] = item
    writeJson(HISTORY_KEY, completed)

    // 原站的匿名本地状态（列表卡片与计数直接读它）
    const catalog = readJson(CATALOG_KEY)
    const existing = catalog[item.puzzleId] || {}
    catalog[item.puzzleId] = {
      ...existing,
      status: 'completed',
      solvedBefore: true,
      completedAt: existing.completedAt || item.completedAt,
      firstCompletionTime: existing.firstCompletionTime || item.elapsedSeconds || 0,
      lastPlayedAt: item.completedAt,
      opened: true,
      openedAt: existing.openedAt || item.completedAt,
    }
    writeJson(CATALOG_KEY, catalog)

    try {
      fetch('/__webpane/completed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item),
      }).catch(() => {})
    } catch { /* ignore */ }
  }

  let lastCheck = 0
  const check = () => {
    const now = Date.now()
    if (now - lastCheck < 800) return
    lastCheck = now
    const id = puzzleId()
    if (id === null) return
    const text = document.body ? document.body.innerText : ''
    if (!/案件已破|Case solved|Puzzle solved|Rätsel gelöst/i.test(text)) return
    const timer = Number(localStorage.getItem('mrd_timer_' + id) || 0)
    record({ puzzleId: id, title: pageTitle(), completedAt: now, elapsedSeconds: timer })
  }

  /** 启动时把工作区的 history.json 并回本地状态。 */
  const restore = () => {
    fetch('/__webpane/history', { headers: { accept: 'application/json' } })
      .then(response => response.json())
      .then((data) => {
        const items = Array.isArray(data.items) ? data.items : []
        if (items.length === 0) return
        const completed = readJson(HISTORY_KEY)
        const catalog = readJson(CATALOG_KEY)
        let changed = false
        for (const item of items) {
          if (!item || !item.puzzleId) continue
          if (!completed[item.puzzleId] || !completed[item.puzzleId].completedAt) {
            completed[item.puzzleId] = item
            changed = true
          }
          const existing = catalog[item.puzzleId] || {}
          if (existing.status === 'completed' && existing.completedAt) continue
          catalog[item.puzzleId] = {
            ...existing,
            status: 'completed',
            solvedBefore: true,
            completedAt: item.completedAt || Date.now(),
            firstCompletionTime: existing.firstCompletionTime || item.elapsedSeconds || 0,
            lastPlayedAt: item.completedAt || Date.now(),
            opened: true,
            openedAt: existing.openedAt || item.completedAt || Date.now(),
          }
          changed = true
        }
        if (changed) {
          writeJson(HISTORY_KEY, completed)
          writeJson(CATALOG_KEY, catalog)
          // 让列表按新的本地状态重算一次
          if (!puzzleId()) location.reload()
        }
      })
      .catch(() => {})
  }

  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    setTimeout(() => { scheduled = false; check() }, 250)
  }

  restore()
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, characterData: true })
  setInterval(schedule, 1500)
  schedule()
})()
