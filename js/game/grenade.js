// 投掷物系统：抛物线、引信、HE / 闪光 / 烟雾 / 燃烧瓶。
// T-014 起兼做两件事：
//   1) 烟雾视线判定（smokeBlocks）：玩家 / Bot 共用同一份查询，避免「人看不见、Bot 穿烟打」；
//   2) Bot 投掷通道（world.botUtilityQueue）：Bot 只往队列塞请求，由本系统统一生成投掷物，
//      这样 bots.js 不需要持有 game 引用，也不用改 game.js 的 ctx。
import * as THREE from '../../vendor/three.module.js';
import { MOVEMENT, UTILITY, ECONOMY } from '../config/weapons.js';
import { buildPropModel } from '../render/prop-models.js';
import { mergeGeos, paint } from '../world/geo-utils.js';
import { audio } from '../core/audio.js';

const GRAVITY = MOVEMENT.gravity;
const V = new THREE.Vector3();

// 烟柱高度：从落地中心往上算。两端都在烟顶以上时不算遮挡（高台对高台）。
const SMOKE_HEIGHT = 2.8;
// 起烟 0.35 s 内半径线性涨满，避免「刚落地就隔空挡枪」的突兀感。
const SMOKE_BLOOM = 0.35;
// world 上的私有标记：用 Symbol 避免污染 Object.keys(world)
const FIELD = Symbol('grenadeField');

/** 2D 线段 vs 圆：用于俯视视角下的烟遮断。 */
function segHitsCircle(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-6 ? ((cx - ax) * dx + (cz - az) * dz) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = ax + dx * t - cx;
  const pz = az + dz * t - cz;
  return px * px + pz * pz <= r * r;
}

/**
 * 烟雾是否挡住 a→b 的视线。
 *
 * 全仓唯一实现：Bot 的目标获取 / 开枪前检查走这里；玩家侧（以及将来的观战、投掷物
 * 视线判定）也调同一份，保证双方看到的是同一团烟，不存在「一边挡一边不挡」。
 * 判定是 2D 的（烟近似竖直圆柱），另加高度闸门：两端都在烟顶以上时放行。
 *
 * @param {number} ax @param {number} ay @param {number} az
 * @param {number} bx @param {number} by @param {number} bz
 * @param {Array} smokes GrenadeSystem.smokes
 * @returns {boolean} true = 被烟挡住
 */
export function smokeBlocks(ax, ay, az, bx, by, bz, smokes) {
  if (!smokes || !smokes.length) return false;
  const low = Math.min(ay, by);
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i];
    if (!s || s.t > s.life) continue;
    if (low > s.y + SMOKE_HEIGHT) continue;
    const grow = s.t < SMOKE_BLOOM ? s.t / SMOKE_BLOOM : 1;
    const r = s.radius * grow;
    if (r < 0.2) continue;
    if (segHitsCircle(ax, az, bx, bz, s.x, s.z, r)) return true;
  }
  return false;
}

let smokeTexture = null;
function getSmokeTexture() {
  if (smokeTexture) return smokeTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(236,236,230,0.95)');
  g.addColorStop(0.45, 'rgba(210,210,204,0.55)');
  g.addColorStop(1, 'rgba(190,190,184,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  smokeTexture = new THREE.CanvasTexture(c);
  smokeTexture.colorSpace = THREE.SRGBColorSpace;
  return smokeTexture;
}

function disposeGroup(group) {
  if (!group) return;
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
  if (group.parent) group.parent.remove(group);
}

export class GrenadeSystem {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.explosions = [];
    this.smokes = [];
    this.fires = [];
    // T-014：Bot 投掷请求队列。Bot 只 push {type, origin, vel, owner}，
    // 由 update() 统一生成投掷物；队列对象挂在 world 上供 bots.js 取用。
    this.queue = [];
  }

  clear() {
    for (const p of this.projectiles) {
      if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
    }
    for (const e of this.explosions) disposeGroup(e.mesh);
    for (const s of this.smokes) disposeGroup(s.group);
    for (const f of this.fires) disposeGroup(f.group);
    this.projectiles = [];
    this.explosions = [];
    this.smokes = [];
    this.fires = [];
    this.queue.length = 0;
  }

  /**
   * 把烟雾查询挂到「当前」world 上。game.world 会在大厅/对局之间切换
   * （构造时还是大厅 world），所以只能每帧懒绑定，不能构造函数里绑一次。
   */
  _syncWorld() {
    const w = this.game && this.game.world;
    if (!w || w[FIELD] === this) return;
    w[FIELD] = this;
    // 只读查询：不复制烟数据，闭包里取 this.smokes，clear() 重新赋值也能跟着走
    w.smokeBlocks = (ax, ay, az, bx, by, bz) => smokeBlocks(ax, ay, az, bx, by, bz, this.smokes);
    w.botUtilityQueue = this.queue;
  }

  /** 烟雾视线查询（玩家与 Bot 共用；world.smokeBlocks 是同一个函数）。 */
  smokeBlocks(ax, ay, az, bx, by, bz) {
    return smokeBlocks(ax, ay, az, bx, by, bz, this.smokes);
  }

  throw(type, origin, dir) {
    const def = UTILITY[type];
    if (!def) return false;
    const vel = dir.clone().multiplyScalar(18);
    vel.y += 2.8;
    vel.addScaledVector(this.game.player.velocity, 0.35);
    if (!this._spawn(type, origin, vel, null)) return false;
    audio.play('throw', { volume: 0.5 });
    return true;
  }

  /** 生成一颗投掷物。owner 为投掷者（Bot），用于闪光不闪自己。 */
  _spawn(type, origin, vel, owner) {
    const def = UTILITY[type];
    if (!def) return false;
    let mesh = null;
    try {
      mesh = buildPropModel(type);
      mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    } catch (e) {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x6f7a52, roughness: 0.7 })
      );
    }
    mesh.position.copy(origin);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.game.matchRoot.add(mesh);

    this.projectiles.push({
      type, def, mesh,
      pos: origin.clone(),
      vel: vel.clone(),
      fuse: def.fuse,
      dead: false,
      owner: owner || null
    });
    return true;
  }

  /** 消费 Bot 投掷请求。逐个生成；队列每帧清空，Bot 不会攒请求。 */
  _drainBotThrows() {
    const q = this.queue;
    if (!q.length) return;
    for (let i = 0; i < q.length; i++) {
      const req = q[i];
      const origin = new THREE.Vector3(req.origin.x, req.origin.y, req.origin.z);
      const vel = new THREE.Vector3(req.vel.x, req.vel.y, req.vel.z);
      if (this._spawn(req.type, origin, vel, req.owner)) {
        audio.play('throw', { volume: 0.35 });
      }
    }
    q.length = 0;
  }

  update(dt) {
    this._syncWorld();
    this._drainBotThrows();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.dead) {
        this._removeProjectile(p);
        continue;
      }
      p.fuse -= dt;
      this._stepProjectile(p, dt);
      if (p.dead) {
        this._removeProjectile(p);
        continue;
      }
      // 燃烧瓶只在撞击时引爆；其余引信归零引爆。
      if (p.type !== 'molotov' && p.fuse <= 0) {
        this._detonate(p, p.pos.clone());
        this._removeProjectile(p);
      }
    }
    this._updateExplosions(dt);
    this._updateSmokes(dt);
    this._updateFires(dt);
  }

  _stepProjectile(p, dt) {
    p.vel.y -= GRAVITY * dt;
    const speed = p.vel.length();
    if (speed < 0.001) {
      p.mesh.position.copy(p.pos);
      return;
    }
    const steps = Math.max(1, Math.ceil((speed * dt) / 0.12));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const dir = V.copy(p.vel).normalize();
      const dist = p.vel.length() * sdt;
      const hit = this.game.world.raycast(
        p.pos.x, p.pos.y, p.pos.z,
        dir.x, dir.y, dir.z,
        dist
      );
      if (hit) {
        p.pos.set(
          hit.x - dir.x * 0.025,
          hit.y - dir.y * 0.025,
          hit.z - dir.z * 0.025
        );
        if (p.type === 'molotov') {
          this._detonate(p, p.pos.clone());
          p.dead = true;
          return;
        }
        const n = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
        const vn = p.vel.dot(n);
        p.vel.addScaledVector(n, -2 * vn);
        p.vel.multiplyScalar(p.def.bounce == null ? 0.35 : p.def.bounce);
        if (p.vel.lengthSq() < 1.0) p.vel.set(0, 0, 0);
        if (p.vel.lengthSq() > 0.25) audio.play('he_bounce', { volume: 0.32 });
        break;
      }
      p.pos.addScaledVector(p.vel, sdt);
    }
    p.mesh.position.copy(p.pos);
    p.mesh.rotation.x += dt * 3.2;
    p.mesh.rotation.z += dt * 2.1;
    if (p.pos.y < -8) {
      p.dead = true;
    }
  }

  _removeProjectile(p) {
    if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
    const i = this.projectiles.indexOf(p);
    if (i >= 0) this.projectiles.splice(i, 1);
  }

  _detonate(p, pos) {
    if (p.type === 'he') this._explode(pos);
    else if (p.type === 'flash') this._flash(pos, p.owner);
    else if (p.type === 'smoke') this._smoke(pos);
    else if (p.type === 'molotov') this._fire(pos);
  }

  _explode(pos) {
    const def = UTILITY.he;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffb060, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.3);
    this.game.matchRoot.add(mesh);
    this.explosions.push({ kind: 'he', mesh, light: null, t: 0, life: 0.42, radius: def.radius });

    const p = this.game.player;
    if (p.alive) {
      const eye = p.eye(new THREE.Vector3());
      const dist = pos.distanceTo(eye);
      if (dist < def.radius) {
        const blocked = !this.game.world.lineOfSight(pos.x, pos.y + 0.2, pos.z, eye.x, eye.y, eye.z);
        const dmg = def.damage * (1 - dist / def.radius) * (blocked ? 0.35 : 1);
        if (dmg > 1) this._damagePlayer(dmg, 'HE 手雷');
      }
    }
    for (const b of this.game.bots) {
      if (!b.alive) continue;
      const eye = b.eye(new THREE.Vector3());
      const dist = pos.distanceTo(eye);
      if (dist >= def.radius) continue;
      const blocked = !this.game.world.lineOfSight(pos.x, pos.y + 0.2, pos.z, eye.x, eye.y, eye.z);
      const dmg = def.damage * (1 - dist / def.radius) * (blocked ? 0.35 : 1);
      if (dmg > 1) this._damageBot(b, dmg, 'HE 手雷');
    }

    this.game.shake = Math.max(this.game.shake, 1.2);
    this.game.hud.flashDamage(0.9);
    audio.play('he_explode', { volume: 1 });
  }

  _flash(pos, owner) {
    const def = UTILITY.flash;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.2);
    this.game.matchRoot.add(mesh);
    this.explosions.push({ kind: 'flash', mesh, light: null, t: 0, life: 0.28, radius: 4.5 });

    const p = this.game.player;
    if (p.alive) {
      const eye = p.eye(new THREE.Vector3());
      const dist = pos.distanceTo(eye);
      if (dist < def.radius) {
        const blocked = !this.game.world.lineOfSight(pos.x, pos.y + 0.2, pos.z, eye.x, eye.y, eye.z);
        if (!blocked) {
          const to = V.copy(pos).sub(eye).normalize();
          const dot = Math.max(0, p.aimDir(new THREE.Vector3()).dot(to));
          const strength = 1 - dist / def.radius;
          const blind = 1.5 + (def.maxBlind - 1.5) * strength * (0.35 + 0.65 * dot);
          this.game.blindT = Math.max(this.game.blindT, blind);
        }
      }
    }
    for (const b of this.game.bots) {
      if (!b.alive) continue;
      // 自己扔的闪不闪自己（Bot 贴脸扔闪时不该自废）
      if (owner && b === owner) continue;
      const eye = b.eye(new THREE.Vector3());
      const dist = pos.distanceTo(eye);
      if (dist >= def.radius) continue;
      const blocked = !this.game.world.lineOfSight(pos.x, pos.y + 0.2, pos.z, eye.x, eye.y, eye.z);
      if (blocked) continue;
      const blind = 1.5 + (def.maxBlind - 1.5) * (1 - dist / def.radius);
      b.flashT = Math.max(b.flashT || 0, blind);
      b.shootCd = Math.max(b.shootCd || 0, blind);
      b.reaction = 0;
    }
    audio.play('flash_explode', { volume: 0.9 });
  }

  _smoke(pos) {
    const def = UTILITY.smoke;
    const group = new THREE.Group();
    group.position.set(pos.x, Math.max(0.2, pos.y), pos.z);
    const tex = getSmokeTexture();
    const count = 14;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.8;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0.4 + Math.random() * 2.2;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      map: tex, size: 4.0, sizeAttenuation: true,
      transparent: true, opacity: 0.62, depthWrite: false, color: 0xd9d9d2
    });
    const points = new THREE.Points(geo, mat);
    group.add(points);
    this.game.matchRoot.add(group);
    this.smokes.push({
      group, points, mat, positions, t: 0, life: def.duration, radius: def.radius,
      // 世界坐标单独存一份：视线查询不该依赖渲染对象，也方便测试直接构造
      x: group.position.x, y: group.position.y, z: group.position.z
    });
    audio.play('smoke_pop', { volume: 0.7 });
  }

  _fire(pos) {
    const def = UTILITY.molotov;
    const group = new THREE.Group();
    group.position.set(pos.x, Math.max(0.03, pos.y - 0.1), pos.z);
    const discGeo = new THREE.CircleGeometry(def.radius * 0.92, 24);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0xff5a1f, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = 0.02;
    group.add(disc);

    const geos = [];
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * def.radius * 0.82;
      const h = 0.8 + Math.random() * 1.4;
      const geo = new THREE.ConeGeometry(0.14 + Math.random() * 0.2, h, 6);
      geo.translate(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      if (i % 3 === 0) paint(geo, 1.0, 0.83, 0.42);
      else if (i % 3 === 1) paint(geo, 1.0, 0.54, 0.21);
      else paint(geo, 0.91, 0.29, 0.12);
      geos.push(geo);
    }
    const flameMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.78,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const flames = new THREE.Mesh(mergeGeos(geos), flameMat);
    group.add(flames);

    this.game.matchRoot.add(group);
    this.fires.push({
      group, disc, flames, t: 0, life: def.duration, radius: def.radius,
      tick: 0, x: pos.x, z: pos.z
    });
    audio.play('molotov_break', { volume: 1 });
  }

  _updateExplosions(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.life);
      if (e.kind === 'he') {
        const s = 0.3 + (e.radius * 0.95) * k;
        e.mesh.scale.setScalar(s);
        e.mesh.material.opacity = 0.95 * (1 - k) * (1 - k);
      } else {
        e.mesh.scale.setScalar(0.2 + 4.2 * k);
        e.mesh.material.opacity = 0.95 * (1 - k);
      }
      if (e.t >= e.life) {
        disposeGroup(e.mesh);
        this.explosions.splice(i, 1);
      }
    }
  }

  _updateSmokes(dt) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt;
      const k = s.t / s.life;
      s.mat.size = 4.0 + Math.min(1, k * 2.2) * 3.4;
      for (let j = 0; j < s.positions.length; j += 3) {
        s.positions[j + 1] += dt * 0.05;
        s.positions[j] += Math.sin(s.t * 0.8 + j) * dt * 0.02;
      }
      s.points.geometry.attributes.position.needsUpdate = true;
      s.mat.opacity = 0.62 * (1 - Math.max(0, (k - 0.78) / 0.22));
      if (s.t >= s.life) {
        disposeGroup(s.group);
        this.smokes.splice(i, 1);
      }
    }
  }

  _updateFires(dt) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      f.tick += dt;
      const k = f.t / f.life;
      if (f.disc) f.disc.material.opacity = 0.22 * (1 - Math.max(0, (k - 0.7) / 0.3));
      if (f.flames) {
        f.flames.scale.y = 0.9 + Math.sin(f.t * 9) * 0.1;
        f.flames.material.opacity = 0.78 * (1 - Math.max(0, (k - 0.8) / 0.2));
      }
      if (f.tick >= 0.28) {
        f.tick = 0;
        this._fireTick(f);
      }
      if (f.t >= f.life) {
        disposeGroup(f.group);
        this.fires.splice(i, 1);
      }
    }
  }

  _fireTick(f) {
    const p = this.game.player;
    if (p.alive) {
      const d = Math.hypot(p.position.x - f.x, p.position.z - f.z);
      if (d < f.radius) this._damagePlayer(8, '燃烧瓶');
    }
    for (const b of this.game.bots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - f.x, b.pos.z - f.z);
      if (d < f.radius) this._damageBot(b, 7, '燃烧瓶');
    }
  }

  _damagePlayer(dmg, cause) {
    const g = this.game;
    if (!g.player.alive) return;
    g.player.damage(dmg);
    g.hud.setVitals(g.player.hp, g.player.armor);
    g.hud.flashDamage(0.55);
    g.shake = Math.max(g.shake, 0.35);
    if (!g.player.alive) {
      g.playerDeaths++;
      g.viewmodel.root.visible = false;
      g.hud.killfeed(cause + ' 你');
    }
  }

  _damageBot(b, dmg, cause) {
    const g = this.game;
    if (!b.alive) return;
    const killed = b.damage(dmg, false);
    if (!killed) return;
    g.playerKills++;
    g.addMoney(ECONOMY.kill);
    const tag = g.isPlayerTeam(b) ? '队友' : '敌人';
    g.hud.killfeed('你 [ ' + cause + ' ] ' + tag + b.label);
  }
}
