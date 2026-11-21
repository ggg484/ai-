# 沙城协议 · 军械大厅版（Builda H5）

5v5 战术爆破射击的 H5 游戏。**下载后不再进传统开始页，而是直接落在 3D 军械大厅**：
中央典藏陈列、西侧藏品墙自由试穿枪皮刀皮、东侧三条靶道自由练习；
大厅不放任何占位 NPC —— 没有真人时就是空场，不用假人冒充在线。
屏幕左上「作战传送」选模式，右上「活动传送」看收藏家榜与大厅活动。
从大厅进入对局后，买枪 → 对枪 → 下包 → 爆炸结算 → 下一回合，键鼠和触屏都能玩。

- 引擎：three.js 0.160.1（MIT，本地 vendor，无 CDN、无 npm 运行时依赖）
- 平台：Builda `engine=h5`，横屏，Chrome ≥ 88 / iOS ≥ 15
- 当前包体：`builda-web.zip` ≈ **1.58 MB**（含 1.0 MB GLB 角色、地图/光影/模型工坊，预算上限 200 MiB）
- 当前渲染：对局 113 draw call / 约 5.2 万三角形（5v5，9 个 GLB 角色，104×88 外环地图）；大厅空场 72 draw call / 约 3.1 万三角形
- 资产：8 把程序化枪械（高细节 5.3k–8.5k 三角/把）、8 种战术道具、22 款原创皮肤、3D 检视摄影棚
- 角色：`assets/models/bacon-avatar.glb`（骨骼 + 走路动画，对局 Bot 使用），署名与许可见 [`assets/models/bacon-avatar-license.txt`](assets/models/bacon-avatar-license.txt)
- 材质：ambientCG CC0 扫描 PBR（沙地/石膏/砖/混凝土/金属/木/砂岩/布料/大理石/聚合物，WebP 共 516 KB）
- 开发者地图审计：`?dev=1`（碰撞盒/俯视/自由飞/传送/悬浮穿模检查），普通玩家不会加载
- 视觉优化清单：见 [`docs/VISUAL-PASSES.md`](docs/VISUAL-PASSES.md)（60 轮 / 110 项）

> 这份 README 是**工程入口**。接手开发请直接读 [`docs/HANDOFF.md`](docs/HANDOFF.md)，
> 那份文档给出 30 分钟上手路径和交接边界。
>
> **两件事比这份文档更优先：**
>
> 1. [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md) —— **移动端是最高准则**、**质量优先**。
> 2. [`docs/SKIN-PIPELINE.md`](docs/SKIN-PIPELINE.md) —— 这个游戏**靠枪皮/刀皮营收**。
>
> **付费/氪金体系本轮没有实现。** 规划见 [`docs/MONETIZATION-PLAN.md`](docs/MONETIZATION-PLAN.md)，
> 等拍板后再接 IAP。

---

## 1. 跑起来

```bash
# 本地预览（自动把 /builda-sdk.js 映射到 .builda-agent 里的真实 SDK）
npm run dev            # → http://localhost:5173

# 打包成平台可上传的 zip
npm run pack           # → dist/ 与 builda-web.zip

# 平台包规范自检（必须全绿才能上传）
bash .builda-agent/builda bundle-check --engine h5 builda-web.zip

# 冒烟测试（无头浏览器跑一遍主流程：移动/射击/击杀/下包/结算）
npm run smoke

# 地图审计（开发模式右下角「重跑审计」同款）：当前 0 个问题
# 检查越界 / 悬浮 / 完全嵌入 / 穿模 / 窗户离墙 / 门被挡 / 出生点与导航点卡墙

# 大厅移动端压测：390×844 / DPR 2.6 / 模拟骁龙 7 系，断言 DPR、draw call、三角形、无占位 NPC
npm run smoke:lobby
```

本地预览时没有平台宿主，`js/platform/builda.js` 会自动降级：音效用 WebAudio 合成、
设置存内存、`whoami()` 返回 `本地玩家`。**降级路径是刻意保留的**，不要删——
它让我们不装客户端也能开发。

调试参数：

| 参数 | 作用 |
|---|---|
| 无参数 | **直接进入军械大厅**（默认入口） |
| `?autostart=1` | 跳过大厅，直接开经典爆破对局（截图/冒烟测试用） |
| `?quality=low\|medium\|high` | 强制画质档，跳过设备自动分档 |
| `?noadapt=1` | 关闭动态分辨率/掉帧降级（真机定点压测用） |
| `?perf=1` 或 F3 | 打开性能探针：FPS / calls / tris / DPR / 同屏人数 |
| `?tier=N` | 指定本地玩家声望等级 0–3（0 列兵 / 1 鉴赏家 / 2 收藏家 / 3 典藏家） |
| `?photo=ak` | 直接打开 3D 检视摄影棚（ak/m4/awp/usp/deagle/mp9/glock/knife） |
| `?photo=c4&still=1` | 检视战术道具并冻结旋转（he/flash/smoke/molotov/c4/defuse/armor/case） |
| `?skin=awp_helix&wear=0.236&seed=886&offset=0.71` | 指定检视皮肤与品相 |
| `?shadows=0` | 强制关阴影（截图/低端机） |
| `?cam=top` | 正交俯瞰相机（检查地图布局与碰撞） |
| `?stats=1` | 每 0.1 s 打印 `calls / tris / fps` |
| `?dpr=1` | 由平台宿主注入的像素比上限，骨架已接 |
| `?editor=1` | **打开地图/光影工坊**（独立场景，不启动大厅/对局）；`&tab=light` 直接进光影页 |
| `?rig=1` | **打开武器/人物模型工坊**；`&tab=char` 直接进人物姿势页 |
| `?mapEdits=1` | 对局加载本机试玩改动（工坊「试玩」自动加）；正常对局读 `assets/map-edits.json` |
| `?lightEdits=1` | 对局加载本机试玩光照；正常对局读 `assets/lighting.json` |
| `?rigEdits=1` | 对局加载本机试玩的武器/人物挂点；正常对局读 `assets/weapon-rig.json`、`assets/character-rig.json` |

### 地图工坊（`?editor=1`）

面向关卡调整的轻量工作台，不改贴图/地形，只编辑结构盒体。

- **相机**：左键空白旋转，右键平移，滚轮缩放；`[` / `]` 调整选中件高度。
- **选择**：点击盒体；再次按住选中件拖拽，在 XZ 平面移动并吸附。
- **增删**：右侧面板可添加墙体/掩体/沙袋/木箱/平台/立柱；`Del` 删除，`Ctrl+D` 复制，`Ctrl+Z/Y` 撤销/重做。
- **点位**：青色 = 玩家出生、橙色 = Bot 出生、绿色 = 导航点；可直接拖拽，导出后会写进地图数据，购买区跟随玩家出生点。
- **视角**：全景 / T / 中 / A / B 一键切换；`Ctrl+C/V` 复制粘贴盒体。
- **审计**：面板「审计」复用 `devtools.js` 的同一套检查（越界/悬浮/穿模/门被挡/点位卡墙）。
- **光影页**：太阳方位/高度/颜色/强度、天光、补光、雾、天空三色与云量、曝光；预设「黄金时刻 / 正午 / 清晨薄雾 / 黄昏 / 阴天 / 沙暴暖雾」；实时预览。
- **保存/发布**：地图与光照分别保存到本机 `localStorage`；「试玩」用 `?mapEdits=1&lightEdits=1` 预览。**导出 `map-edits.json` / `lighting.json` 覆盖 `assets/` 后，正常对局也会加载**。

边界：改动以**盒体 ID**（构建顺序）为键，覆写位置/尺寸、隐藏、追加，并可按索引覆写出生点/导航点。移动一堵墙不会带走它的门窗/屋顶等装饰件；大改结构仍建议改 `map.js` 或后续引入预制件分组。修改地图构建顺序后，旧编辑数据可能错位，以导出 JSON 为准。

### 光影（对局默认已启用）

- 默认随包光照是 `assets/lighting.json` 的 **黄金时刻**：低角度暖阳、长阴影、冷色补光和暖雾；对局启动时由 `Engine.applyLighting()` 应用。
- 大厅保持自己的明亮室内光照；回大厅时 `setMood('lobby')` 会恢复。
- 在 `?editor=1&tab=light` 实时调整并「导出 lighting.json」覆盖 `assets/lighting.json` 后随包生效；「试玩」使用 `?lightEdits=1` 本机预览。
- 预设：黄金时刻 / 正午 / 清晨薄雾 / 黄昏 / 阴天 / 沙暴暖雾；可调太阳方位/高度/颜色/强度、天光、补光、雾、天空三色、云量、曝光。

### 模型工坊（`?rig=1`）

面向皮肤/模型美术的挂点校准器，不改玩法与命中判定。

- **武器页**：8 把枪任意切换，实时调整第一人称位置 / 旋转 / 缩放；手部模型贴在握把与护木上，导出 `assets/weapon-rig.json` 后游戏直接读取。
- **人物页**：调整右手挂点、双手持枪姿势、脊柱、整体缩放与蹲下下沉；预览瞄准/射击/换弹/待机/倒地五种动作。
- **保存/导出**：本机 `localStorage` + 导出 JSON；`?rigEdits=1` 预览本机数据，覆盖 `assets/` 后随包生效。

### 双 AI 协作

两个 AI 分别在不同平台、没有 MCP，所以采用「Git 为代码真相 + `collab/` 为消息总线」的回合制协作：

- 分支：`main` 稳定线；`agent/trae`、`agent/other` 为两侧集成分支；任务分支 `agent/<name>/<task-id>-<slug>`。
- 协议：每次改代码前读 `collab/STATE.md` 领 `collab/locks.json` 文件锁，改完写 `collab/inbox/<对方>/` 交接单。
- 规则：共享文件（`index.html`、`js/game.js`、`js/main.js` 等）必须领锁；小步提交、先 rebase 再 PR。
- 完整流程见 [`collab/README.md`](collab/README.md)。

### 分辨率与触屏

- 分辨率永远锁定设备原生像素比（上限 3），画质档只影响阴影/云量，**任何档位都不会降分辨率**。
- 触屏摇杆改为「按住左半屏任意位置」的浮动摇杆，8% 死区 + 58px 行程；左右转向、左右平移方向已修正。

## 线上预览

- Builda 草稿（已上传，待 App 内公开发布）：<https://builda-godot-play.poni.fun/cysj2/release/builds/cd32ef605392fd5012e3c49a18829a41/?bundleVersion=cd32ef605392fd5012e3c49a18829a41&gameId=GD%3A28983224%3A12>
- 游戏 ID：`GD:28983224:12`（已绑定 `.builda-agent/game.json`）
- 公开发布：在 Builda App「我的游戏 → 沙城协议 → 发布」提交审核；审核通过后玩家才能下载。CLI `builda publish` 只同步到待发布区。
- Trae 部署（仅自己可见）：<https://37ks6whhww11mlhng83.traesite.cn>

---

## 1.1 大厅性能（空场，无占位 NPC）

大厅刻意不放任何假人：没有真人时就是空场，在线人数显示 1（自己）。这既避免“用 NPC 冒充在线”的观感，也让大厅成本降到极低。

- 实测（移动端模拟，390×844 / DPR 2.6）：**71 draw calls / 3.1 万三角形 / 原生 DPR 2.6**（分辨率不随时间/帧率下降）；
- 光源：穹顶天窗 + 展位光柱 + 少量聚光灯；移动端无实时阴影；
- 动态分辨率已停用：掉帧只降阴影/云量/细节，**分辨率永远保持原生 DPR**；
- 该预算按 Adreno 642L/644 级 GPU 估算；**60 帧最终必须在真机验收**，无头 SwiftShader 的 FPS 不能当性能结论；
- 以后接入真人/联机时再启用 `lobby/crowd.js` 的实例化人流；当前默认不实例化。
- 展位：4 个浮空武器展台 + 中央典藏陈列，不再有占位人物模型。

`npm run smoke:lobby` 当前 **12/12** 通过（进入大厅、DPR、draw call、三角形、无占位 NPC、品相、3D 检视、无异常）。

---

## 2. 目录

```
.
├── index.html               入口。head 里依次是 SDK / 像素比 / CSS
├── mobile-perf.js           官方 ?dpr=N 上限脚本，原样落地，勿改
├── builda.publish.json      上架元信息（分类/方向/最低版本）
├── css/game.css             HUD、触屏层、面板。安全区用 CSS 变量注入
├── js/
│   ├── main.js              入口：ready() → new Game() → 大厅 / 对局
│   ├── game.js              编排核心：大厅 ↔ 对局、主循环、战斗、相机、特效池
│   ├── config/
│   │   ├── weapons.js       手感数值单一事实源（枪/移动/经济/购买列表）
│   │   ├── modes.js         经典/快速/手枪/靶场模式参数
│   │   ├── skins.js         枪皮/刀皮目录 + 磨损度/图案偏移预设
│   │   └── lobby.js         声望等级、展位主角、收藏家榜、活动、交互点
│   ├── platform/builda.js   平台能力唯一出口（SDK 薄封装 + 无宿主降级）
│   ├── core/
│   │   ├── input.js         键鼠 + 指针锁定 + 触屏摇杆/拖动/按钮
│   │   └── audio.js         Builda.audio 转发，无宿主时 WebAudio 合成
│   ├── render/
│   │   ├── engine.js        WebGL2、相机、光照、天空、PMREM 环境反射、画质档位
│   │   ├── viewmodel.js     第一人称武器挂点、切枪、后坐、换弹、皮肤
│   │   ├── weapon-models.js 8 把程序化枪械（挤出截面 + 倒角 + 合批 + UV 盒投影）
│   │   ├── prop-models.js   8 种战术道具（手雷/C4/拆弹包/护甲/武器箱）
│   │   ├── photo.js         3D 检视摄影棚（PMREM 柔光箱、旋转展台、道具导航）
│   │   ├── character.js     人形角色（Bot 高模 / 大厅低模 / 展位主角）
│   │   ├── skin-material.js 皮肤花纹生成与材质覆盖（单 shader program）
│   │   └── noise.js         确定性噪声
│   ├── world/
│   │   ├── map.js           沙线地图：AABB 几何 + 合批 + 壁柱/线缆/包点 + edits 覆写层
│   │   ├── map-edits.js     工坊编辑数据：moved / hidden / added / spawns / waypoints
│   │   ├── lighting.js      光影预设、归一化、assets/lighting.json 与本机预览
│   │   ├── lobby.js         军械大厅：穹顶、藏品墙、靶场、传送门、二层看台
│   │   ├── geo-utils.js     合批、UV 缩放、顶点色
│   │   ├── collision.js     AABB 世界：扫掠移动、台阶、射线、视线
│   │   └── textures.js      程序化 PBR（albedo + normal + roughness）
│   ├── lobby/
│   │   ├── crowd.js         实例化人流（当前大厅不启用，留给以后真人/联机）
│   │   └── range.js         三条靶道、弹起靶、计分、30 秒挑战
│   ├── player/
│   │   ├── controller.js    Source 风格移动：加速/摩擦/台阶/空中控制
│   │   └── weapon.js        射速、弹匣、换弹、扩散、后坐力
│   ├── game/
│   │   ├── bots.js          Bot：巡逻/交战状态机、命中判定、头部倍率
│   │   └── round.js         回合状态机：购买 → 进行 → 安放 → 结束 → 对局结算
│   ├── dev/
│   │   ├── devtools.js      开发审计：碰撞盒/悬浮/穿模/门与点位检查、自由飞
│   │   └── map-editor.js    地图工坊：轨道相机、盒体拾取/拖拽/增删/导入导出
│   ├── ui/
│       ├── hud.js           对局 HUD + 雷达绘制
│       └── lobby-ui.js      大厅 HUD、模式/活动/藏品墙/榜单/公告面板
├── scripts/
│   ├── pack.mjs             零依赖打包 + 包规范自检
│   └── serve.mjs            零依赖静态服务器（映射 SDK）
├── tools/smoke.mjs          无头冒烟测试
├── docs/                    交接文档（见下）
├── contracts/               平台 Room / 资源上限契约 JSON
├── server/                  Room 本地 mock 服务
└── vendor/three.module.js   three.js 0.160.1
```

**没有构建步骤。** 源码就是产物：`index.html` 直接 `<script type="module" src="js/main.js">`。
改完刷新即可。`npm run pack` 只做复制和 zip。

---

## 3. 文档地图

> **阅读顺序是有讲究的。前两份决定你怎么做，第三份起才是怎么做。**

| 顺序 | 文档 | 什么时候读 |
|---|---|---|
| **①** | [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md) | **最先读，且要重读。** 两条最高准则：移动端优先、质量优先。与任何文档冲突以它为准 |
| **②** | [`docs/SKIN-PIPELINE.md`](docs/SKIN-PIPELINE.md) | 第二个读。**这个游戏靠皮肤赚钱**，皮肤管线的技术形态决定了整个项目的商业天花板 |
| **③** | [`docs/ROADMAP.md`](docs/ROADMAP.md) | **以后的计划全在这。** M1→M7 每阶段交付物、质量门、资源变体、降级路径 |
| **④** | [`docs/HANDOFF.md`](docs/HANDOFF.md) | 30 分钟上手 + 交接边界 + 第一周计划 |
| **⑤** | [`docs/VISUAL-PASSES.md`](docs/VISUAL-PASSES.md) | 本轮 60 轮 / 86 项视觉优化清单、性能基线与差距说明 |
| **⑤** | [`docs/TASKS.md`](docs/TASKS.md) | 可直接认领的任务清单，含文件/函数/验收标准/DoD |
| **⑤** | [`docs/MONETIZATION-PLAN.md`](docs/MONETIZATION-PLAN.md) | **待裁定**：付费/氪金体系规划，本轮未实现 |
| ⑤ | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 想知道某个功能该改哪个文件时 |
| ⑤ | [`docs/PLATFORM-RULES.md`](docs/PLATFORM-RULES.md) | 动入口、音频、存档、暂停、包体之前必读 |
| ⑤ | [`docs/ART-PIPELINE.md`](docs/ART-PIPELINE.md) | 要把灰盒换成真材质时 |
| ⑤ | [`docs/MAP-SPEC.md`](docs/MAP-SPEC.md) | 要改地图或做第二张图时 |
| ⑤ | [`docs/NETCODE.md`](docs/NETCODE.md) | 要接 Room 联机时 |
| 参考 | [`docs/plan/沙城协议_立项计划书_v0.1.md`](docs/plan/沙城协议_立项计划书_v0.1.md) | 产品定义、数值依据、45 MB 包体预算、M0–M6 排期（101 人日）、风险登记册。**排期以 ROADMAP 为准** |
| 参考 | [`docs/platform/`](docs/platform/) | 平台官方原文（上架流程、包规范、SDK 地图、联机） |

**如果只有 10 分钟**：读 `PRINCIPLES.md` 的两条准则 + `TASKS.md` 的 P0 列表，就能开工。

---

## 4. v0.6 做到了什么

**大厅（新入口）**

- 下载即落地军械大厅，无开始页；没有真人时是空场，不塞 NPC
- 4 个浮空武器展台 + 中央典藏陈列；典藏家金环/光柱保留，人物模型已移除
- 中央「本期典藏」玻璃柱：金色爪刀旋转 + 名牌 + 光柱
- 四个典藏家展位：金色展台、光柱、悬浮名牌，走近按 `E` 可试穿展品
- 西侧藏品墙：8 把枪、22 款原创皮肤，带磨损度/图案偏移，自由试穿与装备
- 东侧三条靶道：手枪 15 m / 步枪 25 m / 狙击 40 m，弹起靶、连中计分、30 秒挑战
- 东侧战术道具展台：8 种道具 + 玻璃罩 + 射灯，走近可 3D 检视
- 西北「作战传送」、东北「活动传送」：屏幕左上/右上常驻按钮 + 四个地面传送点
- 二层看台可上去俯瞰大厅；普通玩家同样可上，不设付费门槛

**对局**

- 经典爆破（MR12）/ 快速爆破（MR8）/ 手枪局（手枪限定）/ 靶场训练
- 对局结束有结算面板：再来一局 / 返回大厅
- 移动、射击、命中、下包、经济、5 个 Bot、触屏操作
- **104×88 十字外环旧城「沙线」**：南 T 院 / 北 CT 院 / 东 A 院 / 西 B 院 + 中央老城核心；T→A/B 约 70 m，CT→A/B 约 49 m；A/B 包点搬到东西院，老城 A/B 高台改为前哨
- 核心：A 大货栈穿堂 / A 城墙步道 / A 后看台 / 中路 2.65 m 过街廊桥 / B 客栈穿堂 / B 装卸台 / B 窗口楼阁夹层 / A·B 后巷；外环 8 个门洞、40+ 掩体、3 条进攻线
- 包点：东西院 0.58 m 台面 + 台阶、橙圈与 A/B 旗、外院回防路线；南/北院各有舞台/喷泉与出生掩体
- 爪刀近战（槽位 3）与刀皮
- 8 把武器都有独立程序化模型：AK / M4A4 / AWP / USP-S / 沙漠之鹰 / MP9 / Glock / 爪刀

**质量与检视**

- 全场景材质为 **albedo + normal + roughness** 三通道程序化 PBR
- 天空 fbm 云层、PMREM 环境反射、ACES、雾、体积光柱、尘埃、墙根假 AO、CSS 调色 + 颗粒 + 暗角
- 枪械零件级 UV 盒投影 + bumpMap，皮肤不再被裁成一条
- 3D 检视摄影棚：程序化柔光箱环境、三点灯 + 轮廓光、展台、旋转；支持 8 把枪 + 8 种道具
- 皮肤花纹程序化生成（赤线/沙暴/极夜/白垩/熔金/霓虹脉冲/淬火/流云…），换皮肤不新增 shader program

**刻意没做**

- **付费、充值、IAP、开箱、军需**：一行都没写，等 [`docs/MONETIZATION-PLAN.md`](docs/MONETIZATION-PLAN.md) 拍板
- 手雷/闪光/烟雾/燃烧瓶的**投掷玩法**（模型可检视，未接入战斗）；拆包、半场交换、加时
- 联机、真人房间
- 真 GLB 武器 / KTX2 贴图（当前仍是程序化资产，但已不是灰盒）
- 多语言（文案仍硬编码中文）

**第三方素材署名**

- 角色模型 "Roblox-Bacon-Hair"（[Sketchfab](https://sketchfab.com/3d-models/roblox-bacon-hair-88a62bc6286947e9846c5cd445d2628b)）by **Roblox**，licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/)。原始许可文本见 [`assets/models/bacon-avatar-license.txt`](assets/models/bacon-avatar-license.txt)。
- 其余材质/音效为程序化生成或 ambientCG CC0。

---

## 5. 三条不要踩的线

1. **不要给游戏加静音开关。** 平台统一管理音频，游戏自建开关会被审核打回。
2. **不要把 `builda-sdk.js` 打进 zip。** 宿主注入，打包脚本已自检拦截。
3. **不要在模块顶层写 `await`，也不要用 `??=` / `||=` / `structuredClone` / `crypto.randomUUID`。**
   浏览器基线是 Chrome 88 / iOS 15，`bundle-check` 会报 `bundle-compat-required-chrome`。

细节和原因都在 [`docs/PLATFORM-RULES.md`](docs/PLATFORM-RULES.md)。
