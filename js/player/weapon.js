// 武器状态机：射速、弹匣、换弹、扩散、后坐力索引。
// 命中判定不在这里，Game 负责射线；这里只回答「这一发打不打得出、偏多少」。

import { WEAPONS } from '../config/weapons.js';

export class Weapon {
  constructor(id) {
    this.def = WEAPONS[id] || WEAPONS.glock;
    this.ammo = this.def.mag;
    this.reserve = this.def.reserve;
    this.cooldown = 0;
    this.reloadLeft = 0;
    this.recoilIndex = 0;
    this.sinceShot = 99;
    this.triggerReady = true;
    this.shots = 0;
  }

  get name() { return this.def.name; }
  get reloading() { return this.reloadLeft > 0; }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt;
    if (this.sinceShot > 0.32) this.recoilIndex = 0;
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        this.reloadLeft = 0;
        const need = this.def.mag - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
    }
  }

  startReload() {
    if (this.reloading) return false;
    if (this.ammo >= this.def.mag) return false;
    if (this.reserve <= 0) return false;
    this.reloadLeft = this.def.reload;
    return true;
  }

  canFire() {
    return !this.reloading && this.cooldown <= 0 && this.ammo > 0;
  }

  /** 返回本发的扩散角（弧度）与后坐力条目；不处理命中。 */
  fire() {
    if (!this.canFire()) return null;
    this.ammo--;
    this.cooldown = 60 / this.def.rpm;
    const pattern = this.def.recoil;
    const rec = pattern[Math.min(this.recoilIndex, pattern.length - 1)];
    this.recoilIndex++;
    this.sinceShot = 0;
    this.shots++;
    return {
      spread: this.spread(),
      recoilPitch: rec[0],
      recoilYaw: rec[1]
    };
  }

  spread() {
    const def = this.def;
    const base = def.spread;
    const bloom = Math.min(0.03, this.recoilIndex * 0.0007);
    return base + bloom;
  }

  reloadProgress() {
    if (!this.reloading) return 1;
    return 1 - this.reloadLeft / this.def.reload;
  }

  addAmmo() {
    this.reserve = this.def.reserve;
  }

  refill() {
    this.ammo = this.def.mag;
    this.reserve = this.def.reserve;
    this.reloadLeft = 0;
    this.cooldown = 0;
    this.recoilIndex = 0;
  }
}
