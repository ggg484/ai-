# 资产管线：外部编辑器怎么接进来

这份文档回答两件事：**游戏里的模型从哪来、怎么改**，以及**地图用什么编辑器**。

---

## 1. 现在有哪些「编辑器」

| 工具 | 入口 | 能改什么 | 适合谁 |
|---|---|---|---|
| **地图工坊**（内置） | `?editor=1` | 结构盒体（墙/掩体/平台/立柱）、光照预设、地图 edits | 关卡设计、快速 blockout |
| **模型工坊**（内置） | `?rig=1` | 武器挂点、人物持枪姿势、缩放 | 调第一人称手感 |
| **Blockbench**（外部） | 桌面版或 web.blockbench.net | 武器 / 道具 / 低模网格与贴图 | 做模型资产 |
| **TrenchBroom**（外部） | 桌面版 | 笔刷关卡（.map） | 复杂室内关卡 |
| **DevTools**（内置） | `?dev=1` | 地图审计、飞行、传送、性能采样 | 验收与排错 |

### 1.1 地图编辑器就是内置的地图工坊

项目里的地图是**代码生成**的（`js/world/map-*.js`），不是手摆的关卡文件。所以「地图编辑器」有两层：

- **内置地图工坊**（`js/dev/map-editor.js`，1265 行，`?editor=1`）：直接编辑 `map.placed` 里的结构盒体。
  左键旋转、右键平移、滚轮缩放、点击选中、拖动移动、`[` `]` 调高度、`Del` 删除、
  `Ctrl+D` 复制、`Ctrl+Z/Y` 撤销重做。改动以「相对基础地图的 edits」保存，
  试玩时用 `?mapEdits=1` 加载。它改的是**碰撞与掩体结构**，不改地形/贴图/装饰网格。
- **TrenchBroom**：只建议用来画 blockout。本项目地图是运行时导航网格 + 代码合批，
  导 `.map` 进来要自己写解析器和碰撞登记，投入产出比不高。真要接，路径是
  `.map → glTF/OBJ → 一次性脚本转成 placed 数组`，不要做成运行时加载。

> 地图的硬性验收仍然走 `npm run smoke` 里的审计段：越界、悬浮、穿模、点位卡墙、
> 三线连通、包点入口数量。工坊只是让你更快地摆，不替代审计。

### 1.2 模型编辑器是 Blockbench + 内置模型工坊

- **Blockbench** 负责网格：低模、硬表面、手绘贴图，导出 glTF。
- **内置模型工坊**（`?rig=1`）负责挂点：枪在手里的位置、旋转、缩放，导出 JSON，
  不碰玩法与命中判定。

---

## 2. 武器 / 道具资产怎么走

```
js/render/weapon-models.js  ──export.mjs──▶  assets/models/weapons/*.glb
js/render/prop-models.js    ──export-props.mjs──▶  assets/models/props/*.glb
                                                        │
                                    游戏启动 preload ────┘
                                                        ▼
                              glb 存在 → 用它；缺失/加载失败 → 回退程序化几何
```

### 2.1 目录

```
tools/assetgen/
  lib.mjs             GLB 2.0 写入器 + 建模辅助（圆角盒 / 沿 Z 圆柱 / 轮廓挤出）
  export.mjs          导出 8 把武器
  export-props.mjs    导出 8 个战术道具
  preview.html        模型预览器（拖拽旋转 / 滚轮缩放 / 三角面统计）
  shot.mjs            预览器截图（无头 Chrome）
  ingame.mjs          游戏内第一人称截图
  hands.mjs           第一人称手部几何（与运行时同一套坐标）

assets/models/weapons/   ak m4 awp mp9 glock usp deagle knife
assets/models/props/     he flash smoke molotov c4 defuse armor case
```

### 2.2 命令

```bash
# 重新导出全部武器（会覆盖 assets/models/weapons/*.glb）
npm run assets:weapons

# 只导出一把
node tools/assetgen/export.mjs ak

# 重新导出全部道具
npm run assets:props

# 看模型（浏览器打开）
node scripts/serve.mjs
# http://127.0.0.1:5173/tools/assetgen/preview.html?f=/assets/models/weapons/ak.glb

# 无头截图
node tools/assetgen/shot.mjs assets/models/weapons/ak.glb /tmp/ak.png three-quarter
```

### 2.3 用 Blockbench 改模型

1. Blockbench → `File > Import > glTF`，选 `assets/models/weapons/ak.glb`。
2. 改网格 / 加细节 / 换材质。坐标约定：**枪口朝 -Z，Y 向上，1 单位 = 1 米**，
   原点在机匣中心。不要改这个约定，否则第一人称挂点和枪焰位置会错。
3. `File > Export > glTF`，覆盖同名文件。导出时**不要**勾选压缩/ Draco，
   运行时只挂了 `GLTFLoader`，没有 DRACOLoader。
4. 刷新页面即可看到；加载失败会自动回退到程序化模型，不会白屏。

材质名会被映射成游戏内的「材质角色」，皮肤系统按角色换贴图：

| glb 材质名 | 角色 | 用途 |
|---|---|---|
| `gunmetal` / `alloy` | metal | 机匣、导轨 |
| `steel` | steel | 枪管、消焰器 |
| `polymer` / `polymerDark` | polymer | 护木、握把、弹匣 |
| `wood` / `woodDark` | wood | 木托、护木 |
| `olive` | olive | 军绿件 |
| `brass` / `accentRed` | accent | 装饰件 |
| `lens` | lens | 瞄具镜片 |
| `glove` / `sleeve`（及 `*L`） | glove / sleeve | 第一人称手 |

改名可以，但要同步改 `js/render/model-assets.js` 里的 `ROLE_BY_MAT`。

### 2.4 为什么是「导出」而不是「重画」

第一版试过完全手写几何（AK / M4 各 200 行），结论是：
轮廓更干净，但细节密度不如 T-016 已经调过的程序化模型（铆钉、散热孔、快慢机、
背带环这些都在代码里）。所以最终方案是**把现有几何导出成 glb**——视觉不退化，
资产变成可编辑文件，后续在 Blockbench 里加细节不用改 JS。

导出会丢掉 canvas 程序纹理（金属拉丝、木纹），glb 用 PBR 纯色近似。
如果要纹理，在 Blockbench 里贴一张 512×512 的图再导出，效果比运行时 canvas 更好。

### 2.5 性能约束

| 项 | 现状 | 限值 |
|---|---|---|
| 武器 glb | 8 把，2.8k–10.5k tris/把 | 第一人称只显示 1 把 |
| 道具 glb | 8 个，132–4948 tris/个 | 同时最多 3–5 个 |
| 第三人称 | 仍用 `buildProxyWeapon`（合批，1–2 draw call） | 9 个 Bot 不能炸 |

**不要**把 glb 用到 Bot 手持模型上：每把 8–10 个材质 primitive，9 个 Bot 就是
70–90 个 draw call。第三人称继续走程序化简模。

---

## 3. 角色

角色目前是 `assets/models/bacon-avatar.glb`（CC-BY-4.0，见同目录 license），
带骨骼与走路 clip，由 `js/render/avatar-glb.js` 加载。重做角色需要骨骼 + 蒙皮 +
动画三条链路一起换，风险高于收益，本轮没有动。

要换的话，推荐顺序：

1. **three-vrm**（MIT）：VRM 人形自带 humanoid 骨骼，可以直接套 Mixamo 动画，
   改 `avatar-glb.js` 的加载分支即可，不动 `bots.js`。
2. **MakeHuman** 导出 glb：不加运行时依赖，但动画要自己做。
3. 自建 glb：需要 `JOINTS_0` / `WEIGHTS_0` / `skins` / `animations`，
   `tools/assetgen/lib.mjs` 目前只写静态网格，要扩三块。

---

## 4. 验收

```bash
npm run smoke          # 含地图审计 / Bot 进点 / 武器与道具加载
npm run smoke:lobby    # 移动端大厅
node tools/assetgen/export.mjs      # 重导武器后必须重跑
node tools/assetgen/shot.mjs ...    # 目检模型
```

`smoke` 里有一条 `GLB 资产接入` 断言：8 把武器 + 8 个道具必须全部加载成功，
否则视为资产缺失（不是回退通过）。
