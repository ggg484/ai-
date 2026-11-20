// 军械大厅：开放式穹顶、中央陈列柱、藏品墙、三条靶道、左右传送门、二层观景台。
// 设计目标：空旷、明亮、能塞人；贵的东西一眼可见，但不挡普通玩家的路。

import * as THREE from '../../vendor/three.module.js';
import { World } from './collision.js';
import { material, flat, canvasTexture } from './textures.js';
import { GeoBatch, mergeGeos } from './geo-utils.js';
import { buildDisplayWeapon, buildProxyWeapon } from '../render/weapon-models.js';
import { applySkin } from '../render/skin-material.js';
import { SKIN_MAP, defaultVariant, wearLabel } from '../config/skins.js';
import { buildHero, makeNameplate } from '../render/character.js';
import { buildPropModel, mergePropsByMaterial } from '../render/prop-models.js';
import { HERO_SHOWCASE, tierById, LOBBY_INTERACTIONS, LOBBY_TELEPORTS } from '../config/lobby.js';

/* ------------------------------------------------------------------ */
/* 贴图                                                                */
/* ------------------------------------------------------------------ */

function gradientTexture(inner, outer, size) {
  const s = size || 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, inner);
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return canvasTexture(c);
}

function portalTexture(colorA, colorB) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 6, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,.95)');
  g.addColorStop(0.22, colorA);
  g.addColorStop(0.7, colorB);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  // 旋涡
  x.translate(s / 2, s / 2);
  for (let i = 0; i < 7; i++) {
    x.strokeStyle = 'rgba(255,255,255,' + (0.05 + i * 0.015) + ')';
    x.lineWidth = 2 + i;
    x.beginPath();
    for (let a = 0; a < Math.PI * 2.4; a += 0.1) {
      const r = 8 + a * 26 + i * 4;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (a === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.stroke();
  }
  return canvasTexture(c);
}

function rangeDecalTexture() {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.clearRect(0, 0, w, h);
  const X = (v) => (v - 32) / 46 * w;
  const Z = (v) => (v + 12) / 24 * h;
  // 三条靶道的淡色区域
  const bands = [
    { z0: -9, z1: -3, color: 'rgba(224,106,53,.07)' },
    { z0: -3, z1: 3, color: 'rgba(143,178,201,.07)' },
    { z0: 3, z1: 9, color: 'rgba(111,143,94,.07)' }
  ];
  bands.forEach((b) => {
    x.fillStyle = b.color;
    x.fillRect(X(32), Z(b.z0), X(78) - X(32), Z(b.z1) - Z(b.z0));
  });
  // 道分隔线
  x.strokeStyle = 'rgba(217,180,122,.28)';
  x.lineWidth = 3;
  [-9, -3, 3, 9].forEach((z) => {
    x.beginPath();
    x.moveTo(X(33), Z(z));
    x.lineTo(X(77), Z(z));
    x.stroke();
  });
  // 中心虚线
  x.setLineDash([26, 20]);
  x.strokeStyle = 'rgba(236,231,216,.18)';
  x.lineWidth = 2;
  [-6, 0, 6].forEach((z) => {
    x.beginPath();
    x.moveTo(X(37), Z(z));
    x.lineTo(X(76), Z(z));
    x.stroke();
  });
  x.setLineDash([]);
  // 距离刻度
  [46, 54, 66].forEach((dx, i) => {
    x.strokeStyle = 'rgba(217,180,122,.35)';
    x.lineWidth = 4;
    x.beginPath();
    x.moveTo(X(dx), Z(-9));
    x.lineTo(X(dx), Z(9));
    x.stroke();
    for (let z = -9; z <= 9; z += 1.5) {
      x.strokeStyle = 'rgba(217,180,122,.2)';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(X(dx) - 9, Z(z));
      x.lineTo(X(dx) + 9, Z(z));
      x.stroke();
    }
  });
  // 射击线
  x.fillStyle = 'rgba(224,106,53,.55)';
  x.fillRect(X(36.2) - 5, Z(-9), 10, Z(9) - Z(-9));
  return canvasTexture(c);
}

function bannerTexture(title, sub, accent) {
  const w = 384, h = 768;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2a1518');
  bg.addColorStop(0.45, '#1a1113');
  bg.addColorStop(1, '#120d0f');
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  // 金色边框与角标
  x.strokeStyle = 'rgba(217,180,122,.55)';
  x.lineWidth = 4;
  x.strokeRect(14, 14, w - 28, h - 28);
  x.strokeStyle = 'rgba(217,180,122,.2)';
  x.lineWidth = 2;
  x.strokeRect(26, 26, w - 52, h - 52);
  // 顶部菱形徽记
  x.save();
  x.translate(w / 2, 86);
  x.rotate(Math.PI / 4);
  x.fillStyle = accent || '#d9b47a';
  x.fillRect(-20, -20, 40, 40);
  x.fillStyle = '#141010';
  x.fillRect(-10, -10, 20, 20);
  x.restore();
  // 竖排标题
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const chars = Array.from(title);
  const startY = 210;
  const step = 74;
  chars.forEach((ch, i) => {
    x.fillStyle = i === chars.length - 1 ? (accent || '#d9b47a') : '#efe7d6';
    x.font = '700 58px "PingFang SC","Microsoft YaHei",sans-serif';
    x.fillText(ch, w / 2, startY + i * step);
  });
  // 竖排英文副标
  x.save();
  x.translate(w - 44, 190);
  x.fillStyle = 'rgba(217,180,122,.65)';
  x.font = '600 15px ui-monospace, monospace';
  x.letterSpacing = '3px';
  const subChars = Array.from(sub);
  subChars.forEach((ch, i) => x.fillText(ch, 0, i * 20));
  x.restore();
  // 底部横线
  x.fillStyle = 'rgba(217,180,122,.35)';
  x.fillRect(60, h - 88, w - 120, 2);
  x.fillStyle = 'rgba(200,190,170,.55)';
  x.font = '600 13px ui-monospace, monospace';
  x.fillText('SANDLINE · TACTICAL HALL', w / 2, h - 58);
  return canvasTexture(c);
}

function signTexture(lines, accent, w, h) {
  const c = document.createElement('canvas');
  c.width = w || 512;
  c.height = h || 256;
  const x = c.getContext('2d');
  x.fillStyle = '#111311';
  x.fillRect(0, 0, c.width, c.height);
  const g = x.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, 'rgba(255,255,255,.04)');
  g.addColorStop(1, 'rgba(0,0,0,.12)');
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = 'rgba(220,210,190,.18)';
  x.lineWidth = 4;
  x.strokeRect(6, 6, c.width - 12, c.height - 12);
  x.fillStyle = accent || '#d9b47a';
  x.fillRect(24, 24, c.width - 48, 5);
  x.textAlign = 'center';
  const base = lines.length === 1 ? 0.58 : 0.42;
  lines.forEach((ln, i) => {
    x.fillStyle = i === 0 ? '#f2eee2' : 'rgba(190,184,168,.9)';
    x.font = (i === 0 ? '700 ' : '500 ') + (i === 0 ? Math.round(c.height * 0.22) : Math.round(c.height * 0.12)) + 'px ui-monospace, monospace';
    x.fillText(ln, c.width / 2, c.height * (base + i * 0.22));
  });
  return canvasTexture(c);
}

/* ------------------------------------------------------------------ */
/* 主构建                                                              */
/* ------------------------------------------------------------------ */

export function buildLobby(scene) {
  const root = new THREE.Group();
  root.name = 'lobby';
  scene.add(root);

  const world = new World();
  const batch = new GeoBatch(root, world, 2.6);
  const animated = [];
  const cases = [];
  const heroes = [];
  const portals = [];

  const HALL = { minX: -32, maxX: 32, minZ: -24, maxZ: 24, h: 13 };
  const RANGE = { minX: 32, maxX: 78, minZ: -12, maxZ: 12 };

  /* ---------------- 地面 ---------------- */

  const hallFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL.maxX - HALL.minX, HALL.maxZ - HALL.minZ),
    material('marble', { repeat: 9, roughness: 0.55, metalness: 0.02 })
  );
  hallFloor.material.envMapIntensity = 0.35;
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.position.set(0, 0, 0);
  hallFloor.receiveShadow = true;
  hallFloor.name = 'hall-floor';
  root.add(hallFloor);
  world.add({ minX: HALL.minX, maxX: HALL.maxX, minY: -1, maxY: 0, minZ: HALL.minZ, maxZ: HALL.maxZ, tag: 'ground' });

  const rangeFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(RANGE.maxX - RANGE.minX, RANGE.maxZ - RANGE.minZ),
    material('concrete', { repeat: 10, roughness: 0.72 })
  );
  rangeFloor.rotation.x = -Math.PI / 2;
  rangeFloor.position.set((RANGE.minX + RANGE.maxX) / 2, 0, 0);
  rangeFloor.receiveShadow = true;
  root.add(rangeFloor);
  world.add({ minX: RANGE.minX, maxX: RANGE.maxX, minY: -1, maxY: 0, minZ: RANGE.minZ, maxZ: RANGE.maxZ, tag: 'ground' });

  // 中央铜环 + 红毯
  const ringGeos = [];
  [[8.4, 0.05], [8.8, 0.02], [4.2, 0.03]].forEach(([r, t]) => {
    const g = new THREE.TorusGeometry(r, t, 6, 96);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.02, -2);
    ringGeos.push(g);
  });
  const ringMesh = new THREE.Mesh(mergeGeos(ringGeos), material('gold', { repeat: 3, roughness: 0.3 }));
  ringMesh.receiveShadow = false;
  root.add(ringMesh);

  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 17),
    material('fabric', { repeat: 4, color: 0x5c1e22, roughness: 0.98 })
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.015, 11);
  carpet.receiveShadow = true;
  root.add(carpet);
  // 地毯金边
  [-2.45, 2.45].forEach((x) => {
    const trim = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 17), material('gold', { repeat: 2 }));
    trim.rotation.x = -Math.PI / 2;
    trim.position.set(x, 0.02, 11);
    root.add(trim);
  });

  /* ---------------- 墙体 / 结构 ---------------- */

  const wallH = HALL.h;
  // 北 / 南 / 西
  batch.box(0, wallH / 2, HALL.minZ - 0.5, HALL.maxX - HALL.minX, wallH, 1, 'sandstone', { tag: 'wall' });
  batch.box(0, wallH / 2, HALL.maxZ + 0.5, HALL.maxX - HALL.minX, wallH, 1, 'sandstone', { tag: 'wall' });
  batch.box(HALL.minX - 0.5, wallH / 2, 0, 1, wallH, HALL.maxZ - HALL.minZ, 'sandstone', { tag: 'wall' });
  // 东墙留出三条靶道门洞（z -9..9）
  [[-16.5, 15], [16.5, 15]].forEach(([cz, len]) => {
    batch.box(HALL.maxX + 0.5, wallH / 2, cz, 1, wallH, len, 'sandstone', { tag: 'wall' });
  });
  // 门洞过梁
  [4.5].forEach((y) => {
    batch.box(HALL.maxX + 0.5, y + 1.5, 0, 1, 3, 18, 'sandstone', { tag: 'wall' });
  });
  // 踢脚 / 腰线 / 檐口
  [[0.35, 0.6], [4.2, 0.18], [11.4, 0.5]].forEach(([y, h]) => {
    batch.box(0, y, HALL.minZ + 0.1, 63, h, 0.22, 'concrete', { collide: false });
    batch.box(0, y, HALL.maxZ - 0.1, 63, h, 0.22, 'concrete', { collide: false });
    batch.box(HALL.minX + 0.1, y, 0, 0.22, h, 47, 'concrete', { collide: false });
  });
  [[-16.5, 15], [16.5, 15]].forEach(([cz, len]) => {
    batch.box(HALL.maxX - 0.1, 0.35, cz, 0.22, 0.6, len, 'concrete', { collide: false });
  });

  // 壁柱
  [-24, -16, -8, 8, 16, 24].forEach((x) => {
    batch.box(x, 5.7, HALL.minZ + 0.8, 1.5, 11.4, 1.2, 'concrete', { tag: 'pillar' });
    batch.box(x, 0.4, HALL.minZ + 0.8, 1.8, 0.8, 1.5, 'concrete', { collide: false });
    batch.box(x, 11.2, HALL.minZ + 0.8, 1.9, 0.4, 1.6, 'gold', { collide: false });
  });
  [-24, -16, -8, 8, 16, 24].forEach((x) => {
    batch.box(x, 5.7, HALL.maxZ - 0.8, 1.5, 11.4, 1.2, 'concrete', { tag: 'pillar' });
    batch.box(x, 0.4, HALL.maxZ - 0.8, 1.8, 0.8, 1.5, 'concrete', { collide: false });
    batch.box(x, 11.2, HALL.maxZ - 0.8, 1.9, 0.4, 1.6, 'gold', { collide: false });
  });
  // 四根独立圆柱
  [[-20, -10], [20, -10], [-20, 12], [20, 12]].forEach(([x, z]) => {
    const col = new THREE.CylinderGeometry(0.8, 0.95, 12, 20);
    col.translate(x, 6, z);
    batch.geo('concrete', col, {});
    world.add({ minX: x - 0.95, maxX: x + 0.95, minY: 0, maxY: 12, minZ: z - 0.95, maxZ: z + 0.95, tag: 'pillar' });
    const band = new THREE.CylinderGeometry(0.92, 0.92, 0.35, 20);
    band.translate(x, 0.6, z);
    batch.geo('gold', band, {});
    const band2 = new THREE.CylinderGeometry(0.86, 0.86, 0.3, 20);
    band2.translate(x, 10.6, z);
    batch.geo('gold', band2, {});
  });

  // 屋顶梁架（开放式，阳光直接打进来）
  for (let z = -20; z <= 20; z += 8) {
    batch.box(0, 12.55, z, 62, 0.38, 0.55, 'darkmetal', { collide: false });
    batch.box(0, 12.95, z, 62, 0.12, 0.9, 'metal', { collide: false });
  }
  for (let x = -28; x <= 28; x += 8) {
    batch.box(x, 12.7, 0, 0.35, 0.3, 46, 'darkmetal', { collide: false });
  }
  // 屋顶边缘一圈
  batch.box(0, 12.9, HALL.minZ + 0.4, 64, 0.5, 1.6, 'plaster', { collide: false, castShadow: false });
  batch.box(0, 12.9, HALL.maxZ - 0.4, 64, 0.5, 1.6, 'plaster', { collide: false, castShadow: false });
  batch.box(HALL.minX + 0.4, 12.9, 0, 1.6, 0.5, 48, 'plaster', { collide: false, castShadow: false });
  batch.box(HALL.maxX - 0.4, 12.9, 0, 1.6, 0.5, 48, 'plaster', { collide: false, castShadow: false });

  // 悬挂灯
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffd9a0, emissive: 0xffb060, emissiveIntensity: 2.4, roughness: 0.4
  });
  const lampGeos = [];
  [[-12, -8], [12, -8], [-12, 8], [12, 8], [0, 0]].forEach(([x, z]) => {
    const g = new THREE.SphereGeometry(0.28, 12, 8);
    g.scale(1, 0.7, 1);
    g.translate(x, 9.4, z);
    lampGeos.push(g);
    const rod = new THREE.CylinderGeometry(0.03, 0.03, 2.8, 6);
    rod.translate(x, 10.9, z);
    lampGeos.push(rod);
  });
  const lampMesh = new THREE.Mesh(mergeGeos(lampGeos), lampMat);
  root.add(lampMesh);

  // 体积光柱（加色平面，不写深度）
  const shaftTex = gradientTexture('rgba(255,236,200,.30)', 'rgba(255,236,200,0)', 128);
  const shafts = [];
  [[-14, -2], [0, -6], [14, -2], [-8, 8], [8, 8]].forEach(([x, z]) => {
    const g = new THREE.PlaneGeometry(5, 13);
    g.translate(x, 6.5, z);
    shafts.push(g);
  });
  const shaftMesh = new THREE.Mesh(mergeGeos(shafts), new THREE.MeshBasicMaterial({
    map: shaftTex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false
  }));
  shaftMesh.renderOrder = 5;
  root.add(shaftMesh);

  // 大厅氛围灯（只开两盏，控制移动端 shader 成本）
  const l1 = new THREE.PointLight(0xffcf90, 34, 42, 2);
  l1.position.set(-12, 8.6, 4);
  root.add(l1);
  const l2 = new THREE.PointLight(0xffcf90, 34, 42, 2);
  l2.position.set(12, 8.6, -4);
  root.add(l2);

  /* ---------------- 中央陈列柱 ---------------- */

  const monument = new THREE.Group();
  monument.position.set(0, 0, -2);
  root.add(monument);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.0, 0.55, 32), material('marble', { repeat: 3, roughness: 0.3 }));
  plinth.position.y = 0.275;
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  monument.add(plinth);
  const plinthGold = new THREE.Mesh(new THREE.TorusGeometry(3.55, 0.05, 6, 64), material('gold', { repeat: 2 }));
  plinthGold.rotation.x = Math.PI / 2;
  plinthGold.position.y = 0.56;
  monument.add(plinthGold);
  world.add({ minX: -4, maxX: 4, minY: 0, maxY: 0.55, minZ: -6, maxZ: 2, tag: 'monument' });

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfd4d8, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.16,
    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6
  });
  const vitrine = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.2, 2.4), glassMat);
  vitrine.position.y = 2.65;
  vitrine.renderOrder = 4;
  monument.add(vitrine);

  // 金色框架：上下框 + 四根立柱 + 内部光环
  const goldParts = [];
  const top = new THREE.BoxGeometry(2.7, 0.14, 2.7);
  top.translate(0, 4.79, 0);
  goldParts.push(top);
  const bottom = new THREE.BoxGeometry(2.7, 0.14, 2.7);
  bottom.translate(0, 0.62, 0);
  goldParts.push(bottom);
  [[-1.28, -1.28], [1.28, -1.28], [-1.28, 1.28], [1.28, 1.28]].forEach(([px, pz]) => {
    const post = new THREE.BoxGeometry(0.09, 4.1, 0.09);
    post.translate(px, 2.7, pz);
    goldParts.push(post);
  });
  const halo = new THREE.TorusGeometry(1.15, 0.025, 5, 40);
  halo.rotateX(Math.PI / 2);
  halo.translate(0, 2.35, 0);
  goldParts.push(halo);
  const vitrineGold = new THREE.Mesh(mergeGeos(goldParts), material('gold', { repeat: 2 }));
  monument.add(vitrineGold);
  goldParts.forEach((g) => g.dispose());

  const knifePivot = new THREE.Group();
  knifePivot.position.set(0, 2.65, 0);
  monument.add(knifePivot);
  const centerKnife = buildDisplayWeapon('knife', true);
  centerKnife.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  centerKnife.userData.weaponId = 'knife';
  applySkin(centerKnife, SKIN_MAP['knife_gilded'], { wear: 0.028, seed: 132, offset: 0.18, preset: 0 });
  centerKnife.scale.setScalar(2.4);
  centerKnife.rotation.x = -Math.PI / 2;
  centerKnife.rotation.z = 0.12;
  knifePivot.add(centerKnife);
  animated.push({ obj: knifePivot, spin: 0.4 });

  const centerBeam = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 5.4, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffdca0, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false
    })
  );
  centerBeam.position.y = 2.8;
  monument.add(centerBeam);

  const centerPlate = makeNameplate('本期典藏', '鎏金爪刀', 'ARCHIVE · 永久陈列', '#d9b47a');
  centerPlate.position.set(0, 5.35, 0);
  monument.add(centerPlate);
  animated.push({ obj: centerPlate, bob: 0.04 });


  /* ---------------- 藏品墙（西侧三个展柜） ---------------- */

  const caseWeaponIds = ['ak', 'glock', 'knife'];
  const caseSkins = ['ak_redline', 'glock_neon', 'knife_gilded'];
  const caseNames = ['AK-47 · 赤线', 'GLOCK-18 · 霓虹脉冲', '爪刀 · 鎏金'];
  const caseVariants = [
    { wear: 0.236, seed: 886, offset: 0.71, preset: 2 },
    { wear: 0.028, seed: 132, offset: 0.18, preset: 0 },
    { wear: 0.412, seed: 1207, offset: 0.37, preset: 3 }
  ];
  const caseZ = [-4.2, 2.0, 8.2];
  const glassGeos = [];
  const frameGeos = [];
  const baseGeos = [];

  caseWeaponIds.forEach((wid, i) => {
    const z = caseZ[i];
    const x = -28.4;
    // 基座
    const b = new THREE.BoxGeometry(2.6, 1.0, 2.2);
    b.translate(x, 0.5, z);
    baseGeos.push(b);
    world.add({ minX: x - 1.3, maxX: x + 1.3, minY: 0, maxY: 1.0, minZ: z - 1.1, maxZ: z + 1.1, tag: 'case' });
    // 玻璃罩
    const g = new THREE.BoxGeometry(2.4, 1.7, 2.0);
    g.translate(x, 2.05, z);
    glassGeos.push(g);
    // 金色边框
    const f = new THREE.BoxGeometry(2.55, 0.1, 2.15);
    f.translate(x, 2.95, z);
    frameGeos.push(f);
    const f2 = new THREE.BoxGeometry(2.55, 0.1, 2.15);
    f2.translate(x, 1.2, z);
    frameGeos.push(f2);
    // 内部光带
    const lightStrip = new THREE.BoxGeometry(2.2, 0.05, 0.06);
    lightStrip.translate(x, 2.86, z - 0.9);
    frameGeos.push(lightStrip);

    const weapon = buildDisplayWeapon(wid, true);
    weapon.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    weapon.userData.weaponId = wid;
    applySkin(weapon, SKIN_MAP[caseSkins[i]], caseVariants[i]);
    if (wid === 'ak') {
      weapon.scale.setScalar(1.25);
      weapon.position.set(x, 1.85, z);
      weapon.rotation.set(0, Math.PI / 2, 0.06);
    } else if (wid === 'glock') {
      weapon.scale.setScalar(1.5);
      weapon.position.set(x, 1.7, z);
      weapon.rotation.set(0, Math.PI / 2, 0.1);
    } else {
      weapon.scale.setScalar(1.7);
      weapon.position.set(x, 1.75, z);
      weapon.rotation.set(0.2, Math.PI / 2, -0.5);
    }
    root.add(weapon);
    animated.push({ obj: weapon, spin: 0.5 + i * 0.08 });

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.62),
      new THREE.MeshBasicMaterial({
        map: signTexture([
          caseNames[i],
          wearLabel(caseVariants[i].wear).name + ' · ' + caseVariants[i].wear.toFixed(3) + ' · 可试穿'
        ], '#d9b47a', 512, 144),
        toneMapped: false
      })
    );
    label.position.set(x + 1.31, 1.7, z);
    label.rotation.y = Math.PI / 2;
    root.add(label);

    cases.push({ weaponId: wid, skinId: caseSkins[i], name: caseNames[i], object: weapon, z: z });
  });

  const caseGlass = new THREE.Mesh(mergeGeos(glassGeos), glassMat);
  caseGlass.renderOrder = 4;
  root.add(caseGlass);
  const caseFrames = new THREE.Mesh(mergeGeos(frameGeos), material('gold', { repeat: 2 }));
  caseFrames.castShadow = false;
  root.add(caseFrames);
  const caseBases = new THREE.Mesh(mergeGeos(baseGeos), material('darkmetal', { repeat: 3 }));
  caseBases.castShadow = false;
  caseBases.receiveShadow = true;
  root.add(caseBases);

  // 藏品墙背景招牌
  const wallSign = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 2.2),
    new THREE.MeshBasicMaterial({ map: signTexture(['藏品墙 · COLLECTION WALL', '所有展品可自由试穿'], '#d9b47a', 1024, 256), toneMapped: false })
  );
  wallSign.position.set(-31.3, 4.9, 2.0);
  wallSign.rotation.y = Math.PI / 2;
  root.add(wallSign);

  /* ---------------- 中央展位 / 典藏家 ---------------- */

  const heroPedestalGeos = [];
  const auraRingGeos = [];
  const heroGoldGeos = [];
  const heroBeamGeos = [];
  HERO_SHOWCASE.forEach((h) => {
    const tier = tierById(h.tier);
    const ped = new THREE.CylinderGeometry(1.25, 1.45, 0.36, 24);
    ped.translate(h.x, 0.18, h.z);
    heroPedestalGeos.push(ped);
    world.add({ minX: h.x - 1.45, maxX: h.x + 1.45, minY: 0, maxY: 0.36, minZ: h.z - 1.45, maxZ: h.z + 1.45, tag: 'pedestal' });

    const ring = new THREE.TorusGeometry(1.5, 0.035, 6, 48);
    ring.rotateX(Math.PI / 2);
    ring.translate(h.x, 0.03, h.z);
    auraRingGeos.push(ring);

    const goldRing = new THREE.TorusGeometry(1.3, 0.028, 5, 40);
    goldRing.rotateX(Math.PI / 2);
    goldRing.translate(h.x, 0.38, h.z);
    heroGoldGeos.push(goldRing);

    const beam = new THREE.ConeGeometry(1.35, 4.0, 14, 1, true);
    beam.translate(h.x, 2.42, h.z);
    heroBeamGeos.push(beam);

    const hero = buildHero(h);
    hero.position.set(h.x, 0.36, h.z);
    hero.rotation.y = h.yaw;
    root.add(hero);

    // 主角手持展品
    const w = buildProxyWeapon(h.weapon);
    w.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    w.userData.weaponId = h.weapon;
    applySkin(w, SKIN_MAP[h.skin], h.variant || defaultVariant(SKIN_MAP[h.skin]));
    if (h.weapon === 'knife') {
      w.scale.setScalar(0.85);
      w.position.set(0.32, 0.95, -0.25);
      w.rotation.set(0.2, -0.4, -1.1);
    } else {
      w.scale.setScalar(0.72);
      w.position.set(0.3, 0.95, -0.3);
      w.rotation.set(0, -0.15, 0.12);
    }
    hero.add(w);

    const plate = makeNameplate(tier.name, h.name, h.subtitle + ' · ' + h.collection + ' 件', tier.color);
    plate.position.set(h.x, 2.75, h.z);
    root.add(plate);
    animated.push({ obj: plate, bob: 0.03 });

    heroes.push({ cfg: h, group: hero, plate: plate, weapon: w });
    animated.push({ obj: hero, spin: 0.06 });
  });

  const heroBase = new THREE.Mesh(mergeGeos(heroPedestalGeos), material('darkmetal', { repeat: 3 }));
  heroBase.castShadow = true;
  heroBase.receiveShadow = true;
  root.add(heroBase);
  const auraMesh = new THREE.Mesh(mergeGeos(auraRingGeos), new THREE.MeshBasicMaterial({
    color: 0xd9b47a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false
  }));
  root.add(auraMesh);

  const heroGold = new THREE.Mesh(mergeGeos(heroGoldGeos), material('gold', { repeat: 2 }));
  root.add(heroGold);

  const heroBeam = new THREE.Mesh(mergeGeos(heroBeamGeos), new THREE.MeshBasicMaterial({
    color: 0xffdca0, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false
  }));
  heroBeam.renderOrder = 2;
  root.add(heroBeam);

  /* ---------------- 左右传送门 ---------------- */

  function makePortal(x, z, label, accent, sub) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = 0;
    root.add(group);

    // 石拱门（合并成一个 mesh）
    const archGeos = [];
    const sideL = new THREE.BoxGeometry(0.8, 5.2, 1.2);
    sideL.translate(-2.4, 2.6, 0);
    archGeos.push(sideL);
    const sideR = new THREE.BoxGeometry(0.8, 5.2, 1.2);
    sideR.translate(2.4, 2.6, 0);
    archGeos.push(sideR);
    const top = new THREE.BoxGeometry(5.6, 0.8, 1.4);
    top.translate(0, 5.2, 0);
    archGeos.push(top);
    const archMesh = new THREE.Mesh(mergeGeos(archGeos), material('sandstone', { repeat: 2 }));
    archMesh.castShadow = true;
    archMesh.receiveShadow = true;
    group.add(archMesh);
    archGeos.forEach((g) => g.dispose());
    const gold1 = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.1, 0.1), material('gold', { repeat: 2 }));
    gold1.position.set(0, 4.78, -0.72);
    group.add(gold1);
    world.add({ minX: x - 2.8, maxX: x - 2.0, minY: 0, maxY: 5.2, minZ: z - 0.6, maxZ: z + 0.6, tag: 'arch' });
    world.add({ minX: x + 2.0, maxX: x + 2.8, minY: 0, maxY: 5.2, minZ: z - 0.6, maxZ: z + 0.6, tag: 'arch' });

    // 门内旋涡
    const swirl = new THREE.Mesh(
      new THREE.PlaneGeometry(4.0, 4.6),
      new THREE.MeshBasicMaterial({
        map: portalTexture(accent, 'rgba(0,0,0,0)'), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
      })
    );
    swirl.position.set(0, 2.5, 0);
    swirl.renderOrder = 3;
    group.add(swirl);
    animated.push({ obj: swirl, spin: 0.18, plane: true });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.06, 8, 64), new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.9, toneMapped: false
    }));
    ring.position.set(0, 2.5, 0.03);
    group.add(ring);
    animated.push({ obj: ring, pulse: 0.04 });

    // 地面光带
    const pad = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false
    }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, 0.02, 2.2);
    group.add(pad);

    // 招牌
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 1.0),
      new THREE.MeshBasicMaterial({ map: signTexture([label, sub], accent, 720, 160), toneMapped: false })
    );
    sign.position.set(0, 6.0, 0);
    group.add(sign);

    portals.push({ x: x, z: z + 1.8, group: group, label: label });
    return group;
  }

  makePortal(-15, -22.2, '作 战 传 送', '#e06a35', 'MODES · 选择对局');
  makePortal(15, -22.2, '活 动 传 送', '#6d9ec9', 'ACTIVITIES · 大厅活动');

  /* ---------------- 大屏 ---------------- */

  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 1024;
  screenCanvas.height = 512;
  const screenTexture = canvasTexture(screenCanvas);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 6.4),
    new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false })
  );
  screen.position.set(0, 9.55, -18.78);
  root.add(screen);
  const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(16.6, 7.0, 0.2), material('darkmetal', { repeat: 2 }));
  screenFrame.position.set(0, 9.55, -18.92);
  root.add(screenFrame);

  /* ---------------- 二层看台 ---------------- */

  // 楼板
  batch.box(0, 5.2, -21.5, 60, 0.4, 5, 'concrete', { tag: 'mezzanine' });
  // 栏杆玻璃
  const railGlass = new THREE.Mesh(new THREE.BoxGeometry(56, 1.0, 0.06), glassMat);
  railGlass.position.set(0, 5.95, -19.0);
  railGlass.renderOrder = 4;
  root.add(railGlass);
  // 金色扶手
  const railTop = new THREE.Mesh(new THREE.BoxGeometry(56, 0.08, 0.12), material('gold', { repeat: 3 }));
  railTop.position.set(0, 6.48, -19.0);
  root.add(railTop);
  for (let x = -27; x <= 27; x += 3) {
    batch.box(x, 5.9, -19.0, 0.08, 1.0, 0.08, 'gold', { collide: false });
  }
  // 楼梯（西 / 东）
  [-28, 28].forEach((sx) => {
    for (let i = 0; i < 18; i++) {
      const y = 0.3 + i * 0.3;
      const z = -6.6 - i * 0.68;
      batch.box(sx, y / 2 + 0.15, z, 3.4, y, 0.7, 'concrete', { tag: 'stair' });
    }
  });

  /* ---------------- 靶场 ---------------- */

  // 靶场侧墙 / 后墙 / 隔墙
  batch.box((RANGE.minX + RANGE.maxX) / 2, 3, RANGE.minZ - 0.5, RANGE.maxX - RANGE.minX, 6, 1, 'concrete', { tag: 'wall' });
  batch.box((RANGE.minX + RANGE.maxX) / 2, 3, RANGE.maxZ + 0.5, RANGE.maxX - RANGE.minX, 6, 1, 'concrete', { tag: 'wall' });
  batch.box(RANGE.maxX + 0.5, 3, 0, 1, 6, RANGE.maxZ - RANGE.minZ, 'concrete', { tag: 'wall' });
  [-9, -3, 3, 9].forEach((z) => {
    batch.box((RANGE.minX + RANGE.maxX) / 2 + 1, 2, z, RANGE.maxX - RANGE.minX - 2, 4, 0.25, 'concrete', { tag: 'wall' });
  });
  // 靶场屋顶梁
  for (let x = 38; x <= 74; x += 6) {
    batch.box(x, 6.1, 0, 0.3, 0.4, 24, 'darkmetal', { collide: false });
  }
  // 地面靶道涂装
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 24),
    new THREE.MeshBasicMaterial({
      map: rangeDecalTexture(), transparent: true, opacity: 0.9,
      depthWrite: false, toneMapped: false
    })
  );
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(55, 0.015, 0);
  decal.renderOrder = 1;
  root.add(decal);
  // 背靶墙 + 灯带
  batch.box(77.55, 2.5, 0, 0.35, 5.0, 22, 'darkmetal', { tag: 'backstop', collide: false });
  const stripGeos = [];
  for (let x = 40; x <= 74; x += 8) {
    [-6, 0, 6].forEach((z) => {
      const g = new THREE.BoxGeometry(0.12, 0.07, 4.2);
      g.translate(x, 5.5, z);
      stripGeos.push(g);
    });
  }
  const stripMesh = new THREE.Mesh(mergeGeos(stripGeos), new THREE.MeshBasicMaterial({
    color: 0xffdfae, toneMapped: false
  }));
  root.add(stripMesh);
  stripGeos.forEach((g) => g.dispose());

  const rangeSign = new THREE.Mesh(
    new THREE.PlaneGeometry(10.8, 1.5),
    new THREE.MeshBasicMaterial({
      map: signTexture(['TRAINING RANGE · 三条靶道', '15 M · 25 M · 40 M'], '#d9b47a', 900, 160),
      toneMapped: false
    })
  );
  rangeSign.position.set(31.85, 4.9, 0);
  rangeSign.rotation.y = -Math.PI / 2;
  root.add(rangeSign);

  const rangeBackSign = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 2.4),
    new THREE.MeshBasicMaterial({
      map: signTexture(['SANDLINE TRAINING RANGE', '手枪 15 M    步枪 25 M    狙击 40 M'], '#8fb2c9', 1024, 180),
      toneMapped: false
    })
  );
  rangeBackSign.position.set(77.34, 3.1, 0);
  rangeBackSign.rotation.y = -Math.PI / 2;
  root.add(rangeBackSign);

  // 靶道吸音板 / 导轨 / 距离标线 / 弹药箱
  for (let x = 42; x <= 74; x += 6) {
    [-9.06, 9.06].forEach((z) => {
      batch.box(x, 2.35, z, 0.16, 1.05, 1.9, 'fabric', { collide: false });
    });
    [-3.06, 3.06].forEach((z) => {
      batch.box(x, 2.35, z, 0.14, 0.95, 1.5, 'fabric', { collide: false });
    });
  }
  [-6, 0, 6].forEach((z) => {
    batch.box(54, 2.75, z, 38, 0.07, 0.07, 'metal', { collide: false, color: 0x2a2c2a });
  });
  [46, 54, 66].forEach((x) => {
    [-11.86, 11.86].forEach((z) => {
      batch.box(x, 1.5, z, 0.07, 2.2, 0.07, 'gold', { collide: false });
    });
  });
  [[36.6, -3.6], [36.6, 3.6], [36.6, -9.2], [36.6, 9.2]].forEach(([x, z]) => {
    batch.box(x, 0.35, z, 0.9, 0.7, 1.2, 'metal', { tag: 'ammo', collide: false, color: 0x4a4f46 });
    batch.box(x, 0.72, z, 0.7, 0.08, 1.0, 'gold', { collide: false });
  });
  // 射击位柜台
  [-6, 0, 6].forEach((z, i) => {
    batch.box(35.2, 0.55, z, 1.2, 1.1, 5.4, 'darkmetal', { tag: 'counter' });
    // 靶道编号
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 0.9),
      new THREE.MeshBasicMaterial({
        map: signTexture([(i === 0 ? '01 · 手枪 15M' : i === 1 ? '02 · 步枪 25M' : '03 · 狙击 40M'), 'TRAINING LANE'], '#d9b47a', 640, 180),
        toneMapped: false
      })
    );
    sign.position.set(33.0, 2.6, z);
    sign.rotation.y = Math.PI / 2;
    root.add(sign);
  });
  // 声学吸音板
  for (let z = -8; z <= 8; z += 4) {
    batch.box(77.8, 2.6, z, 0.2, 2.2, 2.2, 'fabric', { collide: false });
  }

  // 靶子：9 个钢板靶（3 条道 × 3 个距离）
  const targetPos = [];
  [
    { x: 46, z: [-7.4, -6, -4.6] },
    { x: 54, z: [-1.4, 0, 1.4] },
    { x: 66, z: [4.6, 6, 7.4] }
  ].forEach((lane) => {
    lane.z.forEach((z) => targetPos.push({ x: lane.x, z: z }));
  });

  const targetBoardGeo = new THREE.PlaneGeometry(0.8, 1.4);
  targetBoardGeo.rotateY(-Math.PI / 2);
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = 128; targetCanvas.height = 224;
  {
    const x = targetCanvas.getContext('2d');
    x.fillStyle = '#cfc9ba';
    x.fillRect(0, 0, 128, 224);
    x.fillStyle = '#1b1c1a';
    // 人形剪影
    x.beginPath();
    x.arc(64, 44, 22, 0, Math.PI * 2);
    x.fill();
    x.fillRect(36, 66, 56, 82);
    x.fillRect(18, 76, 20, 62);
    x.fillRect(90, 76, 20, 62);
    x.fillRect(42, 148, 20, 70);
    x.fillRect(66, 148, 20, 70);
    // 靶环
    x.strokeStyle = '#c94f45';
    x.lineWidth = 3;
    x.beginPath(); x.arc(64, 104, 20, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.arc(64, 104, 9, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#c94f45';
    x.beginPath(); x.arc(64, 104, 3, 0, Math.PI * 2); x.fill();
  }
  const targetMat = new THREE.MeshBasicMaterial({
    map: canvasTexture(targetCanvas), side: THREE.DoubleSide, toneMapped: false
  });
  const targets = new THREE.InstancedMesh(targetBoardGeo, targetMat, targetPos.length);
  targets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  targets.castShadow = false;
  targets.frustumCulled = false;
  root.add(targets);

  const standGeo = new THREE.BoxGeometry(0.09, 1.0, 0.09);
  const standMat = material('metal', { repeat: 1, roughness: 0.5 });
  const stands = new THREE.InstancedMesh(standGeo, standMat, targetPos.length);
  stands.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stands.castShadow = false;
  stands.frustumCulled = false;
  root.add(stands);

  const targetData = targetPos.map((p, i) => ({
    index: i, x: p.x, z: p.z, up: false, timer: Math.random() * 1.6, t: 0, y: 0.35
  }));

  // 地面射击线
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd9b47a, transparent: true, opacity: 0.55 });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 23), lineMat);
  line.rotation.x = -Math.PI / 2;
  line.position.set(36.2, 0.02, 0);
  root.add(line);

  /* ---------------- 地面杂物 / 长椅 / 绿植 ---------------- */

  [[-26, 16], [26, 16], [-26, -14], [26, -14]].forEach(([x, z]) => {
    batch.box(x, 0.6, z, 2.6, 1.2, 0.9, 'wood', { tag: 'bench' });
    batch.box(x, 0.2, z, 2.8, 0.4, 1.1, 'darkmetal', { tag: 'bench' });
  });
  // 木箱堆
  [[-22, -16], [22, -16], [-22, 20], [22, 20]].forEach(([x, z], i) => {
    for (let k = 0; k < 3; k++) {
      batch.box(x + (k % 2) * 0.9, 0.5 + k * 0.85, z + (i % 2) * 0.4, 1.7, 0.8, 1.7, 'wood', { tag: 'crate' });
    }
  });
  // 沙袋
  [[-10, 21], [10, 21], [-10, -17], [10, -17]].forEach(([x, z]) => {
    batch.box(x, 0.45, z, 3.0, 0.9, 1.0, 'fabric', { tag: 'sandbag' });
  });
  // 绿植
  const bushGeos = [];
  [[-28, 12], [28, 12], [-28, -12], [28, -12]].forEach(([x, z]) => {
    const pot = new THREE.CylinderGeometry(0.6, 0.45, 0.9, 12);
    pot.translate(x, 0.45, z);
    batch.geo('concrete', pot, {});
    const bush = new THREE.SphereGeometry(0.9, 12, 10);
    bush.scale(1, 0.9, 1);
    bush.translate(x, 1.5, z);
    bushGeos.push(bush);
    world.add({ minX: x - 0.7, maxX: x + 0.7, minY: 0, maxY: 1.2, minZ: z - 0.7, maxZ: z + 0.7, tag: 'plant' });
  });
  const bushMesh = new THREE.Mesh(mergeGeos(bushGeos), new THREE.MeshStandardMaterial({ color: 0x3f5a35, roughness: 0.9 }));
  bushMesh.castShadow = true;
  root.add(bushMesh);
  bushGeos.forEach((g) => g.dispose());

  /* ---------------- 横幅 ---------------- */

  const bannerTex = bannerTexture('沙城协议', 'DUST PROTOCOL', '#e06a35');
  const bannerTex2 = bannerTexture('沙线', 'SANDLINE 5V5', '#d9b47a');
  const bannerGeosA = [];
  const bannerGeosB = [];
  [[-13, 6], [13, 6], [-13, -6], [13, -6]].forEach(([x, z], i) => {
    const g = new THREE.PlaneGeometry(2.4, 5.4);
    g.translate(x, 8.6, z);
    (i % 2 ? bannerGeosB : bannerGeosA).push(g);
    batch.box(x, 11.4, z, 2.7, 0.07, 0.07, 'gold', { collide: false });
  });
  [bannerGeosA, bannerGeosB].forEach((list, i) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeos(list), new THREE.MeshStandardMaterial({
      map: i ? bannerTex2 : bannerTex,
      roughness: 0.94, metalness: 0, side: THREE.DoubleSide
    }));
    mesh.castShadow = false;
    root.add(mesh);
    list.forEach((g) => g.dispose());
  });

  /* ---------------- 尘埃 ---------------- */

  const dustCount = 420;
  const dustGeo = new THREE.BufferGeometry();
  const dpos = new Float32Array(dustCount * 3);
  const dseed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dpos[i * 3] = -30 + Math.random() * 60;
    dpos[i * 3 + 1] = 0.5 + Math.random() * 11;
    dpos[i * 3 + 2] = -22 + Math.random() * 44;
    dseed[i] = Math.random() * Math.PI * 2;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 0.035, color: 0xffe8c0, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  }));
  root.add(dust);
  animated.push({ obj: dust, dust: true });

  // 静态批次落地
  batch.build(material);

  /* ---------------- 战术道具展台 ---------------- */

  // 展台：靠近入口，玩家一进大厅就能看到手雷/C4/护甲
  batch.box(12, 0.47, 11.5, 5.4, 0.94, 1.75, 'wood', { tag: 'prop-table' });
  batch.box(12, 0.955, 11.5, 5.5, 0.03, 1.85, 'gold', { collide: false });
  batch.box(12, 1.9, 12.55, 5.8, 2.5, 0.16, 'concrete', { tag: 'prop-back' });
  batch.box(12, 3.18, 12.55, 5.9, 0.08, 0.22, 'gold', { collide: false });
  world.add({ minX: 9.2, maxX: 14.8, minY: 0, maxY: 1.0, minZ: 10.6, maxZ: 12.4, tag: 'prop-table' });

  const propSign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 0.9),
    new THREE.MeshBasicMaterial({
      map: signTexture(['TACTICAL EQUIPMENT', '手雷 · 闪光 · 烟雾 · 燃烧瓶 · C4 · 拆弹包 · 护甲 · 武器箱'], '#d9b47a', 1024, 200),
      toneMapped: false
    })
  );
  propSign.position.set(12, 2.65, 12.46);
  root.add(propSign);

  const propIds = ['he', 'flash', 'smoke', 'molotov', 'c4', 'defuse', 'armor', 'case'];
  const propPos = [
    [9.9, 11.2], [11.2, 11.2], [12.5, 11.2], [13.8, 11.2],
    [9.9, 12.15], [11.2, 12.15], [12.5, 12.15], [13.8, 12.15]
  ];
  const propGroups = propIds.map((id, i) => {
    const g = buildPropModel(id);
    g.position.set(propPos[i][0], 1.02, propPos[i][1]);
    g.scale.setScalar(1.42);
    return g;
  });
  const propBatch = mergePropsByMaterial(propGroups);
  propBatch.name = 'prop-showcase';
  root.add(propBatch);
  propGroups.forEach((g) => g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }));

  // 展台灯带
  const propLight = new THREE.Mesh(
    new THREE.BoxGeometry(5.2, 0.03, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false })
  );
  propLight.position.set(12, 1.03, 10.66);
  root.add(propLight);

  // 展柜玻璃与射灯
  const propGlass = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.05, 1.62), glassMat);
  propGlass.position.set(12, 1.55, 11.5);
  propGlass.renderOrder = 4;
  root.add(propGlass);
  const propFrameTop = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.06, 1.7), material('gold', { repeat: 2 }));
  propFrameTop.position.set(12, 2.1, 11.5);
  root.add(propFrameTop);
  const propSpot = new THREE.PointLight(0xffd9a0, 55, 9, 2);
  propSpot.position.set(12, 2.55, 11.5);
  root.add(propSpot);

  /* ---------------- 交互点 ---------------- */

  const interactions = LOBBY_INTERACTIONS.map((it) => Object.assign({}, it));

  /* ---------------- 传送点：4 个地面光圈 + 标牌 ---------------- */

  const teleports = LOBBY_TELEPORTS.map((t) => Object.assign({}, t));
  const padGeo = new THREE.CircleGeometry(1.15, 28);
  padGeo.rotateX(-Math.PI / 2);
  const padMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.20,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
  });
  const tpPadMesh = new THREE.InstancedMesh(padGeo, padMat, teleports.length);
  tpPadMesh.frustumCulled = false;
  const ringGeo = new THREE.RingGeometry(1.02, 1.18, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const tpRingMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
  });
  const tpRingMesh = new THREE.InstancedMesh(ringGeo, tpRingMat, teleports.length);
  tpRingMesh.frustumCulled = false;
  const tMat = new THREE.Matrix4();
  const tColor = new THREE.Color();
  teleports.forEach((tp, i) => {
    tMat.makeTranslation(tp.x, (tp.y || 0) + 0.025, tp.z);
    tpPadMesh.setMatrixAt(i, tMat);
    tpRingMesh.setMatrixAt(i, tMat);
    tColor.setHex(tp.color || 0xd9b47a);
    tpPadMesh.setColorAt(i, tColor);
    tpRingMesh.setColorAt(i, tColor);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 0.58),
      new THREE.MeshBasicMaterial({
        map: signTexture([tp.label, 'TELEPORT'], '#d9b47a', 384, 96),
        toneMapped: false, transparent: true
      })
    );
    label.position.set(tp.x, (tp.y || 0) + 1.55, tp.z + 0.15);
    label.userData.teleportLabel = tp.id;
    root.add(label);
  });
  tpPadMesh.instanceMatrix.needsUpdate = true;
  tpRingMesh.instanceMatrix.needsUpdate = true;
  tpPadMesh.instanceColor.needsUpdate = true;
  tpRingMesh.instanceColor.needsUpdate = true;
  root.add(tpPadMesh);
  root.add(tpRingMesh);

  /* ---------------- 返回 ---------------- */

  return {
    root,
    world,
    bounds: { minX: -31, maxX: 77, minZ: -23, maxZ: 23 },
    hall: HALL,
    range: RANGE,
    spawn: { x: 0, y: 0, z: 19, yaw: Math.PI },
    interactions,
    teleports,
    teleportRings: tpRingMesh,
    cases,
    heroes,
    portals,
    targets: { mesh: targets, stands: stands, data: targetData },
    screen: { canvas: screenCanvas, ctx: screenCanvas.getContext('2d'), texture: screenTexture, mesh: screen },
    animated,
    dust,
    /** 大厅氛围动画：展品旋转、传送门、尘埃、展位灯光。 */
    update(dt, t) {
      for (const a of animated) {
        if (a.spin) {
          if (a.plane) a.obj.rotation.z += dt * a.spin;
          else a.obj.rotation.y += dt * a.spin;
        }
        if (a.pulse) {
          const s = 1 + Math.sin(t * 2.2) * a.pulse;
          a.obj.scale.set(s, s, 1);
        }
        if (a.bob) a.obj.position.y += Math.sin(t * 1.2) * 0.0006;
        if (a.dust) {
          const pos = a.obj.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            let y = pos.getY(i) + dt * 0.12;
            if (y > 11.5) y = 0.4;
            pos.setY(i, y);
            pos.setX(i, pos.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.05);
          }
          pos.needsUpdate = true;
        }
      }
      if (tpRingMesh) tpRingMesh.material.opacity = 0.42 + Math.sin(t * 2.4) * 0.18;
    }
  };
}
