#!/usr/bin/env node
/**
 * 教学/解题的「每步例行」：一条命令完成 (state, action, state') 记录 + 教学 history 落盘。
 *
 * 用法：
 *   node teaching-step.mjs --puzzle <id> --action '<json>' --explain '一句话条件' [--note '...']
 *   node teaching-step.mjs --puzzle <id> --feedback accept|reject [--verdict-note '...']
 *
 * 做什么：
 *   1. 通过插件桥（/__webpane/cli, action=ledger-state）刷新 progress/state/<puzzle>.json；
 *   2. 读上一份 state 作为 state_before；
 *   3. 追加进 progress/ledger/<puzzle>.jsonl（调用 scripts/murdoku-ledger.mjs，MURDOKU_STATE_SOURCE=plugin）；
 *   4. 追加本步的教学记录到 progress/lessons/<puzzle>.jsonl（action + 解释 + state 前后 + 用户裁决）。
 *
 * 约定：一次只记录一个逻辑操作（one-step gate）；记录后停下向用户解释 + 提问。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = process.env.LESSON_ROOT || process.cwd()
const BASE = process.env.WEBPANE_BASE || 'http://127.0.0.1:3080'
const SESSION = process.env.DSH_SESSION_ID || ''
const LESSON_DIR = path.join(ROOT, 'progress', 'lessons')
const STATE_DIR = path.join(ROOT, 'progress', 'state')

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--puzzle') args.puzzle = argv[++i]
    else if (a === '--action') args.action = argv[++i]
    else if (a === '--explain') args.explain = argv[++i]
    else if (a === '--note') args.note = argv[++i]
    else if (a === '--feedback') args.feedback = argv[++i]
    else if (a === '--verdict-note') args.verdictNote = argv[++i]
    else if (a === '--ledger') args.ledger = argv[++i]
    else if (a === '--root') args.root = argv[++i]
    else args._.push(a)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
if (!args.puzzle) {
  console.error('usage: teaching-step.mjs --puzzle <id> (--action <json> --explain <text> | --feedback accept|reject)')
  process.exit(2)
}
if (args.root) process.env.LESSON_ROOT = args.root
const root = process.env.LESSON_ROOT || ROOT

const ledgerFile = args.ledger || path.join(root, 'progress', 'ledger', `${args.puzzle}-plugin.jsonl`)
const lessonFile = path.join(root, 'progress', 'lessons', `${args.puzzle}.jsonl`)
const lessonMd = path.join(root, 'progress', 'lessons', `${args.puzzle}.md`)
const stateFile = path.join(root, 'progress', 'state', `${args.puzzle}.json`)
fs.mkdirSync(path.dirname(lessonFile), { recursive: true })

const readLesson = () => {
  if (!fs.existsSync(lessonFile)) return []
  return fs.readFileSync(lessonFile, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
}

const refreshState = async () => {
  if (!SESSION) return
  try {
    const res = await fetch(`${BASE}/__webpane/cli`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ledger-state', payload: { puzzle: args.puzzle }, session: SESSION }),
    })
    const body = await res.json().catch(() => null)
    if (body && body.ok === false) throw new Error(body.error || 'ledger-state failed')
  } catch (error) {
    console.error('[teaching-step] 刷新 state 失败（继续用现有文件）:', String(error.message || error))
  }
}

const readState = () => {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch { return null }
}

if (args.feedback) {
  const verdict = String(args.feedback)
  if (!['accept', 'reject', 'rollback'].includes(verdict)) {
    console.error('feedback 必须是 accept|reject|rollback')
    process.exit(2)
  }
  try {
    execFileSync('node', [path.join(root, 'scripts', 'murdoku-ledger.mjs'), 'feedback', '--puzzle', args.puzzle, '--ledger', ledgerFile, '--verdict', verdict, ...(args.note ? ['--note', args.note] : [])], {
      cwd: root,
      env: { ...process.env, MURDOKU_STATE_SOURCE: 'plugin' },
      stdio: 'pipe',
    })
  } catch (error) {
    console.error('[teaching-step] ledger feedback 失败:', String(error.stdout || error.message))
    process.exit(3)
  }
  const records = readLesson()
  const last = [...records].reverse().find((r) => r.type === 'step')
  if (last) {
    const md = fs.existsSync(lessonMd) ? fs.readFileSync(lessonMd, 'utf8') : `# ${args.puzzle} · 教学记录\n\n`
    fs.writeFileSync(lessonMd, md.replace(/- 裁决：待定\s*$/m, `- 裁决：**${verdict}**${args.note ? ' — ' + args.note : ''}`) + (md.includes(last.explain) ? '' : ''))
    last.user = verdict
    last.verdictNote = args.note || args.verdictNote || ''
    last.verdictAt = Date.now()
    const lines = records.map((r) => JSON.stringify(r))
    fs.writeFileSync(lessonFile, lines.join('\n') + '\n')
  }
  console.log(JSON.stringify({ ok: true, feedback: verdict, lesson: lessonFile }, null, 1))
  process.exit(0)
}

if (!args.action) {
  console.error('缺少 --action <json>')
  process.exit(2)
}
let action
try { action = JSON.parse(args.action) } catch (error) {
  console.error('--action 不是合法 JSON:', error.message)
  process.exit(2)
}

if (!fs.existsSync(ledgerFile)) {
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true })
  fs.writeFileSync(ledgerFile, JSON.stringify({ type: 'header', version: 1, puzzle: args.puzzle, route: 'plugin', createdAt: Date.now() }) + '\n')
}

await refreshState()
const stateAfter = readState()
if (stateAfter == null) {
  console.error('[teaching-step] 没有 state 文件：先确定面板/关卡能导出（webpane.sh ledger-state）')
  process.exit(4)
}
const records = readLesson()
const prev = [...records].reverse().find((r) => r.type === 'step')
const stateBefore = prev ? prev.state_after : { puzzle: args.puzzle, placed: {}, notes: {}, xMarks: [], notesTotal: 0 }

// 1) 台账 append（门禁在 ledger 内部处理）
try {
  execFileSync('node', [
    path.join(root, 'scripts', 'murdoku-ledger.mjs'), 'append',
    '--puzzle', args.puzzle,
    '--ledger', ledgerFile,
    '--action', JSON.stringify(action),
    '--note', args.explain || args.note || '',
  ], { cwd: root, env: { ...process.env, MURDOKU_STATE_SOURCE: 'plugin' }, stdio: 'pipe' })
} catch (error) {
  const msg = String(error.stdout || error.stderr || error.message || '')
  console.error('[teaching-step] ledger append 被拒绝：\n' + msg)
  process.exit(3)
}

// 2) 教学 history
const step = (records.filter((r) => r.type === 'step').length) + 1
const record = {
  type: 'step',
  step,
  ts: Date.now(),
  puzzle: args.puzzle,
  action,
  explain: args.explain || '',
  note: args.note || '',
  state_before: { placed: stateBefore.placed || {}, notes: stateBefore.notes || {}, xMarks: stateBefore.xMarks || [], notesTotal: stateBefore.notesTotal || 0 },
  state_after: { placed: stateAfter.placed || {}, notes: stateAfter.notes || {}, xMarks: stateAfter.xMarks || [], notesTotal: stateAfter.notesTotal || 0 },
  user: 'none',
}
if (!fs.existsSync(lessonFile)) {
  fs.appendFileSync(lessonFile, JSON.stringify({ type: 'session', puzzle: args.puzzle, startedAt: Date.now(), route: 'plugin', board: 'dsh-webpane' }) + '\n')
}
fs.appendFileSync(lessonFile, JSON.stringify(record) + '\n')

// 3) 在改动过的格子上加高亮 + 坐标标签（用户回来看得见）
try {
  if (SESSION && Array.isArray(action.cells) && action.cells.length > 0) {
    const hlSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'highlight-step.js'), 'utf8').trim()
    const code = '(' + hlSrc + ')(' + JSON.stringify(action.cells) + ', ' + JSON.stringify(action.kind || '') + ')'
    await fetch(`${BASE}/__webpane/cli`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'eval', payload: { code }, session: SESSION }),
    }).catch(() => null)
  }
} catch (error) {
  console.error('[teaching-step] 高亮失败（不影响记录）:', String(error.message || error))
}

// 3.5) 棋盘正上方弹出本次操作的说明窗（板书 banner），保留前摇画的形状
try {
  if (SESSION) {
    const anSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'annotate-step.js'), 'utf8').trim()
    const KIND_COLOR = { notes: '#22c55e', 'remove-notes': '#f97316', 'x-mark': '#64748b', place: '#06b6d4', deduce: '#a855f7', prelude: '#a855f7', submit: '#eab308' }
    const KIND_CN = { notes: '加笔记', 'remove-notes': '删笔记', 'x-mark': '打叉', place: '落子', deduce: '推一步', prelude: '前摇', submit: '提交' }
    const lines = [args.explain].filter(Boolean).map((t) => String(t).slice(0, 120))
    const spec = {
      keepShapes: true,
      banner: {
        title: `第 ${step} 步 · ${KIND_CN[action.kind] || action.kind || ''}`,
        lines,
        color: KIND_COLOR[action.kind] || '#a855f7',
      },
    }
    const code = '(' + anSrc + ')(' + JSON.stringify(spec) + ')'
    await fetch(`${BASE}/__webpane/cli`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'eval', payload: { code }, session: SESSION }),
    }).catch(() => null)
  }
} catch (error) {
  console.error('[teaching-step] 说明窗渲染失败（不影响记录）:', String(error.message || error))
}

// 4) 人类可读的教学 markdown（可回放）
{
  let md = fs.existsSync(lessonMd) ? fs.readFileSync(lessonMd, 'utf8') : `# ${args.puzzle} · 教学记录\n\n`
  if (!md.endsWith('\n')) md += '\n'
  md += `\n## 第 ${step} 步 · ${action.kind}${action.who ? ' · ' + action.who : ''}\n\n`
  md += `- 操作：${action.kind}${action.cells && action.cells.length ? ' ' + JSON.stringify(action.cells) : ''}\n`
  md += `- 理由：${action.reason || ''}\n`
  md += `- 解释：${args.explain || ''}\n`
  md += `- 棋盘：placed ${Object.keys(record.state_after.placed || {}).length} 人 / 笔记 ${record.state_after.notesTotal} / X ${record.state_after.xMarks.length}\n`
  md += '- 裁决：待定\n'
  fs.writeFileSync(lessonMd, md)
}

console.log(JSON.stringify({
  ok: true,
  step,
  puzzle: args.puzzle,
  action,
  explain: args.explain || '',
  state_after: { placed: record.state_after.placed, notesTotal: record.state_after.notesTotal, xMarks: record.state_after.xMarks.length },
  lesson: lessonFile,
}, null, 1))
