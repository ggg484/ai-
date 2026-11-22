// 第三张地图：HARBOR / 港口。
// 主题：集装箱码头 —— 东侧是海与岸吊，西侧是仓库，中路是堆场。
// 几何、材质、配色全部为项目原创，不复制 Valve 资产。
// 设计依据：docs/MAP-DESIGN-PLAYBOOK.md 第 1–5 节；复盘见同文件第 10 节。
//
// 坐标系：X 向东，Z 向北，Y 向上；T 出生在南（z<0），CT 出生在北（z>0）。
// 尺度：96 × 92 m；玩家站高 1.8 m，眼睛 1.62 m（蹲 1.10 m）。
//
// 色板（冷蓝 / 铁锈 / 海雾）：建筑与箱体用低多边形纯色块，
// 只有地面保留程序化纹理撑密度；这样远看是冷色码头，近看有材质颗粒。
import * as THREE from '../../vendor/three.module.js';
import { World } from './collision.js';
import { material, flat } from './textures.js';
import { GeoBatch } from './geo-utils.js';

const TILE = 2.6;

// 门洞净高：站姿 1.8 + 起跳 0.8 = 2.60，留 5 cm。全图统一，避免「车库门」。
const DOOR_H = 2.65;

// 港口色板：与 SANDLINE（沙色）、OASIS（暖砂岩）明确区分。
// 规则：面积大的东西全部走冷灰（混凝土 / 钢），暖色只留给集装箱和少数警示件。
// 阴天海雾会把所有颜色往下压，所以饱和度统一降一档，避免阳光下"塑料感"。
const C = {
  ground: 0x8e9a9b,      // 码头混凝土
  brick: 0x7a6357,       // 仓库旧砖 / 抹面（降饱和，阴天不发亮）
  brickDark: 0x5b4e48,   // 背街深砖
  shed: 0x4c626a,        // A 棚冷蓝钢
  roof: 0x3b454b,        // 仓库屋顶 / 檐口
  steel: 0x323e44,       // 深钢（结构、门框背板）
  rust: 0x8b4f3c,        // 集装箱锈红（主色点缀）
  seaBlue: 0x2c5367,     // 集装箱冷蓝
  moss: 0x465b52,        // 集装箱灰绿
  orange: 0xa1643b,      // 安全橙
  wood: 0x7a5e44,        // 托盘 / 木箱
  trim: 0x6c7c83,        // 门框 / 栏杆 / 管道（浅钢）
  line: 0xb6bfbd,        // 地面白线
  warn: 0xbd9437,        // 警戒黄
  glass: 0x1e2a31        // 仓库窗（深色玻璃）
};

// 掩体三档：低 0.85（蹲下可藏）、半 1.4（站蹲之间）、高 1.75（挡站立视线）
const LOW = 0.85;
const HALF = 1.4;
const HIGH = 1.75;

/**
 * @param {THREE.Object3D} root
 * @param {{edits?:object}} [opts]
 */
export function buildHarbor(root, opts) {
  opts = opts || {};
  const world = new World();
  const placed = [];
  const batch = new GeoBatch(root, world, TILE);
  let seq = 0;

  /** 记录 placed 并交给 GeoBatch 合批 / 建碰撞。 */
  function box(cx, cy, cz, w, h, d, kind, o) {
    o = o || {};
    const id = seq++;
    batch.box(cx, cy, cz, w, h, d, kind, o);
    placed.push({
      id, x: cx, y: cy, z: cz, w, h, d, kind,
      tag: o.tag || '', collide: o.collide !== false
    });
  }

  /** 纯色块：港口的主色都从这里走，靠 color 分组合批。 */
  function paint(cx, cy, cz, w, h, d, color, o) {
    box(cx, cy, cz, w, h, d, 'paint', Object.assign({ color }, o));
  }

  function wall(x, z, w, d, h, color, o) {
    paint(x, h / 2, z, w, h, d, color || C.ground, Object.assign({ tag: 'wall' }, o));
  }

  function cover(x, z, w, d, h, color, o) {
    paint(x, h / 2, z, w, h, d, color || C.wood, Object.assign({ tag: 'cover' }, o));
  }

  /** 集装箱：tag=container，可堆叠、可上人；端门加锁杆条纹，不是纯色方块。 */
  function container(x, z, w, d, h, color) {
    paint(x, h / 2, z, w, h, d, color, { tag: 'container' });
    paint(x, h + 0.04, z, w + 0.08, 0.08, d + 0.08, C.trim, { collide: false, tag: 'prop' });
    if (w >= d) {
      for (const s of [-1, 1]) {
        paint(x + s * (w / 2 + 0.03), h / 2, z, 0.06, h * 0.82, d * 0.84, C.steel, { collide: false, tag: 'prop' });
      }
    } else {
      for (const s of [-1, 1]) {
        paint(x, h / 2, z + s * (d / 2 + 0.03), w * 0.84, h * 0.82, 0.06, C.steel, { collide: false, tag: 'prop' });
      }
    }
  }

  // 门框只做视觉收边，不参与碰撞：让 2.65 m 净高在任何墙面上可读。
  function doorTrimX(cx, cz, openW, d) {
    const t = 0.18;
    const depth = d + 0.12;
    paint(cx - openW / 2 + t / 2, DOOR_H / 2, cz, t, DOOR_H, depth, C.trim, { collide: false, tag: 'prop' });
    paint(cx + openW / 2 - t / 2, DOOR_H / 2, cz, t, DOOR_H, depth, C.trim, { collide: false, tag: 'prop' });
    paint(cx, DOOR_H + t / 2, cz, openW, t, depth, C.trim, { collide: false, tag: 'prop' });
  }

  function doorTrimZ(cx, cz, openD, w) {
    const t = 0.18;
    const depth = w + 0.12;
    paint(cx, DOOR_H / 2, cz - openD / 2 + t / 2, depth, DOOR_H, t, C.trim, { collide: false, tag: 'prop' });
    paint(cx, DOOR_H / 2, cz + openD / 2 - t / 2, depth, DOOR_H, t, C.trim, { collide: false, tag: 'prop' });
    paint(cx, DOOR_H + t / 2, cz, depth, t, openD, C.trim, { collide: false, tag: 'prop' });
  }

  /**
   * 沿 X 的墙：z 固定，从 x0 到 x1，doors 是门洞 [a,b] 列表。
   * 自动补过梁与门框 —— 全图门洞净高只有一个来源。
   */
  function wallX(z, x0, x1, doors, h, color, o) {
    const list = (doors || []).slice().sort((a, b) => a[0] - b[0]);
    const base = Object.assign({ tag: 'wall' }, o);
    let cur = x0;
    for (const [a, b] of list) {
      if (a > cur + 0.01) wall((cur + a) / 2, z, a - cur, 1, h, color, o);
      if (h > DOOR_H) {
        paint((a + b) / 2, DOOR_H + (h - DOOR_H) / 2, z, b - a, h - DOOR_H, 1, color, base);
      }
      doorTrimX((a + b) / 2, z, b - a, 1);
      cur = b;
    }
    if (x1 > cur + 0.01) wall((cur + x1) / 2, z, x1 - cur, 1, h, color, o);
  }

  /** 沿 Z 的墙：x 固定，从 z0 到 z1。 */
  function wallZ(x, z0, z1, doors, h, color, o) {
    const list = (doors || []).slice().sort((a, b) => a[0] - b[0]);
    const base = Object.assign({ tag: 'wall' }, o);
    let cur = z0;
    for (const [a, b] of list) {
      if (a > cur + 0.01) wall(x, (cur + a) / 2, 1, a - cur, h, color, o);
      if (h > DOOR_H) {
        paint(x, DOOR_H + (h - DOOR_H) / 2, (a + b) / 2, 1, h - DOOR_H, b - a, color, base);
      }
      doorTrimZ(x, (a + b) / 2, b - a, 1);
      cur = b;
    }
    if (z1 > cur + 0.01) wall(x, (cur + z1) / 2, 1, z1 - cur, h, color, o);
  }

  /**
   * 台阶：n 级，每级 rise（≤0.35）高、run 深。
   * dir = +1 表示「玩家从 z0 往 +z 方向往上走」，-1 反向。
   * 用于上集装箱顶：地面端一定朝玩家来的一侧，最高级贴着箱体。
   */
  function steps(x, z0, w, n, rise, run, color, dir) {
    const s = dir === -1 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const h = rise * (i + 1);
      const zc = z0 + s * run * (i + 0.5);
      paint(x, h / 2, zc, w, h, run, color || C.wood, { tag: 'pallet' });
      // 踏板前沿的浅色收边，让台阶在暗处也能读出一级一级
      paint(x, h - 0.02, zc, w - 0.1, 0.04, 0.08, C.trim, { collide: false, tag: 'prop' });
    }
  }

  /** 仓库/棚顶灯：自发光板，纯视觉，但能把室内从「黑洞」拉回来。 */
  function lamp(x, y, z, w, d) {
    paint(x, y, z, w || 1.6, 0.1, d || 0.7, 0x2a3438, { collide: false, tag: 'prop' });
    box(x, y - 0.07, z, (w || 1.6) - 0.16, 0.06, (d || 0.7) - 0.14, 'lamp', { collide: false, tag: 'prop' });
  }

  /** 码头系船柱。 */
  function bollard(x, z) {
    paint(x, 0.3, z, 0.36, 0.6, 0.36, C.steel, { collide: false, tag: 'prop' });
    paint(x, 0.64, z, 0.5, 0.1, 0.5, C.trim, { collide: false, tag: 'prop' });
  }

  /** 屋顶通风管。 */
  function vent(x, z, y) {
    paint(x, y + 0.55, z, 1.2, 1.1, 1.2, C.trim, { collide: false, tag: 'prop' });
    paint(x, y + 1.16, z, 1.5, 0.14, 1.5, C.steel, { collide: false, tag: 'prop' });
  }

  /** 立牌 / 告示：贴墙的薄板，视觉-only。 */
  function sign(x, y, z, w, h, d, color) {
    paint(x, y, z, w, h, d, color, { collide: false, tag: 'prop' });
  }

  /**
   * 墙面装饰统一约定：`at` 传墙面坐标，`dir` 传开口方向
   * （+1 = 面板向坐标更小的一侧凸出，-1 = 向更大的一侧凸出）。
   * 所有装饰都是 collide:false 的薄片，贴在实墙上，不会给玩家多出一条缝隙。
   */

  /** 高窗：深玻璃 + 上下浅钢框 + 竖向分格。axis='x' 窗沿 X 铺开，墙面法线沿 Z。 */
  function windowBand(axis, at, along, y, len, h, dir) {
    const s = dir || 1;
    const band = h || 0.95;
    const fr = 0.1;
    const put = (dy, ww, hh, dep, color) => {
      if (axis === 'x') paint(along, dy, at - (s * dep) / 2, ww, hh, dep, color, { collide: false, tag: 'prop' });
      else paint(at - (s * dep) / 2, dy, along, dep, hh, ww, color, { collide: false, tag: 'prop' });
    };
    put(y, len, band, 0.07, C.glass);
    put(y + band / 2 + fr / 2, len + 0.28, fr, 0.13, C.trim);
    put(y - band / 2 - fr / 2, len + 0.28, fr, 0.13, C.trim);
    const n = Math.max(2, Math.round(len / 2.3));
    for (let i = 1; i < n; i++) {
      const o = -len / 2 + (len / n) * i;
      if (axis === 'x') paint(along + o, y, at - (s * 0.09) / 2, 0.09, band, 0.09, C.trim, { collide: false, tag: 'prop' });
      else paint(at - (s * 0.09) / 2, y, along + o, 0.09, band, 0.09, C.trim, { collide: false, tag: 'prop' });
    }
  }

  /** 关闭的卷帘门：钢板 + 4 道横筋 + 门罩。 */
  function shutter(axis, at, along, w, h, dir) {
    const s = dir || 1;
    const put = (cy, ww, hh, dep, color) => {
      if (axis === 'x') paint(along, cy, at - (s * dep) / 2, ww, hh, dep, color, { collide: false, tag: 'prop' });
      else paint(at - (s * dep) / 2, cy, along, dep, hh, ww, color, { collide: false, tag: 'prop' });
    };
    put(h / 2, w, h, 0.12, C.steel);
    for (let i = 1; i < 5; i++) put((h / 5) * i, w - 0.1, 0.1, 0.18, C.trim);
    put(h + 0.28, w + 0.44, 0.52, 0.38, C.trim);
  }

  /** 外挂雨水管：垂直细管 + 抱箍，贴墙走。 */
  function downpipe(axis, at, along, h, dir) {
    const s = dir || 1;
    const put = (cy, hh, dep, color) => {
      if (axis === 'x') paint(along, cy, at - (s * dep) / 2, 0.16, hh, dep, color, { collide: false, tag: 'prop' });
      else paint(at - (s * dep) / 2, cy, along, dep, hh, 0.16, color, { collide: false, tag: 'prop' });
    };
    put(h / 2, h, 0.18, C.steel);
    for (let y = 1.2; y < h - 0.4; y += 2.4) put(y, 0.12, 0.24, C.trim);
  }

  /**
   * 墙裙：把整面墙在 1.1 m 处切一刀，远看不再是一整块纯色。
   * doors 传门洞 [a,b]（沿轴的世界坐标），门洞处必须断开 —— 否则墙裙会横在门口把人挡成半截。
   */
  function plinth(axis, at, along, len, h, dir, color, doors) {
    const s = dir || 1;
    const a0 = along - len / 2, a1 = along + len / 2;
    const segs = [];
    let cur = a0;
    for (const [a, b] of (doors || []).slice().sort((p, q) => p[0] - q[0])) {
      const lo = Math.max(a0, a), hi = Math.min(a1, b);
      if (hi <= lo) continue;
      if (lo > cur) segs.push([cur, lo]);
      cur = Math.max(cur, hi);
    }
    if (a1 > cur) segs.push([cur, a1]);
    for (const [p, q] of segs) {
      const c = (p + q) / 2, l = q - p;
      if (l < 0.2) continue;
      if (axis === 'x') paint(c, h / 2, at - (s * 0.1) / 2, l, h, 0.1, color || C.brickDark, { collide: false, tag: 'prop' });
      else paint(at - (s * 0.1) / 2, h / 2, c, 0.1, h, l, color || C.brickDark, { collide: false, tag: 'prop' });
    }
  }

  /** 地面标线：白线 / 黄警戒线，0.04 m 厚，不参与碰撞。 */
  function stripe(x, z, w, d, color) {
    paint(x, 0.03, z, w, 0.04, d, color || C.line, { collide: false, tag: 'prop' });
  }

  /** 地面 A/B 标识（浏览器里才画 canvas，Node 下自动跳过）。 */
  function siteMarker(x, z, letter, color) {
    if (typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, 256, 256);
    // 港口风格：方形工业标识 + 斜切角，比圆环更像码头喷涂
    g.beginPath();
    g.moveTo(28, 20); g.lineTo(228, 20); g.lineTo(236, 236); g.lineTo(20, 236);
    g.closePath();
    g.fillStyle = 'rgba(10,16,20,.55)';
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = color;
    g.stroke();
    g.fillStyle = color;
    g.font = '900 150px ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 128, 138);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 6.4),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.15, z);
    root.add(mesh);
  }

  /* ================================================================
   * 0. 地面 / 海 / 边界
   * ================================================================ */

  // 地面主碰撞体：NavGrid 的 bounds 从这里推出来。
  box(0, -0.1, 0, 96, 0.2, 92, 'concrete', { tag: 'ground', repeat: 24, color: 0xd2ecf6 });
  // 码头铺装（东）：浅一档的水泥
  box(36, 0.02, -9, 12, 0.04, 34, 'concrete', { collide: false, repeat: 8, color: 0xcfe4e8 });
  // 堆场沥青（中）：深冷灰
  box(0, 0.02, -6, 28, 0.04, 34, 'concrete', { collide: false, repeat: 10, color: 0x93acb8 });
  // 仓库地面：室内更暗
  box(-31, 0.02, 19, 26, 0.04, 14, 'concrete', { collide: false, repeat: 8, color: 0xa9c0c4 });

  // 外墙：南 / 北 / 西 高墙，东侧是海（防波堤 + 岸壁 + 栏杆）。
  wall(0, -45.4, 96, 1.2, 7, C.ground, { tag: 'bound' });
  wall(0, 45.4, 96, 1.2, 7, C.ground, { tag: 'bound' });
  wall(-47.4, 0, 1.2, 90.8, 7, C.ground, { tag: 'bound' });
  paint(47.4, 0.6, 0, 1.2, 1.2, 91, C.ground, { tag: 'bound' });

  // 岸壁：把海面与码头地面之间的垂直断面补上，避免看到「悬空的地面边缘」。
  paint(42.4, -1.3, -3, 1.2, 2.6, 66, C.ground, { tag: 'dock' });
  // 海面：比地面低 2.55 m，冷蓝；只做视觉。
  {
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 66, 1, 1),
      flat(0x24424f, { roughness: 0.16, metalness: 0.5 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(45.2, -2.55, -3);
    root.add(sea);
  }
  // 防波堤内侧的消波块（视觉）
  for (const z of [-30, -18, -6, 6, 18, 26]) {
    paint(46.2, -1.8, z, 1.4, 1.5, 2.2, C.steel, { collide: false, tag: 'prop' });
  }

  // 码头护栏：一条连续的碰撞薄板 + 立柱。碰撞只建一次，视觉单独加柱。
  paint(42, 0.525, -3, 0.14, 1.05, 62, C.trim, { tag: 'rail' });
  for (let z = -33; z <= 27; z += 4) {
    paint(42, 0.54, z, 0.22, 1.08, 0.22, C.steel, { collide: false, tag: 'prop' });
  }
  // 码头边的系船柱与地面安全线
  for (let z = -32; z <= 26; z += 9) bollard(41.4, z);
  stripe(41.2, -3, 0.18, 62, C.warn);

  /* ================================================================
   * 1. 南侧：T 出生区（码头闸口）+ 两翼堆场
   * ================================================================ */

  // 南侧整排建筑：T 出生区就夹在中间的空腔里，东西两侧建筑直接当出生区侧墙。
  paint(-28, 3.5, -39.4, 36, 7, 10.8, C.brickDark, { tag: 'building' });
  paint(28, 3.5, -39.4, 36, 7, 10.8, C.brickDark, { tag: 'building' });
  // 檐口
  paint(-28, 7.15, -39.4, 36.4, 0.3, 11.2, C.roof, { collide: false, tag: 'prop' });
  paint(28, 7.15, -39.4, 36.4, 0.3, 11.2, C.roof, { collide: false, tag: 'prop' });

  // T 闸墙 z=-34：三个出口（西 3.4 / 中 4.0 / 东 3.4）
  wallX(-34, -10, 10, [[-8.6, -5.2], [-2, 2], [5.2, 8.6]], 5, C.ground);
  // 两侧仓库朝院子的立面：高窗 + 墙裙，避免 36 m 长的纯色墙
  for (const s of [-1, 1]) {
    windowBand('x', -34, s * 27, 4.9, 9.2, 0.85, -1);
    windowBand('x', -34, s * 14, 4.9, 5.0, 0.85, -1);
    plinth('x', -34, s * 28, 34, 1.2, -1);
  }
  // 闸口雨棚（半室内感，视觉）
  paint(0, 4.62, -33.2, 22, 0.24, 2.4, C.roof, { collide: false, tag: 'prop' });
  sign(-7, 3.5, -33.42, 3.4, 1.2, 0.1, C.warn);
  sign(7, 3.5, -33.42, 3.4, 1.2, 0.1, C.seaBlue);

  // 闸口朝出生区的一面（z=-34.5）：墙裙 + 高窗 + 雨水管 + 门侧警示漆。
  // 出生点第一眼就是这面墙，不能是一整块纯色。
  plinth('x', -34.5, 0, 20, 1.15, 1, 0, [[-8.6, -5.2], [-2, 2], [5.2, 8.6]]);
  windowBand('x', -34.5, -6.9, 4.05, 4.6, 0.78, 1);
  windowBand('x', -34.5, 6.9, 4.05, 4.6, 0.78, 1);
  downpipe('x', -34.5, -9.45, 5, 1);
  downpipe('x', -34.5, 9.45, 5, 1);

  // T 出生区内部：出生点 z -41..-37，掩体全部压在 z -36 以北，不能压出生位
  cover(-6.4, -35.4, 1.8, 1.0, LOW, C.wood);
  cover(6.4, -35.4, 1.8, 1.0, LOW, C.wood);
  paint(-8.8, 1.1, -42.2, 1.0, 2.2, 1.0, C.wood, { tag: 'cover' });
  paint(8.8, 1.1, -42.2, 1.0, 2.2, 1.0, C.wood, { tag: 'cover' });
  lamp(0, 4.4, -37, 2.2, 0.9);

  // T 前庭：东西各一道隔墙，中间开 4 m 门
  wallZ(-16, -34, -22, [[-30, -26]], 6, C.brickDark);
  wallZ(16, -34, -22, [[-30, -26]], 6, C.brickDark);
  // 前庭 → 中路的闸墙
  wallX(-22, -16, 16, [[-2.5, 2.5]], 6, C.shed);
  cover(-11, -24.4, 2.6, 2.6, 1.3, C.steel);
  cover(11, -24.4, 2.6, 2.6, 1.3, C.steel);
  cover(-3.8, -29.5, 1.6, 1.0, LOW, C.ground);
  // 前庭地面：白色停车线，让空场不空
  stripe(-9, -30, 0.16, 6, C.line);
  stripe(9, -30, 0.16, 6, C.line);

  /* ================================================================
   * 2. 西货场（T → B）与东货场（T → A）
   * ================================================================ */

  // 西货场北墙 z=-22：B 长入口 4 m
  wallX(-22, -46, -16, [[-42, -38]], 6, C.ground);
  // 东货场北墙 z=-22：A 长入口 6 m
  wallX(-22, 16, 42, [[34, 40]], 6, C.ground);

  // 西货场掩体：一堆空箱 + 托盘
  container(-43, -29, 3.2, 3.2, 2.6, C.rust);
  container(-38.4, -29, 3.2, 3.2, 2.6, C.moss);
  cover(-33, -31, 2.4, 1.2, HALF, C.wood);
  cover(-24, -28, 2.2, 1.2, LOW, C.wood);
  cover(-29, -24.5, 2.0, 1.4, HIGH, C.steel);
  steps(-41.4, -23, 2.0, 8, 0.32, 0.55, C.wood, -1);
  stripe(-31, -33.2, 28, 0.18, C.warn);

  // 东货场掩体
  container(20, -30, 3.2, 3.2, 2.6, C.seaBlue);
  container(25.2, -30, 3.2, 3.2, 2.6, C.moss);
  cover(31, -30.5, 2.4, 1.2, HALF, C.wood);
  cover(38.5, -27, 2.0, 1.2, LOW, C.wood);
  cover(33, -24.5, 2.0, 1.4, HIGH, C.steel);
  steps(19, -24, 2.0, 8, 0.32, 0.55, C.wood, -1);
  stripe(29, -33.2, 26, 0.18, C.warn);

  /* ================================================================
   * 3. A 长（码头路） / A 侧建筑带 / 设备间
   * ================================================================ */

  // A 侧建筑带：中间塞一个 6×6 的可进设备间（x 24..30, z -6..0）
  paint(22, 5, -14, 16, 10, 16, C.brick, { tag: 'building' });
  paint(19, 5, -3, 10, 10, 6, C.brickDark, { tag: 'building' });
  paint(22, 5, 3, 16, 10, 6, C.brick, { tag: 'building' });
  // 朝中路堆场的一面（x=14）：两层高窗 + 墙裙
  for (const y of [4.2, 7.5]) {
    windowBand('z', 14, -14, y, 13.0, 0.85, -1);
    windowBand('z', 14, 2.0, y, 6.0, 0.85, -1);
  }
  plinth('z', 14, -8, 27.6, 1.2, -1);
  paint(22, 10.15, -14, 16.4, 0.3, 16.4, C.roof, { collide: false, tag: 'prop' });
  paint(22, 10.15, 3, 16.4, 0.3, 6.4, C.roof, { collide: false, tag: 'prop' });
  // 设备间屋顶
  paint(27, 5.3, -3, 6, 0.3, 6, C.roof, { tag: 'building' });
  lamp(27, 4.4, -3, 1.4, 0.6);

  // A 长西墙 x=30：z -22..-4.4 与 -1.4..6，中间 3 m 设备间门
  wallZ(30, -22, 6, [[-4.4, -1.4]], 6, C.shed);
  // A 长内侧立面（朝海一面）：仓库高窗 + 一处关闭的装卸卷帘门
  windowBand('z', 30.5, -13, 4.25, 12.0, 0.9, -1);
  shutter('z', 30.5, 2.3, 3.4, 3.4, -1);
  plinth('z', 30.5, -8, 27.6, 1.2, -1, 0, [[-4.4, -1.4]]);
  downpipe('z', 30.5, -20.6, 6, -1);
  // 设备间内部
  cover(26.1, -3.2, 1.4, 1.4, HALF, C.steel);

  // A 长中段咽喉 z=-8：两侧各 4 m 墙，只留 4 m 通道
  wall(32, -8, 4, 1.2, 6, C.shed);
  wall(40, -8, 4, 1.2, 6, C.shed);
  paint(36, 6.6, -8, 12, 1.0, 1.5, C.steel, { collide: false, tag: 'prop' });

  // A 长掩体
  container(33, -18, 3.0, 3.0, 2.6, C.rust);
  cover(39.2, -13, 2.0, 1.4, HALF, C.wood);
  cover(32, -3, 1.8, 1.2, LOW, C.wood);
  cover(39.4, 1, 1.4, 1.4, HIGH, C.steel);
  stripe(36, -20, 10, 0.18, C.line);

  // 岸吊：A 长上方的门架，12 m 高，是整张图最远可认的地标。
  // 放在 A 长南段，柱子贴墙，不占正门与咽喉。
  paint(30.8, 6, -16, 0.9, 12, 0.9, C.steel, { tag: 'building' });
  paint(41.2, 6, -16, 0.9, 12, 0.9, C.steel, { tag: 'building' });
  paint(36, 11.6, -16, 11.2, 0.7, 1.1, C.trim, { collide: false, tag: 'prop' });
  paint(36, 12.4, -16, 4.6, 1.0, 1.6, C.orange, { collide: false, tag: 'prop' });
  paint(36, 10.9, -16, 2.6, 0.5, 2.2, C.steel, { collide: false, tag: 'prop' });

  /* ================================================================
   * 4. A 前广场 / A 点（半室内码头棚）
   * ================================================================ */

  // A 前广场南界就是 A 侧建筑带北面；北界是 A 点南墙（正门 6 m）
  wallX(12, 20, 38, [[25, 31]], 6, C.shed);
  // A 点西侧填充（x 14..20, z 12..28），让 A 点西墙成为实墙
  paint(17, 4, 20, 6, 8, 16, C.brickDark, { tag: 'building' });
  paint(17, 8.15, 20, 6.4, 0.3, 16.4, C.roof, { collide: false, tag: 'prop' });
  // A 点东侧：x 40..42 留成露天平台（可看海，也是侧身位）

  // A 点西墙 x=20：门 3.4 m
  wallZ(20, 12, 26, [[15, 18.4]], 6, C.shed);
  // A 点北墙 z=26：后门 5 m；东端 x 36..40 开放接东平台
  wallX(26, 20, 36, [[24, 29]], 6, C.shed);
  // A 点东墙 x=40：门 3 m
  wallZ(40, 12, 24, [[16, 19]], 6, C.shed);

  // A 棚屋顶：半室内 —— 有顶但四面开口
  paint(30, 5.55, 19, 20, 0.3, 14, C.shed, { tag: 'building' });
  paint(30, 5.78, 19, 20.6, 0.16, 14.6, C.roof, { collide: false, tag: 'prop' });
  // 屋面梁（从棚下仰视能读出结构，不是一块悬空板）
  for (const x of [22, 26, 30, 34, 38]) {
    paint(x, 5.24, 19, 0.26, 0.32, 14, C.steel, { collide: false, tag: 'prop' });
  }
  lamp(24, 4.5, 17, 2.0, 0.8);
  lamp(36, 4.5, 21, 2.0, 0.8);
  // 包点台：0.22 m，走一步就能上
  paint(30, 0.11, 18, 8, 0.22, 6, C.ground, { tag: 'site' });

  // A 点掩体：入口低箱偏置，不堵正门
  cover(24.5, 16.5, 1.8, 1.2, LOW, C.wood);
  cover(35.2, 20.6, 1.8, 1.4, HALF, C.wood);
  cover(28.6, 22.6, 2.2, 1.2, HIGH, C.steel);
  cover(33.2, 14.4, 1.4, 1.2, LOW, C.ground);
  // 吊装货堆：A 点内的第二个高度层
  container(35.8, 16.6, 2.4, 2.4, 1.8, C.orange);
  // 包点黄框
  stripe(30, 14.7, 10, 0.16, C.warn);
  stripe(30, 21.3, 10, 0.16, C.warn);
  stripe(25.1, 18, 0.16, 6.6, C.warn);
  stripe(34.9, 18, 0.16, 6.6, C.warn);

  // A 东平台（x 40..42）：看海 / 侧身位，无护栏之外无掩体
  // A 点吊塔（第二地标）：贴东侧栏杆，给 A 东平台留出 1.3 m 通行带
  paint(41.6, 5, 22, 0.5, 10, 0.5, C.steel, { tag: 'building' });
  paint(39.6, 9.7, 22, 3.8, 0.45, 0.7, C.trim, { collide: false, tag: 'prop' });
  box(41.6, 10.1, 22, 0.22, 0.22, 0.22, 'lamp', { collide: false, tag: 'prop' });

  // A 后巷：z 26..28；北墙由 CT 走廊南墙统一提供（见第 8 节），这里只放掩体
  cover(23, 27.2, 1.6, 1.2, LOW, C.wood);
  bollard(41.4, 27);

  // A 标识
  siteMarker(30, 18, 'A', '#e8b04a');

  /* ================================================================
   * 5. B 侧建筑带 / B 长（仓库路）/ B 前院
   * ================================================================ */

  paint(-24, 5, -8, 20, 10, 28, C.brickDark, { tag: 'building' });
  paint(-24, 10.15, -8, 20.4, 0.3, 28.4, C.roof, { collide: false, tag: 'prop' });
  // B 长侧的仓库立面：两层高窗 + 装卸口 + 墙裙（x=-34 是朝 B 长的一面）
  for (const y of [4.2, 7.5]) windowBand('z', -34, -13, y, 12.5, 0.85, 1);
  shutter('z', -34, 0.6, 3.6, 3.6, 1);
  plinth('z', -34, -8, 27.6, 1.2, 1);
  downpipe('z', -34, -21.0, 10, 1);
  downpipe('z', -34, 5.2, 10, 1);
  // 朝中路集装箱堆场的一面（x=-14）
  for (const y of [4.2, 7.5]) windowBand('z', -14, -12, y, 14.0, 0.85, -1);
  plinth('z', -14, -8, 27.6, 1.2, -1);

  // B 长西侧就是外墙；东侧是建筑带。中段咽喉 z=-8：留 4 m
  wall(-44, -8, 4, 1.2, 6, C.ground);
  wall(-36, -8, 4, 1.2, 6, C.ground);
  paint(-40, 6.6, -8, 12, 1.0, 1.5, C.steel, { collide: false, tag: 'prop' });

  // B 长掩体
  container(-43.4, -14, 3.2, 3.2, 2.6, C.moss);
  cover(-36.2, -13, 2.0, 1.4, HALF, C.wood);
  cover(-44, -3, 1.8, 1.2, LOW, C.wood);
  cover(-36.2, 1, 1.4, 1.4, HIGH, C.steel);
  steps(-40.4, -20, 2.0, 8, 0.32, 0.55, C.wood, 1);
  stripe(-40, -21, 10, 0.18, C.line);

  // B 前院（z 6..12）：B 长 / B 小进仓库正门前的交火区
  cover(-18, 9.2, 1.6, 1.4, HALF, C.steel);
  cover(-24, 9.6, 1.4, 1.0, LOW, C.wood);
  cover(-39, 9.2, 1.4, 1.2, HIGH, C.steel);
  cover(-28.5, 7.4, 2.0, 1.0, LOW, C.ground);
  stripe(-31, 6.6, 12, 0.18, C.warn);

  /* ================================================================
   * 6. B 点：室内仓库
   * ================================================================ */

  // 南墙 z=12：正门 4 m
  wallX(12, -44, -18, [[-33, -29]], 6, C.brick);
  // 南墙朝前院（z=11.5）：墙裙 + 高窗 + 装卸卷帘门 + 雨水管
  plinth('x', 11.5, -31, 26, 1.15, 1, 0, [[-33, -29]]);
  windowBand('x', 11.5, -41.9, 4.25, 3.2, 0.85, 1);
  windowBand('x', 11.5, -25.5, 4.25, 3.6, 0.85, 1);
  shutter('x', 11.5, -38.2, 3.4, 3.5, 1);
  shutter('x', 11.5, -21.0, 3.0, 3.5, 1);
  downpipe('x', 11.5, -43.6, 6, 1);
  downpipe('x', 11.5, -18.4, 6, 1);
  // 东墙 x=-18：侧门 3.2 m
  wallZ(-18, 12, 26, [[16, 19.2]], 6, C.brick);
  windowBand('z', -17.5, 22.6, 4.25, 5.2, 0.85, -1);
  shutter('z', -17.5, 14.4, 2.6, 3.4, -1);
  plinth('z', -17.5, 19, 14, 1.15, -1, 0, [[16, 19.2]]);
  // 北墙 z=26：后门 3.2 m
  wallX(26, -44, -18, [[-32, -28.8]], 6, C.brick);
  windowBand('x', 26.5, -39, 4.25, 6.0, 0.85, -1);
  windowBand('x', 26.5, -23, 4.25, 6.0, 0.85, -1);
  plinth('x', 26.5, -31, 26, 1.15, -1, 0, [[-32, -28.8]]);
  // 西侧与外墙之间的夹缝填实
  paint(-45.7, 4, 19, 3.4, 8, 14, C.brickDark, { tag: 'building' });

  // 仓库屋顶（比墙高 0.2，形成檐口）
  paint(-31, 6.35, 19, 26, 0.3, 14, C.roof, { tag: 'building' });
  vent(-40, 15.5, 6.5);
  vent(-33, 23, 6.5);
  vent(-22, 16, 6.5);

  // 包点台
  paint(-30, 0.11, 19, 8, 0.22, 6, C.ground, { tag: 'site' });

  // 货架：贴墙的两排高架，是「室内掩体」而不是装饰
  paint(-41.4, 0.95, 19, 2.2, 1.9, 9, C.wood, { tag: 'cover' });
  paint(-41.4, 1.92, 19, 2.4, 0.12, 9.2, C.steel, { collide: false, tag: 'prop' });
  paint(-20.8, 1.0, 18.5, 1.6, 2.0, 8, C.trim, { tag: 'cover' });
  // 零散货堆
  cover(-28, 15.4, 1.6, 1.2, LOW, C.wood);
  cover(-36, 23, 1.6, 1.4, HALF, C.wood);
  cover(-22.6, 14.4, 1.4, 1.4, HIGH, C.steel);
  container(-35.6, 14.6, 2.2, 2.2, 1.8, C.rust);
  // 叉车（视觉 + 半高掩体）
  paint(-26.6, 0.7, 23.4, 1.3, 1.4, 2.2, C.orange, { tag: 'cover' });

  // 室内照明：仓库没有天窗，靠灯板把地面从黑里拉出来
  lamp(-38, 5.7, 17, 2.4, 0.9);
  lamp(-30, 5.7, 20, 2.4, 0.9);
  lamp(-23, 5.7, 17, 2.2, 0.9);
  // 包点黄框
  stripe(-30, 15.8, 10, 0.16, C.warn);
  stripe(-30, 22.2, 10, 0.16, C.warn);
  stripe(-34.9, 19, 0.16, 6.6, C.warn);
  stripe(-25.1, 19, 0.16, 6.6, C.warn);

  // B 标识
  siteMarker(-30, 19, 'B', '#64b0d4');

  // B 后巷：z 26..28；北墙由 CT 走廊南墙统一提供，这里只放掩体
  cover(-39.6, 27.2, 1.6, 1.2, LOW, C.wood);

  /* ================================================================
   * 7. 中路：集装箱堆场
   * ================================================================ */

  // 中路东墙 x=14：A 小开口 z 8..11
  wallZ(14, 6, 28, [[8, 11]], 6, C.ground);
  // 中路西墙 x=-14：B 小开口 z 8..11
  wallZ(-14, 6, 28, [[8, 11]], 6, C.ground);
  // 堆场两侧墙朝内的一面：高窗 + 墙裙，让「箱子通道」有仓库后墙的质感
  windowBand('z', 13.5, 19.5, 4.1, 12.0, 0.85, 1);
  windowBand('z', -13.5, 19.5, 4.1, 12.0, 0.85, -1);
  plinth('z', 13.5, 17, 21.6, 1.15, 1, 0, [[8, 11]]);
  plinth('z', -13.5, 17, 21.6, 1.15, -1, 0, [[8, 11]]);

  // 堆场南段入口
  cover(0, -18, 2.6, 1.2, LOW, C.ground);
  container(-8.4, -18, 3.2, 3.2, 2.6, C.seaBlue);
  container(8.4, -17, 3.2, 3.2, 2.6, C.rust);

  // 堆场主体：两列集装箱错开，形成 S 形通道 + 回环
  // 东列（x 4..10），南端接 8 级台阶上箱顶
  container(7, -12, 6, 3.6, 2.6, C.rust);
  container(7, -7.4, 6, 3.6, 2.6, C.seaBlue);
  steps(5.5, -1.2, 2.0, 8, 0.32, 0.55, C.wood, -1);
  // 箱顶的「落脚板」：让站上去有明确的一层，而不是踩在斜面上
  paint(7, 2.64, -9.7, 5.6, 0.08, 7.0, C.trim, { collide: false, tag: 'prop' });

  // 西列（x -10..-4），与东列错开 6 m
  container(-7, 2, 6, 8, 2.6, C.moss);
  paint(-7, 2.64, 2, 5.6, 0.08, 7.6, C.trim, { collide: false, tag: 'prop' });

  // 中央与两侧通道掩体
  cover(0, -1, 2.0, 1.4, HALF, C.wood);
  cover(11.8, -8, 1.4, 1.4, LOW, C.ground);
  cover(-11.8, 4, 1.4, 1.4, LOW, C.ground);
  container(-11.6, -14, 2.4, 2.4, 2.2, C.orange);
  // 堆场地面车位线
  stripe(3.4, -10, 0.14, 22, C.line);
  stripe(-3.4, -6, 0.14, 24, C.line);
  stripe(0, -19.4, 24, 0.14, C.warn);

  // 中路北段（z 8..28）
  cover(-6, 13.6, 2.2, 1.4, HALF, C.steel);
  cover(6, 13.6, 2.2, 1.4, HALF, C.steel);
  container(0, 22, 4.2, 3.0, 2.6, C.seaBlue);
  cover(-9.6, 25, 1.4, 1.4, LOW, C.ground);
  cover(9.6, 25, 1.4, 1.4, LOW, C.ground);
  cover(0, 10.4, 1.6, 1.2, LOW, C.wood);
  stripe(0, 27.2, 22, 0.14, C.line);

  /* ================================================================
   * 8. CT 走廊（回防环）/ CT 出生区 / CT 侧建筑
   * ================================================================ */

  // 南墙 z=28：三个门（B 后 3.6 / 中 5.0 / A 后 3.6）
  wallX(28, -44, 44, [[-30, -26.4], [-2.5, 2.5], [26.4, 30]], 6, C.ground);
  // 北墙 z=34：CT 出生区三个门
  wallX(34, -44, 44, [[-9, -5.6], [-2, 2], [5.6, 9]], 6, C.ground);
  // 走廊两面墙的细节：朝堆场一面挂高窗，朝走廊一面只留墙裙（走廊靠灯的暖光）
  for (const x of [-37, -14.5, 14.5, 37]) windowBand('x', 27.5, x, 4.2, 9.0, 0.8, 1);
  plinth('x', 27.5, 0, 87, 1.15, 1, 0, [[-30, -26.4], [-2.5, 2.5], [26.4, 30]]);
  for (const x of [-26, 26]) windowBand('x', 33.5, x, 4.2, 12.0, 0.8, 1);
  plinth('x', 33.5, 0, 87, 1.15, 1, 0, [[-9, -5.6], [-2, 2], [5.6, 9]]);

  // CT 走廊掩体：靠墙，不挡三条门
  cover(-14, 31.4, 2.2, 1.2, HALF, C.steel);
  cover(14, 31.4, 2.2, 1.2, HALF, C.steel);
  cover(-22, 29.6, 1.6, 1.0, LOW, C.wood);
  cover(22, 29.6, 1.6, 1.0, LOW, C.wood);
  cover(-34, 32.2, 1.4, 1.2, LOW, C.ground);
  cover(34, 32.2, 1.4, 1.2, LOW, C.ground);
  lamp(-12, 5.2, 31, 2.2, 0.8);
  lamp(12, 5.2, 31, 2.2, 0.8);
  stripe(0, 30.6, 84, 0.14, C.line);

  // CT 两侧建筑（10 m 高，挡住出生区侧向视线）
  paint(-27, 5, 39.6, 34, 10, 10.3, C.brickDark, { tag: 'building' });
  paint(27, 5, 39.6, 34, 10, 10.3, C.brickDark, { tag: 'building' });
  // 出生区两侧的立面（x=±10）：两层高窗，出生点不至于盯着两块铁板
  for (const s of [-1, 1]) {
    for (const y of [3.9, 7.4]) windowBand('z', s * 10, 39.5, y, 7.0, 0.8, s);
    plinth('z', s * 10, 39.5, 9.6, 1.15, s);
  }
  paint(-27, 10.15, 39.6, 34.4, 0.3, 10.7, C.roof, { collide: false, tag: 'prop' });
  paint(27, 10.15, 39.6, 34.4, 0.3, 10.7, C.roof, { collide: false, tag: 'prop' });
  vent(-38, 40, 9.8);
  vent(38, 40, 9.8);
  // 屋顶水塔（剪影）
  paint(-22, 11.4, 40, 2.6, 2.4, 2.6, C.trim, { tag: 'building' });
  paint(-22, 12.7, 40, 3.0, 0.24, 3.0, C.steel, { collide: false, tag: 'prop' });

  // CT 出生区内部：中门在正北 x -2..2，中央不能放掩体
  cover(-5.6, 37.4, 1.6, 1.2, LOW, C.wood);
  cover(5.6, 37.4, 1.6, 1.2, LOW, C.wood);
  cover(-3.4, 36.6, 1.6, 1.0, HALF, C.ground);
  lamp(0, 5.2, 40, 2.2, 0.8);
  stripe(0, 35.4, 16, 0.14, C.line);

  // 海上灯桩：立在防波堤上，从 A 点与 T 出生区都能看到的地标
  paint(45.6, -1, 26, 1.6, 3.4, 1.6, C.steel, { collide: false, tag: 'prop' });
  paint(45.6, 1.4, 26, 1.7, 1.2, 1.7, C.orange, { collide: false, tag: 'prop' });
  paint(45.6, 3.2, 26, 1.7, 1.2, 1.7, C.line, { collide: false, tag: 'prop' });
  paint(45.6, 5.0, 26, 1.7, 1.2, 1.7, C.orange, { collide: false, tag: 'prop' });
  paint(45.6, 6.1, 26, 2.0, 0.3, 2.0, C.steel, { collide: false, tag: 'prop' });
  box(45.6, 6.5, 26, 1.2, 0.7, 1.2, 'lamp', { collide: false, tag: 'prop' });

  /* ================================================================
   * 9. 装饰：灯、管道、旗帜
   * ================================================================ */

  for (const [x, z] of [[-36, -24], [36, -24], [-18, 8], [18, 8], [-10, 30], [10, 30]]) {
    paint(x, 2.6, z, 0.16, 5.2, 0.16, C.trim, { collide: false, tag: 'prop' });
    paint(x, 5.14, z, 0.5, 0.2, 0.5, C.steel, { collide: false, tag: 'prop' });
    box(x, 5.0, z, 0.34, 0.1, 0.34, 'lamp', { collide: false, tag: 'prop' });
  }
  // 仓库外挂管道
  paint(-18.6, 4.4, 22, 0.28, 0.28, 7.0, C.steel, { collide: false, tag: 'prop' });
  paint(-44.4, 4.4, 19, 0.28, 0.28, 10.0, C.steel, { collide: false, tag: 'prop' });
  // 装卸口：南侧仓库朝闸口一侧的卷帘门 + 墙面标牌（贴墙，不再有悬空件）
  shutter('x', -33.94, -20, 4.4, 3.6, -1);
  shutter('x', -33.94, 20, 4.4, 3.6, -1);
  sign(-26, 5.4, -33.9, 3.2, 1.1, 0.08, C.seaBlue);
  sign(26, 5.4, -33.9, 3.2, 1.1, 0.08, C.rust);
  // A/B 点的防水布（半高掩体上的布面，纯视觉）
  paint(35.2, 2.2, 20.6, 2.0, 0.12, 1.6, C.seaBlue, { collide: false, tag: 'prop' });
  paint(-36, 2.2, 23, 1.8, 0.12, 1.5, C.rust, { collide: false, tag: 'prop' });

  /* ================================================================
   * 合并静态批次
   * ================================================================ */
  const meshes = batch.build((kind, o) => {
    if (kind === 'paint') return flat(o.color, { roughness: 0.86, metalness: 0.02 });
    if (kind === 'lamp') return flat(0xffe3ae, { roughness: 0.4, emissive: 0xffc56a, emissiveIntensity: 1.15 });
    return material(kind, o);
  });
  // 记录几何规模，方便在任务卡里写性能账。
  const staticTris = meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0);

  /* ================================================================
   * 出生点 / 导航 / 包点 / 报点
   * ================================================================ */

  const spawns = {
    player: { x: 0, y: 0, z: -41, yaw: 0 },
    playerCT: { x: 0, y: 0, z: 42, yaw: Math.PI },
    allies: [
      { x: -3.2, z: -39, yaw: 0, waypoint: 1 },
      { x: 3.2, z: -39, yaw: 0, waypoint: 1 },
      { x: -6.4, z: -37, yaw: 0, waypoint: 2 },
      { x: 6.4, z: -37, yaw: 0, waypoint: 3 }
    ],
    ctAllies: [
      { x: -3.5, z: 41, yaw: Math.PI, waypoint: 70 },
      { x: 3.5, z: 41, yaw: Math.PI, waypoint: 70 },
      { x: -7, z: 39, yaw: Math.PI, waypoint: 71 },
      { x: 7, z: 39, yaw: Math.PI, waypoint: 72 }
    ],
    bots: [
      { x: 0, z: 43, yaw: Math.PI, waypoint: 70 },
      { x: 4, z: 42, yaw: Math.PI, waypoint: 70 },
      { x: -4, z: 42, yaw: Math.PI, waypoint: 71 },
      { x: 7, z: 40, yaw: Math.PI, waypoint: 72 },
      { x: -7, z: 40, yaw: Math.PI, waypoint: 71 }
    ],
    tBots: [
      { x: -3.2, z: -39, yaw: 0, waypoint: 1 },
      { x: 3.2, z: -39, yaw: 0, waypoint: 1 },
      { x: -6.4, z: -37, yaw: 0, waypoint: 2 },
      { x: 6.4, z: -37, yaw: 0, waypoint: 3 },
      { x: 0, z: -38, yaw: 0, waypoint: 0 }
    ]
  };

  const waypoints = [
    // T 出生 / 前庭
    { x: 0, z: -41 }, { x: -4, z: -39 }, { x: 4, z: -39 }, { x: 0, z: -37 },
    { x: -12, z: -28 }, { x: 12, z: -28 }, { x: -8, z: -32 }, { x: 8, z: -32 }, { x: 0, z: -26 },
    // 西货场
    { x: -39, z: -33 }, { x: -33, z: -28 }, { x: -24, z: -30 }, { x: -44, z: -24 }, { x: -32, z: -25 },
    // 东货场
    { x: 22, z: -33 }, { x: 29, z: -28 }, { x: 38, z: -30 }, { x: 22.6, z: -25.6 }, { x: 30, z: -27 },
    // A 长
    { x: 36, z: -19 }, { x: 36, z: -14 }, { x: 35, z: -4 }, { x: 36, z: 1 }, { x: 38, z: 4 },
    // 设备间
    { x: 28.2, z: -3 },
    // A 前广场
    { x: 18, z: 9 }, { x: 24, z: 9 }, { x: 33, z: 9 }, { x: 39, z: 9 },
    // A 点
    { x: 24, z: 14 }, { x: 30, z: 14 }, { x: 36, z: 14 }, { x: 24, z: 22 }, { x: 31.2, z: 22.6 }, { x: 34, z: 24 },
    // A 东平台 / 后巷
    { x: 40.9, z: 18 }, { x: 40.9, z: 27 }, { x: 26, z: 27 }, { x: 36, z: 27 },
    // 中路南段
    { x: 0, z: -20.4 }, { x: -6, z: -20 }, { x: 6, z: -20 }, { x: 0, z: -14 },
    // 堆场
    { x: -12, z: -10 }, { x: 12, z: -10 }, { x: 0, z: -8 }, { x: 3, z: -6 },
    { x: 12, z: 0 }, { x: -12, z: 1 }, { x: 0, z: 6 }, { x: 0, z: -3.6 },
    // 中路北段
    { x: -6, z: 12 }, { x: 6, z: 12 }, { x: -6, z: 18 }, { x: 6, z: 18 }, { x: 0, z: 20 }, { x: 0, z: 26 },
    // B 长
    { x: -36, z: -19 }, { x: -36, z: -16.4 }, { x: -36, z: -4 }, { x: -37.6, z: 0 }, { x: -38, z: 4 },
    // B 前院
    { x: -20.5, z: 10.4 }, { x: -24, z: 7.4 }, { x: -33, z: 9 }, { x: -37, z: 9 },
    // B 仓库
    { x: -21, z: 13.4 }, { x: -24.6, z: 15.4 }, { x: -33, z: 15 }, { x: -38, z: 15 },
    { x: -24.4, z: 20 }, { x: -30, z: 23.4 }, { x: -36, z: 21 },
    // B 后巷
    { x: -42, z: 27 }, { x: -24, z: 27 },
    // CT 走廊
    { x: -34, z: 31 }, { x: -22, z: 31 }, { x: -12, z: 31 }, { x: -6, z: 31 },
    { x: 6, z: 31 }, { x: 12, z: 31 }, { x: 22, z: 31 }, { x: 34, z: 31 },
    // CT 出生
    { x: 0, z: 42.4 }, { x: -7.4, z: 39 }, { x: 7.4, z: 39 }
  ];

  const sites = {
    A: { x: 30, z: 18, r: 6.2 },
    B: { x: -30, z: 19, r: 6.2 }
  };

  const buyZone = {
    minX: spawns.player.x - 10, maxX: spawns.player.x + 10,
    minZ: spawns.player.z - 5.5, maxZ: spawns.player.z + 5.5
  };

  const callouts = {
    tSpawn: { x: 0, z: -41 },
    tGate: { x: 0, z: -34 },
    tPlaza: { x: 0, z: -28 },
    tWest: { x: -30, z: -28 },
    tEast: { x: 30, z: -28 },
    aLong: { x: 36, z: -16 },
    aGate: { x: 36, z: -8 },
    aCrane: { x: 36, z: 12 },
    aYard: { x: 30, z: 9 },
    aSmall: { x: 14, z: 9.5 },
    aSite: { x: 30, z: 18 },
    aShed: { x: 24, z: 22 },
    aPlatform: { x: 41, z: 20 },
    aBack: { x: 28, z: 27 },
    bLong: { x: -36, z: -16 },
    bGate: { x: -40, z: -8 },
    bYard: { x: -30, z: 9 },
    bSmall: { x: -14, z: 9.5 },
    bSite: { x: -30, z: 19 },
    bWarehouse: { x: -37, z: 22 },
    bBack: { x: -28, z: 27 },
    containerYard: { x: 0, z: -6 },
    midNorth: { x: 0, z: 20 },
    ctHall: { x: 0, z: 31 },
    ctSpawn: { x: 0, z: 42 },
    ctWest: { x: -22, z: 31 },
    ctEast: { x: 22, z: 31 }
  };

  const stats = {
    placed: placed.length,
    covers: placed.filter((p) => p.tag === 'cover').length,
    buildings: placed.filter((p) => p.tag === 'building').length,
    props: placed.filter((p) => p.tag === 'prop').length,
    walls: placed.filter((p) => p.tag === 'wall').length,
    waypoints: waypoints.length,
    callouts: Object.keys(callouts).length,
    staticTris
  };

  return {
    root,
    world,
    placed,
    baseCount: placed.length,
    edits: opts.edits || null,
    id: 'harbor',
    name: '海港',
    sites,
    spawns,
    buyZone,
    bounds: { minX: -48, maxX: 48, minZ: -46, maxZ: 46 },
    waypoints,
    stats,
    callouts
  };
}
