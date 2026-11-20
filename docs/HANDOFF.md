# 交接说明

> 你接手的是一个**能跑通完整回合**的灰盒射击游戏，不是一个空壳脚手架。
> 这一页的目标：**30 分钟内你能跑起来并提交第一行改动**，且不改坏已经验证过的东西。

---

## -1. 开工前必须先接受的两条准则

在写任何代码之前，先读完 [`PRINCIPLES.md`](PRINCIPLES.md)。它只有两条，但都不可协商：

| 准则 | 一句话 | 违反的后果 |
|---|---|---|
| **移动端是最高准则** | 每个功能都必须有移动端实现；先设计触屏，再设计键鼠；性能基线是中端手机而不是开发机 | 出现"只有 PC 能玩"的功能 → 直接返工 |
| **质量优先** | 可以耗时间，不许糙。工期不够就砍范围，不砍质量 | 粗糙的资产进包 → 皮肤卖不动 → 项目死 |

并且要读 [`SKIN-PIPELINE.md`](SKIN-PIPELINE.md)：**这个游戏靠枪皮、刀皮营收**，
所以第一人称视角模型（`js/render/viewmodel.js`）不是"占位随便做做"的模块，
它是全项目商业价值最高的一块屏幕区域。骨架里它是程序化几何，这是 M0 的临时状态，
**M2 必须换成真模型**。

如果这两条和后面的任何内容冲突，以准则为准。

---

## 0. 一句话现状

`index.html` 直接加载 ES 模块，无构建步骤。打开网页**直接落在 3D 军械大厅**：
数百名玩家、四个典藏展位、西侧藏品墙、东侧三条靶道、战术道具展台、左右传送门。
走近藏品墙按 `E` 试穿枪皮/刀皮；左上「作战传送」或走进西北传送门选模式；
对局仍是 12 秒买枪 → 100 秒对枪 → 包点下包 → 40 秒爆炸结算 → 下一回合。

跑通的部分是**大厅 + 手感内核 + 回合闭环 + 平台链路 + 3D 检视**；
缺的是**真 GLB/KTX2 资产、投掷道具玩法、拆包、联机、音频资产**。
付费体系**一行都没写**，规划在 `MONETIZATION-PLAN.md`，等拍板。
本轮 60 轮 / 86 项视觉优化见 [`VISUAL-PASSES.md`](VISUAL-PASSES.md)。

---

## 1. 三十分钟上手

按顺序做，不要跳。

| 分钟 | 做什么 | 你应该看到 |
|---|---|---|
| 0–3 | `npm run dev`，浏览器开 `http://localhost:5173` | 直接进入军械大厅；左下角玩家卡显示「本地玩家」 |
| 3–6 | 点左上「作战传送」选经典爆破，或走进西北传送门 | 进入对局；WASD 走、鼠标看、左键打 |
| 6–9 | 按 `B` 买 AK（$2700，起始只有 $800，先打一个回合攒钱） | 购买面板出现，买完 HUD 换 `AK-47 30/90` |
| 9–12 | 走到 A 点（雷达右侧圆）站进去，按住 `E` 3.2 秒 | 屏幕中央出现下包进度条；松手会退 |
| 12–15 | 开 `?cam=top` 刷新 | 俯瞰整张图，看清 A 大 / 中门 / B 洞三条线 |
| 15–18 | 读 `js/game.js` 的 `simulate()`（30 行） | 理解主循环顺序：玩家 → 武器 → 战斗 → Bot → 回合 → 特效 |
| 18–22 | 读 `js/config/weapons.js`（84 行，全是数字） | 手感数值全在这一个文件，改完刷新就生效 |
| 22–26 | 改 `MOVEMENT.runSpeed` 5.0 → 7.0，刷新走两步 | 明显变快。改回去 |
| 26–30 | `npm run pack && bash .builda-agent/builda bundle-check --engine h5 builda-web.zip` | 全绿：`bundle=ok / sdk-injected=ok / bundle-zip-bytes≈213000` |

30 分钟结束你应该已经具备：**改数值 → 看效果 → 打包自检** 的完整回路。

---

## 2. 交接边界：什么可以信，什么要重写

这是最重要的一节。不要平均用力。

### 可以直接建在上面的（已验证，接口稳定）

| 模块 | 为什么可信 |
|---|---|
| `js/platform/builda.js` | SDK 调用全部收敛在这，含无宿主降级。业务层不许直接碰 `window.Builda` |
| `js/world/collision.js` | 扫掠 AABB + 子步 + 台阶 + 地面吸附 + 射线，实测 200 帧不穿墙、不卡角 |
| `js/player/controller.js` | Source 式加速/摩擦/急停/空中控制，参数可逐项对照原版调 |
| `js/game/round.js` | 状态机闭环验证过：`freeze → live → planted → ended → 下一回合` |
| `js/core/input.js` | 键鼠 + 指针锁定 + 触屏摇杆/拖动/按钮，两套输入同一套 `axis()/isDown()/consumePressed()` |
| `scripts/pack.mjs` | 自带包规范自检（SDK 引用、SDK 不入包、禁带文件） |
| `js/render/engine.js` | 渲染器/相机/光照/天空/画质档位，`setQuality('low'|'medium'|'high')` 已接设置面板 |

### 是占位，等着被替换的（别在它上面加功能）

| 模块 | 现状 | 替换方式 |
|---|---|---|
| `js/render/viewmodel.js` | 第一人称挂点 + 后坐/换弹 + 皮肤，模型来自 `weapon-models.js` | 换 glTF 时只替换 `weapon-models.js` 的构建函数 |
| `js/render/weapon-models.js` | 8 把程序化枪械（挤出截面 + 倒角 + 零件级 UV 盒投影） | 最终换 GLB 高模 + KTX2，见 `docs/ART-PIPELINE.md` §4 |
| `js/render/prop-models.js` | 8 种战术道具的程序化模型（检视/展台用） | 最终换 GLB + 真实标签贴图 |
| `js/render/photo.js` | 3D 检视摄影棚（程序化 PMREM 柔光箱） | 可换真实 HDR |
| `js/world/textures.js` | Canvas 画的沙/砖/混凝土 | 换成 KTX2 贴图，见 `docs/ART-PIPELINE.md` §2 |
| `js/world/map.js` | AABB 盒子 + 立面/集装箱/吊灯等细部 | 换成正式关卡，见 `docs/MAP-SPEC.md` |
| `js/core/audio.js` | 无宿主时 WebAudio 合成音 | 放 `assets/sfx/*.ogg`，走平台 `playSFX` |
| `js/game/bots.js` | 会走会打但不会拆包/不会配合 | 见 `docs/TASKS.md` P1-3 |
| 全部 UI 文案 | 硬编码中文 | 见 `docs/TASKS.md` P2-1 |

### 刻意留空的（有 TODO 标记）

```
grep -rn "TODO" js/
```

`round.js` 顶部列了：半场交换、加时、Bot 拆包、包点封锁、连败补偿曲线。
这些不是忘了做，是**故意留给你**，因为它们的正确做法依赖你的产品判断。

---

## 3. 代码地图：想做 X，改哪里

| 想做的事 | 改这里 | 关键函数/字段 |
|---|---|---|
| 调枪的手感 | `js/config/weapons.js` | `WEAPONS.ak.damage / rpm / spread / recoil` |
| 调移动手感 | `js/config/weapons.js` | `MOVEMENT.*` |
| 调经济 | `js/config/weapons.js` | `ECONOMY.*`、`BUY_ITEMS` |
| 加一把枪 | `js/config/weapons.js` + `js/render/viewmodel.js` | 加 `WEAPONS.xxx`，`Viewmodel._buildRifle/_buildPistol` 里加分支 |
| 改命中判定 | `js/game.js` | `_hitscan()`、`js/game/bots.js` `hitTest()` |
| 改回合流程/加阶段 | `js/game/round.js` | `PHASE`、`update()`、`end()` |
| 改 Bot 行为 | `js/game/bots.js` | `update()` 里的 `patrol / engage` 分支 |
| 改地图 | `js/world/map.js` | `box()` 调用、`waypoints`、`sites`、`buyZone` |
| 加 HUD 元素 | `index.html` + `css/game.css` + `js/ui/hud.js` | `Hud` 的 `setXxx()` |
| 改触屏按钮 | `index.html` 的 `[data-act]` + `js/core/input.js` | `_bindTouch()`、`KEYMAP` |
| 加音效 | `assets/sfx/` + `js/core/audio.js` | `audio.play(name)` |
| 加设置项 | `js/platform/builda.js` `defaultSettings()` + `js/ui/hud.js` `_bindSettings()` | |
| 接联机 | `js/game.js` `simulate()` | 见 `docs/NETCODE.md` |

**一条纪律**：任何平台能力（存档、音频、震动、安全区、暂停、whoami）**只能**从
`js/platform/builda.js` 出去。业务代码里出现 `window.Builda` 就是 bug。

---

## 4. 五个会咬人的坑

### 坑 1：主循环是固定步长，不要在里面用 `dt` 读真实时间

```js
// js/game.js
const STEP = 1 / 64;
while (this._acc >= STEP && steps < 8) { this.simulate(STEP); ... }
```

`simulate(dt)` 里的 `dt` **永远是 0.015625**。这是为了联机可复现。
渲染插值、相机跟随、HUD 刷新放在 `_updateCamera(dt)` / `_updateHud(dt)`，那里才是真实帧时间。

### 坑 2：`consumePressed()` 是一次性的

```js
if (input.consumePressed('fire')) { ... }   // 读到就清空
```

同一个动作在同一 tick 读两次，第二次拿到 `false`。开火用的是
`consumePressed('fire')`（单发）和 `isDown('fire')`（连发）的组合，见 `_handleCombat()`。改之前先看懂那段。

### 坑 3：购买阶段不能开火，这条有测试守着

```js
if (this.round.phase !== PHASE.LIVE && this.round.phase !== PHASE.PLANTED) {
  input.consumePressed('fire');   // 吃掉这个按键，否则会残留到下一阶段
  return;
}
```

删掉 `consumePressed` 这行会导致：冻结时间按左键，进入 live 的瞬间自动开一枪。

### 坑 4：视角模型的相机

`Viewmodel` 的部件全部 `depthTest: false, depthWrite: false, renderOrder: 1000`，
所以枪永远画在最前面、不穿墙。**如果你换成 glTF 模型，必须保留这个设置**，否则贴墙时枪会插进墙里。

另外 `muzzlePosition()` 里有一句 `updateWorldMatrix(true, false)`，
少这句枪口火光会跑到世界原点。这不是冗余代码。

### 坑 5：`?dpr=N` 必须在渲染器创建前生效

`mobile-perf.js` 用 `Object.defineProperty` 改写 `window.devicePixelRatio`，
它必须在 `new Engine()` 之前执行。`index.html` 里它排在 SDK 之后、`main.js` 之前——
**不要调整 `<head>` 里这三个 script 的顺序**。

---

## 5. 三条不可协商的平台规则

违反任何一条，包会被拒或者线上直接黑屏。

1. **`Builda.runtime.ready()` 必须是入口第一句。** 现在在 `js/main.js` 第 5 行，`ready()` 是模块里第一个执行的语句，早于 `new Game()` 和任何资源加载。30 秒不握手宿主强关游戏。
2. **不要自己做静音开关。** 平台统一管音频。设置面板里现在只有灵敏度/FOV/画质三项，是刻意的。
3. **`builda-sdk.js` 不能进 zip。** 宿主注入。`scripts/pack.mjs` 有自检，但如果你手动打包就会漏。

完整清单见 [`PLATFORM-RULES.md`](PLATFORM-RULES.md)。

---

## 6. 第一个可交付任务（建议从这里开始）

不要从「加手雷」或「接联机」开始，那两件事都依赖下面这个。

### 任务：把灰盒材质换成第一版真材质（A 大一面墙）

**为什么先做这个**：它是所有美术工作的模板。做完一面墙，剩下的墙是复制粘贴；
而且它会一次性把「纹理管线 + 包体核算 + 移动端显存」三个未知数全部探明。

落点：

1. 读 `docs/ART-PIPELINE.md` §2，按里面的规格产出一张 1024×1024 的沙岩墙面 KTX2
2. 放到 `assets/textures/wall_sandstone.ktx2`
3. 改 `js/world/textures.js` 的 `material('brick')` 分支：优先加载真贴图，加载失败回落到现在的 Canvas 版本
4. `npm run pack`，看 `bundle-zip-bytes` 涨了多少
5. 手机（或 Chrome DevTools 设备模拟 + 4x CPU 降速）跑一遍，看 fps 掉多少

**验收**：A 大那面墙近看有砂砾和勾缝细节、远看没有明显重复接缝；包体涨幅 < 2 MB；帧率下降 < 3 fps。

**这个任务会逼你搞懂**：KTX2 怎么进包、UV 怎么按面尺寸缩放（`map.js` 的 `scaleBoxUV()`）、
移动端纹理预算怎么算。这三件事是后面所有美术工作的前提。

其余任务按优先级排在 [`TASKS.md`](TASKS.md)，每条都有文件、函数、验收标准。

---

## 7. 第一周建议排法

| 天 | 目标 | 产出 |
|---|---|---|
| D1 | 上手 + 跑通 smoke | 能改数值看效果，`npm run smoke` 通过 |
| D2–D3 | 上面那个「一面墙」任务 | 纹理管线跑通，包体/帧率有实测数字 |
| D4–D5 | 把 A 点整体换成真材质 + 真光照 | 一个能截图的「垂直切片」角落 |
| D6 | 拿这个角落去对比原版截图，记录差距清单 | 差距清单（进 `TASKS.md`） |
| D7 | 决定下一步：继续美术 or 先补玩法（手雷/拆包） | 一个决定 + 更新后的排期 |

**不要在 D1 就动 `game.js`。** 593 行里每一段都有存在理由，先读懂再改。

---

## 8. 怎么证明你没改坏

三道闸，每改一块就跑一次：

```bash
# 1. 冒烟：无头跑一遍主流程，断言移动/射击/击杀/下包/结算
npm run smoke

# 2. 包规范：平台硬校验
npm run pack && bash .builda-agent/builda bundle-check --engine h5 builda-web.zip

# 3. 性能基线：draw call 不应该涨
#    浏览器开 ?stats=1，控制台看 [stats] calls=48 tris=5932
```

当前基线，抄在这里方便对比：

| 指标 | 基线值（v0.6） | 超过多少算退化 |
|---|---|---|
| draw call（对局） | 92 | > 100 要解释原因 |
| draw call（大厅，436 人） | 89 | > 130 要解释原因 |
| 三角形（对局） | 63,610 | > 80k 要解释原因 |
| 三角形（大厅，436 人） | 108,518 | > 140k 要解释原因（`PRINCIPLES.md` §1.4） |
| zip 体积 | 0.74 MB | > 5 MB 要解释原因 |
| 模拟步长 | 1/64 s | 不要改，联机要复现 |

> v0.4 已把大厅作为默认入口；`?autostart=1` 仍直接开对局，冒烟测试不受影响。
> 付费体系本轮未实现，见 `MONETIZATION-PLAN.md`。

---

## 9. 关于那份立项计划书

[`plan/沙城协议_立项计划书_v0.1.md`](plan/沙城协议_立项计划书_v0.1.md) 里有完整的产品定义、9 把枪的数值表、
材质清单、45 MB 包体预算表、M0–M6 排期（约 101 人日）、风险登记册。

**读它的方式**：把它当「为什么这么设计」的答案库，不要当施工图。
施工图是 `TASKS.md`。两份文档冲突时，以代码现状为准，然后回来更新文档。

计划书里那条「低多边形是最后保底、非紧急不得启用」的硬触发条件仍然有效：
首包 > 150 MiB 且拆包两轮仍超限，或中端机 p95 帧时间 > 33 ms 且两轮优化无效。
**现在包体 0.2 MB，离这条线还有 750 倍空间，不要提前降级画质。**
补充一句：因为皮肤是营收核心，**低多边形只能用在场景，不能用在枪械和刀**——
枪刀永远走 `SKIN-PIPELINE.md` 的 8k–15k 面预算。

---

## 10. 联系点

代码里所有 `TODO(...)` 都带模块前缀，`grep -rn "TODO" js/` 能一次看全。
文档里所有「见 XXX.md」都是真实存在的文件，链接坏了算 bug，请修。
