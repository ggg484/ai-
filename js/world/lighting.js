// 光影预设与数据层。
// 设计目标：不靠后处理堆成本，用一套可调的「太阳 + 天光 + 补光 + 雾 + 天空色 + 曝光」
// 让沙漠城镇有明确的冷暖对比和长阴影；工坊可以直接调，导出 assets/lighting.json 随包生效。

const KEY = 'dust.sandline.lighting.v1';

export const PRESETS = {
  golden: {
    label: '黄金时刻',
    sun: { azimuth: 246, elevation: 24, color: '#ffd1a1', intensity: 2.75 },
    hemi: { sky: '#a8c6e8', ground: '#c7a47a', intensity: 0.74 },
    fill: { color: '#8fb0d8', intensity: 0.4 },
    fog: { color: '#e2c6a6', near: 58, far: 235 },
    sky: { zenith: '#4a96cc', horizon: '#f6d7b0', ground: '#7ebf68', cloudiness: 0.55 },
    exposure: 1.06
  },
  noon: {
    label: '正午',
    sun: { azimuth: 225, elevation: 58, color: '#fff6e2', intensity: 2.3 },
    hemi: { sky: '#dcf0ff', ground: '#b0a58c', intensity: 1.05 },
    fill: { color: '#bfd8f0', intensity: 0.3 },
    fog: { color: '#bfe4f5', near: 62, far: 210 },
    sky: { zenith: '#4aa8e0', horizon: '#c2e6fa', ground: '#7cbf68', cloudiness: 0.55 },
    exposure: 1.02
  },
  dawn: {
    label: '清晨薄雾',
    sun: { azimuth: 80, elevation: 14, color: '#ffc39a', intensity: 2.4 },
    hemi: { sky: '#b9d2ea', ground: '#b8a080', intensity: 0.8 },
    fill: { color: '#9fb8d8', intensity: 0.35 },
    fog: { color: '#d9c9be', near: 52, far: 215 },
    sky: { zenith: '#5aa0cd', horizon: '#f0d4c0', ground: '#7cbf68', cloudiness: 0.6 },
    exposure: 1.04
  },
  dusk: {
    label: '黄昏',
    sun: { azimuth: 258, elevation: 8, color: '#ff9a63', intensity: 2.1 },
    hemi: { sky: '#7f9ec8', ground: '#b08a68', intensity: 0.55 },
    fill: { color: '#6f86b8', intensity: 0.3 },
    fog: { color: '#b98d78', near: 38, far: 185 },
    sky: { zenith: '#2f6f9c', horizon: '#f0a474', ground: '#5a7c58', cloudiness: 0.5 },
    exposure: 1.12
  },
  overcast: {
    label: '阴天',
    sun: { azimuth: 200, elevation: 48, color: '#e8e4d8', intensity: 1.15 },
    hemi: { sky: '#cfdae6', ground: '#b0a58c', intensity: 1.2 },
    fill: { color: '#c0ccd8', intensity: 0.45 },
    fog: { color: '#c8d2d6', near: 40, far: 180 },
    sky: { zenith: '#8fb0c8', horizon: '#d6e2e8', ground: '#7cbf68', cloudiness: 0.9 },
    exposure: 1.0
  },
  sandstorm: {
    label: '沙暴暖雾',
    sun: { azimuth: 240, elevation: 28, color: '#e8b878', intensity: 1.7 },
    hemi: { sky: '#c9a87c', ground: '#b08a60', intensity: 0.8 },
    fill: { color: '#d0b08a', intensity: 0.4 },
    fog: { color: '#d6b088', near: 24, far: 145 },
    sky: { zenith: '#a88a62', horizon: '#e0c090', ground: '#8a7a58', cloudiness: 0.9 },
    exposure: 1.05
  }
};

export const DEFAULT_LIGHTING = deepClone(PRESETS.golden);

function deepClone(src) {
  return JSON.parse(JSON.stringify(src));
}

function num(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function color(v, def) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : def;
}

export function normalizeLighting(input) {
  const d = DEFAULT_LIGHTING;
  const i = input && typeof input === 'object' ? input : {};
  const s = i.sun || {};
  const h = i.hemi || {};
  const f = i.fill || {};
  const fo = i.fog || {};
  const sk = i.sky || {};
  return {
    version: 1,
    sun: {
      azimuth: num(s.azimuth, d.sun.azimuth, 0, 360),
      elevation: num(s.elevation, d.sun.elevation, 1, 88),
      color: color(s.color, d.sun.color),
      intensity: num(s.intensity, d.sun.intensity, 0, 6)
    },
    hemi: {
      sky: color(h.sky, d.hemi.sky),
      ground: color(h.ground, d.hemi.ground),
      intensity: num(h.intensity, d.hemi.intensity, 0, 2.5)
    },
    fill: {
      color: color(f.color, d.fill.color),
      intensity: num(f.intensity, d.fill.intensity, 0, 2.5)
    },
    fog: {
      color: color(fo.color, d.fog.color),
      near: num(fo.near, d.fog.near, 5, 200),
      far: num(fo.far, d.fog.far, 30, 420)
    },
    sky: {
      zenith: color(sk.zenith, d.sky.zenith),
      horizon: color(sk.horizon, d.sky.horizon),
      ground: color(sk.ground, d.sky.ground),
      cloudiness: num(sk.cloudiness, d.sky.cloudiness, 0, 1)
    },
    exposure: num(i.exposure, d.exposure, 0.5, 2)
  };
}

export function cloneLighting(data) {
  return JSON.parse(JSON.stringify(normalizeLighting(data)));
}

export function presetLighting(id) {
  const p = PRESETS[id] || PRESETS.golden;
  return normalizeLighting(p);
}

export function loadStoredLighting() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizeLighting(JSON.parse(raw));
  } catch (err) {
    console.warn('[lighting] 读取本机光照失败', err);
    return null;
  }
}

export function saveStoredLighting(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeLighting(data)));
    return true;
  } catch (err) {
    console.warn('[lighting] 保存本机光照失败', err);
    return false;
  }
}

export function clearStoredLighting() {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    console.warn('[lighting] 清除本机光照失败', err);
  }
}

/** 随包发布的光照：assets/lighting.json（工坊「导出」覆盖即可）。 */
export async function fetchStaticLighting() {
  try {
    const url = new URL('../../assets/lighting.json', import.meta.url);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return normalizeLighting(await res.json());
  } catch (err) {
    console.warn('[lighting] 读取静态光照失败', err);
    return null;
  }
}
