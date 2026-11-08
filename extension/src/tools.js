import { loadState, recall } from './state.js';

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'get_board',
      description: '读取当前盘面结构化摘要：放置、笔记、X、物件、地形分组。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_cell',
      description: '读取某一格及其上下左右四邻的当前状态（放置/笔记/X/物件/地形）。',
      parameters: {
        type: 'object',
        properties: { r: { type: 'integer' }, c: { type: 'integer' } },
        required: ['r', 'c'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_clues',
      description: '读取本关所有角色及其线索原文。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export const BOARD_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'board_note',
      description: '教学演示：在盘面上写/取消某人的笔记候选（需要先在侧栏选中，本工具会自动选人并点格）。',
      parameters: { type: 'object', properties: { r: { type: 'integer' }, c: { type: 'integer' }, who: { type: 'string', description: '人物字母，如 B' }, on: { type: 'boolean' } }, required: ['r', 'c', 'who'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'board_place',
      description: '教学演示：在盘面上放置某人（长按格）。只在已确定时使用。',
      parameters: { type: 'object', properties: { r: { type: 'integer' }, c: { type: 'integer' }, who: { type: 'string' } }, required: ['r', 'c', 'who'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'board_x',
      description: '教学演示：把某格标为 X（排除）。',
      parameters: { type: 'object', properties: { r: { type: 'integer' }, c: { type: 'integer' } }, required: ['r', 'c'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'board_erase',
      description: '教学演示：清除某格的放置/笔记/X。',
      parameters: { type: 'object', properties: { r: { type: 'integer' }, c: { type: 'integer' } }, required: ['r', 'c'] },
    },
  },
];

export function toolsForMode(mode) {
  return mode === 'tutor' ? [...TOOL_DEFS, ...BOARD_TOOL_DEFS] : TOOL_DEFS;
}

function stateText(c) {
  if (!c) return '未读取';
  if (c.big) return `放置 ${c.big}`;
  if (c.notes && c.notes.length) return `笔记 ${c.notes.join('')}`;
  if (c.x) return 'X';
  if (c.obj) return `物件${c.objName ? '(' + c.objName + ')' : ''}`;
  return '空';
}

export async function execTool(puzzle, name, args = {}, tabId = null) {
  const st = await loadState(puzzle);
  const board = st.board || [];
  const at = (r, c) => board.find((x) => x.r === r && x.c === c);

  if (name.startsWith('board_')) {
    if (!tabId) return { error: 'no_tab' };
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'mm:board-action', action: { name, args } });
      if (res?.board) await recall(puzzle, { board: res.board, clues: st.clues, title: st.title });
      return { ok: !!res?.ok, action: name, cell: res?.cell || null, error: res?.error || null };
    } catch (e) {
      return { error: 'board_action_failed', message: e.message };
    }
  }

  if (name === 'get_board') {
    const placements = [], notes = [], xs = [], objs = [], areas = {}, objTypes = {};
    for (const c of board) {
      const pos = `R${c.r}C${c.c}`;
      if (c.big) placements.push(`${pos}=${c.big}`);
      if (c.notes && c.notes.length) notes.push(`${pos}:${c.notes.join('')}`);
      if (c.x) xs.push(pos);
      if (c.objName) (objTypes[c.objName] = objTypes[c.objName] || []).push(pos);
      else if (c.obj) objs.push(pos);
      if (c.area) (areas[c.area] = areas[c.area] || []).push(pos);
    }
    return {
      puzzle: st.title, type: st.type, cells: board.length,
      placements, notes: notes.slice(0, 80), x: xs.slice(0, 60), objects: objs.slice(0, 60),
      objectTypes: objTypes, areas,
    };
  }

  if (name === 'get_cell') {
    const r = Number(args.r), c = Number(args.c);
    const cell = at(r, c);
    const nb = [[-1, 0, '上'], [1, 0, '下'], [0, -1, '左'], [0, 1, '右']].map(([dr, dc, label]) => {
      const n = at(r + dr, c + dc);
      return n ? { dir: label, pos: `R${n.r}C${n.c}`, state: stateText(n), bg: n.bg || '', obj: n.objName || '' } : { dir: label, pos: `R${r + dr}C${c + dc}`, state: '未读取' };
    });
    return { pos: `R${r}C${c}`, state: cell ? stateText(cell) : '未读取', area: cell?.area || '', obj: cell?.objName || '', notes: cell?.notes || [], neighbors: nb };
  }

  if (name === 'get_clues') return { clues: st.clues || [] };



  return { error: 'unknown_tool', name };
}
