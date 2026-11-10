#!/usr/bin/env node
/**
 * 前摇（板书）渲染器：把一步推理要「圈哪里、框哪里、看谁」画到棋盘上，等用户接受后再执行操作。
 *
 * 用法：
 *   node prelude.mjs --spec '<json>'  [--puzzle <id>] [--record] [--who '板书'] [--title '...'] [--caption '...']
 *   node prelude.mjs --spec-file spec.json ...
 *
 * spec 结构（全部可选；**一律用格子坐标描述，不写像素**，渲染器按格子实测自动算位置/大小）：
 *   {
 *     "title": "板书 · 第 7/8/9 列",
 *     "caption": "这三列只能站 3 个人：……",
 *     "bands":   [{ "axis": "col"|"row", "items": [7,8,9], "label": "7–9 列" }],
 *     "regions": [{ "r1": 1, "c1": 7, "r2": 10, "c2": 9, "label": "三列区域", "style": "dashed"|"solid", "fill": false }],
 *     "cells":   [{ "r": 4, "c": 7, "label": "桶旁", "shape": "circle"|"square", "size": "s"|"m"|"l" }],
 *     "groups":  [{ "cells": [[4,7],[4,9],[5,8]], "shape": "square", "size": "s", "label": "桶旁" }],
 *     "person":  { "name": "Elyana", "label": "她的候选", "showCells": true, "cells": [[2,5],[2,8]] }
 *   }
 *
 * 加 --record 时会把这次板书作为 kind=prelude 的一步写进台账（state/action/state'），
 * 用户接受后再用 teaching-step.mjs 记执行步 —— 即「前摇 → 用户接受 → 执行」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.WEBPANE_BASE || 'http://127.0.0.1:3080'
const SESSION = process.env.DSH_SESSION_ID || ''

const argv = process.argv.slice(2)
const args = {}
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (a === '--record') args.record = true
  else if (a.startsWith('--')) args[a.slice(2)] = argv[++i]
}

let spec = {}
if (args['spec-file']) spec = JSON.parse(fs.readFileSync(args['spec-file'], 'utf8'))
else if (args.spec) spec = JSON.parse(args.spec)
else {
  console.error('usage: prelude.mjs --spec \'<json>\' | --spec-file <path> [--puzzle <id>] [--record]')
  process.exit(2)
}
if (args.title) spec.title = args.title
if (args.caption) spec.caption = args.caption

const src = fs.readFileSync(path.join(HERE, 'annotate-step.js'), 'utf8').trim()
const code = '(' + src + ')(' + JSON.stringify(spec) + ')'

const res = await fetch(`${BASE}/__webpane/cli`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'eval', payload: { code }, session: SESSION }),
}).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }))

console.log('[prelude] 板书已绘制:', typeof res?.data === 'string' ? res.data : JSON.stringify(res).slice(0, 200))

if (args.record && args.puzzle) {
  const cells = []
  for (const c of spec.cells || []) cells.push((c.r - 1) * 10 + (c.c - 1))
  const action = {
    kind: 'prelude',
    who: args.who || '板书',
    cells,
    annotation: spec,
    reason: spec.caption || spec.title || '前摇：提示要看的位置与将要做的操作',
  }
  execFileSync(process.execPath, [path.join(HERE, 'teaching-step.mjs'), '--puzzle', args.puzzle, '--action', JSON.stringify(action), '--explain', spec.caption || spec.title || '前摇'], { stdio: 'inherit' })
}
