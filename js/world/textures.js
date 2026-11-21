// 程序化 PBR 材质库：反照率 + 法线 + 粗糙度，全部离线生成，不依赖外部贴图。
// 目标：不追求 3A，但要有「扫描材质」的密度——近看有颗粒与勾缝，远看没有平铺感。
// 正式资产替换点仍是 assets/textures/ 与 docs/ART-PIPELINE.md。

import * as THREE from '../../vendor/three.module.js';
import { PALETTE, surfaceMaterial, flatMaterial } from '../render/roblox.js';

const cache = new Map();

/* ------------------------------------------------------------------ */
/* 卡通表层：结构件走哑光纯色（无凸点、无积木棱角）                      */
/* ------------------------------------------------------------------ */

// 需要颗粒感的表面（大面积墙、地、木）
const RBX_SURF = {
  sand: PALETTE.base,          // 草地底板
  plaster: PALETTE.wall,       // 米黄墙
  sandstone: PALETTE.wallDark, // 墙裙/装饰
  brick: PALETTE.wallDark,     // 原先的砖面 → 干净的深米黄
  concrete: PALETTE.path,      // 混凝土 / 石路
  marble: PALETTE.frame,       // 大厅石材 → 暖白
  fabric: PALETTE.roof,        // 布篷 → 红
  wood: PALETTE.door           // 木门 / 木箱
};

// 纯色零件（金属、屋顶）
const RBX_FLAT = {
  metal: PALETTE.metal,
  darkmetal: PALETTE.dark,
  gold: PALETTE.gold,
  roof: PALETTE.roof
};

function robloxMaterial(kind, opts) {
  const surf = RBX_SURF[kind];
  const flat = RBX_FLAT[kind];
  const baseHex = surf != null ? surf : flat;
  const key = 'rbx:' + kind + ':' + (opts.color || '') + ':' + (opts.vertexColors ? 'vc' : '') +
    ':' + (opts.opacity != null ? opts.opacity : 1) + ':' + (opts.side != null ? opts.side : 0) +
    ':' + (opts.repeatX || '') + 'x' + (opts.repeatY || '');
  if (cache.has(key)) return cache.get(key);

  let m;
  if (surf != null) {
    m = surfaceMaterial(baseHex, {
      vertexColors: opts.vertexColors,
      opacity: opts.opacity,
      side: opts.side
    });
    if (opts.color != null) {
      // 带颜色的变体必须复制一份，避免把缓存里的共享材质改花
      m = m.clone();
      m.color.multiply(new THREE.Color(opts.color));
    }
  } else {
    m = flatMaterial(baseHex, { vertexColors: opts.vertexColors, side: opts.side });
    if (opts.color != null) {
      m = m.clone();
      m.color.multiply(new THREE.Color(opts.color));
    }
    if (opts.opacity != null && opts.opacity < 1) {
      m = m.clone();
      m.transparent = true;
      m.opacity = opts.opacity;
    }
  }
  cache.set(key, m);
  return m;
}

/* ------------------------------------------------------------------ */
/* CC0 扫描材质（ambientCG）                                            */
/* ------------------------------------------------------------------ */

// 只在启动时加载一次；运行时仍用程序化贴图兜底。
const PHOTO_BASE = new URL('../../assets/textures/photo/', import.meta.url).href;
const PHOTO_KINDS = new Set(['sand', 'plaster', 'brick', 'concrete', 'metal', 'wood', 'sandstone', 'fabric', 'marble', 'polymer']);
const photoSources = new Map();
const photoReady = new Set();
const photoUpgraded = new Map();
const materialRegistry = [];

async function loadOne(loader, url, srgb) {
  const tex = await loader.loadAsync(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 预加载 CC0 扫描贴图，并把已创建的同 kind 材质就地升级。失败则保留程序化贴图。 */
export async function loadPhotoTextures() {
  const loader = new THREE.TextureLoader();
  await Promise.all([...PHOTO_KINDS].map(async (kind) => {
    if (photoReady.has(kind)) return;
    try {
      const [color, normal, rough] = await Promise.all([
        loadOne(loader, PHOTO_BASE + kind + '_color.webp', true),
        loadOne(loader, PHOTO_BASE + kind + '_normal.webp', false),
        loadOne(loader, PHOTO_BASE + kind + '_rough.webp', false)
      ]);
      photoSources.set(kind, { color, normal, rough });
      photoReady.add(kind);
    } catch (err) {
      console.warn('[textures] CC0 材质加载失败，保留程序化贴图：' + kind, err && err.message);
    }
  }));
  applyPhotoTextures();
  return photoReady.size;
}

function photoTex(kind, repeat) {
  const key = kind + '|' + repeat;
  if (photoUpgraded.has(key)) return photoUpgraded.get(key);
  const src = photoSources.get(kind);
  if (!src) return null;
  const mk = (tex) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 4;
    return t;
  };
  const out = { map: mk(src.color), normalMap: mk(src.normal), roughnessMap: mk(src.rough) };
  photoUpgraded.set(key, out);
  return out;
}

/** 给武器/道具用：取已加载的 CC0 贴图组；未加载返回 null。 */
export function getPhotoMaps(kind, repeat) {
  if (!photoReady.has(kind)) return null;
  return photoTex(kind, repeat || 1);
}

function applyPhotoTextures() {
  for (const rec of materialRegistry) {
    const tex = photoTex(rec.kind, rec.repeat);
    if (!tex) continue;
    rec.mat.map = tex.map;
    rec.mat.normalMap = tex.normalMap;
    rec.mat.roughnessMap = tex.roughnessMap;
    rec.mat.normalScale.set(0.85, 0.85);
    // 扫描贴图普遍偏亮：大厅大理石与墙面压回暖灰，避免整体过曝。
    if (rec.kind === 'marble') {
      rec.mat.color.setHex(0x9a9183);
      rec.mat.roughness = 0.42;
    } else if (rec.kind === 'plaster') {
      rec.mat.color.setHex(0xe8dac4);
    }
    rec.mat.needsUpdate = true;
  }
  console.info('[textures] CC0 材质已接入：' + [...photoReady].join(', '));
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + (seed || 0) * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, oct, seed) {
  let v = 0, amp = 0.5, f = 1, total = 0;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x * f, y * f, (seed || 0) + i * 17) * amp;
    total += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / total;
}

/** 由高度图生成法线图（Sobel）。strength 控制浮雕强度。 */
function normalFromHeight(heightCanvas, strength) {
  const size = heightCanvas.width;
  const hctx = heightCanvas.getContext('2d');
  const src = hctx.getImageData(0, 0, size, size).data;
  const out = canvas(size);
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  const d = img.data;
  const s = strength == null ? 2.4 : strength;
  const at = (x, y) => {
    const xx = (x + size) % size, yy = (y + size) % size;
    return src[(yy * size + xx) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * s;
      const dy = (at(x, y + 1) - at(x, y - 1)) * s;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function heightCanvas(size) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** 粗糙度图：基值 + 噪声斑块（脏的地方更粗糙，湿痕更光滑）。 */
function roughnessCanvas(size, base, variance, wet) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size * 6, y / size * 6, 4, 91);
      let v = base + (n - 0.5) * variance;
      if (wet) v -= Math.max(0, fbm(x / size * 3.1, y / size * 3.1, 3, 7) - 0.62) * wet;
      v = Math.max(8, Math.min(250, v));
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function speckle(ctx, size, count, colors, maxR) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const r = 0.4 + Math.random() * (maxR || 2.2);
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function blob(ctx, size, count, color, alpha, maxR) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 8 + Math.random() * (maxR || 36);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 细颗粒：直接写 ImageData，比几千个 arc 快且密。 */
function grain(ctx, size, amount, seed) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (hash2(i & 0xff, (i >> 8) & 0xff, seed) - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------ */
/* 各类表面                                                            */
/* ------------------------------------------------------------------ */

function makeSand(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#c9a878';
  x.fillRect(0, 0, size, size);
  // 大尺度色斑：风蚀形成的明暗带
  for (let i = 0; i < 22; i++) {
    const y = Math.random() * size;
    const g = x.createLinearGradient(0, y - 18, 0, y + 26);
    g.addColorStop(0, 'rgba(150,112,70,0)');
    g.addColorStop(0.5, 'rgba(150,112,70,' + (0.03 + Math.random() * 0.06) + ')');
    g.addColorStop(1, 'rgba(226,199,154,0)');
    x.fillStyle = g;
    x.fillRect(0, y - 18, size, 44);
  }
  blob(x, size, 16, '#8f6f48', 0.10, 54);
  blob(x, size, 10, '#e2c79a', 0.12, 46);
  speckle(x, size, Math.round(size * 28), ['#b8905f', '#d8b98a', '#a37f52', '#e6d0a8'], 1.4);
  // 碎石与脚印压痕
  for (let i = 0; i < size * 0.35; i++) {
    x.fillStyle = 'rgba(92,70,46,' + (0.25 + Math.random() * 0.4) + ')';
    const r = 0.6 + Math.random() * 1.5;
    x.beginPath();
    x.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    x.fill();
  }
  grain(x, size, 10, 3);

  const h = heightCanvas(size), hx = h.getContext('2d');
  hx.fillStyle = '#7a7a7a';
  hx.fillRect(0, 0, size, size);
  const img = hx.getImageData(0, 0, size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const n = fbm(xx / size * 9, y / size * 9, 4, 12);
      const ripple = Math.sin((xx / size) * 60 + n * 5) * 4;
      const v = 118 + n * 20 + ripple;
      const i = (y * size + xx) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v));
      d[i + 3] = 255;
    }
  }
  hx.putImageData(img, 0, 0);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 214, 26, 12) };
}

function makeSandstone(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#c2a173';
  x.fillRect(0, 0, size, size);
  // 水平砌块，错缝
  const bh = Math.round(size / 8), bw = Math.round(size / 3.2);
  const h = heightCanvas(size), hx = h.getContext('2d');
  hx.fillStyle = '#5a5a5a';
  hx.fillRect(0, 0, size, size);
  for (let row = 0; row < 9; row++) {
    const off = row % 2 ? -bw / 2 : 0;
    for (let col = -1; col < 5; col++) {
      const bx = col * bw + off + 3;
      const by = row * bh + 3;
      const w = bw - 6, hh = bh - 6;
      const tone = 186 + Math.random() * 28;
      x.fillStyle = 'rgb(' + Math.round(tone) + ',' + Math.round(tone * 0.82) + ',' + Math.round(tone * 0.59) + ')';
      x.fillRect(bx, by, w, hh);
      // 砖面颗粒与边角崩口
      x.fillStyle = 'rgba(255,255,255,.07)';
      x.fillRect(bx, by, w, 2);
      x.fillStyle = 'rgba(80,58,36,.18)';
      x.fillRect(bx, by + hh - 2, w, 2);
      for (let i = 0; i < 9; i++) {
        x.fillStyle = 'rgba(92,68,42,' + (0.05 + Math.random() * 0.12) + ')';
        const ex = bx + (Math.random() < 0.5 ? Math.random() * 5 : w - Math.random() * 5);
        const ey = by + (Math.random() < 0.5 ? Math.random() * 4 : hh - Math.random() * 4);
        x.fillRect(ex, ey, 1 + Math.random() * 4, 1 + Math.random() * 3);
      }
      hx.fillStyle = 'rgb(' + Math.round(178 + Math.random() * 24) + ',178,178)';
      hx.fillRect(bx, by, w, hh);
      hx.fillStyle = 'rgba(40,40,40,.55)';
      hx.fillRect(bx, by, w, 2);
      hx.fillRect(bx, by + hh - 2, w, 2);
    }
  }
  speckle(x, size, Math.round(size * 10), ['rgba(70,50,30,.20)', 'rgba(240,220,180,.14)'], 1.6);
  blob(x, size, 8, '#7d5f3e', 0.08, 60);
  grain(x, size, 12, 21);
  // 高度：给砌块加噪点
  const himg = hx.getImageData(0, 0, size, size), hd = himg.data;
  for (let i = 0; i < hd.length; i += 4) {
    if (hd[i] < 150) continue;
    const n = (hash2(i & 0xff, (i >> 8) & 0xff, 4) - 0.5) * 14;
    hd[i] = Math.max(0, Math.min(255, hd[i] + n));
  }
  hx.putImageData(himg, 0, 0);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 208, 24, 18) };
}

function makePlaster(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#cabb9f';
  x.fillRect(0, 0, size, size);
  blob(x, size, 16, '#a08e72', 0.10, 52);
  blob(x, size, 12, '#e0d5bd', 0.14, 46);
  speckle(x, size, Math.round(size * 6), ['#b3a284', '#d8ccb4'], 1.2);
  // 裸露的砖/石补丁：Dust2 墙面的关键识别特征
  for (let p = 0; p < 2; p++) {
    const px = (p % 2 ? 0.55 : 0.12) * size + Math.random() * size * 0.16;
    const py = (p < 2 ? 0.16 : 0.62) * size + Math.random() * size * 0.12;
    const pw = size * (0.14 + Math.random() * 0.10);
    const ph = size * (0.09 + Math.random() * 0.06);
    x.fillStyle = 'rgba(150,126,98,.30)';
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + pw * 0.9, py + ph * 0.08);
    x.lineTo(px + pw, py + ph * 0.75);
    x.lineTo(px + pw * 0.7, py + ph);
    x.lineTo(px + pw * 0.08, py + ph * 0.9);
    x.closePath();
    x.fill();
    x.strokeStyle = 'rgba(78,58,40,.45)';
    x.lineWidth = 1;
    for (let r = 0; r < 3; r++) {
      x.beginPath();
      x.moveTo(px + 2, py + ph * (0.2 + r * 0.28));
      x.lineTo(px + pw * 0.95, py + ph * (0.18 + r * 0.28));
      x.stroke();
    }
  }
  // 水渍从上往下
  for (let i = 0; i < 7; i++) {
    const sx = Math.random() * size;
    const g = x.createLinearGradient(sx, 0, sx + 10, size);
    g.addColorStop(0, 'rgba(96,82,62,.12)');
    g.addColorStop(0.6, 'rgba(96,82,62,.04)');
    g.addColorStop(1, 'rgba(96,82,62,0)');
    x.fillStyle = g;
    x.fillRect(sx, 0, 18 + Math.random() * 40, size);
  }
  // 裂缝
  x.strokeStyle = 'rgba(70,60,45,.30)';
  x.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    x.beginPath();
    let px = Math.random() * size, py = Math.random() * size;
    x.moveTo(px, py);
    for (let j = 0; j < 6; j++) { px += (Math.random() - 0.5) * 30; py += Math.random() * 18; x.lineTo(px, py); }
    x.stroke();
  }
  grain(x, size, 9, 32);
  const h = heightCanvas(size), hx = h.getContext('2d');
  const img = hx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const v = 120 + fbm(xx / size * 8, y / size * 8, 4, 55) * 26;
      const i = (y * size + xx) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  hx.putImageData(img, 0, 0);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 222, 20, 20) };
}

function makeBrick(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#a99a80';
  x.fillRect(0, 0, size, size);
  const bh = Math.round(size / 11), bw = Math.round(size / 4.4);
  const h = heightCanvas(size), hx = h.getContext('2d');
  hx.fillStyle = '#4a4a4a';
  hx.fillRect(0, 0, size, size);
  for (let row = 0; row < 12; row++) {
    const off = row % 2 ? -bw / 2 : 0;
    for (let col = -1; col < 8; col++) {
      const bx = col * bw + off + 2;
      const by = row * bh + 2;
      const w = bw - 4, hh = bh - 4;
      const tone = 96 + Math.random() * 34;
      x.fillStyle = 'rgb(' + Math.round(tone + 24) + ',' + Math.round(tone * 0.56) + ',' + Math.round(tone * 0.42) + ')';
      x.fillRect(bx, by, w, hh);
      // 砖面不平整的高光/阴影
      x.fillStyle = 'rgba(255,255,255,.06)';
      x.fillRect(bx, by, w, 1.5);
      x.fillStyle = 'rgba(40,20,12,.22)';
      x.fillRect(bx, by + hh - 1.5, w, 1.5);
      for (let i = 0; i < 7; i++) {
        x.fillStyle = 'rgba(50,30,20,' + (0.06 + Math.random() * 0.14) + ')';
        x.fillRect(bx + Math.random() * w, by + Math.random() * hh, 1 + Math.random() * 3, 1 + Math.random() * 2);
      }
      hx.fillStyle = 'rgb(' + Math.round(176 + Math.random() * 26) + ',176,176)';
      hx.fillRect(bx, by, w, hh);
      hx.fillStyle = 'rgba(30,30,30,.7)';
      hx.fillRect(bx, by, w, 1.5);
      hx.fillRect(bx, by + hh - 1.5, w, 1.5);
    }
  }
  // 灰浆里的粗砂
  speckle(x, size, Math.round(size * 8), ['rgba(230,220,200,.18)', 'rgba(60,50,40,.18)'], 1.2);
  blob(x, size, 6, '#5a4030', 0.10, 48);
  grain(x, size, 12, 51);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 206, 26, 16) };
}

function makeConcrete(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#98917f';
  x.fillRect(0, 0, size, size);
  blob(x, size, 18, '#6f6a5c', 0.16, 60);
  blob(x, size, 10, '#b5ae9c', 0.12, 50);
  speckle(x, size, Math.round(size * 10), ['#7d796b', '#aaa392', '#6a665a'], 1.4);
  // 分格缝
  x.strokeStyle = 'rgba(52,48,42,.35)';
  x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, size / 2); x.lineTo(size, size / 2); x.stroke();
  x.beginPath(); x.moveTo(size / 2, 0); x.lineTo(size / 2, size); x.stroke();
  // 油渍
  blob(x, size, 4, '#4a443a', 0.10, 34);
  grain(x, size, 12, 66);
  const h = heightCanvas(size), hx = h.getContext('2d');
  const img = hx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      let v = 118 + fbm(xx / size * 10, y / size * 10, 5, 77) * 30;
      const seam = Math.min(Math.abs(y - size / 2), Math.abs(xx - size / 2));
      if (seam < 2) v -= 38;
      const i = (y * size + xx) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  hx.putImageData(img, 0, 0);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 224, 18, 22) };
}

function makeWood(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#79532f';
  x.fillRect(0, 0, size, size);
  // 木板拼缝
  const plank = size / 5;
  for (let p = 0; p < 5; p++) {
    const base = 96 + Math.random() * 30;
    x.fillStyle = 'rgb(' + Math.round(base) + ',' + Math.round(base * 0.66) + ',' + Math.round(base * 0.42) + ')';
    x.fillRect(0, p * plank, size, plank - 2);
    x.fillStyle = 'rgba(30,18,10,.5)';
    x.fillRect(0, p * plank + plank - 2, size, 2);
  }
  for (let i = 0; i < 120; i++) {
    x.strokeStyle = 'rgba(' + (40 + Math.random() * 40) + ',' + (25 + Math.random() * 25) + ',15,' + (0.05 + Math.random() * 0.16) + ')';
    x.lineWidth = 0.8 + Math.random() * 2;
    const px = Math.random() * size;
    x.beginPath(); x.moveTo(px, 0);
    for (let y = 0; y < size; y += 14) x.lineTo(px + Math.sin(y * 0.045 + i) * 3.4, y);
    x.stroke();
  }
  // 铁钉
  for (let i = 0; i < 14; i++) {
    x.fillStyle = 'rgba(30,30,28,.75)';
    x.beginPath();
    x.arc(Math.random() * size, Math.random() * size, 2.2, 0, Math.PI * 2);
    x.fill();
  }
  speckle(x, size, Math.round(size * 4), ['rgba(30,18,8,.18)', 'rgba(220,180,130,.10)'], 1.2);
  grain(x, size, 8, 88);
  const h = heightCanvas(size), hx = h.getContext('2d');
  const img = hx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const seam = (y % plank) > plank - 3 ? 40 : 0;
      const v = 132 + fbm(xx / size * 4, y / size * 18, 3, 99) * 22 - seam;
      const i = (y * size + xx) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, v);
      d[i + 3] = 255;
    }
  }
  hx.putImageData(img, 0, 0);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 188, 26, 10) };
}

function makeMetal(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#6c7f80';
  x.fillRect(0, 0, size, size);
  blob(x, size, 14, '#3f4b4c', 0.18, 54);
  blob(x, size, 10, '#9fb0b0', 0.12, 44);
  // 拉丝
  for (let i = 0; i < 160; i++) {
    x.strokeStyle = 'rgba(230,240,240,' + (0.02 + Math.random() * 0.07) + ')';
    x.lineWidth = 0.6 + Math.random() * 1.4;
    const y = Math.random() * size;
    x.beginPath(); x.moveTo(0, y); x.lineTo(size, y + (Math.random() - 0.5) * 3); x.stroke();
  }
  // 锈斑
  for (let i = 0; i < 9; i++) {
    const rx = Math.random() * size, ry = Math.random() * size, r = 6 + Math.random() * 26;
    const g = x.createRadialGradient(rx, ry, 0, rx, ry, r);
    g.addColorStop(0, 'rgba(120,62,30,.42)');
    g.addColorStop(1, 'rgba(120,62,30,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(rx, ry, r, 0, Math.PI * 2); x.fill();
  }
  speckle(x, size, 1200, ['rgba(20,25,25,.18)', 'rgba(220,235,235,.10)'], 1.4);
  grain(x, size, 8, 111);
  const h = heightCanvas(size), hx = h.getContext('2d');
  const img = hx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const v = 126 + fbm(xx / size * 6, y / size * 20, 4, 123) * 20;
      const i = (y * size + xx) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  hx.putImageData(img, 0, 0);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 164, 50, 0) };
}

function makeMarble(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#3a3a38';
  x.fillRect(0, 0, size, size);
  // 大理石底色 + 金色脉纹（大厅地面）
  const img = x.getImageData(0, 0, size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const n = fbm(xx / size * 4, y / size * 4, 5, 201);
      const vein = Math.abs(Math.sin((xx / size) * 9 + n * 7));
      let v = 44 + n * 22;
      if (vein < 0.035) v += 62;
      const i = (y * size + xx) * 4;
      d[i] = v + 8;
      d[i + 1] = v + 5;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  speckle(x, size, 800, ['rgba(220,210,190,.10)', 'rgba(0,0,0,.18)'], 1.1);
  grain(x, size, 6, 222);
  const h = heightCanvas(size), hx = h.getContext('2d');
  const himg = hx.createImageData(size, size), hd = himg.data;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const n = fbm(xx / size * 5, y / size * 5, 4, 233);
      const i = (y * size + xx) * 4;
      hd[i] = hd[i + 1] = hd[i + 2] = 128 + n * 12;
      hd[i + 3] = 255;
    }
  }
  hx.putImageData(himg, 0, 0);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 92, 40, 26) };
}

function makeGold(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#b08a3e';
  x.fillRect(0, 0, size, size);
  // 拉丝金
  for (let i = 0; i < 220; i++) {
    x.strokeStyle = 'rgba(255,232,170,' + (0.03 + Math.random() * 0.10) + ')';
    x.lineWidth = 0.5 + Math.random() * 1.2;
    const y = Math.random() * size;
    x.beginPath(); x.moveTo(0, y); x.lineTo(size, y + (Math.random() - 0.5) * 2); x.stroke();
  }
  blob(x, size, 8, '#6b4c18', 0.16, 42);
  blob(x, size, 8, '#ffe6a0', 0.10, 36);
  grain(x, size, 5, 244);
  const h = heightCanvas(size);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 86, 26, 0) };
}

function makeDarkMetal(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#2a2d2e';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 180; i++) {
    x.strokeStyle = 'rgba(180,190,195,' + (0.015 + Math.random() * 0.06) + ')';
    x.lineWidth = 0.4 + Math.random();
    const y = Math.random() * size;
    x.beginPath(); x.moveTo(0, y); x.lineTo(size, y + (Math.random() - 0.5) * 2); x.stroke();
  }
  blob(x, size, 10, '#101214', 0.24, 48);
  speckle(x, size, 500, ['rgba(255,255,255,.05)', 'rgba(0,0,0,.25)'], 0.9);
  grain(x, size, 6, 255);
  const h = heightCanvas(size);
  const hx = h.getContext('2d');
  const img = hx.createImageData(size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 120 + (hash2(i & 0xff, (i >> 8) & 0xff, 5) - 0.5) * 8;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  hx.putImageData(img, 0, 0);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 142, 40, 12) };
}

function makeFabric(size) {
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#6f6a58';
  x.fillRect(0, 0, size, size);
  // 织物经纬
  for (let i = 0; i < size; i += 3) {
    x.fillStyle = 'rgba(255,255,255,.035)';
    x.fillRect(i, 0, 1, size);
    x.fillStyle = 'rgba(0,0,0,.06)';
    x.fillRect(0, i, size, 1);
  }
  blob(x, size, 8, '#3f3b30', 0.14, 40);
  grain(x, size, 18, 266);
  const h = heightCanvas(size), hx = h.getContext('2d');
  const img = hx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const v = 128 + ((xx % 3 === 0) ? 12 : 0) + ((y % 3 === 0) ? -10 : 0);
      const i = (y * size + xx) * 4;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
  }
  hx.putImageData(img, 0, 0);
  return { albedo: c, height: h, rough: roughnessCanvas(size, 236, 12, 0) };
}

/* ------------------------------------------------------------------ */
/* 构建与缓存                                                          */
/* ------------------------------------------------------------------ */

const SURFACES = {
  sand: { size: 512, make: makeSand, normal: 1.4 },
  sandstone: { size: 512, make: makeSandstone, normal: 2.2 },
  plaster: { size: 512, make: makePlaster, normal: 1.2 },
  brick: { size: 512, make: makeBrick, normal: 2.6 },
  concrete: { size: 512, make: makeConcrete, normal: 1.4 },
  wood: { size: 512, make: makeWood, normal: 2.0 },
  metal: { size: 256, make: makeMetal, normal: 1.2 },
  marble: { size: 512, make: makeMarble, normal: 1.0 },
  gold: { size: 256, make: makeGold, normal: 0.6 },
  darkmetal: { size: 256, make: makeDarkMetal, normal: 0.8 },
  fabric: { size: 256, make: makeFabric, normal: 1.0 }
};

const MATS = {
  sand: { roughness: 1.0, metalness: 0.0, repeat: 3 },
  sandstone: { roughness: 0.94, metalness: 0.0, repeat: 1.5 },
  plaster: { roughness: 0.92, metalness: 0.0, repeat: 2 },
  brick: { roughness: 0.92, metalness: 0.0, repeat: 2 },
  concrete: { roughness: 0.9, metalness: 0.0, repeat: 2 },
  wood: { roughness: 0.84, metalness: 0.0, repeat: 1.5 },
  metal: { roughness: 0.58, metalness: 0.72, repeat: 1.5 },
  marble: { roughness: 0.34, metalness: 0.06, repeat: 4 },
  gold: { roughness: 0.28, metalness: 1.0, repeat: 2 },
  darkmetal: { roughness: 0.4, metalness: 0.9, repeat: 2 },
  fabric: { roughness: 0.96, metalness: 0.0, repeat: 2 }
};

function textures(kind, repeat) {
  const key = kind + ':' + repeat;
  if (cache.has(key)) return cache.get(key);
  const spec = SURFACES[kind] || SURFACES.concrete;
  const surf = spec.make(spec.size);
  const map = new THREE.CanvasTexture(surf.albedo);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  const normalMap = new THREE.CanvasTexture(normalFromHeight(surf.height, spec.normal));
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(repeat, repeat);
  normalMap.anisotropy = 4;

  const roughnessMap = new THREE.CanvasTexture(surf.rough);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(repeat, repeat);

  const out = { map: map, normalMap: normalMap, roughnessMap: roughnessMap };
  cache.set(key, out);
  return out;
}

export function material(kind, opts) {
  opts = opts || {};
  // 结构件统一走卡通哑光/纯色材质；扫描贴图不再参与。
  if (RBX_SURF[kind] != null || RBX_FLAT[kind] != null) return robloxMaterial(kind, opts);

  const base = MATS[kind] || MATS.concrete;
  const repeat = opts.repeat || base.repeat;
  const key = 'mat:' + kind + ':' + repeat + ':' + (opts.color || '') + ':' + (opts.roughness || '') +
    (opts.vertexColors ? ':vc' : '');
  if (cache.has(key)) return cache.get(key);
  const tex = textures(kind, repeat);
  const m = new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(opts.normalScale || 1, opts.normalScale || 1),
    roughnessMap: tex.roughnessMap,
    color: opts.color != null ? opts.color : 0xffffff,
    roughness: opts.roughness != null ? opts.roughness : base.roughness,
    metalness: opts.metalness != null ? opts.metalness : base.metalness,
    emissive: opts.emissive != null ? opts.emissive : 0x000000,
    emissiveIntensity: opts.emissiveIntensity != null ? opts.emissiveIntensity : 1,
    transparent: !!opts.transparent,
    opacity: opts.opacity != null ? opts.opacity : 1,
    depthWrite: opts.depthWrite !== false,
    vertexColors: !!opts.vertexColors,
    side: opts.side != null ? opts.side : THREE.FrontSide
  });
  m.envMapIntensity = base.metalness > 0.35 ? 1.15 : 0.55;
  cache.set(key, m);
  materialRegistry.push({ kind, repeat, mat: m });
  if (photoReady.has(kind)) {
    const tex = photoTex(kind, repeat);
    if (tex) {
      m.map = tex.map;
      m.normalMap = tex.normalMap;
      m.roughnessMap = tex.roughnessMap;
      m.normalScale.set(0.85, 0.85);
      m.needsUpdate = true;
    }
  }
  return m;
}

export function flat(color, opts) {
  opts = opts || {};
  const key = 'flat:' + color + ':' + (opts.opacity || 1) + ':' + (opts.emissive || 0) + ':' + (opts.metalness || 0);
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: color,
    roughness: opts.roughness != null ? opts.roughness : 0.8,
    metalness: opts.metalness != null ? opts.metalness : 0.05,
    emissive: opts.emissive != null ? opts.emissive : 0x000000,
    emissiveIntensity: opts.emissiveIntensity != null ? opts.emissiveIntensity : 1,
    transparent: !!opts.transparent,
    opacity: opts.opacity != null ? opts.opacity : 1
  });
  cache.set(key, m);
  return m;
}

/** 供武器/道具使用的小尺寸程序化贴图（不缓存重复高斯噪声，避免启动卡顿）。 */
const smallCache = new Map();

export function metalTexture(opts) {
  opts = opts || {};
  const key = 'wmetal:' + (opts.tone || 0) + ':' + (opts.scratch || 1);
  if (smallCache.has(key)) return smallCache.get(key);
  const size = 256;
  const c = canvas(size), x = c.getContext('2d');
  const tone = opts.tone != null ? opts.tone : 94;
  x.fillStyle = 'rgb(' + tone + ',' + (tone + 4) + ',' + (tone + 6) + ')';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 240; i++) {
    x.strokeStyle = 'rgba(210,225,230,' + (0.02 + Math.random() * 0.07) + ')';
    x.lineWidth = 0.4 + Math.random() * 1.1;
    const y = Math.random() * size;
    x.beginPath(); x.moveTo(0, y); x.lineTo(size, y + (Math.random() - 0.5) * 2); x.stroke();
  }
  for (let i = 0; i < 40 * (opts.scratch || 1); i++) {
    x.strokeStyle = 'rgba(235,240,245,' + (0.05 + Math.random() * 0.12) + ')';
    x.lineWidth = 0.5;
    const sx = Math.random() * size, sy = Math.random() * size;
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + 8 + Math.random() * 26, sy + (Math.random() - 0.5) * 3); x.stroke();
  }
  blob(x, size, 8, opts.dark || '#15181a', 0.14, 26);
  grain(x, size, 7, 300 + (opts.tone || 0));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  smallCache.set(key, t);
  return t;
}

export function woodTexture(base) {
  const key = 'wwood:' + (base || 0);
  if (smallCache.has(key)) return smallCache.get(key);
  const size = 256;
  const c = canvas(size), x = c.getContext('2d');
  x.fillStyle = '#5b3d24';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const v = 60 + Math.random() * 60;
    x.strokeStyle = 'rgba(' + v + ',' + Math.round(v * 0.62) + ',' + Math.round(v * 0.38) + ',' + (0.18 + Math.random() * 0.3) + ')';
    x.lineWidth = 0.6 + Math.random() * 1.6;
    const px = Math.random() * size;
    x.beginPath(); x.moveTo(px, 0);
    for (let y = 0; y < size; y += 12) x.lineTo(px + Math.sin(y * 0.04 + i) * 3, y);
    x.stroke();
  }
  grain(x, size, 8, 400);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  smallCache.set(key, t);
  return t;
}

export function polymerTexture(tone) {
  const key = 'wpoly:' + (tone || 0);
  if (smallCache.has(key)) return smallCache.get(key);
  const size = 128;
  const c = canvas(size), x = c.getContext('2d');
  const v = tone != null ? tone : 46;
  x.fillStyle = 'rgb(' + v + ',' + (v + 2) + ',' + (v + 3) + ')';
  x.fillRect(0, 0, size, size);
  // 防滑颗粒
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = 'rgba(' + (v + 26) + ',' + (v + 28) + ',' + (v + 30) + ',' + (0.15 + Math.random() * 0.25) + ')';
    x.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  x.fillStyle = 'rgba(0,0,0,.28)';
  x.fillRect(0, size - 2, size, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  smallCache.set(key, t);
  return t;
}

export function canvasTexture(c, opts) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts && opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat, opts.repeat);
  }
  return t;
}
