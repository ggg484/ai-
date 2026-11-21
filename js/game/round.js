// 回合状态机：购买 → 进行 → 安放 → 结束。
// 胜负：清光敌人 / 炸弹引爆 = T 胜；拆包 / 时间耗尽 / T 全灭 = CT 胜。
// 已实现：Bot 拆包、加时赛（MR4 × 3）、连败补偿曲线。
// TODO(round): 半场交换（等 T-008 钩子）、包点封锁。

import * as THREE from '../../vendor/three.module.js';
import { audio } from '../core/audio.js';
import { ECONOMY } from '../config/weapons.js';
import { MODE_MAP } from '../config/modes.js';

export const PHASE = { FREEZE: 'freeze', LIVE: 'live', PLANTED: 'planted', ENDED: 'ended' };

// 加时赛：每个加时半场先到 4 分；最多 3 个加时，仍未分胜负则战平。
// 加时统一发 10000，不继承常规赛经济，避免一方带着经济优势滚雪球。
export const OVERTIME = { winScore: 4, maxOvertimes: 3, startMoney: 10000 };

// 连败补偿：1400 / 1900 / 2400 / 2900 / 3400，第 5 连败起封顶。
export const LOSS_BONUS_STEP = 500;
export const LOSS_BONUS_MAX = 5;

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
    // 阵营：3b 半场交换时翻转。现在整条链路仍按「玩家 = T」实现，
    // 只把字段留好，end() 已经通过它折算玩家视角的胜负。
    this.playerSide = 't';
    // 加时赛：0 = 常规赛；1..3 = 第几个加时；otBase 记录每个加时的起始比分
    this.overtime = 0;
    this.otBase = { t: 0, ct: 0 };
    this.otPending = false;
    this.draw = false;
    // 连败计数（按阵营），用于经济补偿与 T-009 的 Bot 钱包
    this.lossStreak = { t: 0, ct: 0 };
  }

  beginMatch(mode) {
    this.mode = mode || MODE_MAP.classic;
    this.round = 1;
    this.scoreT = 0;
    this.scoreCT = 0;
    this.matchOver = false;
    this.endTimer = 0;
    this.playerSide = 't';
    this.overtime = 0;
    this.otBase = { t: 0, ct: 0 };
    this.otPending = false;
    this.draw = false;
    this.lossStreak = { t: 0, ct: 0 };
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

    // 加时赛开局统一发钱（必须在 onRoundStart 之前，购买界面会读 money）
    if (this.otPending) {
      this.otPending = false;
      this._grantOvertimeMoney();
    }

    g.roundEnding = false;
    g.player.respawnPoint = g.map.spawns.player;
    g.player.reset(g.map.spawns.player);
    g.bots.forEach((b) => b.reset());
    g.hud.setPhase(this.overtime > 0 ? `加时赛 ${this.overtime}` : '购买时间');
    g.hud.setObjective(this.overtime > 0
      ? `加时赛 ${this.overtime} · 先到 ${OVERTIME.winScore} 分`
      : '购买装备，准备进攻 A / B');
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

  end(tWin, reason) {
    if (this.phase === PHASE.ENDED) return;
    const g = this.game;
    this.phase = PHASE.ENDED;
    // tWin 始终表示「T 方是否获胜」；玩家视角由 playerSide 折算，3b 换边后这里不用改
    const playerWin = this.playerSide === 't' ? tWin : !tWin;
    this.result = playerWin;
    this.endTimer = 4;
    this.plantProgress = 0;
    g.hud.setPlant(0, false);
    g.hud.setBomb(false);
    if (tWin) this.scoreT++; else this.scoreCT++;
    this._applyEconomy(tWin);
    g.hud.setScore(this.scoreT, this.scoreCT);
    g.hud.setPhase('回合结束');
    g.hud.showRoundEnd(playerWin, reason);
    audio.play(playerWin ? 'win' : 'lose', { volume: 0.8 });
    g.endRound(playerWin, reason);

    this._checkMatchEnd(reason);
  }

  /** 经济：胜方固定奖励，败方按连败次数递增；赢一局立刻重置自己的连败计数。 */
  _applyEconomy(tWin) {
    if (tWin) {
      this.lossStreak.t = 0;
      this.lossStreak.ct = Math.min(LOSS_BONUS_MAX, this.lossStreak.ct + 1);
    } else {
      this.lossStreak.ct = 0;
      this.lossStreak.t = Math.min(LOSS_BONUS_MAX, this.lossStreak.t + 1);
    }
    const myWin = this.playerSide === 't' ? tWin : !tWin;
    if (myWin) {
      this.game.addMoney(ECONOMY.win);
    } else {
      const streak = this.playerSide === 't' ? this.lossStreak.t : this.lossStreak.ct;
      this.game.addMoney(this._lossBonus(streak));
    }
  }

  /** 连败补偿曲线：1400 / 1900 / 2400 / 2900 / 3400（封顶）。 */
  _lossBonus(streak) {
    const n = Math.max(1, Math.min(LOSS_BONUS_MAX, streak));
    return ECONOMY.loss + LOSS_BONUS_STEP * (n - 1);
  }

  _checkMatchEnd(reason) {
    const winScore = this.mode.winScore || 13;

    if (this.overtime === 0) {
      if (this.scoreT >= winScore || this.scoreCT >= winScore) {
        this._finishMatch(this.scoreT > this.scoreCT, reason);
        return;
      }
      // 常规赛打满（MR12 的 12:12）进入加时
      if (this.scoreT === winScore - 1 && this.scoreCT === winScore - 1) {
        this._enterOvertime();
      }
      return;
    }

    const dt = this.scoreT - this.otBase.t;
    const dct = this.scoreCT - this.otBase.ct;
    if (dt >= OVERTIME.winScore || dct >= OVERTIME.winScore) {
      this._finishMatch(dt > dct, reason);
      return;
    }
    if (dt === OVERTIME.winScore - 1 && dct === OVERTIME.winScore - 1) {
      if (this.overtime >= OVERTIME.maxOvertimes) {
        this.draw = true;
        this._finishMatch(null, '三个加时后仍未分胜负');
      } else {
        this._enterOvertime();
      }
    }
  }

  _finishMatch(tWin, reason) {
    const g = this.game;
    this.matchOver = true;
    this.endTimer = 1.2;
    if (tWin === null) {
      this.draw = true;
      // 结算面板只认布尔值；平局用 reason 说明，胜负标记按「未获胜」处理
      g.onMatchEnd(false, reason || '双方战平');
      return;
    }
    const playerWin = this.playerSide === 't' ? tWin : !tWin;
    g.onMatchEnd(playerWin, reason || (playerWin ? '目标达成' : '目标失守'));
  }

  _enterOvertime() {
    const g = this.game;
    this.overtime++;
    this.otBase = { t: this.scoreT, ct: this.scoreCT };
    this.otPending = true;
    this.endTimer = 3;
    g.hud.setPhase(`加时赛 ${this.overtime}`);
    g.hud.setObjective(`加时赛 ${this.overtime} · 先到 ${OVERTIME.winScore} 分`);
  }

  /** 加时赛起始资金：双方拉平，不继承常规赛经济。Bot 钱包由 T-009 接管。 */
  _grantOvertimeMoney() {
    const g = this.game;
    g.money = Math.min(ECONOMY.cap, OVERTIME.startMoney);
    g.hud.setMoney(g.money);
  }
}
