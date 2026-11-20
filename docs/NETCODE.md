# 联机落点

> 当前骨架是**纯本地模拟**：玩家、Bot、回合状态全在客户端，没有任何网络代码。
> 这份文档说明怎么在不推翻现有结构的前提下接上 Builda Room，以及四个必须改的点。

先把结论说了：**带宽不是瓶颈，抖动才是。**
按 10 人 5v5、10 Hz 快照算，每客户端下行只有 1.4 KB/s，配额是 80 KB/s。
真正的难点是「200 ms 延迟下开枪还能打中」。

---

## 1. 为什么现在的结构适合改联机

`js/game.js` 的主循环已经是最好的形态了：

```js
const STEP = 1 / 64;
this._acc += dt;
while (this._acc >= STEP && steps < 8) {
  this.simulate(STEP);       // ← 固定步长、纯逻辑、可复现
  this._acc -= STEP;
}
this._updateCamera(dt);      // ← 表现层，吃真实帧时间
this.engine.render();
```

`simulate(dt)` 里**没有一处读 `performance.now()`、没有一处读 `Math.random()` 影响状态**
（随机只用在扩散，那是表现层）。这意味着：

- 同样的输入序列 → 同样的结果（可复现）
- 服务端和客户端跑同一份 `simulate()`，结果应该一致
- 回滚重放只需要「回到第 N tick 的状态，重跑 M 步」

**这是刻意设计的。改联机时不要破坏它**：不要在 `simulate()` 里加 `Date.now()`、
不要用 `Math.random()` 决定命中、不要按帧时间做插值。

---

## 2. 目标架构

```
客户端                              服务端（Room）
  │                                     │
  │  input{tick, move, yaw, buttons}    │
  ├─────────────── unreliable ─────────▶│
  │                                     │  权威 simulate(1/64)
  │                                     │  命中裁定
  │  snapshot{tick, entities[]}         │
  │◀────────────── unreliable ──────────┤
  │                                     │
  │  本地预测：立刻跑自己的移动           │
  │  实体插值：别人延迟 100 ms 显示        │
  │  和解：收到快照后对比，偏差大就回滚     │
```

三条通道（`contracts/room-contract.json` 已定义）：

| 通道 | 用途 | 可靠性 |
|---|---|---|
| `control_reliable` | 加入/离开/换图/回合开始 | 可靠有序 |
| `game_reliable` | 击杀确认、购买、下包/拆包、聊天 | 可靠有序 |
| `state_unreliable` | 位置/朝向/血量快照、输入 | 不可靠，丢了就丢了 |

**规则**：位置快照走 unreliable，任何「必须生效」的事件走 reliable。
把开火事件放 unreliable 会导致「打了没反应」，把位置放 reliable 会导致队头阻塞。

---

## 3. 四个必须改的点

### 3.1 `simulate()` 拆成「输入 → 状态」

现在 `Player.update(dt, input, world)` 直接读 `input`。联机后输入来自网络。

改法：把输入抽成一个纯数据对象，`Player` 只认这个对象。

```js
// 当前
player.update(dt, input, world);          // input 是 Input 实例

// 目标
const cmd = { forward: 0, right: 0, jump: false, crouch: false, yaw: 0, pitch: 0 };
player.updateFromCommand(dt, cmd, world);
```

本地玩家：`cmd` 由 `Input` 每 tick 采样一次，同时发给服务端。
远程玩家：`cmd` 从网络包解出来，直接喂给同一个函数。

**这一步不改玩法，只改数据来源。** 先做完这一步再碰网络。

### 3.2 `_hitscan()` 搬到服务端

现在 `game.js` 的 `_hitscan()` 在客户端算命中。联机后必须服务端裁定，
否则改客户端就能穿墙爆头。

```js
// 客户端：只发意图
send({ type: 'fire', tick, origin, dir, spread });

// 服务端：跑同一份 _hitscan()
const hit = hitscan(origin, dir, spread, world, players);
if (hit) applyDamage(hit.playerId, hit.damage, hit.head);
```

服务端需要一份和客户端**完全一样**的 `world`（同一张图的碰撞体）。
建议 `map.js` 的几何数据抽成一个 JSON，客户端和服务端都读它，避免两边不一致。

**反作弊的最低要求**：服务端校验 `origin` 在玩家眼睛位置 ±0.3 m 内、
`dir` 与玩家朝向夹角 < 15°。不做这个校验的话，客户端可以原地打全图。

### 3.3 实体插值

远程玩家不能直接 set 位置，会看到「瞬移」。

```js
// 每个远程实体保留最近 3 个快照，按 100 ms 延迟渲染
const RENDER_DELAY = 0.1;
const t = now - RENDER_DELAY;
const [a, b] = findBracket(snapshots, t);
entity.position.lerpVectors(a.pos, b.pos, (t - a.t) / (b.t - a.t));
entity.yaw = lerpAngle(a.yaw, b.yaw, k);
```

**为什么延迟 100 ms 而不是 0**：网络包到达时间不均匀，延迟 100 ms 可以吃掉大部分抖动。
代价是「你看到的敌人位置比真实位置晚 100 ms」——这就是为什么需要延迟补偿。

### 3.4 本地预测与和解

本地玩家不能等服务端回包才动，那样 200 ms 延迟下完全没法玩。

```
tick N:   本地跑 simulate() → 位置 P_N，把 (N, cmd_N, P_N) 存进 history
tick N+1: 服务端快照到，说「N-3 tick 你的位置是 P'_N-3」
          对比 P_N-3 和 P'_N-3：
            偏差 < 0.05 m → 忽略（正常浮点误差）
            偏差 ≥ 0.05 m → 把状态设成 P'_N-3，重放 N-2..N 的 cmd
```

`history` 只需要保留最近 **1 秒**（64 个 tick）。再多没意义，因为超过 1 秒的偏差
说明网络已经烂到该显示「重连中」了。

---

## 4. 带宽账（先算清楚再写代码）

### 4.1 快照大小

一个玩家的状态：

| 字段 | 字节 | 说明 |
|---|---|---|
| id | 1 | 房间内序号，≤50 人够用 |
| x, y, z | 6 | 三个 int16，精度 1/128 m（±256 m 范围） |
| yaw | 2 | uint16，精度 0.0055° |
| pitch | 2 | int16，精度 0.0055° |
| hp | 1 | 0–100 |
| flags | 1 | 蹲/走/死亡/下包中，位域 |
| **小计** | **13** | |

10 人 = 130 字节。加帧头（14 字节）+ 类型（2）+ tick（4）≈ **150 字节/帧**。

### 4.2 每秒流量

| 项 | 计算 | 结果 |
|---|---|---|
| 下行（10 Hz 全量） | 150 × 10 | **1.5 KB/s** |
| 下行（配额） | — | 80 KB/s |
| 占用率 | 1.5 / 80 | **1.9%** |
| 上行（输入 20 Hz × 10 字节） | 200 | **0.2 KB/s** |
| 上行（配额） | — | 20 KB/s |
| 占用率 | 0.2 / 20 | **1%** |

**结论：即使 50 人房间全量广播，下行也只有 7.5 KB/s，占配额 9%。**
带宽完全不是问题，不需要做增量压缩、不需要做兴趣管理（AOI）。

**不要提前优化这个。** 做 delta 压缩会让调试变难十倍，而收益是 1.9% → 0.3%，
在配额面前毫无意义。

### 4.3 真正的瓶颈

| 问题 | 影响 | 对策 |
|---|---|---|
| 抖动（jitter） | 敌人位置一顿一顿 | 100 ms 渲染延迟 + 插值 |
| 延迟（RTT 80–200 ms） | 打不中移动目标 | 延迟补偿（回溯命中） |
| 丢包（1–5%） | 偶尔瞬移 | 快照带 tick，丢了用下一个 |
| 队头阻塞 | reliable 通道一个包丢了全卡 | 位置绝不走 reliable |

---

## 5. 服务端代码结构

`server/room/` 下放一个 `.ts` 文件（平台只收单文件，≤16 MB）。

```ts
// server/room/sandline.ts —— 骨架，不是可运行代码
import { Room, Player } from '@cysj/room';

const TICK = 1 / 64;          // 和客户端一致，不要改
const SNAPSHOT_HZ = 10;       // 快照频率，和 tickRate 一致

interface PlayerState {
  id: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  hp: number; alive: boolean;
  lastCmdTick: number;
}

const players = new Map<number, PlayerState>();
let tick = 0;

export function onJoin(room: Room, p: Player) {
  players.set(p.id, spawnFor(p.id));
  room.send(p.id, 'control_reliable', { type: 'welcome', tick, you: p.id });
}

export function onMessage(room: Room, p: Player, ch: string, msg: any) {
  if (msg.type !== 'cmd') return;
  const s = players.get(p.id);
  if (!s || msg.tick <= s.lastCmdTick) return;   // 丢弃重复/过期
  // 校验：位移速度不能超过 runSpeed * 1.1
  applyCommand(s, msg, TICK);
  s.lastCmdTick = msg.tick;
}

export function onTick(room: Room) {
  tick++;
  if (tick % (64 / SNAPSHOT_HZ) !== 0) return;
  const snap = serialize([...players.values()], tick);
  room.broadcast('state_unreliable', snap);       // 一次广播给全房
}
```

**关键点**：

- `room.broadcast()` 一次发给全房，不要循环 `send_to_user`（50 人循环会超 `host_commands_per_callback = 256`）
- `SNAPSHOT_HZ` 要和 `builda.online.json` 的 `tickRate` 对齐，否则会有「快照抖动」
- 每个回调有 fuel 和输出字节上限（`host_output_bytes_per_callback = 1 MB`），
  单帧 150 字节 × 50 人 = 7.5 KB，远没到上限

---

## 6. 分四步上线，每步都可玩

不要一次做完。每一步都能独立发布、独立验证。

| 步骤 | 做什么 | 工期 | 验证 |
|---|---|---|---|
| **S1** | 抽 `Command` 对象，`Player.updateFromCommand()`，本地单人仍可玩 | 2 天 | `npm run smoke` 通过，手感无变化 |
| **S2** | Room 跑服务端权威移动，客户端只发 cmd + 插值显示别人 | 5 天 | 两个人能互相看见对方走 |
| **S3** | 命中搬到服务端，加延迟补偿（回溯 200 ms） | 4 天 | 200 ms 延迟下打移动靶命中率 > 70% |
| **S4** | 回合状态同步、购买同步、下包/拆包同步、重连恢复 | 5 天 | 一局 5v5 打完不掉线、不重复计分 |

**S3 的延迟补偿**是最容易做错的一步。做法：

1. 服务端保留最近 1 秒的**所有玩家位置历史**（每 tick 一份，64 份）
2. 客户端开火时带上 `renderTick`（它渲染的是哪个 tick 的世界）
3. 服务端把敌人的碰撞体**回溯**到 `renderTick` 的位置，再做射线

不做这个的话，200 ms 延迟下打横向移动的敌人会「明明打中了却没伤害」。

---

## 7. 六个坑

### 坑 1：客户端和服务端的 `world` 不一致

两张图差一个掩体，就会出现「服务端说打中了墙」。
**对策**：地图几何抽成 JSON，两边读同一份，版本号写进 `onlineCompatibilityRevision`。

### 坑 2：`tickRate` 和模拟步长不一致

Room 的 `tickRate: 10` 是**逻辑帧**，但模拟是 64 Hz。
一个 Room tick 里要跑 6.4 个模拟步——不能整除。

**对策**：服务端按 `tickRate` 收包，但内部按 1/64 跑模拟；
或者把 `tickRate` 提到 20（每 tick 跑 3.2 步），或者干脆自己累加时间。

**最省事的做法**：服务端也用累加器（和 `game.js` 的 `_acc` 一样），
`tickRate` 只决定「多久发一次快照」。

### 坑 3：浮点不一致

不同设备的 `Math.sin` / `Math.cos` 可能有 1 ulp 差异。
64 tick 后位置会漂几厘米。

**对策**：位置在网络上传输时量化到 1/128 m。客户端预测和解时用 0.05 m 容差，
不要用 `===` 比较浮点。

### 坑 4：把「开火」放 unreliable

丢一个包就少一发子弹。玩家会觉得「枪卡了」。

**对策**：开火事件走 `game_reliable`，位置快照走 `state_unreliable`。

### 坑 5：重连后状态全丢

玩家断线 10 秒回来，血量、金钱、武器全没了。

**对策**：用 `roomTransfer` 的 checkpoint 机制（`builda.online.json` 已配
`snapshotSchemaVersion: 1`、`failureRecovery: "latest-checkpoint"`）。
玩家状态进 checkpoint，重连时恢复。

### 坑 6：在 `simulate()` 里读 `Math.random()`

现在扩散用了随机数，但那只影响**射线方向**，不影响权威状态。
联机后如果服务端和客户端各自随机，同一发子弹会算出不同结果。

**对策**：随机种子由服务端下发，客户端用同一个种子跑同一个 PRNG。
或者更简单：扩散只在客户端做表现，服务端用「必中/不中」的裁定结果。

---

## 8. 现在就可以做的准备（不改玩法）

这三件事今天做，以后接联机时能省一周：

1. **给 `simulate()` 加 tick 计数**：`this.tick = 0;` 每步 `this.tick++`。
   后面所有网络包都要带 tick。
2. **把 `_hitscan()` 的随机扩散抽成参数**：`_hitscan(spread, rng)`，
   `rng` 默认 `Math.random`，联机时换成种子 PRNG。
3. **给 `Player` 加 `serialize()` / `deserialize()`**：13 字节的二进制编解码，
   现在写了以后直接能用。

这三件事都不改变现有行为，`npm run smoke` 仍然通过。

---

## 9. 联机之前先问自己

- 单人对 Bot 好玩吗？如果不好玩，联机只会放大问题
- 5v5 需要 10 个真人同时在线，冷启动怎么办？（计划书的降级路径：5v5 → 3v3 → 1v1 → 合作 Bot）
- 服务端权威意味着**所有**命中判定都在服务端，服务器成本谁付？

**建议**：先把单人对 Bot 做到「愿意连打 10 局」，再考虑联机。
骨架现在的水准是「能跑通流程」，离「愿意连打」还有美术和手感两关。
