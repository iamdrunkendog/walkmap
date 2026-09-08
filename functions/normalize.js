export function normalizePlace(item) {
  if (!item || typeof item !== 'object') return null;
  const coord = (v, limit) => {
    let n = Number(v);
    if (Math.abs(n) > limit) n /= 1e7;
    return n;
  };
  const lat = coord(item.mapy, 90);
  const lng = coord(item.mapx, 180);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (!lat && !lng)) {
    return null;
  }
  const result = {
    title: String(item.title || '').replace(/<[^>]*>/g, ''),
    address: String(item.roadAddress || item.address || ''),
    lat,
    lng,
    source: 'naver-search'
  };
  if (item.category && typeof item.category === 'string') {
    const cleanCat = item.category.replace(/<[^>]*>/g, '').trim();
    if (cleanCat) result.category = cleanCat;
  }
  if (item.link && typeof item.link === 'string') {
    const rawLink = item.link.trim();
    try {
      const u = new URL(rawLink);
      if (u.protocol === 'https:' && !u.username && !u.password) {
        result.link = rawLink;
      }
    } catch {}
  }
  return result;
}
