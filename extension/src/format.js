export function tighten(text, mode = 'exam') {
  const src = String(text || '').trim();
  const lines = src.split('\n').map((x) => x.trim()).filter(Boolean);
  const vm = src.match(/结论[:：]\s*(VALID BUT INCOMPLETE|VALID|GAP|INVALID|UNPROVEN)/i);
  const q = [...lines].reverse().find((l) => /[？?]/.test(l)) || '';
  if (mode === 'exam' && /应标|应放|正确的是|下一步是|排除它/.test(src)) {
    return ('结论：' + (vm ? vm[1].toUpperCase() : 'GAP') + '\n你的依据是什么？').slice(0, 180);
  }
  if (mode === 'exam' && vm && !q) {
    return ('结论：' + vm[1].toUpperCase() + '\n你的依据是什么？').slice(0, 180);
  }
  if (vm) return ('结论：' + vm[1].toUpperCase() + (q ? '\n' + q.slice(0, 110) : '')).slice(0, 180);
  if (src.length <= 160) return src;
  const first = lines[0] || '';
  if (q && q !== first) return (first + '\n' + q).slice(0, 220);
  return src.slice(0, 160) + '…';
}

export function condense(text) {
  const src = String(text || '');
  let removed = 0;
  const lines = src.split('\n').map((line) => {
    if (!/R\d+C\d+[^\n]*未证明/.test(line)) return line;
    removed += (line.match(/R\d+C\d+/g) || []).length;
    return '';
  }).filter((l) => l.trim() !== '');
  if (!removed) return src;
  const head = `（${removed} 格“未证明”已省略；只保留结论与问题。）`;
  return head + '\n' + lines.join('\n');
}
