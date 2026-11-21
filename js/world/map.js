// 沙线（Sandline）地图 · v2「双层旧城」。
// 设计参考：FPS 关卡规范（环路 ≥ 2、垂直层 ≥ 2、连通度 2.2–3.0、掩体覆盖 15–25%），
// 但按本作 1 单位 = 1 米的真实尺度落地：
//   · 三条进攻线（A 大 / 中路 / B 洞）各自再分叉，形成 4 条环路；
//   · 垂直层：A 城墙步道（2.7 m）、A 后看台（2.5 m）、中路过街廊桥（2.65 m）、
//     B 窗口楼阁夹层（2.2 m）、B 装卸台（1.2 m）、两个包点台（0.58 m）；
//   · 每条线都有“第二个入口”，死亡点极少；高台全部可达（楼梯 / 可跳箱），没有只可远观的区域。
// 所有几何仍是 AABB，便于碰撞与合批；装饰件一律 collide:false，避免卡墙。

import * as THREE from '../../vendor/three.module.js';
import { World } from './collision.js';
import { material, flat } from './textures.js';
import { scaleBoxUV, mergeGeos } from './geo-utils.js';
import { surfaceMaterial } from '../render/roblox.js';

const TILE = 2.6;
// 地面/台面上的掩体最低高度：保证 1.22m 蹲姿能完全躲在后面。
// 叠放装饰（底部高于 0.62m）不参与归一化，避免把箱子上的布层拉成高墙。
const COVER_MIN_HEIGHT = 1.36;

/* ------------------------------------------------------------------ */
/* 贴图与 UI 标记                                                      */
/* ------------------------------------------------------------------ */

function labelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  x.strokeStyle = color;
  x.lineWidth = 8;
  x.strokeRect(8, 8, 240, 240);
  x.fillStyle = color;
  x.font = '700 150px ui-monospace, monospace';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 实心布旗：橙底白字，挂在旗杆上。 */
function bannerTexture(letter, bg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = bg || '#c4561c';
  x.fillRect(0, 0, 256, 160);
  x.fillStyle = 'rgba(255,240,220,.18)';
  x.fillRect(0, 0, 256, 22);
  x.fillRect(0, 138, 256, 22);
  x.fillStyle = '#fff2dc';
  x.font = '800 110px ui-monospace, monospace';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(letter, 128, 88);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 包点地面标记：半透明橙圈 + 白色字母，远处也能一眼认出。 */
function siteMarkerTexture(letter) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  // 只画圆环与字母：整盘半透明填充会和后方的红色物体叠成粉色。
  x.strokeStyle = 'rgba(255,150,80,.95)';
  x.lineWidth = 16;
  x.beginPath(); x.arc(128, 128, 108, 0, Math.PI * 2); x.stroke();
  x.fillStyle = 'rgba(255,240,222,.98)';
  x.font = '800 140px ui-monospace, monospace';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(letter, 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 60);
  g.addColorStop(0, 'rgba(38,30,20,.55)');
  g.addColorStop(0.55, 'rgba(38,30,20,.28)');
  g.addColorStop(1, 'rgba(38,30,20,0)');
  x.fillStyle = g;
  x.beginPath();
  x.ellipse(64, 64, 60, 46, 0, 0, Math.PI * 2);
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(text, accent) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#161512';
  x.fillRect(0, 0, 512, 256);
  x.strokeStyle = 'rgba(220,210,190,.25)';
  x.lineWidth = 6;
  x.strokeRect(12, 12, 488, 232);
  x.fillStyle = accent || '#d9b47a';
  x.fillRect(32, 32, 448, 10);
  x.fillStyle = 'rgba(236,231,216,.9)';
  x.font = '700 64px ui-monospace, monospace';
  x.textAlign = 'center';
  x.fillText(text, 256, 138);
  x.fillStyle = 'rgba(164,157,138,.9)';
  x.font = '600 26px ui-monospace, monospace';
  x.fillText('SANDLINE · RESTRICTED', 256, 198);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function domeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#3f8fbf';
  x.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cx = col * 32 + (row % 2 ? 16 : 0);
      const cy = row * 32;
      x.fillStyle = row % 2 ? '#63b6dd' : '#53a6cf';
      x.beginPath();
      x.moveTo(cx, cy - 15); x.lineTo(cx + 15, cy); x.lineTo(cx, cy + 15); x.lineTo(cx - 15, cy);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(255,236,180,.55)';
      x.lineWidth = 1;
      x.stroke();
      x.fillStyle = 'rgba(220,240,250,.3)';
      x.fillRect(cx - 2, cy - 2, 4, 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

function archTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 384;
  const x = c.getContext('2d');
  x.fillStyle = '#b7a68c';
  x.fillRect(0, 0, 256, 384);
  x.fillStyle = '#8f7d63';
  x.beginPath();
  x.moveTo(24, 384); x.lineTo(24, 150);
  x.arc(128, 150, 104, Math.PI, 0);
  x.lineTo(232, 384); x.closePath(); x.fill();
  x.fillStyle = '#4b3020';
  x.beginPath();
  x.moveTo(56, 384); x.lineTo(56, 165);
  x.arc(128, 165, 72, Math.PI, 0);
  x.lineTo(200, 384); x.closePath(); x.fill();
  for (let i = 0; i < 5; i++) {
    x.fillStyle = i % 2 ? '#5a3a26' : '#3e2718';
    x.fillRect(60 + i * 28, 190 + (i % 2) * 120, 24, 180);
  }
  x.strokeStyle = 'rgba(20,12,8,.55)';
  x.lineWidth = 3;
  x.strokeRect(52, 165, 152, 219);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */

const SITE_A = { x: 26, z: 16, r: 6 };        // 老城 A 前哨（保留为高台）
const SITE_B = { x: -24, z: 16, r: 6 };       // 老城 B 前哨
const SITE_A_NEW = { x: 44, z: 16, r: 6 };    // 东院新包点
const SITE_B_NEW = { x: -44, z: 16, r: 6 };   // 西院新包点

export function buildMap(root, buildOpts) {
  buildOpts = buildOpts || {};
  // 编辑器数据层：按稳定盒体 ID 覆写位置/尺寸、隐藏、追加盒体。
  // 正常对局不传 edits，所有开销为零。
  const editData = buildOpts.edits || null;
  const movedEdits = (editData && editData.moved) || {};
  const hiddenEdits = (editData && editData.hidden) || {};
  let boxSeq = 0;
  const world = new World();
  const batches = new Map();
  const placed = [];
  // 自发光小件统一合批，少 10 多个 draw call。
  const glowGeos = [];
  const cableGeos = [];
  const flagGeos = [];
  // 固定种子：远景与杂物的分布每局一致，截图可逐轮对比。
  let seed = 20261121;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

  function batch(kind, opts) {
    opts = opts || {};
    const key = kind + '|' + (opts.repeat || '') + '|' + (opts.roughness || '') + '|' +
      (opts.metalness != null ? opts.metalness : '') + '|' + (opts.castShadow === false ? 0 : 1);
    if (!batches.has(key)) batches.set(key, { kind, opts, geos: [] });
    return batches.get(key);
  }

  function tint(g, color) {
    const c = color != null ? new THREE.Color(color) : null;
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c ? c.r : 1;
      arr[i * 3 + 1] = c ? c.g : 1;
      arr[i * 3 + 2] = c ? c.b : 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  /**
   * @param cx,cy,cz 中心点
   * @param w,h,d 尺寸
   * @param kind 材质
   * @param opts {collide, tag, color, castShadow}
   */
  function box(cx, cy, cz, w, h, d, kind, opts) {
    opts = opts || {};
    if (opts.tag === 'cover' && h < COVER_MIN_HEIGHT) {
      const bottom = cy - h / 2;
      if (bottom < 0.62) {
        h = COVER_MIN_HEIGHT;
        cy = bottom + h / 2;
      }
    }
    const id = boxSeq++;
    // 覆写只影响这一件盒体；ID 由构建顺序决定，由于构建是确定性的，跨次重建立稳定。
    const ov = movedEdits[id];
    if (ov) {
      if (ov.x != null) cx = ov.x;
      if (ov.y != null) cy = ov.y;
      if (ov.z != null) cz = ov.z;
      if (ov.w != null) w = ov.w;
      if (ov.h != null) h = ov.h;
      if (ov.d != null) d = ov.d;
    }
    const rec = {
      id, x: cx, y: cy, z: cz, w, h, d,
      kind, tag: opts.tag || '', collide: opts.collide !== false,
      color: opts.color, repeat: opts.repeat, roughness: opts.roughness,
      metalness: opts.metalness, castShadow: opts.castShadow
    };
    if (hiddenEdits[id]) {
      // 隐藏件保留记录与 ID，但不生成几何/碰撞，编辑器仍能按 ID 恢复或审计。
      rec.hidden = true;
      rec.collide = false;
      placed.push(rec);
      return;
    }
    const b = batch(kind, opts);
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(g, w, h, d, TILE);
    g.translate(cx, cy, cz);
    tint(g, opts.color);
    b.geos.push(g);
    placed.push(rec);
    if (opts.collide !== false) {
      world.add({
        minX: cx - w / 2, maxX: cx + w / 2,
        minY: cy - h / 2, maxY: cy + h / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
        tag: opts.tag || ''
      });
    }
  }

  // 手工装饰件（圆柱桶/托盘等）：占一个稳定 ID，但不参与工坊盒体编辑。
  function prop(rec) {
    rec.id = boxSeq++;
    rec.editable = false;
    placed.push(rec);
  }

  // 双坡红屋顶：axis='z' 屋脊沿 Z（斜面朝 ±X），axis='x' 屋脊沿 X（斜面朝 ±Z）。
  // 纯视觉，不参与碰撞。
  function gableRoof(cx, baseY, cz, w, d, rise, axis) {
    const b = batch('roof', { collide: false, castShadow: true });
    if (axis === 'x') {
      const half = d / 2;
      const len = Math.hypot(half, rise);
      const ang = Math.atan2(rise, half);
      for (const s of [-1, 1]) {
        const g = new THREE.BoxGeometry(w + 0.5, 0.16, len + 0.14);
        scaleBoxUV(g, w + 0.5, 0.16, len + 0.14, TILE);
        g.rotateX(s * ang);
        g.translate(cx, baseY + rise / 2, cz + s * half / 2);
        tint(g, null);
        b.geos.push(g);
      }
      const ridge = new THREE.BoxGeometry(w + 0.55, 0.18, 0.26);
      scaleBoxUV(ridge, w + 0.55, 0.18, 0.26, TILE);
      ridge.translate(cx, baseY + rise + 0.05, cz);
      tint(ridge, null);
      b.geos.push(ridge);
      return;
    }
    const half = w / 2;
    const len = Math.hypot(half, rise);
    const ang = Math.atan2(rise, half);
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(len + 0.14, 0.16, d + 0.5);
      scaleBoxUV(g, len + 0.14, 0.16, d + 0.5, TILE);
      g.rotateZ(-s * ang);
      g.translate(cx + s * half / 2, baseY + rise / 2, cz);
      tint(g, null);
      b.geos.push(g);
    }
    const ridge = new THREE.BoxGeometry(0.26, 0.18, d + 0.55);
    scaleBoxUV(ridge, 0.26, 0.18, d + 0.55, TILE);
    ridge.translate(cx, baseY + rise + 0.05, cz);
    tint(ridge, null);
    b.geos.push(ridge);
  }

  /** 实心楼梯：每级从地面砌起，顶面 = (i+1)*rise。 */
  function stairs(cx, cz, width, steps, rise, tread, dir, kind, opts) {
    for (let i = 0; i < steps; i++) {
      const h = (i + 1) * rise;
      let x = cx, z = cz, bw = width, bd = tread;
      if (dir === 'n') z = cz - (i + 0.5) * tread;
      else if (dir === 's') z = cz + (i + 0.5) * tread;
      else if (dir === 'e') { x = cx + (i + 0.5) * tread; bw = tread; bd = width; }
      else { x = cx - (i + 0.5) * tread; bw = tread; bd = width; }
      box(x, h / 2, z, bw, h, bd, kind, opts);
    }
  }

  /** 地面铺装：薄板，纯视觉。 */
  function pave(cx, cz, w, d, kind, color) {
    box(cx, 0.02, cz, w, 0.04, d, kind || 'concrete', {
      collide: false, castShadow: false, color: color
    });
  }

  /** 带支柱的布篷：布料 + 条纹 + 四根落地柱。 */
  function awning(cx, cz, w, d, y, stripe) {
    box(cx, y, cz, w, 0.1, d, 'fabric', { collide: false, castShadow: true });
    if (stripe !== false) {
      const n = Math.max(2, Math.round(w / 0.9));
      for (let i = 0; i < n; i += 2) {
        box(cx - w / 2 + (i + 0.5) * (w / n), y + 0.055, cz,
          w / n, 0.03, d * 0.96, 'plaster', { collide: false, color: 0xf7f0dd });
      }
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(cx + sx * (w / 2 - 0.16), y / 2, cz + sz * (d / 2 - 0.16),
          0.12, y, 0.12, 'wood', { collide: false, color: 0x5a4632 });
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* 地面与外墙                                                        */
  /* ---------------------------------------------------------------- */

  // 场地底色是沙土色，道路另铺浅灰石；草地只保留几块种植带。
  const groundMat = surfaceMaterial('#cbb488').clone();
  if (groundMat.map) {
    groundMat.map = groundMat.map.clone();
    groundMat.map.repeat.set(180 / TILE, 160 / TILE);
    groundMat.map.needsUpdate = true;
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 160), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  root.add(ground);
  world.add({ minX: -52, maxX: 52, minY: -1.2, maxY: 0, minZ: -44, maxZ: 44, tag: 'ground' });

  // 主路网
  pave(0, -26, 27, 10, 'concrete');          // T 出生广场
  pave(0, -14, 12, 22, 'concrete');          // 中路南段
  pave(0, 5, 12, 24, 'concrete');            // 中路北段
  pave(24, -8, 20, 34, 'concrete');          // A 大
  pave(-25, -8, 18, 34, 'concrete');         // B 洞
  pave(24, 17, 20, 21, 'plaster');           // A 点广场
  pave(-25, 17, 19, 21, 'plaster');          // B 点广场
  pave(0, 23.5, 16, 15, 'plaster');          // CT 出生
  pave(22, 29.7, 26, 2.6, 'concrete');       // A 后巷
  pave(-23, 29.7, 22, 2.6, 'concrete');      // B 后巷
  pave(10, 10, 8, 8, 'concrete');            // A 短
  pave(-10, 9.5, 8, 7, 'concrete');          // B 短
  pave(16, -24, 8, 8, 'concrete');           // T→A 门洞
  pave(-16, -24, 8, 8, 'concrete');          // T→B 门洞
  // 草地种植带（点缀，不参与碰撞）
  [[-4, -29, 6, 2.4], [5, 20.5, 5, 2.2], [-6, 27.5, 4, 2]].forEach(([x, z, w, d]) => {
    box(x, 0.026, z, w, 0.035, d, 'sand', { collide: false, castShadow: false });
  });

  // 核心外墙：四面留门，接外环四院（南 T 院 / 北 CT 院 / 东 A 院 / 西 B 院）
  box(-25.25, 3, -32.5, 22.5, 6, 1, 'plaster', { tag: 'wall' });
  box(25.25, 3, -32.5, 22.5, 6, 1, 'plaster', { tag: 'wall' });
  box(-25.25, 3, 32.5, 22.5, 6, 1, 'plaster', { tag: 'wall' });
  box(25.25, 3, 32.5, 22.5, 6, 1, 'plaster', { tag: 'wall' });
  for (const sx of [-1, 1]) {
    const wx = sx * 36.5;
    for (const [z0, z1] of [[-32.5, -24], [-10, 6], [24, 27], [30, 32.5]]) {
      box(wx, 3, (z0 + z1) / 2, 1, 6, z1 - z0, 'plaster', { tag: 'wall' });
    }
  }
  box(0, 5.68, -32.4, 72, 0.42, 0.52, 'concrete', { tag: 'trim', collide: false });
  box(0, 5.68, 32.4, 72, 0.42, 0.52, 'concrete', { tag: 'trim', collide: false });
  // 新门洞上方不保留墙垛，避免门洞上出现悬空块。

  /* ---------------------------------------------------------------- */
  /* T 出生区（南）                                                    */
  /* ---------------------------------------------------------------- */

  // 低舞台 + 背墙布篷
  box(0, 0.15, -30.4, 10, 0.3, 2.2, 'concrete', { tag: 'platform' });
  awning(0, -30.2, 12, 2.6, 3.6);

  // 市集摊
  for (const sx of [-1, 1]) {
    box(sx * 9.2, 0.55, -28.6, 3.2, 1.1, 1.4, 'wood', { tag: 'cover' });
    box(sx * 9.2, 1.55, -29.3, 3.0, 1.7, 0.16, 'wood', { collide: false, color: 0x6d5438 });
    awning(sx * 9.2, -28.6, 4.0, 2.6, 2.75);
  }

  // 运货车：挡住 T 出生到 A 门的直线
  box(10.6, 1.25, -27.6, 2.6, 2.2, 5.2, 'metal', {
    tag: 'truck', color: 0x8a9d8c, roughness: 0.72, metalness: 0.16
  });
  box(10.6, 1.2, -30.6, 2.4, 1.9, 1.1, 'metal', { tag: 'truck', color: 0x7d8f80 });
  box(10.6, 0.3, -26.2, 2.65, 0.5, 1.2, 'metal', { tag: 'truck', collide: false, color: 0x2b2f2c });
  for (const wz of [-29.4, -25.8]) {
    for (const wx of [9.4, 11.8]) {
      const wg = new THREE.CylinderGeometry(0.44, 0.44, 0.34, 14);
      wg.rotateZ(Math.PI / 2);
      wg.translate(wx, 0.44, wz);
      const m = new THREE.Mesh(wg, flat(0x1c1c1a, { roughness: 0.9 }));
      m.castShadow = true;
      root.add(m);
    }
  }
  // 出生点两侧的箱子：留出中心 3 m 的视线
  box(-6.2, 0.6, -26.4, 1.2, 1.2, 1.2, 'wood', { tag: 'cover' });
  box(-7.5, 0.4, -25.4, 0.8, 0.8, 0.8, 'wood', { tag: 'cover' });
  box(5.6, 0.5, -24.6, 1.0, 1.0, 1.0, 'wood', { tag: 'cover' });

  // T→A / T→B 门框
  for (const sx of [-1, 1]) {
    const x = sx * 14;
    box(x, 2.1, -30.2, 0.8, 4.2, 3.6, 'plaster', { tag: 'wall' });
    box(x, 2.1, -25.2, 0.8, 4.2, 1.2, 'plaster', { tag: 'wall' });
    box(x, 4.0, -27.8, 0.9, 0.5, 5.6, 'concrete', { tag: 'trim', collide: false });
  }
  // T→中路的北门：中间 8 m 开口
  for (const sx of [-1, 1]) {
    box(sx * 9, 2.1, -22.9, 10, 4.2, 0.9, 'plaster', { tag: 'wall' });
    box(sx * 9, 4.35, -22.9, 10.2, 0.36, 1.1, 'concrete', { tag: 'trim', collide: false });
  }
  box(0, 4.35, -22.9, 8, 0.6, 0.9, 'plaster', { tag: 'wall' });
  box(0, 4.75, -22.9, 8.3, 0.22, 1.1, 'concrete', { tag: 'trim', collide: false });

  /* ---------------------------------------------------------------- */
  /* 中路两侧的骑楼                                                    */
  /* ---------------------------------------------------------------- */

  // 东侧（A 侧）建筑：x 6..13
  const eastBlocks = [
    { z0: -22.2, z1: -13, h: 5.4 },
    { z0: -7, z1: 0, h: 6.2 },
    { z0: 0, z1: 6, h: 5.0 },
    { z0: 14, z1: 20, h: 4.4 }
  ];
  // 西侧（B 侧）建筑：刻意与东侧错位，A 连廊在 -13..-7，B 连廊在 -7..-2
  const westBlocks = [
    { z0: -22.2, z1: -7, h: 5.4 },
    { z0: -2, z1: 6, h: 6.0 },
    { z0: 13, z1: 20, h: 4.4 }
  ];
  function blockRow(x0, x1, list) {
    list.forEach((b) => {
      const w = x1 - x0, d = b.z1 - b.z0, cx = (x0 + x1) / 2, cz = (b.z0 + b.z1) / 2;
      box(cx, b.h / 2, cz, w, b.h, d, 'plaster', { tag: 'building' });
      box(cx, b.h + 0.14, cz, w + 0.4, 0.28, d + 0.4, 'concrete', { tag: 'cornice', collide: false });
      gableRoof(cx, b.h + 0.28, cz, w + 0.2, d, 1.15);
      // 底层商铺门与遮阳篷
      const faceX = x0 < 0 ? x1 + 0.06 : x0 - 0.06;
      const s = x0 < 0 ? 1 : -1;
      for (let z = b.z0 + 2.2; z < b.z1 - 1.6; z += 4.4) {
        box(faceX, 1.25, z, 0.12, 2.5, 1.7, 'wood', { tag: 'trim', collide: false, color: 0x7a5a3c });
        box(faceX + s * 0.06, 3.05, z, 1.05, 0.09, 2.2, 'fabric', { collide: false });
      }
    });
  }
  blockRow(6, 13, eastBlocks);
  blockRow(-13, -6, westBlocks);

  // A / B 连廊：把建筑之间的缺口盖成有顶的过街门洞
  box(9.5, 4.5, -10, 7, 0.5, 6, 'plaster', { tag: 'wall' });
  box(9.5, 4.82, -10, 7.3, 0.2, 6.3, 'concrete', { tag: 'trim', collide: false });
  box(-9.5, 4.3, -4.5, 7, 0.5, 5, 'plaster', { tag: 'wall' });
  box(-9.5, 4.62, -4.5, 7.3, 0.2, 5.3, 'concrete', { tag: 'trim', collide: false });

  // 中路南段 / 门口的掩体：打断 T 出生到 CT 的长视线
  box(3.9, 0.55, -12.4, 2.2, 1.1, 1.3, 'wood', { tag: 'cover' });
  box(3.9, 1.14, -12.4, 2.0, 0.12, 1.1, 'fabric', { collide: false, repeat: 4 });
  box(-4.1, 0.5, -17.8, 2.4, 1.0, 2.2, 'wood', { tag: 'cover' });
  box(-3.4, 0.35, -7.2, 1.2, 0.7, 1.2, 'wood', { tag: 'cover' });
  box(3.6, 0.42, -6.2, 2.4, 0.84, 1.1, 'fabric', { tag: 'cover', repeat: 4 });
  // 中路两侧的雨棚与货摊（北段）
  box(-4.6, 0.45, 4.6, 2.0, 0.9, 1.6, 'wood', { tag: 'cover' });
  box(4.5, 0.35, 7.4, 1.2, 0.7, 1.2, 'wood', { tag: 'cover' });

  // 中路门：8 m 开口 + 门楣
  for (const sx of [-1, 1]) {
    box(sx * 5.2, 2.1, 0, 2.4, 4.2, 1.6, 'plaster', { tag: 'wall' });
    box(sx * 5.2, 4.3, 0, 2.7, 0.32, 1.9, 'concrete', { tag: 'trim', collide: false });
    box(sx * 5.05, 4.62, 0, 0.24, 0.34, 2.2, 'plaster', { tag: 'trim', collide: false });
  }
  box(0, 4.5, 0, 8.0, 0.55, 1.1, 'plaster', { tag: 'wall' });
  box(0, 4.82, 0, 8.2, 0.22, 1.25, 'concrete', { tag: 'trim', collide: false });

  /* ---------------------------------------------------------------- */
  /* 中路过街廊桥（2.65 m）                                            */
  /* ---------------------------------------------------------------- */

  // 桥面
  box(0, 2.5, 10.2, 26, 0.3, 4.4, 'wood', { tag: 'bridge', roughness: 0.8 });
  for (let x = -12; x <= 12; x += 2.4) {
    box(x, 2.32, 8.15, 0.22, 0.36, 0.22, 'darkmetal', { tag: 'beam', collide: false });
    box(x, 2.32, 12.25, 0.22, 0.36, 0.22, 'darkmetal', { tag: 'beam', collide: false });
  }
  // 桥柱
  for (const sx of [-1, 1]) {
    for (const cz of [8.4, 12.0]) {
      box(sx * 5.6, 1.175, cz, 0.5, 2.35, 0.5, 'concrete', { tag: 'column' });
    }
  }
  // 栏杆（两端各留 3 m 缺口，用于跳下 A 短 / B 短）
  for (const cz of [8.2, 12.2]) {
    for (const sx of [-1, 1]) {
      box(sx * 6.4, 3.02, cz, 6.8, 0.74, 0.16, 'wood', { tag: 'railing' });
    }
  }
  for (const x of [-9.8, -3.2, 3.2, 9.8]) {
    box(x, 2.78, 8.2, 0.16, 0.2, 0.16, 'wood', { collide: false });
    box(x, 2.78, 12.2, 0.16, 0.2, 0.16, 'wood', { collide: false });
  }
  // 顶棚：真正的“过街廊桥”，每隔一段落柱，避免长屋顶看起来悬空
  box(0, 4.75, 10.2, 26.4, 0.26, 4.8, 'roof', { collide: false, castShadow: true });
  for (const sx of [-1, 1]) {
    for (const cz of [8.5, 11.9]) {
      box(sx * 12.6, 3.7, cz, 0.28, 2.1, 0.28, 'wood', { tag: 'post' });
      box(sx * 5.5, 3.7, cz, 0.18, 2.1, 0.18, 'wood', { tag: 'post' });
    }
    box(sx * 12.6, 4.45, 10.2, 0.24, 0.24, 4.2, 'wood', { collide: false });
  }
  // 桥上的市集招牌
  const bridgeSign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 1.7),
    new THREE.MeshBasicMaterial({ map: signTexture('BAZAAR', '#d9b47a'), toneMapped: false })
  );
  bridgeSign.position.set(0, 3.9, 8.2);
  bridgeSign.rotation.y = Math.PI;
  root.add(bridgeSign);

  // CT→中路的大台阶（桥的入口）
  stairs(0, 16.45, 4.0, 9, 0.294, 0.45, 'n', 'concrete', { tag: 'stairs' });
  for (const sx of [-1, 1]) {
    stairs(sx * 2.08, 16.45, 0.16, 9, 0.294, 0.45, 'n', 'concrete', { tag: 'rail' });
  }

  /* ---------------------------------------------------------------- */
  /* A 大（东线）                                                      */
  /* ---------------------------------------------------------------- */

  // 货栈：中间留一条 2.8 m 高的穿堂，形成“仓内”交火点
  box(23, 3.1, -18.1, 8, 6.2, 3.8, 'sandstone', { tag: 'building' });
  box(23, 3.1, -11.2, 8, 6.2, 4.4, 'sandstone', { tag: 'building' });
  box(23, 4.5, -14.7, 8, 3.4, 3.2, 'sandstone', { tag: 'building' });
  box(23, 6.34, -14.7, 8.3, 0.28, 11.4, 'concrete', { tag: 'cornice', collide: false });
  gableRoof(23, 6.48, -14.65, 8.3, 11.3, 1.5);
  box(23, 2.86, -15.6, 7.9, 0.24, 0.22, 'concrete', { tag: 'trim', collide: false });
  box(23, 2.86, -13.8, 7.9, 0.24, 0.22, 'concrete', { tag: 'trim', collide: false });
  // 穿堂内的木箱与吊灯
  box(21, 0.45, -15.9, 1.0, 0.9, 0.9, 'wood', { tag: 'cover' });
  box(25.8, 0.35, -13.6, 0.7, 0.7, 0.7, 'wood', { tag: 'cover' });
  const tunnelLamp = new THREE.BoxGeometry(0.22, 0.12, 0.4);
  tunnelLamp.translate(23, 2.55, -14.7);
  glowGeos.push(tunnelLamp);

  // 城墙步道：A 大东侧的夯土台，可走上去
  box(35, 1.35, -7, 2, 2.7, 18, 'sandstone', { tag: 'rampart' });
  box(35, 2.78, -7, 2.2, 0.16, 18.3, 'concrete', { tag: 'trim', collide: false });
  // 沿外侧的垛口
  for (let z = -15; z <= 1; z += 2.2) {
    box(35.6, 3.1, z, 0.6, 0.7, 1.1, 'sandstone', { collide: false, tag: 'crenel' });
  }
  // 上城台阶：从 A 大门内侧上到 2.7 m
  stairs(33.4, -1.2, 2.4, 9, 0.3, 0.5, 'n', 'concrete', { tag: 'stairs' });
  for (const sx of [-1, 1]) {
    box(33.4 + sx * 1.26, 1.5, -3.6, 0.2, 3.0, 4.6, 'concrete', { collide: false, tag: 'rail' });
  }
  // 步道上的木箱与沙袋
  box(34.6, 3.1, -12, 1.1, 1.0, 1.1, 'wood', { tag: 'cover' });
  box(34.7, 3.02, -4, 1.0, 0.8, 1.6, 'fabric', { tag: 'cover', repeat: 4 });

  // A 大通向 A 点的门楼：中间 8 m，东侧另留 3.5 m 侧门
  box(15, 2.3, 6.5, 4, 4.6, 5, 'plaster', { tag: 'building' });
  box(15, 4.72, 6.5, 4.3, 0.24, 5.3, 'concrete', { tag: 'cornice', collide: false });
  gableRoof(15, 4.84, 6.5, 4.3, 5.1, 0.95);
  box(28, 2.4, 6.5, 6, 4.8, 5, 'plaster', { tag: 'building' });
  box(28, 4.94, 6.5, 6.3, 0.24, 5.3, 'concrete', { tag: 'cornice', collide: false });
  gableRoof(28, 5.06, 6.5, 6.3, 5.1, 1.05);
  box(21, 3.9, 6.5, 8, 0.55, 1.4, 'sandstone', { tag: 'wall' });
  box(21, 4.2, 6.5, 8.4, 0.24, 1.7, 'concrete', { tag: 'trim', collide: false });

  // 货栈立面：两扇卷帘门 + 雨棚 + 门牌，别让 A 大变成一条光墙
  for (const [z, w] of [[-18.2, 3.0], [-10.8, 2.4]]) {
    box(18.92, 1.5, z, 0.16, 3.0, w, 'wood', { tag: 'trim', color: 0x7a5a3c });
    for (let i = 0; i < 10; i++) {
      box(18.82, 0.2 + i * 0.28, z, 0.04, 0.06, w - 0.16, 'wood',
        { collide: false, color: i % 2 ? 0x5f4730 : 0x8a6a4a });
    }
    box(18.6, 3.25, z, 0.9, 0.1, w + 0.5, 'fabric', { collide: false });
    box(27.08, 1.5, z, 0.16, 3.0, w * 0.8, 'wood', { tag: 'trim', color: 0x6d5338 });
  }
  const depotSign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 1.0),
    new THREE.MeshBasicMaterial({ map: signTexture('DEPOT 04', '#d9b47a'), toneMapped: false })
  );
  depotSign.position.set(18.88, 2.55, -14.6);
  depotSign.rotation.y = -Math.PI / 2;
  root.add(depotSign);

  // 客栈临街门
  box(-29.92, 1.4, -16.75, 0.16, 2.8, 2.6, 'wood', { tag: 'trim', color: 0x6b4c34 });
  box(-29.7, 2.6, -16.75, 0.5, 0.1, 3.4, 'fabric', { collide: false });
  const innSign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 0.9),
    new THREE.MeshBasicMaterial({ map: signTexture('CARAVAN', '#d9b47a'), toneMapped: false })
  );
  innSign.position.set(-29.72, 2.9, -16.75);
  innSign.rotation.y = -Math.PI / 2;
  root.add(innSign);

  // A 大掩体 / 杂物
  box(16.5, 0.62, -5.2, 2.4, 1.24, 3.4, 'wood', { tag: 'cover' });
  box(15.9, 1.69, -5.2, 1.2, 0.9, 2.4, 'fabric', { tag: 'cover', repeat: 4 });
  box(30.6, 0.5, -8.6, 2.8, 1.0, 1.3, 'fabric', { tag: 'cover', repeat: 4 });
  box(29.8, 0.55, -20.8, 2.4, 1.1, 2.4, 'metal', { tag: 'cover', color: 0x7d8a80 });
  box(17.2, 0.4, -18.4, 1.4, 0.8, 1.4, 'wood', { tag: 'cover' });
  // A 大路灯
  for (const z of [-19, -9, 1]) {
    box(33.7, 2.2, z, 0.14, 4.4, 0.14, 'darkmetal', { tag: 'pole' });
    box(33.0, 4.3, z, 1.4, 0.12, 0.12, 'darkmetal', { collide: false });
    const lamp = new THREE.BoxGeometry(0.34, 0.16, 0.5);
    lamp.translate(32.4, 4.15, z);
    glowGeos.push(lamp);
  }

  /* ---------------------------------------------------------------- */
  /* A 点                                                              */
  /* ---------------------------------------------------------------- */

  // 包点台 0.58 m：南 / 西各一级 0.29 m 台阶
  box(SITE_A.x, 0.29, SITE_A.z, 8, 0.58, 8, 'sandstone', { tag: 'platform' });
  box(SITE_A.x, 0.6, SITE_A.z, 8, 0.04, 8, 'concrete', { tag: 'trim', collide: false });
  box(25, 0.145, 11.55, 4, 0.29, 1.2, 'concrete', { tag: 'stairs' });
  box(20.4, 0.145, 16, 1.2, 0.29, 4, 'concrete', { tag: 'stairs' });
  // 老城前哨：保留台面，包点标记移到东/西院新包点。

  // A 点掩体：大木箱 / 货车 / 沙袋 / 矮墙
  box(31.4, 0.8, 14.8, 1.7, 1.6, 1.7, 'wood', { tag: 'cover' });
  box(31.4, 1.66, 14.8, 1.4, 0.12, 1.4, 'wood', { collide: false });
  box(20.4, 0.65, 22.4, 2.0, 1.3, 3.0, 'wood', { tag: 'cover' });
  box(20.4, 1.38, 22.4, 1.8, 0.16, 2.8, 'fabric', { collide: false, repeat: 4 });
  box(23, 0.48, 22.8, 2.8, 0.96, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
  box(32, 0.55, 22.4, 4.6, 1.1, 0.8, 'brick', { tag: 'wall' });
  box(20.2, 0.35, 13.4, 1.4, 0.7, 1.4, 'wood', { tag: 'cover' });

  // A 后看台（2.5 m）：下层是可以穿行的走廊，上层是狙击位
  box(24.5, 2.5, 26.25, 13, 0.3, 3.5, 'wood', { tag: 'terrace' });
  for (const x of [18.6, 30.4]) {
    for (const z of [24.9, 27.6]) {
      box(x, 1.25, z, 0.42, 2.5, 0.42, 'concrete', { tag: 'column' });
    }
  }
  // 看台护墙：南侧留 3 m 射击口
  box(21, 3.0, 24.6, 6, 0.9, 0.26, 'plaster', { tag: 'cover' });
  box(29, 3.0, 24.6, 4, 0.9, 0.26, 'plaster', { tag: 'cover' });
  box(31, 3.0, 26.2, 0.26, 0.9, 3.2, 'plaster', { tag: 'cover' });
  box(18, 3.0, 26.2, 0.26, 0.9, 3.2, 'plaster', { tag: 'cover' });
  // 上后看台的楼梯
  stairs(16.8, 20.0, 2.6, 9, 0.278, 0.5, 's', 'concrete', { tag: 'stairs' });
  for (const sx of [-1, 1]) {
    box(16.8 + sx * 1.36, 1.4, 22.3, 0.18, 2.8, 4.7, 'concrete', { collide: false, tag: 'rail' });
  }
  // 看台上的箱子、旗子
  box(21.2, 3.0, 26.6, 1.0, 0.9, 1.0, 'wood', { tag: 'cover' });
  box(28.6, 3.0, 26.4, 1.2, 0.9, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
  for (const x of [18.4, 30.6]) {
    box(x, 3.85, 27.6, 0.1, 2.7, 0.1, 'darkmetal', { tag: 'pole' });
    const flagGeo = new THREE.PlaneGeometry(1.5, 0.9);
    flagGeo.translate(x + 0.78, 4.75, 27.6);
    flagGeos.push(flagGeo);
  }
  // 看台下方：木箱与油灯（后巷入口的掩体）
  box(22.4, 0.55, 26.2, 1.4, 1.1, 1.4, 'wood', { tag: 'cover' });
  box(27.4, 0.4, 26.5, 1.2, 0.8, 1.2, 'wood', { tag: 'cover' });

  // A 后巷：CT → A 的旋转通道，北侧靠外墙（门洞 3 m）
  box(8.6, 2.1, 26.6, 1.2, 4.2, 1.2, 'plaster', { tag: 'wall' });
  box(8.6, 2.1, 30.8, 1.2, 4.2, 1.2, 'plaster', { tag: 'wall' });
  box(8.6, 3.9, 28.7, 1.3, 0.5, 3.0, 'sandstone', { tag: 'wall', collide: false });
  // 后巷杂物
  box(13.5, 0.5, 30.2, 1.6, 1.0, 1.2, 'wood', { tag: 'cover' });
  box(26, 0.42, 30.2, 2.2, 0.84, 1.1, 'fabric', { tag: 'cover', repeat: 4 });
  box(33.2, 0.55, 29.8, 1.2, 1.1, 1.2, 'wood', { tag: 'cover' });

  /* ---------------------------------------------------------------- */
  /* B 洞（西线）                                                      */
  /* ---------------------------------------------------------------- */

  // 商队客栈：中间 2.6 m 高的穿堂
  box(-27, 2.8, -19.5, 6, 5.6, 3.0, 'sandstone', { tag: 'building' });
  box(-27, 2.8, -13.5, 6, 5.6, 4.0, 'sandstone', { tag: 'building' });
  box(-27, 4.1, -16.75, 6, 3.0, 2.5, 'sandstone', { tag: 'building' });
  box(-27, 5.74, -15.5, 6.3, 0.26, 9.8, 'concrete', { tag: 'cornice', collide: false });
  gableRoof(-27, 5.87, -15.5, 6.3, 9.7, 1.3);
  box(-27, 2.6, -18.02, 5.9, 0.2, 0.2, 'concrete', { tag: 'trim', collide: false });
  box(-27, 2.6, -15.48, 5.9, 0.2, 0.2, 'concrete', { tag: 'trim', collide: false });
  box(-25.2, 0.45, -16.9, 0.9, 0.9, 0.9, 'wood', { tag: 'cover' });
  box(-29.0, 0.35, -16.4, 0.7, 0.7, 0.7, 'wood', { tag: 'cover' });

  // 装卸台 1.2 m：从 B 洞西巷上四级台阶
  box(-34, 0.6, -5, 4, 1.2, 6, 'sandstone', { tag: 'platform' });
  box(-34, 1.24, -5, 4.2, 0.12, 6.2, 'concrete', { tag: 'trim', collide: false });
  stairs(-30.0, -5, 3.0, 4, 0.3, 0.5, 'w', 'concrete', { tag: 'stairs' });
  box(-33.6, 1.75, -7.2, 2.6, 1.0, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
  box(-34.2, 1.6, -2.6, 1.2, 0.8, 1.2, 'wood', { tag: 'cover' });
  // 装卸台边的吊臂
  box(-34.4, 2.9, -8.2, 0.18, 5.8, 0.18, 'darkmetal', { tag: 'pole' });
  box(-33.1, 5.6, -8.2, 2.8, 0.16, 0.16, 'darkmetal', { collide: false });
  box(-31.8, 4.95, -8.2, 0.08, 1.3, 0.08, 'metal', { collide: false });

  // B 洞掩体
  box(-22, 0.5, -8.6, 3.0, 1.0, 1.3, 'fabric', { tag: 'cover', repeat: 4 });
  box(-20.3, 0.55, -18.5, 2.4, 1.1, 2.4, 'metal', { tag: 'cover', color: 0x8a7a62 });
  box(-31.2, 0.45, -20.4, 1.6, 0.9, 1.6, 'wood', { tag: 'cover' });
  box(-20.6, 0.28, -3.2, 1.2, 0.56, 2.4, 'brick', { tag: 'cover' });
  // B 洞口门：把 21 m 宽的洞收成 8 m 宽的正门
  box(-31, 2.1, 5.6, 6, 4.2, 0.9, 'plaster', { tag: 'wall' });
  box(-16.5, 2.1, 5.6, 7, 4.2, 0.9, 'plaster', { tag: 'wall' });
  box(-24, 4.35, 5.6, 8, 0.5, 1.1, 'sandstone', { tag: 'wall' });
  box(-24, 4.7, 5.6, 8.3, 0.22, 1.3, 'concrete', { tag: 'trim', collide: false });
  // B 洞路灯
  for (const z of [-19, -9, 1]) {
    box(-33.8, 2.2, z, 0.14, 4.4, 0.14, 'darkmetal', { tag: 'pole' });
    box(-33.1, 4.3, z, 1.3, 0.12, 0.12, 'darkmetal', { collide: false });
    const lamp = new THREE.BoxGeometry(0.36, 0.16, 0.5);
    lamp.translate(-32.5, 4.15, z);
    glowGeos.push(lamp);
  }

  /* ---------------------------------------------------------------- */
  /* B 点                                                              */
  /* ---------------------------------------------------------------- */

  box(SITE_B.x, 0.29, SITE_B.z, 8, 0.58, 8, 'sandstone', { tag: 'platform' });
  box(SITE_B.x, 0.6, SITE_B.z, 8, 0.04, 8, 'concrete', { tag: 'trim', collide: false });
  box(-25, 0.145, 11.55, 4, 0.29, 1.2, 'concrete', { tag: 'stairs' });
  box(-19.6, 0.145, 16, 1.2, 0.29, 4, 'concrete', { tag: 'stairs' });
  // 老城前哨：保留台面，包点标记移到东/西院新包点。

  // B 点掩体：大车 / 桶 / 箱子
  box(-16.5, 0.7, 20.6, 2.4, 1.4, 3.2, 'wood', { tag: 'cover' });
  box(-16.5, 1.45, 20.6, 2.2, 0.16, 3.0, 'fabric', { collide: false, repeat: 4 });
  box(-31.8, 0.8, 13.6, 1.7, 1.6, 1.7, 'wood', { tag: 'cover' });
  box(-18.2, 0.42, 24.4, 2.8, 0.84, 1.1, 'fabric', { tag: 'cover', repeat: 4 });
  box(-32.4, 0.55, 23.2, 1.2, 1.1, 1.2, 'wood', { tag: 'cover' });
  box(-21.5, 0.93, 13.2, 1.4, 0.7, 1.4, 'wood', { tag: 'cover' });

  // B 窗口楼阁（2.2 m 夹层 + 真实射击窗）
  // 墙体：南墙留门，东墙上下各留一扇可射击的窗。
  const bh = 4.6;
  function bWall(cx, cz, w, d, h, y) {
    box(cx, (y == null ? 0 : y) + h / 2, cz, w, h, d, 'plaster', { tag: 'building' });
  }
  // 南墙 z 20..20.5，门洞 x -28.4..-26.6（1.8 m）
  bWall(-29.475, 20.25, 2.15, 0.5, bh);
  bWall(-25.45, 20.25, 2.3, 0.5, bh);
  // 门楣净高 2.8 m：B 点台面高 0.58 m，站在台面上进门也需要足够净空
  bWall(-27.5, 20.25, 1.8, 0.5, bh - 2.8, 2.8);
  // 门内一级台阶：0.58 m 台面 → 0.29 m → 室内地面，避免进门后出不来
  box(-27.5, 0.145, 20.95, 1.9, 0.29, 0.9, 'concrete', { tag: 'stairs' });
  // 东墙 x -24.8..-24.3：下窗 z 22.05..24.05（y 1.1..2.0），上窗 z 25..26.3（y 2.5..3.4）
  bWall(-24.55, 21.025, 0.5, 2.05, bh);
  bWall(-24.55, 23.05, 0.5, 2.0, 1.1);
  bWall(-24.55, 23.05, 0.5, 2.0, bh - 2.0, 2.0);
  bWall(-24.55, 24.525, 0.5, 0.95, bh);
  bWall(-24.55, 25.65, 0.5, 1.3, 2.5);
  bWall(-24.55, 25.65, 0.5, 1.3, bh - 3.4, 3.4);
  bWall(-24.55, 26.65, 0.5, 0.7, bh);
  // 西墙 / 北墙
  bWall(-30.55, 23.5, 0.5, 7.0, bh);
  bWall(-27.55, 26.75, 6.5, 0.5, bh);
  // 室内夹层（z 24..26.5）
  box(-27.5, 2.3, 25.25, 5.7, 0.2, 2.5, 'wood', { tag: 'loft' });
  stairs(-29.5, 20.8, 1.2, 8, 0.275, 0.4, 's', 'wood', { tag: 'stairs' });
  // 室内杂物
  box(-26.4, 0.45, 21.6, 1.0, 0.9, 1.0, 'wood', { tag: 'cover' });
  box(-29.4, 0.35, 23.4, 0.9, 0.7, 0.9, 'wood', { tag: 'cover' });
  box(-25.6, 2.65, 25.9, 1.0, 0.7, 0.8, 'wood', { tag: 'cover' });
  // 屋顶与窗框
  box(-27.5, bh + 0.14, 23.5, 6.5, 0.28, 7.3, 'concrete', { tag: 'cornice', collide: false });
  gableRoof(-27.5, bh + 0.28, 23.5, 6.4, 7.2, 1.25);
  const winMat = material('metal', { color: 0x6fa3bd, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide });
  const paneGeos = [];
  for (const [z, y, hh] of [[23.05, 1.55, 0.9], [25.65, 2.95, 0.9]]) {
    const pane = new THREE.PlaneGeometry(1.9, hh);
    pane.rotateY(-Math.PI / 2);
    pane.translate(-24.82, y, z);
    paneGeos.push(pane);
    box(-24.55, y - hh / 2 - 0.06, z, 0.16, 0.1, 2.16, 'plaster', { collide: false });
  }
  root.add(new THREE.Mesh(mergeGeos(paneGeos), winMat));
  // 室内天花板：封住屋顶山墙，避免站在夹层上看到天空
  box(-27.5, 4.52, 23.5, 6.0, 0.12, 7.0, 'plaster', { collide: false, tag: 'ceiling' });
  {
    const ceilLamp = new THREE.BoxGeometry(0.5, 0.1, 0.5);
    ceilLamp.translate(-27.5, 4.4, 23.5);
    glowGeos.push(ceilLamp);
    const warm = new THREE.PointLight(0xffd2a0, 1.15, 8.5, 2);
    warm.position.set(-27.5, 3.7, 23.5);
    root.add(warm);
  }
  // 门口台阶与灯
  const doorLamp = new THREE.BoxGeometry(0.18, 0.18, 0.36);
  doorLamp.translate(-27.5, 2.75, 19.9);
  glowGeos.push(doorLamp);

  // B 后巷（门洞 3 m）
  box(-8.6, 2.1, 26.6, 1.2, 4.2, 1.2, 'plaster', { tag: 'wall' });
  box(-8.6, 2.1, 30.8, 1.2, 4.2, 1.2, 'plaster', { tag: 'wall' });
  box(-8.6, 3.9, 28.7, 1.3, 0.5, 3.0, 'sandstone', { tag: 'wall', collide: false });
  box(-14, 0.5, 30.2, 1.4, 1.0, 1.2, 'wood', { tag: 'cover' });
  box(-30.8, 0.42, 29.9, 2.0, 0.84, 1.0, 'fabric', { tag: 'cover', repeat: 4 });
  box(-20.4, 0.55, 29.6, 1.2, 1.1, 1.2, 'wood', { tag: 'cover' });

  /* ---------------------------------------------------------------- */
  /* CT 出生区（北）                                                   */
  /* ---------------------------------------------------------------- */

  // 两侧院墙：z 16..27 实墙，27..30.2 是通往 A/B 后巷的门洞
  for (const sx of [-1, 1]) {
    const x = sx * 8;
    box(x, 2.1, 21.5, 0.9, 4.2, 11, 'plaster', { tag: 'wall' });
    box(x, 2.1, 30.2, 0.9, 4.2, 2.6, 'plaster', { tag: 'wall' });
    box(x, 3.85, 28.0, 1.0, 0.5, 4.6, 'sandstone', { tag: 'wall', collide: false });
    // 墙上的拱窗
    box(x - sx * 0.48, 2.6, 22.8, 0.08, 1.3, 1.0, 'plaster', { collide: false, color: 0x5f8fa8 });
  }
  // CT 与包点之间的实体楼：把包点西侧封成街墙，形成“后巷口”
  for (const sx of [-1, 1]) {
    const bx = sx * 10.7;
    box(bx, 2.3, 23, 4.55, 4.6, 6, 'plaster', { tag: 'building' });
    box(bx, 4.72, 23, 4.85, 0.24, 6.3, 'concrete', { tag: 'cornice', collide: false });
    gableRoof(bx, 4.84, 23, 4.7, 6.2, 1.0);
    box(sx * 12.98, 0.22, 23, 0.14, 0.44, 6.2, 'sandstone', { collide: false });
  }
  // CT 北侧改为通往北院的开口（矮墙移除，避免挡路）

  // 中央水池
  box(0, 0.38, 23.6, 3.4, 0.76, 3.4, 'sandstone', { tag: 'fountain' });
  {
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1.45, 20),
      new THREE.MeshBasicMaterial({ color: 0x76b8d8, transparent: true, opacity: 0.8 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.765, 23.6);
    root.add(water);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.3, 1.6, 10),
      material('sandstone', { color: 0xbfae8c })
    );
    pillar.position.set(0, 1.55, 23.6);
    pillar.castShadow = true;
    root.add(pillar);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.3, 0.22, 14), material('gold'));
    bowl.position.set(0, 2.4, 23.6);
    root.add(bowl);
  }
  // CT 两侧的跳箱与矮台
  for (const sx of [-1, 1]) {
    box(sx * 5.6, 0.55, 21.2, 1.8, 1.1, 1.8, 'wood', { tag: 'cover' });
    box(sx * 5.6, 0.27, 19.4, 1.2, 0.54, 1.2, 'wood', { tag: 'cover' });
    box(sx * 5.6, 1.16, 21.2, 1.5, 0.12, 1.5, 'fabric', { collide: false, repeat: 4 });
  }
  // CT 出生区的布篷与北墙雨棚
  awning(0, 29.8, 12, 2.8, 3.2, false);
  // CT 标识

  /* ---------------------------------------------------------------- */
  /* 外立面：窗户、百叶、阳台、招牌                                   */
  /* ---------------------------------------------------------------- */

  const windowDark = { collide: false, color: 0x5f8fa8 };
  const shutter = { collide: false, color: 0x4f8fbe };
  /** 在墙面上贴一扇白框蓝窗（装饰）。face: 1 朝 +x，-1 朝 -x，2 朝 +z，-2 朝 -z。 */
  function decoWindow(x, y, z, w, h, face) {
    if (face === 1 || face === -1) {
      box(x, y, z, 0.05, h + 0.22, w + 0.22, 'plaster', { collide: false, color: 0xf7f5ef });
      box(x + face * 0.03, y, z, 0.06, h, w, 'plaster', Object.assign({}, windowDark));
      box(x + face * 0.045, y, z - w * 0.5 - 0.16, 0.06, h, w * 0.3, 'wood', Object.assign({}, shutter));
      box(x + face * 0.045, y, z + w * 0.5 + 0.16, 0.06, h, w * 0.3, 'wood', Object.assign({}, shutter));
      box(x + face * 0.06, y - h / 2 - 0.14, z, 0.16, 0.08, w + 0.3, 'plaster', { collide: false });
    } else {
      const s = face > 0 ? 1 : -1;
      box(x, y, z, w + 0.22, h + 0.22, 0.05, 'plaster', { collide: false, color: 0xf7f5ef });
      box(x, y, z + s * 0.03, w, h, 0.06, 'plaster', Object.assign({}, windowDark));
      box(x - w * 0.5 - 0.16, y, z + s * 0.045, w * 0.3, h, 0.06, 'wood', Object.assign({}, shutter));
      box(x + w * 0.5 + 0.16, y, z + s * 0.045, w * 0.3, h, 0.06, 'wood', Object.assign({}, shutter));
      box(x, y - h / 2 - 0.14, z + s * 0.06, w + 0.3, 0.08, 0.16, 'plaster', { collide: false });
    }
  }

  // A 大东侧建筑（E1/E2/E3/E4）与货栈的窗，全部贴在实际墙面上
  for (const z of [-20.5, -17, -13.8]) {
    decoWindow(13, 2.9, z, 1.0, 1.2, 1);
    decoWindow(13, 4.6, z, 0.9, 1.0, 1);
  }
  decoWindow(13, 2.9, -5, 1.0, 1.2, 1);
  decoWindow(13, 4.7, -5, 0.9, 1.0, 1);
  for (const z of [2.2, 4.4]) decoWindow(13, 2.9, z, 1.0, 1.2, 1);
  for (const z of [15.8, 18.2]) decoWindow(13, 2.9, z, 1.0, 1.2, 1);
  for (const z of [-19, -17.4, -12.4, -10.6]) {
    decoWindow(19, 3.2, z, 1.0, 1.2, -1);
    decoWindow(19, 5.0, z, 0.9, 1.0, -1);
    decoWindow(27, 3.2, z, 1.0, 1.2, 1);
    decoWindow(27, 5.0, z, 0.9, 1.0, 1);
  }
  // A 门楼：南立面（面向 A 大）与朝向 A 点的侧窗
  decoWindow(15, 3.1, 4, 1.1, 1.2, -2);
  decoWindow(28, 3.1, 4, 1.4, 1.2, -2);
  decoWindow(17, 3.1, 6.5, 1.0, 1.1, 1);
  decoWindow(25, 3.1, 6.5, 1.0, 1.1, -1);
  // A 点西侧街墙
  for (const z of [22, 24.2]) decoWindow(12.975, 3.0, z, 1.0, 1.1, 1);

  // B 洞两侧
  for (const z of [-20.5, -17, -13.5, -9.5]) {
    decoWindow(-13, 2.9, z, 1.0, 1.2, -1);
    decoWindow(-13, 4.6, z, 0.9, 1.0, -1);
  }
  for (const z of [0, 3]) {
    decoWindow(-13, 2.9, z, 1.0, 1.2, -1);
    decoWindow(-13, 4.7, z, 0.9, 1.0, -1);
  }
  for (const z of [15.2, 18]) decoWindow(-13, 2.9, z, 1.0, 1.2, -1);
  // 商队客栈
  for (const z of [-19.5, -14.2]) {
    decoWindow(-30, 2.9, z, 1.0, 1.2, -1);
    decoWindow(-30, 4.4, z, 0.9, 1.0, -1);
    decoWindow(-24, 2.9, z, 1.0, 1.2, 1);
    decoWindow(-24, 4.4, z, 0.9, 1.0, 1);
  }
  // B 点东侧街墙
  for (const z of [22, 24.2]) decoWindow(-12.975, 3.0, z, 1.0, 1.1, -1);
  // B 洞口门
  decoWindow(-31, 3.1, 5.15, 1.0, 1.1, -2);
  decoWindow(-16.5, 3.1, 5.15, 1.0, 1.1, -2);

  // 中路骑楼（面向中路）
  for (const z of [-20.5, -17, -13.8]) {
    decoWindow(6, 3.2, z, 1.0, 1.2, -1);
    decoWindow(6, 4.9, z, 0.9, 1.0, -1);
  }
  decoWindow(6, 3.2, -5, 1.0, 1.2, -1);
  decoWindow(6, 4.9, -5, 0.9, 1.0, -1);
  for (const z of [2.2, 4.4]) decoWindow(6, 3.2, z, 1.0, 1.2, -1);
  for (const z of [15.8, 18.2]) decoWindow(6, 3.2, z, 1.0, 1.2, -1);
  for (const z of [-20.5, -17, -13.5, -9.5]) {
    decoWindow(-6, 3.2, z, 1.0, 1.2, 1);
    decoWindow(-6, 4.9, z, 0.9, 1.0, 1);
  }
  for (const z of [0, 3]) {
    decoWindow(-6, 3.2, z, 1.0, 1.2, 1);
    decoWindow(-6, 5.0, z, 0.9, 1.0, 1);
  }
  for (const z of [15.2, 18]) decoWindow(-6, 3.2, z, 1.0, 1.2, 1);

  /* ---------------------------------------------------------------- */
  /* 墙面细部：壁柱、管道、配电箱、线缆                               */
  /* ---------------------------------------------------------------- */

  // A 大 / B 洞侧墙的壁柱
  for (let z = -24; z <= 4; z += 4.2) {
    box(13.4, 2.1, z, 0.4, 4.2, 0.4, 'concrete', { tag: 'pilaster' });
    box(-13.4, 2.1, z, 0.4, 4.2, 0.4, 'concrete', { tag: 'pilaster' });
  }
  // 墙脚管道
  box(18.52, 0.22, -10, 0.16, 0.16, 30, 'metal', { tag: 'pipe', collide: false, color: 0x3a3c38 });
  box(-18.52, 0.22, -10, 0.16, 0.16, 30, 'metal', { tag: 'pipe', collide: false, color: 0x3a3c38 });
  box(18.52, 3.7, -10, 0.1, 0.1, 30, 'metal', { tag: 'cable', collide: false, color: 0x1c1c1a });
  box(-18.52, 3.7, -10, 0.1, 0.1, 30, 'metal', { tag: 'cable', collide: false, color: 0x1c1c1a });
  // 配电箱 / 空调外机
  [[18.4, 2.4, -20], [18.4, 2.5, -4], [-18.4, 2.4, -21], [-18.4, 2.5, 1]].forEach(([x, y, z]) => {
    box(x, y, z, 0.36, 0.9, 1.2, 'metal', { tag: 'machine', collide: false, color: 0x59635c });
    for (let i = 0; i < 4; i++) {
      box(x - (x > 0 ? 0.2 : -0.2), y - 0.3 + i * 0.18, z, 0.03, 0.05, 0.9, 'metal',
        { collide: false, color: 0x222622 });
    }
  });
  // 横跨 A 大的电缆
  [-20, -6, 2].forEach((z) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(18.4, 4.7, z),
      new THREE.Vector3(24, 4.15, z + 0.3),
      new THREE.Vector3(30, 4.4, z - 0.2),
      new THREE.Vector3(34, 4.6, z)
    ]);
    cableGeos.push(new THREE.TubeGeometry(curve, 14, 0.016, 5, false));
  });

  /* ---------------------------------------------------------------- */
  /* 招牌与标识                                                        */
  /* ---------------------------------------------------------------- */

  const signs = [
    { text: 'A LONG', color: '#e06a35', x: 13.36, y: 3.2, z: -3, ry: Math.PI / 2, w: 1.9, h: 0.95 },
    { text: 'B TUNNEL', color: '#e06a35', x: -13.36, y: 3.2, z: -3, ry: -Math.PI / 2, w: 1.9, h: 0.95 },
    { text: 'MID', color: '#d9b47a', x: -5.52, y: 3.4, z: 7, ry: Math.PI / 2, w: 1.5, h: 0.75 },
    { text: 'SITE A', color: '#d9b47a', x: 13.38, y: 3.0, z: 17, ry: -Math.PI / 2, w: 1.6, h: 0.8 },
    { text: 'SITE B', color: '#d9b47a', x: -13.38, y: 3.0, z: 17, ry: Math.PI / 2, w: 1.6, h: 0.8 },
    { text: 'A SHORT', color: '#8fb2c9', x: 5.52, y: 3.2, z: 10, ry: Math.PI / 2, w: 1.7, h: 0.85 }
  ];
  signs.forEach((s) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(s.w, s.h),
      new THREE.MeshBasicMaterial({ map: signTexture(s.text, s.color) })
    );
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.ry;
    root.add(m);
  });

  /* ---------------------------------------------------------------- */
  /* 远景（外墙之外，仅天空线；不参与碰撞）                           */
  /* ---------------------------------------------------------------- */

  const far = [];
  // 东西两侧各一排：进深固定，间距大于进深，避免屋顶互相穿插。
  for (let i = 0; i < 8; i++) {
    const z = -38 + i * 10.5;
    far.push([-66 - (i % 2) * 6, z, 9 + (i % 3) * 2, 8, 4 + (i % 4) * 0.8, 1]);
    far.push([66 + (i % 2) * 6, z, 9 + (i % 3) * 2, 8, 4 + ((i + 1) % 4) * 0.8, -1]);
  }
  // 北侧一排（南侧不放，避免挡住俯视全景）
  for (let i = 0; i < 5; i++) {
    far.push([-28 + i * 14, 62 + (i % 2) * 6, 10, 9, 4 + (i % 3) * 1.0, 0]);
  }
  far.length = 0; // 外院扩建后移除远景城市，避免墙顶半截建筑
  far.forEach(([x, z, w, d, h, side], i) => {
    const base = 0;
    box(x, base + h / 2, z, w, h, d, i % 3 ? 'plaster' : 'sandstone',
      { collide: false, castShadow: false });
    gableRoof(x, base + h, z, w, d, 1.2, w > d ? 'x' : 'z');
    for (let wy = 2.5; wy < h - 1; wy += 2.6) {
      if (side) {
        // 面向地图的一侧开门窗
        for (let k = -d / 2 + 1.4; k < d / 2 - 0.8; k += 2.4) {
          box(x + side * (w / 2 + 0.03), wy, z + k, 0.06, 1.0, 0.9, 'plaster',
            { collide: false, castShadow: false, color: 0x5f8fa8 });
        }
      } else {
        for (let k = -w / 2 + 1.4; k < w / 2 - 0.8; k += 2.2) {
          box(x + k, wy, z - d / 2 - 0.03, 0.9, 1.0, 0.06, 'plaster',
            { collide: false, castShadow: false, color: 0x5f8fa8 });
        }
      }
    }
  });

  // 蓝砖穹顶钟楼：放在北院之外作为地标
  box(0, 6, 51.5, 5, 12, 5, 'plaster', { collide: false, castShadow: false });
  box(0, 12.1, 51.5, 5.4, 0.3, 5.4, 'concrete', { collide: false, castShadow: false });
  {
    const dg = [];
    const drum = new THREE.CylinderGeometry(2.4, 2.5, 1.4, 16);
    drum.translate(0, 12.7, 51.5);
    dg.push(drum);
    const cap = new THREE.SphereGeometry(2.35, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.translate(0, 13.4, 51.5);
    dg.push(cap);
    root.add(new THREE.Mesh(mergeGeos(dg), new THREE.MeshStandardMaterial({
      map: domeTexture(), roughness: 0.45, metalness: 0.15
    })));
    const fin = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 1.2, 8),
      material('wood', { color: 0xc9a25a, roughness: 0.35 })
    );
    fin.position.set(0, 15.7, 51.5);
    root.add(fin);
  }

  /* ---------------------------------------------------------------- */
  /* 陶桶 / 托盘 / 轮胎 / 棕榈                                         */
  /* ---------------------------------------------------------------- */

  const barrelMat = material('metal', { repeat: 1, roughness: 0.5, metalness: 0.7 });
  const barrelGeos = [];
  const barrels = [
    [30.2, -2], [-29.4, -9], [32.8, 9.5], [-33.2, 10.2], [19.2, -21.5],
    [-19.8, 6.2], [10.6, 30.1], [-12.6, 30.2], [25.8, 26.2],
    [46, 7], [-46, 7], [20, -41], [-20, 41], [50.5, 10], [-50.5, 10]
  ];
  barrels.forEach(([x, z]) => {
    const g = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 16);
    g.translate(x, 0.55, z);
    barrelGeos.push(g);
    prop({ x, y: 0.55, z, w: 0.84, h: 1.1, d: 0.84, kind: 'metal', tag: 'prop', collide: true });
    world.add({ minX: x - 0.42, maxX: x + 0.42, minY: 0, maxY: 1.1, minZ: z - 0.42, maxZ: z + 0.42, tag: 'prop' });
  });
  const barrelMesh = new THREE.Mesh(mergeGeos(barrelGeos), barrelMat);
  barrelMesh.castShadow = true;
  barrelMesh.receiveShadow = true;
  root.add(barrelMesh);

  // 木托盘
  const palletMat = material('wood', { repeat: 2 });
  const palletGeos = [];
  [[17, 3], [-16.8, -3], [31.8, -24], [-31.4, 25.6], [9.2, -22],
    [42, 4], [-42, 4], [8, -41], [-8, 41]].forEach(([x, z]) => {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BoxGeometry(2.2, 0.10, 1.4);
      g.rotateY(((i * 7) % 5 - 2) * 0.03);
      g.translate(x, 0.05 + i * 0.10, z);
      palletGeos.push(g);
    }
    prop({ x, y: 0.15, z, w: 2.2, h: 0.30, d: 1.4, kind: 'wood', tag: 'prop', collide: true });
    world.add({ minX: x - 1.1, maxX: x + 1.1, minY: 0, maxY: 0.30, minZ: z - 0.7, maxZ: z + 0.7, tag: 'prop' });
  });
  const palletMesh = new THREE.Mesh(mergeGeos(palletGeos), palletMat);
  palletMesh.castShadow = true;
  palletMesh.receiveShadow = true;
  root.add(palletMesh);

  // 轮胎堆（装饰道具，不当作对局掩体）
  const tireGeos = [];
  [[33.6, 4.4], [-33.8, 3.6], [25.4, -23.0], [-26.4, -23.0]].forEach(([x, z], si) => {
    const n = si % 2 ? 3 : 4;
    for (let i = 0; i < n; i++) {
      const g = new THREE.TorusGeometry(0.34, 0.12, 8, 18);
      g.rotateX(Math.PI / 2);
      g.translate(x, 0.13 + i * 0.24, z);
      tireGeos.push(g);
    }
    world.add({ minX: x - 0.46, maxX: x + 0.46, minY: 0, maxY: n * 0.24, minZ: z - 0.46, maxZ: z + 0.46, tag: 'prop' });
  });
  const tireMesh = new THREE.Mesh(mergeGeos(tireGeos), flat(0x1a1a18, { roughness: 0.92, metalness: 0.02 }));
  tireMesh.castShadow = true;
  tireMesh.receiveShadow = true;
  root.add(tireMesh);

  // 棕榈树
  const trunkGeos = [], leafGeos = [];
  [[34, 29.5], [-34, 29.5], [11.8, 30.4], [-11.8, 30.4], [33.6, -29], [-33.6, -29], [23.5, 28.9], [-23.5, 28.9]].forEach(([px, pz], idx) => {
    const h = 4.4 + (idx % 3) * 0.45;
    const trunk = new THREE.CylinderGeometry(0.13, 0.24, h, 7);
    trunk.rotateZ(0.05 * ((idx % 3) - 1));
    trunk.translate(px, h / 2, pz);
    trunkGeos.push(trunk);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const leaf = new THREE.ConeGeometry(0.34, 2.5, 4);
      leaf.rotateZ(Math.PI / 2 + 0.22);
      leaf.scale(1, 1, 0.55);
      leaf.rotateY(a);
      leaf.translate(px + Math.cos(a) * 1.2, h + 0.15, pz - Math.sin(a) * 1.2);
      leafGeos.push(leaf);
    }
  });
  root.add(new THREE.Mesh(mergeGeos(trunkGeos), material('wood', { color: 0x6b4a2a })));
  root.add(new THREE.Mesh(mergeGeos(leafGeos), new THREE.MeshStandardMaterial({
    color: 0x3f6b3a, roughness: 0.82, side: THREE.DoubleSide
  })));

  /* ---------------------------------------------------------------- */
  /* 地面污渍 / 碎屑 / 墙面标识                                       */
  /* ---------------------------------------------------------------- */

  const stainMat = new THREE.MeshBasicMaterial({
    map: stainTexture(), transparent: true, opacity: 0.5, depthWrite: false
  });
  const stains = [];
  [[24, -4, 5.2], [26, 18, 4.4], [-25, -6, 5.6], [-24, 18, 4.4], [0, 4, 6.0], [2, -18, 4.6],
   [22, 29, 4.0], [-22, 29, 4.0], [16, 5, 3.4],
   [44, 0, 5.0], [-44, 0, 5.0], [0, -38, 6.0], [0, 38, 5.0], [44, 24, 3.6], [-44, 24, 3.6]].forEach(([x, z, s]) => {
    const g = new THREE.PlaneGeometry(s, s * 0.7);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.045, z);
    stains.push(g);
  });
  const stainMesh = new THREE.Mesh(mergeGeos(stains), stainMat);
  stainMesh.renderOrder = 1;
  root.add(stainMesh);

  // 地面碎屑
  for (let i = 0; i < 30; i++) {
    const x = (rnd() - 0.5) * 60;
    const z = (rnd() - 0.5) * 56;
    if (Math.abs(x) < 3.5 && Math.abs(z + 28) < 3) continue;
    if (Math.abs(x) < 5 && Math.abs(z) < 6) continue;
    const w = 0.12 + rnd() * 0.5;
    const d = 0.08 + rnd() * 0.25;
    box(x, 0.03, z, w, 0.05, d, i % 3 ? 'wood' : 'concrete', { collide: false, tag: 'debris' });
  }

  // 包点后墙的喷涂字母
  function sprayLetter(x, y, z, ry, letter) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: labelTexture(letter, 'rgba(224,106,53,.7)'), transparent: true, depthWrite: false })
    );
    m.position.set(x, y, z);
    m.rotation.y = ry;
    root.add(m);
  }
  sprayLetter(12.96, 2.2, 22.5, Math.PI / 2, 'A');
  sprayLetter(-12.96, 2.2, 22.5, -Math.PI / 2, 'B');

  // 地面道路标线
  for (let i = 0; i < 5; i++) {
    box(24, 0.05, -21 + i * 5, 0.13, 0.02, 3.0, 'concrete', { color: 0xded6c2, collide: false });
    box(-25, 0.05, -21 + i * 5, 0.13, 0.02, 3.0, 'concrete', { color: 0xded6c2, collide: false });
  }
  for (let i = 0; i < 4; i++) {
    box(0, 0.05, -18 + i * 5, 0.13, 0.02, 3.0, 'concrete', { color: 0xd7cba8, collide: false });
  }
  // 中路门口的斑马线
  for (let i = -3; i <= 3; i++) {
    box(i * 1.1, 0.05, 0.9, 0.5, 0.02, 2.4, 'plaster', { color: 0xded6c2, collide: false });
  }

  // 墙根假 AO
  const aoTexCanvas = document.createElement('canvas');
  aoTexCanvas.width = 64; aoTexCanvas.height = 64;
  const actx = aoTexCanvas.getContext('2d');
  const ag = actx.createLinearGradient(0, 0, 64, 0);
  ag.addColorStop(0, 'rgba(0,0,0,.5)');
  ag.addColorStop(0.6, 'rgba(0,0,0,.16)');
  ag.addColorStop(1, 'rgba(0,0,0,0)');
  actx.fillStyle = ag;
  actx.fillRect(0, 0, 64, 64);
  const aoTex = new THREE.CanvasTexture(aoTexCanvas);
  const aoMat = new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, opacity: 0.75, depthWrite: false });
  const aoGeos = [];
  [[20.2, -8, 30], [31.4, -8, 30], [-20.2, -8, 30]].forEach(([x, z, len]) => {
    const p = new THREE.PlaneGeometry(1.2, Math.abs(len));
    p.rotateX(-Math.PI / 2);
    p.translate(x, 0.03, z);
    aoGeos.push(p);
  });
  const aoMesh = new THREE.Mesh(mergeGeos(aoGeos), aoMat);
  aoMesh.renderOrder = 1;
  root.add(aoMesh);

  // 出生区地面标记
  const spawnMat = new THREE.MeshBasicMaterial({
    color: 0xd9b47a, transparent: true, opacity: 0.1, depthWrite: false
  });
  const tSpawn = new THREE.Mesh(new THREE.PlaneGeometry(20, 7), spawnMat);
  tSpawn.rotation.x = -Math.PI / 2;
  tSpawn.position.set(0, 0.055, -26.2);
  root.add(tSpawn);

  // 拱门贴图：B 洞两处
  const archMat = new THREE.MeshBasicMaterial({ map: archTexture() });
  const archGeos = [];
  [[-13.36, -21, -Math.PI / 2], [-13.36, -11, -Math.PI / 2]].forEach(([x, z, ry]) => {
    const p = new THREE.PlaneGeometry(2.4, 3.5);
    p.rotateY(ry);
    p.translate(x, 1.75, z);
    archGeos.push(p);
  });
  root.add(new THREE.Mesh(mergeGeos(archGeos), archMat));


  /* ---------------------------------------------------------------- */
  /* 外环四院：T 南院 / CT 北院 / A 东院 / B 西院                     */
  /* ---------------------------------------------------------------- */

  // 四院铺装：走静态合批（不额外增加 draw call）
  const armPave = (x, z, w, d, kind) => box(x, 0.02, z, w, 0.03, d, kind, { collide: false, tag: 'pave' });
  armPave(0, -38, 56, 12, 'concrete');
  armPave(0, 38, 56, 12, 'plaster');
  armPave(44, 1, 14, 56, 'concrete');
  armPave(-44, 1, 14, 56, 'concrete');
  armPave(0, -32.5, 28, 3, 'concrete');
  armPave(0, 32.5, 28, 3, 'plaster');
  armPave(36.5, 15, 3, 20, 'concrete');
  armPave(-36.5, 15, 3, 20, 'concrete');
  armPave(36.5, -17, 3, 14, 'concrete');
  armPave(-36.5, -17, 3, 14, 'concrete');

  // 四院外墙
  box(0, 4, -44.5, 60, 8, 1, 'plaster', { tag: 'wall' });
  box(0, 4, 44.5, 60, 8, 1, 'plaster', { tag: 'wall' });
  for (const sx of [-1, 1]) {
    box(sx * 30.5, 4, -38.25, 1, 8, 12.5, 'plaster', { tag: 'wall' });
    box(sx * 30.5, 4, 38.25, 1, 8, 12.5, 'plaster', { tag: 'wall' });
  }
  box(52.5, 4, 1, 1, 8, 58, 'plaster', { tag: 'wall' });
  box(-52.5, 4, 1, 1, 8, 58, 'plaster', { tag: 'wall' });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(sx * 44, 4, sz * 29.5, 16, 8, 1, 'plaster', { tag: 'wall' });
    }
  }
  // 外檐
  box(0, 7.7, -44.2, 60, 0.4, 0.5, 'concrete', { tag: 'trim', collide: false });
  box(0, 7.7, 44.2, 60, 0.4, 0.5, 'concrete', { tag: 'trim', collide: false });
  box(52.2, 7.7, 1, 0.5, 0.4, 58, 'concrete', { tag: 'trim', collide: false });
  box(-52.2, 7.7, 1, 0.5, 0.4, 58, 'concrete', { tag: 'trim', collide: false });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(sx * 44, 7.7, sz * 29.2, 16, 0.4, 0.5, 'concrete', { tag: 'trim', collide: false });
    }
  }

  // T 南院：舞台、雨棚、市集、巴士
  box(0, 0.3, -43.1, 12, 0.6, 2.0, 'concrete', { tag: 'platform' });
  box(0, 3.7, -42.2, 14, 0.12, 3.2, 'fabric', { collide: false, repeat: 5, castShadow: true });
  for (const x of [-6.2, 6.2]) {
    for (const z of [-43.6, -40.8]) {
      box(x, 1.85, z, 0.18, 3.7, 0.18, 'wood', { tag: 'post' });
    }
  }
  {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 2.0),
      new THREE.MeshBasicMaterial({ map: signTexture('T SPAWN', '#e06a35'), toneMapped: false })
    );
    sign.position.set(0, 5.0, -43.9);
    root.add(sign);
  }
  {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), new THREE.MeshBasicMaterial({
      color: 0xd9b47a, transparent: true, opacity: 0.1, depthWrite: false
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.06, -38);
    root.add(m);
  }
  // 巴士车体 + 车窗 + 车轮（掩体）
  box(12, 1.2, -37, 3.0, 2.4, 7.0, 'metal', { tag: 'cover' });
  box(12, 2.15, -37, 2.7, 0.5, 6.7, 'metal', { tag: 'trim', collide: false, color: 0x6f8792 });
  for (const z of [-39.2, -37, -34.8]) {
    box(10.48, 1.85, z, 0.06, 0.8, 1.2, 'plaster', { collide: false, color: 0x4f7b8e });
  }
  for (const z of [-39.3, -34.7]) {
    for (const x of [10.75, 13.25]) {
      box(x, 0.42, z, 0.45, 0.84, 0.9, 'darkmetal', { tag: 'trim', collide: false });
    }
  }
  // 市集摊位与掩体
  box(-20, 0.55, -37.2, 3.2, 1.1, 1.5, 'fabric', { tag: 'cover', repeat: 4 });
  box(-20, 2.75, -37.2, 3.6, 0.12, 2.0, 'fabric', { collide: false, repeat: 5, castShadow: true });
  for (const x of [-21.6, -18.4]) box(x, 1.5, -38.1, 0.16, 2.6, 0.16, 'wood', { tag: 'post' });
  box(20, 0.55, -40.2, 3.0, 1.1, 1.4, 'wood', { tag: 'cover' });
  box(20, 2.55, -40.2, 3.4, 0.12, 1.9, 'fabric', { collide: false, repeat: 5, castShadow: true });
  for (const x of [18.6, 21.4]) box(x, 1.4, -40.9, 0.16, 2.5, 0.16, 'wood', { tag: 'post' });
  box(-10, 0.6, -41.1, 1.4, 1.2, 1.4, 'wood', { tag: 'cover' });
  box(-14, 0.42, -34.8, 2.6, 0.84, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
  box(23, 0.45, -34.6, 2.2, 0.9, 1.2, 'fabric', { tag: 'cover', repeat: 4 });

  // CT 北院：喷泉、花坛、掩体
  {
    const fg = new THREE.CylinderGeometry(1.5, 1.5, 0.8, 18);
    fg.translate(0, 0.4, 42);
    const fm = new THREE.Mesh(fg, material('concrete', { repeat: 2 }));
    fm.castShadow = true;
    fm.receiveShadow = true;
    root.add(fm);
    world.add({ minX: -1.5, maxX: 1.5, minY: 0, maxY: 0.8, minZ: 40.5, maxZ: 43.5, tag: 'prop' });
    const wg = new THREE.CircleGeometry(1.25, 20);
    wg.rotateX(-Math.PI / 2);
    const wm = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: 0x62b7d8, transparent: true, opacity: 0.75 }));
    wm.position.set(0, 0.81, 42);
    root.add(wm);
  }
  {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 2.0),
      new THREE.MeshBasicMaterial({ map: signTexture('CT SPAWN', '#5da4d0'), toneMapped: false })
    );
    sign.position.set(0, 5.0, 43.9);
    sign.rotation.y = Math.PI;
    root.add(sign);
  }
  box(-18, 0.35, 39, 3.2, 0.7, 2.0, 'sandstone', { tag: 'cover' });
  box(18, 0.35, 39, 3.2, 0.7, 2.0, 'sandstone', { tag: 'cover' });
  box(-12, 0.5, 34.6, 2.4, 1.0, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
  box(12, 0.55, 34.6, 2.0, 1.1, 1.2, 'wood', { tag: 'cover' });
  box(22, 0.55, 42, 2.6, 1.1, 1.4, 'wood', { tag: 'cover' });

  // A / B 新包点 + 掩体 + 旗帜
  for (const [side, sx] of [['A', 1], ['B', -1]]) {
    const cx = sx * 44;
    box(cx, 0.29, 16, 8, 0.58, 8, 'sandstone', { tag: 'platform' });
    box(cx, 0.6, 16, 8, 0.04, 8, 'concrete', { tag: 'trim', collide: false });
    box(cx - sx * 4.6, 0.145, 16, 1.2, 0.29, 4, 'concrete', { tag: 'stairs' });
    box(cx, 0.145, 11.55, 4, 0.29, 1.2, 'concrete', { tag: 'stairs' });
    const mm = new THREE.MeshBasicMaterial({
      map: siteMarkerTexture(side), transparent: true, depthWrite: false, opacity: 0.9
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), mm);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, 0.635, 16);
    m.renderOrder = 2;
    root.add(m);
    const bm = new THREE.MeshBasicMaterial({ map: bannerTexture(side), side: THREE.DoubleSide, toneMapped: false });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), bm);
    banner.position.set(sx * 51.9, 3.5, 16);
    banner.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    root.add(banner);

    // 东/西院掩体（避开台阶、包点台与门洞）
    box(sx * 49.9, 1.4, -6, 2.6, 2.8, 7.0, 'metal', { tag: 'cover' });
    box(sx * 49.9, 2.9, -6, 2.4, 0.2, 6.8, 'metal', { tag: 'trim', collide: false, color: 0x7c8e96 });
    box(sx * 38.2, 0.55, 8.0, 2.4, 1.1, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
    box(sx * 50.2, 0.55, 16, 0.7, 1.1, 6.0, 'brick', { tag: 'wall' });
    box(sx * 41.5, 1.18, 14.2, 1.3, 1.2, 1.3, 'wood', { tag: 'cover' });
    box(sx * 42.2, 0.5, 24.0, 2.4, 1.0, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
    box(sx * 49.5, 0.55, 25.0, 2.2, 1.1, 1.3, 'wood', { tag: 'cover' });
    box(sx * 39.0, 0.5, -22.0, 2.2, 1.0, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
    box(sx * 49.0, 0.55, -22.5, 2.0, 1.1, 1.4, 'wood', { tag: 'cover' });
  }

  // 四院墙面窗：避免外院是整面白墙
  for (const z of [-16, -6, 4, 24]) decoWindow(51.95, 3.2, z, 1.2, 1.4, -1);
  for (const z of [-16, -6, 4, 24]) decoWindow(-51.95, 3.2, z, 1.2, 1.4, 1);
  for (const x of [-24, -14, 14, 24]) decoWindow(x, 3.2, -43.95, 1.2, 1.4, 2);
  for (const x of [-24, -14, 14, 24]) decoWindow(x, 3.2, 43.95, 1.2, 1.4, -2);
  for (const z of [-38, -34]) {
    decoWindow(-29.95, 3.2, z, 1.2, 1.4, 1);
    decoWindow(29.95, 3.2, z, 1.2, 1.4, -1);
  }
  for (const z of [34, 38]) {
    decoWindow(-29.95, 3.2, z, 1.2, 1.4, 1);
    decoWindow(29.95, 3.2, z, 1.2, 1.4, -1);
  }
  for (const x of [40, 48]) {
    decoWindow(x, 3.2, 28.95, 1.2, 1.4, -2);
    decoWindow(x, 3.2, -28.95, 1.2, 1.4, 2);
  }

  // 包点周边补掩体
  for (const sx of [-1, 1]) {
    box(sx * 39.5, 0.5, 20.5, 2.2, 1.0, 1.1, 'fabric', { tag: 'cover', repeat: 4 });
    box(sx * 50.5, 0.55, 12, 1.6, 1.1, 1.6, 'wood', { tag: 'cover' });
    box(sx * 43, 0.55, 5, 2.0, 1.1, 1.2, 'wood', { tag: 'cover' });
    box(sx * 46, 0.42, 26, 2.6, 0.84, 1.1, 'fabric', { tag: 'cover', repeat: 4 });
  }
  box(-24, 0.5, -38, 2.2, 1.0, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
  box(24, 0.55, -37, 2.0, 1.1, 1.2, 'wood', { tag: 'cover' });
  box(-24, 0.55, 38, 2.2, 1.1, 1.2, 'wood', { tag: 'cover' });
  box(24, 0.5, 36.5, 2.0, 1.0, 1.2, 'fabric', { tag: 'cover', repeat: 4 });

  // 老城补掩体（不挡主路）
  box(3.6, 0.55, -3.8, 1.6, 1.1, 1.6, 'wood', { tag: 'cover' });
  box(16.0, 0.55, 0.5, 2.0, 1.1, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
  box(32.0, 0.5, 20.0, 2.4, 1.0, 1.4, 'fabric', { tag: 'cover', repeat: 4 });
  box(-32.0, 0.5, 20.0, 2.4, 1.0, 1.4, 'fabric', { tag: 'cover', repeat: 4 });
  box(-8.0, 0.55, -24.0, 2.2, 1.1, 1.2, 'wood', { tag: 'cover' });
  box(0.0, 0.5, 28.6, 2.2, 1.0, 1.2, 'wood', { tag: 'cover' });

  // ---------- 编辑器追加盒体 ----------
  // 放在合批之前，让新增件和手工摆的盒体走完全相同的材质/碰撞/合批链路。
  const baseCount = boxSeq;
  if (editData && Array.isArray(editData.added)) {
    for (const a of editData.added) {
      if (!a) continue;
      box(
        +a.x || 0, +a.y || 0, +a.z || 0,
        Math.max(0.05, +a.w || 1), Math.max(0.05, +a.h || 1), Math.max(0.05, +a.d || 1),
        a.kind || 'plaster',
        {
          tag: a.tag, collide: a.collide, color: a.color, repeat: a.repeat,
          roughness: a.roughness, metalness: a.metalness, castShadow: a.castShadow
        }
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* 合并静态几何                                                      */
  /* ---------------------------------------------------------------- */

  // 自发光灯、电缆、旗帜各合成一个网格，省 draw call。
  if (glowGeos.length) {
    root.add(new THREE.Mesh(mergeGeos(glowGeos),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false })));
    glowGeos.forEach((g) => g.dispose());
  }
  if (cableGeos.length) {
    root.add(new THREE.Mesh(mergeGeos(cableGeos),
      new THREE.MeshBasicMaterial({ color: 0x1b1a18 })));
    cableGeos.forEach((g) => g.dispose());
  }
  if (flagGeos.length) {
    root.add(new THREE.Mesh(mergeGeos(flagGeos),
      new THREE.MeshBasicMaterial({ map: bannerTexture('A'), side: THREE.DoubleSide, toneMapped: false })));
    flagGeos.forEach((g) => g.dispose());
  }

  const staticGroup = new THREE.Group();
  staticGroup.name = 'static';
  batches.forEach((b) => {
    const geo = mergeGeos(b.geos);
    const matOpts = Object.assign({ repeat: 1, vertexColors: true, side: THREE.DoubleSide }, b.opts);
    delete matOpts.color;
    const mat = material(b.kind, matOpts);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = b.opts.castShadow !== false;
    mesh.receiveShadow = true;
    groupAdd(mesh);
    b.geos.forEach((g) => g.dispose());
  });
  function groupAdd(mesh) { staticGroup.add(mesh); }
  root.add(staticGroup);
  batches.clear();

  // 基础出生点 / 导航点；编辑器可按索引覆写 x/z。
  const baseSpawns = {
    player: { x: 0, y: 0, z: -38, yaw: 0 },
    // 半场交换后的 CT 玩家出生点：CT 北院，面朝南
    playerCT: { x: 0, y: 0, z: 36.5, yaw: Math.PI },
    allies: [
      { x: -4, z: -36, yaw: 0, waypoint: 1 },
      { x: 4, z: -36, yaw: 0, waypoint: 2 },
      { x: -6, z: -33.6, yaw: 0, waypoint: 24 },
      { x: 6, z: -33.6, yaw: 0, waypoint: 3 }
    ],
    // 玩家在 CT 时，4 名 CT 队友的出生点（复用原 CT 出生区的 4 个位置）
    ctAllies: [
      { x: 5, z: 38, yaw: Math.PI, waypoint: 18 },
      { x: -5, z: 38, yaw: Math.PI, waypoint: 34 },
      { x: 38, z: 24, yaw: Math.PI, waypoint: 10 },
      { x: -44, z: 24, yaw: Math.PI, waypoint: 27 }
    ],
    bots: [
      { x: 0, z: 38, yaw: Math.PI, waypoint: 0 },
      { x: 5, z: 40, yaw: Math.PI, waypoint: 18 },
      { x: -5, z: 40, yaw: Math.PI, waypoint: 34 },
      { x: 38, z: 24, yaw: Math.PI, waypoint: 10 },
      { x: -44, z: 24, yaw: Math.PI, waypoint: 27 }
    ],
    // 玩家在 CT 时，5 名 T 敌人的出生点（原 T 队友 4 个 + 中路 1 个）
    tBots: [
      { x: -4, z: -36, yaw: 0, waypoint: 1 },
      { x: 4, z: -36, yaw: 0, waypoint: 2 },
      { x: -6, z: -33.6, yaw: 0, waypoint: 24 },
      { x: 6, z: -33.6, yaw: 0, waypoint: 3 },
      { x: 0, z: -34.5, yaw: 0, waypoint: 0 }
    ]
  };
  const baseWaypoints = [
    // T 南院 → 老城 → A 东院 → CT 北院 → B 西院 → 回 T
    { x: 0, z: -38 }, { x: 0, z: -33 }, { x: 0, z: -28 },
    { x: 13, z: -26 }, { x: 17, z: -20 }, { x: 17, z: -13 },
    { x: 22, z: -6 }, { x: 24, z: 2 }, { x: 21, z: 7 },
    { x: 30, z: 16 }, { x: 38, z: 16 }, { x: 38, z: 23 },
    { x: 44, z: 23 }, { x: 38, z: 28.5 }, { x: 32, z: 29.6 },
    { x: 24, z: 29.6 }, { x: 4, z: 28 },
    { x: 0, z: 34 }, { x: 0, z: 39 }, { x: -18, z: 35.5 }, { x: 0, z: 39 }, { x: 0, z: 34 },
    { x: 4, z: 28 }, { x: -10, z: 29.6 }, { x: -22, z: 29.6 }, { x: -28, z: 28.8 },
    { x: -38, z: 28.5 }, { x: -44, z: 23 }, { x: -38, z: 23 },
    { x: -38, z: 16 }, { x: -38, z: 4 }, { x: -40, z: -17 }, { x: -33, z: -17 },
    { x: -32, z: -14 }, { x: -26, z: -6 }, { x: -22, z: 2 },
    { x: -19, z: 13 }, { x: -10, z: 10 }, { x: -4, z: 7 }, { x: 0, z: 3 },
    { x: 0, z: -4 }, { x: 0, z: -14 }, { x: 0, z: -22 }, { x: 0, z: -30 }, { x: 0, z: -38 }
  ];
;
  const editSpawns = (editData && editData.spawns) || {};
  const editWaypoints = (editData && editData.waypoints) || {};
  const spawns = {
    player: { ...baseSpawns.player, ...(editSpawns.player || {}) },
    playerCT: { ...baseSpawns.playerCT, ...(editSpawns.playerCT || {}) },
    allies: baseSpawns.allies.map((s, i) => ({ ...s, ...((editSpawns.allies && editSpawns.allies[i]) || {}) })),
    ctAllies: baseSpawns.ctAllies.map((s, i) => ({ ...s, ...((editSpawns.ctAllies && editSpawns.ctAllies[i]) || {}) })),
    bots: baseSpawns.bots.map((s, i) => ({ ...s, ...((editSpawns.bots && editSpawns.bots[i]) || {}) })),
    tBots: baseSpawns.tBots.map((s, i) => ({ ...s, ...((editSpawns.tBots && editSpawns.tBots[i]) || {}) }))
  };
  const waypoints = baseWaypoints.map((w, i) => ({ ...w, ...(editWaypoints[i] || {}) }));

  // 战术掩体补密：避开现有碰撞体、出生点、包点中心和 Bot 路径点。
  // 每个点位仍走 box()，会自动获得 COVER_MIN_HEIGHT 的高度归一化。
  const coverSpecs = [
    // A 大 / 东线
    { x: 24, z: -23, w: 2.2, d: 1.2, kind: 'wood' },
    { x: 29.5, z: -18, w: 2.0, d: 1.2, kind: 'metal' },
    { x: 24, z: -4, w: 2.4, d: 1.0, kind: 'fabric' },
    { x: 29, z: 1, w: 1.6, d: 1.6, kind: 'wood' },
    { x: 19, z: 2, w: 1.2, d: 2.4, kind: 'brick' },
    { x: 24, z: 11, w: 2.0, d: 1.2, kind: 'wood' },
    { x: 33, z: 7, w: 1.2, d: 1.4, kind: 'wood' },
    { x: 21, z: -9, w: 1.8, d: 1.2, kind: 'fabric' },
    { x: 16, z: -12, w: 1.2, d: 1.2, kind: 'wood' },
    { x: 30, z: -12, w: 1.4, d: 2.0, kind: 'metal', h: 1.6 },
    // B 洞 / 西线
    { x: -28, z: -8, w: 2.0, d: 1.2, kind: 'wood' },
    { x: -21, z: -14, w: 1.8, d: 1.2, kind: 'fabric' },
    { x: -18, z: -15, w: 1.4, d: 1.4, kind: 'wood' },
    { x: -29, z: -3, w: 1.6, d: 1.6, kind: 'wood' },
    { x: -25, z: 2, w: 2.2, d: 1.0, kind: 'fabric' },
    { x: -33, z: -12, w: 1.2, d: 2.2, kind: 'metal', h: 1.6 },
    { x: -21, z: 1, w: 1.2, d: 1.2, kind: 'brick' },
    { x: -27, z: 9, w: 2.0, d: 1.2, kind: 'wood' },
    { x: -18, z: -7, w: 1.4, d: 1.4, kind: 'wood' },
    { x: -31, z: 2, w: 1.2, d: 2.0, kind: 'metal' },
    // 中路
    { x: -6, z: -14, w: 1.8, d: 1.2, kind: 'wood' },
    { x: 6, z: -9, w: 1.2, d: 2.0, kind: 'fabric' },
    { x: -7, z: 1, w: 1.4, d: 1.4, kind: 'wood' },
    { x: 7, z: 12, w: 2.0, d: 1.2, kind: 'wood' },
    { x: -7, z: 14, w: 1.2, d: 1.2, kind: 'brick' },
    { x: 2, z: -18, w: 1.4, d: 1.4, kind: 'wood' },
    { x: -6, z: 21, w: 1.6, d: 1.2, kind: 'fabric' },
    { x: 6, z: 21, w: 1.6, d: 1.2, kind: 'wood' },
    // T 出生区
    { x: -8, z: -30.5, w: 2.0, d: 1.2, kind: 'wood' },
    { x: 6, z: -30, w: 1.6, d: 1.6, kind: 'wood' },
    { x: -3, z: -27, w: 1.4, d: 1.4, kind: 'fabric' },
    { x: 14, z: -28, w: 1.4, d: 1.4, kind: 'wood' },
    { x: -17, z: -29, w: 1.6, d: 1.2, kind: 'metal' },
    { x: 18, z: -30.5, w: 1.2, d: 2.0, kind: 'fabric' },
    // CT 出生区
    { x: -7, z: 32, w: 1.6, d: 1.6, kind: 'wood' },
    { x: 7, z: 31, w: 1.6, d: 1.6, kind: 'fabric' },
    { x: -22, z: 33, w: 2.0, d: 1.2, kind: 'wood' },
    { x: 22, z: 33, w: 2.0, d: 1.2, kind: 'wood' },
    { x: -2, z: 36, w: 1.2, d: 1.2, kind: 'brick' },
    { x: 2, z: 30, w: 1.2, d: 1.2, kind: 'wood' },
    // A 东院 / B 西院
    { x: 40, z: 4, w: 1.6, d: 1.6, kind: 'wood' },
    { x: 47, z: 9, w: 2.0, d: 1.2, kind: 'metal' },
    { x: 38, z: 22, w: 1.4, d: 1.4, kind: 'wood' },
    { x: 46, z: 22, w: 1.6, d: 1.2, kind: 'fabric' },
    { x: 43, z: 0, w: 1.2, d: 2.0, kind: 'metal' },
    { x: -40, z: 4, w: 1.6, d: 1.6, kind: 'wood' },
    { x: -47, z: 9, w: 2.0, d: 1.2, kind: 'metal' },
    { x: -38, z: 22, w: 1.4, d: 1.4, kind: 'wood' },
    { x: -46, z: 22, w: 1.6, d: 1.2, kind: 'fabric' },
    { x: -43, z: 0, w: 1.2, d: 2.0, kind: 'metal' },
    // A/B 后巷
    { x: 20, z: 29.5, w: 1.6, d: 1.2, kind: 'wood' },
    { x: 28, z: 29.5, w: 1.4, d: 1.4, kind: 'fabric' },
    { x: -20, z: 29.5, w: 1.6, d: 1.2, kind: 'wood' },
    { x: -28, z: 29.5, w: 1.4, d: 1.4, kind: 'fabric' },
    { x: 25, z: 34, w: 1.2, d: 1.2, kind: 'brick' },
    { x: -25, z: 34, w: 1.2, d: 1.2, kind: 'brick' },
    // 第二批：补足开阔地带的交火掩体
    { x: 22, z: -22, w: 1.4, d: 1.4, kind: 'wood' },
    { x: 18, z: -24, w: 1.4, d: 1.4, kind: 'wood' },
    { x: 23, z: 4, w: 1.6, d: 1.2, kind: 'fabric' },
    { x: 28, z: -2, w: 1.2, d: 2.0, kind: 'metal' },
    { x: 32, z: -5, w: 1.2, d: 1.2, kind: 'brick' },
    { x: 26, z: -8, w: 1.4, d: 1.2, kind: 'wood' },
    { x: -19, z: -20, w: 1.6, d: 1.2, kind: 'wood' },
    { x: -24, z: -5, w: 1.8, d: 1.2, kind: 'fabric' },
    { x: -28, z: 5, w: 1.4, d: 1.4, kind: 'wood' },
    { x: -30, z: 12, w: 1.2, d: 2.0, kind: 'metal' },
    { x: -19, z: 9, w: 1.2, d: 1.2, kind: 'brick' },
    { x: -2, z: 12, w: 1.4, d: 1.2, kind: 'wood' },
    { x: 2, z: 4, w: 1.2, d: 1.4, kind: 'fabric' },
    { x: 0, z: -10, w: 1.2, d: 1.2, kind: 'brick' },
    { x: -12, z: -29, w: 1.6, d: 1.2, kind: 'wood' },
    { x: 11, z: -31, w: 1.2, d: 1.2, kind: 'brick' },
    { x: 2, z: -33, w: 1.4, d: 1.4, kind: 'fabric' },
    { x: -6, z: -35, w: 1.2, d: 2.0, kind: 'metal' },
    { x: -12, z: 31, w: 1.4, d: 1.4, kind: 'wood' },
    { x: 12, z: 30, w: 1.4, d: 1.4, kind: 'fabric' },
    { x: -17, z: 31, w: 1.2, d: 1.2, kind: 'brick' },
    { x: 17, z: 31, w: 1.2, d: 1.2, kind: 'brick' },
    { x: 36, z: 10, w: 1.4, d: 1.4, kind: 'wood' },
    { x: 42, z: 8, w: 1.2, d: 2.0, kind: 'metal' },
    { x: 49, z: 4, w: 1.2, d: 1.2, kind: 'brick' },
    { x: 40, z: 26, w: 1.6, d: 1.2, kind: 'fabric' },
    { x: 46, z: 28, w: 1.2, d: 1.4, kind: 'wood' },
    { x: -36, z: 10, w: 1.4, d: 1.4, kind: 'wood' },
    { x: -42, z: 8, w: 1.2, d: 2.0, kind: 'metal' },
    { x: -49, z: 4, w: 1.2, d: 1.2, kind: 'brick' },
    { x: -40, z: 26, w: 1.6, d: 1.2, kind: 'fabric' },
    { x: -46, z: 28, w: 1.2, d: 1.4, kind: 'wood' },
    { x: 24, z: 30.5, w: 1.2, d: 1.4, kind: 'wood' },
    { x: 18, z: 30.5, w: 1.2, d: 1.2, kind: 'brick' },
    { x: -24, z: 30.5, w: 1.2, d: 1.4, kind: 'wood' },
    { x: -18, z: 30.5, w: 1.2, d: 1.2, kind: 'brick' }
  ];
  let coversAdded = 0;
  const spawnList = [spawns.player, spawns.playerCT, ...spawns.allies, ...spawns.ctAllies, ...spawns.bots, ...spawns.tBots];
  const nearSpawn = (x, z) => spawnList
    .some((s) => Math.hypot(s.x - x, s.z - z) < 3.2);
  const nearSite = (x, z) => [SITE_A, SITE_B, SITE_A_NEW, SITE_B_NEW]
    .some((s) => Math.hypot(s.x - x, s.z - z) < 2.8);
  for (const c of coverSpecs) {
    const h = c.h || COVER_MIN_HEIGHT;
    if (world.overlaps(c.x - c.w / 2 - 0.55, 0, c.z - c.d / 2 - 0.55,
      c.x + c.w / 2 + 0.55, h + 0.2, c.z + c.d / 2 + 0.55)) continue;
    if (nearSpawn(c.x, c.z) || nearSite(c.x, c.z)) continue;
    if (waypoints.some((w) => Math.hypot(w.x - c.x, w.z - c.z) < 1.8)) continue;
    box(c.x, h / 2, c.z, c.w, h, c.d, c.kind, { tag: 'cover' });
    coversAdded++;
  }

  const buyZone = {
    minX: spawns.player.x - 10, maxX: spawns.player.x + 10,
    minZ: spawns.player.z - 5.5, maxZ: spawns.player.z + 5.5
  };

  return {
    root,
    world,
    placed,
    baseCount,
    edits: editData,
    sites: { A: SITE_A_NEW, B: SITE_B_NEW },
    spawns,
    buyZone,
    bounds: { minX: -53, maxX: 53, minZ: -45, maxZ: 45 },
    waypoints,
    coversAdded,
    callouts: {
      tSpawn: { x: spawns.player.x, z: spawns.player.z },
      ctSpawn: { x: 0, z: 38 },
      mid: { x: 0, z: 0 },
      aLong: { x: 24, z: -10 },
      aYard: { x: 44, z: -8 },
      aLobby: { x: 26, z: 16 },
      aSite: { x: 44, z: 16 },
      bTunnel: { x: -26, z: -10 },
      bYard: { x: -44, z: -8 },
      bLobby: { x: -24, z: 16 },
      bSite: { x: -44, z: 16 },
      aShort: { x: 10, z: 10 },
      bShort: { x: -10, z: 10 },
      aBack: { x: 24, z: 29.5 },
      bBack: { x: -22, z: 29.5 }
    }
  };
}
