// 皮肤材质：程序化花纹 + 材质通道覆盖。
// 一件皮肤只增加一张贴图，不新增 shader program；同款皮肤共用缓存。

import * as THREE from '../../vendor/three.module.js';
import { hash2 } from './noise.js';
import { defaultVariant, variantKey } from '../config/skins.js';

const TEX_CACHE = new Map();
const MAT_CACHE = new Map();

/** 纹理生成用确定性随机：同一品相每次结果一致。 */
let RND = Math.random;
function rnd() { return RND(); }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function grain(x, w, h, amount, seed) {
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (hash2(i & 0xff, (i >> 8) & 0xff, seed) - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  x.putImageData(img, 0, 0);
}

function scratches(x, w, h, count, color) {
  for (let i = 0; i < count; i++) {
    x.strokeStyle = color;
    x.lineWidth = 0.5 + rnd() * 1.2;
    const sx = rnd() * w, sy = rnd() * h;
    x.beginPath();
    x.moveTo(sx, sy);
    x.lineTo(sx + 6 + rnd() * 34, sy + (rnd() - 0.5) * 4);
    x.stroke();
  }
}

function hexToRgb(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function patternCanvas(skin, emissiveOnly, variant) {
  variant = variant || defaultVariant(skin);
  RND = mulberry32((variant.seed || 1) * 2654435761 + (skin.id.length * 97) + (emissiveOnly ? 7 : 0));
  const wear = Math.max(0, Math.min(1, variant.wear || 0));
  const offset = variant.offset || 0;
  const w = 512, h = 256;
  const c = canvas(w, h);
  const x = c.getContext('2d');
  const col = skin.colors;

  if (emissiveOnly) {
    x.fillStyle = '#000';
    x.fillRect(0, 0, w, h);
  } else {
    x.fillStyle = col[0];
    x.fillRect(0, 0, w, h);
  }

  const p = skin.pattern;
  if (p === 'redline') {
    if (!emissiveOnly) {
      x.save();
      x.translate(w * 0.5, h * 0.5);
      x.rotate(-0.3);
      for (let i = -5; i < 7; i++) {
        // 细而锐的红线，才是 speedline 的味道；粗条会变成斑马。
        x.fillStyle = col[1];
        x.fillRect(-w, i * 40, w * 2, 6);
        x.fillStyle = 'rgba(240,235,220,.22)';
        x.fillRect(-w, i * 40 + 7, w * 2, 1);
      }
      x.restore();
      // 机械刻线，避免大面积纯黑
      x.strokeStyle = 'rgba(120,126,132,.10)';
      x.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const yy = 18 + i * 28;
        x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke();
      }
    } else {
      x.save();
      x.translate(w * 0.5, h * 0.5);
      x.rotate(-0.3);
      x.fillStyle = col[1];
      for (let i = -5; i < 7; i += 2) x.fillRect(-w, i * 40, w * 2, 4);
      x.restore();
    }
    scratches(x, w, h, 80, 'rgba(220,215,200,.18)');
  } else if (p === 'camo') {
    for (let i = 0; i < 70; i++) {
      x.fillStyle = col[1 + (i % 2)];
      x.beginPath();
      const cx = rnd() * w, cy = rnd() * h;
      const r = 14 + rnd() * 46;
      x.ellipse(cx, cy, r, r * (0.4 + rnd() * 0.4), rnd() * Math.PI, 0, Math.PI * 2);
      x.fill();
    }
    scratches(x, w, h, 40, 'rgba(40,30,20,.16)');
  } else if (p === 'carbon') {
    x.save();
    x.translate(w / 2, h / 2);
    x.rotate(0.6);
    for (let i = -h; i < w + h; i += 5) {
      x.fillStyle = i % 10 === 0 ? 'rgba(140,160,180,.10)' : 'rgba(0,0,0,.22)';
      x.fillRect(i, -h, 3, h * 3);
      x.fillStyle = 'rgba(255,255,255,.03)';
      x.fillRect(-h, i, h * 3, 2);
    }
    x.restore();
    scratches(x, w, h, 26, 'rgba(190,215,235,.14)');
  } else if (p === 'geo') {
    for (let i = 0; i < 22; i++) {
      x.fillStyle = col[1 + (i % 2)];
      x.beginPath();
      const x0 = rnd() * w, y0 = rnd() * h;
      x.moveTo(x0, y0);
      x.lineTo(x0 + 40 + rnd() * 120, y0 + (rnd() - 0.5) * 60);
      x.lineTo(x0 + (rnd() - 0.5) * 60, y0 + 30 + rnd() * 90);
      x.closePath();
      x.fill();
    }
    x.strokeStyle = 'rgba(30,30,30,.35)';
    x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, h * 0.7); x.lineTo(w, h * 0.4); x.stroke();
    scratches(x, w, h, 70, 'rgba(255,255,255,.16)');
  } else if (p === 'marble') {
    const base = hexToRgb(col[0]);
    const vein = hexToRgb(col[1]);
    const hi = hexToRgb(col[2] || col[1]);
    const img = x.getImageData(0, 0, w, h);
    const d = img.data;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const u = xx / w * 5 + offset * 2, v = yy / h * 5;
        const n = Math.sin(u * 3.1 + Math.sin(v * 2.3) * 1.7) + Math.sin(v * 4.2 + u * 1.3) * 0.6;
        const t = Math.abs(n);
        const i = (yy * w + xx) * 4;
        if (t < 0.16) {
          // 主纹：亮色 + 一点白热，形成湿润的矿物反光
          d[i] = hi.r * 0.86 + 255 * 0.14;
          d[i + 1] = hi.g * 0.86 + 255 * 0.12;
          d[i + 2] = hi.b * 0.86 + 255 * 0.10;
        } else if (t < 0.34) {
          const k = 1 - (t - 0.16) / 0.18;
          d[i] = base.r + (vein.r - base.r) * k * 0.85;
          d[i + 1] = base.g + (vein.g - base.g) * k * 0.85;
          d[i + 2] = base.b + (vein.b - base.b) * k * 0.85;
        }
      }
    }
    x.putImageData(img, 0, 0);
    scratches(x, w, h, 30, 'rgba(255,240,200,.12)');
  } else if (p === 'rust') {
    for (let i = 0; i < 46; i++) {
      const cx = rnd() * w, cy = rnd() * h, r = 8 + rnd() * 40;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(138,76,42,.75)');
      g.addColorStop(1, 'rgba(138,76,42,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }
    scratches(x, w, h, 120, 'rgba(210,200,180,.2)');
  } else if (p === 'neon') {
    if (!emissiveOnly) {
      x.fillStyle = '#0a0d10';
      x.fillRect(0, 0, w, h);
    }
    x.save();
    x.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      x.strokeStyle = i % 2 ? col[1] : col[2];
      x.lineWidth = 2 + rnd() * 3;
      x.shadowColor = x.strokeStyle;
      x.shadowBlur = emissiveOnly ? 10 : 4;
      x.beginPath();
      const y0 = 30 + i * 26;
      x.moveTo(-20, y0);
      x.bezierCurveTo(w * 0.3, y0 - 30, w * 0.6, y0 + 30, w + 20, y0 - 6);
      x.stroke();
    }
    x.restore();
    scratches(x, w, h, 30, 'rgba(180,220,230,.12)');
  } else if (p === 'frost') {
    for (let i = 0; i < 40; i++) {
      x.strokeStyle = 'rgba(160,205,225,.4)';
      x.lineWidth = 0.6 + rnd() * 1.2;
      let px = rnd() * w, py = rnd() * h;
      x.beginPath(); x.moveTo(px, py);
      for (let j = 0; j < 5; j++) {
        px += (rnd() - 0.5) * 50; py += (rnd() - 0.5) * 30;
        x.lineTo(px, py);
      }
      x.stroke();
    }
    scratches(x, w, h, 40, 'rgba(255,255,255,.2)');
  } else if (p === 'gold') {
    for (let i = 0; i < 140; i++) {
      x.strokeStyle = 'rgba(255,238,180,' + (0.03 + rnd() * 0.08) + ')';
      x.lineWidth = 0.5 + rnd();
      const yy = rnd() * h;
      x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy + (rnd() - 0.5) * 3); x.stroke();
    }
    // 金色蚀刻纹
    x.strokeStyle = 'rgba(90,64,20,.5)';
    x.lineWidth = 2;
    x.beginPath();
    for (let i = 0; i <= 20; i++) {
      const px = i / 20 * w;
      const py = h * 0.5 + Math.sin(i * 0.9) * h * 0.18;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.stroke();
    scratches(x, w, h, 50, 'rgba(255,245,210,.22)');
  } else if (p === 'fade') {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, col[0]);
    g.addColorStop(0.55, col[1]);
    g.addColorStop(1, col[2]);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = 'rgba(255,255,255,' + (0.02 + rnd() * 0.05) + ')';
      x.beginPath();
      x.arc(rnd() * w, rnd() * h, 10 + rnd() * 50, 0, Math.PI * 2);
      x.fill();
    }
    scratches(x, w, h, 35, 'rgba(255,245,230,.15)');
  } else if (p === 'obsidian') {
    for (let i = 0; i < 26; i++) {
      x.strokeStyle = 'rgba(120,150,180,' + (0.03 + rnd() * 0.08) + ')';
      x.lineWidth = 1 + rnd() * 3;
      const yy = rnd() * h;
      x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy - 20 + rnd() * 40); x.stroke();
    }
    scratches(x, w, h, 20, 'rgba(200,225,245,.18)');
  }

  if (!emissiveOnly) {
    // 华丽纹样：稀有皮肤加金线、徽记、细密纹章
    ornateOverlay(x, w, h, skin, wear, emissiveOnly);
    // 磨损：越高越脏、越花、越暗
    const extra = Math.round(wear * 160);
    scratches(x, w, h, 18 + extra, 'rgba(238,232,214,' + (0.05 + wear * 0.16).toFixed(3) + ')');
    scratches(x, w, h, Math.round(wear * 90), 'rgba(20,18,16,' + (0.06 + wear * 0.22).toFixed(3) + ')');
    for (let i = 0; i < Math.round(wear * 60); i++) {
      const cx = rnd() * w, cy = rnd() * h, r = 1 + rnd() * 5;
      x.fillStyle = 'rgba(28,24,20,' + (0.10 + rnd() * 0.26) + ')';
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = 'rgba(12,10,8,' + (wear * 0.18).toFixed(3) + ')';
    x.fillRect(0, 0, w, h);
    if (wear < 0.08) {
      // 崭新品相：干净的镜面高光
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.46, 'rgba(255,255,255,.10)');
      g.addColorStop(0.52, 'rgba(255,255,255,.16)');
      g.addColorStop(0.58, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    }
    grain(x, w, h, 8 + wear * 16, 700 + Math.round(wear * 100));
  }

  // 图案偏移：整张花纹水平循环平移，接缝自然
  if (offset > 0.001) {
    const shift = Math.round(offset * w);
    const dst = canvas(w, h);
    const dx = dst.getContext('2d');
    dx.drawImage(c, -shift, 0);
    dx.drawImage(c, w - shift, 0);
    return dst;
  }
  return c;
}

/** 金线、徽记、纹章：让隐秘/典藏皮肤一眼更贵。 */
function ornateOverlay(x, w, h, skin, wear, emissiveOnly) {
  const rare = skin.rarity === 'classified' || skin.rarity === 'covert' || skin.rarity === 'archive';
  if (!rare || emissiveOnly) return;
  const c = skin.colors;
  const gold = c[2] || '#d9b47a';
  x.save();
  x.globalAlpha = 0.42 - wear * 0.25;
  x.strokeStyle = gold;
  x.lineWidth = 1.6;
  // 两端细金线
  x.beginPath(); x.moveTo(18, 16); x.lineTo(w * 0.32, 16); x.stroke();
  x.beginPath(); x.moveTo(w - 18, h - 16); x.lineTo(w * 0.68, h - 16); x.stroke();
  x.beginPath(); x.moveTo(18, h - 16); x.lineTo(w * 0.24, h - 16); x.stroke();
  // 中央菱形徽记
  x.translate(w * 0.5, h * 0.5);
  x.rotate(Math.PI / 4);
  x.globalAlpha = 0.30 - wear * 0.2;
  x.strokeRect(-16, -16, 32, 32);
  x.strokeRect(-9, -9, 18, 18);
  x.restore();

  // 细密装饰线 / 点阵
  x.save();
  x.globalAlpha = 0.16;
  x.strokeStyle = gold;
  x.lineWidth = 0.8;
  for (let i = 0; i < 9; i++) {
    const y = 30 + i * 22;
    x.beginPath();
    x.moveTo(24, y);
    x.bezierCurveTo(w * 0.3, y - 8, w * 0.7, y + 8, w - 24, y);
    x.stroke();
  }
  if (skin.rarity === 'archive' || skin.rarity === 'covert') {
    x.globalAlpha = 0.35;
    for (let i = 0; i < 40; i++) {
      const px = 30 + rnd() * (w - 60);
      const py = 24 + rnd() * (h - 48);
      x.fillStyle = i % 3 ? gold : 'rgba(255,245,220,.8)';
      x.fillRect(px, py, 1.5, 1.5);
    }
  }
  x.restore();
}

function skinTexture(skin, variant) {
  const key = 'map:' + skin.id + ':' + variantKey(variant);
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);
  const tex = new THREE.CanvasTexture(patternCanvas(skin, false, variant));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  TEX_CACHE.set(key, tex);
  return tex;
}

function skinEmissive(skin, variant) {
  const key = 'emi:' + skin.id + ':' + variantKey(variant);
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);
  const tex = new THREE.CanvasTexture(patternCanvas(skin, true, variant));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  TEX_CACHE.set(key, tex);
  return tex;
}

const MAIN_ROLE = {
  ak: 'metal', glock: 'steel', knife: 'blade',
  m4: 'metal', awp: 'metal', usp: 'steel', deagle: 'steel', mp9: 'metal'
};

function buildMaterial(skin, role, base, weapon, variant) {
  const key = skin.id + '|' + role + '|' + weapon + '|' + variantKey(variant) + '|' + base.uuid;
  if (MAT_CACHE.has(key)) return MAT_CACHE.get(key);
  const m = base.clone();
  m.userData = Object.assign({}, base.userData);
  // AWP 的枪身与枪托都是大块聚合物，皮肤要覆盖整把枪才有 CS 的观感。
  const isMain = MAIN_ROLE[weapon] === role || (weapon === 'awp' && (role === 'polymer' || role === 'wood' || role === 'olive'));

  if (role === 'glove' || role === 'sleeve') {
    return base;
  } else if (isMain) {
    const wear = variant && variant.wear != null ? variant.wear : 0;
    m.map = skinTexture(skin, variant);
    m.bumpMap = m.map;
    m.bumpScale = 0.012;
    m.color.setHex(0xffffff);
    m.metalness = skin.metalness != null ? skin.metalness : 0.7;
    m.roughness = (skin.roughness != null ? skin.roughness : 0.4) + wear * 0.28;
    m.envMapIntensity = 1.55 - wear * 0.45;
    if (skin.emissive) {
      m.emissive = new THREE.Color(skin.emissive);
      m.emissiveMap = skinEmissive(skin, variant);
      m.emissiveIntensity = (skin.emissiveIntensity != null ? skin.emissiveIntensity : 0.6) * (1 - wear * 0.35);
    }
  } else if (role === 'wood') {
    m.color.setHex(skin.wood != null ? skin.wood : 0x8a5a32).multiplyScalar(1.18);
    m.roughness = 0.78;
    m.roughnessMap = null;
    m.metalness = 0.03;
    m.envMapIntensity = 0.5;
  } else if (role === 'polymer') {
    m.color.setHex(skin.polymer != null ? skin.polymer : 0x2a2d2f).multiplyScalar(1.18);
    m.roughness = 0.84;
    m.roughnessMap = null;
    m.metalness = 0.12;
    m.envMapIntensity = 0.55;
  } else if (role === 'handle') {
    m.color.setHex(skin.handle != null ? skin.handle : 0x26282a);
    m.roughness = 0.58;
    m.metalness = 0.35;
  } else if (role === 'steel' || role === 'metal' || role === 'accent') {
    m.color.setHex(skin.colors[2] ? new THREE.Color(skin.colors[2]).getHex() : 0x9aa3a6);
    if (role === 'accent') m.color.setHex(new THREE.Color(skin.colors[1]).getHex());
    m.metalness = role === 'accent' ? 0.8 : 0.92;
    m.roughness = 0.3;
  }
  m.needsUpdate = true;
  MAT_CACHE.set(key, m);
  return m;
}

/**
 * 把皮肤应用到一把武器 Group。传 null 恢复原厂。
 * 每个 mesh 的原始材质存在 userData.baseMat，因此可以反复切换。
 */
export function applySkin(group, skin, variant) {
  if (!group) return;
  const weapon = group.userData.weaponId || 'ak';
  if (skin && !variant) variant = defaultVariant(skin);
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData.baseMat) o.userData.baseMat = o.material;
    if (!skin) {
      o.material = o.userData.baseMat;
      return;
    }
    o.material = buildMaterial(skin, o.userData.role || 'metal', o.userData.baseMat, weapon, variant);
  });
}

export function skinPreviewCss(skin, variant) {
  const c = skin.colors;
  const a = 120 + ((variant && variant.offset) || 0) * 70;
  if (skin.pattern === 'fade') return 'linear-gradient(' + a + 'deg,' + c[0] + ',' + c[1] + ' 55%,' + c[2] + ')';
  if (skin.pattern === 'neon') return 'linear-gradient(' + a + 'deg,#0a0d10,' + c[1] + ' 45%,' + c[2] + ')';
  if (skin.pattern === 'gold') return 'linear-gradient(' + a + 'deg,' + c[2] + ',' + c[0] + ' 45%,' + c[1] + ')';
  if (skin.pattern === 'camo') return 'linear-gradient(' + a + 'deg,' + c[0] + ' 0 33%,' + c[1] + ' 33% 66%,' + c[2] + ' 66%)';
  if (skin.pattern === 'geo') return 'linear-gradient(' + a + 'deg,' + c[0] + ' 0 40%,' + c[1] + ' 40% 62%,' + c[2] + ' 62%)';
  return 'linear-gradient(' + a + 'deg,' + c[0] + ',' + c[1] + ' 60%,' + c[2] + ')';
}
