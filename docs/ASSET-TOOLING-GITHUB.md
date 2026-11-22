# 外部编辑器与模型资源调研（GitHub 优先）

目标：给角色、地图、枪械、角色动画找「能直接用的编辑器」，找不到就退一步找「能直接用的模型」。
只记录能落地到本仓库的选项，许可证必须允许随包分发或允许离线导出。

## 结论先说

- **编辑器**：GitHub 上有 4 个真能用的（Blockbench / TrenchBroom / MakeHuman / three-vrm + retargeting），
  其中 Blockbench 与本项目的低模风格最匹配，改动成本最低。
- **模型**：GitHub 上几乎没有可用的 FPS 武器包（搜到的都是 0–1 星的个人上传）。
  武器/角色的 CC0 模型应去 Kenney、Quaternius、Poly Pizza；GitHub 只适合拿官方样例
  （Khronos glTF-Sample-Assets、three.js examples）。

## 一、编辑器

| 工具 | 仓库 | 许可 | 干什么 | 接进本项目的方式 |
|---|---|---|---|---|
| **Blockbench** | `JannisX11/blockbench`（6.2k★） | GPL-3.0 | 低多边形建模 + 关键帧动画时间轴，导出 glTF / OBJ，浏览器与桌面都能跑 | 做枪械、道具、投掷物；导出 `.glb` 放 `assets/weapons/`，在 `js/render/weapon-models.js` 里加一条 glb 分支，保留现有挂点与动画契约 |
| Blockbench MCP 插件 | `jasonjgardner/blockbench-mcp-plugin`（635★） | — | 给 Blockbench 挂 MCP server，AI 可直接建模/改模型 | 让协作 AI 按 JSON 描述批量出枪械原型，不用人肉拖方块 |
| **TrenchBroom** | `TrenchBroom/TrenchBroom`（2.9k★） | GPL-3.0 | Quake 风格笔刷关卡编辑器，导出 `.map` / `.obj` | 只建议用来画 blockout 参考。本项目地图是代码生成 + 运行时导航网格，外部网格还要手写碰撞盒，性价比低 |
| **MakeHuman** | `makehumancommunity/makehuman`（1.7k★） | AGPL-3.0（产出可 CC0） | 参数化人形建模 + 骨骼绑定，导出 glTF/FBX | 替换 `js/render/rig.js` 的方块人；导出 glb 后在 Blender 里套 Mixamo 动画 |
| makehuman-js | `makehuman-js/makehuman-js`（330★） | — | 浏览器里生成人形 | 只有在要做「玩家自定义外观」时才需要 |
| **three-vrm** | `pixiv/three-vrm`（2.3k★） | MIT | 在 three.js 里加载 VRM 人形、表情、动画 | 换人形最省事的路径：VRM 自带 humanoid 骨骼，可直接套 Mixamo / VRMA 动画 |
| retargeting-threejs | `upf-gti/retargeting-threejs`（48★） | Apache-2.0 | 运行时把动画重定向到任意人形骨架 | 把 Mixamo 的 walk/run/idle/death 套到 VRM 或 MakeHuman 骨架上 |

## 二、模型

| 来源 | 内容 | 许可 | 备注 |
|---|---|---|---|
| `KhronosGroup/glTF-Sample-Assets`（1.2k★） | 官方 glTF 样例，含带动画的骨骼角色（CesiumMan / Fox / BrainStem / RiggedFigure） | 各模型单独授权，多为 CC0 / CC-BY 4.0 | 用来验证「glb + 动画」管线，别直接当正式美术 |
| three.js 仓库 `examples/models/gltf/Soldier.glb` | idle / walk / run 三套动画 | MIT | 最快能让 Bot 有走路动画的现成资产 |
| Kenney（kenney.nl） | 低模 3D 包，体块风格最接近本项目 | CC0 | 首选；无需署名，可随包分发 |
| Quaternius | 低模武器 / 角色 / 场景包 | CC0 | 武器和集装箱场最全 |
| Poly Pizza | CC0 模型聚合搜索 | CC0 | 按「gun / crate / container」搜 |
| 3dmodelscc0（itch.io） | CC0 近战武器包（glb） | CC0 | 刀 / 斧一类 |

## 三、不建议

- **Sketchfab / CS 相关资产**：Valve 的地图网格、贴图、导航、音频不可复制，`docs/REFERENCE-DUST2WEB.md` 已写死这条边界。
- **运行时从 CDN 拉模型**：本项目「不加依赖、不动 vendor」，模型必须落进 `assets/` 随包分发。
- **GPL 编辑器生成的资产**：Blockbench / TrenchBroom 是 GPL 工具，但**产出的模型文件不继承 GPL**，可以随包发；不要把编辑器源码塞进仓库。

## 四、建议落地顺序

1. **枪械（收益最高）**：Blockbench 出 3 把（手枪 / 步枪 / 刀）→ `assets/weapons/*.glb` → `weapon-models.js` 加 glb 分支，
   保留现有挂点、后坐、开镜与 `assets/weapon-rig.json` 契约。
2. **角色**：three-vrm + 1 个 VRM 人形 + Mixamo 四套动画（idle / walk / run / death），替换 `rig.js`；
   hitbox 仍用现有胶囊，头部件判定不动。
3. **地图**：继续用内置「地图工坊」；TrenchBroom 只画 blockout 截图给人工参考，不进运行时。

## 五、待办（需要人确认）

- 选哪条角色路线：VRM（快，但要多一个 `three-vrm` 依赖）还是 MakeHuman 导出 glb（不引入运行时依赖，但要自己写骨骼动画）。
- 武器是否接受 GPL 工具的产出（模型文件本身不受 GPL 约束，但需要在 `docs/` 里留来源与许可证记录）。
