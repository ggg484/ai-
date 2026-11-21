// 回合状态机：购买 → 进行 → 安放 → 结束。
// 骨架版胜负：清光敌人 / 炸弹引爆 = 胜；玩家阵亡 / 时间耗尽 = 负。
// TODO(round): 半场交换、加时、Bot 拆包、包点封锁、经济连败补偿曲线。

import * as THREE from '../../vendor/three.module.js';
import { audio } from '../core/audio.js';
import { ECONOMY } from '../config/weapons.js';
import { MODE_MAP } from '../config/modes.js';

export const PHASE = { FREEZE: 'freeze', LIVE: 'live', PLANTED: 'planted', ENDED: 'ended' };

export class Round {
  constructor(game) {
    this.game = game;
    this.mode = MODE_MAP.classic;
    this.round = 1;
    this.scoreT = 0;
    this.scoreCT = 0;
    this.phase = PHASE.FREEZE;
    this.timer = 12;
    this.plantProgress = 0;
    this.bomb = null;
    // 阶段 2：Bot 任务点与拆包进度
    this._plantSite = null;
    this._planter = null;
    this._defuser = null;
    this._defuseProgress = 0;
    this.endTimer = 0;
    this.result = null;
    this.beepT = 0;
    this.matchOver = false;
    this._bombGroup = null;
  }

  beginMatch(mode) {
    this.mode = mode || MODE_MAP.classic;
    this.round = 1;
    this.scoreT = 0;
    this.scoreCT = 0;
    this.matchOver = false;
    this.endTimer = 0;
    this.start();
  }

  start() {
    const g = this.game;
    this.phase = PHASE.FREEZE;
    this.timer = this.mode.freezeTime || 12;
    this.plantProgress = 0;
    this.result = null;
    this._plantSite = null;
    this._planter = null;
    this._defuser = null;
    this._defuseProgress = 0;
    this.removeBomb();

    g.roundEnding = false;
    g.player.respawnPoint = g.map.spawns.player;
    g.player.reset(g.map.spawns.player);
    g.bots.forEach((b) => b.reset());
    g.hud.setPhase('购买时间');
    g.hud.setObjective('购买装备，准备进攻 A / B');
    g.hud.setBomb(false);
    g.hud.setRound(this.round);
    g.hud.setScore(this.scoreT, this.scoreCT);
    g.onRoundStart();
    audio.play('beep', { volume: 0.3 });
  }

  update(dt) {
    const g = this.game;
    const player = g.player;

    if (this.phase === PHASE.ENDED) {
      this.endTimer -= dt;
      if (this.matchOver) return;
      if (this.endTimer <= 0) {
        this.round++;
        this.start();
      }
      return;
    }

    if (this.phase === PHASE.FREEZE) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = PHASE.LIVE;
        this.timer = this.mode.roundTime || 100;
        g.hud.setPhase('进行中');
        g.hud.setObjective('在 A / B 点安放炸弹');
      }
      return;
    }

    if (this.phase === PHASE.LIVE) {
      this.timer -= dt;
      this._assignBotObjectives(PHASE.LIVE);
      this._plantLogic(dt);
      if (this.phase !== PHASE.LIVE) return;
      const tAlive = (player.alive ? 1 : 0) + g.allyBots.filter((b) => b.alive).length;
      const ctAlive = g.enemyBots.filter((b) => b.alive).length;
      if (ctAlive === 0) { this.end(true, '敌人已全部消灭'); return; }
      if (tAlive === 0) { this.end(false, '我方已全部阵亡'); return; }
      if (!player.alive) {
        g.hud.setPhase('观战中');
        g.hud.setObjective('队友仍在战斗');
      }
      if (this.timer <= 0) { this.end(false, '时间到，炸弹未安放'); return; }
    }

    if (this.phase === PHASE.PLANTED) {
      this.timer -= dt;
      this._assignBotObjectives(PHASE.PLANTED);
      this._defuseLogic(dt);
      if (this.phase !== PHASE.PLANTED) return;
      this._bombVisual(dt);
      if (this.timer <= 0) { this._explode(); this.end(true, '炸弹已引爆'); return; }
      g.hud.setBombTimer(this.timer);
      if (!player.alive) {
        const allyAlive = g.allyBots.some((b) => b.alive);
        g.hud.setPhase(allyAlive ? '观战中' : '炸弹倒计时');
      }
    }
  }

  _plantLogic(dt) {
    const g = this.game;
    const p = g.player;
    let site = null;
    let pos = null;

    // 玩家优先：站在包点按住使用键
    if (p.alive) {
      const s = this.siteAt(p.position.x, p.position.z);
      if (s && g.input.isDown('use')) { site = s; pos = p.position; }
    }
    // 玩家没接手，就看被指派的 Bot 是否到位站定（交战状态下不准下包）
    if (!site) {
      const b = this._planter;
      if (b && b.alive && b.holding && !b.engage) {
        const s = this.siteAt(b.pos.x, b.pos.z);
        if (s) { site = s; pos = b.pos; }
      }
    }

    if (site) {
      this.plantProgress += dt / 3.2;
      g.hud.setPlant(Math.min(1, this.plantProgress), true);
      if (this.plantProgress >= 1) {
        this.plantProgress = 0;
        this.plant(site, pos);
      }
    } else if (this.plantProgress > 0) {
      this.plantProgress = Math.max(0, this.plantProgress - dt * 2.5);
      g.hud.setPlant(this.plantProgress, this.plantProgress > 0.01);
    } else {
      g.hud.setPlant(0, false);
    }
  }

  /**
   * 阶段 2：任务点由回合系统统一指派，Bot 只负责执行。
   * 这样才能保证「同一时刻只有一个下包人 / 拆包人」，进度不会被多个 Bot 叠加。
   */
  _assignBotObjectives(phase) {
    const g = this.game;
    if (phase === PHASE.LIVE) {
      if (!this._plantSite) this._plantSite = Math.random() < 0.5 ? 'A' : 'B';
      const s = g.map.sites[this._plantSite];
      let best = null;
      let bestD = 1e9;
      for (const b of g.allyBots) {
        if (!b.alive) continue;
        const d = Math.hypot(b.pos.x - s.x, b.pos.z - s.z);
        if (d < bestD) { bestD = d; best = b; }
      }
      this._planter = best;
      for (const b of g.allyBots) {
        if (b === best) b.objective = { type: 'plant', x: s.x, z: s.z };
        else if (b.objective && b.objective.type === 'plant') b.objective = null;
      }
      for (const b of g.enemyBots) {
        if (b.objective && b.objective.type === 'defuse') b.objective = null;
      }
      return;
    }

    if (phase === PHASE.PLANTED && this.bomb) {
      let best = null;
      let bestD = 1e9;
      for (const b of g.enemyBots) {
        if (!b.alive) continue;
        const d = Math.hypot(b.pos.x - this.bomb.x, b.pos.z - this.bomb.z);
        if (d < bestD) { bestD = d; best = b; }
      }
      this._defuser = best;
      for (const b of g.enemyBots) {
        if (b === best) b.objective = { type: 'defuse', x: this.bomb.x, z: this.bomb.z };
        else if (b.objective) b.objective = null;
      }
      for (const b of g.allyBots) {
        if (b.objective) b.objective = null;
        b.holding = false;
      }
    }
  }

  /** CT Bot 拆包：站定 5 s 完成；中途交战或被打断则进度回退。 */
  _defuseLogic(dt) {
    const g = this.game;
    if (!this.bomb) return;
    const b = this._defuser;
    let active = false;
    if (b && b.alive && b.holding && !b.engage) {
      active = Math.hypot(b.pos.x - this.bomb.x, b.pos.z - this.bomb.z) < 1.7;
    }

    if (active) {
      this._defuseProgress += dt / (this.mode.defuseTime || 5);
      g.hud.setObjective('拆除中 ' + Math.round(Math.min(1, this._defuseProgress) * 100) + '%');
      if (this._defuseProgress >= 1) {
        this._defuseProgress = 0;
        this.removeBomb();
        g.hud.setBomb(false);
        this.end(false, '炸弹已被拆除');
      }
    } else if (this._defuseProgress > 0) {
      this._defuseProgress = Math.max(0, this._defuseProgress - dt * 1.2);
      if (this.phase === PHASE.PLANTED) g.hud.setObjective('守住炸弹直到引爆');
    }
    if (this.bomb) this.bomb.defuse = this._defuseProgress;
  }

  siteAt(x, z) {
    const s = this.game.map.sites;
    for (const k of Object.keys(s)) {
      const d = Math.hypot(x - s[k].x, z - s[k].z);
      if (d < s[k].r) return k;
    }
    return null;
  }

  plant(site, pos) {
    const g = this.game;
    this.phase = PHASE.PLANTED;
    this.timer = this.mode.bombTime || 40;
    this.plantProgress = 0;
    g.hud.setPlant(0, false);
    g.hud.setPhase('炸弹已安放');
    g.hud.setObjective('守住炸弹直到引爆');
    g.hud.setBomb(true);
    g.hud.setBombTimer(this.timer);
    g.addMoney(ECONOMY.plant);
    audio.play('plant', { volume: 0.8 });

    const grp = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.2, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.7, metalness: 0.3 })
    );
    body.position.y = 0.1;
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.05, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 2 })
    );
    light.position.set(0.1, 0.24, 0);
    grp.add(body); grp.add(light);
    grp.position.set(pos.x, pos.y, pos.z);
    g.scene.add(grp);
    this._bombGroup = grp;
    this._bombLight = light;
    this.bomb = { x: pos.x, z: pos.z, site: site };
    this.beepT = 0;
  }

  _bombVisual(dt) {
    if (!this._bombLight) return;
    this.beepT -= dt;
    const interval = Math.max(0.12, Math.min(1.0, this.timer / (this.mode.bombTime || 40)));
    const on = this.beepT > interval * 0.5;
    this._bombLight.material.emissiveIntensity = on ? 4 : 0.2;
    if (this.beepT <= 0) {
      this.beepT = interval;
      audio.play('beep', { volume: this.timer < 10 ? 0.55 : 0.3 });
    }
  }

  _explode() {
    audio.play('explode', { volume: 1 });
    if (this._bombGroup) this._bombGroup.visible = false;
    this.game.hud.flashDamage(1);
    this.game.hud.setBomb(false);
  }

  removeBomb() {
    if (this._bombGroup) {
      this.game.scene.remove(this._bombGroup);
      this._bombGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this._bombGroup = null;
    this._bombLight = null;
    this.bomb = null;
  }

  end(win, reason) {
    if (this.phase === PHASE.ENDED) return;
    const g = this.game;
    this.phase = PHASE.ENDED;
    this.result = win;
    this.endTimer = 4;
    this.plantProgress = 0;
    g.hud.setPlant(0, false);
    g.hud.setBomb(false);
    if (win) { this.scoreT++; g.addMoney(ECONOMY.win); }
    else { this.scoreCT++; g.addMoney(ECONOMY.loss); }
    g.hud.setScore(this.scoreT, this.scoreCT);
    g.hud.setPhase('回合结束');
    g.hud.showRoundEnd(win, reason);
    audio.play(win ? 'win' : 'lose', { volume: 0.8 });
    g.endRound(win, reason);

    if (this.scoreT >= this.mode.winScore || this.scoreCT >= this.mode.winScore) {
      this.matchOver = true;
      this.endTimer = 1.2;
      g.onMatchEnd(this.scoreT >= this.mode.winScore, reason);
    }
  }
}
