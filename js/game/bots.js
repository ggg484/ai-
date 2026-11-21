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
    this.world = world;
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

  /** 选择最近的可见敌人；ctx = { player, tBots, ctBots }。 */
  _pickTarget(ctx) {
    const list = [];
    if (this.team === 'ct') {
      if (ctx.player && ctx.player.alive) list.push({ unit: ctx.player, player: true });
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
      const keep = dist < 8 ? -1 : (dist > 20 ? 1 : 0);
      const strafe = Math.sin(performance.now() * 0.0016 + this.pos.x) * 0.55;
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      moveX = nx * keep + (-nz) * strafe;
      moveZ = nz * keep + nx * strafe;
      speed = 2.1;

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
          cb.onBotShoot(this, this._rollShot(this.eye(this._eye), target.eye, dist, target.player), target);
        }
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
        faceYaw = Math.atan2(moveX, moveZ) + Math.PI;
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
