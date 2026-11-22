# T-017 外部编辑器资产管线：武器 / 道具 glb 化

- 状态：review
- owner：other
- 分支：task/other/T-017-assets
- base：757e0b9（main，含 T-015 HARBOR / T-016 武器重做）
- 涉及文件：`tools/assetgen/*`、`js/render/model-assets.js`、`js/render/weapon-models.js`、`js/render/prop-models.js`、`js/game.js`、`tools/smoke.mjs`、`docs/ASSET-PIPELINE.md`、`assets/models/{weapons,props}/*.glb`
- 共享文件：是（`weapon-models.js` / `prop-models.js` / `game.js` / `smoke.mjs` 只加不删）

## 目标

把「模型只能改代码」变成「模型是可编辑的外部资产」：用标准 glTF 2.0 承载武器与道具，
Blockbench 可直接打开继续编辑；游戏启动优先加载 glb，缺失时自动回退程序化几何。

## 做了什么

- **GLB 写入器**（`tools/assetgen/lib.mjs`）：零依赖，写 POSITION / NORMAL / UV / indices
  + PBR 材质，按材质合批成 primitive。
- **导出器**（`export.mjs` / `export-props.mjs`）：在无头 Chrome 里调用现有
  `buildWeaponModel` / `buildPropModel`，取顶点与材质参数，回 Node 写 glb。
  这样视觉与 T-016 的成品完全一致，不重画、不退化。
- **8 把武器**：ak / m4 / awp / mp9 / glock / usp / deagle / knife，共 49.8k tris（含第一人称手）。
- **8 个道具**：he / flash / smoke / molotov / c4 / defuse / armor / case，共 17.4k tris。
- **运行时**（`js/render/model-assets.js`）：启动并行预加载，按材质名映射回
  `metal / steel / polymer / wood / ...` 角色，皮肤系统照常工作；第一人称的手已经
  烘焙在 glb 里，`userData.left` 仍能驱动换弹时左手下沉。
- **预览器**（`preview.html` + `shot.mjs`）：拖拽旋转、滚轮缩放、显示三角面 / 材质数 / 实际尺寸，
  无头可截图，作为资产验收工具。
- **文档**（`docs/ASSET-PIPELINE.md`）：Blockbench 导入导出流程、坐标约定、
  材质名映射表、性能约束，以及地图编辑器说明。

## 验收标准

- [x] `npm run smoke` 通过（91/91，含 3 条新断言）
- [x] 8 把武器 + 8 个道具全部加载（`weapons=8/8 props=8/8`）
- [x] 第一人称确实用 glb（材质名 `metal/wood/polymer...`，8 个 mesh，含 muzzle 节点）
- [x] 加载失败回退程序化几何，不白屏
- [x] draw call 仍在预算内（对局 107 / 限 120）

## 备注

- **第三人称不改**：Bot 手持继续用 `buildProxyWeapon`（合批 1–2 draw call）。
  glb 每把 7–10 个材质 primitive，9 个 Bot 会多出 70+ draw call。
- **纹理**：导出丢掉了 canvas 程序纹理，glb 用 PBR 纯色近似。要纹理就在 Blockbench 里
  贴 512×512 再导出。
- **角色没动**：`bacon-avatar.glb` 已带骨骼与走路动画，重做需要骨骼/蒙皮/动画三条链路一起换，
  风险高于收益；`docs/ASSET-PIPELINE.md` 第 3 节写了三条替换路线。
- **地图编辑器**：项目内置地图工坊就是 `?editor=1`（`js/dev/map-editor.js`），
  TrenchBroom 只建议画 blockout，接进来要写 `.map` 解析与碰撞登记，本轮不做。
