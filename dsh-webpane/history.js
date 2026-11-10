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
