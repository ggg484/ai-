// 第一人称武器视图：真模型替换点在这里。
// 关键点：depthTest=false，保证枪不穿墙；所有零件按材质合批，draw call 不随零件数增长。

import * as THREE from '../../vendor/three.module.js';
import { buildWeaponModel } from './weapon-models.js';
import { applySkin } from './skin-material.js';

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

const WEAPON_IDS = ['ak', 'glock', 'knife'];

export class Viewmodel {
  constructor(camera) {
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.root.renderOrder = 1000;
    this.root.scale.setScalar(0.72);
    camera.add(this.root);

    // 枪械专用补光，避免在阴影里变成黑块；距离很短，不影响场景。
    this.camLight = new THREE.PointLight(0xfff0d8, 2.1, 3.0, 2);
    this.camLight.position.set(0.35, 0.3, 0.25);
    camera.add(this.camLight);

    this.guns = {};
    WEAPON_IDS.forEach((id) => {
      const g = buildWeaponModel(id, { depthTest: false, renderOrder: 1000, hands: true });
      g.userData.weaponId = id;
      g.visible = false;
      this.root.add(g);
      this.guns[id] = g;
    });

    this.flashMat = new THREE.MeshBasicMaterial({
      map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, opacity: 0
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), this.flashMat);
    this.flash.renderOrder = 1001;
    this.flash.visible = false;
    camera.add(this.flash);

    this.light = new THREE.PointLight(0xffb060, 0, 6, 2);
    this.light.visible = false;
    camera.add(this.light);

    this.current = null;
    this.skins = {};
    this.kick = 0;
    this.flashT = 0;
    this.raise = 0;
    this.sway = new THREE.Vector2();
    this.basePos = new THREE.Vector3();
    this.baseRot = new THREE.Vector3();
    this.muzzleWorld = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._flashPos = new THREE.Vector3();
    this.quality = 'medium';
  }

  setWeapon(id) {
    if (!this.guns[id]) return;
    if (this.current === id) return;
    Object.keys(this.guns).forEach((k) => { this.guns[k].visible = (k === id); });
    this.current = id;
    this.raise = 0.28;
    if (id === 'knife') {
      this.basePos.set(0.28, -0.25, -0.46);
      this.baseRot.set(0.12, -0.18, -0.08);
    } else if (id === 'glock') {
      this.basePos.set(0.30, -0.26, -0.58);
      this.baseRot.set(0.03, 0.07, -0.06);
    } else {
      this.basePos.set(0.36, -0.29, -0.78);
      this.baseRot.set(0.028, 0.06, -0.05);
    }
    this.root.position.copy(this.basePos);
    const entry = this.skins[id];
    if (entry) applySkin(this.guns[id], entry.skin, entry.variant);
  }

  /** 装备皮肤；传 null 为原厂。 */
  setSkin(id, skin, variant) {
    if (!this.guns[id]) return;
    this.skins[id] = skin ? { skin: skin, variant: variant } : null;
    applySkin(this.guns[id], skin || null, variant);
  }

  onFire() {
    this.kick = 1;
    if (this.current === 'knife') {
      this.flashT = 0;
      return;
    }
    this.flashT = 0.055;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.light.visible = this.quality !== 'low';
    this.light.intensity = 2.2;
  }

  muzzlePosition(out) {
    const g = this.guns[this.current];
    if (!g || !g.userData.muzzle) return out.copy(this.root.position);
    g.updateWorldMatrix(true, false);
    g.userData.muzzle.getWorldPosition(out);
    return out;
  }

  update(dt, weapon, player, camera) {
    const g = this.guns[this.current];
    if (!g) return;
    camera.updateMatrixWorld(true);

    dt = Math.max(0, Math.min(0.1, dt));
    this.kick = Math.min(1, Math.max(0, this.kick - dt * 9));
    this.raise = Math.min(0.28, Math.max(0, this.raise - dt));
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.flashT <= 0) {
      this.flash.visible = false;
      this.light.visible = false;
      this.light.intensity = 0;
    }

    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const t = performance.now() * 0.001;
    this.sway.x += ((Math.sin(t * 1.6) * 0.006 + Math.sin(player.bobT) * 0.012 * Math.min(1, speed / 4)) - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += ((Math.cos(t * 1.3) * 0.005 + Math.abs(Math.cos(player.bobT)) * 0.01 * Math.min(1, speed / 4)) - this.sway.y) * Math.min(1, dt * 8);
    this.sway.x = Math.max(-0.04, Math.min(0.04, this.sway.x));
    this.sway.y = Math.max(-0.04, Math.min(0.04, this.sway.y));

    const raiseOff = this.raise > 0 ? -this.raise * 0.9 : 0;
    const reload = weapon && weapon.reloading ? Math.sin(weapon.reloadProgress() * Math.PI) : 0;
    const isKnife = this.current === 'knife';

    this.root.position.set(
      this.basePos.x + this.sway.x,
      this.basePos.y + this.sway.y - raiseOff - reload * 0.12,
      this.basePos.z + this.kick * (isKnife ? 0.02 : 0.055)
    );
    this.root.rotation.set(
      this.baseRot.x - this.kick * (isKnife ? 0.16 : 0.08) + reload * 0.55,
      this.baseRot.y - this.sway.x * 1.2 + reload * 0.35,
      this.baseRot.z + reload * 0.5 + this.sway.y * 0.8
    );

    if (isKnife) return;
    const m = this.muzzlePosition(this._flashPos);
    this.flash.position.copy(camera.worldToLocal(m.clone()));
    this.flash.position.z -= 0.02;
    this.light.position.copy(this.flash.position);
  }

  setQuality(q) { this.quality = q; }
}
