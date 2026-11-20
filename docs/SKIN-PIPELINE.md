# 皮肤管线规范（变现资产）

> 这份文档回答一个问题：**这个游戏靠什么赚钱，技术上要怎么支撑它。**
>
> 结论先给：靠枪皮、刀皮。所以视角模型与皮肤系统的质量，是本项目商业价值的天花板。
> 对局做得再还原，皮肤卖不出去，项目就是亏的。

---

## 1. 商业模型对技术的三个硬约束

### 1.1 皮肤必须是"独特"的，不能是"换色"

CS 皮肤的价值来自两件事：**图案随机性**（同一款皮肤，每把花纹位置不同）和**磨损度**（0.00–1.00，从崭新到战痕）。
这两个机制让同一款皮肤能卖出成千上万把，且每把"看起来不一样"。

**技术含义**：皮肤不能用"一个皮肤 = 一张贴图"实现。必须是：

```
最终外观 = f(基础漆层贴图, 磨损遮罩, wearFloat, patternSeed, 光照)
```

- `wearFloat`：0–1，控制漆层剥落程度（露出底层金属）
- `patternSeed`：0–1，控制图案在 UV 上的偏移/旋转（同一张贴图，不同位置）

这套机制让 **一套贴图 → 无限种外观**，是营收的杠杆。做不出来，皮肤就只能当 DLC 卖，天花板低一个数量级。

### 1.2 皮肤必须"看起来贵"

玩家在 0.5 米距离（第一人称视角）盯着枪看 40 分钟。以下细节直接决定付费意愿：

| 细节 | 要求 | 为什么 |
|---|---|---|
| 高光形状 | 金属件必须有**拉丝/镜面**的区别，不能是均匀灰 | 均匀 = 塑料感 = 廉价 |
| 边缘磨损 | 棱角处漆层剥落，露出金属底色 | 真实使用痕迹 = 有故事 = 值钱 |
| 指纹/油污 | 握把、扳机护圈有轻微 roughness 变化 | 微观细节 = 高级感 |
| 图案贴合 | 图案必须绕枪身连续，不能在接缝处断裂 | 断裂 = 廉价贴纸 |
| 检视动画 | 转枪时高光沿枪身流动 | 静态好看不够，必须"动起来好看" |

### 1.3 皮肤不能影响平衡

**纯外观，零数值。** 这是底线，也是玩家信任的基础。
技术上：皮肤只替换 `viewmodel` 的 mesh 与 material，不进入任何 gameplay 计算路径。

---

## 2. 技术方案

### 2.1 渲染层：一套 shader 支撑所有皮肤

不要为每个皮肤创建独立材质（shader 变体爆炸，移动端编译卡顿）。
用一个自定义材质 `SkinMaterial`，通过 uniform 传参：

```js
// 伪代码，实现在 js/render/skin-material.js（待创建）
const mat = new SkinMaterial({
  baseMap,        // RGB = 漆层颜色
  wearMaskMap,    // R = 磨损阈值（0=不易磨，1=易磨）, G = 金属度, B = 粗糙度
  normalMap,
  wear: 0.12,     // uniform, 0-1
  patternSeed: 0.47, // uniform, 0-1
  patternScale: 1.0,
  metalColor: 0x8a8f94
});
```

**Shader 逻辑**（关键 20 行，决定一切）：

```glsl
// 图案偏移：同一贴图，不同 seed 看到不同区域
vec2 uv = vUv;
float ang = patternSeed * 6.28318;
uv = rotate(uv - 0.5, ang) + 0.5 + vec2(patternSeed * 0.37, patternSeed * 0.61);

// 磨损：遮罩值低于 wear 的位置露出金属
float wearMask = texture2D(wearMaskMap, uv).r;
float bare = smoothstep(wearMask - 0.03, wearMask + 0.03, wear);

vec3 paint = texture2D(baseMap, uv).rgb;
vec3 metal = metalColor * (0.6 + 0.4 * texture2D(normalMap, uv).b);
vec3 albedo = mix(paint, metal, bare);

// 粗糙度：漆面偏粗糙，金属偏光滑
float rough = mix(texture2D(wearMaskMap, uv).b, 0.28, bare);
```

**为什么这么做**：
- 一套贴图 + 两个 uniform → 无限外观
- 只有一个 shader program，移动端只编译一次
- `wear` 和 `patternSeed` 可以存进 `privateKV`（单条 ≤ 32KB，够存一件皮肤的参数）

### 2.2 资产规格

| 项 | 规格 | 说明 |
|---|---|---|
| 贴图尺寸 | 2048×2048（主武器）/ 1024×1024（手枪、刀） | 移动端够用，配合 KTX2 压缩后单张 ≈ 1.5 MB |
| 压缩格式 | **KTX2 + Basis Universal**（`KTX2Loader`） | 显存占用降到 1/4，加载快 3 倍 |
| 通道打包 | 一张图塞三通道：`R=磨损阈值 G=金属度 B=粗糙度` | 少两张图，省 30% 显存 |
| 模型格式 | glTF 2.0 → 转 GLB，**meshopt 压缩** | 与 three.js 原生兼容 |
| 三角面 | 主武器 8k–15k / 刀 5k–10k | 这个预算够精致，不要以"移动端"为由压到 2k |
| 骨骼 | 3 段起（手臂-手腕-武器），命名固定 `arm_root / wrist / weapon` | 检视动画需要 |
| 动画 | `idle / fire / reload / inspect / draw` 五个 clip | 缺一个都不能上架 |

### 2.3 目录与命名

```
assets/weapons/
  ak47/
    ak47_default.glb           # 默认外观几何 + 骨骼
    ak47_default_skin.json     # 材质参数
    tex/
      ak47_default_base.ktx2
      ak47_default_wear.ktx2
      ak47_default_normal.ktx2
  skins/
    ak47_redline/
      base.ktx2  wear.ktx2  normal.ktx2
      meta.json                # { name, rarity, wearRange:[0,1], patternScale }
```

**命名规则**：`<武器>_<皮肤名>`，全小写，下划线分隔，不用空格和中文（打包与 CDN 安全）。

### 2.4 与现有代码的接入点

骨架里已经预留好了：

| 位置 | 现状 | 要做的事 |
|---|---|---|
| `js/render/viewmodel.js` | 程序化几何（`buildRifle/buildPistol`） | **整个替换**为 GLB 加载 + 骨骼 + AnimationMixer |
| `js/config/weapons.js` | 只有数值 | 增加 `skin` 字段指向 `meta.json` |
| `js/render/engine.js` | 标准 `MeshStandardMaterial` | 增加 `SkinMaterial`，`onBeforeCompile` 注入磨损逻辑 |

**替换 `viewmodel.js` 是 P1 里优先级最高的一件事**，因为它同时解决"手是方块"和"皮肤无法上架"两个问题。

---

## 3. 刀皮的特殊性

刀是第一人称**只有一只手 + 一把刀**，占屏比枪更大，且**检视动画是核心卖点**（玩家买刀就是为了转刀）。

要求：

- 刀型必须独立建模，不能"枪改刀"
- 检视动画 ≥ 3 秒，有起手、旋转、收势三段
- 刀面高光必须锐利（metalness 0.95+，roughness 0.15–0.25）
- 刀刃与刀柄材质必须区分（这是最容易做糙的地方）

**建议**：先把一把刀做到"能卖"，再复制到其他刀型。**一把精刀 > 五把糙刀。**

---

## 4. 量产效率（G6 质量门的指标）

上线前必须达到：**一件新枪皮从建模到进游戏 ≤ 3 人日**。

拆解：

| 环节 | 目标耗时 | 工具 |
|---|---|---|
| 建模 + UV | 1 人日 | Blender，统一模板 |
| 贴图（漆层 + 磨损遮罩） | 1 人日 | Substance Painter，统一智能材质 |
| 参数配置 + 进游戏验证 | 0.5 人日 | `meta.json` + 热重载 |
| 检视动画适配 | 0.5 人日 | 复用 `inspect` 模板，只调时长 |

达不到这个效率，皮肤更新跟不上，营收模型不成立。
**所以工具链（导入脚本、预览页、参数热重载）要在 M2 就做好，不能等到有 50 个皮肤了才想起来。**

---

## 5. 反面清单（这些做法会让皮肤卖不动）

| 做法 | 后果 |
|---|---|
| 用顶点色代替贴图 | 没有细节，看起来像 2005 年游戏 |
| 所有皮肤共用一个 normal map | 高光一模一样，玩家觉得"就是换个颜色" |
| 磨损只是"整体变暗" | 没有剥落感，失去 CS 皮肤的灵魂 |
| 检视动画省略 | 刀卖不动（买刀就是为了转） |
| 为了省包体把贴图压到 512 | 贴脸一看糊，付费意愿归零 |
| 皮肤材质和场景材质共用 shader | 光照不匹配，皮肤"浮"在场景上 |

---

## 6. 立刻能开工的第一件事

**做一把 AK 的"红line"级别皮肤，走通全链路**：

1. Blender 建 AK 低模（8k 面）→ 展 UV → 导出 GLB
2. Substance 画漆层 + 磨损遮罩 → 导出 KTX2
3. 写 `SkinMaterial`（上面那段 shader）
4. 替换 `js/render/viewmodel.js` 的 `buildRifle()`
5. 在游戏里用 `?skin=ak47_redline&wear=0.15&seed=0.47` 加载
6. 截图对比原版 CS 同款皮肤，差距 ≤ 20% 才算过

这一件事做完，整个皮肤管线的技术风险就清掉了。**预计 5–8 人日**（含学习曲线）。

---

*本文档受 `PRINCIPLES.md` 准则二约束。任何"先随便贴个颜色试试"的做法，只允许存在于
`assets/` 之外的临时目录，不得进入 `dist/`。*
