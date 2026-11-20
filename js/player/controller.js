// 玩家控制器：Source 风格的加速/摩擦/急停 + AABB 扫掠碰撞。
// 参数集中在 config/weapons.js 的 MOVEMENT，方便逐项对照原版调。

import * as THREE from '../../vendor/three.module.js';
import { MOVEMENT } from '../config/weapons.js';
import { audio } from '../core/audio.js';

const DEG = Math.PI / 180;

export class Player {
  constructor(spawn) {
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.height = MOVEMENT.standHeight;
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.grounded = false;
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.bobT = 0;
    this.stepDist = 0;
    this.landTimer = 0;
    this.reset(spawn);
  }

  reset(spawn) {
    this.position.set(spawn.x, spawn.y || 0, spawn.z);
    this.velocity.set(0, 0, 0);
    this.height = MOVEMENT.standHeight;
    this.yaw = spawn.yaw || 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.grounded = true;
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.stepDist = 0;
  }

  viewYaw() { return this.yaw + this.recoilYaw; }
  viewPitch() {
    return Math.max(-1.5, Math.min(1.5, this.pitch + this.recoilPitch));
  }

  aimDir(out) {
    const y = this.viewYaw(), p = this.viewPitch();
    out = out || new THREE.Vector3();
    const cp = Math.cos(p);
    out.set(Math.sin(y) * cp, Math.sin(p), Math.cos(y) * cp);
    return out.normalize();
  }

  eye(out) {
    out = out || new THREE.Vector3();
    const bob = Math.sin(this.bobT) * 0.022 * Math.min(1, this.velocity.length() / 4);
    return out.set(this.position.x, this.position.y + this.height * 0.9 + bob, this.position.z);
  }

  applyRecoil(pitchDeg, yawDeg) {
    this.recoilPitch += pitchDeg * DEG;
    this.recoilYaw += yawDeg * DEG;
  }

  update(dt, input, world) {
    if (!this.alive) return;

    // 视角
    const look = input.consumeLook();
    this.yaw += look.dx;
    this.pitch -= look.dy;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    // 后坐力回收
    const rec = Math.min(1, dt * 7.5);
    this.recoilPitch += (0 - this.recoilPitch) * rec;
    this.recoilYaw += (0 - this.recoilYaw) * rec;

    // 蹲
    const wantCrouch = input.isDown('crouch');
    const targetH = wantCrouch ? MOVEMENT.crouchHeight : MOVEMENT.standHeight;
    if (targetH > this.height) {
      const blocked = world.overlaps(
        this.position.x - MOVEMENT.radius, this.position.y, this.position.z - MOVEMENT.radius,
        this.position.x + MOVEMENT.radius, this.position.y + targetH, this.position.z + MOVEMENT.radius
      );
      if (!blocked) this.height += Math.min(4.0 * dt, targetH - this.height);
    } else if (targetH < this.height) {
      this.height += Math.max(-5.0 * dt, targetH - this.height);
    }

    // 期望方向
    const ax = input.axis();
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * ax.y + rx * ax.x;
    let wz = fz * ax.y + rz * ax.x;
    const wl = Math.hypot(wx, wz);
    if (wl > 0.001) { wx /= wl; wz /= wl; }

    const wantJump = input.consumePressed('jump');
    const crouching = this.height < MOVEMENT.standHeight - 0.12;
    let maxSpeed = crouching ? MOVEMENT.crouchSpeed : (input.isDown('walk') ? MOVEMENT.walkSpeed : MOVEMENT.runSpeed);
    // 推杆幅度直接决定目标速度：触屏半程 ≈ 静步（键盘恒为 1）
    const mag = Math.min(1, Math.hypot(ax.x, ax.y));
    maxSpeed *= mag;

    if (this.grounded) {
      // 摩擦
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (speed > 0.001) {
        const drop = Math.max(speed, MOVEMENT.stopSpeed) * MOVEMENT.friction * dt;
        const ns = Math.max(0, speed - drop) / speed;
        this.velocity.x *= ns;
        this.velocity.z *= ns;
      }
      this._accelerate(wx, wz, maxSpeed, MOVEMENT.accel, dt);
      if (wantJump) {
        this.velocity.y = MOVEMENT.jumpSpeed;
        this.grounded = false;
        this.landTimer = 0;
      }
    } else {
      // 空中控制有限：只给一个很小的修正速度
      this._accelerate(wx, wz, Math.min(maxSpeed, 1.2), MOVEMENT.airAccel, dt);
    }

    this.velocity.y -= MOVEMENT.gravity * dt;
    if (this.velocity.y < -40) this.velocity.y = -40;

    const wasGrounded = this.grounded;
    this.grounded = world.move(
      this.position, this.velocity, dt,
      MOVEMENT.radius, this.height, MOVEMENT.stepHeight, this.grounded
    );
    if (!wasGrounded && this.grounded) {
      this.landTimer = 0.12;
      audio.play('step', { volume: 0.7 });
    }
    this.landTimer = Math.max(0, this.landTimer - dt);

    // 脚步声
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && hs > 1.2) {
      this.stepDist += hs * dt;
      const stride = input.isDown('walk') ? 3.1 : 2.45;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        audio.play('step', { volume: input.isDown('walk') ? 0.35 : 0.9 });
      }
    }
    this.bobT += hs * dt * 2.2;

    // 掉出地图保护
    if (this.position.y < -20) this.reset(this.respawnPoint || { x: 0, y: 0, z: -28, yaw: 0 });
  }

  _accelerate(wx, wz, wishSpeed, accel, dt) {
    if (wishSpeed <= 0) return;
    const current = this.velocity.x * wx + this.velocity.z * wz;
    const add = wishSpeed - current;
    if (add <= 0) return;
    const accelSpeed = Math.min(accel * wishSpeed * dt, add);
    this.velocity.x += wx * accelSpeed;
    this.velocity.z += wz * accelSpeed;
  }

  damage(amount) {
    if (!this.alive) return;
    let hpDamage = amount;
    if (this.armor > 0) {
      hpDamage = amount * 0.5;
      this.armor = Math.max(0, this.armor - amount * 0.5);
    }
    this.hp -= hpDamage;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  healFull() {
    this.hp = 100;
    this.alive = true;
  }
}
