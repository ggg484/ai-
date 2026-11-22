# T-015 第三张原创地图 HARBOR（港口 / 集装箱码头）

- 状态：review
- owner：other
- 分支：task/other/T-015-harbor
- base：main（9ec4f00）
- 涉及文件：`js/world/map-harbor.js`（新增）、`js/world/maps.js`、`js/game.js`、`js/render/engine.js`、`index.html`、`tools/smoke.mjs`、`tools/screenshots.mjs`、`docs/MAP-DESIGN-PLAYBOOK.md`、本卡
- 共享文件：`js/world/maps.js`、`js/game.js`、`js/render/engine.js`（只加分支，不改既有行为）

## 目标

从 0 做第三张原创图：码头 + 仓库 + 集装箱堆场，色板走冷蓝 / 铁锈 / 海雾，
与 SANDLINE（沙色）、OASIS（暖砂岩）在截图里能一眼区分。按手册 20 项评分 ≥19/20。

## 结构

- 尺度 96 × 92 m，边界 x ±48 / z ±46；T 出生在南（z≈-41），CT 在北（z≈41）。
- 三条主路线：A 长（东，码头路）、B 长（西，仓库路）、中路（集装箱堆场）；
  两条连接线：A 后巷 z 26–28、B 后巷 z 26–28，与 CT 走廊 z 28–34 组成回防环。
- 包点：A（30, 18）半室内码头棚，4 入口（正门 6 m / 西门 3.4 / 北门 5 / 东门 3）；
  B（-30, 19）全室内仓库，3 入口（正门 4 / 侧门 3.2 / 后门 3.2）。
- 垂直差：堆场东列 2 连箱、西列 1 箱加长箱，箱顶 2.64 m 有落脚板；
  上层必须从 8 级台阶（0.32 m/级）上，且箱子贴墙，站上去只能侧身。
- 掩体 54 个（低 0.85 / 半 1.4 / 高 1.75 三档），容器 15 个。

## 验收标准

- [x] 自动审计零问题（越界 / 悬浮 / 穿模 / 点位卡墙）
- [x] 三线 + 2 连接线全部寻路连通；A 点 4 入口、B 点 3 入口
- [x] 导航点 86（≥60）、报点 27（≥20）、A/B 地面标识各 1
- [x] 每方 6 类出生点，T/CT 各 3 个出口
- [x] Bot 真跑一局能自己走到 A 点下包（77.4 s）
- [x] 渲染开销：6 机位最大 72 draw calls / 34.3k tris（限 80 / 35k，含 9 Bot）
- [x] `npm run smoke` 通过（新增 7 条 HARBOR 专属断言）
- [x] `npm run smoke:lobby` 通过
- [x] 截图 70–74（T 出生 / A / B / 俯视 / Bot），60–64 未动

## 备注

- 未改 `js/world/map-oasis.js`、`js/world/map.js`、`js/render/weapon-*`、`js/render/rig.js`、
  `assets/weapon-rig.json`；未加依赖、未动 vendor。
- `game.js` 的 mood 分支对 harbor 额外跳过一次 `applyLighting`：随包 lighting.json 是沙城日落，
  套上去会把海雾染回沙色。
- 已知取舍：东侧海面只有 4.4 m 宽的一条，雾里主要靠岸吊 / 灯桩 / 防波堤读「港口」，
  海面本身在玩家眼高下几乎看不到；下一张图若要强化水域，需要把水做成可走边界外的独立区域。
