# T-011 多地图兼容与地图二 Bot 回归

- 负责人：other
- 分支：`task/other/T-011-multi-map`
- 基线：`c94672edd4af`（main）
- 关联：Issue #21

## 目标

让 Bot / 回合系统彻底与「沙城」解耦，并用一张 64×64 的合成地图把这条链路跑通，为第二张地图（T-012 / PR #23）提供可对照的契约。

## 审计结论

详见 Issue #21 的审计评论，摘要：

| 层 | 结论 |
|---|---|
| `bots.js` | 0 处读取 `map.sites` / `map.bounds` / `map.callouts`；导航网格全部从 `world` 碰撞盒推导 |
| `round.js` | 3 处「包点数量 = 2、键名必须是 A/B」的假设（`_plantSite` 随机、anchor 轮转、HUD 文案） |
| 尺度常量 | `_pickTarget` 的 44 m 视野、`spawnWaypoint` 的 `% 8` |

## 实现

### `js/game/round.js`

- 新增 `siteKeys()` / `siteLabel()`：包点集合与显示标签都由 `map.sites` 的键决定。
- `_plantSite` 从键集合随机取，不再 `'A' : 'B'`。
- CT anchor 守点改为 `[主攻点, ...其余点]` 轮转：2 个点时行为与旧版一致，3 个点也能覆盖。
- 换包点后**重新下发**下包 / 守点目标（原来只在 `objective.type` 不同时才换，导致「计划换 B、人还在往 A 跑」）。
- HUD 文案改为 `'在 ' + siteLabel() + ' 点安放炸弹'`，不再写死 `A / B`。

### `js/game/bots.js`

- `44` 提为 `BOT_VIEW_RANGE`，实际生效值取 `min(44, 导航网格对角线)`：小地图自动收紧，大地图行为不变。
- `spawnWaypoint` 兜底由 `(seq * 3) % 8` 改为 `0`，不再暗示「至少 8 个航点」。
- `_steerToObjective`：下包目标支持 `r`（包点半径），站进 `max(0.9, r - 0.6)` 即开始下包。

> 最后一条修的是真实缺陷：沙城包点中心是 0.58 m 高台，Bot 上不去，而旧逻辑要求「距中心 0.9 m」才站定，所以真实对局里 T Bot 根本下不了包（smoke 之前是靠瞬移到包点中心才通过的）。改成「包点内任意位置可下包」后与真实规则一致。

## 地图契约（新地图必须提供）

`buildMap()` 的返回值即契约；下表的字段名、类型、语义都不能变。

| 字段 | 类型 | 必需 | 消费方 | 说明 |
|---|---|---|---|---|
| `root` | `THREE.Object3D` | ✅ | 渲染、炸弹挂点 | 地图根节点，可直接 `scene.add` |
| `world` | `World` | ✅ | 玩家 / Bot 物理、射线 | 必须带 `colliders`（或 `boxes`），且实现 `move` / `raycast` / `lineOfSight` |
| `sites` | `Record<string, {x,z,r}>` | ✅ ≥1 | 回合、雷达 | **键名任意、数量任意**；`r` 是下包判定半径（米） |
| `spawns.player` | `{x,z,yaw?,waypoint?}` | ✅ | 玩家出生 | 玩家 T 方出生点 |
| `spawns.playerCT` | 同上 | ⬜ | 玩家出生 | 缺省回退 `spawns.player` |
| `spawns.allies` | 数组 | ✅ | `game.js` 建 Bot | 玩家为 T 时的 T 队友 |
| `spawns.ctAllies` | 数组 | ✅ | `game.js` 建 Bot | 玩家为 CT 时的 CT 队友 |
| `spawns.bots` | 数组 | ✅ | `game.js` 建 Bot | 玩家为 T 时的 CT 敌人 |
| `spawns.tBots` | 数组 | ✅ | `game.js` 建 Bot | 玩家为 CT 时的 T 敌人 |
| `waypoints` | `{x,z}[]` | ✅（可为空数组） | Bot 巡逻 | 长度任意，Bot 按 `length` 取模 |
| `bounds` | `{minX,maxX,minZ,maxZ}` | ✅ | 雷达缩放、编辑器 | **不参与导航**，仅用于 UI |
| `buyZone` | 同上 | ✅ | `game.js` `inBuyZone()` | 购买区矩形 |
| `callouts` | `Record<string,{x,z}>` | ⬜ | 仅 `dev/devtools.js` | 开发工具传送点枚举 |
| `placed` / `baseCount` / `edits` / `coversAdded` | 任意 | ⬜ | 编辑器 / 调试 | 没有就填 `null` / `0` |

### 地图作者三条硬约束

1. **地面必须有 collider** 覆盖整片可行走区（沙城是 `-52..52 / -44..44` 的大盒）。`NavGrid` 的网格范围就是从这里推出来的，没有地面盒 = 没有导航。
2. **每个包点中心 10 m 内要有可走格**。`NavGrid._nearestOpen` 只吸附 14 环（≈10.5 m）；包点若被实体几何完全包死，Bot 会判定不可达。
3. **0.58 m 以上高台必须有 ≤0.3 m 的台阶**才能被 Bot 走上去（`NAV_STEP_UP = 0.35`）。上不去也没关系——下包判定已放宽到包点半径；但拆包仍要求贴身 1.7 m，炸弹落点必须可达。

## 合成地图 fixture

`tools/map-fixture.mjs`：

- `buildFixtureMap({ size = 64, siteCount = 2 })`：64×64 围墙 + 中央缺口横墙 + 2/3 个包点 + 6 个航点，返回对象字段与 `buildMap()` 完全一致。
- `createArena(map)`：用**真** `Round` + **真** `Bot` 搭一个最小对局壳，只把 `hud` / `player` / `scene` 换成记录器，因此测的是产品代码而不是桩。
- 中央横墙只留 10 m 缺口：A* 必须绕行，能真正验证寻路而不是「直线可达」。

## 边界

| 文件 | 改动 |
|---|---|
| `js/game/round.js` | 包点集合动态化、目标重下发、HUD 文案、下包半径 |
| `js/game/bots.js` | 视野常量、`spawnWaypoint` 兜底、下包到位半径 |
| `tools/map-fixture.mjs` | 新建 |
| `tools/smoke.mjs` | +8 条断言 |
| `collab/tasks/T-011-multi-map.md` | 本卡 |

未触碰 `js/world/map.js`、`js/world/map-oasis.js`、`js/game.js`、`js/ui/hud.js`、`index.html`、`css/`、`js/config/`、`.github/`。

## 验收

`npm run smoke` 65/65 → **73/73**，新增：

1. 合成地图契约与 `map.js` 一致（6 类出生点 / waypoints / callouts 齐全）
2. 合成地图 64×64 且两个包点
3. 合成地图 A* 绕开中墙（44.6 m vs 直线 40.2 m）
4. 合成地图 Bot 走到包点自动下包（落点 (14.2, 8)，在 A 点半径内）
5. 合成地图 CT Bot 拆包并结算（0:1，CT 胜）
6. 三包点地图：site 键与 HUD 标签按地图生成（`A / B / C`）
7. 三包点地图：第三个点能被指派为下包点
8. 三包点地图：换包点后目标跟着改

真实地图的既有断言（Bot 下包 / 拆包 / 加时 / 换边 / 经济 / 战术 / 整场 soak）全部保持通过。
