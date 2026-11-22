// 第一人称武器视图：8 把武器全部支持，带双臂 + 前臂。
// 关键点：
// - depthTest=false，枪不穿墙；按材质合批，draw call 不随零件数增长。
// - 模型按需构建，只有当前武器在内存里；切枪不会卡首帧。
// - 左手是独立 mesh（gloveL / sleeveL），换弹时可以离开护木，做出摸弹匣的动作。

import * as THREE from '../../vendor/three.module.js';
import { buildWeaponModel } from './weapon-models.js';
import { applySkin } from './skin-material.js';
import { normalizeWeaponRig, DEFAULT_WEAPON_RIG } from './rig.js';

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.35, 'rgba(255,190,90,.9)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shellMesh() {
  const brass = new THREE.MeshStandardMaterial({
    color: 0xb98a3c, metalness: 0.95, roughness: 0.32, depthTest: false, depthWrite: false
  });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.026, 8), brass);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.004, 8), brass);
  rim.rotation.z = Math.PI / 2;
  rim.position.x = 0.014;
  g.add(rim);
  g.renderOrder = 1002;
  g.visible = false;
  return g;
}

const WEAPON_IDS = ['ak', 'm4', 'awp', 'mp9', 'glock', 'usp', 'deagle', 'knife'];

// 弹壳从抛壳口飞出的初始位置（枪模型局部坐标）
const EJECT = {
  ak: [0.04, 0.035, -0.04],
  m4: [0.04, 0.035, -0.05],
  awp: [0.05, 0.05, 0.02],
  mp9: [0.035, 0.035, -0.06],
  glock: [0.02, 0.045, -0.02],
  usp: [0.02, 0.045, -0.02],
  deagle: [0.025, 0.05, -0.02],
  knife: null
};

export class Viewmodel {
  constructor(camera, rig) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.root.renderOrder = 1000;
    this.rig = normalizeWeaponRig(rig || DEFAULT_WEAPON_RIG);
    camera.add(this.root);

    // 枪械专用补光，避免在阴影里变成黑块；距离很短，不影响场景。
    this.camLight = new THREE.PointLight(0xfff0d8, 2.1, 3.0, 2);
    this.camLight.position.set(0.35, 0.3, 0.25);
    camera.add(this.camLight);

    this.guns = {};
    this.skins = {};

    this.flashMat = new THREE.MeshBasicMaterial({
      map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, opacity: 0
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), this.flashMat);
    this.flash.renderOrder = 1001;
    this.flash.visible = false;
    camera.add(this.flash);

    this.shell = shellMesh();
    camera.add(this.shell);
    this.shellT = 0;
    this.shellVel = new THREE.Vector3();

    this.light = new THREE.PointLight(0xffb060, 0, 6, 2);
    this.light.visible = false;
    camera.add(this.light);

    this.current = null;
    this.kick = 0;
    this.flashT = 0;
    this.raise = 0;
    this.sway = new THREE.Vector2();
    this.basePos = new THREE.Vector3();
    this.baseRot = new THREE.Vector3();
    this.muzzleWorld = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._flashPos = new THREE.Vector3();
    this._shellPos = new THREE.Vector3();
    this.quality = 'medium';
  }

  _ensure(id) {
    if (this.guns[id]) return this.guns[id];
    if (WEAPON_IDS.indexOf(id) < 0) return null;
    const g = buildWeaponModel(id, { depthTest: false, renderOrder: 1000, hands: true });
    g.userData.weaponId = id;
    g.visible = false;
    this.root.add(g);
    this.guns[id] = g;
    if (this.skins[id]) applySkin(g, this.skins[id].skin, this.skins[id].variant);
    return g;
  }

  setWeapon(id) {
    const g = this._ensure(id);
    if (!g) return;
    if (this.current === id) return;
    Object.keys(this.guns).forEach((k) => { this.guns[k].visible = (k === id); });
    this.current = id;
    this.raise = 0.28;
    this.applyRig(this.rig);
  }

  /** 应用一套武器挂点参数（模型工坊实时预览 / 启动读取静态文件）。 */
  applyRig(rig) {
    this.rig = normalizeWeaponRig(rig || this.rig);
    const id = this.current || 'ak';
    const r = this.rig.weapons[id] || this.rig.weapons.ak;
    this.root.scale.setScalar(r.scale);
    this.basePos.fromArray(r.pos);
    this.baseRot.fromArray(r.rot);
    this.root.position.copy(this.basePos);
    this.root.rotation.set(this.baseRot.x, this.baseRot.y, this.baseRot.z);
  }

  /** 装备皮肤；传 null 为原厂。 */
  setSkin(id, skin, variant) {
    this.skins[id] = skin ? { skin: skin, variant: variant } : null;
    if (this.guns[id]) applySkin(this.guns[id], skin || null, variant);
  }

  onFire() {
    this.kick = 1;
    this.flashT = 0.055;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.light.visible = this.quality !== 'low';
    this.light.intensity = 2.2;

    const id = this.current;
    if (id === 'knife' || !id) { this.flash.visible = false; return; }

    // 抛壳：小黄铜壳从抛壳口飞出，0.5 s 后消失。
    const g = this.guns[id];
    const e = EJECT[id];
    if (g && e) {
      g.updateWorldMatrix(true, false);
      this._shellPos.set(e[0], e[1], e[2]);
      g.localToWorld(this._shellPos);
      this.camera.worldToLocal(this._shellPos);
      this.shell.position.copy(this._shellPos);
      this.shell.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.shellVel.set(0.9 + Math.random() * 0.5, 0.55 + Math.random() * 0.35, 0.25);
      this.shellT = 0.55;
      this.shell.visible = true;
    }
  }

  muzzlePosition(out) {
    const g = this.guns[this.current];
    if (!g || !g.userData.muzzle) return out.copy(this.root.position);
    g.updateWorldMatrix(true, false);
    g.userData.muzzle.getWorldPosition(out);
    return out;
  }

  _animateLeftHand(g, reload) {
    const left = g && g.userData.left;
    if (!left) return;
    const k = Math.sin(reload * Math.PI);
    const dy = -0.085 * k;
    const dz = 0.075 * k;
    if (left.glove) {
      left.glove.position.set(0, dy, dz);
      left.glove.rotation.set(-0.55 * k, 0, 0.15 * k);
    }
    if (left.sleeve) {
      left.sleeve.position.set(0, dy * 0.8, dz * 0.8);
      left.sleeve.rotation.set(-0.35 * k, 0, 0.1 * k);
    }
  }

  update(dt, weapon, player, camera) {
    const g = this.guns[this.current];
    if (!g) return;
    camera.updateMatrixWorld(true);
    if (!this.root.visible) {
      this.flash.visible = false;
      this.shell.visible = false;
      this.shellT = 0;
      return;
    }

    dt = Math.max(0, Math.min(0.1, dt));
    this.kick = Math.min(1, Math.max(0, this.kick - dt * 9));
    this.raise = Math.min(0.28, Math.max(0, this.raise - dt));
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.flashT <= 0) {
      this.flash.visible = false;
      this.light.visible = false;
      this.light.intensity = 0;
    }
    if (this.shellT > 0) {
      this.shellT -= dt;
      this.shellVel.y -= 6.5 * dt;
      this.shell.position.addScaledVector(this.shellVel, dt);
      this.shell.rotation.x += dt * 9;
      this.shell.rotation.y += dt * 5;
      if (this.shellT <= 0) this.shell.visible = false;
    }

    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const speedN = Math.min(1, speed / 4.2);
    const sprint = Math.max(0, Math.min(1, (speed - 4.15) / 0.7));
    const t = performance.now() * 0.001;
    const bobY = Math.abs(Math.sin(player.bobT)) * 0.014 * speedN;
    const bobX = Math.cos(player.bobT) * 0.009 * speedN;
    this.sway.x += ((Math.sin(t * 1.6) * 0.006 + bobX) - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += ((Math.cos(t * 1.3) * 0.005 + bobY) - this.sway.y) * Math.min(1, dt * 8);
    this.sway.x = Math.max(-0.04, Math.min(0.04, this.sway.x));
    this.sway.y = Math.max(-0.04, Math.min(0.04, this.sway.y));

    const raiseOff = this.raise > 0 ? -this.raise * 0.9 : 0;
    const reload = weapon && weapon.reloading ? Math.sin(weapon.reloadProgress() * Math.PI) : 0;
    const isKnife = this.current === 'knife';

    this.root.position.set(
      this.basePos.x + this.sway.x + sprint * 0.02,
      this.basePos.y + this.sway.y - raiseOff - reload * 0.12 - sprint * 0.055,
      this.basePos.z + this.kick * (isKnife ? 0.02 : 0.055) + sprint * 0.035
    );
    this.root.rotation.set(
      this.baseRot.x - this.kick * (isKnife ? 0.16 : 0.08) + reload * 0.55 + sprint * 0.16,
      this.baseRot.y - this.sway.x * 1.2 + reload * 0.35 + sprint * 0.28,
      this.baseRot.z + reload * 0.5 + this.sway.y * 0.8 - sprint * 0.12
    );

    this._animateLeftHand(g, reload);

    if (isKnife) {
      this.root.rotation.y += this.kick * 0.85;
      this.root.rotation.z += this.kick * 0.35;
    } else {
      const m = this.muzzlePosition(this._flashPos);
      this.flash.position.copy(camera.worldToLocal(m.clone()));
      this.flash.position.z -= 0.02;
      this.light.position.copy(this.flash.position);
    }
  }

  setQuality(q) { this.quality = q; }
}
