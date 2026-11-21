// 地图编辑数据：本地保存 + 对局加载。
// 格式只记录「相对基础地图的改动」，所以 map.js 仍然是唯一的基础地图来源；
// 构建顺序确定性保证盒体 ID 稳定，跨次重建立可按 ID 覆写。
//
// { version: 1, moved: { [id]: {x,y,z,w,h,d} }, hidden: { [id]: true }, added: [ {...} ] }

const KEY = 'dust.sandline.mapEdits.v1';

export function emptyEdits() {
  return { version: 1, moved: {}, hidden: {}, added: [], spawns: {}, waypoints: {} };
}

export function normalizeEdits(input) {
  const out = emptyEdits();
  if (!input || typeof input !== 'object') return out;
  if (input.moved && typeof input.moved === 'object') {
    for (const [k, v] of Object.entries(input.moved)) {
      if (!v || typeof v !== 'object') continue;
      const e = {};
      for (const key of ['x', 'y', 'z', 'w', 'h', 'd']) {
        const n = Number(v[key]);
        if (Number.isFinite(n)) e[key] = n;
      }
      if (Object.keys(e).length) out.moved[k] = e;
    }
  }
  if (input.hidden && typeof input.hidden === 'object') {
    for (const k of Object.keys(input.hidden)) {
      if (input.hidden[k]) out.hidden[k] = true;
    }
  }
  const xz = (v) => {
    if (!v || typeof v !== 'object') return null;
    const x = Number(v.x);
    const z = Number(v.z);
    return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
  };
  if (input.spawns && typeof input.spawns === 'object') {
    const player = xz(input.spawns.player);
    if (player) out.spawns.player = player;
    if (input.spawns.bots && typeof input.spawns.bots === 'object') {
      for (const [k, v] of Object.entries(input.spawns.bots)) {
        const p = xz(v);
        if (p) out.spawns.bots[k] = p;
      }
    }
  }
  if (input.waypoints && typeof input.waypoints === 'object') {
    for (const [k, v] of Object.entries(input.waypoints)) {
      const p = xz(v);
      if (p) out.waypoints[k] = p;
    }
  }
  if (Array.isArray(input.added)) {
    for (const a of input.added) {
      if (!a || typeof a !== 'object') continue;
      const n = (key, def) => {
        const v = Number(a[key]);
        return Number.isFinite(v) ? v : def;
      };
      out.added.push({
        kind: typeof a.kind === 'string' ? a.kind : 'plaster',
        tag: typeof a.tag === 'string' ? a.tag : '',
        x: n('x', 0), y: n('y', 1), z: n('z', 0),
        w: Math.max(0.05, n('w', 1)),
        h: Math.max(0.05, n('h', 1)),
        d: Math.max(0.05, n('d', 1)),
        collide: a.collide !== false,
        color: a.color, repeat: a.repeat,
        roughness: a.roughness, metalness: a.metalness,
        castShadow: a.castShadow
      });
    }
  }
  return out;
}

export function countEdits(edits) {
  if (!edits) return 0;
  return Object.keys(edits.moved || {}).length +
    Object.keys(edits.hidden || {}).length +
    (edits.added ? edits.added.length : 0) +
    Object.keys(edits.spawns || {}).length +
    Object.keys(edits.spawns && edits.spawns.bots || {}).length +
    Object.keys(edits.waypoints || {}).length;
}

export function loadStoredEdits() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = normalizeEdits(JSON.parse(raw));
    return countEdits(data) ? data : null;
  } catch (err) {
    console.warn('[map-edits] 读取失败', err);
    return null;
  }
}

export function saveStoredEdits(edits) {
  try {
    localStorage.setItem(KEY, JSON.stringify(edits));
    return true;
  } catch (err) {
    console.warn('[map-edits] 保存失败', err);
    return false;
  }
}

export function clearStoredEdits() {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    console.warn('[map-edits] 清除失败', err);
  }
}

/**
 * 读取随包发布的静态地图改动（工坊「导出」→ 放到 assets/map-edits.json）。
 * 只在启动时请求一次本地文件；缺失时静默回退到基础地图。
 */
export async function fetchStaticEdits() {
  try {
    const url = new URL('../../assets/map-edits.json', import.meta.url);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = normalizeEdits(await res.json());
    return countEdits(data) ? data : null;
  } catch (err) {
    console.warn('[map-edits] 静态编辑数据读取失败', err);
    return null;
  }
}
