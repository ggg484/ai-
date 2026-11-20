// 靶场逻辑：三条靶道的弹起靶、计分、限时挑战。只在大厅里工作。

import * as THREE from '../../vendor/three.module.js';
import { rayBox } from '../world/collision.js';

const LANES = [
  { id: 1, name: '手枪', dist: '15 M', zMin: -9, zMax: -3 },
  { id: 2, name: '步枪', dist: '25 M', zMin: -3, zMax: 3 },
  { id: 3, name: '狙击', dist: '40 M', zMin: 3, zMax: 9 }
];

export class RangeSystem {
  constructor(lobby) {
    this.lobby = lobby;
    this.mesh = lobby.targets.mesh;
    this.stands = lobby.targets.stands;
    this.list = lobby.targets.data;
    this.active = false;
    this.lane = null;
    this.hits = 0;
    this.shots = 0;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.challenge = { active: false, time: 0, score: 0, hits: 0, shots: 0 };
    this._tmpM = new THREE.Matrix4();
    this._tmpV = new THREE.Vector3();
    this._tmpQ = new THREE.Quaternion();
    this._tmpS = new THREE.Vector3();
    this._color = new THREE.Color();

    // 初始靶位
    this.list.forEach((t, i) => {
      t.y = 0.3;
      t.up = false;
      t.timer = 0.4 + Math.random() * 2.2;
      t.flash = 0;
      this._tmpV.set(t.x, 0.5, t.z);
      this._tmpS.set(1, 1, 1);
      this._tmpQ.identity();
      this._tmpM.compose(this._tmpV, this._tmpQ, this._tmpS);
      this.stands.setMatrixAt(i, this._tmpM);
      this.mesh.setColorAt(i, this._color.setHex(0xd8d2c2));
      this._writeBoard(i, t);
    });
    this.stands.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  _writeBoard(i, t) {
    
    this._tmpV.set(t.x, t.y, t.z);
    this._tmpQ.identity();
    const sy = t.y < 0.6 ? 0.22 : 1;
    this._tmpS.set(1, sy, 1);
    this._tmpM.compose(this._tmpV, this._tmpQ, this._tmpS);
    this.mesh.setMatrixAt(i, this._tmpM);
  }

  zoneOf(player) {
    const p = player.position;
    if (p.x < 33 || p.x > 77) return null;
    for (const l of LANES) {
      if (p.z > l.zMin && p.z < l.zMax) return l;
    }
    return null;
  }

  startChallenge() {
    this.challenge.active = true;
    this.challenge.time = 30;
    this.challenge.score = 0;
    this.challenge.hits = 0;
    this.challenge.shots = 0;
    this.score = 0;
    this.hits = 0;
    this.shots = 0;
    this.streak = 0;
    this.bestStreak = 0;
    return true;
  }

  stopChallenge() {
    this.challenge.active = false;
  }

  update(dt, player, time) {
    const lane = this.zoneOf(player);
    this.active = !!lane;
    this.lane = lane;

    if (this.challenge.active) {
      this.challenge.time -= dt;
      if (this.challenge.time <= 0) {
        this.challenge.time = 0;
        this.challenge.active = false;
      }
    }

    for (let i = 0; i < this.list.length; i++) {
      const t = this.list[i];
      t.timer -= dt;
      if (t.timer <= 0) {
        t.up = !t.up;
        t.timer = t.up ? 1.5 + Math.random() * 1.6 : 0.7 + Math.random() * 1.4;
        if (this.challenge.active) t.timer = t.up ? 0.8 + Math.random() * 0.8 : 0.35 + Math.random() * 0.5;
      }
      const targetY = t.up ? 1.9 : 0.38;
      t.y += (targetY - t.y) * Math.min(1, dt * 12);
      t.flash = Math.max(0, t.flash - dt);
      this._writeBoard(i, t);
      if (t.flash > 0) this.mesh.setColorAt(i, this._color.setHex(0xc94f45));
      else if (t.up) this.mesh.setColorAt(i, this._color.setHex(0xe8e2d2));
      else this.mesh.setColorAt(i, this._color.setHex(0x8a8578));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** 命中检测：返回 {t, index} 或 null。 */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    for (let i = 0; i < this.list.length; i++) {
      const t = this.list[i];
      if (!t.up || t.y < 1.0) continue;
      const hit = rayBox(
        ox, oy, oz, dx, dy, dz,
        t.x - 0.04, t.y - 0.7, t.z - 0.4,
        t.x + 0.04, t.y + 0.7, t.z + 0.4,
        maxDist
      );
      if (hit >= 0 && (!best || hit < best.t)) best = { t: hit, index: i };
    }
    return best;
  }

  registerShot(hitIndex, dist) {
    this.shots++;
    if (this.challenge.active) this.challenge.shots++;
    if (hitIndex == null) {
      this.streak = 0;
      return { hit: false, points: 0 };
    }
    this.hits++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const base = Math.max(20, Math.round(120 - dist * 1.4));
    const points = base + this.streak * 5;
    this.score += points;
    if (this.challenge.active) {
      this.challenge.hits++;
      this.challenge.score += points;
    }
    return { hit: true, points: points };
  }

  getState() {
    return {
      active: this.active,
      lane: this.lane,
      hits: this.hits,
      shots: this.shots,
      score: this.score,
      streak: this.streak,
      bestStreak: this.bestStreak,
      challenge: this.challenge
    };
  }
}

export { LANES };
