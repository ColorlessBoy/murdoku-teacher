function (cells, kind) {
  // 教学步骤改动高亮：彩色边框 + 坐标标签 + 左下角图例（第一版）
  const COLORS = { notes: '#22c55e', 'remove-notes': '#f97316', 'x-mark': '#64748b', place: '#06b6d4', deduce: '#a855f7' }
  const MARKS = { notes: '＋', 'remove-notes': '－', 'x-mark': '✕', place: '●', deduce: '·' }
  const color = COLORS[kind] || '#eab308'
  const mark = MARKS[kind] || '·'
  for (const old of [...document.querySelectorAll('[data-dsh-hl]')]) old.remove()
  for (const old of [...document.querySelectorAll('[data-dsh-hl-cell]')]) old.removeAttribute('data-dsh-hl-cell')
  for (const old of [...document.querySelectorAll('[data-dsh-num]')]) old.remove()
  const nodesOf = (i) => [...document.querySelectorAll('[data-cell-index="' + i + '"]')]
  const bodyOf = (i) => nodesOf(i).find((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 4 && r.height > 4 && getComputedStyle(el).pointerEvents !== 'none'
  }) || nodesOf(i)[0]
  const ensurePositioned = (el) => {
    if (!el) return
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
  }
  // 棋盘可能被 CSS transform 缩放：用 offsetWidth 算布局尺寸，边框/字号除以缩放比
  const scaleOf = (el) => {
    const par = el && el.offsetParent
    if (!par || !par.offsetWidth) return 1
    const r = par.getBoundingClientRect()
    return (r.width / par.offsetWidth) || 1
  }
  const W = Math.round(Math.sqrt(document.querySelectorAll('[data-cell-index]').length / 2)) || 10
  let n = 0
  for (const i of cells) {
    const el = bodyOf(i)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (rect.width <= 4) continue
    const box = document.createElement('div')
    box.setAttribute('data-dsh-hl', '1')
    Object.assign(box.style, {
      position: 'absolute', inset: '-2px', border: '3px solid ' + color,
      borderRadius: '6px', boxShadow: '0 0 0 2px rgba(0,0,0,.35), 0 0 12px ' + color,
      pointerEvents: 'none', zIndex: '999', boxSizing: 'border-box',
    })
    const badge = document.createElement('div')
    badge.textContent = mark + ' R' + (Math.floor(i / W) + 1) + 'C' + ((i % W) + 1)
    Object.assign(badge.style, {
      position: 'absolute', top: '-15px', left: '-2px', background: color, color: '#fff',
      fontSize: '10px', fontWeight: '900', padding: '1px 4px', borderRadius: '4px',
      whiteSpace: 'nowrap', pointerEvents: 'none', lineHeight: '1.2',
    })
    box.appendChild(badge)
    ensurePositioned(el)
    el.setAttribute('data-dsh-hl-cell', '1')
    el.appendChild(box)
    n += 1
  }
  const oldLegend = document.querySelector('[data-dsh-hl-legend]')
  if (oldLegend) oldLegend.remove()
  const legend = document.createElement('div')
  legend.setAttribute('data-dsh-hl-legend', '1')
  legend.textContent = '上一步改动 ' + n + ' 格（' + kind + ' ' + mark + '）'
  Object.assign(legend.style, {
    position: 'fixed', left: '10px', bottom: '10px', background: color, color: '#fff',
    fontSize: '11px', fontWeight: '800', padding: '4px 8px', borderRadius: '6px',
    zIndex: '10000', pointerEvents: 'none', opacity: '0.95',
  })
  document.body.appendChild(legend)
  return n
}
