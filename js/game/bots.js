// 敌方 Bot：骨架版状态机（巡逻 / 交战 / 死亡）。
// 目标不是做「聪明 AI」，而是把感知、射线、命中、回合钩子跑通，方便后续替换。
// TODO(ai): 导航网格 A*、听觉、投掷物、下包/拆包、队伍角色。

import * as THREE from '../../vendor/three.module.js';
import { raySphere, rayBox } from '../world/collision.js';
import { audio } from '../core/audio.js';
import { buildHumanoid, animateHumanoid } from '../render/character.js';
import { mergeGeos } from '../world/geo-utils.js';

const BODY_R = 0.29;
const BODY_TOP = 1.46;
const HEAD_Y = 1.62;
const HEAD_R = 0.17;

let seq = 0;

function gunModel() {
  const parts = [];
  const receiver = new THREE.BoxGeometry(0.06, 0.075, 0.32);
  receiver.translate(0, 0, 0);
  parts.push(receiver);
  const barrel = new THREE.CylinderGeometry(0.014, 0.014, 0.28, 10);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(0, 0.012, -0.29);
  parts.push(barrel);
  const mag = new THREE.BoxGeometry(0.045, 0.14, 0.06);
  mag.rotateX(0.16);
  mag.translate(0, -0.1, 0.02);
  parts.push(mag);
  const stock = new THREE.BoxGeometry(0.05, 0.06, 0.2);
  stock.translate(0, -0.01, 0.24);
  parts.push(stock);
  const guard = new THREE.BoxGeometry(0.055, 0.05, 0.12);
  guard.translate(0, -0.05, -0.04);
  parts.push(guard);
  const g = mergeGeos(parts);
  parts.forEach((x) => x.dispose());
  const m = new THREE.MeshStandardMaterial({ color: 0x24282a, roughness: 0.55, metalness: 0.55 });
  return new THREE.Mesh(g, m);
}

export class Bot {
  constructor(scene, spawn, world) {
    this.id = 'bot' + (++seq);
    this.world = world;
    this.spawn = { x: spawn.x, z: spawn.z, yaw: spawn.yaw || 0 };
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.vel = new THREE.Vector3();
    this.hp = 100;
    this.alive = true;
    this.grounded = true;
    this.shootCd = 1.2 + Math.random() * 0.8;
    this.reaction = 0;
    this.waypoint = (seq * 3) % 8;
    this.stuck = 0;
    this.lastPos = this.pos.clone();
    this.engage = false;
    this.flashT = 0;
    this.deadT = 0;
    this.kills = 0;
    this.deaths = 0;

    this.group = new THREE.Group();
    this.group.name = this.id;

    this.humanoid = buildHumanoid({ helmet: true, cloneMats: true });
    this.humanoid.userData.parts.armR.rotation.x = -1.25;
    this.humanoid.userData.parts.armR.rotation.z = -0.12;
    this.group.add(this.humanoid);
    this.bodyMat = this.humanoid.userData.parts.torso.material;

    const gun = gunModel();
    gun.position.set(0.02, -0.52, -0.12);
    gun.rotation.x = 0.02;
    gun.castShadow = true;
    this.humanoid.userData.parts.armR.add(gun);
    this.gun = gun;

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({
        color: 0xffc070, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    this.flash.position.set(0, -0.52, -0.44);
    this.flash.visible = false;
    this.humanoid.userData.parts.armR.add(this.flash);

    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  reset() {
    this.pos.set(this.spawn.x, 0, this.spawn.z);
    this.vel.set(0, 0, 0);
    this.hp = 100;
    this.alive = true;
    this.deadT = 0;
    this.shootCd = 1.2 + Math.random() * 0.8;
    this.reaction = 0;
    this.engage = false;
    this.group.visible = true;
    this.group.rotation.set(0, this.spawn.yaw || 0, 0);
    this.group.position.copy(this.pos);
    this.bodyMat.emissive.setHex(0x000000);
    const p = this.humanoid.userData.parts;
    p.armL.rotation.set(0, 0, 0);
    p.armR.rotation.set(-1.25, 0, -0.12);
    p.legL.rotation.set(0, 0, 0);
    p.legR.rotation.set(0, 0, 0);
  }

  eye(out) {
    return (out || new THREE.Vector3()).set(this.pos.x, this.pos.y + 1.55, this.pos.z);
  }

  update(dt, player, waypoints, cb) {
    if (!this.alive) {
      this.deadT += dt;
      if (this.deadT > 1.6) this.group.visible = false;
      return;
    }

    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = this.flashT > 0;
    if (this.flashT <= 0) this.bodyMat.emissive.setHex(0x000000);

    const dx = player.position.x - this.pos.x;
    const dz = player.position.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const eye = this.eye(new THREE.Vector3());
    const pe = player.eye(new THREE.Vector3());
    const canSee = player.alive && dist < 42 && this.world.lineOfSight(eye.x, eye.y, eye.z, pe.x, pe.y, pe.z);

    this.engage = canSee;
    let moveX = 0, moveZ = 0, speed = 0;

    if (canSee) {
      this.reaction += dt;
      this.group.rotation.y = Math.atan2(dx, dz);
      const keep = dist < 8 ? -1 : (dist > 20 ? 1 : 0);
      const strafe = Math.sin(performance.now() * 0.0016 + this.pos.x) * 0.55;
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      moveX = nx * keep + (-nz) * strafe;
      moveZ = nz * keep + nx * strafe;
      speed = 2.1;

      this.shootCd -= dt;
      if (this.shootCd <= 0 && this.reaction > 0.35) {
        this.shootCd = 1.05 + Math.random() * 0.55;
        this.flashT = 0.06;
        this.flash.visible = true;
        this.bodyMat.emissive.setHex(0x332211);
        cb.onBotShoot(this, this._rollShot(eye, pe, dist));
      }
    } else {
      this.reaction = 0;
      const wp = waypoints[this.waypoint % waypoints.length];
      const wdx = wp.x - this.pos.x, wdz = wp.z - this.pos.z;
      const wd = Math.hypot(wdx, wdz);
      if (wd < 1.8) {
        this.waypoint++;
      } else {
        moveX = wdx / wd;
        moveZ = wdz / wd;
        speed = 2.2;
        this.group.rotation.y = Math.atan2(moveX, moveZ);
      }
    }

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
    if (len > 0.01 && moved < 0.12 * Math.min(1, dt * 60)) {
      this.stuck += dt;
      if (this.stuck > 0.9) { this.waypoint++; this.stuck = 0; }
    } else {
      this.stuck = 0;
    }

    animateHumanoid(this.humanoid, dt, len > 0.01 ? speed : 0, this.engage);
    this.group.position.copy(this.pos);
  }

  _rollShot(eye, pe, dist) {
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
    const hit = t >= 0 && t < dist + 1.2;
    return { hit: hit, dist: dist, dir: dir, origin: eye.clone() };
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
    this.bodyMat.emissive.setHex(0x552211);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths++;
      this.deadT = 0;
      this.group.rotation.z = -Math.PI / 2;
      this.group.position.y = 0.25;
      audio.play(head ? 'headshot' : 'hit', { volume: 0.8 });
      return true;
    }
    audio.play('hit', { volume: 0.5 });
    return false;
  }
}
