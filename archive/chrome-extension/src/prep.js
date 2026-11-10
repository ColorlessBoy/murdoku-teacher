import { callLLM } from './llm.js';

export function formatPrepBoard(board) {
  const placements = [], objects = [], areas = {};
  for (const c of board || []) {
    if (!c) continue;
    const pos = `R${c.r}C${c.c}`;
    if (c.big) placements.push(`${pos}=${c.big}`);
    if (c.objName) objects.push(`${pos}(${c.objName})`);
    if (c.area) (areas[c.area] = areas[c.area] || []).push(pos);
  }
  return [
    `放置：${placements.join('、') || '无'}`,
    `物件：${objects.join('、') || '无'}`,
    `区域：${Object.entries(areas).map(([k, v]) => `${k}: ${v.join('、')}`).join('；') || '无'}`,
  ].join('\n');
}

export async function prepare({ puzzle, board, clues, settings }) {
  const system = `你是 Murdoku 逻辑解谜专家。你在为考官私下备课，内容绝不向学生展示。
机制：每行、每列恰好一个人；区域/房间是否必须有人以游戏规则为准（本关可能没有“每区域必须有人”）；物件可占多格，椅子/床可坐人，桌子/架子/电视等阻挡；beside=正交相邻且同一房间。
只做纯逻辑推理，不做枚举/试错/猜测；推不出就写“未确定”，不要编。
输出 JSON（不要 markdown）：
{"solution":[{"r":1,"c":1,"who":"A"}],"chain":["前提→规则→结论", "..."],"pitfalls":["易错点"]}
solution 给最终落子（不确定的格不要写）；chain 给前 8 步可检验的强制链；pitfalls 给 2-4 条。`;

  const user = `人物与线索：
${clues || '（未读取）'}

盘面物件/区域（学生笔记/X 不是题目条件，可忽略）：
${formatPrepBoard(board)}

请私下解这道题并输出 JSON。`;

  const payload = await callLLM({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    settings: { ...settings, maxTokens: 8192 },
    expectJson: true,
    timeoutMs: 60000,
    session: 'ses_prep_' + encodeURIComponent(String(puzzle)).slice(0, 50),
    puzzle: 'prep:' + puzzle,
  });
  return payload.json || null;
}
