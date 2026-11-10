function (spec) {
  // 板书渲染器：所有元素都用「格子坐标」描述，像素位置/大小由本渲染器按格子实测计算。
  // spec = {
  //   title, caption,
  //   bands:   [{ axis:'col'|'row', items:[7,8,9], label, color }],
  //   regions: [{ r1,c1,r2,c2, label, color, style:'dashed'|'solid', fill:false }],
  //   cells:   [{ r,c, label, color, shape:'circle'|'square', size:'s'|'m'|'l' }],
  //   groups:  [{ cells:[[r,c],...], shape, size, color, label }],
  //   person:  { name, label, showCells:true, cells:[[r,c],...], color },
  //   banner:  { title:'第 24 步 · 打叉', lines:['理由 1','理由 2'], color:'#f97316' },
  // }
  // 约定：模型只说「哪些格子、什么形状、多大（s/m/l）、什么颜色、什么标签」，不碰像素。
  const keepShapes = !!spec.keepShapes
  const clear = () => {
    for (const el of [...document.querySelectorAll('[data-dsh-banner]')]) el.remove()
    if (!keepShapes) {
      for (const el of [...document.querySelectorAll('[data-dsh-anno]')]) el.remove()
    }
  }
  clear()

  const PANEL = 11000
  const SIZE = { s: 0.55, m: 0.82, l: 1.0 }
  const sizePx = (el, size) => {
    const frac = typeof size === 'number' ? size : (SIZE[size] || SIZE.m)
    const w = el.offsetWidth || 50
    const h = el.offsetHeight || 50
    return Math.max(10, Math.round(Math.min(w, h) * frac))
  }
  const COLOR = { band: '#a855f7', region: '#a855f7', cell: '#f97316', person: '#06b6d4', row: '#38bdf8' }
  const nodes = (i) => [...document.querySelectorAll('[data-cell-index="' + i + '"]')]
  const bodyOf = (i) => nodes(i).find((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 4 && r.height > 4 && getComputedStyle(el).pointerEvents !== 'none'
  }) || nodes(i)[0]
  const total = [...document.querySelectorAll('[data-cell-index]')].length
  const W = Math.round(Math.sqrt(total / 2)) || 10
  const H = W
  const idx = (r, c) => (r - 1) * W + (c - 1)
  const box = (r, c) => bodyOf(idx(r, c)).getBoundingClientRect()

  const anyCell = bodyOf(0)
  const container = anyCell.offsetParent || anyCell.parentElement
  const containerStyle = getComputedStyle(container)
  if (containerStyle.position === 'static') container.style.position = 'relative'
  const base = container.getBoundingClientRect()
  // 棋盘常被 CSS transform 缩放：rect 是视觉坐标，absolute 定位用布局坐标 → 除以 SCALE 换算
  const SCALE = (container.offsetWidth > 0 ? base.width / container.offsetWidth : 1) || 1
  const S = (v) => (v / SCALE).toFixed(2) + 'px'
  const local = (x, y) => ({
    x: (x - base.left) / SCALE + container.scrollLeft,
    y: (y - base.top) / SCALE + container.scrollTop,
  })

  const draw = (styles) => {
    const el = document.createElement('div')
    el.setAttribute('data-dsh-anno', '1')
    Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', zIndex: String(PANEL), boxSizing: 'border-box', ...styles })
    container.appendChild(el)
    return el
  }
  const tag = (text, styles) => {
    const el = document.createElement('div')
    el.setAttribute('data-dsh-anno', '1')
    el.textContent = text
    Object.assign(el.style, {
      position: 'absolute', pointerEvents: 'none', zIndex: String(PANEL + 1),
      color: '#fff', background: 'rgba(15,23,42,.88)', border: S(1) + ' solid rgba(226,232,240,.25)',
      fontSize: S(10), fontWeight: '700', padding: S(2) + ' ' + S(5), borderRadius: S(5),
      whiteSpace: 'nowrap', lineHeight: '1.2', ...styles,
    })
    container.appendChild(el)
    return el
  }

  // 1) 行/列带
  for (const band of spec.bands || []) {
    const color = band.color || (band.axis === 'row' ? COLOR.row : COLOR.band)
    const items = (band.items || []).filter((n) => n >= 1 && n <= (band.axis === 'row' ? H : W))
    for (let bi = 0; bi < items.length; bi += 1) {
      const n = items[bi]
      let tl, br
      if (band.axis === 'row') {
        tl = box(n, 1); br = box(n, W)
      } else {
        tl = box(1, n); br = box(H, n)
      }
      const p1 = local(tl.left, tl.top)
      const p2 = local(br.right, br.bottom)
      draw({
        left: p1.x + 'px', top: p1.y + 'px',
        width: (p2.x - p1.x) + 'px', height: (p2.y - p1.y) + 'px',
        background: color + '22', border: S(1.5) + ' solid ' + color, borderRadius: S(6),
      })
      if (band.label && bi === 0) {
        const at = band.axis === 'row' ? local(tl.left + 4, tl.top + 2) : local(tl.left + 2, tl.top - 16)
        tag(band.label, { left: at.x + 'px', top: at.y + 'px', background: color })
      }
    }
  }

  // 2) 矩形区域
  for (const rg of spec.regions || []) {
    const color = rg.color || COLOR.region
    const tl = box(rg.r1, rg.c1); const br = box(rg.r2, rg.c2)
    const p1 = local(tl.left, tl.top); const p2 = local(br.right, br.bottom)
    const style = rg.style === 'solid' ? 'solid' : 'dashed'
    draw({
      left: (p1.x - 3) + 'px', top: (p1.y - 3) + 'px',
      width: (p2.x - p1.x + 6) + 'px', height: (p2.y - p1.y + 6) + 'px',
      border: S(2.5) + ' ' + style + ' ' + color, borderRadius: S(8),
      background: rg.fill ? color + '18' : 'transparent',
      boxShadow: '0 0 0 ' + S(2) + ' rgba(0,0,0,.25), 0 0 ' + S(14) + ' ' + color,
    })
    if (rg.label) tag(rg.label, { left: (p1.x - 2) + 'px', top: (p1.y - 20) + 'px', background: color })
  }

  // 3) 关键格子（shape: circle/square，size: s/m/l；只用格子坐标）
  const drawCellShape = (r, c, opts) => {
    const opt = opts || {}
    const color = opt.color || COLOR.cell
    const el = bodyOf(idx(r, c))
    if (!el) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 4) return false
    const px = sizePx(el, opt.size)
    const shape = opt.shape === 'square' ? 'square' : 'circle'
    const ring = document.createElement('div')
    ring.setAttribute('data-dsh-anno', '1')
    Object.assign(ring.style, {
      position: 'absolute', left: '50%', top: '50%', width: px + 'px', height: px + 'px',
      transform: 'translate(-50%, -50%)', border: S(3) + ' solid ' + color,
      borderRadius: shape === 'circle' ? '50%' : S(6),
      boxShadow: '0 0 0 ' + S(2) + ' rgba(0,0,0,.4), 0 0 ' + S(10) + ' ' + color,
      pointerEvents: 'none', zIndex: String(PANEL + 2), boxSizing: 'border-box',
    })
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
    el.appendChild(ring)
    if (opt.label) {
      const b = document.createElement('div')
      b.setAttribute('data-dsh-anno', '1')
      b.textContent = opt.label
      Object.assign(b.style, {
        position: 'absolute', top: '-' + S(15) + '', left: '50%', transform: 'translateX(-50%)',
        color: color, fontSize: S(9.5), fontWeight: '800', whiteSpace: 'nowrap',
        textShadow: '0 1px 2px rgba(0,0,0,.65)', pointerEvents: 'none', zIndex: String(PANEL + 3),
      })
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
      el.appendChild(b)
    }
    return true
  }
  for (const cell of spec.cells || []) drawCellShape(cell.r, cell.c, cell)
  for (const group of spec.groups || []) {
    const cells = group.cells || []
    cells.forEach(([r, c], k) => drawCellShape(r, c, { ...group, label: k === 0 ? group.label : '' }))
  }

  // 4) 圈人物头像（+ 她的候选格）
  let personCells = 0
  if (spec.person && spec.person.name) {
    const color = spec.person.color || COLOR.person
    const initial = String(spec.person.name).trim()[0]
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || b.textContent || '').trim() === spec.person.name)
    if (btn) {
      const r = btn.getBoundingClientRect()
      const ring = document.createElement('div')
      ring.setAttribute('data-dsh-anno', '1')
      Object.assign(ring.style, {
        position: 'fixed', left: (r.left - 3) + 'px', top: (r.top - 3) + 'px',
        width: (r.width + 6) + 'px', height: (r.height + 6) + 'px',
        border: '3px solid ' + color, borderRadius: '10px',
        boxShadow: '0 0 0 2px rgba(0,0,0,.4), 0 0 14px ' + color,
        pointerEvents: 'none', zIndex: String(PANEL + 4), boxSizing: 'border-box',
      })
      document.body.appendChild(ring)
      if (spec.person.label) {
        const t = document.createElement('div')
        t.setAttribute('data-dsh-anno', '1')
        t.textContent = spec.person.label
        Object.assign(t.style, {
          position: 'fixed', left: r.left + 'px', top: (r.top - 20) + 'px',
          color: color, fontSize: '10px', fontWeight: '800', whiteSpace: 'nowrap',
          textShadow: '0 1px 2px rgba(0,0,0,.75)', pointerEvents: 'none', zIndex: String(PANEL + 5),
        })
        document.body.appendChild(t)
      }
    }
    if (Array.isArray(spec.person.cells) && spec.person.cells.length) {
      for (const [r, c] of spec.person.cells) {
        const el = bodyOf(idx(r, c))
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.width <= 4) continue
        const px = sizePx(el, 's')
        const ring = document.createElement('div')
        ring.setAttribute('data-dsh-anno', '1')
        Object.assign(ring.style, {
          position: 'absolute', left: '50%', top: '50%', width: px + 'px', height: px + 'px',
          transform: 'translate(-50%, -50%)', border: S(2) + ' dotted ' + color, borderRadius: '50%',
          pointerEvents: 'none', zIndex: String(PANEL + 2), boxSizing: 'border-box',
        })
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
        el.appendChild(ring)
        personCells += 1
      }
    } else if (spec.person.showCells) {
      for (let i = 0; i < W * H; i += 1) {
        const el = bodyOf(i)
        if (!el) continue
        const letters = [...el.querySelectorAll('.grid-note-letter')].map((n) => (n.textContent || '').trim())
        if (!letters.includes(initial)) continue
        const r = el.getBoundingClientRect()
        if (r.width <= 4) continue
        const size = Math.max(8, Math.round(Math.min(el.offsetWidth, el.offsetHeight) - 10))
        const ring = document.createElement('div')
        ring.setAttribute('data-dsh-anno', '1')
        Object.assign(ring.style, {
          position: 'absolute', left: '50%', top: '50%', width: size + 'px', height: size + 'px',
          transform: 'translate(-50%, -50%)', border: S(2) + ' dotted ' + color, borderRadius: '50%',
          pointerEvents: 'none', zIndex: String(PANEL + 2), boxSizing: 'border-box',
        })
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
        el.appendChild(ring)
        personCells += 1
      }
    }
  }

  // 5) 棋盘正上方的说明小窗（banner）：标题 + 若干行理由
  if (spec.banner) {
    const bn = spec.banner
    const color = bn.color || '#a855f7'
    const first = box(1, 1)
    const last = box(H, W)
    const p1 = local(first.left, first.top)
    const width = Math.round(last.right - first.left)
    const card = document.createElement('div')
    card.setAttribute('data-dsh-anno', '1')
    card.setAttribute('data-dsh-banner', '1')
    Object.assign(card.style, {
      position: 'absolute',
      background: 'rgba(15,23,42,.9)', border: S(1) + ' solid rgba(148,163,184,.28)',
      borderLeft: S(3) + ' solid ' + color, borderRadius: S(7),
      boxShadow: '0 ' + S(3) + ' ' + S(10) + ' rgba(0,0,0,.3)', padding: S(4) + ' ' + S(8),
      pointerEvents: 'none', zIndex: String(PANEL + 7), boxSizing: 'border-box',
      maxWidth: Math.round(width) + 'px',
    })
    if (bn.title) {
      const t = document.createElement('div')
      t.textContent = bn.title
      Object.assign(t.style, { color: '#94a3b8', fontSize: S(9.5), fontWeight: '700', lineHeight: '1.3', marginBottom: (bn.lines && bn.lines.length ? S(1) : '0') })
      card.appendChild(t)
    }
    for (const line of (bn.lines || []).slice(0, 2)) {
      const l = document.createElement('div')
      l.textContent = line
      Object.assign(l.style, { color: '#e2e8f0', fontSize: S(10.5), fontWeight: '600', lineHeight: '1.45' })
      card.appendChild(l)
    }
    container.appendChild(card)
    const hgt = card.offsetHeight || 30
    const w = card.offsetWidth || width
    const cellH = anyCell.offsetHeight || 50
    const upCells = typeof bn.offsetCells === 'number' ? bn.offsetCells : 1   // 默认往上挪一格
    card.style.left = Math.round(p1.x + (width - w) / 2) + 'px'
    let topLocal = p1.y - hgt - cellH * upCells - 8 / SCALE
    // 别顶出视口顶部（换算回布局坐标再夹一下）
    if (base.top + topLocal * SCALE < 4) topLocal = (4 - base.top) / SCALE
    card.style.top = topLocal + 'px'
    // 按棋盘实际中心微调两轮（消除容器 padding/边框带来的偏差）
    const boardCenter = (first.left + last.right) / 2
    let leftLocal = p1.x + (width - w) / 2
    for (let pass = 0; pass < 2; pass += 1) {
      const cr = card.getBoundingClientRect()
      const delta = (boardCenter - (cr.left + cr.width / 2)) / SCALE
      leftLocal += delta
      card.style.left = Math.round(leftLocal) + 'px'
    }
  }

  // 6) 标题 / 说明（底部板书条，可选）
  if (spec.title) {
    const el = document.createElement('div')
    el.setAttribute('data-dsh-anno', '1')
    el.textContent = spec.title
    Object.assign(el.style, {
      position: 'fixed', left: '10px', top: '8px', zIndex: String(PANEL + 6),
      background: 'rgba(88,28,135,.92)', color: '#f5f3ff', border: '1px solid rgba(196,181,253,.5)',
      fontSize: '11px', fontWeight: '800', padding: '3px 8px', borderRadius: '6px',
      pointerEvents: 'none',
    })
    document.body.appendChild(el)
  }
  if (spec.caption) {
    const el = document.createElement('div')
    el.setAttribute('data-dsh-anno', '1')
    el.textContent = spec.caption
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '12px', transform: 'translateX(-50%)',
      maxWidth: '86vw', zIndex: String(PANEL + 6),
      background: 'rgba(15,23,42,.92)', color: '#e2e8f0', border: '1px solid rgba(148,163,184,.4)',
      fontSize: '12px', fontWeight: '700', padding: '6px 10px', borderRadius: '8px',
      pointerEvents: 'none', whiteSpace: 'pre-wrap', lineHeight: '1.4',
    })
    document.body.appendChild(el)
  }

  return JSON.stringify({ ok: true, bands: (spec.bands || []).length, regions: (spec.regions || []).length, cells: (spec.cells || []).length, groups: (spec.groups || []).length, personCells })
}
