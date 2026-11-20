// 沙线（Sandline）地图。
// 设计：T 出生南侧，CT 北侧；A 大（东）/ 中门（中）/ B 洞（西）三条进攻线。
// 几何全部 AABB，便于碰撞与合批；正式关卡替换点见 docs/MAP-SPEC.md。

import * as THREE from '../../vendor/three.module.js';
import { World } from './collision.js';
import { material, flat } from './textures.js';
import { scaleBoxUV, mergeGeos } from './geo-utils.js';

const TILE = 2.6;

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
  x.fillStyle = '#173f55';
  x.fillRect(0, 0, 256, 256);
  // 蓝色琉璃砖：菱形网格 + 金线
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cx = col * 32 + (row % 2 ? 16 : 0);
      const cy = row * 32;
      x.fillStyle = row % 2 ? '#2b6f8c' : '#1f5a76';
      x.beginPath();
      x.moveTo(cx, cy - 15); x.lineTo(cx + 15, cy); x.lineTo(cx, cy + 15); x.lineTo(cx - 15, cy);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(201,162,90,.5)';
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
  // 石拱
  x.fillStyle = '#8f7d63';
  x.beginPath();
  x.moveTo(24, 384); x.lineTo(24, 150);
  x.arc(128, 150, 104, Math.PI, 0);
  x.lineTo(232, 384); x.closePath(); x.fill();
  // 木门
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

export function buildMap(root) {
  const world = new World();
  const batches = new Map();
  // 开发者审计用：保留每个手工摆放盒体的原始参数，合批后仍能逐件检查。
  const placed = [];

  function batch(kind, opts) {
    opts = opts || {};
    // 颜色不再拆批次：同一材质的深浅变化烘焙成顶点色，合批后少几十个 draw call。
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
    const b = batch(kind, opts);
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(g, w, h, d, TILE);
    g.translate(cx, cy, cz);
    tint(g, opts.color);
    b.geos.push(g);
    placed.push({
      x: cx, y: cy, z: cz, w, h, d,
      kind, tag: opts.tag || '', collide: opts.collide !== false
    });
    if (opts.collide !== false) {
      world.add({
        minX: cx - w / 2, maxX: cx + w / 2,
        minY: cy - h / 2, maxY: cy + h / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
        tag: opts.tag || ''
      });
    }
  }

  // ---------- 地面 ----------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(72, 64),
    material('sand', { repeat: 14, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  root.add(ground);

  world.add({ minX: -36, maxX: 36, minY: -1.2, maxY: 0, minZ: -32, maxZ: 32, tag: 'ground' });

  // ---------- 外墙 ----------
  box(0, 3, -32.5, 72, 6, 1, 'plaster', { tag: 'wall' });
  box(0, 3, 32.5, 72, 6, 1, 'plaster', { tag: 'wall' });
  box(-36.5, 3, 0, 1, 6, 65, 'plaster', { tag: 'wall' });
  box(36.5, 3, 0, 1, 6, 65, 'plaster', { tag: 'wall' });

  // 墙裙与顶部压顶：让墙面不是一整片平板
  box(0, 0.28, -31.9, 72, 0.56, 0.3, 'concrete', { tag: 'trim', collide: false });
  box(0, 0.28, 31.9, 72, 0.56, 0.3, 'concrete', { tag: 'trim', collide: false });
  box(-35.9, 0.28, 0, 0.3, 0.56, 65, 'concrete', { tag: 'trim', collide: false });
  box(35.9, 0.28, 0, 0.3, 0.56, 65, 'concrete', { tag: 'trim', collide: false });
  box(0, 5.7, -32.4, 72, 0.4, 0.5, 'concrete', { tag: 'trim', collide: false });
  box(0, 5.7, 32.4, 72, 0.4, 0.5, 'concrete', { tag: 'trim', collide: false });

  // ---------- 中路 ----------
  box(-7, 2, -7, 1, 4, 34, 'plaster', { tag: 'wall' });
  box(-7, 2, 17, 1, 4, 6, 'plaster', { tag: 'wall' });
  box(7, 2, -7, 1, 4, 34, 'plaster', { tag: 'wall' });
  box(7, 2, 17, 1, 4, 6, 'plaster', { tag: 'wall' });
  box(-4.6, 2, 0, 1.2, 4, 1.2, 'concrete', { tag: 'wall' });
  box(4.6, 2, 0, 1.2, 4, 1.2, 'concrete', { tag: 'wall' });
  box(0, 4.2, 0, 10.4, 0.5, 1.2, 'concrete', { tag: 'wall' });
  // 门框钢梁
  box(-4.6, 4.05, 0, 1.5, 0.24, 1.5, 'metal', { tag: 'trim', collide: false });
  box(4.6, 4.05, 0, 1.5, 0.24, 1.5, 'metal', { tag: 'trim', collide: false });

  // ---------- A 大 ----------
  box(19, 2, -8, 1, 4, 32, 'plaster', { tag: 'wall' });
  box(32.5, 1.2, -10, 1, 2.4, 24, 'sandstone', { tag: 'wall' });
  box(27, 0.75, -3, 3.2, 1.5, 3.2, 'wood', { tag: 'cover' });
  box(23, 0.75, -15, 3.2, 1.5, 3.2, 'wood', { tag: 'cover' });
  box(30, 0.55, 2, 2.2, 1.1, 2.2, 'metal', { tag: 'cover' });
  // 沙袋掩体
  box(24.5, 0.5, 5, 2.8, 1.0, 1.3, 'fabric', { tag: 'cover', repeat: 4 });
  box(21.5, 0.42, -20.5, 3.2, 0.84, 1.2, 'fabric', { tag: 'cover', repeat: 4 });

  // ---------- A 点 ----------
  box(26, 0.15, 22, 10, 0.3, 6, 'concrete', { tag: 'platform' });
  box(21, 0.75, 17, 3.2, 1.5, 3.2, 'wood', { tag: 'cover' });
  box(30.5, 0.75, 13, 2.6, 1.5, 2.6, 'wood', { tag: 'cover' });
  box(18.5, 1.1, 24, 2.4, 2.2, 2.4, 'metal', { tag: 'cover' });
  box(24, 0.5, 17.5, 2.6, 1.0, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
  [
    [9, 2], [18, 8], [27, 2]
  ].forEach(([cz, len]) => {
    box(15, 2, cz, 1, 4, len, 'brick', { tag: 'wall' });
  });
  // A 点遮阳棚（纯装饰，不参与碰撞）
  box(25.5, 3.3, 21.5, 9.5, 0.12, 7.5, 'fabric', { collide: false, repeat: 5, castShadow: true });
  for (const ax of [21, 30]) {
    box(ax, 3.22, 21.5, 0.14, 0.14, 7.5, 'metal', { collide: false, color: 0x33352f });
    for (const az of [18.0, 25.0]) {
      box(ax, 1.6, az, 0.11, 3.2, 0.11, 'metal', { collide: false, color: 0x33352f });
    }
  }

  // ---------- 中门 -> A 短 ----------
  box(11, 2, 9.5, 8, 4, 1, 'brick', { tag: 'wall' });
  box(11, 2, 14.5, 8, 4, 1, 'brick', { tag: 'wall' });
  box(8.5, 0.7, 12, 2.2, 1.4, 2.2, 'wood', { tag: 'cover' });

  // ---------- B 洞 ----------
  box(-19, 2, -8, 1, 4, 32, 'plaster', { tag: 'wall' });
  box(-31.5, 1.2, -10, 1, 2.4, 24, 'concrete', { tag: 'wall' });
  box(-25, 0.75, -4, 3.2, 1.5, 3.2, 'wood', { tag: 'cover' });
  box(-29.3, 0.75, -10.2, 3.2, 1.5, 3.2, 'wood', { tag: 'cover' });
  box(-22, 0.55, 2, 2.2, 1.1, 2.2, 'metal', { tag: 'cover' });
  box(-24.5, 0.5, 6, 2.8, 1.0, 1.3, 'fabric', { tag: 'cover', repeat: 4 });
  box(-30, 0.42, -21, 3.0, 0.84, 1.2, 'fabric', { tag: 'cover', repeat: 4 });

  // ---------- B 点 ----------
  box(-26, 0.15, 22, 10, 0.3, 6, 'concrete', { tag: 'platform' });
  box(-21, 0.75, 17, 3.2, 1.5, 3.2, 'wood', { tag: 'cover' });
  box(-30.5, 0.75, 13, 2.6, 1.5, 2.6, 'wood', { tag: 'cover' });
  box(-18.5, 1.1, 24, 2.4, 2.2, 2.4, 'metal', { tag: 'cover' });
  box(-24, 0.5, 18, 2.6, 1.0, 1.2, 'fabric', { tag: 'cover', repeat: 4 });
  [
    [9, 2], [18, 8], [27, 2]
  ].forEach(([cz, len]) => {
    box(-15, 2, cz, 1, 4, len, 'brick', { tag: 'wall' });
  });
  box(-25.5, 3.3, 21.5, 9.5, 0.12, 7.5, 'fabric', { collide: false, repeat: 5 });
  for (const ax of [-21, -30]) {
    box(ax, 3.22, 21.5, 0.14, 0.14, 7.5, 'metal', { collide: false, color: 0x33352f });
    for (const az of [18.0, 25.0]) {
      box(ax, 1.6, az, 0.11, 3.2, 0.11, 'metal', { collide: false, color: 0x33352f });
    }
  }

  // ---------- 中门 -> B 门 ----------
  box(-11, 2, 9.5, 8, 4, 1, 'concrete', { tag: 'wall' });
  box(-11, 2, 14.5, 8, 4, 1, 'concrete', { tag: 'wall' });
  box(-9, 0.7, 12, 2.2, 1.4, 2.2, 'wood', { tag: 'cover' });

  // ---------- CT 出生与连接 ----------
  box(12, 2, 21.5, 8, 4, 1, 'plaster', { tag: 'wall' });
  box(12, 2, 26.5, 8, 4, 1, 'plaster', { tag: 'wall' });
  box(-12, 2, 21.5, 8, 4, 1, 'plaster', { tag: 'wall' });
  box(-12, 2, 26.5, 8, 4, 1, 'plaster', { tag: 'wall' });
  box(4.5, 0.65, 24.5, 2, 1.3, 2, 'wood', { tag: 'cover' });
  box(-4.5, 0.65, 24.5, 2, 1.3, 2, 'wood', { tag: 'cover' });

  // ---------- T 出生掩体 ----------
  box(-7, 0.65, -27.5, 2.4, 1.3, 2.4, 'wood', { tag: 'cover' });
  box(7, 0.65, -27.5, 2.4, 1.3, 2.4, 'wood', { tag: 'cover' });
  box(0, 0.5, -30.6, 4.2, 1.0, 0.9, 'fabric', { tag: 'cover', repeat: 4 });

  // ---------- 墙面细部：壁柱、压顶、线缆 ----------
  // 让长墙不再是一整块平板：每 4 m 一道壁柱，顶部一道压顶。
  for (let z = -22; z <= 6; z += 4) {
    box(18.42, 2.1, z, 0.55, 4.2, 0.38, 'concrete', { tag: 'pilaster', collide: true });
    box(-18.42, 2.1, z, 0.55, 4.2, 0.38, 'concrete', { tag: 'pilaster', collide: true });
  }
  for (let z = -20; z <= 8; z += 4) {
    box(-6.42, 2.1, z, 0.5, 4.2, 0.34, 'concrete', { tag: 'pilaster', collide: true });
    box(6.42, 2.1, z, 0.5, 4.2, 0.34, 'concrete', { tag: 'pilaster', collide: true });
  }
  // 压顶 / 檐口
  box(18.34, 3.92, -8, 0.42, 0.26, 33, 'concrete', { tag: 'cornice', collide: false });
  box(-18.34, 3.92, -8, 0.42, 0.26, 33, 'concrete', { tag: 'cornice', collide: false });
  box(6.34, 3.92, -7, 0.38, 0.22, 34, 'concrete', { tag: 'cornice', collide: false });
  box(-6.34, 3.92, -7, 0.38, 0.22, 34, 'concrete', { tag: 'cornice', collide: false });
  // 墙根电缆 / 管道
  box(18.5, 0.22, -8, 0.16, 0.16, 30, 'metal', { tag: 'pipe', collide: false, color: 0x3a3c38 });
  box(-18.5, 0.22, -8, 0.16, 0.16, 30, 'metal', { tag: 'pipe', collide: false, color: 0x3a3c38 });
  box(18.42, 2.95, -8, 0.07, 0.07, 30, 'metal', { tag: 'cable', collide: false, color: 0x1c1c1a });
  // 墙上配电箱 / 空调外机
  [[18.35, 2.4, -14], [18.35, 2.5, 2], [-18.35, 2.4, -12], [-18.35, 2.5, 4]].forEach(([x, y, z]) => {
    box(x, y, z, 0.36, 0.9, 1.2, 'metal', { tag: 'machine', collide: false, color: 0x565e58 });
    box(x - 0.19, y, z, 0.04, 0.72, 1.0, 'metal', { tag: 'machine', collide: false, color: 0x2a2c28 });
  });

  // ---------- 远景 ----------
  for (let i = 0; i < 18; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (44 + Math.random() * 18);
    const z = -34 + Math.random() * 68;
    const h = 7 + Math.random() * 14;
    box(x, h / 2, z, 8 + Math.random() * 10, h, 8 + Math.random() * 10, i % 3 ? 'plaster' : 'sandstone', { collide: false, castShadow: false });
  }

  // ---------- 合并静态几何 ----------
  function flushBatches(group) {
    batches.forEach((b) => {
      const geo = mergeGeos(b.geos);
      const matOpts = Object.assign({ repeat: 1, vertexColors: true }, b.opts);
      delete matOpts.color;
      const mat = material(b.kind, matOpts);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = b.opts.castShadow !== false;
      mesh.receiveShadow = true;
      group.add(mesh);
      b.geos.forEach((g) => g.dispose());
    });
    batches.clear();
  }

  const staticGroup = new THREE.Group();
  staticGroup.name = 'static';
  flushBatches(staticGroup);
  root.add(staticGroup);

  // ---------- 油桶 / 木托盘 ----------
  const props = new THREE.Group();
  props.name = 'props';
  const barrelMat = material('metal', { repeat: 1, roughness: 0.5, metalness: 0.7 });
  const barrelGeos = [];
  [[24, -9], [-27, -10], [29, 18], [-29, 6], [6, 18], [-6, 18]].forEach(([x, z]) => {
    const g = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 16);
    g.translate(x, 0.55, z);
    barrelGeos.push(g);
    placed.push({ x, y: 0.55, z, w: 0.84, h: 1.1, d: 0.84, kind: 'metal', tag: 'cover', collide: true });
    world.add({ minX: x - 0.42, maxX: x + 0.42, minY: 0, maxY: 1.1, minZ: z - 0.42, maxZ: z + 0.42, tag: 'cover' });
  });
  const barrelMesh = new THREE.Mesh(mergeGeos(barrelGeos), barrelMat);
  barrelMesh.castShadow = true;
  barrelMesh.receiveShadow = true;
  props.add(barrelMesh);
  // 木托盘（几个叠放，增加生活感）
  const palletMat = material('wood', { repeat: 2 });
  const palletGeos = [];
  [[15, 3], [-16, -3], [31, -24]].forEach(([x, z]) => {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BoxGeometry(2.2, 0.12, 1.4);
      g.rotateY((Math.random() - 0.5) * 0.06);
      g.translate(x, 0.06 + i * 0.14, z);
      palletGeos.push(g);
    }
    placed.push({ x, y: 0.21, z, w: 2.2, h: 0.42, d: 1.4, kind: 'wood', tag: 'cover', collide: true });
    world.add({ minX: x - 1.1, maxX: x + 1.1, minY: 0, maxY: 0.42, minZ: z - 0.7, maxZ: z + 0.7, tag: 'cover' });
  });
  const palletMesh = new THREE.Mesh(mergeGeos(palletGeos), palletMat);
  palletMesh.castShadow = true;
  palletMesh.receiveShadow = true;
  props.add(palletMesh);
  root.add(props);

  // ---------- A 大 / B 洞内侧立面细节 ----------
  // 之前壁柱做在墙的“中侧”，A 大里看是平的；这里补真正面向 A 大的一层。
  for (let z = -22; z <= 6; z += 4) {
    box(19.68, 2.1, z, 0.38, 4.2, 0.34, 'concrete', { tag: 'pilaster', collide: true });
    box(-19.68, 2.1, z, 0.38, 4.2, 0.34, 'concrete', { tag: 'pilaster', collide: true });
    box(31.78, 2.1, z - 2, 0.38, 4.2, 0.34, 'concrete', { tag: 'pilaster', collide: true });
  }
  // 门洞 / 卷帘门 / 雨棚 / 壁灯
  const lampGeos = [];
  function shopDoor(x, z, s) {
    box(x, 1.35, z, 0.14, 2.7, 1.9, 'wood', { tag: 'door', color: 0x6b5a44 });
    // 卷帘门横向板条，别让门变成一块黑板
    for (let i = 0; i < 9; i++) {
      box(x + s * 0.085, 0.22 + i * 0.29, z, 0.025, 0.05, 1.8, 'wood', {
        collide: false, color: i % 2 ? 0x584a38 : 0x7d6c54
      });
    }
    box(x + s * 0.02, 2.84, z, 0.24, 0.2, 2.25, 'concrete', { collide: false });
    box(x + s * 0.02, 0.09, z, 0.24, 0.18, 2.25, 'concrete', { collide: false });
    for (const dz of [-1.08, 1.08]) {
      box(x + s * 0.02, 1.45, z + dz, 0.24, 2.9, 0.18, 'concrete', { collide: false });
    }
  }
  [-16, -4, 4].forEach((z) => {
    shopDoor(19.58, z, 1);
    box(20.15, 3.05, z, 1.3, 0.12, 2.5, 'fabric', { collide: false });
    const lamp = new THREE.BoxGeometry(0.1, 0.1, 0.3);
    lamp.translate(20.55, 3.3, z);
    lampGeos.push(lamp);
    // 门牌
    const doorSign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.28),
      new THREE.MeshBasicMaterial({ map: signTexture('A-0' + (z + 20), '#d9b47a'), toneMapped: false })
    );
    doorSign.position.set(19.56, 2.35, z + 1.1);
    doorSign.rotation.y = Math.PI / 2;
    root.add(doorSign);
  });
  [-16, -4, 4].forEach((z) => {
    shopDoor(-19.58, z, -1);
    box(-20.15, 3.05, z, 1.3, 0.12, 2.5, 'fabric', { collide: false });
  });
  const lampMesh = new THREE.Mesh(mergeGeos(lampGeos), new THREE.MeshBasicMaterial({
    color: 0xffd9a0, toneMapped: false
  }));
  root.add(lampMesh);
  lampGeos.forEach((g) => g.dispose());
  // 沿墙管道 / 配电箱 / 百叶
  box(19.56, 0.35, -8, 0.12, 0.12, 30, 'metal', { tag: 'pipe', collide: false, color: 0x303430 });
  box(19.56, 3.7, -8, 0.1, 0.1, 30, 'metal', { tag: 'pipe', collide: false, color: 0x303430 });
  [[19.58, 2.3, -10], [19.58, 2.4, 1], [31.7, 2.3, -6], [31.7, 2.4, 4]].forEach(([x, y, z]) => {
    box(x, y, z, 0.36, 0.9, 1.15, 'metal', { tag: 'machine', collide: false, color: 0x59635c });
    for (let i = 0; i < 4; i++) box(x - 0.2, y - 0.3 + i * 0.18, z, 0.03, 0.05, 0.9, 'metal', { collide: false, color: 0x222622 });
  });
  // 横跨 A 大的线缆 + 吊灯
  const shadeGeos = [];
  [-15, -3, 9].forEach((z) => {
    box(25.6, 4.7, z, 12, 0.035, 0.035, 'metal', { tag: 'cable', collide: false, color: 0x1a1c1a });
    const shade = new THREE.CylinderGeometry(0.16, 0.3, 0.18, 12);
    shade.translate(25.6, 4.55, z);
    shadeGeos.push(shade);
  });
  const lampMesh2 = new THREE.Mesh(mergeGeos(shadeGeos), new THREE.MeshBasicMaterial({
    color: 0xffcf90, toneMapped: false
  }));
  root.add(lampMesh2);
  shadeGeos.forEach((g) => g.dispose());

  // ---------- 地面杂物 / 工业细节 ----------
  // 集装箱：A 大与 B 洞的视觉地标兼掩体
  [
    { x: 28.5, z: -16, color: 0xa2b0a4, rot: 0 },
    { x: -28.5, z: -15, color: 0xa8865e, rot: 0 }
  ].forEach((c) => {
    box(c.x, 1.3, c.z, 2.4, 2.6, 5.8, 'metal', {
      tag: 'container', color: c.color, roughness: 0.78, metalness: 0.12
    });
    // 波纹侧板 + 门缝与锁具
    const side = c.x > 0 ? -1 : 1;
    for (let i = 0; i < 14; i++) {
      box(c.x + side * 1.21, 1.3, c.z - 2.65 + i * 0.4, 0.05, 2.1, 0.2, 'metal', {
        collide: false, color: 0xb8c4b8, roughness: 0.78, metalness: 0.08
      });
    }
    box(c.x, 1.3, c.z + 2.92, 2.1, 2.2, 0.08, 'metal', { tag: 'container', collide: false, color: 0x2a2f2c });
    box(c.x, 1.35, c.z + 2.98, 0.1, 0.9, 0.08, 'metal', { tag: 'lock', collide: false, color: 0x9c8460 });
    // 顶部加强筋
    for (let i = 0; i < 9; i++) {
      box(c.x - 1.24, 1.3 + (i % 2) * 0.9, c.z - 2.6 + (i % 3) * 1.7, 0.06, 0.08, 1.6, 'metal', { collide: false, color: 0x29302c });
    }
    const stencil = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.55),
      new THREE.MeshBasicMaterial({ map: signTexture('SL-4471', '#e8e2d2') })
    );
    stencil.position.set(c.x + side * 1.25, 1.7, c.z);
    stencil.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    root.add(stencil);
  });

  // 轮胎堆
  const tireGeos = [];
  const tireSpots = [[30.8, 5.5], [30.8, 7.0], [-30.8, 5.0], [22.5, -21.0], [-22.5, -21.0]];
  tireSpots.forEach(([x, z], si) => {
    const n = si % 2 ? 3 : 4;
    for (let i = 0; i < n; i++) {
      const g = new THREE.TorusGeometry(0.34, 0.12, 8, 18);
      g.rotateX(Math.PI / 2);
      g.translate(x, 0.13 + i * 0.24, z);
      tireGeos.push(g);
    }
    world.add({ minX: x - 0.46, maxX: x + 0.46, minY: 0, maxY: n * 0.24, minZ: z - 0.46, maxZ: z + 0.46, tag: 'cover' });
  });
  const tireMesh = new THREE.Mesh(mergeGeos(tireGeos), flat(0x1a1a18, { roughness: 0.92, metalness: 0.02 }));
  tireMesh.castShadow = true;
  tireMesh.receiveShadow = true;
  root.add(tireMesh);
  tireGeos.forEach((g) => g.dispose());

  // 电线杆与电缆
  [-22, 0, 22].forEach((z) => {
    box(31.2, 2.6, z, 0.18, 5.2, 0.18, 'wood', { tag: 'pole' });
    box(30.4, 5.1, z, 1.7, 0.12, 0.12, 'wood', { tag: 'pole', collide: false });
    box(32.0, 5.1, z, 0.12, 0.12, 1.7, 'wood', { tag: 'pole', collide: false });
  });
  for (let i = 0; i < 2; i++) {
    const z0 = -22 + i * 22, z1 = z0 + 22;
    for (let k = 0; k < 4; k++) {
      const y = 4.9 + (k % 2) * 0.12;
      box(31.2, y, (z0 + z1) / 2, 0.035, 0.035, 22, 'metal', { tag: 'cable', collide: false, color: 0x1a1c1a });
    }
  }

  // 墙报 / 警示牌
  const posters = [
    { text: 'SITE A', x: 19.56, y: 2.6, z: 12, ry: Math.PI / 2 },
    { text: 'NO ENTRY', x: -19.56, y: 2.7, z: -6, ry: -Math.PI / 2 }
  ];
  posters.forEach((p) => {
    const tex = signTexture(p.text, '#c9a25a');
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = p.ry;
    root.add(m);
  });

  // 墙根假 AO：不依赖实时阴影也能把墙“压”到地上
  const aoTexCanvas = document.createElement('canvas');
  aoTexCanvas.width = 64; aoTexCanvas.height = 64;
  const actx = aoTexCanvas.getContext('2d');
  const ag = actx.createLinearGradient(0, 0, 64, 0);
  ag.addColorStop(0, 'rgba(0,0,0,.55)');
  ag.addColorStop(0.6, 'rgba(0,0,0,.18)');
  ag.addColorStop(1, 'rgba(0,0,0,0)');
  actx.fillStyle = ag;
  actx.fillRect(0, 0, 64, 64);
  const aoTex = new THREE.CanvasTexture(aoTexCanvas);
  const aoMat = new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, opacity: 0.8, depthWrite: false });
  [[20.2, -8, 30], [31.4, -8, 30], [-20.2, -8, 30]].forEach(([x, z, len]) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, Math.abs(len)), aoMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.018, z);
    p.renderOrder = 1;
    root.add(p);
  });

  // 地面碎木板 / 碎石
  for (let i = 0; i < 26; i++) {
    const x = (Math.random() - 0.5) * 60;
    const z = (Math.random() - 0.5) * 56;
    if (Math.abs(x) < 8 && Math.abs(z) < 10) continue;
    const w = 0.12 + Math.random() * 0.5;
    const d = 0.08 + Math.random() * 0.25;
    box(x, 0.015, z, w, 0.03, d, i % 3 ? 'wood' : 'concrete', { collide: false, tag: 'debris' });
  }

  // ---------- 地面污渍 / 墙面标识 ----------
  const stainMat = new THREE.MeshBasicMaterial({
    map: stainTexture(), transparent: true, opacity: 0.55, depthWrite: false
  });
  const stains = [];
  [[26, -6, 5.5], [22, 20, 4.2], [-25, -5, 5.8], [-22, 19, 4.4], [0, 4, 6.5], [2, -20, 4.8]].forEach(([x, z, s]) => {
    const g = new THREE.PlaneGeometry(s, s * 0.7);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.02, z);
    stains.push(g);
  });
  const stainMesh = new THREE.Mesh(mergeGeos(stains), stainMat);
  stainMesh.renderOrder = 1;
  root.add(stainMesh);

  const signs = [
    { text: 'A LONG', color: '#e06a35', x: 19.56, y: 3.2, z: -2, ry: Math.PI / 2, w: 1.9, h: 0.95 },
    { text: 'B TUNNEL', color: '#e06a35', x: -19.56, y: 3.2, z: -4, ry: -Math.PI / 2, w: 1.9, h: 0.95 },
    { text: 'MID', color: '#d9b47a', x: -7.52, y: 3.4, z: 6, ry: Math.PI / 2, w: 1.5, h: 0.75 },
    { text: 'SITE A', color: '#d9b47a', x: 15.52, y: 3.0, z: 22, ry: -Math.PI / 2, w: 1.6, h: 0.8 },
    { text: 'SITE B', color: '#d9b47a', x: -15.52, y: 3.0, z: 22, ry: Math.PI / 2, w: 1.6, h: 0.8 }
  ];
  signs.forEach((s) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(s.w, s.h),
      new THREE.MeshBasicMaterial({ map: signTexture(s.text, s.color), transparent: false })
    );
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.ry;
    root.add(m);
  });

  // ---------- 包点与出生区标记 ----------
  const sites = {
    A: { x: 26, z: 18, r: 5.8 },
    B: { x: -26, z: 18, r: 5.8 }
  };
  const markerMatA = new THREE.MeshBasicMaterial({
    map: labelTexture('A', 'rgba(224,106,53,.85)'), transparent: true, depthWrite: false, opacity: 0.55
  });
  const markerMatB = new THREE.MeshBasicMaterial({
    map: labelTexture('B', 'rgba(224,106,53,.85)'), transparent: true, depthWrite: false, opacity: 0.55
  });
  const mA = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), markerMatA);
  mA.rotation.x = -Math.PI / 2;
  mA.position.set(sites.A.x, 0.03, sites.A.z);
  root.add(mA);
  const mB = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), markerMatB);
  mB.rotation.x = -Math.PI / 2;
  mB.position.set(sites.B.x, 0.03, sites.B.z);
  root.add(mB);

  const spawnMat = new THREE.MeshBasicMaterial({
    color: 0x7fa06a, transparent: true, opacity: 0.16, depthWrite: false
  });
  const tSpawn = new THREE.Mesh(new THREE.PlaneGeometry(18, 7), spawnMat);
  tSpawn.rotation.x = -Math.PI / 2;
  tSpawn.position.set(0, 0.025, -27.5);
  root.add(tSpawn);

  // ---------- Dust2 式建筑外立面：窗户、蓝色百叶、阳台、空调、蓝砖穹顶、棕榈 ----------
  {
    const facade = { color: 0xd8ccb4, collide: false, castShadow: true };
    const windowDark = { color: 0x2b3a42, collide: false };
    const shutter = { color: 0x3f7692, collide: false, repeat: 2 };

    function windowRow(x, z, y, face) {
      const s = face > 0 ? 1 : -1;
      box(x, y, z, 0.05, 1.32, 0.94, 'concrete', { collide: false, tag: 'window' });
      box(x + s * 0.03, y, z, 0.06, 1.1, 0.72, 'metal', Object.assign({ collide: false, tag: 'window' }, windowDark));
      box(x + s * 0.03, y, z - 0.5, 0.06, 1.1, 0.42, 'wood', Object.assign({ collide: false, tag: 'window' }, shutter));
      box(x + s * 0.03, y, z + 0.5, 0.06, 1.1, 0.42, 'wood', Object.assign({ collide: false, tag: 'window' }, shutter));
      box(x + s * 0.05, y - 0.66, z, 0.16, 0.08, 1.05, 'concrete', { collide: false, tag: 'window' });
    }
    function facadeBlock(cx, cz, w, d, h) {
      box(cx, h / 2 + 4.0, cz, w, h, d, 'plaster', facade);
      box(cx, 4.0 + h + 0.18, cz, w + 0.35, 0.36, d + 0.35, 'concrete', { collide: false });
    }

    // A 大：墙后三层楼
    const aBlocks = [
      [18.0, -17.5, 3.0, 9, 7.2],
      [18.0, -7.5, 3.0, 9, 9.2],
      [18.0, 2.5, 3.0, 9, 6.4]
    ];
    aBlocks.forEach(([cx, cz, w, d, h]) => {
      facadeBlock(cx, cz, w, d, h);
      for (let z = cz - d / 2 + 1.8; z < cz + d / 2 - 1; z += 2.6) {
        windowRow(19.54, z, 5.1, 1);
        if (h > 7.5) windowRow(19.54, z, 6.9, 1);
      }
    });
    // A 大阳台
    [[20.0, -13.5], [20.0, -3.0]].forEach(([x, z]) => {
      box(x, 4.35, z, 1.35, 0.14, 2.6, 'wood', { collide: false, castShadow: true });
      for (let i = -1; i <= 1; i++) {
        box(20.64, 4.85, z + i * 1.0, 0.07, 0.85, 0.07, 'metal', { collide: false });
      }
      box(20.64, 5.28, z, 0.07, 0.07, 2.4, 'metal', { collide: false });
    });
    // B 洞：镜像立面
    const bBlocks = [
      [-18.0, -17.5, 3.0, 9, 7.6],
      [-18.0, -7.5, 3.0, 9, 8.8],
      [-18.0, 2.5, 3.0, 9, 6.8]
    ];
    bBlocks.forEach(([cx, cz, w, d, h]) => {
      facadeBlock(cx, cz, w, d, h);
      for (let z = cz - d / 2 + 1.8; z < cz + d / 2 - 1; z += 2.6) {
        windowRow(-19.54, z, 5.1, -1);
        if (h > 7.5) windowRow(-19.54, z, 6.9, -1);
      }
    });
    [[-20.0, -13.5], [-20.0, -3.0]].forEach(([x, z]) => {
      box(x, 4.35, z, 1.35, 0.14, 2.6, 'wood', { collide: false, castShadow: true });
      for (let i = -1; i <= 1; i++) {
        box(-20.64, 4.85, z + i * 1.0, 0.07, 0.85, 0.07, 'metal', { collide: false });
      }
      box(-20.64, 5.28, z, 0.07, 0.07, 2.4, 'metal', { collide: false });
    });

    // 走廊两侧低层窗：让 4 m 高的墙本身就读成建筑立面
    [-18, -10, -2, 6].forEach((z) => {
      windowRow(19.54, z, 2.9, 1);
      windowRow(-19.54, z, 2.9, -1);
    });
    // 窗上雨棚
    [[19.8, -10], [19.8, 6], [-19.8, -10], [-19.8, 6]].forEach(([x, z]) => {
      box(x, 3.62, z, 0.85, 0.1, 1.6, 'fabric', { collide: false, color: 0x4a5a5c, castShadow: true });
      box(x + (x > 0 ? 0.36 : -0.36), 3.3, z - 0.75, 0.06, 0.5, 0.06, 'metal', { collide: false });
      box(x + (x > 0 ? 0.36 : -0.36), 3.3, z + 0.75, 0.06, 0.5, 0.06, 'metal', { collide: false });
    });

    // 中路两侧楼房 + 蓝色双门 + 背景塔楼穹顶
    [
      [9.2, -19, 3.0, 8, 7.0, -1], [9.2, -11, 3.0, 8, 8.6, -1], [9.2, -3, 3.0, 8, 6.2, -1],
      [-9.2, -19, 3.0, 8, 7.4, 1], [-9.2, -11, 3.0, 8, 8.2, 1], [-9.2, -3, 3.0, 8, 6.4, 1]
    ].forEach(([cx, cz, w, d, h, s]) => {
      box(cx, 4 + h / 2, cz, w, h, d, 'plaster', facade);
      box(cx, 4 + h + 0.18, cz, w + 0.35, 0.36, d + 0.35, 'concrete', { collide: false });
      for (let z = cz - d / 2 + 1.6; z < cz + d / 2 - 1; z += 2.6) {
        windowRow(cx - s * 1.56, z, 5.1, s);
        if (h > 7.5) windowRow(cx - s * 1.56, z, 6.9, s);
      }
    });
    // 中门蓝色双开木门（半开，能看见门板）
    for (const sx of [-1, 1]) {
      box(sx * 4.0, 1.55, 0, 0.22, 3.2, 0.28, 'wood', { collide: false, color: 0x2f5d78 });
    }
    {
      const doors = [];
      for (const sx of [-1, 1]) {
        const g = new THREE.BoxGeometry(2.4, 2.7, 0.09);
        g.rotateY(sx * 1.05);
        g.translate(sx * 3.4, 1.4, 1.04);
        doors.push(g);
        const inset = new THREE.BoxGeometry(1.9, 2.2, 0.03);
        inset.rotateY(sx * 1.05);
        inset.translate(sx * 3.4, 1.4, 1.09);
        doors.push(inset);
      }
      root.add(new THREE.Mesh(mergeGeos(doors), new THREE.MeshStandardMaterial({
        color: 0x4f8fae, roughness: 0.68, metalness: 0.05
      })));
    }
    box(0, 3.14, 0, 8.4, 0.3, 0.3, 'wood', { collide: false, color: 0x2f5d78 });
    // 中路低层窗 + 雨棚
    [-18, -10, -2, 6].forEach((z) => {
      windowRow(6.46, z, 2.9, -1);
      windowRow(-6.46, z, 2.9, 1);
    });
    [[6.15, -10], [6.15, 6], [-6.15, -10], [-6.15, 6]].forEach(([x, z]) => {
      box(x, 3.62, z, 0.8, 0.1, 1.5, 'fabric', { collide: false, color: 0x4a5a5c });
    });
    // 中路尽头塔楼 + 蓝砖穹顶（落到地面，不悬浮）
    box(0, 5.0, 30.5, 4.4, 10, 4.4, 'plaster', { collide: false });
    box(0, 10.1, 30.5, 4.8, 0.3, 4.8, 'concrete', { collide: false });
    {
      const dg = [];
      const drum = new THREE.CylinderGeometry(2.25, 2.35, 1.3, 16);
      drum.translate(0, 10.75, 30.5);
      dg.push(drum);
      const cap = new THREE.SphereGeometry(2.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.translate(0, 11.4, 30.5);
      dg.push(cap);
      root.add(new THREE.Mesh(mergeGeos(dg), new THREE.MeshStandardMaterial({
        map: domeTexture(), roughness: 0.45, metalness: 0.15
      })));
      const fin = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 1.1, 8),
        material('wood', { color: 0xc9a25a, roughness: 0.35 })
      );
      fin.position.set(0, 13.5, 30.5);
      root.add(fin);
    }

    // A / B 外侧低墙后的第二排楼房（让走廊两侧都是建筑）
    const outBlocks = [
      [34.7, -16, 2.6, 9, 6.4, 1],
      [34.7, -5, 2.6, 9, 8.2, 1],
      [34.7, 5, 2.6, 7, 5.8, 1],
      [-34.7, -16, 2.6, 9, 6.0, -1],
      [-34.7, -5, 2.6, 9, 7.8, -1],
      [-34.7, 5, 2.6, 7, 5.6, -1]
    ];
    outBlocks.forEach(([cx, cz, w, d, h, s]) => {
      box(cx, 2.4 + h / 2, cz, w, h, d, 'plaster', facade);
      box(cx, 2.4 + h + 0.18, cz, w + 0.35, 0.36, d + 0.35, 'concrete', { collide: false });
      for (let z = cz - d / 2 + 1.6; z < cz + d / 2 - 1; z += 2.8) {
        windowRow(cx - s * 1.36, z, 3.8, s);
        if (h > 6.8) windowRow(cx - s * 1.36, z, 5.6, s);
      }
    });

    // A / B 点后方旅店立面
    [[26, 31.2, 14, 3.2, 9.2, 1], [-26, 31.2, 14, 3.2, 8.6, -1]].forEach(([cx, cz, w, d, h, s]) => {
      box(cx, 4 + h / 2, cz, w, h, d, 'plaster', facade);
      box(cx, 4 + h + 0.2, cz, w + 0.4, 0.4, d + 0.4, 'concrete', { collide: false });
      for (let x = cx - w / 2 + 2; x < cx + w / 2 - 1; x += 3.0) {
        // 旅店正立面：混凝土窗框 + 窗台 + 蓝色百叶，避免整排纯黑洞
        // A/B 两栋都在地图北端，朝南（-Z）才是玩家能看到的一面
        for (const [wy, hasShutter] of [[6.2, true], [8.4, false]]) {
          box(x, wy, cz - 1.60, 1.16, 1.54, 0.05, 'concrete', { collide: false, tag: 'window' });
          box(x, wy, cz - 1.66, 0.84, 1.22, 0.03, 'metal', Object.assign({ collide: false, tag: 'window' }, windowDark));
          box(x, wy - 0.72, cz - 1.7, 1.1, 0.1, 0.2, 'concrete', { collide: false, tag: 'window' });
          if (hasShutter) {
            box(x - 0.64, wy, cz - 1.68, 0.42, 1.3, 0.05, 'wood', Object.assign({ collide: false, tag: 'window' }, shutter));
            box(x + 0.64, wy, cz - 1.68, 0.42, 1.3, 0.05, 'wood', Object.assign({ collide: false, tag: 'window' }, shutter));
          }
        }
      }
    });

    // 楼顶水塔 / 空调外机
    const fanGeos = [];
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      const z = -20 + i * 3.2;
      box(19.7 * side, 4.55, z, 0.55, 0.52, 0.9, 'metal', { collide: false });
      const fan = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 12);
      fan.rotateZ(Math.PI / 2);
      fan.translate(side * 19.99, 4.55, z);
      fanGeos.push(fan);
    }
    root.add(new THREE.Mesh(mergeGeos(fanGeos), material('metal', { color: 0x1e2220, roughness: 0.6 })));
    // 跨 A 大的电缆
    const cableGeos = [];
    [-12, -4, 3].forEach((z) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(19, 4.9, z),
        new THREE.Vector3(24, 4.55, z + 0.3),
        new THREE.Vector3(30, 4.7, z - 0.2),
        new THREE.Vector3(34, 4.95, z)
      ]);
      cableGeos.push(new THREE.TubeGeometry(curve, 16, 0.018, 5, false));
    });
    if (cableGeos.length) {
      const cableMat = new THREE.MeshBasicMaterial({ color: 0x1b1a18 });
      root.add(new THREE.Mesh(mergeGeos(cableGeos), cableMat));
    }

    // 拱门贴图：B 洞两处
    const archMat = new THREE.MeshBasicMaterial({ map: archTexture() });
    const archGeos = [];
    [[-19.54, -21, -Math.PI / 2], [-19.54, -11, -Math.PI / 2]].forEach(([x, z, ry]) => {
      const p = new THREE.PlaneGeometry(2.4, 3.5);
      p.rotateY(ry);
      p.translate(x, 1.75, z);
      archGeos.push(p);
    });
    root.add(new THREE.Mesh(mergeGeos(archGeos), archMat));

    // 棕榈树
    const trunkGeos = [], leafGeos = [];
    [[34, 28], [-34, 28], [12, 30.5], [-12, 30.5], [34, -25], [-34, -25]].forEach(([px, pz], idx) => {
      const h = 4.6 + (idx % 3) * 0.5;
      const trunk = new THREE.CylinderGeometry(0.13, 0.24, h, 7);
      trunk.translate(px, h / 2, pz);
      trunkGeos.push(trunk);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        const leaf = new THREE.ConeGeometry(0.34, 2.6, 4);
        leaf.rotateZ(Math.PI / 2 + 0.22);
        leaf.scale(1, 1, 0.55);
        leaf.rotateY(a);
        leaf.translate(px + Math.cos(a) * 1.25, h + 0.15, pz - Math.sin(a) * 1.25);
        leafGeos.push(leaf);
      }
    });
    root.add(new THREE.Mesh(mergeGeos(trunkGeos), material('wood', { color: 0x6b4a2a })));
    root.add(new THREE.Mesh(mergeGeos(leafGeos), new THREE.MeshStandardMaterial({
      color: 0x3f6b3a, roughness: 0.82, side: THREE.DoubleSide
    })));

    // 地面道路标线：A 大 / B 洞 / 中路
    for (let i = 0; i < 6; i++) {
      box(25.5, 0.025, -20 + i * 5, 0.13, 0.02, 3.0, 'concrete', { color: 0xded6c2, collide: false });
      box(-25.5, 0.025, -20 + i * 5, 0.13, 0.02, 3.0, 'concrete', { color: 0xded6c2, collide: false });
    }
    for (let i = 0; i < 4; i++) {
      box(0, 0.025, -22 + i * 5, 0.13, 0.02, 3.0, 'concrete', { color: 0xd7cba8, collide: false });
    }

    // 墙顶压顶：A 大 / B 洞内侧长墙
    box(19, 4.12, -8, 1.25, 0.24, 32, 'concrete', { collide: false, tag: 'trim' });
    box(-19, 4.12, -8, 1.25, 0.24, 32, 'concrete', { collide: false, tag: 'trim' });
    box(15, 4.12, 17, 1.25, 0.24, 18, 'concrete', { collide: false, tag: 'trim' });
    box(-15, 4.12, 17, 1.25, 0.24, 18, 'concrete', { collide: false, tag: 'trim' });
  }

  // 外立面细节是后加的，单独合批一次
  if (batches.size) {
    const extraGroup = new THREE.Group();
    extraGroup.name = 'dressing';
    flushBatches(extraGroup);
    root.add(extraGroup);
  }

  return {
    root,
    world,
    placed,
    sites,
    spawns: {
      player: { x: 0, y: 0, z: -28, yaw: 0 },
      bots: [
        { x: 0, z: 26, yaw: Math.PI },
        { x: 8, z: 24, yaw: Math.PI },
        { x: -8, z: 24, yaw: Math.PI },
        { x: 27, z: 16, yaw: Math.PI },
        { x: -27, z: 16, yaw: Math.PI }
      ]
    },
    buyZone: { minX: -10, maxX: 10, minZ: -31, maxZ: -22 },
    bounds: { minX: -36, maxX: 36, minZ: -32, maxZ: 32 },
    waypoints: [
      { x: 0, z: 24 }, { x: 12, z: 24 }, { x: 26, z: 20 }, { x: 27, z: 4 },
      { x: 20, z: -8 }, { x: 6, z: -6 }, { x: 0, z: 4 }, { x: -6, z: 12 },
      { x: -20, z: 14 }, { x: -26, z: 20 }, { x: -27, z: 4 }, { x: -20, z: -8 },
      { x: -6, z: -18 }, { x: 0, z: -22 }
    ],
    callouts: {
      tSpawn: { x: 0, z: -27 },
      ctSpawn: { x: 0, z: 26 },
      mid: { x: 0, z: 0 },
      aLong: { x: 26, z: -8 },
      aSite: { x: 26, z: 18 },
      bTunnel: { x: -26, z: -8 },
      bSite: { x: -26, z: 18 }
    }
  };
}
