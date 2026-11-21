// 卡通风格基础件：干净的大色块表面 + 圆润的人形。
// 配色参考 Builda 的 Roblox 扩展包（亮绿底板、米黄墙、红屋顶、白窗框、淡蓝玻璃），
// 但去掉凸点与积木棱角：表面是哑光纯色，角色是胶囊/球体拼的圆润造型。
// 全部程序化生成，运行时不新增任何网络请求。

import * as THREE from '../../vendor/three.module.js';
import { mergeGeos, paint } from '../world/geo-utils.js';

export const TILE = 2.6;

/** 经典卡通配色。 */
export const PALETTE = {
  base: '#63bf49',     // 亮绿草地
  baseDark: '#57ad40',
  wall: '#e6d8b8',     // 米黄墙面
  wallDark: '#d6c6a3',
  roof: '#cf3a2b',     // 红瓦
  roofDark: '#a52c21',
  door: '#a06a42',     // 棕色门 / 木
  glass: '#a9d3e8',    // 淡蓝玻璃
  frame: '#f7f5ef',    // 白窗框
  path: '#b9b4a8',     // 石灰路
  leaf: '#4fa04c',     // 树叶
  trunk: '#7a4a2e',
  sky: '#87ceeb',
  metal: '#9aa2a8',
  dark: '#3f4348',
  gold: '#e8c34a',
  skin: '#f0c29b',
  hair: '#4a2d18',
  shirt: '#0d69ac',
  pants: '#35455c'
};

/* ------------------------------------------------------------------ */
/* 表面材质：哑光纯色，带极轻的颗粒，避免大面积死板                      */
/* ------------------------------------------------------------------ */

let grainTex = null;

/** 64×64 的极轻颗粒（亮度 0.97~1.0），几乎看不出噪点，只消除纯色的塑料感。 */
function grainTexture() {
  if (grainTex) return grainTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#fbfbfb';
  x.fillRect(0, 0, S, S);
  const img = x.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 250 + ((Math.random() * 6) | 0);
    d[i] = d[i + 1] = d[i + 2] = n;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  grainTex = t;
  return t;
}

const surfaceCache = new Map();

/** 哑光表面材质：贴一张近白颗粒图，颜色由 color 与顶点色决定。 */
export function surfaceMaterial(hex, opts) {
  opts = opts || {};
  const key = hex + '|' + (opts.vertexColors ? 'vc' : '') + '|' + (opts.opacity != null ? opts.opacity : 1) +
    '|' + (opts.side != null ? opts.side : 0);
  if (surfaceCache.has(key)) return surfaceCache.get(key);
  const m = new THREE.MeshLambertMaterial({
    map: grainTexture(),
    color: new THREE.Color(hex),
    vertexColors: !!opts.vertexColors,
    transparent: opts.opacity != null && opts.opacity < 1,
    opacity: opts.opacity != null ? opts.opacity : 1,
    side: opts.side != null ? opts.side : THREE.FrontSide
  });
  surfaceCache.set(key, m);
  return m;
}

const flatMatCache = new Map();

export function flatMaterial(hex, opts) {
  opts = opts || {};
  const key = hex + '|' + (opts.vertexColors ? 'vc' : '') + '|' + (opts.side || 0);
  if (flatMatCache.has(key)) return flatMatCache.get(key);
  const m = new THREE.MeshLambertMaterial({
    color: new THREE.Color(hex),
    vertexColors: !!opts.vertexColors,
    side: opts.side != null ? opts.side : THREE.FrontSide
  });
  flatMatCache.set(key, m);
  return m;
}

/* ------------------------------------------------------------------ */
/* 圆润人形                                                            */
/* ------------------------------------------------------------------ */

// 身高 1.8 m 的卡通比例：头略大、四肢圆润，保证 10 m 外轮廓仍然好认。
export const AVATAR = {
  height: 1.8,
  hipY: 0.86,
  shoulderY: 1.38,
  armX: 0.275,
  legX: 0.105,
  headY: 1.60
};

function capsule(r, len, sx, sy, sz, capSeg, radialSeg) {
  const g = new THREE.CapsuleGeometry(r, len, capSeg == null ? 4 : capSeg, radialSeg == null ? 10 : radialSeg);
  if (sx || sy || sz) g.scale(sx || 1, sy || 1, sz || 1);
  return g;
}

function boxGeo(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

let avatarGeoCache = null;

/**
 * 四件套几何，全部刷白（实际颜色由材质色 / 实例色给出）。
 * 头部合并了五官与头发，所以人群实例化时也能看到表情。
 */
export function avatarGeometries() {
  if (avatarGeoCache) return avatarGeoCache;

  // ---- 躯干：略扁的胶囊，肩部自然收圆 ----
  const torso = capsule(0.175, 0.30, 1.12, 1.0, 0.82, 3, 10);
  torso.translate(0, 1.14, 0);
  const torsoParts = [paint(torso, 1, 1, 1)];
  // 胸前徽章：顶点色提亮成同色系浅色圆牌，Roblox 衬衫印花的感觉，零额外 draw call
  // 胸口两条浅色横条：平贴在胸面（z=-0.149 正好是胶囊表面），球衣印花的感觉
  for (const dy of [0.10, -0.10]) {
    const stripe = boxGeo(0.16, 0.024, 0.008, 0, 1.18 + dy, -0.149);
    torsoParts.push(paint(stripe, 1.30, 1.30, 1.30));
  }
  // 衣领：深一档，让头和躯干之间有分界
  const collar = new THREE.TorusGeometry(0.105, 0.016, 4, 12);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, 1.42, 0);
  torsoParts.push(paint(collar, 0.62, 0.62, 0.65));
  const torsoGeo = mergeGeos(torsoParts);

  // ---- 头：球体 + 五官 + 头发（颜色直接烘焙进顶点色，人群实例也能有表情） ----
  const head = new THREE.SphereGeometry(0.172, 14, 10);
  head.scale(1.0, 1.04, 0.95);
  head.translate(0, AVATAR.headY, 0);
  const skinCol = new THREE.Color(PALETTE.skin);
  const parts = [paint(head, skinCol.r, skinCol.g, skinCol.b)];

  // 眼睛（黑）
  for (const sx of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.0225, 6, 5);
    eye.scale(1, 1.25, 0.6);
    eye.translate(sx * 0.058, AVATAR.headY + 0.022, -0.163);
    parts.push(paint(eye, 0.08, 0.08, 0.09));
  }
  // 微笑（半圆环，正面朝向 -Z）
  const mouth = new THREE.TorusGeometry(0.048, 0.010, 4, 10, Math.PI);
  mouth.rotateZ(Math.PI);
  mouth.rotateY(Math.PI);
  mouth.translate(0, AVATAR.headY - 0.045, -0.162);
  parts.push(paint(mouth, 0.16, 0.11, 0.10));

  // 头发：后脑与顶部的一层壳
  const hairCol = new THREE.Color(PALETTE.hair);
  const hair = new THREE.SphereGeometry(0.182, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52);
  hair.rotateX(0.16);
  hair.translate(0, AVATAR.headY + 0.004, 0.012);
  parts.push(paint(hair, hairCol.r, hairCol.g, hairCol.b));
  // 两侧鬓角
  for (const sx of [-1, 1]) {
    const tuft = capsule(0.03, 0.06, 1, 1, 1, 1, 5);
    tuft.translate(sx * 0.155, AVATAR.headY + 0.01, 0.03);
    parts.push(paint(tuft, hairCol.r, hairCol.g, hairCol.b));
  }
  const headGeo = mergeGeos(parts);

  // ---- 手臂：枢轴在肩，向下 -Y ----
  const arm = capsule(0.062, 0.36, 1, 1, 1, 3, 8);
  arm.translate(0, -0.30, 0);
  // 袖子：上臂一小节，材质色会覆盖成衬衫色（顶点色压暗一点做层次）
  const sleeve = capsule(0.070, 0.10, 1, 1, 1, 2, 8);
  sleeve.translate(0, -0.10, 0);
  // 手套：末端一圈暗色，读成戴了手套，不用拆材质
  const cuff = new THREE.TorusGeometry(0.062, 0.018, 4, 10);
  cuff.rotateX(Math.PI / 2);
  cuff.translate(0, -0.575, 0);
  const armGeo = mergeGeos([
    paint(arm, 1, 1, 1),
    paint(sleeve, 0.92, 0.92, 0.92),
    paint(cuff, 0.38, 0.38, 0.42)
  ]);

  // ---- 腿：枢轴在髋，向下 -Y ----
  const leg = capsule(0.078, 0.44, 1, 1, 1, 3, 8);
  leg.translate(0, -0.30, 0);
  const boot = capsule(0.082, 0.06, 1.05, 0.8, 1.25, 1, 7);
  boot.translate(0, -0.70, -0.02);
  const legGeo = mergeGeos([paint(leg, 1, 1, 1), paint(boot, 0.52, 0.52, 0.55)]);

  avatarGeoCache = { torso: torsoGeo, head: headGeo, arm: armGeo, leg: legGeo };
  return avatarGeoCache;
}

/** 兼容旧接口：大厅人群使用的几何。 */
export function crowdGeometries() {
  const g = avatarGeometries();
  return { torso: g.torso, head: g.head, helmetHead: g.head, arm: g.arm, leg: g.leg };
}

/** 兼容旧接口：人群材质用的近白布纹（保留轻微明暗，不影响实例色）。 */
let clothCache = null;
export function characterCloth() {
  if (clothCache) return clothCache;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < S; i += 4) {
    x.fillStyle = 'rgba(0,0,0,.025)';
    x.fillRect(0, i, S, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  clothCache = t;
  return t;
}

/* ------------------------------------------------------------------ */
/* 单人角色（Bot / 展位主角）                                          */
/* ------------------------------------------------------------------ */

/**
 * 材质组：头发单独一份（棕色），其余用统一的卡通哑光材质。
 * 每个角色都新建实例，改色不会互相污染。
 */
export function avatarMaterials(colors) {
  const c = colors || {};
  return {
    // 头部颜色烘焙在几何里（肤色/头发/五官），材质只需要 vertexColors
    head: new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff }),
    shirt: flatMaterial(c.shirt || PALETTE.shirt),
    pants: flatMaterial(c.pants || PALETTE.pants)
  };
}

export function buildHumanoid(opts) {
  opts = opts || {};
  const geo = avatarGeometries();
  const m = avatarMaterials(opts.colors);
  const group = new THREE.Group();
  group.name = 'humanoid';

  const torso = new THREE.Mesh(geo.torso, m.shirt);
  torso.castShadow = true;
  torso.receiveShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(geo.head, m.head);
  head.castShadow = true;
  group.add(head);

  function limb(partGeo, mat, x, y, z) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const mesh = new THREE.Mesh(partGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  }

  const armL = limb(geo.arm, m.shirt, -AVATAR.armX, AVATAR.shoulderY, 0);
  const armR = limb(geo.arm, m.shirt, AVATAR.armX, AVATAR.shoulderY, 0);
  const legL = limb(geo.leg, m.pants, -AVATAR.legX, AVATAR.hipY, 0);
  const legR = limb(geo.leg, m.pants, AVATAR.legX, AVATAR.hipY, 0);

  group.userData.parts = { torso, head, armL, armR, legL, legR };
  group.userData.mats = m;
  return group;
}

export function animateHumanoid(group, dt, speed, aim) {
  const p = group.userData.parts;
  if (!p) return;
  group.userData.t = (group.userData.t || 0) + dt * (1.6 + speed * 2.2);
  const t = group.userData.t;
  const swing = Math.min(1, speed / 3.2);
  p.legL.rotation.x = Math.sin(t) * 0.66 * swing;
  p.legR.rotation.x = -Math.sin(t) * 0.66 * swing;
  if (aim) {
    // 正面是局部 -Z：手臂绕 +X 抬起指向正前方，右臂托枪、左臂扶护木
    p.armR.rotation.x = 1.35 + Math.sin(t * 0.8) * 0.03;
    p.armR.rotation.z = -0.06;
    p.armL.rotation.x = 1.5 + Math.sin(t * 0.8 + 0.7) * 0.03;
    p.armL.rotation.z = 0.14;
  } else {
    p.armR.rotation.x = -Math.sin(t) * 0.5 * swing;
    p.armR.rotation.z = 0;
    p.armL.rotation.x = Math.sin(t) * 0.5 * swing;
    p.armL.rotation.z = 0;
  }
  p.torso.position.y = Math.abs(Math.sin(t)) * 0.012 * swing;
  p.head.rotation.y = Math.sin(t * 0.33) * 0.10;
}

/* ------------------------------------------------------------------ */
/* 展位主角                                                            */
/* ------------------------------------------------------------------ */

export function buildHero(hero) {
  hero = hero || {};
  const geo = avatarGeometries();
  const group = new THREE.Group();
  group.name = 'hero';

  const shirt = new THREE.Color(hero.tint || 0x8a5cff);
  const pants = shirt.clone().multiplyScalar(0.55);
  const skin = new THREE.Color(PALETTE.skin);
  const hair = new THREE.Color(PALETTE.hair);

  const tinted = (src, col) => {
    const g = src.clone();
    const c = g.attributes.color;
    for (let i = 0; i < c.count; i++) {
      c.setXYZ(i, c.getX(i) * col.r, c.getY(i) * col.g, c.getZ(i) * col.b);
    }
    return g;
  };
  const moved = (src, x, y, z) => {
    const g = src.clone();
    g.translate(x, y, z);
    return g;
  };

  const parts = [
    tinted(geo.torso, shirt),
    moved(tinted(geo.arm, shirt), -AVATAR.armX, AVATAR.shoulderY, 0),
    moved(tinted(geo.arm, shirt), AVATAR.armX, AVATAR.shoulderY, 0),
    moved(tinted(geo.leg, pants), -AVATAR.legX, AVATAR.hipY, 0),
    moved(tinted(geo.leg, pants), AVATAR.legX, AVATAR.hipY, 0),
    // 头部自带肤色/头发/五官，不再二次染色
    geo.head.clone()
  ];
  if (hero.helmet) {
    // 金色小王冠：三个圆角块，保持圆润语言
    const crown = new THREE.TorusGeometry(0.115, 0.020, 6, 18);
    crown.rotateX(Math.PI / 2);
    crown.translate(0, AVATAR.headY + 0.185, 0);
    parts.push(paint(crown, 0.95, 0.78, 0.25));
    for (let i = 0; i < 3; i++) {
      const spike = new THREE.ConeGeometry(0.028, 0.09, 6);
      spike.translate(Math.cos(i * 2.1) * 0.105, AVATAR.headY + 0.245, Math.sin(i * 2.1) * 0.105);
      parts.push(paint(spike, 0.95, 0.78, 0.25));
    }
  }
  if (hero.cape) {
    const cape = new THREE.PlaneGeometry(0.46, 0.86, 3, 4);
    cape.rotateX(0.14);
    cape.translate(0, 1.10, 0.20);
    parts.push(paint(cape, 0.34, 0.09, 0.11));
  }

  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const body = new THREE.Mesh(mergeGeos(parts), bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  parts.forEach((g) => g.dispose());

  group.scale.setScalar(hero.scale || 1.04);
  return group;
}

export function makeNameplate(title, name, subtitle, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 512, 160);
  const bg = x.createLinearGradient(0, 0, 512, 0);
  bg.addColorStop(0, 'rgba(10,12,14,0)');
  bg.addColorStop(0.14, 'rgba(10,12,14,.86)');
  bg.addColorStop(0.86, 'rgba(10,12,14,.86)');
  bg.addColorStop(1, 'rgba(10,12,14,0)');
  x.fillStyle = bg;
  x.fillRect(0, 12, 512, 132);
  x.fillStyle = color || '#d9b47a';
  x.fillRect(150, 132, 212, 3);
  x.textAlign = 'center';
  x.fillStyle = color || '#d9b47a';
  x.font = '700 26px ui-monospace, monospace';
  x.fillText(title, 256, 52);
  x.fillStyle = '#f2eee2';
  x.font = '700 40px system-ui, sans-serif';
  x.fillText(name, 256, 98);
  x.fillStyle = 'rgba(200,195,180,.9)';
  x.font = '500 22px ui-monospace, monospace';
  x.fillText(subtitle, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.2, 1.0, 1);
  return sprite;
}
