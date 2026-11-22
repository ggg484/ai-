# 武器视觉管线：模型、第一人称手臂与 Bot 持枪

> 适用范围：`js/render/weapon-models.js`、`js/render/viewmodel.js`、`js/render/rig.js`、`js/game/bots.js`、`assets/weapon-rig.json`
> 任务：T-016（2026-11-22）。这份文档记录“为什么这么做”和踩过的坑，后续改枪先读这里。

## 1. 坐标与单位约定

- 单位米，Y 向上，**枪口朝 -Z**。所有模型、挂点、弹壳、枪口位置都按这个约定。
- 视角模型统一由 `Viewmodel` 缩放；每把枪的 `pos / rot / scale` 在 `DEFAULT_WEAPON_RIG` 与 `assets/weapon-rig.json`。
- 第一人称模型 `depthTest=false`、`renderOrder=1000`，所以枪不会穿墙，也不会被世界几何遮住。
- 玩家站高 1.80 m、眼高 1.62 m、半径 0.30 m；枪的握把点按这个尺度定，不要凭截图感觉。

## 2. 模型角色与皮肤兼容

`weapon-models.js` 用“角色 -> 材质”合并几何，每个角色一个 mesh：

| 角色 | 用途 | 皮肤是否覆盖 |
|---|---|---|
| `metal / steel / accent / hardware` | 机匣、枪管、小件 | 主材质按 `MAIN_ROLE` 覆盖 |
| `wood / polymer / olive` | 护木、枪托、握把 | 按皮肤色板替换 |
| `lens / suppressor / blade / handle` | 瞄准镜、消音器、刀 | 特殊材质 |
| `glove / sleeve` | 右手手套、右前臂 | 永远不覆盖 |
| `gloveL / sleeveL` | 左手、左前臂 | 映射到 `glove / sleeve`，永远不覆盖 |

新增角色时必须同步 `skin-material.js`：`gloveL / sleeveL` 不能被当成可上皮肤的角色，否则手臂会被贴上枪皮花纹。

## 3. 手部布局（重点）

旧实现用一套固定的 `addHands()`：右手在 AK 握把位置，左手固定放在 `z=-0.255` 的护木下。结果：

- 手枪（Glock/USP/Deagle）前方多出一只悬空的手；
- 步枪只有手掌、没有前臂，第一人称像“浮空手套”；
- 所有枪共用同一个左手位置，M4/AWP/MP9 的护木对不上。

现在改为 `HAND_LAYOUT` 表（`js/render/weapon-models.js`）：

| 枪 | 右手握把 | 左手 | 说明 |
|---|---|---|---|
| AK | z=0.150 | 护木下 z=-0.245 | 木护木 |
| M4 | z=0.130 | 护木下 z=-0.300 | 圆护木 |
| AWP | z=0.130 | 枪身下 z=-0.260 | 长枪，左手别伸到枪管 |
| MP9 | z=0.075 | 护罩下 z=-0.250 | 短枪 |
| Glock / USP | z=0.055 | 握把下方 z=0.035 | 双手托握 |
| Deagle | z=0.060 | 握把下方 z=0.040 | 双手托握 |
| 爪刀 | z=0.060 | 无 | 单手 |

前臂规则：

- **右手**保留一段可见前臂 + 袖口，朝屏幕右下出画；
- **左手**只留一小截前臂。步枪的左手在护木下，长前臂会变成一根横跨屏幕的杆；
- 手枪的左手在握把附近，前臂可以稍长一点；
- 袖口比前臂粗一圈，颜色分界比纯色圆柱更清楚。

## 4. 第一人称动画层

`Viewmodel.update()` 每帧叠加：

1. **待机呼吸**：低频 sin/cos 微摆，限幅 ±0.04。
2. **走路 bob**：用 `player.bobT` 和水平速度，枪身/手臂一起动。
3. **冲刺**：速度 > 4.15 m/s 时枪下压、右倾、后收，避免冲刺时还端枪瞄准。
4. **开火后坐**：`kick` 从 1 衰减，后坐 + 枪口上抬；刀是挥砍弧线。
5. **换弹**：整枪下沉/倾斜；左手（`gloveL/sleeveL` 独立 mesh）离开护木，做出摸弹匣的动作。
6. **切枪抬枪**：`raise` 从 0.28 衰减，枪从屏幕下方抬起。
7. **抛壳**：步枪/手枪开火时从抛壳口飞出一枚小黄铜壳，0.55 s 后消失。
8. **枪口焰**：muzzle 位置来自模型 `userData.muzzle`，不要写死。

这些都在 `viewmodel.js`，不需要给每把枪单独写动画片段。

## 5. 模型按需构建

旧 `Viewmodel` 只预构建 `ak / glock / knife`，所以 AWP/沙鹰/MP9 在第一人称根本不存在。现在：

- `WEAPON_IDS` 覆盖 8 把；
- `_ensure(id)` 第一次切到时才构建，构建后缓存；
- 皮肤可以先 `setSkin()`，等模型真正构建时再 `applySkin()`；
- 这样大厅检视 8 把枪不会在启动时一次性构建 8 个高模。

## 6. Bot 持枪

- Bot 不再是所有人共用一把方块枪；按 `weaponId` 取 `buildProxyWeapon()` 的低模（1 mesh / 1 draw call）。
- 近距离细节留给第一人称；同屏 9 个 Bot，不能给每个 Bot 上高模。
- `avatar.weaponClass`（`rifle / pistol / knife`）由 Bot 更新，`avatar-glb.js` 据此调整左臂：
  - 步枪：左臂更向前伸到护木；
  - 手枪：双手托握；
  - 刀：只抬右手。
- 枪挂点仍跟随右手骨骼，不直接挂骨骼，避免 GLB 内部 100× 缩放把枪压成玩具。
- 开火后坐同时作用在枪挂点（后移 + 上抬）和人物 `shootAnim` 上。

## 7. 性能结果（T-016 实测）

| 指标 | 改动前 | 改动后 |
|---|---:|---:|
| 对局 draw calls | 67 | 69 |
| 对局三角面 | 28,255 | 28,423 |
| Bot 枪 mesh | 1 / Bot | 1 / Bot |
| 第一人称模型 mesh | 每把 6–8 | 每把 8–10（+左右手/前臂） |

+2 draw calls 来自第一人称新增的左手/左前臂 mesh；三角面 +0.6%，在移动端预算内。

## 8. 踩过的坑

1. **手枪多一只手**：`addHands()` 里同时加了握把手和护木手，手枪没有护木，护木手会飘在枪口前。现在由 `HAND_LAYOUT.pistol` 区分。
2. **前臂变成横杆**：把左手肘放到屏幕左侧太远，圆柱会横跨整个画面。左手只留短前臂，右手才用长前臂。
3. **手套颜色太黑**：`0x241e15` 在暗枪身上完全看不见；抬到 `0x40352a`，袖口用 `0x3d3e32`。
4. **`gloveL` 被皮肤覆盖**：皮肤遍历按 `userData.role` 匹配，必须把 `gloveL/sleeveL` 映射回 `glove/sleeve`。
5. **换图/大厅 world 切换**：第一人称模型挂在 camera 上，不跟 world 走；枪口世界坐标每帧重算，不要缓存。
6. **Bot 高模**：用 `buildDisplayWeapon(id, true)` 给 9 个 Bot 会把三角面从 28k 推到 35.6k；改用 `buildProxyWeapon()` 后回到 28.4k。
7. **AWP 瞄准镜悬空**：镜座下方补一整段导轨；MP9 折叠托拉杆沿 +Z，不要横着穿出机匣。

## 9. 验证清单

```bash
CHROME_PATH=<chrome> npm run smoke        # 81/81
CHROME_PATH=<chrome> npm run smoke:lobby  # 12/12
```

- 第一人称：AK / M4 / AWP / MP9 / Glock / 沙鹰 / 爪刀 各拍一张，检查枪口方向、双手、前臂、遮挡。
- 换弹：`weapon.ammo=0; weapon.startReload()`，看左手是否离开护木、枪身是否下沉。
- 开火：看枪口焰位置、抛壳方向、后坐。
- Bot：正面/侧面各一张，检查枪型、双手、枪是否跟手。
- 性能：对局视角 draw calls / tris 不超过改动前 +5%。

## 10. 后续可做

- 把 M4/AWP/USP/沙鹰/MP9 接入实际购买与 Bot 经济（本轮只做视觉/第一人称，不改平衡）。
- AWP 开镜（FOV 缩放 + 镜片遮罩）需要单独任务。
- 手枪套筒后坐、步枪拉机柄动画：需要把 slide/bolt 拆成独立 mesh。
- 第一人称手臂 IK：目前是固定前臂几何，蹲/贴墙时不会自动收臂。
