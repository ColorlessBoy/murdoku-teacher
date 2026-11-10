export function mergeBatches(batches, maxAgeMs = 0) {
  const out = [];
  const now = Date.now();
  for (const b of batches || []) {
    if (maxAgeMs && b.ts && now - b.ts > maxAgeMs) continue;
    const keys = new Set((b.changes || []).map((c) => `${c.r},${c.c}`));
    const hit = out.find((x) => (x.changes || []).some((c) => keys.has(`${c.r},${c.c}`)));
    if (!hit) { out.push({ ...b }); continue; }
    const map = new Map((hit.changes || []).map((c) => [`${c.r},${c.c}`, c]));
    for (const c of b.changes || []) map.set(`${c.r},${c.c}`, c);
    hit.changes = [...map.values()];
    hit.board = b.board;
    hit.clues = b.clues;
    hit.title = b.title;
    hit.tabId = b.tabId;
    hit.ts = Date.now();
  }
  return out;
}
