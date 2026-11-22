# 参考项目审计：ETO-ze/dust2-web

- 仓库：https://github.com/ETO-ze/dust2-web/
- 审计时间：2026-11-22
- 结论：**代码可以借鉴，地图/贴图/音频不能直接搬。**

## 许可证

| 内容 | 许可证 | 能否直接用 |
|---|---|---|
| 源码、文档 | MIT | 可以，需保留版权与许可声明 |
| 9 张 CS 地图的网格、贴图、导航数据 | Valve / 第三方，见 `THIRD-PARTY-NOTICES.md` | **不能**直接复制 |
| 地图音乐、角色模型、部分音效 | 第三方，见 `docs/ASSETS.md` | 需逐个确认，不能默认 MIT |
| Quaternius 角色、Kenney 音效 | CC0 | 可以，但本项目未使用 |

`README` 也写明：项目代码 MIT，但地图与游戏素材版权归 Valve/各自作者。

## 可借鉴的内容

1. **地图注册表 / 地图池**
   - `shared/public-map-pool.js`、`shared/performance-map-pool.js`
   - 思路：每张地图一个 id + 元数据 + 加载函数；我们用自己的 `js/world/maps.js` 重写。

2. **平面色块风格**
   - `client/flat-map-materials.js`、`client/flat-map-renderer.js`
   - 思路：墙体、地面、金属、木箱、目标点使用有限的暖色/冷色色板；我们借鉴了“暖砂岩 + 深色金属 + 红/蓝目标色”的方向，没有复制代码或贴图。

3. **地图元数据契约**
   - `shared/map-data.js`：spawns / sites / bounds / overview
   - 只把它当作字段设计的参考；没有复制 Valve 的坐标或导航数据。

4. **质量/性能地图测试**
   - `tests/quality-map-layout.mjs`、`client/quality-map-layout.js`
   - 思路：检查出生点、包点、路径点是否卡墙；我们的 `DEV · 地图审计` 已能报“点位卡墙 / 出生点卡墙”。

## 没有采用的内容

- Valve 地图 GLB、贴图、导航网格、音频、角色皮肤
- 任何需要下载 1.29 GB 资产包的内容
- 直接复制 Dust2 几何体

## 本项目的新地图

`OASIS / 绿洲` 是原创程序化几何：

- A 长 / B 公寓 / 中路窗口的三角关系参考了 Dust2/Mirage 的布局思路
- 所有墙体、平台、掩体、棕榈树、遮阳篷都由 `js/world/map-oasis.js` 生成
- 使用项目自己的 `textures.js` 材质与 `engine.setMood('oasis')` 暖色天空
- 没有复制参考项目的任何地图网格或贴图

加载方式：

```text
?map=oasis
```

或大厅“选择对局模式”面板底部的地图选择器。
