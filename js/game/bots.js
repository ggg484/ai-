// 对局 Bot：T / CT 双阵营状态机（巡逻 / 交战 / 死亡）。
// 目标不是做「聪明 AI」，而是把感知、射线、命中、回合钩子跑通，方便后续替换。
// TODO(ai): 导航网格 A*、听觉、投掷物、下包/拆包、队伍角色。

import * as THREE from '../../vendor/three.module.js';
import { raySphere, rayBox } from '../world/collision.js';
import { audio } from '../core/audio.js';
import { buildHumanoid, animateHumanoid } from '../render/character.js';
import { createAvatar, animateAvatar } from '../render/avatar-glb.js';
import { applyFaction, factionOf } from '../render/unit-faction.js';
import { mergeGeos } from '../world/geo-utils.js';
import { normalizeCharRig, DEFAULT_CHAR_RIG } from '../render/rig.js';

const BODY_R = 0.29;
const BODY_TOP = 1.46;
const HEAD_Y = 1.62;
const HEAD_R = 0.17;

let seq = 0;
const teamSeq = { t: 0, ct: 0 };

function gunModel() {
  const parts = [];
  // 方块枪：Roblox 风格的硬边比例，总长约 0.66 m，配 0.72 m 的手臂刚好
  const receiver = new THREE.BoxGeometry(0.075, 0.10, 0.34);
  receiver.translate(0, 0, 0.02);
  parts.push(receiver);
  const barrel = new THREE.BoxGeometry(0.038, 0.038, 0.22);
  barrel.translate(0, 0.024, -0.26);
  parts.push(barrel);
  const gasBlock = new THREE.BoxGeometry(0.05, 0.07, 0.10);
  gasBlock.translate(0, 0.055, -0.20);
  parts.push(gasBlock);
  const mag = new THREE.BoxGeometry(0.05, 0.15, 0.075);
  mag.rotateX(0.18);
  mag.translate(0, -0.115, -0.02);
  parts.push(mag);
  const grip = new THREE.BoxGeometry(0.05, 0.10, 0.06);
  grip.rotateX(-0.35);
  grip.translate(0, -0.09, 0.10);
  parts.push(grip);
  const stock = new THREE.BoxGeometry(0.055, 0.085, 0.20);
  stock.translate(0, -0.015, 0.28);
  parts.push(stock);
  const guard = new THREE.BoxGeometry(0.06, 0.05, 0.12);
  guard.translate(0, -0.045, 0.02);
  parts.push(guard);
  const sight = new THREE.BoxGeometry(0.03, 0.045, 0.03);
  sight.translate(0, 0.075, -0.10);
  parts.push(sight);
  const g = mergeGeos(parts);
  parts.forEach((x) => x.dispose());
  const m = new THREE.MeshLambertMaterial({ color: 0x2f3438 });
  return new THREE.Mesh(g, m);
}

const ENEMY_TEAM = { t: 'ct', ct: 't' };

// 阶段 2：角色分工。按入场顺序轮转，保证每队三种角色都有人。
// entry 先手突破、anchor 守点不动、rotator 补位。
const ROLES = ['entry', 'anchor', 'rotator'];

/* ------------------------------------------------------------------ */
/* 运行时导航网格 + A*                                                 */
/* ------------------------------------------------------------------ */

// 网格不依赖地图预烘焙数据：直接把 world 的碰撞盒按 Bot 通行半径膨胀后投影到格子。
// 0.75 m 是「2 m 门口还能过」和「整图 2 万格以内」的折中；半径取 0.36（碰撞半径 0.29 + 余量）。
const NAV_STEP = 0.75;
const NAV_RADIUS = 0.36;
const NAV_STEP_UP = 0.35;      // 与 world.move 的 stepHeight 对齐：更矮的东西能直接踩上去
const NAV_BODY_H = 1.7;        // 通行净高：更高的横梁不挡路
const NAV_CLEAR_CAP = 3;       // 离墙距离上限，用于让路径尽量走走廊中间
const NAV_LIMIT = 26000;       // A* 单次展开上限，极端情况下宁可放弃也不卡帧
const NAV_SQRT2 = Math.SQRT2;

const NAV_DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, NAV_SQRT2], [1, -1, NAV_SQRT2], [-1, 1, NAV_SQRT2], [-1, -1, NAV_SQRT2]
];

const NAV_CACHE = new WeakMap();

/** 每个 world 只建一张导航网格；地图重建（工坊预览）会拿到新的 world，自然失效。 */
export function navFor(world) {
  if (!world) return null;
  let nav = NAV_CACHE.get(world);
  if (!nav) {
    nav = new NavGrid(world);
    NAV_CACHE.set(world, nav);
  }
  return nav;
}

export class NavGrid {
  /** @param world 有 boxes 或 colliders 的对象（世界碰撞盒是 AABB 数组） */
  constructor(world) {
    const boxes = (world && (world.boxes || world.colliders)) || [];

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minZ < minZ) minZ = b.minZ;
      if (b.maxZ > maxZ) maxZ = b.maxZ;
    }
    if (!Number.isFinite(minX)) { minX = -60; maxX = 60; minZ = -60; maxZ = 60; }

    const pad = 1.5;
    this.minX = minX - pad;
    this.minZ = minZ - pad;
    this.step = NAV_STEP;
    this.w = Math.max(1, Math.ceil((maxX + pad - this.minX) / NAV_STEP));
    this.h = Math.max(1, Math.ceil((maxZ + pad - this.minZ) / NAV_STEP));

    const n = this.w * this.h;
    this.walk = new Uint8Array(n);
    this.clear = new Uint8Array(n);

    // 只有「挡得住」的盒体才参与投影：能踩上去的台阶、头顶以上的横梁都不挡路。
    const solid = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.maxY <= NAV_STEP_UP || b.minY >= NAV_BODY_H) continue;
      solid.push(b);
    }

    this.walk.fill(1);
    for (let j = 0; j < this.h; j++) {
      const cz = this.minZ + (j + 0.5) * this.step;
      const row = j * this.w;
      for (let i = 0; i < this.w; i++) {
        const cx = this.minX + (i + 0.5) * this.step;
        for (let k = 0; k < solid.length; k++) {
          const b = solid[k];
          if (cx + NAV_RADIUS > b.minX && cx - NAV_RADIUS < b.maxX &&
              cz + NAV_RADIUS > b.minZ && cz - NAV_RADIUS < b.maxZ) {
            this.walk[row + i] = 0;
            break;
          }
        }
      }
    }

    this._buildClearance(n);
    this._alloc(n);
  }

  /** 从障碍物做一次 BFS，得到每格到最近墙的距离（封顶 NAV_CLEAR_CAP）。 */
  _buildClearance(n) {
    this.clear.fill(NAV_CLEAR_CAP);
    const q = [];
    for (let i = 0; i < n; i++) if (!this.walk[i]) { this.clear[i] = 0; q.push(i); }
    for (let head = 0; head < q.length; head++) {
      const idx = q[head];
      const d = this.clear[idx];
      if (d >= NAV_CLEAR_CAP - 1) continue;
      const i = idx % this.w;
      const j = (idx - i) / this.w;
      for (let k = 0; k < 4; k++) {
        const ni = i + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const nj = j + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h) continue;
        const nb = nj * this.w + ni;
        if (this.clear[nb] > d + 1) { this.clear[nb] = d + 1; q.push(nb); }
      }
    }
  }

  _alloc(n) {
    this._g = new Float32Array(n);
    this._from = new Int32Array(n);
    this._seen = new Int32Array(n);
    this._done = new Int32Array(n);
    this._cap = Math.max(256, n * 4);
    this._heap = new Int32Array(this._cap);
    this._hf = new Float32Array(this._cap);
    this._search = 0;
  }

  cellOf(x, z) {
    const i = Math.floor((x - this.minX) / this.step);
    const j = Math.floor((z - this.minZ) / this.step);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  cx(idx) { return this.minX + ((idx % this.w) + 0.5) * this.step; }
  cz(idx) { return this.minZ + (Math.floor(idx / this.w) + 0.5) * this.step; }

  isFree(x, z) {
    const c = this.cellOf(x, z);
    return c >= 0 && this.walk[c] === 1;
  }

  /** 起点/终点落在墙里时，向外找最近的可走格。 */
  _nearestOpen(idx, maxRing) {
    if (idx < 0) return -1;
    if (this.walk[idx]) return idx;
    const i0 = idx % this.w;
    const j0 = (idx - i0) / this.w;
    for (let r = 1; r <= maxRing; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          const i = i0 + di, j = j0 + dj;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const nb = j * this.w + i;
          if (this.walk[nb]) return nb;
        }
      }
    }
    return -1;
  }

  /**
   * A*。返回 [{x,z}] 世界坐标路径；不可达返回 null。
   * avoid 传 {x,z,r} 时给该圆内的格子加重代价，用来绕开卡住的位置。
   */
  path(sx, sz, tx, tz, avoid) {
    const s0 = this.cellOf(sx, sz);
    const t0 = this.cellOf(tx, tz);
    if (s0 < 0 || t0 < 0) return null;

    const start = this._nearestOpen(s0, 4);
    // 目标常常落在大障碍里（比如包点是 0.58 m 的高台），吸附半径要够大才找得到落脚点
    const goal = this._nearestOpen(t0, 14);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, z: tz }];

    let avI = -1, avJ = -1, avR = 0;
    if (avoid) {
      const ac = this.cellOf(avoid.x, avoid.z);
      if (ac >= 0) {
        avI = ac % this.w;
        avJ = (ac - avI) / this.w;
        avR = Math.max(1, Math.ceil((avoid.r || 1) / this.step));
      }
    }

    const search = ++this._search;
    const W = this.w;
    const g = this._g, from = this._from, seen = this._seen, done = this._done;
    const clear = this.clear, walk = this.walk;
    const gi = goal % W, gj = (goal - gi) / W;

    // 二分堆，元素是格子下标，权重另存一份，避免对象分配。
    const heap = this._heap, hf = this._hf;
    let hs = 0;

    const push = (idx, f) => {
      let k = hs++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (hf[p] <= f) break;
        heap[k] = heap[p]; hf[k] = hf[p]; k = p;
      }
      heap[k] = idx; hf[k] = f;
    };
    const pop = () => {
      const top = heap[0];
      const lastI = heap[--hs], lastF = hf[hs];
      let k = 0;
      while (true) {
        let c = k * 2 + 1;
        if (c >= hs) break;
        if (c + 1 < hs && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lastF) break;
        heap[k] = heap[c]; hf[k] = hf[c]; k = c;
      }
      heap[k] = lastI; hf[k] = lastF;
      return top;
    };

    // 启发函数：八方向 octile 距离
    const hOf = (idx) => {
      const i = idx % W, j = (idx - i) / W;
      const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
      return (dx + dz) + (NAV_SQRT2 - 2) * Math.min(dx, dz);
    };

    seen[start] = search;
    g[start] = 0;
    from[start] = -1;
    push(start, hOf(start));

    let expanded = 0;
    let found = false;
    while (hs > 0) {
      const cur = pop();
      if (done[cur] === search) continue;
      done[cur] = search;
      if (cur === goal) { found = true; break; }
      if (++expanded > NAV_LIMIT) break;

      const ci = cur % W;
      const cj = (cur - ci) / W;
      const baseG = g[cur];

      for (let d = 0; d < 8; d++) {
        const dir = NAV_DIRS[d];
        const ni = ci + dir[0];
        const nj = cj + dir[1];
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nb = nj * W + ni;
        if (!walk[nb] || done[nb] === search) continue;
        // 禁止贴角切弯：斜向只有在两个正交邻格都可走时才允许
        if (dir[0] !== 0 && dir[1] !== 0) {
          if (!walk[cj * W + ni] || !walk[nj * W + ci]) continue;
        }

        // 走廊居中：贴墙格加价，让路径自然落在门口中线
        let cost = dir[2] + Math.max(0, NAV_CLEAR_CAP - clear[nb]) * 0.45;
        if (avR > 0 && Math.abs(ni - avI) <= avR && Math.abs(nj - avJ) <= avR) cost += 6;

        const ng = baseG + cost;
        if (seen[nb] !== search || ng < g[nb]) {
          seen[nb] = search;
          g[nb] = ng;
          from[nb] = cur;
          if (hs >= this._cap - 1) continue;   // 堆满就丢弃，宁可路径差一点也不能崩
          push(nb, ng + hOf(nb));
        }
      }
    }

    if (!found) return null;

    const cells = [];
    for (let c = goal; c >= 0; c = from[c]) cells.push(c);
    cells.reverse();

    const pts = this._smooth(cells);
    // 终点用真实坐标收尾（目标点本身可走时），避免停在格子中心差半米
    if (this.isFree(tx, tz)) pts.push({ x: tx, z: tz });
    return pts;
  }

  /** 视线内能直连的路径点合并；但门口这类窄格必须保留，避免切角卡门框。 */
  _smooth(cells) {
    const pts = [];
    const clear = this.clear;
    let i = 0;
    pts.push({ x: this.cx(cells[0]), z: this.cz(cells[0]) });
    while (i < cells.length - 1) {
      let best = i + 1;
      for (let j = i + 2; j < cells.length; j++) {
        let must = false;
        for (let k = i + 1; k < j; k++) {
          if (clear[cells[k]] <= 1) { must = true; break; }
        }
        if (must) break;
        if (!this._lineClear(cells[i], cells[j])) break;
        best = j;
      }
      pts.push({ x: this.cx(cells[best]), z: this.cz(cells[best]) });
      i = best;
    }
    return pts;
  }

  _lineClear(a, b) {
    const W = this.w;
    const i0 = a % W, j0 = (a - i0) / W;
    const i1 = b % W, j1 = (b - i1) / W;
    const di = i1 - i0, dj = j1 - j0;
    const steps = Math.max(Math.abs(di), Math.abs(dj)) * 2;
    if (steps === 0) return true;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const i = Math.round(i0 + di * t);
      const j = Math.round(j0 + dj * t);
      if (!this.walk[j * W + i]) return false;
    }
    return true;
  }

  stats() {
    let free = 0;
    for (let i = 0; i < this.walk.length; i++) if (this.walk[i]) free++;
    return { w: this.w, h: this.h, step: this.step, cells: this.walk.length, free };
  }
}

export class Bot {
  /**
   * @param {THREE.Scene} scene
   * @param {{x:number,z:number,yaw?:number,waypoint?:number}} spawn
   * @param {object} world
   * @param {{team?:'t'|'ct'}} opts
   */
  constructor(scene, spawn, world, opts) {
    const o = opts || {};
    this.id = 'bot' + (++seq);
    this.team = o.team === 't' ? 't' : 'ct';
    this.enemyTeam = ENEMY_TEAM[this.team];
    this.rig = normalizeCharRig(o.rig || DEFAULT_CHAR_RIG);
    this.label = (this.team === 't' ? 'T-' : 'CT-') + (++teamSeq[this.team]);
    this.role = ROLES[(teamSeq[this.team] - 1) % ROLES.length];
    this.objective = null;   // 由 round.js 下发：{ type: 'plant' | 'defuse', x, z }
    this.holding = false;    // 已到目标点并站定（下包 / 拆包判定用）
    this.world = world;
    // 导航网格按 world 缓存，9 个 Bot 共用一张，只在首个 Bot 构造时建一次。
    this.nav = navFor(world);
    this.spawn = { x: spawn.x, z: spawn.z, yaw: spawn.yaw || 0 };
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.vel = new THREE.Vector3();
    this.hp = 100;
    this.alive = true;
    this.grounded = true;
    this.shootCd = 1.2 + Math.random() * 0.8;
    this.reaction = 0;
    this.spawnWaypoint = spawn.waypoint != null ? spawn.waypoint : (seq * 3) % 8;
    this.waypoint = this.spawnWaypoint;
    this.stuck = 0;
    this.lastPos = this.pos.clone();
    // 导航状态：path 是平滑后的世界坐标折线，pathI 是当前追的点
    this.path = [];
    this.pathI = 0;
    this.pathT = 0;
    this._avoid = null;
    this._stuckStage = 0;
    this._wasEngage = false;
    this.engage = false;
    this.flashT = 0;
    this.hitT = 0;
    this.muzzleT = 0;
    this.shootAnim = 0;
    this.reloadT = 0;
    this.reloadCd = 8 + Math.random() * 7;
    this.crouch = false;
    this.crouchT = 0;
    this.aimed = false;
    this.deadT = 0;
    this.kills = 0;
    this.deaths = 0;

    this.group = new THREE.Group();
    this.group.name = this.id;
    this.avatar = null;
    this.avatarHand = null;
    this.weaponMount = null;

    this.humanoid = buildHumanoid({ helmet: true, cloneMats: true });
    applyFaction(this.humanoid, this.team);
    // Roblox 方块人的手臂枢轴在肩 (y=1.44)，向前抬起约 77°
    this.humanoid.userData.parts.armR.rotation.x = 1.35;
    this.humanoid.userData.parts.armR.rotation.z = -0.06;
    this.group.add(this.humanoid);
    this.bodyMat = this.humanoid.userData.parts.torso.material;

    const gun = gunModel();
    // 枪挂在右臂末端：局部 -Z 是枪口，绕 -90° 后沿手臂方向（即正前方）指出
    gun.position.set(0.03, -0.60, -0.02);
    gun.rotation.x = -Math.PI / 2;
    gun.castShadow = true;
    this.humanoid.userData.parts.armR.add(gun);
    this.gun = gun;

    // 枪口焰：两片交叉面片，正面/侧面都看得到
    this.flash = new THREE.Group();
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffc070, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    for (let i = 0; i < 2; i++) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), flashMat);
      q.rotation.y = i * Math.PI / 2;
      this.flash.add(q);
    }
    this.flash.position.set(0, -0.98, -0.02);
    this.flash.rotation.x = Math.PI / 2;
    this.flash.visible = false;
    this.humanoid.userData.parts.armR.add(this.flash);

    // 开火补光由 game 统一管理一盏共享灯，避免每个 Bot 都点一次光（移动端光源成本高）
    this.muzzleT = 0;

    // 瞄准标记：玩家准星指到该单位时出现（阵营色菱形）
    const f = factionOf(this.team);
    this.marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.055),
      new THREE.MeshBasicMaterial({
        color: f.markerHex,
        depthTest: false, transparent: true, opacity: 0.95
      })
    );
    this.marker.position.set(0, 1.88, 0);
    this.marker.renderOrder = 999;
    this.marker.visible = false;
    this.group.add(this.marker);

    // 受击反馈：轮廓光晕（背面球壳）。不用整体 emissive 染色，
    // 否则阵营色会被红光冲掉，远看分不清敌我。
    this.hitGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff5a34, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide
      })
    );
    this.hitGlow.position.set(0, 1.12, 0);
    this.hitGlow.visible = false;
    this.group.add(this.hitGlow);

    this.group.position.copy(this.pos);
    scene.add(this.group);

    this._qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.04, 0, 0));
    this._mountOffset = new THREE.Vector3(0, 0.07, -0.06);
    this._handPos = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._targetEye = new THREE.Vector3();
  }

  /**
   * 换成 GLB 角色（骨骼 + 动作）。命中盒、AI、移动参数都不动。
   * 模型未加载成功时返回 false，继续用程序化方块人。
   */
  setAvatar(factionKey) {
    if (this.avatar) return true;
    const av = createAvatar(factionKey || this.team);
    if (!av) return false;

    const p = this.humanoid.userData.parts;
    p.armR.remove(this.gun);
    p.armR.remove(this.flash);
    this.group.remove(this.humanoid);

    this.group.add(av.root);
    this.humanoid = av.root;
    this.avatar = av;
    this.avatarHand = av.hand;
    this.bodyMat = av.mats.shirt;
    av.pose = this.rig.pose;
    av.crouchDrop = this.rig.crouchDrop;
    av.root.scale.setScalar((av.fitScale || 1) * this.rig.scale);
    av.root.position.y = (av.fitDrop || 0) * this.rig.scale;
    this._mountOffset.fromArray(this.rig.mount.offset);
    this._qTilt.setFromEuler(new THREE.Euler(
      this.rig.mount.tilt[0], this.rig.mount.tilt[1], this.rig.mount.tilt[2]
    ));

    // 枪挂点放在角色根节点下：位置每帧跟随右手骨骼，朝向固定在身体正前方。
    // 不直接挂到骨骼上，避免这个 GLB 内部的 100× 缩放把枪压成玩具尺寸。
    const mount = new THREE.Group();
    if (av.hand) {
      this.group.add(mount);
      mount.position.set(0.26, 1.25, -0.18);
    } else {
      mount.position.set(0.3, 1.25, -0.06);
      this.group.add(mount);
    }
    this.gun.position.set(0, 0.07, -0.06);
    this.gun.rotation.set(0, 0, 0);
    mount.add(this.gun);
    this.flash.position.set(0, 0.03, -0.46);
    this.flash.rotation.set(0, 0, 0);
    mount.add(this.flash);
    this.weaponMount = mount;

    // 出场姿态：立刻摆正持枪姿势（冻结时间也保持）
    if (av.action) {
      av.action.paused = true;
      av.action.time = 0;
      av.mixer.update(0);
    }
    animateAvatar(av, 0, 0, { engage: false });
    this._updateMount();
    return true;
  }

  reset() {
    this.objective = null;
    this.holding = false;
    this.pos.set(this.spawn.x, 0, this.spawn.z);
    this.vel.set(0, 0, 0);
    this.hp = 100;
    this.alive = true;
    this.deadT = 0;
    this.shootCd = 1.2 + Math.random() * 0.8;
    this.reaction = 0;
    this.engage = false;
    this.hitT = 0;
    this.muzzleT = 0;
    this.shootAnim = 0;
    this.reloadT = 0;
    this.reloadCd = 8 + Math.random() * 7;
    this.crouch = false;
    this.crouchT = 0;
    this.aimed = false;
    this.waypoint = this.spawnWaypoint;
    this.path = [];
    this.pathI = 0;
    this.pathT = 0;
    this._avoid = null;
    this._stuckStage = 0;
    this._wasEngage = false;
    this.marker.visible = false;
    this.group.visible = true;
    this.group.rotation.set(0, (this.spawn.yaw || 0) + Math.PI, 0);
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(1);
    this.bodyMat.emissive.setHex(0x000000);
    this.hitGlow.visible = false;
    this.hitGlow.material.opacity = 0;
    if (this.weaponMount) this.weaponMount.visible = true;
    const p = this.humanoid.userData.parts;
    if (p) {
      p.armL.rotation.set(0, 0, 0);
      p.armR.rotation.set(1.35, 0, -0.06);
      p.legL.rotation.set(0, 0, 0);
      p.legR.rotation.set(0, 0, 0);
    }
    if (this.avatar) {
      this.avatar._idle = false;
      if (this.avatar.action) {
        this.avatar.action.paused = true;
        this.avatar.action.time = 0;
        this.avatar.mixer.update(0);
      }
      animateAvatar(this.avatar, 0, 0, { engage: false });
      this._updateMount();
    }
  }

  eye(out) {
    return (out || new THREE.Vector3()).set(this.pos.x, this.pos.y + 1.55, this.pos.z);
  }

  /** 选择最近的可见敌人；ctx = { player, playerTeam, tBots, ctBots }。 */
  _pickTarget(ctx) {
    const playerTeam = ctx.playerTeam || 't';
    const list = [];
    // 玩家只有在敌方阵营时才进入目标列表；半场交换后玩家可能是 CT。
    if (ctx.player && ctx.player.alive && playerTeam !== this.team) {
      list.push({ unit: ctx.player, player: true });
    }
    if (this.team === 'ct') {
      for (const b of ctx.tBots || []) if (b.alive) list.push({ unit: b, player: false });
    } else {
      for (const b of ctx.ctBots || []) if (b.alive) list.push({ unit: b, player: false });
    }
    let best = null;
    let bestD = 1e9;
    for (const item of list) {
      const u = item.unit;
      const px = item.player ? u.position.x : u.pos.x;
      const pz = item.player ? u.position.z : u.pos.z;
      const d = Math.hypot(px - this.pos.x, pz - this.pos.z);
      if (d >= 44 || d >= bestD) continue;
      const pe = item.player ? u.eye(new THREE.Vector3()) : u.eye(new THREE.Vector3());
      if (!this.world.lineOfSight(this.pos.x, this.pos.y + 1.55, this.pos.z, pe.x, pe.y, pe.z)) continue;
      bestD = d;
      best = { unit: u, player: item.player, dist: d, eye: pe };
    }
    return best;
  }

  update(dt, ctx, waypoints, cb) {
    if (!this.alive) {
      this.deadT += dt;
      if (this.deadT > 2.2) this.group.visible = false;
      return;
    }

    this.flashT = Math.max(0, this.flashT - dt);
    this.hitT = Math.max(0, this.hitT - dt);
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    this.shootAnim = Math.max(0, this.shootAnim - dt * 5.5);
    this.reloadT = Math.max(0, this.reloadT - dt);
    this.crouchT = Math.max(0, this.crouchT - dt);
    this.crouch = this.crouchT > 0;
    this.flash.visible = this.muzzleT > 0;
    // 受击反馈走轮廓光晕，bodyMat 只在被瞄准时给一点冷色，阵营色保持可读
    this.bodyMat.emissive.setHex(this.aimed ? 0x0c2430 : 0x000000);
    this.hitGlow.visible = this.hitT > 0;
    if (this.hitGlow.visible) {
      const k = this.hitT / 0.28;
      this.hitGlow.material.opacity = 0.55 * k;
      const s = 1.0 + (1 - k) * 0.35;
      this.hitGlow.scale.set(s, s * 1.25, s);
    }
    this.marker.visible = this.alive && this.aimed;

    const target = this._pickTarget(ctx);
    const canSee = !!target;
    this.engage = canSee;
    let moveX = 0, moveZ = 0, speed = 0;
    let faceYaw = this.group.rotation.y;

    if (canSee) {
      this.reaction += dt;
      const dx = target.eye.x - this.pos.x;
      const dz = target.eye.z - this.pos.z;
      const dist = target.dist;
      // 中远距离蹲下压枪，缩短暴露面积
      if (dist > 14 && this.crouchT <= 0 && Math.random() < dt * 0.25) this.crouchT = 2.2 + Math.random();
      faceYaw = Math.atan2(dx, dz) + Math.PI;
      // 角色差异只体现在「贴还是守」上，命中率与伤害不动，避免变成数值游戏
      const keep = this.role === 'entry'
        ? (dist > 5 ? 1 : -1)
        : this.role === 'anchor'
          ? (dist < 11 ? -1 : 0)
          : (dist < 8 ? -1 : (dist > 20 ? 1 : 0));
      const strafe = Math.sin(performance.now() * 0.0016 + this.pos.x) * 0.55;
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      moveX = nx * keep + (-nz) * strafe;
      moveZ = nz * keep + nx * strafe;
      speed = this.role === 'entry' ? 2.5 : (this.role === 'anchor' ? 1.85 : 2.1);

      this.reloadCd -= dt;
      if (this.reloadT <= 0 && this.reloadCd <= 0) {
        this.reloadT = 1.15;
        this.reloadCd = 9 + Math.random() * 6;
        this.shootCd = Math.max(this.shootCd, 1.2);
        if (cb.onBotReload) cb.onBotReload(this);
      }
      if (this.reloadT > 0) {
        this.shootCd = Math.max(this.shootCd, 1.2);
      } else {
        this.shootCd -= dt;
        if (this.shootCd <= 0 && this.reaction > 0.35) {
          this.shootCd = (this.crouch ? 1.35 : 1.05) + Math.random() * 0.55;
          this.muzzleT = 0.06;
          this.shootAnim = 1;
          this.flash.visible = true;
          // 回调要的是「被打的单位」本身（Bot 或 player），不是 _pickTarget 的包装对象：
          // game._onBotShoot 里直接调 target.eye()/target.damage()，传包装对象会 TypeError。
          cb.onBotShoot(this, this._rollShot(this.eye(this._eye), target.eye, dist, target.player), target.unit);
        }
      }
    } else {
      this.reaction = 0;
      // 追人时走的不是导航路径，脱战瞬间原路径已经过时，直接作废重算
      if (this._wasEngage) {
        this.path.length = 0;
        this.pathT = 0;
      }
      const steer = this.objective
        ? this._steerToObjective(dt)
        : this._steerToGoal(dt, waypoints);
      moveX = steer.x;
      moveZ = steer.z;
      speed = steer.speed;
      faceYaw = steer.yaw;
    }
    this._wasEngage = canSee;

    const len = Math.hypot(moveX, moveZ);
    if (len > 0.01) {
      this.vel.x = moveX / len * speed;
      this.vel.z = moveZ / len * speed;
    } else {
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
    }
    this.vel.y -= 15.5 * dt;
    this.grounded = this.world.move(this.pos, this.vel, dt, BODY_R, 1.7, 0.3, this.grounded);

    const moved = this.pos.distanceTo(this.lastPos);
    this.lastPos.copy(this.pos);
    // 阈值必须按「本帧应有的位移」算：写死米数会把 60 fps 下的正常行走误判成卡住。
    const want = len > 0.01 ? speed * dt : 0;
    if (want > 0.001 && moved < Math.max(0.004, want * 0.4)) {
      this.stuck += dt;
      // 卡住分两级：0.45 s 先把脚下当成临时障碍重算路径；1.6 s 还没动静就换航点。
      // 两级合起来保证 < 2 s 一定能恢复，不会出现 Bot 顶墙站一回合。
      if (this._stuckStage === 0 && this.stuck > 0.45) {
        this._stuckStage = 1;
        this._avoid = { x: this.pos.x, z: this.pos.z, r: 1.1 };
        this.path.length = 0;
        this.pathT = 0;
      } else if (this.stuck > 1.6) {
        this._stuckStage = 0;
        this.stuck = 0;
        this._avoid = null;
        this.waypoint++;
        this.path.length = 0;
        this.pathT = 0;
      }
    } else {
      this.stuck = 0;
      this._stuckStage = 0;
      this._avoid = null;
    }

    // 平滑转向，避免瞬间「贴脸转圈」
    let dy = faceYaw - this.group.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.group.rotation.y += dy * Math.min(1, dt * 10);

    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    const animOpts = {
      engage: canSee,
      shoot: this.shootAnim,
      reload: this.reloadT > 0 ? 1 - Math.abs(this.reloadT / 1.15 - 0.5) * 2 : 0,
      crouch: this.crouch
    };
    if (this.avatar) {
      animateAvatar(this.avatar, dt, hspeed, animOpts);
      this._updateMount();
    } else {
      animateHumanoid(this.humanoid, dt, len > 0.01 ? speed : 0, this.engage);
    }
    this.group.position.copy(this.pos);
  }

  /** 巡逻：沿 A* 路径走向当前航点，到点后换下一个。 */
  _steerToGoal(dt, waypoints) {
    const out = { x: 0, z: 0, speed: 0, yaw: this.group.rotation.y };
    this.holding = false;
    const list = waypoints;
    if (!list || !list.length) return out;

    const n = list.length;
    let goal = list[((this.waypoint % n) + n) % n];

    // 到点（1.6 m 容差）：换下一个航点
    if (Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z) < 1.6) {
      this.waypoint++;
      this.path.length = 0;
      goal = list[((this.waypoint % n) + n) % n];
    }

    this.pathT -= dt;
    if (!this.path.length && this.pathT <= 0) this._buildPath(goal);

    // 追当前路径点；到 0.5 m 内就切下一个
    let tx = goal.x;
    let tz = goal.z;
    while (this.pathI < this.path.length) {
      const p = this.path[this.pathI];
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > 0.5) { tx = p.x; tz = p.z; break; }
      this.pathI++;
    }

    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return out;

    out.x = dx / d;
    out.z = dz / d;
    // 门口/贴墙处收一点速度，减少撞门框后反复重试
    const cell = this.nav ? this.nav.cellOf(this.pos.x, this.pos.z) : -1;
    out.speed = (cell >= 0 && this.nav.clear[cell] <= 1) ? 1.55 : 2.2;
    out.yaw = Math.atan2(out.x, out.z) + Math.PI;
    return out;
  }

  /** 任务点导航：走到目标点后站定，由 round.js 推进下包 / 拆包进度。 */
  _steerToObjective(dt) {
    const out = { x: 0, z: 0, speed: 0, yaw: this.group.rotation.y };
    const o = this.objective;
    if (!o) return out;
    const d = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
    if (d < 0.9) {
      this.holding = true;
      this.path.length = 0;
      this.pathI = 0;
      return out;                       // 站定，不再产生位移
    }
    this.holding = false;
    this.pathT -= dt;
    if (!this.path.length && this.pathT <= 0) this._buildPath(o);

    let tx = o.x, tz = o.z;
    while (this.pathI < this.path.length) {
      const p = this.path[this.pathI];
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > 0.45) { tx = p.x; tz = p.z; break; }
      this.pathI++;
    }
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const dd = Math.hypot(dx, dz);
    if (dd < 0.001) return out;
    out.x = dx / dd;
    out.z = dz / dd;
    out.speed = 2.35;                   // 下包 / 拆包有硬时限，跑得比巡逻快一点
    out.yaw = Math.atan2(out.x, out.z) + Math.PI;
    return out;
  }

  _buildPath(goal) {
    this.pathT = 0.6;                        // 算失败也别每帧重算
    const pts = this.nav
      ? this.nav.path(this.pos.x, this.pos.z, goal.x, goal.z, this._avoid)
      : null;
    this._avoid = null;
    // 起点格心通常在 Bot 身后：留着会让它先倒退半步，直接丢掉
    if (pts && pts.length > 1 &&
        Math.hypot(pts[0].x - this.pos.x, pts[0].z - this.pos.z) < 1.2) pts.shift();
    this.path = pts || [];
    this.pathI = 0;
  }

  /** 枪始终握在右手：位置跟随手骨，朝向固定在身体正前方。 */
  _updateMount() {
    if (!this.avatarHand || !this.weaponMount) return;
    this.group.updateMatrixWorld(true);
    this.avatarHand.getWorldPosition(this._handPos);
    this.group.worldToLocal(this._handPos);
    this.weaponMount.position.copy(this._handPos).add(this._mountOffset);
    this.weaponMount.quaternion.copy(this._qTilt);
  }

  _rollShot(eye, pe, dist, isPlayer) {
    const spread = 0.012 + dist * 0.0011;
    const dir = new THREE.Vector3(pe.x - eye.x, pe.y - eye.y, pe.z - eye.z).normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, (Math.random() - 0.5) * spread * 2);
    dir.addScaledVector(up, (Math.random() - 0.5) * spread * 2);
    dir.normalize();

    const chest = pe.clone(); chest.y = pe.y - 0.12;
    const t1 = raySphere(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, chest.x, chest.y, chest.z, 0.34);
    const t2 = raySphere(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, pe.x, pe.y - 0.55, pe.z, 0.34);
    const t = (t1 >= 0 && (t2 < 0 || t1 < t2)) ? t1 : t2;
    const head = Math.random() < (isPlayer ? 0.05 : 0.08);
    const hit = t >= 0 && t < dist + 1.2;
    return { hit: hit, head: hit && head, dist: dist, dir: dir, origin: eye.clone() };
  }

  /** 射线 vs Bot 的命中盒，返回 {t, head} 或 null。 */
  hitTest(ox, oy, oz, dx, dy, dz, maxDist) {
    if (!this.alive) return null;
    const th = raySphere(ox, oy, oz, dx, dy, dz, this.pos.x, this.pos.y + HEAD_Y, this.pos.z, HEAD_R);
    const tb = rayBox(
      ox, oy, oz, dx, dy, dz,
      this.pos.x - BODY_R, this.pos.y + 0.25, this.pos.z - BODY_R,
      this.pos.x + BODY_R, this.pos.y + BODY_TOP, this.pos.z + BODY_R,
      maxDist
    );
    if (th >= 0 && th <= maxDist && (tb < 0 || th <= tb)) return { t: th, head: true, bot: this };
    if (tb >= 0) return { t: tb, head: false, bot: this };
    return null;
  }

  damage(amount, head) {
    if (!this.alive) return false;
    this.hp -= amount * (head ? 4 : 1);
    this.hitT = 0.28;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths++;
      this.deadT = 0;
      // 侧倒 + 微微沉入地面；同时把枪藏起来，避免尸体举枪
      this.group.rotation.z = -Math.PI / 2;
      this.group.position.y = 0.25;
      if (this.weaponMount) this.weaponMount.visible = false;
      audio.play(head ? 'headshot' : 'hit', { volume: 0.8 });
      return true;
    }
    audio.play('hit', { volume: 0.5 });
    return false;
  }
}
