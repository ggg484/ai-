# SDK 功能地图

> 平台能力都在 `window.Builda` 下（H5）；Godot 走 `addons/builda` 的封装，Unity 走 `BuildaSDK`，方法名一一对应。
> 下文写的 `.builda-agent/…` 都指 **`game/.builda-agent/…`**。
> **先读** `game/.builda-agent/sdk-guidance/0.26.6/SKILL.md`（按任务路由），再按下面的表跳到具体文档。
> 本包的 `game/game.js` 已经把 1、2、12、13 这四项写成了可运行代码，可以直接抄。

## 1. 能力总表

| 能力 | 用途 | 关键 API / 限制 | 文档 |
|---|---|---|---|
| 就绪握手 | 告诉宿主「游戏起来了」 | `runtime.ready()`，入口第一句；30 秒没握手会被关 | `md_sdk_lifecycle.md` |
| 身份 | 昵称、头像、角色 ID | `whoami()` → `{id,name,avatar}` | `md_sdk_player.md` |
| 私有存档 | 跨设备进度、最佳分数 | `privateKV.get/set/getMany/setMany/remove`；单值 ≤32 KB，单批 ≤32 key，每人每游戏 ≤100 key | `md_sdk_player.md` |
| 玩家数据（只读） | 服务端写入的存档观察 | `playerData.getMany/listKeys`；**可能过期，不能当权威状态** | `md_sdk_player.md` |
| 服务令牌 | 让游戏服务器调平台服务 | `requestToken()`；只放内存，不落盘不进 URL | `md_sdk_player.md` |
| 动态配置表 | 不发版改数值/开关 | `Builda.config.*`；表对所有玩家可读，**不要放密钥** | `md_agent_config_tables.md`（官方主题） |
| 内购 | 卖道具/皮肤 | `iap.showPayPanel(saleId,{grantBy})` → 成功后按 `orderId` **幂等发货** → `iap.claim(orderId)`；掉单用 `getPendingOrderIds()` 补 | `md_sdk_iap_ads.md`、`md_cysj_app.md` §6.2.2 |
| 激励广告 | 复活/加倍 | `ad.showRewardAd(posId)`；`posId` 自己命名，只用于统计，不用申请 | `md_sdk_iap_ads.md` |
| 排行榜 | 好友/全服榜 | 先在清单 `rankBoards` 声明，再 `rank.submitScore/getRankList`；`rankId` 一旦上线不可改 | `md_sdk_rank.md`、`md_rankboards.md` |
| 音频 | BGM / 音效 / 静音 / 震动 | `audio.playBGM/stopBGM/playSFX/setMuted/vibrate` | `md_sdk_assets.md` |
| 麦克风 | 吹气/音量/音高玩法 | 优先用内置 `BuildaMic` 组件；PCM 只许本地实时分析，**不许留存或上传** | `md_sdk_mic.md` |
| 陀螺仪 | 倾斜操控 | 直接用浏览器 `deviceorientation`；iOS 需 `requestPermission()`，App<1.84 一律拒绝，必须给触屏兜底 | `md_sdk_gyro.md` |
| 安全区/胶囊 | 刘海、右上角平台按钮避让 | `runtime.safeArea()`、`runtime.capsuleMenuRect()` | `md_sdk_ui.md` |
| 文本输入 | 起名、聊天输入 | `input.showInputPanel({placeholder,maxLength})`；同一时刻只能一个 | `md_sdk_ui.md` |
| 语言 | 跟随宿主语言 | `runtime.language()`（`zh`/`en`/`es-419`…，无地区后缀） | `md_sdk_ui.md` |
| 生命周期 | 切后台暂停、平台暂停面板 | `events.on("appVisibility")`、`events.on("pausePanel")` | `md_sdk_lifecycle.md` |
| 常亮 | 挂机/长动画 | `runtime.setKeepScreenOn(true)`（App ≥1.84.0，老宿主返回 UNSUPPORTED_CMD） | `md_sdk_lifecycle.md` |
| 退出 | 主动退出到平台 | `runtime.quit()`；会弹平台通用暂停/退出页 | `md_sdk_lifecycle.md` |
| 大资源 | 模型/大图/视频动态加载 | `assets.url("res/…")`；资源包走 `builda assets upload` | `md_sdk_assets.md`、`md_bundle_size.md` |
| 性能 | 发热/掉帧/DPR | `?dpr=N` 由宿主下发；限制分辨率、少 GC | `md_mobile_perf.md` |
| 字体 | 中文显示 | H5 用系统字体栈；Unity WebGL 必须嵌子集字体；Godot 见 i18n | `md_cjk_font.md`、`md_godot_i18n.md` |
| 持久 ID | 上线后不能改的键 | `payId`、`rankId`、privateKV key、`schemaId` 都按「只增不改」设计 | `md_persistent_ids.md` |

## 2. 三条最容易写错的地方

### 2.1 支付：成功 ≠ 发货

```
showPayPanel → { success, orderId, grantBy }
  grantBy = "client" → 客户端按 orderId 幂等发货 → iap.claim(orderId)
  grantBy = "room"   → 把 orderId 交给 Room 的 doOrder，客户端不发货、不 claim
```

- 发货必须**幂等**（同一 orderId 重复调用只发一次）
- 启动时用 `getPendingOrderIds()` 补上次没发完的单
- 老接口 `pay.showPayPanel` 只给存量游戏用，新游戏不要用

### 2.2 存档：privateKV 是「最后写入赢」

没有版本号/CAS，也没有事务；批量 `setMany` 要么全成要么全败。适合存进度、设置、最佳分数，不适合当多人游戏的权威状态。

### 2.3 排行榜：先声明再调用

`rankBoards` 没在 `builda.publish.json` 里声明并随版本发布，`submitScore` 会被宿主拒绝。
`rankId` 上线后改名等于换榜，历史成绩不迁移。

## 3. 调试这些能力（不用真机也能测大半）

```bash
cd game
./.builda-agent/builda dev --web dist
```

输出里的 `dev-url` 是带手机壳的测试页，可以：

- 切横竖屏、切刘海（验证 `safeArea()` / `capsuleMenuRect()`）
- 改 `&builda_mock_player=<id>&builda_mock_name=<名字>` 换身份（验证 `whoami()`、KV 隔离）
- 点支付/广告会弹模拟面板，手动选「成功/失败」，把两条分支都走一遍

真机才准的只有：真实支付、真实广告、宿主音频通道、性能与发热。

## 4. 命令行附带的运营能力

| 命令 | 用途 |
|---|---|
| `builda diagnostics ...` | 查玩家存档、日志、配额、异常 |
| `builda comments ...` | 读/回/删自己游戏的评论 |
| `builda player-feedback ...` | 读玩家反馈 |
| `builda config push/list/rollback` | 动态配置表 |
| `builda gen audio\|music\|image\|model3d` | 生成素材（消耗 Builda Credits，先 `--dry-run` 看价） |
| `builda cloud-advisories ...` | 云端设计建议（存档结构、配额等） |

这些都需要先 `builda auth`。
