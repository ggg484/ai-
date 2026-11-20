# 美术管线

> 目标：把灰盒换成**看起来像 CS:GO 的沙城**，同时不炸包体、不炸显存、不炸帧率。
> 本文档给的是**可执行规格**：每张图的尺寸、格式、命名、放哪、怎么压、怎么验。

红线先说：**不能使用 Valve 的任何原始资产**（贴图、模型、音效、地图几何）。
可以做到的相似度是 80–90%，靠的是同款材质语言（沙岩、灰泥、锈铁、褪色油漆）
和同款光照（高角度硬阳、暖色反弹光、低饱和阴影），不是靠复制文件。

---

## 1. 三阶段，不要跳级

| 阶段 | 做什么 | 工期 | 什么时候做 |
|---|---|---|---|
| **A. 通量验证** | 6 张 1024² WebP 贴图替换 `textures.js`，验证管线通、UV 对、包体涨多少 | 1 天 | **现在** |
| **B. 正式材质** | 14 项材质，KTX2/ETC1S，含法线/AO/粗糙度 | 5–8 天 | A 阶段验收后 |
| **C. 模型与场景** | glTF 道具、正式关卡几何、贴花 | 15+ 天 | B 阶段验收后 |

**A 阶段不要碰 KTX2。** 先用 WebP 把「贴图能不能对上 UV」这个问题解决掉，
再上压缩格式。反过来的话，出问题你分不清是压缩坏了还是 UV 错了。

---

## 2. A 阶段：六张 WebP，一天完成

### 2.1 生产规格

| 项 | 规格 |
|---|---|
| 尺寸 | 1024 × 1024，**必须可平铺**（四边无缝） |
| 格式 | WebP，质量 82，无 alpha |
| 色彩 | sRGB，8 bit/通道 |
| 单张大小 | ≤ 180 KB（超了说明细节过密，远看会脏） |
| 命名 | `assets/textures/t_<材质>_a.webp`（`a` = albedo） |

### 2.2 六张对应的材质

| kind | 文件 | 参考对象 | 关键特征 |
|---|---|---|---|
| `sand` | `t_sand_a.webp` | 沙地/碎石路面 | 细砂 + 小石子，色偏暖黄褐，无明显方向性 |
| `plaster` | `t_plaster_a.webp` | 民居外墙灰泥 | 大面积平整 + 局部剥落露出底层，色偏米白 |
| `brick` | `t_brick_a.webp` | 砂岩砌块墙 | 600×300 砌块，勾缝 8–12 mm，色偏土黄 |
| `concrete` | `t_concrete_a.webp` | 混凝土/水泥 | 冷灰，有气孔和细裂纹，无砖缝 |
| `wood` | `t_wood_a.webp` | 木箱/门板/梁 | 直纹 + 节疤，色偏深棕，有磨损边缘 |
| `metal` | `t_metal_a.webp` | 锈铁桶/铁门 | 底漆 + 锈斑，粗糙度变化大 |

### 2.3 无缝与比例

`map.js` 的 `TILE = 2.6` 意味着**一张贴图覆盖 2.6 m × 2.6 m**。
`scaleBoxUV()` 会按每个面的真实尺寸缩放 UV，所以：

- 砖块画成 600×300 mm，一张 1024² 里放 **4 行 × 4 列**（2.6 m / 0.65 m ≈ 4）
- 灰泥的剥落斑块直径 15–40 cm，太大远看会像污渍
- 沙地的石子 2–8 cm

**判断标准**：站在 1.5 m 处看墙，砖缝宽度应该和真实砖缝一样（约 1 cm）。

### 2.4 接入方式

改 `js/world/textures.js` 的 `material()`，加一条「真贴图优先、Canvas 兜底」的路径：

```js
import { TextureLoader } from '../../vendor/three.module.js';

const loader = new TextureLoader();
const real = new Map();

function loadReal(kind) {
  if (real.has(kind)) return real.get(kind);
  const tex = loader.load(
    'assets/textures/t_' + kind + '_a.webp',
    undefined, undefined,
    () => { real.set(kind, null); }        // 加载失败 → 记 null，回落到 Canvas
  );
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  real.set(kind, tex);
  return tex;
}
```

`material(kind, opts)` 里把 `map: texture(kind, repeat)` 换成
`map: loadReal(kind) || texture(kind, repeat)`。

**注意**：真贴图的 `repeat` 由 `scaleBoxUV()` 已经算进 UV 里了，
所以 `material()` 里的 `repeat` 参数对真贴图**不要再用**（会重复缩放）。
建议真贴图路径固定 `repeat = 1`，只靠 UV 缩放。

### 2.5 A 阶段验收

- [ ] A 大那面墙近看有砂砾和勾缝，远看没有明显重复接缝
- [ ] `npm run pack` 后 `bundle-zip-bytes` 涨幅 < 1.5 MB
- [ ] `?stats=1` 下 `calls` 不变（还是 48）、`tris` 不变（还是 5932）
- [ ] 手机上 fps 下降 < 3
- [ ] 断网（DevTools → Network → Offline）后仍能启动，材质回落成 Canvas 版

最后一条最重要：**任何新资产加载失败都必须能回落**，不能白屏。

---

## 3. B 阶段：十四项材质 + KTX2

### 3.1 材质清单

每项三张图：albedo（`_a`）、normal（`_n`）、ORM（`_orm`，R=AO / G=roughness / B=metalness）。

| # | 材质 | albedo 尺寸 | 备注 |
|---|---|---|---|
| 1 | 沙地 | 2048 | 地面主材质，最大 |
| 2 | 碎石 | 1024 | 沙地变体，混铺用 |
| 3 | 砂岩砌块 | 2048 | 主力墙面 |
| 4 | 灰泥墙 | 2048 | 民居外墙 |
| 5 | 混凝土 | 1024 | 现代结构、楼梯 |
| 6 | 红砖 | 1024 | 局部点缀 |
| 7 | 木板 | 1024 | 箱子、门 |
| 8 | 深色木梁 | 512 | 天花板 |
| 9 | 锈铁 | 1024 | 油桶、铁门 |
| 10 | 涂漆金属 | 512 | 栏杆、管道 |
| 11 | 帆布/沙袋 | 512 | 掩体 |
| 12 | 瓦片 | 1024 | 屋檐 |
| 13 | 焦痕/污渍 | 512 | 贴花，alpha |
| 14 | 弹孔 | 256 | 贴花，alpha |

### 3.2 分辨率预算（这是显存账，不是包体账）

| 格式 | 1024² 单张显存（含 mip） | 2048² 单张 |
|---|---|---|
| RGBA8（WebP 解码后） | 5.3 MB | 21.3 MB |
| ETC1S（KTX2，albedo） | **0.67 MB** | 2.7 MB |
| UASTC（KTX2，normal） | 1.3 MB | 5.3 MB |

按上表 14 项全做，粗算：

- 全 WebP：≈ 60 MB 显存 → 中低端机直接顶到上限
- 全 KTX2：≈ 9 MB 显存 → 安全

**这就是为什么 B 阶段必须上 KTX2。** 包体不是问题（0.2 MB 起），显存才是。

### 3.3 压缩命令

用 Basis Universal 的 `toktx`（或 `basisu`）：

```bash
# albedo：ETC1S，质量 128，开 mip
toktx --t2 --encode etc1s --qlevel 128 --genmipmap \
      assets/textures/t_sandstone_a.ktx2 \
      src/t_sandstone_a.png

# normal：UASTC，质量 2，不能有损太狠（法线错一点光照就崩）
toktx --t2 --encode uastc --uastc_quality 2 --zcmp 18 --genmipmap \
      --input_swizzle rgb1 \
      assets/textures/t_sandstone_n.ktx2 \
      src/t_sandstone_n.png

# ORM：ETC1S，三通道都必须准，用高质量
toktx --t2 --encode etc1s --qlevel 255 --genmipmap \
      assets/textures/t_sandstone_orm.ktx2 \
      src/t_sandstone_orm.png
```

**normal 必须 `--input_swizzle rgb1`**，否则 Z 分量会丢。

### 3.4 接入 three.js

KTX2 需要转码器，**转码器要打进包**（约 300 KB）：

```bash
mkdir -p vendor/basis
cp node_modules/three/examples/jsm/libs/basis/basis_transcoder.{js,wasm} vendor/basis/
```

```js
import { KTX2Loader } from '../../vendor/three/examples/jsm/loaders/KTX2Loader.js';

const ktx2 = new KTX2Loader()
  .setTranscoderPath('vendor/basis/')
  .detectSupport(renderer);           // 必须在 renderer 创建之后

ktx2.load('assets/textures/t_sandstone_a.ktx2', (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
});
```

**坑**：`detectSupport(renderer)` 会检测 GPU 支持哪种格式（ASTC / ETC2 / BC）。
不调它，`load()` 会抛异常。这要求 WebGL2 上下文已经存在——所以 KTX2 的初始化
必须放在 `Engine` 构造之后。

### 3.5 B 阶段验收

- [ ] 14 项材质全部到位，`?cam=top` 俯瞰能分辨出至少 6 种材质
- [ ] 显存占用 < 20 MB（Chrome DevTools → Memory → 或 `renderer.info.memory.textures`）
- [ ] 包体涨幅 < 8 MB
- [ ] `calls` 仍 ≤ 60（合批没被材质数量打散）
- [ ] 中端机（骁龙 7 系 / A13）稳 30 fps 以上
- [ ] 法线贴图在斜光下没出现「塑料感」（这是 UASTC 压太狠的典型症状）

---

## 4. 第一人称武器：从方块到模型

### 4.1 现状

`js/render/viewmodel.js` 用 `BoxGeometry` 拼了 AK 和手枪，全部
`depthTest: false, depthWrite: false, renderOrder: 1000`，靠固定 `basePos/baseRot` 摆在相机前。

**观感是「能认出是枪」，不是「像 CS:GO 的枪」。** 这是刻意的——骨架期的目标是验证
射击手感，不是验证模型精度。

### 4.2 替换规格

| 项 | 规格 |
|---|---|
| 格式 | glTF 2.0 二进制（`.glb`），单文件 |
| 面数 | ≤ 12,000 三角（第一人称只看到枪，不需要 LOD） |
| 贴图 | 1 张 2048² albedo + 1 张 1024² ORM + 1 张 1024² normal，KTX2 |
| 坐标系 | Y 向上，枪口朝 **-Z**，右手在 +X |
| 原点 | 握把底部中点（方便摆位） |
| 骨骼 | **不要骨骼**。用 3 个空节点做动画锚点：`Muzzle`、`Magazine`、`Bolt` |

**为什么不要骨骼**：第一人称武器只有后坐、换弹、切枪三种动作，
用节点位移 + 代码插值就够，骨骼会多一层开销和一大堆导出坑。

### 4.3 必须保留的三个挂点

替换时**删掉这几样东西就会出 bug**：

```js
// 1. 深度设置 —— 没了枪会插进墙里
mesh.material.depthTest = false;
mesh.material.depthWrite = false;
mesh.renderOrder = 1000;

// 2. 枪口锚点 —— 没了枪口火光会跑到世界原点
const muzzle = model.getObjectByName('Muzzle');
this.root.userData.muzzle = muzzle;

// 3. 相机子光源 —— 没了枪在阴影里会变成纯黑剪影
this.camLight = new THREE.PointLight(0xfff0d8, 2.1, 3.0, 2);
camera.add(this.camLight);
```

### 4.4 动画接口

`Viewmodel` 对外只暴露四个方法，换模型时保持签名不变：

```js
setWeapon(id)                 // 'glock' | 'ak'，切换模型
onFire()                      // 后坐 + 枪口火光
update(dt, weapon, player, camera)   // 每帧：摆动/呼吸/换弹位移
muzzlePosition(out)           // 世界坐标枪口位置，给 tracer 用
```

`update()` 里现在的实现是「直接改 `root.position/rotation`」。
换成模型后建议改成「改 `root` 的位置 + 用 `AnimationMixer` 播换弹动画」，
但**不要让动画系统接管 `root` 的位置**——位置由代码算，动画只管局部姿态。

---

## 5. 光照配方

这套参数是照着「正午沙漠、高角度硬阳、暖色反弹」调的，改之前先截图对比。

```js
// 天空（ShaderMaterial，三层渐变 + 太阳光斑）
zenith  = 0x7fa8d6   // 天顶冷蓝
horizon = 0xe8d4ae   // 地平线暖白
ground  = 0xa8855c   // 地面反弹暖褐
sunDir  = (0.55, 0.62, 0.45)   // 高角度，约 38°

// 半球光：天空色 / 地面色，强度 0.85
new THREE.HemisphereLight(0xa9c7e8, 0xc9a87c, 0.85)

// 主光：暖白，强度 2.15，位置 (38, 52, 22)，1024² 阴影
new THREE.DirectionalLight(0xfff0d2, 2.15)

// 雾：暖沙色，46 m 起，130 m 全遮
scene.fog = new THREE.Fog(0xd8c6a4, 46, 130)

// 色调映射：ACES Filmic，曝光 1.02
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
```

**关键判断**：如果换完材质觉得「发灰、发闷」，99% 是 `toneMappingExposure` 太低
或者 `HemisphereLight` 强度不够，**不要去提高材质本身的亮度**。
ACES 会把高光压回来，靠提亮材质只会让暗部一起变灰。

**阴影**：`shadow.normalBias = 0.025` 是为了消除 AABB 大平面的自阴影条纹（shadow acne）。
换正式几何后可以降到 0.01，太大（>0.05）会让接触阴影「浮起来」。

---

## 6. 包体核算方法

每加一批资产，跑一次：

```bash
npm run pack
# [pack] dist files = N  raw = X MB
# [pack] zip = builda-web.zip  Y MB
```

记一张表，放在 `docs/ASSET-BUDGET.md`（自己建）：

| 批次 | 内容 | raw | zip | 涨幅 |
|---|---|---|---|---|
| 骨架 | 代码 + three.js | 0.76 MB | 0.20 MB | — |
| A | 6 张 WebP | ? | ? | ? |
| B | 14 项 KTX2 | ? | ? | ? |

**预算线**：zip 到 **30 MB** 开始注意，到 **80 MB** 开始拆 `assets.zip`，
到 **150 MB** 触发计划书里的低多边形评估（需书面确认）。

现在 0.2 MB，还有 150 倍空间。**不要提前优化。**

---

## 7. 素材来源的合法边界

| 来源 | 能用吗 | 条件 |
|---|---|---|
| Valve 原始资产（CS:GO / CS2 的 vpk） | **不能** | 版权，且会被平台审核识别 |
| 自己拍摄/绘制的材质 | 能 | 推荐，CC0 自产 |
| Poly Haven / ambientCG | 能 | CC0，需在 `CREDITS.md` 注明来源 |
| Quixel Megascans（免费额度） | 能 | 遵守其 EULA，不能转售原始素材 |
| Sketchfab CC-BY | 能 | 必须署名，写进 `CREDITS.md` |
| AI 生成（平台 `builda gen image`） | 能 | 注意风格一致性，别混着用 |

**必须建 `CREDITS.md`**，每条写：文件名、来源 URL、许可证、作者。
平台审核会查，缺了会被打回。

---

## 8. 一句话总结

先用 6 张 WebP 把管线跑通（1 天），再用 14 项 KTX2 把显存压住（1 周），
最后才动模型和关卡。**顺序反了就会在「为什么手机上这么卡」里困三天。**
