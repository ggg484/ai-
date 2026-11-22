// 武器 / 人物模型的可调参数：默认值 + 本机保存 + 随包静态文件。
// 这些数值由「模型工坊」（?rig=1）调整并导出，游戏运行时直接读取。

const WEAPON_KEY = 'dust.sandline.weaponRig.v1';
const CHAR_KEY = 'dust.sandline.charRig.v1';

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function num(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function vec3(v, def) {
  if (!Array.isArray(v) || v.length < 3) return def.slice();
  return [num(v[0], def[0]), num(v[1], def[1]), num(v[2], def[2])];
}

const RIFLE = { pos: [0.29, -0.25, -0.60], rot: [0.01, 0.03, -0.03], scale: 0.72 };
const AWP = { pos: [0.30, -0.255, -0.66], rot: [0.01, 0.035, -0.03], scale: 0.62 };
const SMG = { pos: [0.27, -0.235, -0.54], rot: [0.02, 0.04, -0.03], scale: 0.78 };
const PISTOL = { pos: [0.25, -0.225, -0.47], rot: [0.02, 0.04, -0.03], scale: 0.82 };
const DEAGLE = { pos: [0.25, -0.23, -0.48], rot: [0.02, 0.04, -0.03], scale: 0.80 };
const KNIFE = { pos: [0.25, -0.21, -0.42], rot: [0.10, -0.15, -0.06], scale: 0.82 };

export const DEFAULT_WEAPON_RIG = {
  version: 1,
  weapons: {
    ak: clone(RIFLE), m4: clone(RIFLE), awp: clone(AWP), mp9: clone(SMG),
    glock: clone(PISTOL), usp: clone(PISTOL), deagle: clone(DEAGLE),
    knife: clone(KNIFE)
  }
};

export const DEFAULT_CHAR_RIG = {
  version: 1,
  scale: 1,
  mount: { offset: [0, 0.07, -0.06], tilt: [-0.04, 0, 0] },
  pose: {
    rightArm: [-0.55, -0.30, -0.52],
    rightForeArm: [-0.55, 0, 0],
    leftArm: [-0.50, 0.40, 0.62],
    leftForeArm: [-0.75, 0, 0.1],
    spine: [0.05, 0, 0]
  },
  crouchDrop: 0.26
};

export function normalizeWeaponRig(input) {
  const out = clone(DEFAULT_WEAPON_RIG);
  if (!input || !input.weapons) return out;
  for (const id of Object.keys(out.weapons)) {
    const src = input.weapons[id];
    if (!src) continue;
    const def = out.weapons[id];
    out.weapons[id] = {
      pos: vec3(src.pos, def.pos),
      rot: vec3(src.rot, def.rot),
      scale: Math.max(0.3, Math.min(2, num(src.scale, def.scale)))
    };
  }
  return out;
}

export function normalizeCharRig(input) {
  const out = clone(DEFAULT_CHAR_RIG);
  if (!input) return out;
  out.scale = Math.max(0.6, Math.min(1.6, num(input.scale, out.scale)));
  if (input.mount) {
    out.mount.offset = vec3(input.mount.offset, out.mount.offset);
    out.mount.tilt = vec3(input.mount.tilt, out.mount.tilt);
  }
  if (input.pose) {
    for (const k of Object.keys(out.pose)) {
      out.pose[k] = vec3(input.pose[k], out.pose[k]);
    }
  }
  out.crouchDrop = Math.max(0, Math.min(0.5, num(input.crouchDrop, out.crouchDrop)));
  return out;
}

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export function loadWeaponRig() {
  return normalizeWeaponRig(readLocal(WEAPON_KEY));
}

export function saveWeaponRig(rig) {
  try { localStorage.setItem(WEAPON_KEY, JSON.stringify(normalizeWeaponRig(rig))); } catch (e) { /* 隐私模式忽略 */ }
}

export function loadCharRig() {
  return normalizeCharRig(readLocal(CHAR_KEY));
}

export function saveCharRig(rig) {
  try { localStorage.setItem(CHAR_KEY, JSON.stringify(normalizeCharRig(rig))); } catch (e) { /* 隐私模式忽略 */ }
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

export async function fetchStaticWeaponRig() {
  return normalizeWeaponRig(await fetchJson(new URL('../../assets/weapon-rig.json', import.meta.url).href));
}

export async function fetchStaticCharRig() {
  return normalizeCharRig(await fetchJson(new URL('../../assets/character-rig.json', import.meta.url).href));
}
