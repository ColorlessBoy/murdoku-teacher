const PREFIX = 'mm_state_';

function storeKey(puzzle) {
  return PREFIX + encodeURIComponent(String(puzzle || 'unknown')).slice(0, 90);
}

const emptyState = () => ({ type: 'murdoku', title: '', clues: [], board: [], facts: [], lastMarks: [], prep: null, prepStatus: 'idle', prepAt: 0, clearedAt: 0, updatedAt: 0 });

export async function loadState(puzzle) {
  const key = storeKey(puzzle);
  const { [key]: st } = await chrome.storage.local.get(key);
  const out = { ...emptyState(), ...(st || {}) };
  for (const k of ['clueCells', 'terrain', 'objTypes', 'boardFacts']) delete out[k];
  return out;
}

async function save(puzzle, st) {
  st.updatedAt = Date.now();
  await chrome.storage.local.set({ [storeKey(puzzle)]: st });
}

function inferType(title, puzzle) {
  return /minigolf|高尔夫/i.test(`${title || ''} ${puzzle || ''}`) ? 'minigolf' : 'murdoku';
}

export async function recall(puzzle, patch = {}) {
  const st = await loadState(puzzle);
  if (patch.title) st.title = patch.title;
  if (patch.clues) {
    const add = Array.isArray(patch.clues) ? patch.clues : String(patch.clues).split('\n');
    st.clues = [...new Set([...(st.clues || []), ...add.map((x) => String(x).trim()).filter(Boolean)])].slice(-40);
  }
  if (Array.isArray(patch.board) && patch.board.length) st.board = patch.board;
  st.type = inferType(st.title, puzzle);
  await save(puzzle, st);
  return st;
}

export async function addFact(puzzle, text, verdict = null) {
  const t = String(text || '').trim();
  if (t.length < 4) return null;
  const st = await loadState(puzzle);
  const found = (st.facts || []).find((f) => f.text === t);
  if (found) {
    if (verdict) found.verdict = verdict;
  } else {
    st.facts = [...(st.facts || []), { ts: Date.now(), text: t.slice(0, 500), verdict }].slice(-24);
  }
  await save(puzzle, st);
  return st;
}

export function buildBrief(st, { focus = '', ledger = '', userText = '', chat = [] } = {}) {
  const lines = [];
  lines.push(`【关卡】${st.title || '(未读取标题)'}（${st.type}）`);
  if (st.type === 'minigolf') {
    lines.push('【本关规则】每行、每列各一人；没有“每间区域必须有人”。嫌疑人只能放在可用格（不能放在桌子、树、仙人掌、木桶等物件格上）；点击嫌疑人=选择，点击格子=笔记，长按格子=放置，X=排除。区域名（沙地/小径/水域/沙漠/岛屿/步道/入口/木桶区）用于线索，不是占位约束。');
  } else {
    lines.push('【本关规则】每行、每列各一人；每间房不能空；物件可占多格，椅子/床可坐人，桌子/架子/电视阻挡。');
  }
  if (st.clues && st.clues.length) lines.push('【可见线索/规则】\n' + st.clues.slice(-16).join('\n'));

  const board = st.board || [];
  const pl = [], no = [], xs = [], ob = [];
  for (const c of board) {
    if (!c) continue;
    const pos = `R${c.r}C${c.c}`;
    if (c.big) pl.push(`${pos}=${c.big}`);
    if (c.notes && c.notes.length) no.push(`${pos}:${c.notes.join('')}`);
    if (c.x) xs.push(pos);
    if (c.obj) ob.push(pos + (c.objName ? `(${c.objName})` : ''));
  }
  lines.push(`【盘面】\n放置：${pl.join('、') || '无'}\n笔记：${no.slice(0, 60).join('、') || '无'}\nX：${xs.slice(0, 40).join('、') || '无'}\n物件：${ob.slice(0, 40).join('、') || '无'}`);

  const areas = {};
  const objGroups = {};
  for (const c of board) {
    if (!c) continue;
    const pos = `R${c.r}C${c.c}`;
    if (c.area) (areas[c.area] = areas[c.area] || []).push(pos);
    if (c.objName) (objGroups[c.objName] = objGroups[c.objName] || []).push(pos);
  }
  if (Object.keys(areas).length) lines.push('【区域】\n' + Object.entries(areas).map(([k, v]) => `${k}: ${v.join('、')}`).join('\n'));
  if (Object.keys(objGroups).length) lines.push('【物件语义】\n' + Object.entries(objGroups).map(([k, v]) => `${k}: ${v.join('、')}`).join('\n'));

  if (focus) lines.push('【焦点格】\n' + focus);

  if (st.prep) {
    const chain = (st.prep.chain || []).slice(0, 8).map((x, i) => `${i + 1}. ${x}`).join('\n');
    const sol = (st.prep.solution || []).slice(0, 30).map((x) => `R${x.r}C${x.c}=${x.who}`).join('、');
    const pit = (st.prep.pitfalls || []).slice(0, 4).join('；');
    lines.push('【备课（私有，绝不向学生透露答案/下一步/提示）】\n' +
      (st.prep.murderer ? `凶手：${st.prep.murderer}（绝不能说）\n` : '') +
      (chain || '（无推理链）') +
      (sol ? `\n参考解：${sol}（仅供核对，不直接引用）` : '') +
      (pit ? `\n易错点：${pit}` : '') +
      '\n备课可能有误，仍以线索与盘面可检验的强制链为准。');
  }

  if (st.lastMarks && st.lastMarks.length) {
    lines.push('【我上次圈出】' + st.lastMarks.map((m) => `R${m.r}C${m.c}`).join('、'));
  }



  if (st.facts && st.facts.length) {
    lines.push('【学生说过/已确认】（可能未验证）\n' + st.facts.slice(-8).map((f) => `- ${f.text}${f.verdict ? `（判定 ${f.verdict}）` : ''}`).join('\n'));
  }

  if (ledger && !/无未解决项/.test(ledger)) lines.push('【开放问题】\n' + ledger);

  if (st.clearedAt) {
    let t = '';
    try { t = new Date(st.clearedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); } catch (e) {}
    lines.push(`【状态】盘面已于 ${t} 清空；清空前的账本、主张、标注全部作废，不要再追问清空前的逻辑。`);
  }

  const recent = (chat || []).filter((m) => !st.clearedAt || (m.ts || 0) >= st.clearedAt);
  if (recent.length) {
    lines.push('【最近两轮】\n' + recent.slice(-2).map((m) => `${m.role === 'you' ? '学生' : '墨墨'}：${String(m.text).slice(0, 300)}`).join('\n'));
  }
  if (userText) lines.push('【学生这句】' + String(userText).slice(0, 500));
  return lines.join('\n\n');
}


export async function clearFacts(puzzle) {
  const st = await loadState(puzzle);
  st.facts = [];
  st.lastMarks = [];
  st.prep = null;
  st.clearedAt = Date.now();
  await save(puzzle, st);
  return st;
}

export async function resetBoardState(puzzle) {
  const st = await loadState(puzzle);
  st.board = [];
  await save(puzzle, st);
  return st;
}


export async function saveMarks(puzzle, marks) {
  const st = await loadState(puzzle);
  st.lastMarks = (marks || []).slice(0, 12).map((m) => ({ r: m.r, c: m.c, label: m.label || `R${m.r}C${m.c}`, kind: m.kind || 'ask' }));
  await save(puzzle, st);
  return st;
}


export async function savePrep(puzzle, prep) {
  const st = await loadState(puzzle);
  st.prep = prep || null;
  st.prepStatus = prep ? 'done' : 'failed';
  st.prepAt = Date.now();
  await save(puzzle, st);
  return st;
}


export async function savePrepStatus(puzzle, status) {
  const st = await loadState(puzzle);
  st.prepStatus = status;
  st.prepAt = Date.now();
  await save(puzzle, st);
  return st;
}
