# T-014 Bot 投掷物与烟雾视线

- 负责人：other
- 分支：`task/other/T-014-bot-utility`
- 基线：`c11a735d02d4`（main，含 T-012 OASIS）
- 关联：Issue #25

## 目标

让 Bot 会用地形和投掷物，并让烟雾真正影响 Bot 视线。不改地图文件。

## 审计结论（详见 Issue #25）

| 项 | 现状 |
|---|---|
| `js/game/utility.js` / `projectiles.js` | **不存在**。T-010 的投掷物系统实际落在 `js/game/grenade.js` |
| Bot 视线 | `_pickTarget` 只查 `world.lineOfSight`（纯 AABB），烟雾完全不影响 |
| 开枪 | 帧首锁定后直接连发，中途不复检视线 |
| 烟雾数据 | `smokes[]` 只有渲染对象，没有世界坐标字段 |
| Bot 投掷 | 没有库存、拿不到 `game.grenades`、拿不到 `map.*` |
| 回合钩子 | `round.start()` 每回合调 `Bot.reset()`，不需要改 `round.js` |

## 实现

### 1. 烟雾视线（`js/game/grenade.js`）

```js
smokeBlocks(ax, ay, az, bx, by, bz, smokes) -> boolean
```

- 全仓唯一实现。判定：2D 线段 vs 烟球（`UTILITY.smoke.radius = 3.2`），
  另加高度闸门——两端都在烟顶（落地 +2.8 m）以上时放行，高台对高台不会被误挡。
- 起烟 0.35 s 内半径线性涨满，避免「刚落地就隔空挡枪」。
- `GrenadeSystem` 每帧把同一个函数挂到**当前** `game.world`：
  `world.smokeBlocks(...)`；`game.world` 在大厅/对局之间会切换，所以只能懒绑定。
- `GrenadeSystem.smokeBlocks(...)` 是同一个函数的实例入口，玩家侧/观战/将来任何
  视线消费方都调这一份，不存在两份口径。

`_smoke()` 给烟对象补 `x / y / z`，查询不依赖渲染对象。

### 2. Bot 视线接入（`js/game/bots.js`）

- `_pickTarget`：每个候选目标先查实体墙，再查 `_smokeBlocked(myEye, targetEye)`。
- 开火前：`shootCd` 到点时再查一次烟；被挡则把冷却压到 0.25 s、`reaction` 归零，
  不发射。等于「目标走进烟里，Bot 立刻停火」。

### 3. Bot 投掷

**库存与节奏**

| 项 | 规则 |
|---|---|
| 烟 | 每回合每人 1 颗 |
| 闪 | T 的 `entry`、CT 的 `anchor` 额外 1 颗 |
| 重置 | `Bot.reset()`（`round.start()` 每回合调用） |
| 冷却 | 投出后 7–11 s；同一目标点一回合只投一次 |
| 上限 | 库存即硬上限，每回合每人最多 2 颗 |

**决策**

- 只在 `objective.type ∈ {push, plant, guard}` 时投；`defuse` / 无目标不投。
- 进攻：距目标 6–30 m；防守：站进包点 14 m 内。
- 近距离对枪（`target.dist < 16`）不掏投掷物；远距离交火仍可先手起烟。
- 落点：
  - 进攻：沿 `NavGrid.path` 的实际进攻路径，取距目标 4–12 m 路段里离墙最近的拐点
    （`nav.clear` 最小 = 门口/咽喉）。换地图不用改代码。
  - 防守：包点 6–16 m 环带内离墙最近的格，并**偏向远离己方出生点**的一侧。
  - 兜底：朝目标退 10 m 的可走格。
- 投前检查：出手点到落点有视线（不隔墙）；落点 4 m 内（闪光 10 m）没有队友。
- 弹道：`t = 引信时长`，`vx = Δx/t`、`vy = (Δy + ½gt²)/t`，引信到期正好落在落点。
  水平速度 > 22 m/s 放弃。

**投掷通道**（不改 `game.js`）

`GrenadeSystem` 把 `queue` 挂到 `world.botUtilityQueue`。Bot 只 push：

```js
{ type: 'smoke' | 'flash', origin: {x,y,z}, vel: {x,y,z}, owner: bot }
```

`GrenadeSystem.update()` 每帧消费成真正的投掷物（`_spawn`），因此 Bot 不需要
`game` 引用。`owner` 用于闪光不闪自己。

**范围限制**：Bot 只投烟和闪。HE / 燃烧瓶有伤害归属问题（现有实现把人头记给玩家），
本轮不碰。

## 边界

| 文件 | 改动 |
|---|---|
| `js/game/grenade.js` | `smokeBlocks` + 烟坐标 + `botUtilityQueue` + `_spawn` + 闪光跳过 owner |
| `js/game/bots.js` | 烟雾接入视线、投掷库存/决策/选点/弹道 |
| `tools/smoke.mjs` | +8 条断言（73 → 81） |
| `collab/tasks/T-014-bot-utility.md` | 本卡 |

未触碰 `js/world/map.js`、`js/world/map-oasis.js`、`js/game.js`、`js/ui/hud.js`、
`index.html`、`css/`、`js/config/`、`.github/`。

> 任务卡原写的 `js/game/utility.js` / `projectiles.js` 在仓库里不存在；按「投掷物系统」
> 的实际落点改 `js/game/grenade.js`，且该文件不在禁止清单内。

## 地图无关性

新增代码里没有任何沙城坐标 / 包点键名 / callout 名：

- 投掷点来自 `bot.objective`（回合层下发）+ `NavGrid`（从 `world` 碰撞盒推导）；
- 咽喉判定只用 `nav.clear`（每格到墙距离）；
- 视线判定只用 `world` 的碰撞与烟雾体积。

合成地图（64×64，包点 A(18,10)/B(-18,10)）与真实沙城跑的是同一套代码。

## 验收

`npm run smoke` 73/73 → **81/81**：

1. 烟雾挡视线：同一个查询给玩家和 Bot 用（横穿=true / 旁路=false / 高空=false / 共用=true）
2. 烟雾中 Bot 丢失锁定（放烟前=true / 烟中=false / 烟散=true）
3. 烟雾中 Bot 不开火（放烟前 1 次 / 烟中 0 次）
4. Bot 会投烟：走队列 → 生成投掷物 → 起烟
5. Bot 投掷点取自包点周边（不写死坐标）
6. Bot 投掷有库存上限且不每帧扔（队列无残留）
7. Bot 投掷物每回合重发
8. 真实地图整场 Bot 也会投掷（60 s/局，整场 13–16 颗，无异常）

`npm run smoke:lobby` 12/12（本机无 DISPLAY，用 `xvfb-run` 跑）。

## 已知边界

- **CT 非 anchor 不投烟**：`round.js` 只给 CT anchor 下发 `guard` 目标，其余 CT 仍巡逻；
  投掷决策依赖 `objective`，所以这部分人不会投。要扩展需改 `round.js`（本轮禁改）。
- 烟雾只影响 Bot 的目标获取 / 开枪；玩家侧「看见」由渲染器决定，没有额外的 LOS 代码。
  `world.smokeBlocks` 已对玩家侧开放，将来接玩家判定不需要新写一份。
- 投掷没有专门的抛掷动画，只有投掷物本体与音效。
