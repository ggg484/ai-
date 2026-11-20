// 大厅人流：实例化人形 + 分层配色。
// 目标不是「AI」，而是让大厅在低 draw call 下同时出现几百人，并且一眼能看出收藏等级。

import * as THREE from '../../vendor/three.module.js';
import { crowdGeometries } from '../render/character.js';
import { material } from '../world/textures.js';

const PALETTE = [
  [0.62, 0.60, 0.53], [0.34, 0.44, 0.55], [0.5, 0.47, 0.4],
  [0.28, 0.3, 0.28], [0.68, 0.55, 0.44], [0.42, 0.24, 0.24],
  [0.55, 0.5, 0.42], [0.26, 0.34, 0.38], [0.46, 0.38, 0.48],
  [0.58, 0.52, 0.34]
];

const WALK_NODES = [
  [-24, 16], [-16, 12], [-8, 17], [0, 14], [8, 17], [16, 12], [24, 16],
  [-24, 6], [-14, 4], [-6, 8], [6, 8], [14, 4], [24, 6],
  [-24, -6], [-16, -10], [-8, -14], [0, -12], [8, -14], [16, -10], [24, -6],
  [-20, 20], [20, 20], [-26, 0], [26, 0]
];

const BROWSER_SPOTS = [
  [-23.6, -4.2], [-23.6, -2.0], [-23.6, 0.2], [-23.6, 2.2],
  [-23.6, 4.4], [-23.6, 6.6], [-23.6, 8.2]
];

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** 远景人形贴图：2 个三角形一个人，把同屏人数拉上去而几乎不增加 GPU 负担。 */
function farPersonTexture() {
  const w = 96, h = 192;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.clearRect(0, 0, w, h);
  // 脚下软阴影
  const sh = x.createRadialGradient(w / 2, h - 7, 2, w / 2, h - 7, 26);
  sh.addColorStop(0, 'rgba(0,0,0,.55)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = sh;
  x.beginPath(); x.ellipse(w / 2, h - 7, 26, 6, 0, 0, Math.PI * 2); x.fill();

  const grad = x.createLinearGradient(0, 18, 0, h - 10);
  grad.addColorStop(0, '#c8c2b6');
  grad.addColorStop(0.45, '#9a958a');
  grad.addColorStop(1, '#55524b');
  x.fillStyle = grad;
  // 头
  x.beginPath(); x.arc(w / 2, 34, 13, 0, Math.PI * 2); x.fill();
  // 躯干
  x.beginPath();
  x.moveTo(31, 52); x.quadraticCurveTo(w / 2, 43, 65, 52);
  x.lineTo(69, 118); x.quadraticCurveTo(w / 2, 128, 27, 118);
  x.closePath(); x.fill();
  // 腿
  x.fillRect(36, 114, 10, 66);
  x.fillRect(52, 114, 10, 66);
  // 手臂
  x.fillRect(21, 56, 9, 58);
  x.fillRect(66, 56, 9, 58);
  // 枪带 / 轮廓
  x.strokeStyle = 'rgba(28,26,22,.55)';
  x.lineWidth = 3;
  x.beginPath(); x.moveTo(32, 62); x.lineTo(66, 108); x.stroke();
  x.strokeStyle = 'rgba(40,36,30,.35)';
  x.lineWidth = 2;
  x.beginPath(); x.moveTo(31, 52); x.lineTo(69, 52); x.stroke();
  // 头盔/帽
  x.fillStyle = 'rgba(235,230,220,.55)';
  x.beginPath(); x.arc(w / 2, 33, 14, Math.PI, Math.PI * 2); x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

function isBlocked(x, z) {
  if (Math.hypot(x, z + 2) < 5.4) return true; // 中央陈列柱
  const pedestals = [[-7.2, 0.5], [7.2, 0.5], [-7.2, -8.5], [7.2, -8.5]];
  for (const p of pedestals) if (Math.hypot(x - p[0], z - p[1]) < 2.6) return true;
  if (z < -16.5) return true; // 看台下方留给楼梯
  if (Math.hypot(x - 12, z - 11.5) < 5.8) return true; // 战术道具展台
  return false;
}

export class Crowd {
  constructor(lobby, opts) {
    this.lobby = lobby;
    this.opts = opts || {};
    const q = this.opts.quality || 'medium';
    this.mobile = !!this.opts.mobile;
    const profiles = {
      low: { detail: 110, far: 170, hz: 10 },
      medium: { detail: this.mobile ? 96 : 240, far: this.mobile ? 332 : 280, hz: this.mobile ? 12 : 18 },
      high: { detail: this.mobile ? 150 : 340, far: this.mobile ? 370 : 380, hz: this.mobile ? 16 : 24 }
    };
    this.profiles = profiles;
    const prof = profiles[q] || profiles.medium;
    const base = this.opts.count != null ? this.opts.count : prof.detail;
    this.count = base;
    this.farCapacity = Math.max(prof.far, 40);
    this.farCount = this.opts.far != null ? Math.min(this.opts.far, this.farCapacity) : prof.far;
    this.updateHz = prof.hz;
    this.animateIdle = !this.mobile && q !== 'low';

    const geo = crowdGeometries(true);
    const fabric = material('fabric', { repeat: 3, roughness: 0.9 });
    if (this.mobile || q === 'low') {
      // 中端手机：Lambert 比 Standard 便宜一大截，远看几乎无差别
      this.outfitMat = new THREE.MeshLambertMaterial({
        map: fabric.map, vertexColors: true, color: 0xffffff, emissive: 0x3a342c
      });
      this.skinMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff, emissive: 0x3a2a20 });
    } else {
      this.outfitMat = fabric.clone();
      this.outfitMat.vertexColors = true;
      this.outfitMat.metalness = 0.03;
      this.outfitMat.roughness = 0.9;
      this.outfitMat.emissive = new THREE.Color(0x18140f);
      this.outfitMat.emissiveIntensity = 0.5;
      this.skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 });
      this.skinMat.emissive = new THREE.Color(0x20160f);
      this.skinMat.emissiveIntensity = 0.45;
    }

    this.members = [];
    this.vips = [];

    // 静态浏览展柜的人
    const browsers = BROWSER_SPOTS.map(([x, z]) => ({
      x: x, y: 0, z: z, yaw: -Math.PI / 2, speed: 0, idle: true,
      scale: 0.96 + Math.random() * 0.08, tier: Math.random() < 0.3 ? 2 : 1,
      phase: Math.random() * Math.PI * 2, helmet: Math.random() < 0.25, tx: x, tz: z
    }));

    // 看台上的典藏家/收藏家
    const balcony = [];
    for (let i = 0; i < 22; i++) {
      const x = -24 + i * 2.3;
      if (Math.abs(x) > 24) continue;
      balcony.push({
        x: x, y: 5.4, z: -20.2 + (i % 2) * 0.5, yaw: 0, speed: 0, idle: true,
        scale: 0.98 + Math.random() * 0.06, tier: i % 3 === 0 ? 3 : 2,
        phase: Math.random() * Math.PI * 2, helmet: i % 2 === 0, tx: x, tz: -20.2
      });
    }

    // 游走人群
    const walkers = [];
    const need = Math.max(12, base - browsers.length - balcony.length);
    let guard = 0;
    while (walkers.length < need && guard < need * 40) {
      guard++;
      const node = WALK_NODES[(Math.random() * WALK_NODES.length) | 0];
      const x = node[0] + (Math.random() - 0.5) * 8;
      const z = node[1] + (Math.random() - 0.5) * 6;
      if (isBlocked(x, z)) continue;
      if (Math.hypot(x, z - 19) < 3.5) continue;
      const tierRoll = Math.random();
      walkers.push({
        x: x, z: z, y: 0, yaw: Math.random() * Math.PI * 2, speed: 0.65 + Math.random() * 0.8,
        idle: false, scale: 0.92 + Math.random() * 0.14,
        tier: tierRoll < 0.05 ? 3 : tierRoll < 0.2 ? 2 : tierRoll < 0.55 ? 1 : 0,
        phase: Math.random() * Math.PI * 2,
        helmet: Math.random() < 0.55,
        tx: x, tz: z, wait: Math.random() * 3
      });
    }

    // 中央展位前的典藏家固定席位：形成一圈一眼可见的「氪金玩家」
    const elites = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.18;
      const x = Math.cos(a) * 5.6;
      const z = -2 + Math.sin(a) * 5.6;
      elites.push({
        x: x, y: 0, z: z, yaw: Math.atan2(-x, -2 - z), speed: 0, idle: true,
        scale: 1.02 + Math.random() * 0.06, tier: 3,
        phase: Math.random() * Math.PI * 2, helmet: i % 2 === 0, tx: x, tz: z
      });
    }

    // 活跃人群在前：降级时只隐藏后面的静态看客，不会先砍掉走动的人
    this.members = walkers.concat(elites, browsers, balcony);
    this.walkers = walkers;
    this.n = this.members.length;
    this.detailLimit = this.n;

    // 预计算两个头部 mesh 的序号，避免每帧 O(n²)
    this.hIdxA = new Int32Array(this.n);
    this.hIdxB = new Int32Array(this.n);
    let ai = 0, bi = 0;
    this.members.forEach((m, i) => {
      if (m.helmet) this.hIdxB[i] = bi++;
      else this.hIdxA[i] = ai++;
    });
    const noHelmetCount = ai;
    const helmetCount = bi;
    this.prefixA = new Int32Array(this.n + 1);
    this.prefixB = new Int32Array(this.n + 1);
    for (let i = 0; i < this.n; i++) {
      this.prefixA[i + 1] = this.prefixA[i] + (this.members[i].helmet ? 0 : 1);
      this.prefixB[i + 1] = this.prefixB[i] + (this.members[i].helmet ? 1 : 0);
    }

    this.torso = new THREE.InstancedMesh(geo.torso, this.outfitMat, this.n);
    this.torso.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.torso.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 3), 3);
    this.torso.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.torso.receiveShadow = !this.mobile;
    this.torso.frustumCulled = false;

    this.headA = new THREE.InstancedMesh(geo.head, this.skinMat, Math.max(1, noHelmetCount));
    this.headA.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.headA.frustumCulled = false;

    this.headB = new THREE.InstancedMesh(geo.helmetHead, this.skinMat, Math.max(1, helmetCount));
    this.headB.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.headB.frustumCulled = false;

    this.arms = new THREE.InstancedMesh(geo.arm, this.outfitMat, this.n * 2);
    this.arms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arms.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 6), 3);
    this.arms.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.arms.frustumCulled = false;

    this.legs = new THREE.InstancedMesh(geo.leg, this.outfitMat, this.n * 2);
    this.legs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.legs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 6), 3);
    this.legs.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.legs.frustumCulled = false;

    this.lobby.root.add(this.torso);
    this.lobby.root.add(this.headA);
    this.lobby.root.add(this.headB);
    this.lobby.root.add(this.arms);
    this.lobby.root.add(this.legs);

    // 脚下软阴影：比实时阴影便宜两个数量级
    const blobGeo = new THREE.CircleGeometry(0.42, 10);
    blobGeo.rotateX(-Math.PI / 2);
    this.blob = new THREE.InstancedMesh(blobGeo, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false
    }), this.n);
    this.blob.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blob.frustumCulled = false;
    this.lobby.root.add(this.blob);

    // 典藏家脚下金环
    this.vips = this.members.filter((m) => m.tier === 3);
    this.aura = new THREE.InstancedMesh(
      (() => {
        const g = new THREE.RingGeometry(0.42, 0.52, 24);
        g.rotateX(-Math.PI / 2);
        return g;
      })(),
      new THREE.MeshBasicMaterial({
        color: 0xd9b47a, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
      }),
      Math.max(1, this.vips.length)
    );
    this.aura.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.aura.frustumCulled = false;
    this.lobby.root.add(this.aura);

    // 典藏家头顶的金色冠标：远看就知道谁是氪金玩家
    this.crown = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.075, 0),
      new THREE.MeshBasicMaterial({ color: 0xf0cf86, transparent: true, opacity: 0.95, toneMapped: false }),
      Math.max(1, this.vips.length)
    );
    this.crown.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.crown.frustumCulled = false;
    this.lobby.root.add(this.crown);

    // 典藏家脚下升起的金色光柱
    this.vipBeam = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.07, 0.34, 2.1, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xf0cf86, transparent: true, opacity: 0.09,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
      }),
      Math.max(1, this.vips.length)
    );
    this.vipBeam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.vipBeam.frustumCulled = false;
    this.lobby.root.add(this.vipBeam);

    // 远景billboard：一人 2 三角形，把「同屏人数」做上去
    this.farMembers = [];
    this._buildFar(this.farCapacity);
    this.total = this.n + this.farCount;

    this.tmpBody = new THREE.Matrix4();
    this.tmpPart = new THREE.Matrix4();
    this.tmpT = new THREE.Matrix4();
    this.tmpR = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpQ2 = new THREE.Quaternion();
    this.axisY = new THREE.Vector3(0, 1, 0);
    this.tmpV = new THREE.Vector3();
    this.tmpS = new THREE.Vector3();
    this._t = 0;
    this._acc = 0;
    this._farT = 0;
    this._time = 0;

    this._initColors();
    this._writeStatic(0);
    this.update(0, 0, true);
  }

  _buildFar(count) {
    if (count <= 0) return;
    const rnd = mulberry32(918273);
    const geo = new THREE.PlaneGeometry(0.72, 1.85);
    geo.translate(0, 0.94, 0);
    const mat = new THREE.MeshBasicMaterial({
      map: farPersonTexture(),
      transparent: true,
      alphaTest: 0.35,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: true
    });
    this.far = new THREE.InstancedMesh(geo, mat, count);
    this.far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.far.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.far.frustumCulled = false;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      let x = 0, z = 0, y = 0;
      for (let tries = 0; tries < 10; tries++) {
        const roll = rnd();
        if (roll < 0.52) {
          const a = rnd() * Math.PI * 2;
          const rad = 18 + rnd() * 10;
          x = Math.cos(a) * rad; z = -2 + Math.sin(a) * rad; y = 0;
        } else if (roll < 0.78) {
          x = 22 + rnd() * 8; z = -14 + rnd() * 28; y = 0;
        } else if (roll < 0.92) {
          x = -29 + rnd() * 7; z = -14 + rnd() * 28; y = 0;
        } else {
          x = -24 + rnd() * 48; z = 20 + rnd() * 2; y = 0;
        }
        x = Math.max(-29, Math.min(29, x));
        z = Math.max(-21, Math.min(21, z));
        if (Math.hypot(x, z - 19) > 13 && !isBlocked(x, z)) break;
      }
      const tierRoll = rnd();
      const tier = tierRoll < 0.06 ? 3 : tierRoll < 0.24 ? 2 : 0;
      const base = PALETTE[i % PALETTE.length];
      const col = tier === 3 ? [0.9, 0.72, 0.4] : tier === 2 ? [0.62, 0.52, 0.76] : [base[0] * 0.88, base[1] * 0.88, base[2] * 0.88];
      c.setRGB(col[0], col[1], col[2]);
      this.far.setColorAt(i, c);
      this.farMembers.push({ x, y, z, phase: rnd() * Math.PI * 2, scale: 0.9 + rnd() * 0.16 });
    }
    this.far.instanceColor.needsUpdate = true;
    this.lobby.root.add(this.far);

    const zero = new THREE.Matrix4();
    zero.makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) this.far.setMatrixAt(i, zero);
    this.far.instanceMatrix.needsUpdate = true;
  }

  _initColors() {
    const c = new THREE.Color();
    this.members.forEach((m, i) => {
      const base = PALETTE[i % PALETTE.length];
      let col = base;
      if (m.tier === 3) col = [0.85, 0.66, 0.34];
      else if (m.tier === 2) col = [0.5, 0.4, 0.62];
      c.setRGB(col[0], col[1], col[2]);
      this.torso.setColorAt(i, c);
      this.arms.setColorAt(i * 2, c);
      this.arms.setColorAt(i * 2 + 1, c);
      this.legs.setColorAt(i * 2, c);
      this.legs.setColorAt(i * 2 + 1, c);
    });
    this.torso.instanceColor.needsUpdate = true;
    this.arms.instanceColor.needsUpdate = true;
    this.legs.instanceColor.needsUpdate = true;
  }

  _writeStatic() {
    // 初始矩阵写一遍，避免第一帧全部堆在原点
    this.members.forEach((m, i) => {
      this.tmpV.set(m.x, m.y, m.z);
      this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.yaw);
      this.tmpS.setScalar(m.scale);
      this.tmpBody.compose(this.tmpV, this.tmpQ, this.tmpS);
      this.torso.setMatrixAt(i, this.tmpBody);
      if (m.helmet) this.headB.setMatrixAt(this.hIdxB[i], this.tmpBody);
      else this.headA.setMatrixAt(this.hIdxA[i], this.tmpBody);
      this._writeLimb(this.arms, i * 2, this.tmpBody, -0.245, 1.43, 0, 0);
      this._writeLimb(this.arms, i * 2 + 1, this.tmpBody, 0.245, 1.43, 0, 0);
      this._writeLimb(this.legs, i * 2, this.tmpBody, -0.095, 0.95, 0, 0);
      this._writeLimb(this.legs, i * 2 + 1, this.tmpBody, 0.095, 0.95, 0, 0);
      this._writeLimb(this.blob, i, this.tmpBody, 0, 0.02, 0, 0);
    });
    this.torso.instanceMatrix.needsUpdate = true;
    this.headA.instanceMatrix.needsUpdate = true;
    this.headB.instanceMatrix.needsUpdate = true;
    this.arms.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
    this.blob.instanceMatrix.needsUpdate = true;
  }

  _writeLimb(mesh, index, bodyMatrix, ox, oy, oz, swing) {
    this.tmpPart.copy(bodyMatrix);
    this.tmpT.makeTranslation(ox, oy, oz);
    this.tmpPart.multiply(this.tmpT);
    this.tmpR.makeRotationX(swing);
    this.tmpPart.multiply(this.tmpR);
    mesh.setMatrixAt(index, this.tmpPart);
  }

  update(dt, t, immediate, camera) {
    this._acc += dt;
    this._time = t || 0;
    if (!immediate && this._acc < 1 / this.updateHz) return;
    const step = this._acc;
    this._acc = 0;

    const time = this._time;
    for (const m of this.walkers) {
      if (m.wait > 0) {
        m.wait -= step;
      } else {
        const dx = m.tx - m.x, dz = m.tz - m.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.8) {
          // 选一个新目标
          for (let tries = 0; tries < 8; tries++) {
            const node = WALK_NODES[(Math.random() * WALK_NODES.length) | 0];
            const tx = node[0] + (Math.random() - 0.5) * 10;
            const tz = node[1] + (Math.random() - 0.5) * 7;
            if (isBlocked(tx, tz)) continue;
            m.tx = tx; m.tz = tz;
            break;
          }
          m.wait = 0.5 + Math.random() * 3;
        } else {
          m.x += dx / d * m.speed * step;
          m.z += dz / d * m.speed * step;
          m.yaw = Math.atan2(dx, dz);
          // 绕开中央陈列柱与四个展位
          const cdx = m.x, cdz = m.z + 2;
          const cd = Math.hypot(cdx, cdz);
          if (cd < 5.9 && cd > 0.01) {
            m.x = cdx / cd * 5.9;
            m.z = -2 + cdz / cd * 5.9;
          }
          const peds = [[-7.2, 0.5], [7.2, 0.5], [-7.2, -8.5], [7.2, -8.5]];
          for (const p of peds) {
            const px = m.x - p[0], pz = m.z - p[1];
            const pd = Math.hypot(px, pz);
            if (pd < 2.4 && pd > 0.01) {
              m.x = p[0] + px / pd * 2.4;
              m.z = p[1] + pz / pd * 2.4;
            }
          }
        }
      }
    }

    const q = this.tmpQ2;
    const axisY = this.axisY;
    const limit = Math.min(this.members.length, this.detailLimit);
    for (let i = 0; i < limit; i++) {
      const m = this.members[i];
      if (m.idle && !this.animateIdle) continue;
      const moving = !m.idle && m.wait <= 0;
      const walkPhase = time * (1.3 + m.speed * 1.7) + m.phase;
      const swing = moving ? 0.5 : Math.sin(time * 0.6 + m.phase) * 0.03;
      const legSwing = moving ? Math.sin(walkPhase) * 0.55 : 0;
      const armSwing = moving ? Math.sin(walkPhase) * 0.4 : Math.sin(time * 0.5 + m.phase) * 0.03;

      this.tmpV.set(m.x, m.y + (moving ? Math.abs(Math.sin(walkPhase)) * 0.015 : Math.sin(time * 0.7 + m.phase) * 0.006), m.z);
      q.setFromAxisAngle(axisY, m.yaw + (m.idle ? Math.sin(time * 0.25 + m.phase) * 0.03 : 0));
      this.tmpS.setScalar(m.scale);
      this.tmpBody.compose(this.tmpV, q, this.tmpS);

      this.torso.setMatrixAt(i, this.tmpBody);
      if (m.helmet) this.headB.setMatrixAt(this.hIdxB[i], this.tmpBody);
      else this.headA.setMatrixAt(this.hIdxA[i], this.tmpBody);

      this._writeLimb(this.arms, i * 2, this.tmpBody, -0.245, 1.43, 0, armSwing);
      this._writeLimb(this.arms, i * 2 + 1, this.tmpBody, 0.245, 1.43, 0, -armSwing);
      this._writeLimb(this.legs, i * 2, this.tmpBody, -0.095, 0.95, 0, legSwing);
      this._writeLimb(this.legs, i * 2 + 1, this.tmpBody, 0.095, 0.95, 0, -legSwing);
      this._writeLimb(this.blob, i, this.tmpBody, 0, 0.02, 0, 0);
    }

    this.torso.instanceMatrix.needsUpdate = true;
    this.headA.instanceMatrix.needsUpdate = true;
    this.headB.instanceMatrix.needsUpdate = true;
    this.arms.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
    this.blob.instanceMatrix.needsUpdate = true;

    // 金环 + 冠标
    this.vips.forEach((m, i) => {
      const s = 1 + Math.sin(time * 2 + m.phase) * 0.12;
      this.tmpV.set(m.x, m.y + 0.025, m.z);
      q.setFromAxisAngle(axisY, time * 0.4 + m.phase);
      this.tmpS.set(s, 1, s);
      this.tmpBody.compose(this.tmpV, q, this.tmpS);
      this.aura.setMatrixAt(i, this.tmpBody);

      this.tmpV.set(m.x, m.y + 1.98 * m.scale + Math.sin(time * 1.6 + m.phase) * 0.04, m.z);
      q.setFromAxisAngle(axisY, time * 1.1 + m.phase);
      this.tmpS.setScalar(1);
      this.tmpBody.compose(this.tmpV, q, this.tmpS);
      this.crown.setMatrixAt(i, this.tmpBody);

      this.tmpV.set(m.x, m.y + 1.05, m.z);
      q.identity();
      this.tmpS.setScalar(m.scale);
      this.tmpBody.compose(this.tmpV, q, this.tmpS);
      this.vipBeam.setMatrixAt(i, this.tmpBody);
    });
    this.aura.instanceMatrix.needsUpdate = true;
    this.crown.instanceMatrix.needsUpdate = true;
    this.vipBeam.instanceMatrix.needsUpdate = true;

    // 远景 billboard 8Hz 更新即可
    this._farT += step;
    if (this._farT >= 1 / 8) {
      this._farT = 0;
      this._updateFar(camera, time);
    }
  }

  _updateFar(camera, time) {
    if (!this.far || !this.farCount) return;
    this.far.count = this.farCount;
    const camX = camera ? camera.position.x : 0;
    const camZ = camera ? camera.position.z : 19;
    const q = this.tmpQ2;
    const axisY = this.axisY;
    for (let i = 0; i < this.farCount; i++) {
      const f = this.farMembers[i];
      const dx = camX - f.x;
      const dz = camZ - f.z;
      const d = Math.hypot(dx, dz);
      const fade = Math.max(0, Math.min(1, (d - 12) / 8));
      if (fade <= 0.01) {
        this.tmpS.setScalar(0);
        this.tmpV.set(f.x, f.y, f.z);
        this.tmpBody.compose(this.tmpV, q.identity(), this.tmpS);
      } else {
        q.setFromAxisAngle(axisY, Math.atan2(dx, dz));
        this.tmpV.set(f.x, f.y + Math.sin(time * 0.8 + f.phase) * 0.018, f.z);
        this.tmpS.setScalar(f.scale * fade);
        this.tmpBody.compose(this.tmpV, q, this.tmpS);
      }
      this.far.setMatrixAt(i, this.tmpBody);
    }
    this.far.instanceMatrix.needsUpdate = true;
  }

  /** 真机掉帧时逐级减少细节人数；只裁掉后段的静态看客。 */
  setDetailLimit(k) {
    const K = Math.max(40, Math.min(this.n, Math.round(k)));
    if (K === this.detailLimit) return;
    this.detailLimit = K;
    this.torso.count = K;
    this.arms.count = K * 2;
    this.legs.count = K * 2;
    this.blob.count = K;
    this.headA.count = this.prefixA[K];
    this.headB.count = this.prefixB[K];
  }

  setFarCount(n) {
    this.farCount = Math.max(0, Math.min(this.farCapacity, Math.round(n)));
    if (this.far) this.far.count = this.farCount;
    this.total = this.n + this.farCount;
  }

  setQuality(q) {
    this.opts.quality = q;
    const p = this.profiles[q] || this.profiles.medium;
    this.updateHz = p.hz;
    this.animateIdle = !this.mobile && q !== 'low';
    const target = this.opts.far != null ? this.opts.far : p.far;
    this.farCount = Math.min(target, this.farCapacity);
    if (this.far) this.far.count = this.farCount;
    this.total = this.n + this.farCount;
  }

  setVisible(on) {
    this.torso.visible = on;
    this.headA.visible = on;
    this.headB.visible = on;
    this.arms.visible = on;
    this.legs.visible = on;
    this.aura.visible = on;
    this.crown.visible = on;
    this.vipBeam.visible = on;
    this.blob.visible = on;
    if (this.far) this.far.visible = on;
  }
}
