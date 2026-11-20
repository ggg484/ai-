# 沙城协议 · 军械大厅版（Builda H5）

5v5 战术爆破射击的 H5 游戏。**下载后不再进传统开始页，而是直接落在 3D 军械大厅**：
数百名玩家同场、中央典藏陈列、西侧藏品墙自由试穿枪皮刀皮、东侧三条靶道自由练习；
屏幕左上「作战传送」选模式，右上「活动传送」看收藏家榜与大厅活动。
从大厅进入对局后，买枪 → 对枪 → 下包 → 爆炸结算 → 下一回合，键鼠和触屏都能玩。

- 引擎：three.js 0.160.1（MIT，本地 vendor，无 CDN、无 npm 运行时依赖）
- 平台：Builda `engine=h5`，横屏，Chrome ≥ 88 / iOS ≥ 15
- 当前包体：`builda-web.zip` ≈ **0.74 MB**（预算上限 200 MiB）
- 当前渲染：对局 92 draw call / 6.36 万三角形；大厅 89 draw call / 约 10.8 万三角形（436 人）
- 资产：8 把程序化枪械（高细节 5.3k–8.5k 三角/把）、8 种战术道具、22 款原创皮肤、3D 检视摄影棚
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

# 大厅移动端压测：390×844 / DPR 2.6 / 模拟骁龙 7 系，断言 DPR、draw call、三角形、同屏人数
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
| `?crowd=N` | 指定大厅**细节**人数（20–700，默认手机 medium 170 / 桌面 medium 320） |
| `?far=N` | 指定远景 billboard 人数（默认手机 medium 260） |
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

## 线上预览

Trae 部署（仅自己可见）：<https://37ks6whhww11mlhng83.traesite.cn>

> 私有站点需要登录对应 Trae 账号；Builda 平台正式上架仍需 `builda auth` 授权。

---

## 1.1 大厅性能预算（骁龙 7 系 60 帧目标）

大厅不是“能塞多少塞多少”，而是按中端机的帧预算反推人数：

| 档位 | 细节人形 | 远景 billboard | 同屏合计 | 人群更新 | 像素比 | 阴影 |
|---|---:|---:|---:|---:|---|---|
| low | 130 | 150 | 280 | 10 Hz | 1.0 | 关 |
| medium · 手机 | 120 | 300 | **420** | 12 Hz | 1.25 × 0.9 | 关 |
| medium · 桌面 | 280 | 240 | 520 | 18 Hz | 1.5 | 512 |
| high · 手机 | 180 | 340 | 520 | 16 Hz | 1.5 | 关 |
| high · 桌面 | 380 | 320 | **700** | 24 Hz | 2.0 | 1024 |

中端手机默认走 medium：

- **关实时阴影**，人群脚下继续用 blob 阴影；
- **关 MSAA**，靠 DPR 1.125 控锯齿；
- 人群从 `MeshStandard` 换 `MeshLambert`，远看几乎无差别；
- 近景 120 个实例化人形，远景 300 个 2 三角形 billboard（1 draw call）；
- 动态分辨率 0.7–1.0；连续掉到 52 fps 以下会依次降分辨率 → 减细节人数 → 减远景人数；
- 实测大厅出生点 **约 89 draw calls / 12.0 万三角形 / 428 人同屏**；桌面 700 人也只有约 100 calls。
- 该预算按 Adreno 642L/644 级 GPU 估算；**60 帧最终必须在真机验收**，无头 SwiftShader 的 FPS 不能当性能结论。

`npm run smoke:lobby` 当前 12/12 通过，包含品相切换、快速传送到二层看台、3D 检视、无运行时异常等断言。

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
│   │   ├── map.js           沙线地图：AABB 几何 + 合批 + 壁柱/线缆/包点
│   │   ├── lobby.js         军械大厅：穹顶、藏品墙、靶场、传送门、二层看台
│   │   ├── geo-utils.js     合批、UV 缩放、顶点色
│   │   ├── collision.js     AABB 世界：扫掠移动、台阶、射线、视线
│   │   └── textures.js      程序化 PBR（albedo + normal + roughness）
│   ├── lobby/
│   │   ├── crowd.js         实例化人流 + 典藏家金环/冠标/光柱
│   │   └── range.js         三条靶道、弹起靶、计分、30 秒挑战
│   ├── player/
│   │   ├── controller.js    Source 风格移动：加速/摩擦/台阶/空中控制
│   │   └── weapon.js        射速、弹匣、换弹、扩散、后坐力
│   ├── game/
│   │   ├── bots.js          Bot：巡逻/交战状态机、命中判定、头部倍率
│   │   └── round.js         回合状态机：购买 → 进行 → 安放 → 结束 → 对局结算
│   └── ui/
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

- 下载即落地军械大厅，无开始页；大厅常驻 **280 / 420 / 520+ 人**（低/中/高画质，`?crowd=N` 可到 700）
- 细节人形 + 远景 billboard 双层；典藏家有**金色冠标、脚下金环、金色光柱**，收藏家有紫色标识
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

---

## 5. 三条不要踩的线

1. **不要给游戏加静音开关。** 平台统一管理音频，游戏自建开关会被审核打回。
2. **不要把 `builda-sdk.js` 打进 zip。** 宿主注入，打包脚本已自检拦截。
3. **不要在模块顶层写 `await`，也不要用 `??=` / `||=` / `structuredClone` / `crypto.randomUUID`。**
   浏览器基线是 Chrome 88 / iOS 15，`bundle-check` 会报 `bundle-compat-required-chrome`。

细节和原因都在 [`docs/PLATFORM-RULES.md`](docs/PLATFORM-RULES.md)。
