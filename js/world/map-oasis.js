// 第二张地图：OASIS / 绿洲。
// 布局参考 Dust2/Mirage 的三角关系（A 长、B 公寓、中路窗口），
// 几何、材质、贴图全部为项目原创，不复用 Valve 地图资产。
import * as THREE from '../../vendor/three.module.js';
import { World } from './collision.js';
import { material, flat } from './textures.js';
import { scaleBoxUV, mergeGeos } from './geo-utils.js';

const TILE = 2.6;

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

  /* ---------------- 地面 / 边界 ---------------- */
  box(0, -0.1, 0, 92, 0.2, 84, 'sandstone', { tag: 'ground', repeat: 16 });
  // 铺装：中路 / A 长 / B 公寓 / CT 连接，避免整张图是一块绿色底板
  box(0, 0.02, -10, 12, 0.04, 52, 'concrete', { collide: false, repeat: 10 });
  box(30, 0.02, -12, 14, 0.04, 28, 'concrete', { collide: false, repeat: 8 });
  box(-30, 0.02, -12, 14, 0.04, 28, 'concrete', { collide: false, repeat: 8 });
  box(0, 0.02, 20, 12, 0.04, 26, 'concrete', { collide: false, repeat: 8 });
  wall(0, -42.5, 93, 1.2, 7.5, 'plaster', { tag: 'bound' });
  wall(0, 42.5, 93, 1.2, 7.5, 'plaster', { tag: 'bound' });
  wall(-46.5, 0, 1.2, 85, 7.5, 'plaster', { tag: 'bound' });
  wall(46.5, 0, 1.2, 85, 7.5, 'plaster', { tag: 'bound' });

  /* ---------------- T / CT 出生区 ---------------- */
  box(-16, 3, -32, 8, 6, 8, 'plaster', { tag: 'building' });
  box(16, 3, -32, 8, 6, 8, 'plaster', { tag: 'building' });
  box(-16, 6.2, -32, 8.6, 0.3, 8.6, 'concrete', { collide: false });
  box(16, 6.2, -32, 8.6, 0.3, 8.6, 'concrete', { collide: false });

  /* ---------------- A 长 / A 点 ---------------- */
  wall(15, -12, 1.2, 28, 5.2, 'sandstone');
  wall(45, -12, 1.2, 28, 5.2, 'sandstone');
  box(30, 3.5, 32, 14, 7, 10, 'sandstone', { tag: 'building' });
  box(30, 7.1, 32, 14.6, 0.3, 10.6, 'concrete', { collide: false });
  box(30, 4.2, 26.9, 3.2, 1.5, 0.12, 'metal', { color: 0x2f3a40, collide: false });
  box(30, 5.3, 26.7, 5.2, 0.14, 1.5, 'fabric', { color: 0xb34a2f, collide: false });
  box(30, 0.04, 16, 8, 0.08, 8, 'sandstone', { tag: 'site', collide: false });
  box(30, 0.09, 16, 8, 0.02, 8, 'concrete', { collide: false });
  cover(22, -20, 2.0, 1.2, 'wood');
  cover(32, -18, 1.4, 1.4, 'metal', 1.6);
  cover(24, -8, 2.0, 1.2, 'fabric');
  cover(34, -4, 1.2, 2.0, 'wood');
  cover(20, 2, 1.4, 1.4, 'wood');
  cover(30, 8, 2.2, 1.2, 'wood');
  cover(38, 0, 1.2, 1.2, 'brick');
  cover(26, 20, 1.6, 1.6, 'wood');
  cover(34, 20, 1.4, 1.2, 'fabric');
  cover(30, 12, 1.2, 1.2, 'brick');

  /* ---------------- B 公寓 / B 点 ---------------- */
  wall(-15, -12, 1.2, 28, 5.2, 'sandstone');
  wall(-45, -12, 1.2, 28, 5.2, 'sandstone');
  box(-30, 2.5, -14, 14, 5, 10, 'plaster', { tag: 'building' });
  box(-30, 2.5, -1, 14, 5, 10, 'plaster', { tag: 'building' });
  box(-30, 3.6, -7.5, 14, 1.6, 3.0, 'plaster', { tag: 'building' });
  box(-30, 5.2, -7.5, 14.6, 0.3, 3.4, 'concrete', { collide: false });
  box(-30, 3.5, 32, 14, 7, 10, 'sandstone', { tag: 'building' });
  box(-30, 7.1, 32, 14.6, 0.3, 10.6, 'concrete', { collide: false });
  box(-30, 4.2, 26.9, 3.2, 1.5, 0.12, 'metal', { color: 0x2f3a40, collide: false });
  box(-30, 5.3, 26.7, 5.2, 0.14, 1.5, 'fabric', { color: 0x3d6f8f, collide: false });
  box(-30, 0.04, 16, 8, 0.08, 8, 'sandstone', { tag: 'site', collide: false });
  box(-30, 0.09, 16, 8, 0.02, 8, 'concrete', { collide: false });
  cover(-22, -20, 2.0, 1.2, 'wood');
  cover(-32, -18, 1.4, 1.4, 'metal', 1.6);
  cover(-24, -8, 2.0, 1.2, 'fabric');
  cover(-34, -4, 1.2, 2.0, 'wood');
  cover(-20, 2, 1.4, 1.4, 'wood');
  cover(-30, 8, 2.2, 1.2, 'wood');
  cover(-38, 0, 1.2, 1.2, 'brick');
  cover(-26, 20, 1.6, 1.6, 'wood');
  cover(-34, 20, 1.4, 1.2, 'fabric');
  cover(-30, 12, 1.2, 1.2, 'brick');

  /* ---------------- 中路 / 连接 ---------------- */
  box(9, 3, 6, 6, 6, 8, 'plaster', { tag: 'building' });
  box(9, 6.2, 6, 6.6, 0.3, 8.6, 'concrete', { collide: false });
  box(-9, 3, -6, 6, 6, 8, 'plaster', { tag: 'building' });
  box(-9, 6.2, -6, 6.6, 0.3, 8.6, 'concrete', { collide: false });
  box(9, 3.4, 6, 2.0, 1.3, 0.12, 'metal', { color: 0x2f3a40, collide: false });
  box(-9, 3.4, -6, 2.0, 1.3, 0.12, 'metal', { color: 0x2f3a40, collide: false });
  cover(3, -16, 1.6, 1.2, 'fabric');
  cover(-4, -10, 1.2, 1.2, 'wood');
  cover(4, -2, 1.4, 1.4, 'wood');
  cover(-5, 6, 1.2, 2.0, 'fabric');
  cover(5, 14, 1.4, 1.2, 'wood');
  cover(0, -30, 1.6, 1.2, 'wood');
  cover(4, 30, 1.6, 1.2, 'wood');

  /* ---------------- 装饰 ---------------- */
  palm(40, -24);
  palm(-40, -24);
  palm(40, 24);
  palm(-40, 24);
  palm(38, 6);
  palm(-38, 6);

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
    playerCT: { x: 0, y: 0, z: 36, yaw: Math.PI },
    allies: [
      { x: -4, z: -34, yaw: 0, waypoint: 1 },
      { x: 4, z: -34, yaw: 0, waypoint: 1 },
      { x: -8, z: -31, yaw: 0, waypoint: 4 },
      { x: 8, z: -31, yaw: 0, waypoint: 8 }
    ],
    ctAllies: [
      { x: 4, z: 34, yaw: Math.PI, waypoint: 19 },
      { x: -4, z: 34, yaw: Math.PI, waypoint: 24 },
      { x: 20, z: 30, yaw: Math.PI, waypoint: 17 },
      { x: -20, z: 30, yaw: Math.PI, waypoint: 22 }
    ],
    bots: [
      { x: 0, z: 38, yaw: Math.PI, waypoint: 19 },
      { x: 5, z: 40, yaw: Math.PI, waypoint: 19 },
      { x: -5, z: 40, yaw: Math.PI, waypoint: 24 },
      { x: 28, z: 24, yaw: Math.PI, waypoint: 17 },
      { x: -28, z: 24, yaw: Math.PI, waypoint: 22 }
    ],
    tBots: [
      { x: -4, z: -34, yaw: 0, waypoint: 1 },
      { x: 4, z: -34, yaw: 0, waypoint: 1 },
      { x: -8, z: -31, yaw: 0, waypoint: 4 },
      { x: 8, z: -31, yaw: 0, waypoint: 8 },
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
    { x: 0, z: -36 }, { x: 0, z: -31 }, { x: -10, z: -30 }, { x: -22, z: -27 },
    { x: -28, z: -25 }, { x: -30, z: -20 }, { x: -21, z: -12 }, { x: -21, z: -4 },
    { x: 10, z: -30 }, { x: 22, z: -27 }, { x: 26, z: -24 }, { x: 30, z: -16 },
    { x: 30, z: -12 }, { x: 30, z: -4 }, { x: 30, z: 2 }, { x: 30, z: 16 },
    { x: 0, z: -22 }, { x: 0, z: -12 }, { x: 0, z: -2 }, { x: 0, z: 8 },
    { x: 0, z: 20 }, { x: 0, z: 30 }, { x: 0, z: 36 },
    { x: -12, z: 26 }, { x: -22, z: 29 }, { x: -30, z: 24 }, { x: -30, z: 16 },
    { x: 12, z: 26 }, { x: 22, z: 29 }, { x: 30, z: 24 }, { x: 30, z: 16 },
    { x: 14, z: 6 }, { x: 20, z: 6 }, { x: 30, z: 2 },
    { x: -12, z: 6 }, { x: -20, z: 6 }, { x: -21, z: -2 },
    { x: -30, z: 16 }, { x: 30, z: 16 }
  ];

  const sites = {
    A: { x: 30, z: 16, r: 6.2 },
    B: { x: -30, z: 16, r: 6.2 }
  };
  const buyZone = {
    minX: spawns.player.x - 10, maxX: spawns.player.x + 10,
    minZ: spawns.player.z - 5.5, maxZ: spawns.player.z + 5.5
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
    callouts: {
      tSpawn: { x: 0, z: -36 },
      ctSpawn: { x: 0, z: 36 },
      mid: { x: 0, z: 0 },
      aLong: { x: 30, z: -12 },
      aSite: { x: 30, z: 16 },
      aPalace: { x: 30, z: 30 },
      bLong: { x: -30, z: -12 },
      bSite: { x: -30, z: 16 },
      bMarket: { x: -30, z: 30 },
      bApts: { x: -30, z: -6 },
      window: { x: 6, z: 6 },
      connector: { x: 0, z: 8 }
    }
  };
}
