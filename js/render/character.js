// 人物模型：大厅人流、展位主角、对局 Bot 共用一套「有肩线、有护具、有靴子」的人形。
// 为了保证大厅能塞下几百人，躯干/头/四肢拆成可实例化的几何体。

import * as THREE from '../../vendor/three.module.js';
import { mergeGeos, paint } from '../world/geo-utils.js';
import { material } from '../world/textures.js';

let geoCache = null;
let mats = null;

function getMats() {
  if (mats) return mats;
  const fabric = material('fabric', { repeat: 3, roughness: 0.92 });
  const outfit = fabric.clone();
  outfit.vertexColors = true;
  outfit.roughness = 0.9;
  outfit.metalness = 0.03;

  const skin = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.7, metalness: 0.02
  });
  const gear = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.55, metalness: 0.25
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xc9a25a, metalness: 1.0, roughness: 0.24, emissive: 0x241a06, emissiveIntensity: 0.4
  });
  mats = { outfit, skin, gear, gold };
  return mats;
}

function capsule(r, len, sx, sy, sz, capSeg, radialSeg) {
  const g = new THREE.CapsuleGeometry(r, len, capSeg == null ? 4 : capSeg, radialSeg == null ? 10 : radialSeg);
  if (sx || sy || sz) g.scale(sx || 1, sy || 1, sz || 1);
  return g;
}

function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

function roundedBoxGeo(w, h, d) {
  // 用胶囊压扁做圆角块，比纯 Box 更有人体感；低分段保证几百人也不爆三角形
  const g = new THREE.CapsuleGeometry(Math.min(h, d) * 0.28, Math.max(0.001, w - Math.min(h, d) * 0.56), 2, 5);
  g.rotateZ(Math.PI / 2);
  g.scale(1, h / Math.min(h, d), d / Math.min(h, d));
  return g;
}

/* ------------------------------------------------------------------ */
/* 几何体                                                              */
/* ------------------------------------------------------------------ */

function buildTorso() {
  const parts = [];
  // 胸腔 / 腹部
  const chest = capsule(0.17, 0.2, 1.18, 1.0, 0.82);
  chest.translate(0, 1.2, 0);
  parts.push(paint(chest, 1, 1, 1));
  // 防弹背心
  const vest = box(0.36, 0.32, 0.27);
  vest.translate(0, 1.2, -0.01);
  parts.push(paint(vest, 0.28, 0.29, 0.27));
  // 背心织带
  for (let i = 0; i < 3; i++) {
    const strap = box(0.38, 0.035, 0.02);
    strap.translate(0, 1.09 + i * 0.09, -0.15);
    parts.push(paint(strap, 0.18, 0.18, 0.16));
  }
  // 胸袋
  for (let i = 0; i < 2; i++) {
    const pouch = roundedBoxGeo(0.11, 0.1, 0.07);
    pouch.translate(-0.09 + i * 0.18, 1.15, -0.17);
    parts.push(paint(pouch, 0.34, 0.33, 0.26));
  }
  // 胸挂带
  for (const sx of [-1, 1]) {
    const strap = box(0.045, 0.34, 0.018);
    strap.translate(sx * 0.09, 1.2, -0.155);
    parts.push(paint(strap, 0.15, 0.15, 0.13));
  }
  // 电台 + 天线
  const radio = roundedBoxGeo(0.075, 0.11, 0.05);
  radio.translate(-0.135, 1.24, -0.15);
  parts.push(paint(radio, 0.12, 0.13, 0.12));
  const antenna = new THREE.CylinderGeometry(0.004, 0.004, 0.2, 6);
  antenna.translate(-0.135, 1.42, -0.14);
  parts.push(paint(antenna, 0.07, 0.07, 0.065));
  // 肩章
  for (const sx of [-1, 1]) {
    const patch = box(0.06, 0.022, 0.085);
    patch.translate(sx * 0.202, 1.37, -0.1);
    parts.push(paint(patch, 0.62, 0.5, 0.2));
  }
  // 背包
  const pack = roundedBoxGeo(0.26, 0.34, 0.15);
  pack.translate(0, 1.16, 0.2);
  parts.push(paint(pack, 0.18, 0.19, 0.17));
  const packLid = roundedBoxGeo(0.2, 0.08, 0.13);
  packLid.translate(0, 1.3, 0.23);
  parts.push(paint(packLid, 0.22, 0.23, 0.2));
  // 肩部
  const shoulderL = capsule(0.075, 0.07, 1, 0.8, 0.9);
  shoulderL.rotateZ(Math.PI / 2);
  shoulderL.translate(-0.235, 1.43, 0);
  parts.push(paint(shoulderL, 0.26, 0.27, 0.25));
  const shoulderR = capsule(0.075, 0.07, 1, 0.8, 0.9);
  shoulderR.rotateZ(Math.PI / 2);
  shoulderR.translate(0.235, 1.43, 0);
  parts.push(paint(shoulderR, 0.26, 0.27, 0.25));
  // 腰带
  const belt = box(0.36, 0.07, 0.24);
  belt.translate(0, 0.99, 0);
  parts.push(paint(belt, 0.14, 0.14, 0.12));
  const buckle = box(0.07, 0.05, 0.02);
  buckle.translate(0, 0.99, -0.13);
  parts.push(paint(buckle, 0.55, 0.45, 0.22));
  // 腰包
  for (let i = 0; i < 2; i++) {
    const p = roundedBoxGeo(0.09, 0.09, 0.07);
    p.translate(-0.14 + i * 0.28, 0.97, 0.12);
    parts.push(paint(p, 0.3, 0.29, 0.23));
  }
  // 领口
  const collar = capsule(0.1, 0.06, 1.2, 1, 0.9);
  collar.translate(0, 1.48, 0);
  parts.push(paint(collar, 0.22, 0.23, 0.21));
  return mergeGeos(parts);
}

function buildHead(helmet) {
  const parts = [];
  const neck = new THREE.CylinderGeometry(0.055, 0.065, 0.1, 10);
  neck.translate(0, 1.5, 0);
  parts.push(paint(neck, 0.62, 0.47, 0.36));
  // 头
  const head = new THREE.SphereGeometry(0.105, 16, 12);
  head.scale(0.92, 1.08, 0.95);
  head.translate(0, 1.62, 0);
  parts.push(paint(head, 0.72, 0.55, 0.42));
  // 下巴/面罩下半
  const mask = capsule(0.085, 0.08, 1.05, 0.8, 0.8);
  mask.translate(0, 1.56, -0.01);
  parts.push(paint(mask, 0.2, 0.21, 0.2));
  if (helmet) {
    const shell = new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
    shell.translate(0, 1.63, 0);
    parts.push(paint(shell, 0.2, 0.22, 0.21));
    const rim = new THREE.TorusGeometry(0.112, 0.012, 6, 16);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, 1.63, 0);
    parts.push(paint(rim, 0.28, 0.29, 0.27));
    const goggle = box(0.18, 0.045, 0.03);
    goggle.translate(0, 1.66, -0.095);
    parts.push(paint(goggle, 0.1, 0.14, 0.16));
    // NVG 支架 / 头盔导轨
    const nvg = box(0.05, 0.05, 0.045);
    nvg.translate(0, 1.72, -0.1);
    parts.push(paint(nvg, 0.1, 0.11, 0.1));
    for (const sx of [-1, 1]) {
      const rail = box(0.02, 0.03, 0.1);
      rail.translate(sx * 0.105, 1.66, -0.01);
      parts.push(paint(rail, 0.16, 0.17, 0.16));
    }
    // 拾音耳机 + 麦克风
    for (const sx of [-1, 1]) {
      const cup = new THREE.CylinderGeometry(0.034, 0.036, 0.03, 8);
      cup.rotateZ(Math.PI / 2);
      cup.translate(sx * 0.115, 1.62, 0.0);
      parts.push(paint(cup, 0.1, 0.1, 0.1));
    }
    const boom = new THREE.CylinderGeometry(0.004, 0.004, 0.12, 5);
    boom.rotateZ(Math.PI / 2 - 0.3);
    boom.translate(-0.08, 1.57, -0.06);
    parts.push(paint(boom, 0.08, 0.08, 0.08));
  } else {
    // 头发 / 头盔帽
    const cap = new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    cap.translate(0, 1.63, 0.005);
    parts.push(paint(cap, 0.15, 0.13, 0.11));
    const goggle = box(0.17, 0.035, 0.025);
    goggle.translate(0, 1.65, -0.09);
    parts.push(paint(goggle, 0.12, 0.12, 0.1));
  }
  return mergeGeos(parts);
}

function buildArm() {
  const parts = [];
  // 原点是肩关节，手臂向下
  const upper = capsule(0.052, 0.18, 1, 1, 0.95);
  upper.translate(0, -0.13, 0);
  parts.push(paint(upper, 1, 1, 1));
  // 肘护具
  const elbow = new THREE.SphereGeometry(0.055, 10, 8);
  elbow.translate(0, -0.27, -0.01);
  parts.push(paint(elbow, 0.24, 0.24, 0.22));
  const fore = capsule(0.045, 0.17, 1, 1, 0.95);
  fore.translate(0, -0.39, -0.015);
  parts.push(paint(fore, 0.95, 0.95, 0.95));
  // 手套
  const glove = roundedBoxGeo(0.075, 0.085, 0.1);
  glove.translate(0, -0.51, -0.02);
  parts.push(paint(glove, 0.16, 0.15, 0.13));
  // 指节
  for (let i = 0; i < 3; i++) {
    const k = box(0.03, 0.018, 0.06);
    k.translate(-0.022 + i * 0.022, -0.5, -0.07);
    parts.push(paint(k, 0.1, 0.1, 0.09));
  }
  return mergeGeos(parts);
}

function buildLeg() {
  const parts = [];
  // 原点是髋关节，腿向下
  const thigh = capsule(0.075, 0.24, 1.05, 1, 1);
  thigh.translate(0, -0.2, 0);
  parts.push(paint(thigh, 0.9, 0.9, 0.9));
  // 护膝
  const knee = new THREE.SphereGeometry(0.075, 10, 8);
  knee.scale(1, 0.9, 1.05);
  knee.translate(0, -0.43, -0.03);
  parts.push(paint(knee, 0.24, 0.25, 0.23));
  // 护膝绑带
  for (const dy of [-0.03, 0.03]) {
    const strap = box(0.155, 0.016, 0.02);
    strap.translate(0, -0.43 + dy, -0.025);
    parts.push(paint(strap, 0.12, 0.12, 0.11));
  }
  const shin = capsule(0.06, 0.26, 1, 1, 1);
  shin.translate(0, -0.65, 0);
  parts.push(paint(shin, 0.95, 0.95, 0.95));
  // 战术腿套
  const holster = roundedBoxGeo(0.075, 0.17, 0.07);
  holster.translate(0.085, -0.27, 0.0);
  parts.push(paint(holster, 0.13, 0.13, 0.12));
  const thighStrap = box(0.17, 0.02, 0.02);
  thighStrap.translate(0.02, -0.26, 0);
  parts.push(paint(thighStrap, 0.1, 0.1, 0.095));
  // 靴子
  const boot = roundedBoxGeo(0.115, 0.13, 0.25);
  boot.translate(0, -0.88, -0.045);
  parts.push(paint(boot, 0.14, 0.13, 0.12));
  const sole = box(0.12, 0.035, 0.27);
  sole.translate(0, -0.925, -0.045);
  parts.push(paint(sole, 0.08, 0.08, 0.075));
  return mergeGeos(parts);
}

function buildTorsoLow() {
  const parts = [];
  // 低模也要有胸廓与肩线：胶囊躯干 + 圆角背心，远看不再是「方块人」
  const chest = capsule(0.17, 0.2, 1.16, 1.0, 0.82, 2, 5);
  chest.translate(0, 1.2, 0);
  parts.push(paint(chest, 1, 1, 1));
  const vest = roundedBoxGeo(0.35, 0.3, 0.26);
  vest.translate(0, 1.2, -0.01);
  parts.push(paint(vest, 0.28, 0.29, 0.27));
  for (let i = 0; i < 3; i++) {
    const strap = box(0.37, 0.03, 0.018);
    strap.translate(0, 1.09 + i * 0.085, -0.145);
    parts.push(paint(strap, 0.18, 0.18, 0.16));
  }
  const belt = box(0.35, 0.07, 0.24);
  belt.translate(0, 0.99, 0);
  parts.push(paint(belt, 0.14, 0.14, 0.12));
  // 圆肩
  for (const sx of [-1, 1]) {
    const sh = capsule(0.072, 0.05, 1, 0.72, 0.92, 1, 4);
    sh.rotateZ(Math.PI / 2);
    sh.translate(sx * 0.235, 1.43, 0);
    parts.push(paint(sh, 0.26, 0.27, 0.25));
  }
  // 斜挎枪：让大厅人群的剪影更像 FPS 玩家
  const slung = box(0.055, 0.62, 0.09);
  slung.rotateZ(0.42);
  slung.translate(0, 1.18, 0.17);
  parts.push(paint(slung, 0.13, 0.13, 0.12));
  const strap = box(0.045, 0.5, 0.03);
  strap.rotateZ(-0.4);
  strap.translate(0, 1.26, -0.15);
  parts.push(paint(strap, 0.18, 0.16, 0.12));
  // 背包剪影
  const pack = roundedBoxGeo(0.23, 0.28, 0.12);
  pack.translate(0, 1.16, 0.19);
  parts.push(paint(pack, 0.17, 0.18, 0.16));
  return mergeGeos(parts);
}

function buildHeadLow(helmet) {
  const parts = [];
  const head = new THREE.SphereGeometry(0.105, 6, 5);
  head.scale(0.92, 1.08, 0.95);
  head.translate(0, 1.62, 0);
  parts.push(paint(head, 0.72, 0.55, 0.42));
  if (helmet) {
    const shell = new THREE.SphereGeometry(0.118, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.6);
    shell.translate(0, 1.63, 0);
    parts.push(paint(shell, 0.2, 0.22, 0.21));
  } else {
    const cap = new THREE.SphereGeometry(0.108, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.55);
    cap.translate(0, 1.63, 0.005);
    parts.push(paint(cap, 0.15, 0.13, 0.11));
  }
  const goggle = box(0.17, 0.04, 0.03);
  goggle.translate(0, 1.65, -0.09);
  parts.push(paint(goggle, 0.1, 0.13, 0.14));
  return mergeGeos(parts);
}

function buildArmLow() {
  const parts = [];
  // 手臂保留低面数盒子：躯干圆肩之后，盒状四肢在 5 m 外几乎看不出
  const upper = box(0.095, 0.3, 0.1);
  upper.translate(0, -0.15, 0);
  parts.push(paint(upper, 1, 1, 1));
  const fore = box(0.085, 0.27, 0.09);
  fore.translate(0, -0.42, -0.015);
  parts.push(paint(fore, 0.95, 0.95, 0.95));
  const glove = box(0.075, 0.09, 0.1);
  glove.translate(0, -0.55, -0.02);
  parts.push(paint(glove, 0.16, 0.15, 0.13));
  return mergeGeos(parts);
}

function buildLegLow() {
  const parts = [];
  const thigh = box(0.145, 0.42, 0.16);
  thigh.translate(0, -0.21, 0);
  parts.push(paint(thigh, 0.9, 0.9, 0.9));
  const shin = box(0.115, 0.36, 0.13);
  shin.translate(0, -0.62, 0);
  parts.push(paint(shin, 0.95, 0.95, 0.95));
  const boot = box(0.115, 0.13, 0.25);
  boot.translate(0, -0.88, -0.045);
  parts.push(paint(boot, 0.14, 0.13, 0.12));
  return mergeGeos(parts);
}

export function crowdGeometries(low) {
  if (!geoCache) geoCache = {};
  const key = low ? 'low' : 'high';
  if (geoCache[key]) return geoCache[key];
  if (low) {
    geoCache.low = {
      torso: buildTorsoLow(),
      head: buildHeadLow(false),
      helmetHead: buildHeadLow(true),
      arm: buildArmLow(),
      leg: buildLegLow()
    };
  } else {
    geoCache.high = {
      torso: buildTorso(),
      head: buildHead(false),
      helmetHead: buildHead(true),
      arm: buildArm(),
      leg: buildLeg()
    };
  }
  return geoCache[key];
}

/* ------------------------------------------------------------------ */
/* 非实例化人物（Bot / 展位主角）                                       */
/* ------------------------------------------------------------------ */

export function buildHumanoid(opts) {
  opts = opts || {};
  let m = getMats();
  if (opts.cloneMats) {
    m = {
      outfit: m.outfit.clone(),
      skin: m.skin.clone(),
      gear: m.gear.clone(),
      gold: m.gold
    };
    if (opts.tint) m.outfit.color.setHex(opts.tint);
    if (opts.skinTint) m.skin.color.setHex(opts.skinTint);
  }
  const geo = crowdGeometries();
  const group = new THREE.Group();
  group.name = 'humanoid';

  const torso = new THREE.Mesh(geo.torso, m.outfit);
  torso.castShadow = true;
  torso.receiveShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(opts.helmet ? geo.helmetHead : geo.head, m.skin);
  head.castShadow = true;
  group.add(head);

  function limb(geoPart, x, y, z) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const mesh = new THREE.Mesh(geoPart, m.outfit);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  }

  const armL = limb(geo.arm, -0.245, 1.43, 0);
  const armR = limb(geo.arm, 0.245, 1.43, 0);
  const legL = limb(geo.leg, -0.095, 0.95, 0);
  const legR = limb(geo.leg, 0.095, 0.95, 0);

  if (opts.gold) {
    // 典藏家肩甲与披风
    const g = getMats().gold;
    const pauldronL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), g);
    pauldronL.position.set(-0.24, 1.44, 0);
    pauldronL.scale.set(1, 0.75, 1);
    pauldronL.castShadow = true;
    group.add(pauldronL);
    const pauldronR = pauldronL.clone();
    pauldronR.position.x = 0.24;
    group.add(pauldronR);
    const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.9, 4, 6), new THREE.MeshStandardMaterial({
      color: 0x5a1a1e, roughness: 0.95, metalness: 0.02, side: THREE.DoubleSide
    }));
    cape.position.set(0, 1.05, 0.16);
    cape.rotation.x = 0.12;
    cape.castShadow = true;
    group.add(cape);
    group.userData.cape = cape;
  }

  group.userData.parts = { torso, head, armL, armR, legL, legR };
  return group;
}

export function animateHumanoid(group, dt, speed, aim) {
  const p = group.userData.parts;
  if (!p) return;
  group.userData.t = (group.userData.t || 0) + dt * (1.6 + speed * 2.2);
  const t = group.userData.t;
  const swing = Math.min(1, speed / 3.2);
  p.legL.rotation.x = Math.sin(t) * 0.55 * swing;
  p.legR.rotation.x = -Math.sin(t) * 0.55 * swing;
  p.armL.rotation.x = -Math.sin(t) * 0.42 * swing;
  if (aim) {
    p.armR.rotation.x = -1.25 + Math.sin(t * 0.8) * 0.035;
    p.armR.rotation.z = -0.12;
  } else {
    p.armR.rotation.x = Math.sin(t) * 0.42 * swing;
    p.armR.rotation.z = 0;
  }
  p.torso.position.y = Math.abs(Math.sin(t)) * 0.014 * swing;
  if (p.head) p.head.rotation.y = Math.sin(t * 0.33) * 0.12;
}

/* ------------------------------------------------------------------ */
/* 展位主角 / 名牌                                                     */
/* ------------------------------------------------------------------ */

export function buildHero(hero) {
  // 展位主角是静态陈列：把所有部件合并成一个 mesh，draw call 最低。
  const m = getMats();
  const geo = crowdGeometries(true);
  const group = new THREE.Group();
  group.name = 'hero';

    function moved(src, x, y, z, rx) {
    const g = src.clone();
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return g;
  }
  const tint = new THREE.Color(hero.tint || 0xffffff);
  function tinted(g) {
    const c = g.attributes.color;
    if (!c) return g;
    for (let i = 0; i < c.count; i++) {
      c.setXYZ(i, c.getX(i) * tint.r, c.getY(i) * tint.g, c.getZ(i) * tint.b);
    }
    return g;
  }

  const bodyParts = [
    tinted(geo.torso.clone()),
    tinted(moved(geo.arm, -0.245, 1.43, 0, 0)),
    tinted(moved(geo.arm, 0.245, 1.43, 0, -1.15)),
    tinted(moved(geo.leg, -0.095, 0.95, 0, 0)),
    tinted(moved(geo.leg, 0.095, 0.95, 0, 0)),
    (hero.helmet ? geo.helmetHead : geo.head).clone()
  ];
  // 金色肩甲
  [-0.24, 0.24].forEach((x) => {
    const s = new THREE.SphereGeometry(0.09, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.6);
    s.scale(1, 0.72, 1);
    s.translate(x, 1.44, 0);
    bodyParts.push(paint(s, 0.78, 0.58, 0.28));
  });
  // 披风
  const cape = new THREE.PlaneGeometry(0.44, 0.9, 3, 4);
  cape.rotateX(0.12);
  cape.translate(0, 1.05, 0.16);
  bodyParts.push(paint(cape, 0.34, 0.09, 0.11));

  const bodyMat = m.outfit.clone();
  bodyMat.side = THREE.DoubleSide;
  bodyMat.roughness = 0.72;
  bodyMat.metalness = 0.18;
  bodyMat.emissive = new THREE.Color(0x1c150d);
  bodyMat.emissiveIntensity = 0.45;
  const body = new THREE.Mesh(mergeGeos(bodyParts), bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  bodyParts.forEach((g) => g.dispose());

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
