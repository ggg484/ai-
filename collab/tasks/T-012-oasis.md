# T-012 第二张地图：OASIS / 绿洲

- 状态：review
- owner：trae
- 分支：task/trae/T-012-oasis
- 涉及文件：`js/world/map-oasis.js`、`js/world/maps.js`、`js/game.js`、`js/ui/hud.js`、`js/ui/lobby-ui.js`、`js/render/engine.js`、`index.html`、`css/game.css`
- 共享文件：是（按 T-000 分工由 Trae 负责）

## 目标

新增第二张原创地图，地图选择可在大厅或 URL 中完成，默认仍是沙城协议。

## 地图

- 名称：OASIS / 绿洲
- 尺寸：92 × 84，A 点东侧、B 点西侧、中路窗口
- 路线：T 出生 → A 长 / B 公寓 / 中路；CT 出生 → A / B / 中路连接
- 视觉：暖砂岩、深色金属、红/蓝遮阳篷、棕榈树、暖色天空（`engine.setMood('oasis')`）
- 几何：`js/world/map-oasis.js` 程序化生成，原创，不复制 Valve 资产

## 框架

- `js/world/maps.js`：地图注册表 `sandline` / `oasis`
- `?map=oasis` 直接加载
- 大厅模式面板底部地图选择器（切换后刷新页面）
- 雷达标签显示 `OASIS`
- 半场交换继续使用 `spawns.playerCT / ctAllies / tBots`

## 验证

- DEV 地图审计：出生点 / 点位卡墙 **未发现明显问题**
- 绿洲 Bot 测试：9 个 Bot 生成，3 秒内至少 3 个发生移动
- 默认地图 `npm run smoke`：65/65
- `npm run smoke:lobby`：12/12
- 截图：T 出生、A 点、B 点、俯视图

## 已知边界

- 地图细节少于参考项目，后续可加 A/B 室内、拱门、市场摊位
- 切换地图会刷新页面，暂未做无刷新重建
- 雷达仍是 2D 圆点，没有逐地图手绘雷达
- Bot 下包/拆包在绿洲上的完整回归留给 T-011

## 参考项目

见 `docs/REFERENCE-DUST2WEB.md`。代码 MIT 可借鉴；Valve 地图/贴图/音频未复制。
