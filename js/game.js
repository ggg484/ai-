// 游戏编排：大厅 ↔ 对局。固定 64Hz 模拟 + 渲染插值。
// 大厅与对局共用同一个 renderer/camera/input，切场景只切可见性与碰撞世界。

import * as THREE from '../../vendor/three.module.js';
import { Engine } from './render/engine.js';
import { mapById } from './world/maps.js';
import { loadStoredEdits } from './world/map-edits.js';
import { loadPhotoTextures } from './world/textures.js';
import { refreshWeaponTextures } from './render/weapon-models.js';
import { loadAvatarModel } from './render/avatar-glb.js';
import { buildLobby } from './world/lobby.js';
import { Player } from './player/controller.js';
import { Weapon } from './player/weapon.js';
import { Viewmodel } from './render/viewmodel.js';
import { PhotoMode } from './render/photo.js';
import { Bot } from './game/bots.js';
import { Round, PHASE } from './game/round.js';
import { GrenadeSystem } from './game/grenade.js';
import { Hud } from './ui/hud.js';
import { LobbyUI } from './ui/lobby-ui.js';
import { Input } from './core/input.js';
import { audio } from './core/audio.js';
import * as Builda from './platform/builda.js';
import { WEAPONS, ECONOMY, UTILITY, UTILITY_ORDER } from './config/weapons.js';
import { GAME_MODES, MODE_MAP } from './config/modes.js';
import { defaultProfile, TIERS, tierById, LOBBY_FEED, LEADERBOARD } from './config/lobby.js';
import { SKIN_MAP, defaultVariant, entryId, entryVariant } from './config/skins.js';
import { RangeSystem } from './lobby/range.js';

const STEP = 1 / 64;

function impactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(20,16,12,.95)');
  g.addColorStop(0.45, 'rgba(28,22,16,.7)');
  g.addColorStop(1, 'rgba(28,22,16,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    console.info('[boot] engine');
    this.engine = new Engine(canvas);
    this.scene = this.engine.scene;
    this.hud = new Hud();
    this.input = new Input(canvas);
    this.player = new Player({ x: 0, y: 0, z: 0, yaw: 0 });
    this.viewmodel = new Viewmodel(this.engine.camera, window.__weaponRig);
    this.photo = new PhotoMode(this.engine, { onClose: () => this.closePhoto() });
    this.photoActive = false;
    const photoM = /[?&]photo=([a-z0-9_]+)/.exec(location.search);
    this._photoParam = photoM ? photoM[1] : null;
    const skinM = /[?&]skin=([a-z0-9_]+)/.exec(location.search);
    this._photoSkin = skinM ? skinM[1] : null;
    const wearM = /[?&]wear=([0-9.]+)/.exec(location.search);
    const seedM = /[?&]seed=(\d+)/.exec(location.search);
    const offM = /[?&]offset=([0-9.]+)/.exec(location.search);
    this._photoVariant = (wearM || seedM || offM) ? {
      wear: wearM ? parseFloat(wearM[1]) : 0.1,
      seed: seedM ? parseInt(seedM[1], 10) : 508,
      offset: offM ? parseFloat(offM[1]) : 0.5
    } : null;

    // 对局场景
    this.matchRoot = new THREE.Group();
    this.matchRoot.name = 'match';
    this.scene.add(this.matchRoot);
    // 正常对局读取随包发布的 assets/map-edits.json（启动时由 main.js 预取）；
    // ?mapEdits=1 时使用地图工坊的本机预览数据。
    const mapEdits = /[?&]mapEdits=1/.test(location.search)
      ? loadStoredEdits()
      : (window.__mapEdits || null);
    const mapParam = (/[?&]map=([a-z0-9_-]+)/.exec(location.search) || [])[1];
    const mapDef = mapById(mapParam);
    this.mapId = mapDef.id;
    this.mapName = mapDef.name;
    this.mapNameEn = mapDef.nameEn;
    this.hud.setMapName(this.mapNameEn || this.mapName);
    this.map = mapDef.build(this.matchRoot, {
      edits: mapDef.id === 'sandline' ? mapEdits : null
    });
    // 5v5：5 名 CT 敌人 + 4 名 T 队友（玩家是 T 方第 5 人）
    this.enemyBots = this.map.spawns.bots.map((s) => new Bot(this.matchRoot, s, this.map.world, {
      team: 'ct', rig: window.__charRig
    }));
    this.allyBots = this.map.spawns.allies.map((s) => new Bot(this.matchRoot, s, this.map.world, {
      team: 't', rig: window.__charRig
    }));
    this.bots = this.enemyBots.concat(this.allyBots);
    this.playerSide = 't';
    this.tBots = this.allyBots;
    this.ctBots = this.enemyBots;
    this.round = new Round(this);

    // 大厅
    console.info('[boot] lobby start');
    this.lobby = buildLobby(this.scene);
    console.info('[boot] lobby done');
    // 大厅不放任何占位 NPC：没有真人时就是空场，绝不用假人冒充在线。
    // 保留同名字段/方法，供 HUD 统计与自适应逻辑安全空转。
    this.crowd = {
      n: 0, total: 0, farCount: 0, detailLimit: 0,
      setVisible() {}, setQuality() {}, setDetailLimit() {}, setFarCount() {}, update() {}
    };
    console.info('[boot] lobby is NPC-free');
    this.range = new RangeSystem(this.lobby);

    this.settings = Builda.defaultSettings();
    this.profile = defaultProfile('玩家');
    this.mode = 'lobby';
    this.world = this.lobby.world;
    this.lobbyWeaponId = 'ak';
    this.panelOpen = false;
    this.rangeActive = false;
    this.paused = false;
    this.platformPaused = false;
    this.settingsOpen = false;
    this.buyOpen = false;
    this.roundEnding = false;
    this.matchOver = false;
    this.matchId = 0;
    this.playerKills = 0;
    this.playerDeaths = 0;
    this.shake = 0;
    this.debugTop = /[?&]cam=top/.test(location.search);
    this.stats = /[?&]stats=1/.test(location.search);
    this.autostart = /[?&]autostart=1/.test(location.search);

    this.money = ECONOMY.start;
    this.utility = { he: 1, flash: 1, smoke: 1, molotov: 1 };
    this.selectedUtility = 'he';
    this.throwCd = 0;
    this.blindT = 0;
    this.grenades = new GrenadeSystem(this);
    this.weaponCache = { glock: new Weapon('glock') };
    this.owned = { glock: true, ak: false };
    this.currentWeaponId = 'glock';
    this.weapon = this.weaponCache.glock;
    this.modeCfg = MODE_MAP.classic;

    this._acc = 0;
    this._last = performance.now();
    this._hudT = 0;
    this._fpsT = 0;
    this._fpsN = 0;
    this._fps = 60;
    this._perfEl = null;
    this._showPerf = /[?&]perf=1/.test(location.search);
    this._noAdapt = /[?&]noadapt=1/.test(location.search);
    this._perfAge = 0;
    this._lowStreak = 0;
    this._highStreak = 0;
    this._saveT = null;
    this._feedT = 3;
    this._screenT = 0;
    this._portalCd = 0;
    this._padCd = 0;
    this._interactTarget = null;
    this._interactHero = null;
    this._rangeFireCd = 0;
    this._challengeWasActive = false;
    this._lobbyTime = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();

    this._initEffects();
    this._bindUI();
    this._bindPlatform();
    this.hud.setScore(0, 0);
    this.hud.setRound(1);
    this.hud.setMoney(this.money);
    this.hud.setVitals(100, 0);
    this.hud.applySettings(this.settings);
    this._loop = this._loop.bind(this);
  }

  async init() {
    this.settings = await Builda.loadSettings();
    if (!/[?&]quality=/.test(location.search)) this.settings.quality = this.engine.quality;
    this.applySettings(this.settings, false);
    // CC0 扫描材质：加载失败自动保留程序化贴图，不阻塞启动。
    await loadPhotoTextures();
    refreshWeaponTextures();

    // 对局角色换成扩展包里的骨骼模型；失败时 Bot 继续用程序化方块人。
    const glbOk = await loadAvatarModel();
    if (glbOk) {
      let n = 0;
      for (const b of this.bots) if (b.setAvatar()) n++;
      console.info('[boot] GLB 角色接入 ' + n + '/' + this.bots.length);
    }

    const me = await Builda.whoami();
    this.playerName = me && me.name ? me.name : '玩家';
    this.profile = defaultProfile(this.playerName);
    const tm = /[?&]tier=(\d+)/.exec(location.search);
    if (tm) this.profile.tier = Math.max(0, Math.min(3, parseInt(tm[1], 10)));
    this._applyProfileSkins();

    this.lobbyUi = new LobbyUI({
      onMode: (id) => this.selectMode(id),
      onActivity: (a) => this.handleActivity(a),
      onEquip: (weapon, skin, variant) => this.equipSkin(weapon, skin, variant),
      onTeleport: (id) => this.teleportLobby(id),
      onInspect: (weapon, skin, variant) => this.openPhoto('weapon', weapon, skin, variant),
      onPanelChange: (open) => this._onPanelChange(open),
      onChallenge: () => this.startRangeChallenge(),
      onSettings: () => this.openSettings(),
      onReturnLobby: () => { this.lobbyUi.hideMatchEnd(); this.enterLobby(); },
      onRematch: () => { this.lobbyUi.hideMatchEnd(); this.startMatch(this.lastModeId || 'classic'); }
    });
    this.lobbyUi.setProfile(this.profile);
    this.lobbyUi.setOnline(1);
    this._perfEl = document.getElementById('perf');
    if (this._perfEl && this._showPerf) this._perfEl.classList.add('on');

    Builda.applySafeArea();
    window.addEventListener('resize', () => { this.engine.resize(); this.photo.resize(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this._onEscape();
      if (e.code === 'F3') {
        e.preventDefault();
        this._showPerf = !this._showPerf;
        if (this._perfEl) this._perfEl.classList.toggle('on', this._showPerf);
      }
    });
    requestAnimationFrame(this._loop);

    this.lobbyUi.showBoot(true);
    if (this._photoParam) {
      this.enterLobby();
      this.openPhotoById(this._photoParam, this._photoSkin, this._photoVariant);
      this.lobbyUi.showBoot(false);
    } else if (this.autostart) {
      this.startMatch('classic');
      this.lobbyUi.showBoot(false);
    } else {
      this.enterLobby();
      setTimeout(() => this.lobbyUi.showBoot(false), 260);
    }
  }

  _bindPlatform() {
    Builda.onPauseChange((paused) => {
      this.platformPaused = paused;
      this._updatePauseState();
    });
  }

  _bindUI() {
    const btnResume = document.getElementById('btn-resume');
    if (btnResume) btnResume.addEventListener('click', () => {
      this.platformPaused = false;
      this.settingsOpen = false;
      this.hud.showSettings(false);
      this._updatePauseState();
    });

    if (this.hud.el.btnSettings) {
      this.hud.el.btnSettings.addEventListener('click', () => this.openSettings());
    }

    const exitMatch = document.getElementById('btn-exit-match');
    if (exitMatch) exitMatch.addEventListener('click', () => {
      this.closeSettings();
      this.enterLobby();
    });

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-close');
        if (id === 'buy') this.closeBuy();
        if (id === 'settings') this.closeSettings();
      });
    });

    this.hud.onBuy = (item) => this.buy(item);
    this.hud.onUtility = (type) => this.selectUtility(type);
    this.hud.onSettings = (s) => {
      this.settings.sensitivity = s.sensitivity;
      this.settings.fov = s.fov;
      this.settings.quality = s.quality;
      this.applySettings(this.settings, true);
    };
  }

  _onEscape() {
    if (this.lobbyUi && this.lobbyUi.isOpen()) {
      this.lobbyUi.closePanels();
      return;
    }
    if (this.settingsOpen) this.closeSettings();
  }

  _applyProfileSkins() {
    if (!this.profile) return;
    Object.keys(this.profile.equipped).forEach((w) => {
      const entry = this.profile.equipped[w];
      const skin = SKIN_MAP[entryId(entry)];
      if (skin) this.viewmodel.setSkin(w, skin, entryVariant(entry, skin));
    });
  }

  applySettings(s, save) {
    if (!s) return;
    this.settings = s;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = !!s.invertY;
    this.engine.setQuality(s.quality);
    this.viewmodel.setQuality(s.quality);
    if (this.crowd) this.crowd.setQuality(s.quality);
    if (save) {
      clearTimeout(this._saveT);
      this._saveT = setTimeout(() => { Builda.saveSettings(this.settings); }, 350);
    }
  }

  /* ---------------- 场景切换 ---------------- */

  enterLobby() {
    this.mode = 'lobby';
    this.started = true;
    this.matchOver = false;
    this.roundEnding = false;
    this.buyOpen = false;
    this.grenades.clear();
    this.blindT = 0;
    this.hud.showBuy(false);
    this.hud.hideRoundEnd();
    this.round.removeBomb();
    this.round.phase = PHASE.FREEZE;

    this.matchRoot.visible = false;
    this.lobby.root.visible = true;
    this.crowd.setVisible(true);
    this.world = this.lobby.world;
    this.player.respawnPoint = this.lobby.spawn;
    this.player.reset(this.lobby.spawn);
    this.player.hp = 100;
    this.player.armor = 0;

    this.engine.setMood('lobby');
    this.hud.showHud(false);
    this.hud.showPause(false);
    this.lobbyUi.show(true);
    this.lobbyUi.hideMatchEnd();
    this.lobbyUi.setProfile(this.profile);
    this.lobbyUi.setOnline(1);
    this._perfEl = document.getElementById('perf');
    if (this._perfEl && this._showPerf) this._perfEl.classList.add('on');
    this.lobbyUi.setInteract(null);
    this.lobbyWeaponId = this.lobbyWeaponId || 'ak';
    if (!this.weaponCache[this.lobbyWeaponId]) this.weaponCache[this.lobbyWeaponId] = new Weapon(this.lobbyWeaponId);
    this.setWeapon(this.lobbyWeaponId);
    this.viewmodel.root.visible = true;
    this._applyProfileSkins();

    this.rangeActive = false;
    this._challengeWasActive = false;
    this._fireHintT = null;
    this.input.setEnabled(true);
    this.input.exitLock();
    Builda.keepScreenOn(true);
    this._setTouchMode('lobby');
    this._feedT = 1.2;
    this._screenT = 0;
    this._drawLobbyScreen();
    document.body.classList.remove('in-match');
    document.body.classList.add('in-lobby');
  }

  _makeBots(team, spawns) {
    return spawns.map((s) => new Bot(this.matchRoot, s, this.map.world, {
      team, rig: window.__charRig
    }));
  }

  /**
   * 半场交换钩子：只负责阵营、出生点、Bot 重建与 HUD，不碰回合计分规则。
   * round.js 在 3b 里先调 setPlayerSide(side)，再 reset 玩家/Bot。
   */
  setPlayerSide(side, force) {
    side = side === 'ct' ? 'ct' : 't';
    if (!force && side === this.playerSide) return;

    const tStats = (this.tBots || []).map((b) => ({ k: b.kills, d: b.deaths }));
    const ctStats = (this.ctBots || []).map((b) => ({ k: b.kills, d: b.deaths }));
    for (const b of this.bots || []) this.matchRoot.remove(b.group);

    if (side === 't') {
      this.allyBots = this._makeBots('t', this.map.spawns.allies);
      this.enemyBots = this._makeBots('ct', this.map.spawns.bots);
      this.tBots = this.allyBots;
      this.ctBots = this.enemyBots;
    } else {
      this.allyBots = this._makeBots('ct', this.map.spawns.ctAllies);
      this.enemyBots = this._makeBots('t', this.map.spawns.tBots);
      this.ctBots = this.allyBots;
      this.tBots = this.enemyBots;
    }
    this.bots = this.enemyBots.concat(this.allyBots);
    this.tBots.forEach((b, i) => {
      const s = tStats[i];
      if (s) { b.kills = s.k; b.deaths = s.d; }
    });
    this.ctBots.forEach((b, i) => {
      const s = ctStats[i];
      if (s) { b.kills = s.k; b.deaths = s.d; }
    });

    this.playerSide = side;
    this.player.respawnPoint = side === 't' ? this.map.spawns.player : this.map.spawns.playerCT;
    if (this.round) this.round.playerSide = side;
    this.hud.setPlayerSide(side);
    if (this.mode === 'match' && this.round && this.round.phase === PHASE.FREEZE) {
      this.hud.setObjective(side === 'ct' ? '购买装备，准备防守 A / B' : '购买装备，准备进攻 A / B');
    }
  }

  isPlayerTeam(unit) {
    return unit === this.player || this.allyBots.includes(unit);
  }

  startMatch(modeId) {
    const mode = MODE_MAP[modeId] || MODE_MAP.classic;
    this.modeCfg = mode;
    this.lastModeId = mode.id;
    this.mode = 'match';
    this.started = true;
    this.roundEnding = false;
    this.matchOver = false;
    this.paused = false;
    this.panelOpen = false;
    this.setPlayerSide('t');
    this.money = mode.startMoney || ECONOMY.start;
    this.utility = { he: 1, flash: 1, smoke: 1, molotov: 1 };
    this.selectedUtility = 'he';
    this.throwCd = 0;
    this.blindT = 0;
    this.grenades.clear();
    this.owned = { glock: true, ak: false };
    this.currentWeaponId = 'glock';
    this.weapon = this.weaponCache.glock;
    this.weapon.refill();
    this.playerKills = 0;
    this.playerDeaths = 0;
    this.bots.forEach((b) => { b.kills = 0; b.deaths = 0; });

    this.lobbyUi.closePanels();
    this.lobbyUi.show(false);
    this.lobbyUi.hideMatchEnd();
    this.lobby.root.visible = false;
    this.crowd.setVisible(false);
    this.matchRoot.visible = true;
    this.world = this.map.world;
    const mood = this.mapId === 'oasis' ? 'oasis' : this.mapId === 'harbor' ? 'harbor' : 'match';
    this.engine.setMood(mood);
    // 对局使用随包/工坊预览的光照；回大厅时 setMood('lobby') 会恢复大厅光照。
    // 港口例外：随包 lighting.json 是沙城日落，套上去会把冷蓝海雾染回沙色。
    if (window.__lighting && mood !== 'harbor') this.engine.applyLighting(window.__lighting);

    this.hud.showHud(true);
    this.hud.setMoney(this.money);
    this.hud.setScore(0, 0);
    this.hud.setRound(1);
    this.hud.hideRoundEnd();
    this.hud.showBuy(false);
    this.hud.showPause(false);
    this.hud.setVitals(100, 0);
    this.viewmodel.root.visible = true;
    this.viewmodel.setWeapon('glock');
    this._applyProfileSkins();
    this.setWeapon('glock');

    this.round.beginMatch(mode);
    this.input.setEnabled(true);
    if (!this.input.isTouch) this.input.requestLock();
    Builda.keepScreenOn(true);
    this._setTouchMode('match');
    document.body.classList.remove('in-lobby');
    document.body.classList.add('in-match');
  }

  _setTouchMode(mode) {
    const t = document.getElementById('touch');
    if (!t) return;
    t.classList.remove('hidden');
    t.classList.toggle('lobby', mode === 'lobby');
    if (mode === 'lobby') t.classList.toggle('range', this.rangeActive);
  }

  selectMode(id) {
    if (id === 'range') {
      if (this.mode !== 'lobby') this.enterLobby();
      this.teleportToRange();
      return;
    }
    this.startMatch(id);
  }

  handleActivity(action) {
    if (action === 'armory') {
      if (this.mode !== 'lobby') this.enterLobby();
      const entry = this.profile.equipped.ak;
      const skin = SKIN_MAP[entryId(entry)] || SKIN_MAP.ak_redline;
      this.openPhoto('weapon', 'ak', skin.id, entryVariant(entry, skin));
      return;
    }
    if (action === 'gallery') {
      if (this.mode !== 'lobby') this.enterLobby();
      this.teleportTo(0, 0, 5.5, Math.PI);
      this.lobbyUi.feed('已传送到中央展位 · 走近按 E 查看藏品', 1);
    } else if (action === 'range') {
      if (this.mode !== 'lobby') this.enterLobby();
      this.teleportToRange();
      this.startRangeChallenge();
    }
  }

  teleportTo(x, y, z, yaw) {
    this.player.position.set(x, y || 0, z);
    this.player.velocity.set(0, 0, 0);
    this.player.yaw = yaw;
    this.player.pitch = 0;
    this.input.consumeLook();
  }

  openPhotoById(id, skinId, variant) {
    const kind = (id === 'he' || id === 'flash' || id === 'smoke' || id === 'molotov' ||
      id === 'c4' || id === 'defuse' || id === 'armor' || id === 'case') ? 'prop' : 'weapon';
    this.openPhoto(kind, id, skinId, variant);
  }

  openPhoto(kind, id, skinId, variant) {
    if (this.mode !== 'lobby') this.enterLobby();
    this.photoActive = true;
    if (this._perfEl) this._perfEl.classList.remove('on');
    this.input.setEnabled(false);
    this.input.exitLock();
    if (this.lobbyUi) {
      this.lobbyUi.closePanels();
      this.lobbyUi.show(false);
    }
    if (this.hud) this.hud.showHud(false);
    const touch = document.getElementById('touch');
    if (touch) touch.classList.add('hidden');
    this.photo.show(kind, id, skinId || null, variant || null);
  }

  closePhoto() {
    this.photoActive = false;
    this.photo.hide();
    if (this._perfEl && this._showPerf) this._perfEl.classList.add('on');
    if (this.lobbyUi) this.lobbyUi.show(true);
    this.input.setEnabled(true);
    this._setTouchMode('lobby');
    this._last = performance.now();
  }

  teleportLobby(id) {
    const tp = (this.lobby.teleports || []).find((t) => t.id === id);
    if (!tp) return;
    this.teleportTo(tp.tx, tp.y, tp.tz, tp.yaw);
    this._padCd = 4;
    this.lobbyUi.feed('已传送 · ' + tp.label, 1);
    audio.play('beep', { volume: 0.35 });
  }

  teleportToRange() {
    this.teleportTo(34.2, 0, 0, Math.PI / 2);
    this.lobbyUi.feed('已进入靶场 · 15 m / 25 m / 40 m 三条靶道', 1);
    this._rangeActivePrev = false;
  }

  startRangeChallenge() {
    if (this.mode !== 'lobby') this.enterLobby();
    if (!this.range.zoneOf(this.player)) this.teleportToRange();
    this.range.startChallenge();
    this._challengeWasActive = true;
    this.lobbyUi.feed('30 秒靶场挑战开始', 2);
    audio.play('beep', { volume: 0.5 });
  }

  /* ---------------- 皮肤 ---------------- */

  equipSkin(weapon, skinId, variant) {
    const skin = SKIN_MAP[skinId];
    if (!skin) return;
    const v = variant ? Object.assign({}, variant) : defaultVariant(skin);
    this.profile.equipped[weapon] = { id: skinId, variant: v };
    this.viewmodel.setSkin(weapon, skin, v);
    if (this.mode === 'lobby') {
      this.lobbyWeaponId = weapon;
      this.setWeapon(weapon);
    }
    this.lobbyUi.setProfile(this.profile);
    audio.play('reload', { volume: 0.4 });
  }

  /* ---------------- 购买 / 对局内 ---------------- */

  inBuyZone() {
    const b = this.map.buyZone;
    const p = this.player.position;
    return p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ;
  }

  openBuy() {
    if (!this.player.alive) return;
    if (this.round.phase !== PHASE.FREEZE) {
      this.hud.toast('购买时间已过');
      return;
    }
    if (!this.inBuyZone()) {
      this.hud.toast('必须在出生区购买');
      return;
    }
    this.buyOpen = true;
    this.hud.showBuy(true);
    this.hud.renderBuy(this.money, true);
    this.input.setEnabled(false);
  }

  closeBuy() {
    if (!this.buyOpen) return;
    this.buyOpen = false;
    this.hud.showBuy(false);
    if (!this.paused && !this.panelOpen) this.input.setEnabled(true);
  }

  buy(item) {
    if (this.money < item.price) return;
    if (item.enabled === false) return;
    if (this.modeCfg.pistolOnly && item.id === 'ak') {
      this.hud.toast('手枪局只能购买手枪与护甲');
      return;
    }
    if (item.id === 'ak') {
      this.money -= item.price;
      this.owned.ak = true;
      this.setWeapon('ak');
      this.weapon.refill();
      audio.play('reload', { volume: 0.7 });
    } else if (item.id === 'armor') {
      this.money -= item.price;
      this.player.armor = 100;
      audio.play('reload', { volume: 0.5 });
    } else if (item.id === 'ammo') {
      this.money -= item.price;
      this.weapon.addAmmo();
      audio.play('reload', { volume: 0.5 });
    } else if (item.utility) {
      this.money -= item.price;
      this.utility[item.utility] = Math.min(2, (this.utility[item.utility] || 0) + 1);
      this.hud.setUtility(this.utility, this.selectedUtility);
      audio.play('reload', { volume: 0.5 });
    }
    this.money = Math.max(0, this.money);
    this.hud.setMoney(this.money);
    this.hud.renderBuy(this.money, true);
    this.hud.setVitals(this.player.hp, this.player.armor);
    this.closeBuy();
  }

  addMoney(n) {
    this.money = Math.min(ECONOMY.cap, this.money + n);
    this.hud.setMoney(this.money);
  }

  /* ---------------- 设置 / 暂停 ---------------- */

  openSettings() {
    this.settingsOpen = true;
    const exit = document.getElementById('btn-exit-match');
    if (exit) exit.classList.toggle('hidden', this.mode !== 'match');
    this.hud.showSettings(true);
    this.input.setEnabled(false);
    this.input.exitLock();
    this._updatePauseState();
  }

  closeSettings() {
    this.settingsOpen = false;
    this.hud.showSettings(false);
    Builda.saveSettings(this.settings);
    this._updatePauseState();
  }

  _onPanelChange(open) {
    this.panelOpen = open;
    this._updatePauseState();
    if (!open && !this.input.isTouch && this.mode === 'lobby' && !this.paused) {
      this.input.requestLock();
    }
  }

  _updatePauseState() {
    const paused = this.platformPaused || this.settingsOpen;
    this.paused = paused;
    if (this.started) {
      const blocked = this.buyOpen && this.mode === 'match';
      if (paused || this.panelOpen || blocked) this.input.setEnabled(false);
      else this.input.setEnabled(true);
    }
    this.hud.showPause(this.platformPaused && !this.settingsOpen);
    if (this.platformPaused) this.input.exitLock();
  }

  /* ---------------- 主循环 ---------------- */

  _loop() {
    requestAnimationFrame(this._loop);
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.1, (now - this._last) / 1000));
    this._last = now;

    this._acc += dt;
    let steps = 0;
    while (this._acc >= STEP && steps < 8) {
      this.simulate(STEP);
      this._acc -= STEP;
      steps++;
    }
    if (steps >= 8) this._acc = 0;

    if (this.photoActive) {
      this.photo.update(dt);
      this.photo.render();
      return;
    }
    this._updateCamera(dt);
    this.engine.render();
    this._updateHud(dt);
  }

  simulate(dt) {
    if (!this.started) return;
    if (this.paused) return;

    if (this.photoActive) return;
    if (this.mode === 'lobby') {
      this._simulateLobby(dt);
      return;
    }

    this.throwCd = Math.max(0, this.throwCd - dt);
    this.blindT = Math.max(0, this.blindT - dt);

    if (this.roundEnding) {
      this.grenades.update(dt);
      this.round.update(dt);
      this._updateEffects(dt);
      return;
    }

    this.player.update(dt, this.input, this.world);
    this.weapon.update(dt);

    if (this.player.alive && !this.buyOpen) this._handleCombat(dt);

    const live = this.round.phase === PHASE.LIVE || this.round.phase === PHASE.PLANTED;
    if (live) {
      const ctx = {
        player: this.player,
        playerTeam: this.playerSide,
        tBots: this.tBots,
        ctBots: this.ctBots
      };
      for (const b of this.bots) {
        b.update(dt, ctx, this.map.waypoints, {
          onBotShoot: (bot, shot, target) => this._onBotShoot(bot, shot, target),
          onBotReload: () => {}
        });
      }
      this._updateAimTarget();
      this._updateMuzzleLight();
    }

    this.round.update(dt);
    this.grenades.update(dt);
    this._updateEffects(dt);
  }

  _simulateLobby(dt) {
    this._lobbyTime += dt;
    this.player.update(dt, this.input, this.world);
    this.weapon.update(dt);
    this._rangeFireCd = Math.max(0, this._rangeFireCd - dt);
    this._portalCd = Math.max(0, this._portalCd - dt);
    this._padCd = Math.max(0, this._padCd - dt);

    this.crowd.update(dt, this._lobbyTime, false, this.engine.camera);
    this.lobby.update(dt, this._lobbyTime);
    this.range.update(dt, this.player, this._lobbyTime);
    this.rangeActive = this.range.active;

    const touch = document.getElementById('touch');
    if (touch) touch.classList.toggle('range', this.rangeActive);

    // 挑战结束播报
    if (this._challengeWasActive && !this.range.challenge.active) {
      this._challengeWasActive = false;
      this.lobbyUi.feed('挑战结束：' + this.range.challenge.score + ' 分 · 命中 ' +
        this.range.challenge.hits + ' / ' + this.range.challenge.shots, 2);
      audio.play('win', { volume: 0.6 });
    }

    this._updateLobbyInteraction();
    this._handleLobbyCombat(dt);
    this._updateEffects(dt);

    // 大厅广播
    this._feedT -= dt;
    if (this._feedT <= 0) {
      this._feedT = 12 + Math.random() * 10;
      const f = LOBBY_FEED[(Math.random() * LOBBY_FEED.length) | 0];
      this.lobbyUi.feed(f.text, f.tier);
    }

    // 大屏刷新
    this._screenT -= dt;
    if (this._screenT <= 0) {
      this._screenT = 3.5;
      this._drawLobbyScreen();
      this.lobbyUi.setOnline(1);
    }
  }

  _updateLobbyInteraction() {
    const p = this.player.position;
    let best = null;
    let bestHero = null;

    for (const it of this.lobby.interactions) {
      if (it.id === 'range') continue;
      const d = Math.hypot(p.x - it.x, p.z - it.z);
      if (d < it.r && (!best || d < best.d)) best = { it: it, d: d };
    }
    for (const h of this.lobby.heroes) {
      const d = Math.hypot(p.x - h.cfg.x, p.z - h.cfg.z);
      if (d < 2.6 && (!best || d < best.d)) {
        bestHero = h;
        best = { it: { id: 'hero', label: '查看 ' + h.cfg.weapon.toUpperCase() + ' 展位' }, d: d };
      }
    }

    this._interactTarget = best ? best.it : null;
    this._interactHero = bestHero;
    this.lobbyUi.setInteract(best ? best.it.label : null);

    if (this.input.consumePressed('use') && best) {
      this._triggerInteraction(best.it, bestHero);
    }

    // 走进地面传送点：自动传送（带冷却）
    if (this._padCd <= 0) {
      for (const tp of this.lobby.teleports || []) {
        if (Math.hypot(p.x - tp.x, p.z - tp.z) < 1.55) {
          this._padCd = 5;
          this.teleportLobby(tp.id);
          break;
        }
      }
    }

    // 走进传送门自动打开（带冷却，避免关面板立刻再开）
    if (this._portalCd <= 0) {
      if (Math.hypot(p.x + 15, p.z + 20.4) < 2.2) {
        this._portalCd = 8;
        this.lobbyUi.showModes();
      } else if (Math.hypot(p.x - 15, p.z + 20.4) < 2.2) {
        this._portalCd = 8;
        this.lobbyUi.showActivities();
      }
    }
  }

  _triggerInteraction(it, hero) {
    if (it.id === 'armory') {
      this.lobbyUi.showSkins(this.lobbyWeaponId || 'ak');
    } else if (it.id === 'modes') {
      this.lobbyUi.showModes();
    } else if (it.id === 'activities') {
      this.lobbyUi.showActivities();
    } else if (it.id === 'props') {
      this.openPhoto('prop', 'c4');
    } else if (it.id === 'board') {
      this.lobbyUi.showBoard();
    } else if (it.id === 'hero' && hero) {
      this.lobbyUi.showHero(hero);
    }
  }

  _handleLobbyCombat(dt) {
    const input = this.input;

    if (input.consumePressed('slot1')) this.setWeapon('glock');
    if (input.consumePressed('slot2')) this.setWeapon('ak');
    if (input.consumePressed('slot3')) this.setWeapon('knife');
    if (input.consumePressed('switch')) {
      const order = ['glock', 'ak', 'knife'];
      const i = order.indexOf(this.currentWeaponId);
      this.setWeapon(order[(i + 1) % order.length]);
    }

    if (!this.rangeActive) {
      if (input.consumePressed('fire')) {
        if (this._fireHintT == null || this._lobbyTime - this._fireHintT > 4) {
          this._fireHintT = this._lobbyTime;
          this.hud.toast('大厅内禁止开火 · 请前往东侧靶场');
        }
      }
      return;
    }

    if (this.currentWeaponId === 'knife') return;
    const def = this.weapon.def;
    const want = def.auto ? (input.isDown('fire') || input.consumePressed('fire')) : input.consumePressed('fire');
    if (!want || this._rangeFireCd > 0) return;
    this._rangeFireCd = 60 / def.rpm;
    this._rangeShoot();
  }

  _rangeShoot() {
    const def = this.weapon.def;
    const origin = this.player.eye(this._tmp);
    const dir = this.player.aimDir(new THREE.Vector3());
    const spread = def.spread + Math.min(0.03, Math.hypot(this.player.velocity.x, this.player.velocity.z) * 0.004);
    if (spread > 0) {
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      dir.addScaledVector(right, (Math.random() - 0.5) * spread * 2);
      dir.addScaledVector(up, (Math.random() - 0.5) * spread * 2);
      dir.normalize();
    }

    const maxDist = 78;
    const wHit = this.lobby.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist);
    const tHit = this.range.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist);

    let end;
    let hitTarget = null;
    if (tHit && (!wHit || tHit.t < wHit.t)) {
      const t = this.range.list[tHit.index];
      end = new THREE.Vector3(origin.x + dir.x * tHit.t, origin.y + dir.y * tHit.t, origin.z + dir.z * tHit.t);
      t.up = false;
      t.timer = 0.9 + Math.random() * 0.8;
      t.flash = 0.28;
      t.y = Math.max(t.y, 0.8);
      hitTarget = tHit;
      const res = this.range.registerShot(tHit.index, tHit.t);
      this.lobbyUi.popScore('+' + res.points);
      this._spawnImpact(end, new THREE.Vector3(-dir.x, -dir.y, -dir.z));
      audio.play('hit', { volume: 0.7 });
    } else {
      if (wHit) {
        end = new THREE.Vector3(wHit.x, wHit.y, wHit.z);
        this._spawnImpact(end, new THREE.Vector3(wHit.nx, wHit.ny, wHit.nz));
      } else {
        end = new THREE.Vector3(origin.x + dir.x * maxDist, origin.y + dir.y * maxDist, origin.z + dir.z * maxDist);
      }
      this.range.registerShot(null, 0);
    }

    this.player.applyRecoil(0.32, (Math.random() - 0.5) * 0.12);
    this.viewmodel.onFire();
    audio.play(def.id === 'ak' ? 'shot_rifle' : 'shot_pistol', { volume: 0.8 });
    const muzzle = this.viewmodel.muzzlePosition(this._muzzle);
    this._spawnTracer(muzzle, end, 0xffe2a8);
    this.shake = 0.25;
    Builda.vibrate(1);
    this.lobbyUi.updateRange(this.range.getState());
    return hitTarget;
  }

  _drawLobbyScreen() {
    const s = this.lobby.screen;
    if (!s) return;
    const x = s.ctx;
    const w = s.canvas.width, h = s.canvas.height;
    x.fillStyle = '#0d1115';
    x.fillRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(217,180,122,.16)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(109,158,201,.14)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);

    x.strokeStyle = 'rgba(217,180,122,.38)';
    x.lineWidth = 4;
    x.strokeRect(16, 16, w - 32, h - 32);
    x.fillStyle = '#d9b47a';
    x.fillRect(16, 16, 300, 6);

    x.fillStyle = '#f6f1e4';
    x.font = '700 74px "PingFang SC","Microsoft YaHei",sans-serif';
    x.textAlign = 'left';
    x.fillText('沙城军械大厅', 52, 118);
    x.fillStyle = 'rgba(200,193,176,.92)';
    x.font = '600 24px ui-monospace, monospace';
    x.fillText('DUST PROTOCOL · SECTOR 01 · OPEN LOBBY', 54, 160);

    x.textAlign = 'right';
    x.fillStyle = '#8fd6a2';
    x.font = '700 26px ui-monospace, monospace';
    x.fillText('● LIVE', w - 52, 96);
    x.fillStyle = '#f0d7a4';
    x.font = '700 64px ui-monospace, monospace';
    x.fillText('1', w - 52, 166);
    x.fillStyle = 'rgba(200,195,180,.82)';
    x.font = '600 18px ui-monospace, monospace';
    x.fillText('PLAYERS IN HALL', w - 52, 196);

    x.textAlign = 'left';
    x.fillStyle = 'rgba(217,180,122,.95)';
    x.font = '700 24px ui-monospace, monospace';
    x.fillText('本期收藏家榜 · COLLECTOR BOARD', 52, 218);
    x.fillStyle = 'rgba(255,255,255,.12)';
    x.fillRect(52, 232, w - 104, 2);

    for (let i = 0; i < 5; i++) {
      const row = LEADERBOARD[i];
      const y = 278 + i * 44;
      x.fillStyle = 'rgba(217,180,122,.95)';
      x.font = '700 24px ui-monospace, monospace';
      x.fillText((i + 1 < 10 ? '0' : '') + (i + 1), 54, y);
      x.fillStyle = '#f6f1e4';
      x.font = '600 28px system-ui, sans-serif';
      x.fillText(row.name, 100, y);
      x.fillStyle = tierById(row.tier).color;
      x.font = '700 16px ui-monospace, monospace';
      x.fillText(tierById(row.tier).name, 280, y);
      x.textAlign = 'right';
      x.fillStyle = '#f0d7a4';
      x.font = '700 26px ui-monospace, monospace';
      x.fillText(row.value, w - 54, y);
      x.textAlign = 'left';
    }

    x.fillStyle = 'rgba(255,255,255,.08)';
    x.fillRect(52, h - 52, w - 104, 1);
    x.fillStyle = 'rgba(190,184,168,.92)';
    x.font = '600 20px ui-monospace, monospace';
    x.fillText('W 藏品墙     E 三条靶道     N 作战 / 活动传送', 54, h - 22);
    s.texture.needsUpdate = true;
  }

  _handleCombat() {
    const input = this.input;
    const w = this.weapon;

    if (input.consumePressed('buy')) { this.openBuy(); return; }
    if (!this.player.alive) return;

    if (input.consumePressed('util1')) this.selectUtility('he');
    if (input.consumePressed('util2')) this.selectUtility('flash');
    if (input.consumePressed('util3')) this.selectUtility('smoke');
    if (input.consumePressed('util4')) this.selectUtility('molotov');
    const wantThrow = input.consumePressed('throw');

    if (input.consumePressed('slot1')) this.setWeapon('glock');
    if (input.consumePressed('slot2')) this.switchWeapon();
    if (input.consumePressed('slot3')) this.setWeapon('knife');
    if (input.consumePressed('switch')) this.switchWeapon();

    if (input.consumePressed('reload')) {
      if (w.startReload()) audio.play('reload', { volume: 0.8 });
    }

    if (this.round.phase !== PHASE.LIVE && this.round.phase !== PHASE.PLANTED) {
      input.consumePressed('fire');
      return;
    }

    if (wantThrow) this.throwUtility();

    if (w.def.melee) {
      if (input.consumePressed('fire')) this._melee();
      return;
    }

    const pressed = input.consumePressed('fire');
    const want = w.def.auto ? (input.isDown('fire') || pressed) : pressed;
    if (!want) return;

    if (w.reloading) return;
    if (w.ammo <= 0) {
      audio.play('empty', { volume: 0.6 });
      if (w.startReload()) audio.play('reload', { volume: 0.7 });
      return;
    }

    const shot = w.fire();
    if (!shot) return;

    this.player.applyRecoil(shot.recoilPitch, shot.recoilYaw);
    this.viewmodel.onFire();
    audio.play(w.def.id === 'ak' ? 'shot_rifle' : 'shot_pistol', { volume: 0.85 });
    this.hud.setAmmo(w.ammo, w.reserve);
    this._hitscan(shot.spread);
    Builda.vibrate(1);
  }

  selectUtility(type) {
    if (!UTILITY[type]) return;
    this.selectedUtility = type;
    if (this.hud) this.hud.setUtility(this.utility, this.selectedUtility);
  }

  throwUtility() {
    if (this.mode !== 'match' || !this.player.alive || this.buyOpen) return;
    if (this.round.phase !== PHASE.LIVE && this.round.phase !== PHASE.PLANTED) return;
    if (this.throwCd > 0) return;
    const type = this.selectedUtility;
    const def = UTILITY[type];
    if (!def) return;
    if (!this.utility[type]) {
      this.hud.toast('没有 ' + def.name);
      return;
    }
    const origin = this.player.eye(new THREE.Vector3());
    const dir = this.player.aimDir(new THREE.Vector3());
    origin.addScaledVector(dir, 0.35);
    if (!this.grenades.throw(type, origin, dir)) return;
    this.utility[type]--;
    this.throwCd = 0.75;
    this.hud.setUtility(this.utility, this.selectedUtility);
    if (this.utility[type] <= 0) {
      const next = UTILITY_ORDER.find((t) => this.utility[t] > 0);
      if (next) this.selectUtility(next);
    }
  }

  _melee() {
    const def = WEAPONS.knife;
    const origin = this.player.eye(this._tmp);
    const dir = this.player.aimDir(new THREE.Vector3());
    let best = null;
    for (const b of this.enemyBots) {
      const h = b.hitTest(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, def.range);
      if (h && (!best || h.t < best.t)) best = h;
    }
    this.viewmodel.onFire();
    audio.play('reload', { volume: 0.25 });
    this._rangeFireCd = 60 / def.rpm;
    if (!best) return;
    const killed = best.bot.damage(def.damage, best.head);
    if (killed) {
      this.playerKills++;
      this.addMoney(def.killReward);
      this.hud.killfeed('你 [ 爪刀 ] 敌人' + (best.head ? ' ◎' : ''));
      this.hud.hitmarker(true);
    } else {
      this.hud.hitmarker(false);
    }
  }

  setWeapon(id) {
    if (!WEAPONS[id]) return;
    if (!this.weaponCache[id]) this.weaponCache[id] = new Weapon(id);
    this.currentWeaponId = id;
    this.weapon = this.weaponCache[id];
    this.viewmodel.setWeapon(id);
    if (id === 'knife') {
      this.hud.setWeapon(this.weapon.name, '∞', '', 3);
    } else {
      this.hud.setWeapon(this.weapon.name, this.weapon.ammo, this.weapon.reserve, id === 'glock' ? 1 : 2);
    }
  }

  switchWeapon() {
    if (this.currentWeaponId === 'knife') {
      this.setWeapon(this.owned.ak ? 'ak' : 'glock');
      audio.play('reload', { volume: 0.4 });
      return;
    }
    if (this.currentWeaponId === 'glock') {
      if (!this.owned.ak) {
        this.setWeapon('knife');
        audio.play('reload', { volume: 0.4 });
        return;
      }
      this.setWeapon('ak');
      audio.play('reload', { volume: 0.5 });
      return;
    }
    this.setWeapon('knife');
    audio.play('reload', { volume: 0.4 });
  }

  /** 全场共享一盏枪口补光，落在最近开火的 Bot 上（移动端光源数量要克制）。 */
  _updateMuzzleLight() {
    if (!this._muzzleLight) {
      this._muzzleLight = new THREE.PointLight(0xffb060, 0, 3.4, 2);
      this._muzzleLight.name = 'muzzle-light';
      this.engine.scene.add(this._muzzleLight);
    }
    let firing = null;
    for (const b of this.bots) if (b.muzzleT > 0) { firing = b; break; }
    if (!firing) { this._muzzleLight.intensity = 0; return; }
    firing.flash.getWorldPosition(this._muzzleLight.position);
    this._muzzleLight.intensity = 1.9;
  }

  /** 准星当前指向的敌方单位：用于单位高亮与瞄准标记（选中反馈）。 */
  _updateAimTarget() {
    if (!this.player.alive) {
      for (const b of this.bots) b.aimed = false;
      return;
    }
    const origin = this.player.eye(this._tmp);
    const dir = this.player.aimDir(new THREE.Vector3());
    let best = null;
    let bestT = 1e9;
    for (const b of this.enemyBots) {
      const h = b.hitTest(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 70);
      if (h && h.t < bestT) { bestT = h.t; best = b; }
    }
    for (const b of this.enemyBots) b.aimed = (b === best);
    for (const b of this.allyBots) b.aimed = false;
  }

  _hitscan(spread) {
    const def = this.def();
    const origin = this.player.eye(this._tmp);
    const dir = this.player.aimDir(new THREE.Vector3());

    if (spread > 0) {
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      dir.addScaledVector(right, (Math.random() - 0.5) * spread * 2);
      dir.addScaledVector(up, (Math.random() - 0.5) * spread * 2);
      dir.normalize();
    }

    const range = def.range;
    const wHit = this.map.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);

    let best = null;
    for (const b of this.enemyBots) {
      const h = b.hitTest(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
      if (h && (!best || h.t < best.t)) best = h;
    }

    let end;
    if (best && (!wHit || best.t < wHit.t)) {
      const point = new THREE.Vector3(
        origin.x + dir.x * best.t,
        origin.y + dir.y * best.t,
        origin.z + dir.z * best.t
      );
      end = point;
      const falloff = 1 - Math.min(0.35, (best.t / range) * 0.35);
      const head = best.head;
      const dmg = def.damage * falloff;
      const killed = best.bot.damage(dmg, head);
      if (killed) {
        this.playerKills++;
        this.addMoney(def.killReward);
        this.hud.killfeed('你 [ ' + def.name + ' ] 敌人' + (head ? ' ◎' : ''));
        this.hud.hitmarker(true);
      } else {
        this.hud.hitmarker(false);
      }
      this._spawnImpact(point, new THREE.Vector3(-dir.x, -dir.y, -dir.z));
    } else if (wHit) {
      end = new THREE.Vector3(wHit.x, wHit.y, wHit.z);
      this._spawnImpact(end, new THREE.Vector3(wHit.nx, wHit.ny, wHit.nz));
      this.hud.hitmarker(false);
    } else {
      end = new THREE.Vector3(origin.x + dir.x * range, origin.y + dir.y * range, origin.z + dir.z * range);
    }

    const muzzle = this.viewmodel.muzzlePosition(this._muzzle);
    this._spawnTracer(muzzle, end, 0xffe2a8);
  }

  def() { return this.weapon.def; }

  _onBotShoot(bot, shot, target) {
    const from = bot.eye(new THREE.Vector3());
    const to = target
      ? (target === this.player ? this.player.eye(new THREE.Vector3()) : target.eye(new THREE.Vector3()))
      : from.clone().addScaledVector(shot.dir, 26);
    this._spawnTracer(from, to, bot.team === 't' ? 0x9fd8ff : 0xff7a45);
    if (!shot.hit || !target) return;

    if (target === this.player) {
      if (!this.player.alive) return;
      const dmg = 7 + Math.random() * 5;
      this.player.damage(dmg);
      this.shake = 0.5;
      this.hud.flashDamage(0.6);
      this.hud.setVitals(this.player.hp, this.player.armor);
      audio.play('hit', { volume: 0.35 });
      if (!this.player.alive) {
        this.playerDeaths++;
        bot.kills++;
        this.viewmodel.root.visible = false;
        this.hud.killfeed('敌人 [ 步枪 ] 你');
      }
      return;
    }

    // Bot 对 Bot：队友与敌人互相伤害
    const dmg = 16 + Math.random() * 10;
    const killed = target.damage(dmg, shot.head);
    if (killed) {
      bot.kills++;
      const ally = (u) => u && u.team === this.playerSide;
      const a = ally(bot) ? '队友 ' + bot.label : '敌人 ' + bot.label;
      const b = ally(target) ? '队友 ' + target.label : '敌人 ' + target.label;
      this.hud.killfeed(a + ' [ 步枪 ] ' + b + (shot.head ? ' ◎' : ''));
    }
  }

  onRoundStart() {
    this.roundEnding = false;
    this.buyOpen = false;
    this.hud.showBuy(false);
    this.hud.hideRoundEnd();
    this.input.setEnabled(!this.panelOpen && !this.settingsOpen);
    if (this.modeCfg.pistolOnly) {
      this.owned.ak = false;
      this.setWeapon('glock');
    } else {
      this.setWeapon(this.owned.ak ? 'ak' : 'glock');
    }
    if (this.weapon) this.weapon.refill();
    this.hud.setVitals(this.player.hp, this.player.armor);
    this.hud.setMoney(this.money);
    this.hud.setWeapon(this.weapon.name, this.weapon.ammo, this.weapon.reserve, this.currentWeaponId === 'glock' ? 1 : 2);
    this.hud.setObjective(this.playerSide === 'ct' ? '购买装备，准备防守 A / B' : '购买装备，准备进攻 A / B');
  }

  endRound(win, reason) {
    this.roundEnding = true;
    this.input.setEnabled(false);
    this.input.exitLock();
    this.hud.setVitals(this.player.hp, this.player.armor);
  }

  onMatchEnd(win, reason) {
    this.matchOver = true;
    this.input.setEnabled(false);
    this.input.exitLock();
    this.hud.setPhase('对局结束');
    this.lobbyUi.showMatchEnd({
      win: win,
      scoreT: this.round.scoreT,
      scoreCT: this.round.scoreCT,
      reason: reason || (win ? '目标达成' : '目标失守'),
      kills: this.playerKills,
      deaths: this.playerDeaths,
      rounds: this.round.round
    });
  }

  /* ---------------- 特效池 ---------------- */

  _initEffects() {
    this.tracers = [];
    this.impacts = [];
    const tex = impactTexture();

    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffe2a8, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.engine.scene.add(line);
      this.tracers.push({ line, mat, life: 0 });
    }

    for (let i = 0; i < 20; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat);
      m.visible = false;
      this.engine.scene.add(m);
      this.impacts.push({ mesh: m, mat, life: 0 });
    }
  }

  _spawnTracer(from, to, color) {
    let t = this.tracers.find((x) => x.life <= 0);
    if (!t) t = this.tracers[0];
    const p = t.line.geometry.attributes.position;
    p.setXYZ(0, from.x, from.y, from.z);
    p.setXYZ(1, to.x, to.y, to.z);
    p.needsUpdate = true;
    t.mat.color.setHex(color);
    t.mat.opacity = 0.85;
    t.life = 0.075;
    t.line.visible = true;
  }

  _spawnImpact(point, normal) {
    let im = this.impacts.find((x) => x.life <= 0);
    if (!im) im = this.impacts[0];
    im.mesh.position.copy(point).addScaledVector(normal, 0.012);
    im.mesh.lookAt(point.clone().add(normal));
    im.mesh.visible = true;
    im.mat.opacity = 0.9;
    im.life = 6;
  }

  _updateEffects(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.mat.opacity = Math.max(0, t.life / 0.075) * 0.85;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    for (const im of this.impacts) {
      if (im.life > 0) {
        im.life -= dt;
        if (im.life < 2) im.mat.opacity = Math.max(0, im.life / 2) * 0.9;
        if (im.life <= 0) im.mesh.visible = false;
      }
    }
  }

  /* ---------------- 相机 / HUD ---------------- */

  _updateCamera(dt) {
    const cam = this.engine.camera;
    if (this._devFreecam && this._devCam) {
      cam.position.copy(this._devCam.pos);
      cam.rotation.set(this._devCam.pitch, this._devCam.yaw, 0, 'YXZ');
      cam.fov = this._devCam.fov || 70;
      cam.updateProjectionMatrix();
      this.viewmodel.root.visible = false;
      return;
    }
    if (this.debugTop) {
      cam.position.set(this.mode === 'lobby' ? 18 : 0, 82, this.mode === 'lobby' ? 0 : 0);
      cam.rotation.set(-Math.PI / 2, 0, 0);
      cam.fov = 55;
      cam.updateProjectionMatrix();
      this.viewmodel.root.visible = false;
      return;
    }

    const eye = this.player.eye(this._tmp);
    cam.position.copy(eye);
    if (!this.player.alive) cam.position.y = this.player.position.y + 0.45;

    this.shake = Math.max(0, Math.min(1, this.shake - dt * 4));
    const sh = this.shake * 0.012;
    cam.rotation.y = this.player.viewYaw() + Math.PI + (Math.random() - 0.5) * sh;
    cam.rotation.x = this.player.viewPitch() + (Math.random() - 0.5) * sh;
    cam.rotation.z = 0;

    if (cam.fov !== this.settings.fov) {
      cam.fov = this.settings.fov;
      cam.updateProjectionMatrix();
    }

    this.viewmodel.root.visible = this.started && this.player.alive && !this.paused;
    this.viewmodel.update(dt, this.weapon, this.player, cam);
  }

  _updateHud(dt) {
    this._hudT += dt;
    this._fpsT += dt;
    this._fpsN++;

    if (this._hudT > 0.1) {
      this._hudT = 0;
      if (this.mode === 'lobby') {
        this.lobbyUi.updateRange(this.range.getState());
        this.hud.setFps(this._fps || 0);
      } else {
        this.hud.setTimer(this.round.timer);
        this.hud.setVitals(this.player.hp, this.player.armor);
        this.hud.setMoney(this.money);
        if (this.currentWeaponId !== 'knife') this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve);
        this.hud.setRound(this.round.round);
        this.hud.setScore(this.round.scoreT, this.round.scoreCT);
        this.hud.setUtility(this.utility, this.selectedUtility);
        this.hud.setBlind(this.blindT);
        this.hud.drawRadar(this.map, this.player, this.bots, this.round.bomb);

        const playerRows = [{
          name: this.playerName || '玩家',
          kills: this.playerKills, deaths: this.playerDeaths,
          alive: this.player.alive, you: true
        }].concat(this.allyBots.map((b) => ({
          name: b.label, kills: b.kills, deaths: b.deaths, alive: b.alive, you: false
        })));
        const enemyRows = this.enemyBots.map((b) => ({
          name: b.label, kills: b.kills, deaths: b.deaths, alive: b.alive, you: false
        }));
        const tRows = this.playerSide === 't' ? playerRows : enemyRows;
        const ctRows = this.playerSide === 'ct' ? playerRows : enemyRows;
        this.hud.setRoster(tRows, ctRows);
        this.hud.showScoreboard(this.input.isDown('scoreboard'), { t: tRows, ct: ctRows });

        const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
        const gap = 4 + this.weapon.spread() * 900 + speed * 1.1 + this.weapon.recoilIndex * 0.35;
        this.hud.setCrosshairGap(gap);

        if (this.stats) {
          const info = this.engine.renderer.info.render;
          console.log('[stats] calls=' + info.calls + ' tris=' + info.triangles + ' fps=' + this._fps);
        }
      }
    }

    if (this._fpsT > 0.5) {
      this._fps = Math.round(this._fpsN / this._fpsT);
      this._fpsT = 0;
      this._fpsN = 0;
      this.hud.setFps(this._fps);
      this._perfAge += 0.5;
      this._updatePerf();
      this._adaptQuality();
    }
  }

  _updatePerf() {
    const info = this.engine.renderer.info.render;
    const dpr = (this.engine.basePixelRatio || 1) * this.engine.renderScale;
    const perf = {
      fps: this._fps,
      ms: this._fps ? 1000 / this._fps : 0,
      calls: info.calls,
      triangles: info.triangles,
      quality: this.engine.quality,
      dpr: +dpr.toFixed(2),
      renderScale: +this.engine.renderScale.toFixed(2),
      crowd: this.crowd ? this.crowd.total : 0,
      detail: this.crowd ? this.crowd.detailLimit : 0,
      far: this.crowd ? this.crowd.farCount : 0,
      mode: this.mode
    };
    window.__perf = perf;
    if (!this._showPerf || !this._perfEl) return;
    this._perfEl.textContent =
      this._fps + ' FPS · ' + perf.ms.toFixed(1) + 'ms · ' +
      info.calls + ' calls · ' + Math.round(info.triangles / 1000) + 'k tris · ' +
      this.engine.quality + ' · DPR ' + dpr.toFixed(2) +
      (this.crowd ? ' · ' + this.crowd.total + '人 (细节 ' + this.crowd.detailLimit + ')' : '');
  }

  /** 掉帧只降特效/细节，分辨率永远保持原生档（用户硬性要求）。 */
  _adaptQuality() {
    if (this._noAdapt || this._perfAge < 3 || this.mode !== 'lobby') return;
    if (this._fps < 52) {
      this._highStreak = 0;
      this._lowStreak++;
      if (this._lowStreak < 2) return;
      this._lowStreak = 0;
      if (this.crowd.detailLimit > this.crowd.n * 0.62) {
        this.crowd.setDetailLimit(this.crowd.detailLimit * 0.87);
      } else if (this.crowd.farCount > 100) {
        this.crowd.setFarCount(this.crowd.farCount * 0.75);
      } else if (this.engine.quality !== 'low') {
        this.settings.quality = 'low';
        this.engine.setQuality('low');
        this.crowd.setQuality('low');
      }
    } else {
      this._lowStreak = 0;
      this._highStreak = 0;
    }
  }
}
