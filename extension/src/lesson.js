const cache = new Map();

export async function loadBundledLesson(puzzle) {
  const slug = String(puzzle || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!slug) return null;
  if (cache.has(slug)) return cache.get(slug);
  try {
    const res = await fetch(chrome.runtime.getURL(`lessons/${slug}.json`), { cache: 'no-store' });
    if (!res.ok) { cache.set(slug, null); return null; }
    const data = await res.json();
    cache.set(slug, data);
    return data;
  } catch (e) {
    cache.set(slug, null);
    return null;
  }
}
