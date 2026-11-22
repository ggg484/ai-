// 合成地图 fixture：给 Bot / 回合系统做「地图无关」回归用。
//
// 设计约束：
//   · 不读取 js/world/map.js 的任何数据，只返回与 buildMap() **同形状**的对象；
//   · 尺寸 / 包点数量都可调，用来证明回合层没有写死沙城的 A/B 与坐标；
//   · 只依赖 three + collision，Bot / Round 用动态 import 延迟加载，
//     这样本文件在 Node 里也能只跑 buildFixtureMap()（不碰 DOM）。
//
// 浏览器里用法（smoke 就是这么用的）：
//   const { buildFixtureMap, createArena } = await import('/tools/map-fixture.mjs');
//   const map = buildFixtureMap({ siteCount: 2 });
//   const arena = await createArena(map);
//   arena.runUntil((r) => r.phase === 'live', 64 * 16);
//   arena.runUntil((r) => r.phase === 'planted', 64 * 40);
//   console.log(arena.state());

import * as THREE from '../vendor/three.module.js';
import { World } from '../js/world/collision.js';

/** fixture 的固定尺寸（米）。地图契约里的 bounds 必须是这个方框。 */
export const FIXTURE_SIZE = 64;

const WALL = 0x6b6257;
const COVER = 0x7a6a4f;
const SITE = 0x8a6a3a;

/**
 * 造一张 64×64 的合成图。
 *
 * 布局（64×64，原点在正中）：
 *   · 四周 1 m 厚围墙，南北各一个出生区（T 在 z<0，CT 在 z>0）；
 *   · 中间一道横墙，只留中央 10 m 缺口 —— 直线路径必然被挡，能验证 A* 真的在绕；
 *   · 两个包点 A(18,10) / B(-18,10)，与沙城的 (±44,16) 完全不同；
 *   · 包点台只有 0.12 m（低于 NAV_STEP_UP），不会像沙城 0.58 m 高台那样挡住导航格。
 *
 * @param {{size?:number, siteCount?:1|2|3}} [opts]
 */
export function buildFixtureMap(opts) {
  const o = opts || {};
  const size = o.size || FIXTURE_SIZE;
  const k = size / FIXTURE_SIZE;          // 内部布局按 64 设计，其它尺寸等比缩放
  const half = size / 2;
  const X = (v) => v * k;

  const root = new THREE.Group();
  root.name = 'fixture-map';
  const colliders = [];
  const placed = [];
  let seq = 0;

  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  root.add(ground);
  // 地面单独一条大 collider：NavGrid 的 bounds 就是从这里推出来的
  colliders.push({ minX: -half, maxX: half, minY: -1.2, maxY: 0, minZ: -half, maxZ: half, tag: 'ground' });

  function box(cx, cy, cz, w, h, d, color, tag) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 })
    );
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    colliders.push({
      minX: cx - w / 2, maxX: cx + w / 2,
      minY: cy - h / 2, maxY: cy + h / 2,
      minZ: cz - d / 2, maxZ: cz + d / 2,
      tag: tag || ''
    });
    placed.push({ id: seq++, x: cx, y: cy, z: cz, w, h, d, tag: tag || '' });
  }

  // 围墙：内表面正好贴 bounds，NavGrid 不会把格子算到墙外
  const H = 3;
  const T = Math.max(0.5, X(1));
  box(0, H / 2, -half + T / 2, size, H, T, WALL, 'wall');
  box(0, H / 2, half - T / 2, size, H, T, WALL, 'wall');
  box(-half + T / 2, H / 2, 0, T, H, size - T * 2, WALL, 'wall');
  box(half - T / 2, H / 2, 0, T, H, size - T * 2, WALL, 'wall');

  // 中墙：x ∈ [-31,-5] 与 [5,31]，中央 10 m 缺口
  box(X(-18), H / 2, 0, X(26), H, T, WALL, 'wall');
  box(X(18), H / 2, 0, X(26), H, T, WALL, 'wall');

  // 包点：A / B 固定，C 只在 siteCount=3 时出现
  const sitePlan = [
    { key: 'A', x: 18, z: 10 },
    { key: 'B', x: -18, z: 10 },
    { key: 'C', x: 0, z: 20 }
  ];
  const siteCount = Math.max(1, Math.min(sitePlan.length, o.siteCount || 2));
  const sites = {};
  for (let i = 0; i < siteCount; i++) {
    const p = sitePlan[i];
    const r = X(5);
    sites[p.key] = { x: X(p.x), z: X(p.z), r };
    // 0.12 m 台面：够低，world.move 一步就能上，NavGrid 也不会当障碍
    box(X(p.x), 0.06, X(p.z), r * 2, 0.12, r * 2, SITE, 'site');
  }

  // 掩体：都在两条进攻线上，且避开包点中心与航点
  const covers = [
    [8, -12, 2.0, 1.4, 2.0], [-8, -12, 2.0, 1.4, 2.0],
    [24, -18, 2.4, 1.4, 1.2], [-24, -18, 2.4, 1.4, 1.2],
    [12, 18, 2.4, 1.4, 1.2], [-12, 18, 2.4, 1.4, 1.2],
    [26, 2, 2.0, 1.4, 2.0], [-26, 2, 2.0, 1.4, 2.0],
    [0, -8, 3.0, 1.4, 1.2]
  ];
  for (const c of covers) box(X(c[0]), c[3] / 2, X(c[1]), X(c[2]), c[3], X(c[4]), COVER, 'cover');

  const spawns = {
    player: { x: 0, z: X(-26), yaw: 0, waypoint: 0 },
    playerCT: { x: 0, z: X(26), yaw: Math.PI, waypoint: 3 },
    allies: [
      { x: X(-2), z: X(-26), yaw: 0, waypoint: 0 },
      { x: X(2), z: X(-26), yaw: 0, waypoint: 0 }
    ],
    ctAllies: [
      { x: X(-2), z: X(26), yaw: Math.PI, waypoint: 3 },
      { x: X(2), z: X(26), yaw: Math.PI, waypoint: 3 }
    ],
    bots: [
      { x: X(-4), z: X(24), yaw: Math.PI, waypoint: 3 },
      { x: X(4), z: X(24), yaw: Math.PI, waypoint: 3 }
    ],
    tBots: [
      { x: X(-4), z: X(-26), yaw: 0, waypoint: 1 },
      { x: X(4), z: X(-26), yaw: 0, waypoint: 1 }
    ]
  };

  // 6 个航点，和沙城 37 个点、不同索引：验证巡逻只依赖数组长度
  const waypoints = [
    { x: 0, z: X(-20) },
    { x: 0, z: X(-6) },
    { x: 0, z: X(6) },
    { x: X(16), z: X(6) },
    { x: X(-16), z: X(6) },
    { x: 0, z: X(14) }
  ];

  const buyZone = {
    minX: spawns.player.x - X(10), maxX: spawns.player.x + X(10),
    minZ: spawns.player.z - X(5.5), maxZ: spawns.player.z + X(5.5)
  };

  const callouts = {
    tSpawn: { x: spawns.player.x, z: spawns.player.z },
    ctSpawn: { x: spawns.playerCT.x, z: spawns.playerCT.z },
    mid: { x: 0, z: 0 }
  };
  for (const key of Object.keys(sites)) {
    callouts['site' + key] = { x: sites[key].x, z: sites[key].z };
  }

  return {
    // 与 buildMap() 返回对象同名字段，顺序也保持一致，方便肉眼对照契约
    root,
    world: new World(colliders),
    placed,
    baseCount: placed.length,
    edits: null,
    sites,
    spawns,
    buyZone,
    bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
    waypoints,
    coversAdded: covers.length,
    callouts
  };
}

/* ------------------------------------------------------------------ */
/* 最小对局壳：真 Round + 真 Bot，只有 hud / player / scene 是桩           */
/* ------------------------------------------------------------------ */

/**
 * 用 fixture 地图搭一个可推进的「假对局」。真跑 Round 与 Bot，只把
 * hud / 音频 / 玩家这些与地图无关的外部依赖换成记录器，避免把整局游戏拉进来。
 *
 * @param {object} map buildFixtureMap() 的返回值
 * @param {{perTeam?:number, combat?:boolean, playerAlive?:boolean}} [opts]
 */
export async function createArena(map, opts) {
  const o = opts || {};
  const [{ Bot }, { Round }] = await Promise.all([
    import('../js/game/bots.js'),
    import('../js/game/round.js')
  ]);

  const hudLog = [];
  const hud = {
    phase: '', objective: '', bomb: false, bombTimer: 0, plant: 0, plantVisible: false,
    money: 0, round: 1, score: [0, 0], roundEnd: null,
    setPhase(v) { this.phase = v; hudLog.push(['phase', v]); },
    setObjective(v) { this.objective = v; },
    setBomb(v) { this.bomb = v; },
    setBombTimer(v) { this.bombTimer = v; },
    setPlant(v, show) { this.plant = v; this.plantVisible = !!show; },
    setMoney(v) { this.money = v; },
    setRound(v) { this.round = v; },
    setScore(t, ct) { this.score = [t, ct]; },
    showRoundEnd(win, reason) { this.roundEnd = { win, reason }; },
    flashDamage() {},
    drawRadar() {},
    toast() {}
  };

  const playerAlive = !!o.playerAlive;
  const player = {
    position: new THREE.Vector3(map.spawns.player.x, 0, map.spawns.player.z),
    respawnPoint: map.spawns.player,
    alive: playerAlive,
    hp: 100,
    reset(p) {
      const s = p || this.respawnPoint;
      this.position.set(s.x, 0, s.z);
      this.hp = 100;
      this.alive = playerAlive;
    },
    eye(out) { return (out || new THREE.Vector3()).set(this.position.x, this.position.y + 1.55, this.position.z); },
    damage() {}
  };

  const perTeam = Math.max(1, o.perTeam || 1);
  const tBots = map.spawns.allies.slice(0, perTeam)
    .map((s) => new Bot(map.root, s, map.world, { team: 't' }));
  const ctBots = map.spawns.bots.slice(0, perTeam)
    .map((s) => new Bot(map.root, s, map.world, { team: 'ct' }));
  const bots = tBots.concat(ctBots);

  const game = {
    scene: map.root,
    map,
    player,
    hud,
    input: { isDown: () => false },
    money: 800,
    playerSide: 't',
    roundEnding: false,
    bots,
    tBots,
    ctBots,
    allyBots: tBots,
    enemyBots: ctBots,
    addMoney(n) { this.money = Math.min(16000, this.money + n); },
    endRound(win, reason) { this.lastRoundEnd = { win, reason }; },
    onRoundStart() {},
    setPlayerSide(side) { this.playerSide = side; }
  };

  const round = new Round(game);
  game.round = round;

  const ctx = {
    player,
    playerTeam: 't',
    tBots: o.combat ? tBots : [],
    ctBots: o.combat ? ctBots : []
  };
  const noop = { onBotShoot: () => {}, onBotReload: () => {} };

  /** 推进 n 帧：与 game.js 主循环同序（live 时先 Bot 后 Round）。 */
  function step(dt, frames) {
    const h = dt || 1 / 64;
    for (let i = 0; i < (frames || 1); i++) {
      if (round.phase === 'live' || round.phase === 'planted') {
        for (const b of bots) b.update(h, ctx, map.waypoints, noop);
      }
      round.update(h);
    }
  }

  /** 一直推进到 predicate 为真（或帧数用尽），返回是否等到。 */
  function runUntil(predicate, maxFrames, dt) {
    const h = dt || 1 / 64;
    for (let i = 0; i < (maxFrames || 4000); i++) {
      if (predicate(round)) return true;
      step(h, 1);
    }
    return predicate(round);
  }

  return {
    map,
    game,
    round,
    hud,
    player,
    bots,
    tBots,
    ctBots,
    step,
    runUntil,
    begin() { round.beginMatch(); return round; },
    state() {
      return {
        phase: round.phase,
        timer: +round.timer.toFixed(1),
        siteKeys: round.siteKeys(),
        plantSite: round._plantSite,
        planter: round._planter ? round._planter.id : null,
        defuser: round._defuser ? round._defuser.id : null,
        bomb: round.bomb ? { x: +round.bomb.x.toFixed(1), z: +round.bomb.z.toFixed(1), site: round.bomb.site } : null,
        score: [round.scoreT, round.scoreCT],
        result: round.result,
        objective: hud.objective,
        bots: bots.map((b) => ({
          id: b.id, team: b.team, role: b.role,
          x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2),
          holding: b.holding, engage: b.engage,
          objective: b.objective ? b.objective.type : null
        }))
      };
    }
  };
}
