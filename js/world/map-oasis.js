// 第二张地图：OASIS / 绿洲。
// 布局参考 Dust2/Mirage 的三角关系（A 长、B 公寓、中路窗口），
// 几何、材质、贴图全部为项目原创，不复用 Valve 地图资产。
// 设计评分与“为什么放”见 docs/MAP-DESIGN-PLAYBOOK.md。
import * as THREE from '../../vendor/three.module.js';
import { World } from './collision.js';
import { material, flat } from './textures.js';
import { scaleBoxUV, mergeGeos } from './geo-utils.js';

const TILE = 2.6;
// 门洞净高：站姿 1.8 m + 起跳 0.8 m = 2.6 m，留 5 cm 余量。
const DOOR_H = 2.65;
const DOOR_TRIM = 0x6b4a2f;

export function buildOasis(root, opts) {
  opts = opts || {};
  const world = new World();
  const placed = [];
  const batches = new Map();
  const palmWood = [];
  const palmLeaf = [];
  let seq = 0;

  function box(cx, cy, cz, w, h, d, kind, o) {
    o = o || {};
    const id = seq++;
    const mat = material(kind, {
      repeat: o.repeat,
      color: o.color,
      roughness: o.roughness,
      metalness: o.metalness
    });
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(g, w, h, d, TILE);
    g.translate(cx, cy, cz);
    let b = batches.get(mat);
    if (!b) {
      b = { mat, geos: [] };
      batches.set(mat, b);
    }
    b.geos.push(g);
    placed.push({
      id, x: cx, y: cy, z: cz, w, h, d, kind,
      tag: o.tag || '', collide: o.collide !== false
    });
    if (o.collide !== false) {
      world.add({
        minX: cx - w / 2, maxX: cx + w / 2,
        minY: cy - h / 2, maxY: cy + h / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
        tag: o.tag || ''
      });
    }
  }

  function wall(x, z, w, d, h, kind, o) {
    box(x, h / 2, z, w, h, d, kind || 'sandstone', Object.assign({ tag: 'wall' }, o));
  }

  function cover(x, z, w, d, kind, h, o) {
    const hh = h || 1.36;
    box(x, hh / 2, z, w, hh, d, kind || 'wood', Object.assign({ tag: 'cover' }, o));
  }

  // 门框只做视觉收边，不参与碰撞：让 2.65 m 的净高在砂岩墙上可读。
  function doorTrimX(cx, cz, openW, d) {
    const t = 0.16;
    const depth = d + 0.1;
    box(cx - openW / 2 + t / 2, DOOR_H / 2, cz, t, DOOR_H, depth, 'wood', { color: DOOR_TRIM, collide: false, tag: 'prop' });
    box(cx + openW / 2 - t / 2, DOOR_H / 2, cz, t, DOOR_H, depth, 'wood', { color: DOOR_TRIM, collide: false, tag: 'prop' });
    box(cx, DOOR_H + t / 2, cz, openW, t, depth, 'wood', { color: DOOR_TRIM, collide: false, tag: 'prop' });
  }

  function doorTrimZ(cx, cz, openD, w) {
    const t = 0.16;
    const depth = w + 0.1;
    box(cx, DOOR_H / 2, cz - openD / 2 + t / 2, depth, DOOR_H, t, 'wood', { color: DOOR_TRIM, collide: false, tag: 'prop' });
    box(cx, DOOR_H / 2, cz + openD / 2 - t / 2, depth, DOOR_H, t, 'wood', { color: DOOR_TRIM, collide: false, tag: 'prop' });
    box(cx, DOOR_H + t / 2, cz, depth, t, openD, 'wood', { color: DOOR_TRIM, collide: false, tag: 'prop' });
  }

  // 沿 x 方向的门洞/拱门：左右墙段 + 上方过梁
  function gateX(cx, cz, totalW, openW, h, d, kind, o) {
    o = Object.assign({ tag: 'wall' }, o);
    const side = (totalW - openW) / 2;
    if (side > 0.01) {
      box(cx - openW / 2 - side / 2, h / 2, cz, side, h, d, kind, o);
      box(cx + openW / 2 + side / 2, h / 2, cz, side, h, d, kind, o);
    }
    const lintel = h - DOOR_H;
    if (lintel > 0.01) box(cx, DOOR_H + lintel / 2, cz, openW, lintel, d, kind, o);
    doorTrimX(cx, cz, openW, d);
  }

  // 沿 z 方向的门洞：前后墙段 + 上方过梁
  function gateZ(cx, cz, totalD, openD, h, w, kind, o) {
    o = Object.assign({ tag: 'wall' }, o);
    const side = (totalD - openD) / 2;
    if (side > 0.01) {
      box(cx, h / 2, cz - openD / 2 - side / 2, w, h, side, kind, o);
      box(cx, h / 2, cz + openD / 2 + side / 2, w, h, side, kind, o);
    }
    const lintel = h - DOOR_H;
    if (lintel > 0.01) box(cx, DOOR_H + lintel / 2, cz, w, lintel, openD, kind, o);
    doorTrimZ(cx, cz, openD, w);
  }

  function palm(x, z) {
    const h = 4.2;
    const trunk = new THREE.CylinderGeometry(0.16, 0.28, h, 6);
    trunk.translate(x, h / 2, z);
    palmWood.push(trunk);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const leaf = new THREE.ConeGeometry(0.5, 2.6, 4);
      leaf.rotateZ(Math.PI / 2.8);
      leaf.rotateY(a);
      leaf.translate(x + Math.cos(a) * 1.1, h + 0.4, z + Math.sin(a) * 1.1);
      palmLeaf.push(leaf);
    }
  }

  function awning(x, z, w, d, color, y) {
    const yy = y || 3.3;
    box(x, yy, z, w, 0.1, d, 'fabric', { color, collide: false, tag: 'prop' });
    // 前沿垂布：让顶棚从仰视看是“布”而不是一根悬空横梁。
    if (w >= d) {
      box(x, yy - 0.16, z - d / 2 + 0.04, w, 0.32, 0.07, 'fabric', { color, collide: false, tag: 'prop' });
    } else {
      box(x - w / 2 + 0.04, yy - 0.16, z, 0.07, 0.32, d, 'fabric', { color, collide: false, tag: 'prop' });
    }
  }

  function banner(x, y, z, w, h, d, color) {
    box(x, y, z, w, h, d, 'fabric', { color, collide: false, tag: 'prop' });
  }

  // 城门上方的石制挑檐：贴着墙面出挑 0.4 m，比悬空布棚更符合建筑比例。
  function cornice(x, z, w) {
    box(x, 3.42, z, w, 0.3, 0.55, 'sandstone', { collide: false, tag: 'prop' });
  }

  function lamp(x, z) {
    box(x, 2.2, z, 0.14, 4.4, 0.14, 'metal', { collide: false, tag: 'prop' });
    box(x, 4.35, z, 0.5, 0.18, 0.5, 'metal', { color: 0x2b2f2c, collide: false, tag: 'prop' });
    box(x, 4.2, z, 0.32, 0.22, 0.32, 'fabric', { color: 0xffd38a, collide: false, tag: 'prop' });
  }

  function stall(x, z, w, d, color) {
    cover(x, z, w, d, 'wood', 1.05);
    box(x, 2.35, z, w + 0.55, 0.12, d + 0.55, 'fabric', { color, collide: false, tag: 'prop' });
    const px = Math.max(0.1, w / 2 - 0.12);
    const pz = Math.max(0.1, d / 2 - 0.12);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(x + sx * px, 1.2, z + sz * pz, 0.1, 2.4, 0.1, 'metal', { collide: false, tag: 'prop' });
    }
  }

  function crate(x, z, s, kind) {
    cover(x, z, s, s, kind || 'wood', 1.36);
    box(x, 1.48, z, s * 0.86, 0.24, s * 0.86, kind || 'wood', { tag: 'cover' });
  }

  function planter(x, z, w, d) {
    cover(x, z, w, d, 'brick', 0.8);
    const leaf = new THREE.ConeGeometry(0.55, 1.4, 5);
    leaf.translate(x, 1.45, z);
    palmLeaf.push(leaf);
  }

  function minaret(x, z) {
    box(x, 5, z, 2.4, 10, 2.4, 'plaster', { tag: 'building' });
    box(x, 10.3, z, 3.0, 0.6, 3.0, 'sandstone', { tag: 'building' });
    box(x, 11.2, z, 1.2, 1.2, 1.2, 'fabric', { color: 0xb34a2f, collide: false, tag: 'prop' });
  }

  function windowFrame(x, y, z, w, h, d) {
    box(x, y, z, w, h, d, 'metal', { color: 0x192126, collide: false, tag: 'prop' });
    box(x, y + h / 2 + 0.09, z, w + 0.24, 0.16, d + 0.24, 'wood', { collide: false, tag: 'prop' });
    box(x, y - h / 2 - 0.09, z, w + 0.24, 0.16, d + 0.24, 'wood', { collide: false, tag: 'prop' });
  }

  function siteMarker(x, z, letter, color) {
    if (typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, 192, 192);
    g.beginPath();
    g.arc(96, 96, 82, 0, Math.PI * 2);
    g.fillStyle = 'rgba(20,18,14,.55)';
    g.fill();
    g.lineWidth = 9;
    g.strokeStyle = color;
    g.stroke();
    g.fillStyle = color;
    g.font = '900 104px ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 96, 102);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 5.2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.13, z);
    root.add(mesh);
  }

  /* ---------------- 地面 / 边界 / 铺装 ---------------- */
  box(0, -0.1, 0, 92, 0.2, 84, 'sandstone', { tag: 'ground', repeat: 16 });
  box(0, 0.02, -6, 12, 0.04, 60, 'concrete', { collide: false, repeat: 10 });
  box(30, 0.02, -6, 30, 0.04, 52, 'concrete', { collide: false, repeat: 12 });
  box(-30, 0.02, -6, 30, 0.04, 52, 'concrete', { collide: false, repeat: 12 });
  box(30, 0.02, 26, 24, 0.04, 16, 'sandstone', { collide: false, repeat: 8 });
  box(-30, 0.02, 26, 24, 0.04, 16, 'sandstone', { collide: false, repeat: 8 });
  box(0, 0.02, 37, 18, 0.04, 10, 'concrete', { collide: false, repeat: 6 });
  wall(0, -42.5, 93, 1.2, 7.5, 'plaster', { tag: 'bound' });
  wall(0, 42.5, 93, 1.2, 7.5, 'plaster', { tag: 'bound' });
  wall(-46.5, 0, 1.2, 85, 7.5, 'plaster', { tag: 'bound' });
  wall(46.5, 0, 1.2, 85, 7.5, 'plaster', { tag: 'bound' });

  /* ---------------- T 出生区 ---------------- */
  box(-16, 3, -32, 8, 6, 8, 'plaster', { tag: 'building' });
  box(16, 3, -32, 8, 6, 8, 'plaster', { tag: 'building' });
  box(-16, 6.2, -32, 8.6, 0.3, 8.6, 'concrete', { collide: false });
  box(16, 6.2, -32, 8.6, 0.3, 8.6, 'concrete', { collide: false });
  box(-16, 4.6, -27.9, 5.4, 0.14, 1.2, 'fabric', { color: 0xb34a2f, collide: false, tag: 'prop' });
  box(16, 4.6, -27.9, 5.4, 0.14, 1.2, 'fabric', { color: 0x3d6f8f, collide: false, tag: 'prop' });
  gateX(0, -27, 18, 6.4, 4.4, 1.0, 'sandstone');
  cover(-10, -29, 1.6, 1.2, 'wood');
  cover(10, -29, 1.6, 1.2, 'wood');
  cover(0, -24, 1.6, 1.0, 'brick', 0.72);
  lamp(12, -27);
  lamp(-12, -27);

  /* ---------------- A 长 ---------------- */
  wall(15, -2, 1.2, 44, 6, 'sandstone');
  wall(45, -2, 1.2, 44, 6, 'sandstone');
  gateX(30, -8, 30, 5.2, 6, 1.2, 'sandstone');
  // A 长东侧小店：三面墙 + 内部掩体，给进攻方一个可清/可退的侧室
  wall(41, -24, 6, 1.2, 4.5, 'plaster');
  wall(38, -18, 1.2, 12, 4.5, 'plaster');
  wall(44, -18, 1.2, 12, 4.5, 'plaster');
  awning(41, -12.2, 6.6, 1.4, 0xa46a3f, 4.1);
  cover(41, -18, 1.8, 1.2, 'wood');
  cover(24, -18, 2.0, 1.2, 'wood');
  crate(34, -14, 1.5, 'wood');
  cover(26, -2, 1.8, 1.0, 'brick', 0.72);
  cover(36, 2, 1.2, 1.2, 'metal', 1.72);
  cover(28, 10, 2.2, 1.2, 'wood');
  cover(34, 14, 1.4, 1.2, 'fabric', 0.86);
  banner(25, 5.4, 20.7, 2.0, 2.2, 0.08, 0xb34a2f);
  banner(35, 5.4, 20.7, 2.0, 2.2, 0.08, 0xe0a23c);

  /* ---------------- A 点：宫殿庭院 ---------------- */
  gateX(30, 20, 20, 4.6, 8, 1.2, 'sandstone');
  gateX(30, 34, 20, 3.4, 8, 1.2, 'sandstone');
  wall(20, 27, 1.2, 14, 8, 'sandstone');
  gateZ(40, 27, 14, 2.8, 8, 1.2, 'sandstone');
  box(30, 0.15, 31, 10, 0.3, 4, 'sandstone', { tag: 'site' });
  box(24, 2.5, 30, 1.2, 5, 1.2, 'sandstone', { tag: 'building' });
  box(36, 2.5, 30, 1.2, 5, 1.2, 'sandstone', { tag: 'building' });
  cover(25, 24, 1.6, 1.6, 'wood');
  cover(35, 24, 1.6, 1.6, 'wood');
  cover(27, 32, 1.4, 1.2, 'metal', 1.6);
  cover(33, 32, 1.4, 1.2, 'metal', 1.6);
  cornice(30, 19.2, 8);
  awning(24, 22.6, 4, 1.4, 0xe0a23c, 3.3);
  minaret(43, 30);
  siteMarker(30, 26, 'A', '#f0a04b');

  /* ---------------- B 公寓 / B 点：市场 ---------------- */
  wall(-15, -2, 1.2, 44, 6, 'sandstone');
  wall(-45, -2, 1.2, 44, 6, 'sandstone');
  gateX(-30, -8, 30, 5.2, 6, 1.2, 'sandstone');
  box(-30, 2.5, -16, 14, 5, 10, 'plaster', { tag: 'building' });
  box(-30, 2.5, -2, 14, 5, 8, 'plaster', { tag: 'building' });
  box(-30, 3.6, -8.5, 14, 1.6, 3.0, 'plaster', { tag: 'building' });
  box(-30, 5.2, -8.5, 14.6, 0.3, 3.4, 'concrete', { collide: false });
  box(-22.9, 2.4, -16, 0.1, 1.2, 2.4, 'metal', { color: 0x192126, collide: false, tag: 'prop' });
  box(-22.9, 2.4, -2, 0.1, 1.2, 2.4, 'metal', { color: 0x192126, collide: false, tag: 'prop' });
  box(-21.9, 3.4, -9, 1.2, 0.22, 5, 'wood', { tag: 'building' });
  box(-21.9, 4.1, -9, 0.08, 1.4, 5, 'metal', { collide: false, tag: 'prop' });
  gateX(-30, 20, 20, 4.6, 8, 1.2, 'sandstone');
  gateX(-30, 34, 20, 3.4, 8, 1.2, 'sandstone');
  wall(-40, 27, 1.2, 14, 8, 'sandstone');
  gateZ(-20, 27, 14, 2.8, 8, 1.2, 'sandstone');
  box(-30, 0.15, 32, 7, 0.3, 3, 'sandstone', { tag: 'site' });
  stall(-34, 23, 2.4, 1.2, 0x3d6f8f);
  stall(-26, 23, 2.4, 1.2, 0xb34a2f);
  stall(-34, 28, 2.4, 1.2, 0xe0a23c);
  stall(-26, 28, 2.4, 1.2, 0x3d6f8f);
  cover(-36, 24, 1.4, 1.4, 'wood');
  cover(-24, 30, 1.4, 1.4, 'metal', 1.6);
  cover(-26.8, 18.8, 1.6, 0.8, 'brick', 0.72);
  cornice(-30, 19.2, 8);
  minaret(-43, 30);
  siteMarker(-30, 26, 'B', '#6fb3d9');

  /* ---------------- 中路 / 窗口 / 连接 ---------------- */
  box(9, 3, 6, 6, 6, 8, 'plaster', { tag: 'building' });
  box(9, 6.2, 6, 6.6, 0.3, 8.6, 'concrete', { collide: false });
  box(-9, 3, -6, 6, 6, 8, 'plaster', { tag: 'building' });
  box(-9, 6.2, -6, 6.6, 0.3, 8.6, 'concrete', { collide: false });
  windowFrame(5.92, 2.2, 6, 0.1, 1.2, 3.2);
  windowFrame(-5.92, 2.2, -6, 0.1, 1.2, 3.2);
  awning(6.2, 6, 1.4, 6.6, 0x5b93b5, 4.2);
  cover(26.8, 18.8, 1.6, 0.8, 'brick', 0.72);
  cover(3, -12, 1.6, 1.2, 'fabric', 0.86);
  cover(-3, 12, 1.6, 1.2, 'fabric', 0.86);
  planter(0, 0, 2.0, 1.4);
  cover(10, 34, 1.6, 1.2, 'wood');
  cover(-10, 34, 1.6, 1.2, 'wood');
  cover(20, 34, 1.4, 1.2, 'brick', 0.72);
  cover(-20, 34, 1.4, 1.2, 'brick', 0.72);
  gateX(0, 32, 14, 5.0, 4.2, 1.0, 'plaster');
  cover(4, 37, 1.4, 1.0, 'wood');
  cover(-4, 37, 1.4, 1.0, 'wood');
  lamp(12, 30);
  lamp(-12, 30);

  /* ---------------- 装饰 ---------------- */
  palm(40, -24);
  palm(-40, -24);
  palm(40, 4);
  palm(-40, 4);
  palm(44, 37);
  palm(-44, 37);
  palm(36, 18);
  palm(-36, 18);
  box(30, 0.13, 26, 3.2, 0.02, 3.2, 'fabric', { color: 0xe06a35, collide: false, tag: 'prop' });
  box(-30, 0.13, 26, 3.2, 0.02, 3.2, 'fabric', { color: 0x5c9bc0, collide: false, tag: 'prop' });

  /* ---------------- 合并静态批次 ---------------- */
  for (const b of batches.values()) {
    const mesh = new THREE.Mesh(mergeGeos(b.geos), b.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (palmWood.length) {
    const trunk = new THREE.Mesh(mergeGeos(palmWood), material('wood', { repeat: 1 }));
    trunk.castShadow = true;
    root.add(trunk);
  }
  if (palmLeaf.length) {
    const leaf = new THREE.Mesh(mergeGeos(palmLeaf), flat(0x4f7a4a, { roughness: 0.9 }));
    leaf.castShadow = true;
    root.add(leaf);
  }

  /* ---------------- 出生点 / 路线 / 包点 ---------------- */
  const baseSpawns = {
    player: { x: 0, y: 0, z: -36, yaw: 0 },
    playerCT: { x: 0, y: 0, z: 38, yaw: Math.PI },
    allies: [
      { x: -4, z: -34, yaw: 0, waypoint: 1 },
      { x: 4, z: -34, yaw: 0, waypoint: 1 },
      { x: -8, z: -31, yaw: 0, waypoint: 2 },
      { x: 8, z: -31, yaw: 0, waypoint: 3 }
    ],
    ctAllies: [
      { x: 4, z: 37, yaw: Math.PI, waypoint: 36 },
      { x: -4, z: 37, yaw: Math.PI, waypoint: 36 },
      { x: 18, z: 16, yaw: Math.PI, waypoint: 42 },
      { x: -18, z: 16, yaw: Math.PI, waypoint: 40 }
    ],
    bots: [
      { x: 0, z: 40, yaw: Math.PI, waypoint: 36 },
      { x: 5, z: 40, yaw: Math.PI, waypoint: 36 },
      { x: -5, z: 40, yaw: Math.PI, waypoint: 36 },
      { x: 22, z: 16, yaw: Math.PI, waypoint: 42 },
      { x: -22, z: 16, yaw: Math.PI, waypoint: 40 }
    ],
    tBots: [
      { x: -4, z: -34, yaw: 0, waypoint: 1 },
      { x: 4, z: -34, yaw: 0, waypoint: 1 },
      { x: -8, z: -31, yaw: 0, waypoint: 2 },
      { x: 8, z: -31, yaw: 0, waypoint: 3 },
      { x: 0, z: -33, yaw: 0, waypoint: 0 }
    ]
  };
  const spawns = {
    player: { ...baseSpawns.player },
    playerCT: { ...baseSpawns.playerCT },
    allies: baseSpawns.allies.map((s) => ({ ...s })),
    ctAllies: baseSpawns.ctAllies.map((s) => ({ ...s })),
    bots: baseSpawns.bots.map((s) => ({ ...s })),
    tBots: baseSpawns.tBots.map((s) => ({ ...s }))
  };

  const waypoints = [
    { x: 0, z: -36 }, { x: 0, z: -31 }, { x: -6, z: -30 }, { x: 6, z: -30 },
    { x: -22, z: -26 }, { x: -30, z: -24 }, { x: 22, z: -26 }, { x: 30, z: -24 },
    { x: -22, z: -20 }, { x: 30, z: -20 }, { x: -22, z: -14 }, { x: 30, z: -14 },
    { x: -30, z: -8 }, { x: 30, z: -8 }, { x: -22, z: 0 }, { x: 30, z: 0 },
    { x: -30, z: 8 }, { x: 30, z: 8 }, { x: -30, z: 14 }, { x: 30, z: 14 },
    { x: -30, z: 18 }, { x: 30, z: 18 }, { x: -30, z: 24 }, { x: 30, z: 24 },
    { x: -30, z: 30 }, { x: 30, z: 27 }, { x: -30, z: 36 }, { x: 30, z: 36 },
    { x: 0, z: -22 }, { x: 0, z: -14 }, { x: 0, z: -6 }, { x: 0, z: 2 },
    { x: 0, z: 10 }, { x: 0, z: 18 }, { x: 0, z: 26 }, { x: 0, z: 30 },
    { x: 0, z: 38 }, { x: -8, z: -24 }, { x: 8, z: -24 },
    { x: -12, z: 12 }, { x: -20, z: 16 }, { x: 12, z: 12 }, { x: 20, z: 16 },
    { x: -34, z: 24 }, { x: 32, z: 22 }, { x: -24, z: 26 }, { x: 36, z: 26 },
    { x: -12, z: 34 }, { x: 12, z: 34 }, { x: -34, z: 36 }, { x: 34, z: 36 },
    { x: -10, z: -28 }, { x: 10, z: -28 }, { x: -40, z: 6 }, { x: 38, z: -2 },
    { x: -30, z: 20 }, { x: 30, z: 20 }, { x: -30, z: 26 }, { x: 30, z: 26 },
    { x: -18, z: 26 }, { x: 18, z: 26 }, { x: -36, z: 30 }, { x: 38, z: 26 }
  ];

  const sites = {
    A: { x: 30, z: 26, r: 6.2 },
    B: { x: -30, z: 26, r: 6.2 }
  };
  const buyZone = {
    minX: spawns.player.x - 10, maxX: spawns.player.x + 10,
    minZ: spawns.player.z - 5.5, maxZ: spawns.player.z + 5.5
  };

  const callouts = {
    tSpawn: { x: 0, z: -36 },
    tGate: { x: 0, z: -27 },
    aLong: { x: 30, z: -12 },
    aChoke: { x: 30, z: -8 },
    aShop: { x: 41, z: -17 },
    aCross: { x: 30, z: 8 },
    aSite: { x: 30, z: 26 },
    aPalace: { x: 30, z: 31 },
    aBack: { x: 30, z: 34 },
    aShort: { x: 18, z: 18 },
    bLong: { x: -30, z: -12 },
    bChoke: { x: -30, z: -8 },
    bApts: { x: -30, z: -6 },
    bSite: { x: -30, z: 26 },
    bMarket: { x: -30, z: 31 },
    bBack: { x: -30, z: 34 },
    bShort: { x: -18, z: 18 },
    mid: { x: 0, z: 0 },
    window: { x: 6, z: 6 },
    ctSpawn: { x: 0, z: 38 },
    ctMid: { x: 0, z: 32 },
    aConnector: { x: 20, z: 34 },
    bConnector: { x: -20, z: 34 }
  };

  const stats = {
    placed: placed.length,
    covers: placed.filter((p) => p.tag === 'cover').length,
    buildings: placed.filter((p) => p.tag === 'building').length,
    props: placed.filter((p) => p.tag === 'prop').length,
    walls: placed.filter((p) => p.tag === 'wall').length,
    waypoints: waypoints.length,
    callouts: Object.keys(callouts).length
  };

  return {
    root,
    world,
    placed,
    baseCount: placed.length,
    edits: null,
    id: 'oasis',
    name: '绿洲',
    sites,
    spawns,
    buyZone,
    bounds: { minX: -47, maxX: 47, minZ: -43, maxZ: 43 },
    waypoints,
    stats,
    callouts
  };
}
