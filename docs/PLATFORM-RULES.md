# 平台硬规则

> 这些规则不是建议。违反其中任何一条，轻则上传被 `bundle-check` 拒绝，
> 重则审核打回或线上黑屏。每条都标了「**本工程怎么做的**」，照抄即可。

来源：`docs/platform/02-包规范与拒收清单.md`、`04-SDK功能地图.md`，以及 `bundle-check` 的实际校验行为。

---

## 1. 包结构

### 1.1 zip 根必须是 `index.html`

不能多套一层目录。`dist/builda-web/`、`builda-web/` 都会被拒，报
`index.html not found at zip root`。

**本工程怎么做的**：`scripts/pack.mjs` 在 `dist/` 内部执行 `zip -r`，
所以 zip 根就是 `index.html`。

```bash
unzip -l builda-web.zip | head    # 第一行应该是 index.html，不是目录
```

### 1.2 `<head>` 必须有根相对 SDK 引用

```html
<script src="builda-sdk.js"></script>
```

必须是 `src="builda-sdk.js"`，不能是 `./builda-sdk.js`、不能是 CDN、不能被构建工具内联。

**本工程怎么做的**：`index.html` 第 12 行。`pack.mjs` 会用 `html.includes('src="builda-sdk.js"')` 自检。

### 1.3 SDK 文件本身不能进 zip

线上由 App 注入。打进去会被判定冲突。

**本工程怎么做的**：`pack.mjs` 只复制 `index.html` / `mobile-perf.js` / `css/` / `js/` / `vendor/three.module.js` / `assets/`，
且显式断言 `builda-sdk.js` 不在 `dist/` 里。本地预览用 `scripts/serve.mjs` 把
`/builda-sdk.js` 映射到 `.builda-agent/sdk/web/builda-sdk.js`。

### 1.4 禁止出现的文件

| 类别 | 具体 |
|---|---|
| 依赖/源码 | `node_modules/`、`src/`、`.env`、`*.map`、`*.d.ts` |
| 版本控制 | `.git/`、`.github/`、`.vscode/`、`.idea/`、`.DS_Store` |
| 预压缩 | `*.br`、`*.gz` |
| 包内 SDK | `builda-sdk.js` |

**本工程怎么做的**：`pack.mjs` 用正则 `/(^|\/)(node_modules|\.git|src)(\/|$)/` 和 `/\.(map|env|br|gz)$/` 扫全树，
命中就抛错。注意 `vendor/three.module.js` 是**源码**不是 sourcemap，合法。

### 1.5 路径分隔符与编码

必须是 `/`，不能有 `\`、盘符、`..`、绝对路径。UTF-8，不要带 BOM 的异常文件名。

**坑**：Windows 的 `Compress-Archive` 会写反斜杠路径，直接被拒。
用 7-Zip 或 WSL 的 `zip`。

---

## 2. 体积配额

| 项 | 限制 | 本工程当前 |
|---|---|---|
| 主包 zip | 200 MiB（首发同）；老游戏可白名单放宽到 500 MiB | **0.20 MB** |
| 50 MiB | 只打印 `bundle-size-hint`，**不阻断** | — |
| `assets.zip` | 压缩 340 MiB（可放宽 500）、解压 ≤1024 MiB、单文件 ≤32 MiB、≤10000 文件 | 未使用 |
| 单个 `.wasm` | ≤1 GiB | 未使用 |

**结论**：当前包体占预算 0.1%，**没有任何理由为体积降画质**。
计划书里那条「低多边形保底」的硬触发条件是首包 > 150 MiB 且拆包两轮仍超限——
现在离这条线还有 750 倍。

---

## 3. 浏览器兼容性

`upload-build` 会顺着 `index.html` 扫实际加载的 JS，打印：

```
bundle-compat-required-chrome=88
bundle-compat-finding=js/xxx.js:12:5 …
bundle-compat-fix-item=…
```

`create-draft` 会拒绝 `minChromeMajor` 低于扫描值的草稿。

### 禁用清单

| 写法 | 最低 Chrome | 替代 |
|---|---|---|
| `??=` `||=` `&&=` | 85 | 展开成 `if` |
| 私有方法 `#x()` | 84 | 普通方法 + `_` 前缀 |
| 顶层 `await` | 89 | 包进 `async function main()` |
| `class { static {} }` | 94 | 静态初始化块外置 |
| `structuredClone` | 98 | `JSON.parse(JSON.stringify())` |
| `crypto.randomUUID` | 92 | 自写（见下） |
| `CanvasRenderingContext2D.roundRect` | 99 | 自绘圆角 |
| `Array.prototype.at` | 92 | `arr[arr.length-1]` |
| `Object.hasOwn` | 93 | `Object.prototype.hasOwnProperty.call` |

**本工程怎么做的**：全部代码手写 ES2020，零 polyfill、零 Babel。
`builda.publish.json` 声明 `minChromeMajor: 88`、`minIOSMajor: 15`，与实测扫描值一致。

### 需要 UUID 时

```js
function uuid() {
  const b = new Uint8Array(16);
  (self.crypto || self.msCrypto).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
```

`crypto.getRandomValues` 从 Chrome 11 就有，安全。

---

## 4. 生命周期

### 4.1 `runtime.ready()` 必须第一句

30 秒内宿主没收到握手，**直接关游戏**。不能等资源加载完再调。

**本工程怎么做的**：`js/main.js`

```js
import { ready } from './platform/builda.js';
import { Game } from './game.js';

ready();                    // ← 第 5 行，早于一切

const canvas = document.getElementById('game');
const game = new Game(canvas);
```

`ready()` 内部是同步发起的（`.catch()` 吞掉 rejection），所以不会阻塞首帧。

### 4.2 暂停必须合并两个事件

平台的暂停有**两个独立来源**，漏一个就会出现「切后台还在跑，回来已经死了」：

```js
Builda.events.on('appVisibility', ({ visible }) => …)   // 切后台 / 回来
Builda.events.on('pausePanel', ({ visible }) => …)      // 平台暂停面板弹出
```

**本工程怎么做的**：`js/platform/builda.js` 的 `onPauseChange(cb)` 内部维护
`appVisible` 和 `panelVisible` 两个布尔，任一为真就 `cb(true)`。
`js/game.js` 的 `_updatePauseState()` 再把平台暂停和本地设置面板合并。

### 4.3 不要自己管静音

平台统一管理音频，游戏内自建静音开关会被审核打回。

**本工程怎么做的**：设置面板只有**灵敏度 / FOV / 画质**三项，**没有音量、没有静音**。
这是刻意的，不是没做完。要加设置项时请绕开音频。

### 4.4 常亮要容错

`runtime.setKeepScreenOn(true)` 需要 App ≥ 1.84.0，老宿主返回 `UNSUPPORTED_CMD`。

**本工程怎么做的**：`keepScreenOn()` 里 `.catch(function(){})` 吞掉，不检查返回值。

---

## 5. 存档

`privateKV` 是**最后写入赢**，没有版本号、没有 CAS、没有事务。批量 `setMany` 要么全成要么全败。

| 限制 | 值 |
|---|---|
| 单值 | ≤ 32 KB |
| 单批 | ≤ 32 key |
| 每人每游戏 | ≤ 100 key |

**能用它存**：设置、进度、最佳分数、已解锁列表。
**不能用它存**：多人对局的权威状态、需要原子性的经济数据。

**本工程怎么做的**：只存一个 key `settings_v1`，内容是
`{ sensitivity, fov, quality, invertY }` 的 JSON，约 80 字节。
`loadSettings()` 解析失败会回落默认值，不会因为一次脏数据卡死。

**改 key 名 = 丢存档**。要升级结构就在值里加 `version` 字段做迁移，不要改 key。

---

## 6. 音频

```js
Builda.audio.playSFX(path, { volume, pitch, … })
```

- `path` 是**包内相对路径**，本工程约定 `audio/sfx/<name>.ogg`
- **不支持声像（pan）**。需要左右定位就自己做 WebAudio 混音，或者接受"听不出方向"
- 平台管静音，`playSFX` 在静音时返回 `available: false`

**本工程怎么做的**：`js/platform/builda.js` 的 `playSfx()` 返回布尔；
`js/core/audio.js` 的 `AudioBus` 优先走平台，失败或没有宿主就走 WebAudio 合成。
**合成音是降级路径，不是最终方案**——正式资产放 `assets/sfx/*.ogg` 就会自动生效。

命名约定（`audio.js` 里已经用到这些名字）：

```
shot_rifle  shot_pistol  hit  headshot  reload  empty
step  beep  plant  explode  win  lose
```

---

## 7. 上架元信息

`builda.publish.json` 里这几项**上线后不能改**：

| 字段 | 为什么不能改 |
|---|---|
| `category` | 影响推荐位归类 |
| `orientation` | 与包内布局绑定 |
| `rankBoards[].rankId` | 改名等于换榜，历史成绩不迁移 |
| `payId` | 改名等于换商品，已购玩家丢失权益 |

本工程当前：

```json
{
  "category": "shoot",
  "engine": "h5",
  "orientation": "landscape",
  "minChromeMajor": 88,
  "minIOSMajor": 15,
  "buildEntry": "index.html"
}
```

要加排行榜或内购，**先在 `builda.publish.json` 里声明**再调 API，否则宿主直接拒。
本骨架没有声明 `rankBoards` 也没有声明 `iap`，所以现在**调 `rank.submitScore()` 会失败**——
这是预期行为，别以为是 SDK 坏了。

---

## 8. 移动端性能

### 8.1 `?dpr=N` 是宿主下发的

宿主会在 URL 上带 `?dpr=1` 或 `?dpr=1.5` 之类的值，游戏必须**在创建渲染器前**把它应用到
`devicePixelRatio`。

**本工程怎么做的**：`mobile-perf.js`（官方脚本，原样落地，勿改）

```js
Object.defineProperty(window, 'devicePixelRatio', {
  get() { return Math.min(realDpr, cap); }
});
```

`index.html` 里的加载顺序必须是：`builda-sdk.js` → `mobile-perf.js` → `css` → `main.js`。
**改这个顺序会让 dpr 限制失效，手机上直接掉一半帧。**

### 8.2 画质档位

`Engine.setQuality('low'|'medium'|'high')`：

| 档位 | dpr 上限 | 阴影 | 阴影图 |
|---|---|---|---|
| low | 1 | 关 | — |
| medium | 2 | 开 | 1024² |
| high | 3 | 开 | 2048² |

默认 `medium`。中端机建议默认 `medium`，低端机让玩家自己切 `low`。

### 8.3 不要每帧分配

GC 停顿在手机上表现为「一秒卡一下」。本工程的做法：所有临时向量复用
（`game.js` 里的 `_tmp` / `_tmp2` / `_muzzle`），特效走对象池（24 tracer + 20 impact）。

新代码要临时向量时，**传 `out` 参数**，不要 `new THREE.Vector3()`。

---

## 9. 上线前自查

```bash
# 1. 打包（含包规范自检）
npm run pack

# 2. 平台硬校验，必须全绿
bash .builda-agent/builda bundle-check --engine h5 builda-web.zip
#    bundle=ok
#    bundle-engine=h5
#    sdk-injected=ok
#    bundle-compat-required-chrome=88   ← 不能高于 publish.json 里的 minChromeMajor
#    bundle-zip-bytes=213xxx

# 3. 肉眼看根结构
unzip -l builda-web.zip | head

# 4. 手机壳调试（切刘海、切身份、模拟支付）
bash .builda-agent/builda dev --web dist
```

最后一条会用 `dev-url` 起一个带手机壳的测试页，可以切横竖屏、切刘海验证安全区、
用 `&builda_mock_player=<id>&builda_mock_name=<名字>` 换身份验证 KV 隔离。

**只有真机才准的**：真实支付、真实广告、宿主音频通道、性能与发热。
上线前必须真机跑一遍，模拟器不算。
