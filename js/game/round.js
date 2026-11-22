// 回合状态机：购买 → 进行 → 安放 → 结束。
// 胜负：清光敌人 / 炸弹引爆 = T 胜；拆包 / 时间耗尽 / T 全灭 = CT 胜。
// 已实现：Bot 拆包、加时赛（MR4 × 3）、连败补偿曲线。
// TODO(round): 半场交换（等 T-008 钩子）、包点封锁。

import * as THREE from '../../vendor/three.module.js';
import { audio } from '../core/audio.js';
import { ECONOMY, WEAPONS, BUY_ITEMS } from '../config/weapons.js';
import { MODE_MAP } from '../config/modes.js';

export const PHASE = { FREEZE: 'freeze', LIVE: 'live', PLANTED: 'planted', ENDED: 'ended' };

// 加时赛：每个加时半场先到 4 分；最多 3 个加时，仍未分胜负则战平。
// 加时统一发 10000，不继承常规赛经济，避免一方带着经济优势滚雪球。
export const OVERTIME = { winScore: 4, maxOvertimes: 3, startMoney: 10000 };

// 连败补偿：1400 / 1900 / 2400 / 2900 / 3400，第 5 连败起封顶。
export const LOSS_BONUS_STEP = 500;
export const LOSS_BONUS_MAX = 5;

// 拆包奖励：ECONOMY 里没有该项，按 CS 惯例固定 300。
const DEFUSE_REWARD = 300;

// T-009 阶段 2：Bot 购买。价格只读 config，不在回合层硬编码数值。
const AK_PRICE = (WEAPONS.ak && WEAPONS.ak.price) || 2700;
const ARMOR_ITEM = BUY_ITEMS.find((i) => i.id === 'armor');
const ARMOR_PRICE = ARMOR_ITEM ? ARMOR_ITEM.price : 650;
// 低于这条线只存钱，不买甲：保证 eco 局能攒到下回合起长枪
const BUY_SAVE_LINE = 2000;

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
    // T-009：Bot 经济日志与击杀计数快照（每帧对比增量发钱，不改 game.js）
    this.economyLog = [];
    this._killSnapshot = new Map();
    // 3b：半场交换。换边动作推迟到下一回合 start()，避免在结算里重建 Bot
    this._swapPending = false;
    this._otRoundCount = 0;
    this.swapCount = 0;
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
    this._swapPending = false;
    this._otRoundCount = 0;
    this.swapCount = 0;
    this.resetBotEconomy();
    this.start();
  }

  /** 比赛开始 / 半场交换时重置 Bot 经济：全部按模式起始资金，清空日志。 */
  resetBotEconomy() {
    const money = this.mode.startMoney || ECONOMY.start;
    this._killSnapshot.clear();
    for (const b of (this.game.bots || [])) {
      b.money = Math.min(ECONOMY.cap, money);
      // 比赛开始 / 半场换边：装备清零，从手枪局重新开始
      b.weaponId = 'glock';
      b.armor = 0;
      this._killSnapshot.set(b, b.kills || 0);
    }
    this.economyLog = [];
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

    // 3b：换边必须在重置玩家/Bot 之前，否则用的是旧阵营出生点
    if (this._swapPending) {
      this._swapPending = false;
      this._swapSides();
    }

    // 加时赛开局统一发钱（必须在 onRoundStart 之前，购买界面会读 money）
    if (this.otPending) {
      this.otPending = false;
      this._grantOvertimeMoney();
    }

    g.roundEnding = false;
    g.player.respawnPoint = this.playerSide === 'ct'
      ? (g.map.spawns.playerCT || g.map.spawns.player)
      : g.map.spawns.player;
    g.player.reset(g.player.respawnPoint);
    g.bots.forEach((b) => b.reset());
    this._botBuyPhase();
    g.hud.setPhase(this.overtime > 0
      ? `加时赛 ${this.overtime}`
      : (this.swapCount > 0 ? '下半场 · 购买时间' : '购买时间'));
    g.hud.setObjective(this.overtime > 0
      ? `加时赛 ${this.overtime} · 先到 ${OVERTIME.winScore} 分`
      : ('购买装备，准备' + (this.playerSide === 'ct' ? '防守 ' : '进攻 ') + this.siteLabel()));
    g.hud.setBomb(false);
    g.hud.setRound(this.round);
    g.hud.setScore(this.scoreT, this.scoreCT);
    g.onRoundStart();
    audio.play('beep', { volume: 0.3 });
  }

  update(dt) {
    const g = this.game;
    const player = g.player;

    // T-009：击杀结算。Bot 的 kills 由 game.js 维护，这里只对比增量，
    // 避免为了加钱去改 game.js 的 _onBotShoot。
    this._syncBotKillRewards();

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
        g.hud.setObjective('在 ' + this.siteLabel() + ' 点安放炸弹');
      }
      return;
    }

    if (this.phase === PHASE.LIVE) {
      this.timer -= dt;
      this._assignBotObjectives(PHASE.LIVE);
      this._plantLogic(dt);
      if (this.phase !== PHASE.LIVE) return;
      const playerOnT = (g.playerSide || this.playerSide) === 't';
      const tBots = g.tBots || g.allyBots;
      const ctBots = g.ctBots || g.enemyBots;
      const tAlive = (playerOnT && player.alive ? 1 : 0) + tBots.filter((b) => b.alive).length;
      const ctAlive = (!playerOnT && player.alive ? 1 : 0) + ctBots.filter((b) => b.alive).length;
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
    let actor = null;

    // 玩家优先：站在包点按住使用键（只有 T 方能下包，换边后玩家是 CT）
    if (p.alive && (g.playerSide || this.playerSide) === 't') {
      const s = this.siteAt(p.position.x, p.position.z);
      if (s && g.input.isDown('use')) { site = s; pos = p.position; actor = p; }
    }
    // 玩家没接手，就看被指派的 Bot 是否到位站定（交战状态下不准下包）
    if (!site) {
      const b = this._planter;
      if (b && b.alive && b.holding && !b.engage) {
        const s = this.siteAt(b.pos.x, b.pos.z);
        if (s) { site = s; pos = b.pos; actor = b; }
      }
    }

    if (site) {
      this.plantProgress += dt / 3.2;
      g.hud.setPlant(Math.min(1, this.plantProgress), true);
      if (this.plantProgress >= 1) {
        this.plantProgress = 0;
        this.plant(site, pos, actor);
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
  /**
   * 阶段 3：按角色生成进攻站位。
   * entry 直接压点，anchor 拖后 7 m 当第二梯队，rotator 走侧面 5 m 补枪线。
   * 偏移以「Bot → 包点」方向为基准，换包点/换边都不用改配置。
   */
  _objectiveFor(bot, x, z, role, type) {
    const ang = Math.atan2(z - bot.pos.z, x - bot.pos.x);
    const back = role === 'anchor' ? 7 : 0;
    const side = role === 'rotator' ? 5 : 0;
    return {
      type,
      x: x - Math.cos(ang) * back + Math.cos(ang + Math.PI / 2) * side,
      z: z - Math.sin(ang) * back + Math.sin(ang + Math.PI / 2) * side
    };
  }

  _assignBotObjectives(phase) {
    const g = this.game;
    // 用 tBots/ctBots：换边后 allyBots 变成 CT，继续用玩家视角会指派错方向
    const tBots = g.tBots || g.allyBots;
    const ctBots = g.ctBots || g.enemyBots;
    if (phase === PHASE.LIVE) {
      const keys = this.siteKeys();
      // 地图没给包点就没法下包：直接不指派，避免 undefined.x 崩掉整局
      if (!keys.length) return;
      if (!this._plantSite || keys.indexOf(this._plantSite) < 0) {
        this._plantSite = keys[Math.floor(Math.random() * keys.length)];
      }
      const s = g.map.sites[this._plantSite];
      let best = null;
      let bestD = 1e9;
      for (const b of tBots) {
        if (!b.alive) continue;
        const d = Math.hypot(b.pos.x - s.x, b.pos.z - s.z);
        if (d < bestD) { bestD = d; best = b; }
      }
      this._planter = best;
      // T 全队 execute：一个人下包，其余按角色压点 / 拖后 / 走侧翼
      for (const b of tBots) {
        if (!b.alive) continue;
        if (b === best) {
          const cur = b.objective;
          // 目标点跟着当前包点走：换点（或上一个目标还是旧包点）必须重新下发，
          // 否则多包点地图上会出现「计划换 B，人还在往 A 跑」。
          if (!cur || cur.type !== 'plant' || cur.x !== s.x || cur.z !== s.z) {
            // 带上包点半径：包点中心常是 0.58 m 高台（Bot 上不去），
            // 只要站进 site.r 就算到位，按真实规则「包点内任意位置可下包」。
            b.objective = { type: 'plant', x: s.x, z: s.z, r: s.r };
          }
        } else if (!b.objective || b.objective.type !== 'push') {
          b.objective = this._objectiveFor(b, s.x, s.z, b.role, 'push');
        }
      }
      // CT 防守：anchor 守包点。主守包点在首位，其余包点轮转，
      // 所以 2 个点时的行为与旧版（A/B 交替）完全一致，3 个点也能覆盖到。
      const guards = ctBots.filter((b) => b.alive && b.role === 'anchor');
      const patrol = [this._plantSite].concat(keys.filter((k) => k !== this._plantSite));
      guards.forEach((b, i) => {
        const key = patrol[i % patrol.length];
        const gs = g.map.sites[key];
        const cur = b.objective;
        if (!cur || cur.type !== 'guard' || cur.x !== gs.x || cur.z !== gs.z) {
          b.objective = { type: 'guard', x: gs.x, z: gs.z };
        }
      });
      for (const b of ctBots) {
        if (b.objective && b.objective.type === 'defuse') b.objective = null;
      }
      return;
    }

    if (phase === PHASE.PLANTED && this.bomb) {
      let best = null;
      let bestD = 1e9;
      for (const b of ctBots) {
        if (!b.alive) continue;
        const d = Math.hypot(b.pos.x - this.bomb.x, b.pos.z - this.bomb.z);
        if (d < bestD) { bestD = d; best = b; }
      }
      this._defuser = best;
      // CT 全员回防：一个人拆包，其余围绕炸弹 4~7 m 散开清场
      for (let i = 0; i < ctBots.length; i++) {
        const b = ctBots[i];
        if (!b.alive) continue;
        if (b === best) {
          if (!b.objective || b.objective.type !== 'defuse') {
            b.objective = { type: 'defuse', x: this.bomb.x, z: this.bomb.z };
          }
          continue;
        }
        if (!b.objective || b.objective.type !== 'retake') {
          const ang = (i / Math.max(1, ctBots.length)) * Math.PI * 2;
          const r = 4 + (i % 3) * 1.5;
          b.objective = {
            type: 'retake',
            x: this.bomb.x + Math.cos(ang) * r,
            z: this.bomb.z + Math.sin(ang) * r
          };
        }
      }
      // T 守包：围绕炸弹 5~8 m 散开，不再原地站桩
      for (let i = 0; i < tBots.length; i++) {
        const b = tBots[i];
        if (!b.alive) continue;
        if (!b.objective || b.objective.type !== 'guard') {
          const ang = (i / Math.max(1, tBots.length)) * Math.PI * 2;
          const r = 5 + (i % 3) * 1.5;
          b.objective = {
            type: 'guard',
            x: this.bomb.x + Math.cos(ang) * r,
            z: this.bomb.z + Math.sin(ang) * r
          };
        }
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
        if (b) this._addBotMoney(b, DEFUSE_REWARD, 'defuse');
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

  /**
   * 地图契约：包点集合完全由 map.sites 的键决定。
   * 回合层不假定「两个点」「键名叫 A/B」——第二张地图可以给 1~N 个点、任意键名。
   */
  siteKeys() {
    const sites = (this.game.map && this.game.map.sites) || {};
    return Object.keys(sites);
  }

  /** HUD 用包点标签；地图没提供 sites 时退回通用文案。 */
  siteLabel() {
    const keys = this.siteKeys();
    // 只有「地图完全没给 sites」这种非法地图才会用到兜底文案
    return keys.length ? keys.join(' / ') : 'A / B';
  }

  siteAt(x, z) {
    const s = this.game.map.sites;
    for (const k of Object.keys(s)) {
      const d = Math.hypot(x - s[k].x, z - s[k].z);
      if (d < s[k].r) return k;
    }
    return null;
  }

  plant(site, pos, actor) {
    const g = this.game;
    this.phase = PHASE.PLANTED;
    this.timer = this.mode.bombTime || 40;
    this.plantProgress = 0;
    g.hud.setPlant(0, false);
    g.hud.setPhase('炸弹已安放');
    g.hud.setObjective('守住炸弹直到引爆');
    g.hud.setBomb(true);
    g.hud.setBombTimer(this.timer);
    // 下包奖励给实际下包的人：玩家走原路径，Bot 走独立钱包
    if (actor && actor !== g.player) this._addBotMoney(actor, ECONOMY.plant, 'plant');
    else g.addMoney(ECONOMY.plant);
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

    // 3b：先记本局是否打满半场，再判比赛结束（12:12 会进加时，仍要换边）
    if (this.overtime > 0) this._otRoundCount++;
    const willSwap = this._shouldSwapSides();
    this._checkMatchEnd(reason);
    if (!this.matchOver && willSwap) this._swapPending = true;
  }

  /** 常规赛第 12 局（MR12 半场）、加时每 3 局交换阵营。 */
  _shouldSwapSides() {
    if (this.overtime === 0) {
      return this.round === ((this.mode.winScore || 13) - 1);
    }
    return this._otRoundCount === 3;
  }

  /**
   * 3b：半场交换。阵营重建交给 game.setPlayerSide（T-008 钩子），
   * 回合层只负责时机、经济重置与提示。比分不重置，玩家视角由 playerSide 折算。
   */
  _swapSides() {
    const g = this.game;
    const next = this.playerSide === 't' ? 'ct' : 't';
    if (typeof g.setPlayerSide === 'function') {
      g.setPlayerSide(next, true);   // force：同一阵营时也要强制重建
    }
    this.playerSide = next;
    this.swapCount++;
    // 半场经济：双方回到起始资金（Bot 走统一入口）
    this.resetBotEconomy();
    g.money = Math.min(ECONOMY.cap, this.mode.startMoney || ECONOMY.start);
    if (g.hud && g.hud.setMoney) g.hud.setMoney(g.money);
    if (g.hud && g.hud.setObjective) {
      g.hud.setObjective('下半场：' + (next === 'ct' ? '防守 ' : '进攻 ') + this.siteLabel());
    }
    audio.play('beep', { volume: 0.5 });
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
    // Bot 队伍经济：与玩家同规则，按各自阵营的连败计数结算
    for (const b of (this.game.bots || [])) {
      const botWin = b.team === 't' ? tWin : !tWin;
      if (botWin) this._addBotMoney(b, ECONOMY.win, 'round-win');
      else this._addBotMoney(b, this._lossBonus(this.lossStreak[b.team]), 'round-loss');
    }
  }

  /**
   * T-009 阶段 2：冻结时间的 Bot 购买。
   * 规则刻意简单、可核对：
   * - 钱 < 2000 且没有长枪：eco 存钱，继续用手枪
   * - 钱够 AK：买 AK
   * - 还有余钱且没甲：补甲
   * 钱不够不会硬买，_addBotMoney 也不会让余额变成负数。
   */
  _botBuyPhase() {
    const g = this.game;
    for (const b of (g.bots || [])) {
      if (!b.alive) continue;
      let money = b.money || 0;
      if (b.weaponId !== 'ak') {
        if (money < BUY_SAVE_LINE) continue;      // eco：存钱
        if (money >= AK_PRICE) {
          this._addBotMoney(b, -AK_PRICE, 'buy-ak');
          b.weaponId = 'ak';
          money = b.money;
        }
      }
      if (b.armor <= 0 && money >= ARMOR_PRICE) {
        this._addBotMoney(b, -ARMOR_PRICE, 'buy-armor');
        b.armor = 100;
      }
    }
  }

  /** 击杀奖励：对比 Bot.kills 的增量，谁涨了给谁加钱（含 Bot 击杀玩家）。 */
  _syncBotKillRewards() {
    for (const b of (this.game.bots || [])) {
      // 换边会重建 Bot 对象：新对象先建基线，避免把历史击杀一次性折现
      if (!this._killSnapshot.has(b)) {
        this._killSnapshot.set(b, b.kills || 0);
        continue;
      }
      const prev = this._killSnapshot.get(b);
      const now = b.kills || 0;
      if (now > prev) {
        this._addBotMoney(b, (now - prev) * ECONOMY.kill, 'kill');
        this._killSnapshot.set(b, now);
      } else if (now < prev) {
        this._killSnapshot.set(b, now);   // 被外部重置，跟随即可
      }
    }
  }

  /** Bot 加钱：ECONOMY.cap 封顶，负值不会出现，实际入账记一条日志。 */
  _addBotMoney(bot, amount, reason) {
    if (!amount) return 0;
    const before = bot.money || 0;
    bot.money = Math.max(0, Math.min(ECONOMY.cap, before + amount));
    const delta = bot.money - before;
    if (delta !== 0) {
      this.economyLog.push({
        round: this.round, bot: bot.label, team: bot.team,
        delta, money: bot.money, reason
      });
      if (this.economyLog.length > 120) this.economyLog.shift();
    }
    return delta;
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
    this._otRoundCount = 0;
    this.endTimer = 3;
    g.hud.setPhase(`加时赛 ${this.overtime}`);
    g.hud.setObjective(`加时赛 ${this.overtime} · 先到 ${OVERTIME.winScore} 分`);
  }

  /** 加时赛起始资金：双方拉平，不继承常规赛经济。Bot 钱包由 T-009 接管。 */
  _grantOvertimeMoney() {
    const g = this.game;
    g.money = Math.min(ECONOMY.cap, OVERTIME.startMoney);
    g.hud.setMoney(g.money);
    // T-009：Bot 同步发加时钱，避免换边后还带着常规赛经济
    for (const b of (g.bots || [])) b.money = Math.min(ECONOMY.cap, OVERTIME.startMoney);
  }
}
