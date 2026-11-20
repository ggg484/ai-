# 架构

三层：**平台层**（唯一对外通道）→ **模拟层**（纯数据，可复现）→ **表现层**（渲染 + DOM）。
模拟层不认识 three.js 以外的任何东西，也不认识 DOM。

---

## 1. 模块图

```
                        ┌──────────────────────────┐
                        │  index.html (DOM 骨架)    │
                        │  HUD / 触屏层 / 面板       │
                        └────────────┬─────────────┘
                                     │ id 选择器
   ┌─────────────────────────────────┼──────────────────────────────┐
   │                                 ▼                              │
   │  js/main.js   ── ready() ──▶  new Game(canvas)                 │
   │                  ▲                                             │
   │                  │ await Builda.runtime.ready()  ← 必须第一句    │
   │                                 │                              │
   │  ┌──────────────────────────────▼───────────────────────────┐  │
   │  │  js/game.js  Game（编排）                                  │  │
   │  │                                                          │  │
   │  │  _loop()  ──固定步长 1/64──▶ simulate(dt)                 │  │
   │  │                              ├─ player.update()           │  │
   │  │                              ├─ weapon.update()           │  │
   │  │                              ├─ _handleCombat()           │  │
   │  │                              │    └─ _hitscan()          │  │
   │  │                              ├─ bot.update() ×5           │  │
   │  │                              ├─ round.update()            │  │
   │  │                              └─ _updateEffects()          │  │
   │  │           ──真实帧时间──▶ _updateCamera(dt) / _updateHud(dt)│  │
   │  └───┬────────┬────────┬────────┬────────┬────────┬─────────┘  │
   │      │        │        │        │        │        │            │
   │      ▼        ▼        ▼        ▼        ▼        ▼            │
   │  render/  world/   player/   game/    ui/     config/          │
   │  engine   map      control  bots     hud     weapons          │
   │  viewmodel collision weapon  round                            │
   │           textures                                            │
   │                                                               │
   │  core/input  core/audio  platform/builda  ← 被上面各处调用      │
   └───────────────────────────────────────────────────────────────┘
```

依赖方向是单向的：`config` 和 `platform` 不 import 任何业务模块；
`game.js` 是最上层，只有它同时认识所有模块。

---

## 2. 一帧的完整顺序

```
requestAnimationFrame(now)
  dt = min(0.1, (now - last) / 1000)          ← 真实帧时间，防止切后台回来跳帧
  acc += dt
  while (acc >= 1/64 && steps < 8) {          ← 最多 8 步，防死亡螺旋
      simulate(1/64)
      acc -= 1/64
  }
  if (steps >= 8) acc = 0                     ← 追不上就丢弃欠账
  _updateCamera(dt)                           ← 相机跟随、后坐力抖动、FOV
  engine.render()
  _updateHud(dt)                              ← 10 Hz 刷 HUD，0.5 Hz 刷 fps
```

`simulate(dt)` 内部顺序**不能随意调**：

| 顺序 | 为什么 |
|---|---|
| `player.update()` | 先定位置和朝向，后面所有射线都基于它 |
| `weapon.update()` | 射速/换弹计时，必须在开火判定之前 |
| `_handleCombat()` | 玩家输入 → 射线 → 伤害 |
| `bot.update()` | Bot 要看到玩家**这一帧**的位置 |
| `round.update()` | 胜负判定要看这一帧的死亡状态 |
| `_updateEffects()` | 纯表现，最后 |

`roundEnding` 为真时提前 return，只跑 `round.update()` 和特效——这样结算期间玩家和 Bot 都冻结。

---

## 3. 各模块职责与接口

### 3.1 `platform/builda.js` —— 平台唯一出口

```js
hasHost                       // 布尔，宿主存在与否
await ready()                 // Builda.runtime.ready()
await whoami()                // { id, name }，无宿主返回 { id:'local', name:'本地玩家' }
applySafeArea()               // 写 CSS 变量 --safe-top/right/bottom/left
await kvGet(key) / kvSet(key, text)   // 单值 ≤32 KB，≤100 key
defaultSettings()             // { sensitivity:1, invertY:false, fov:90, quality:'medium' }
await loadSettings() / saveSettings(s)
onPauseChange(cb)             // cb(paused)，已合并 appVisibility 与 pausePanel
await playSfx(name, opts)     // → audio/sfx/<name>.ogg
vibrate(level)                // 0/1/2
keepScreenOn(on)
```

**纪律**：业务代码只 import 这个模块，不碰 `window.Builda`。
新增平台能力时，在这里加一个函数 + 降级分支，别在业务里写 `if (hasHost)`。

### 3.2 `world/collision.js` —— AABB 世界

```js
new World(colliders)          // colliders: [{minX,minY,minZ,maxX,maxY,maxZ,tag}]
world.add(c)
world.overlaps(minX,minY,minZ,maxX,maxY,maxZ, ignoreTag)
world.move(pos, vel, dt, radius, height, stepHeight, grounded) → grounded
world.supportAt(x, y, z, radius) → 支撑面高度
world.raycast(ox,oy,oz, dx,dy,dz, maxDist, ignoreTag) → {t,x,y,z,nx,ny,nz,tag} | null
world.lineOfSight(ax,ay,az, bx,by,bz) → bool
raySphere(...) / rayBox(...)   // 独立工具函数，Bot 命中判定用
```

`move()` 是核心：**0.14 m 子步**逐轴推进，每步先试抬升（台阶）+ 再水平推进 + 最后地面吸附。
不这么做的话，速度 5 m/s 在 1/64 s 里走 0.078 m，斜着撞薄墙会穿过去。

**扩展点**：现在只有 AABB。要支持斜面/圆柱，加一个 `colliders` 类型分支到 `raycast()` 与 `overlaps()`，
不要改 `move()` 的调用签名——`Player` 和 `Bot` 都依赖它。

### 3.3 `player/controller.js` —— 移动

```js
player.update(dt, input, world)
player.eye(out)               // 眼睛位置（含 bob）
player.aimDir(out)            // 归一化视线方向
player.viewYaw() / viewPitch()  // 含后坐力偏移
player.applyRecoil(pitchDeg, yawDeg)
player.damage(amount)         // 护甲吸收 50%
```

Source 式移动的三段：**摩擦 → 加速 → 重力**。摩擦用 `max(speed, stopSpeed) * friction * dt`，
`stopSpeed` 保证低速时也能停下来而不是无限滑。

触屏 analog：`maxSpeed *= |axis|`，推杆半程 ≈ 静步 2.5 m/s。键盘时 `|axis| = 1`。

**扩展点**：滑铲、蹬墙跳、梯子都加在 `update()` 里。梯子需要 `world` 提供 `volume` 查询，
建议加 `world.volumes` 而不是往 `colliders` 里塞。

### 3.4 `player/weapon.js` —— 射击

```js
weapon.update(dt)             // 射速冷却、换弹计时
weapon.fire() → { spread, recoilPitch, recoilYaw } | null
weapon.canFire() → bool
weapon.startReload() → bool
weapon.spread() → number      // 基础 + 连射 bloom + 移动惩罚
weapon.reloadProgress         // 0..1，给动画用
weapon.addAmmo() / refill()
```

`fire()` 返回的是**这一发的**扩散和后坐力增量，由 `game.js` 施加到玩家和 HUD。
武器本身不碰相机、不碰射线——这是刻意的，方便以后交给服务端裁定。

### 3.5 `game/round.js` —— 回合状态机

```
FREEZE (12s) ──▶ LIVE (100s) ──▶ PLANTED (40s) ──▶ ENDED (4s) ──┐
   ▲  买枪/不能开火    ▲  下包成功        ▲  爆炸/拆包          │
   └────────────────────────────────────────────────────────────┘
                       下一回合 round++
```

```js
round.start()                 // 重置玩家/Bot/武器，进入 FREEZE
round.update(dt)              // 计时推进、下包判定、爆炸判定、结算延时
round.siteAt(x, z)            // 返回所在包点或 null
round.plant(site, pos)        // 生成炸弹、+$300、切 PLANTED
round.end(win, reason)        // 计分、发钱、显示结算页
```

**扩展点**：半场交换、加时、连败补偿都改这里。`PHASE` 加值时要同步 `game.js` 里
`phase !== LIVE && phase !== PLANTED` 的判断，否则新阶段会误判成"不能开火"。

### 3.6 `game/bots.js` —— Bot

```js
bot.update(dt, player, waypoints, { onBotShoot })
bot.hitTest(ox,oy,oz, dx,dy,dz, maxDist) → { t, head, bot } | null
bot.damage(amount, head) → killed
bot.reset() / bot.eye(out)
```

状态机只有两态：`patrol`（沿路点走）和 `engage`（看见玩家 → 保持 8–20 m → 横移 → 反应延迟后点射）。
`hitTest` 先测头部球（r=0.17 @ y=1.62）再测身体 AABB，取近者。

**扩展点**：加 `seek/plant/defuse/retreat` 状态，加视野锥和听觉（枪声半径）。
路点在 `map.js` 的 `waypoints` 里，加导航图的话建议新建 `world/nav.js`，别塞进 `bots.js`。

### 3.7 `ui/hud.js` —— HUD

纯 DOM，不用 canvas 画 HUD（除了雷达）。所有 `setXxx()` 都是幂等的，
`_updateHud()` 每 0.1 s 全量刷一遍，不做 diff——DOM 写入量很小，不值得优化。

```js
hud.setVitals(hp, armor) / setMoney(n) / setAmmo(a, r) / setWeapon(name, a, r, slot)
hud.setScore(t, ct) / setRound(n) / setTimer(sec) / setPhase(text) / setObjective(text)
hud.setPlant(p, visible) / setBomb(on) / setBombTimer(t) / setCrosshairGap(px)
hud.hitmarker(kill) / flashDamage(s) / killfeed(text) / toast(text)
hud.showStart(on) / showBuy(on) / showSettings(on) / showPause(on) / showHud(on)
hud.showRoundEnd(win, reason) / hideRoundEnd()
hud.renderBuy(money, canBuy) / drawRadar(map, player, bots, bomb)
```

**扩展点**：计分板（Tab）在 `input.js` 里已有 `scoreboard` 动作但没接 HUD，见 `TASKS.md` P1-1。

### 3.8 `render/engine.js` / `render/viewmodel.js` —— 表现

`Engine` 持有 renderer / scene / camera / 光照 / 天空。`setQuality('low'|'medium'|'high')`
控制 dpr 上限（1/2/3）、阴影开关、阴影图尺寸（关/1024/2048）。

`Viewmodel` 用固定 `basePos/baseRot` 把程序化几何摆在相机前，`update()` 里加
摇摆、呼吸、后坐力位移、换弹位移。**所有部件 `depthTest:false`**，枪不会穿墙。

---

## 4. 数据流：一次开火

```
鼠标左键 → Input.held.fire = true, pressed.add('fire')
  ↓
simulate(1/64) → _handleCombat()
  ↓  阶段门禁：只有 LIVE/PLANTED 才继续
  ↓  weapon.fire() → { spread, recoilPitch, recoilYaw }
  ├─ player.applyRecoil()      视角上抬（recoilPitch，之后按 dt*7.5 衰减回 0）
  ├─ viewmodel.onFire()        枪身后坐 + 枪口火光 + 点光源
  ├─ audio.play('shot_rifle')
  ├─ hud.setAmmo()
  └─ _hitscan(spread)
        ├─ origin = player.eye()，dir = player.aimDir() + 随机扩散
        ├─ world.raycast()            → 墙面命中点
        ├─ bot.hitTest() × N          → 敌人命中点（取最近的）
        ├─ 距离衰减 1 - min(0.35, t/range*0.35)
        ├─ bot.damage(dmg, head)      → 头部 ×4
        └─ _spawnTracer() / _spawnImpact()
```

**为什么要走这条链**：射线只发一次，墙面和敌人一起比距离，避免"隔着墙打到人"。
以后接服务端时，把 `_hitscan()` 整个搬到服务端，客户端只发 `{origin, dir, tick}` 即可，
接口不用改。

---

## 5. 五个扩展点（按改动成本排序）

| 扩展点 | 文件 | 成本 | 说明 |
|---|---|---|---|
| 加数值 / 加一把枪 | `config/weapons.js` + `viewmodel.js` 分支 | 低 | 纯数据 |
| 加 HUD 元素 | `index.html` + `css/game.css` + `hud.js` | 低 | 纯 DOM |
| 换材质 | `world/textures.js` 的 `material()` | 中 | 见 `ART-PIPELINE.md` |
| 换地图 | `world/map.js` | 中 | 见 `MAP-SPEC.md` |
| 接联机 | `game.js` 的 `simulate()` | 高 | 见 `NETCODE.md` |

反向的、**不要做**的扩展：

- 不要给 `Game` 加更多状态字段。它已经有 40 多个，再加就该拆 `Match` / `Combat` 了。
- 不要在 `hud.js` 里放游戏逻辑。HUD 只读数据、只写 DOM。
- 不要让 `Bot` 直接调 `hud` 或 `audio`。走回调（`onBotShoot`）或者由 `game.js` 转发。

---

## 6. 命名与风格约定

- 私有方法前缀 `_`（`_hitscan`、`_spawnTracer`）
- 导出的类用大驼峰（`Player`、`Round`），工具函数用小驼峰（`raySphere`）
- 常量全大写（`STEP`、`PHASE`、`WEAPONS`、`MOVEMENT`）
- 单位：距离米、时间秒、角度弧度（`applyRecoil` 收度数，内部转弧度）
- 坐标：Y 向上，玩家朝 `+Z`（`yaw=0` 看向 +Z），相机 yaw 要 `+Math.PI` 修正
- 注释写「为什么」，不写「是什么」。`// i++` 这种不要写。
