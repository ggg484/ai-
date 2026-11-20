# 联机 Room

> 只有「真的要做多人」时才看这一页。单人游戏完全不需要 `builda.online.json`、`server/`、`vendor/`。
> 官方原文：`docs/官方主题/md_agent_online.md`；更细的流程在 `game/.agents/skills/builda-online/SKILL.md` 与它的 `references/`。

## 1. 它是什么

Builda Online 是独立于客户端打包的一套联机工具链，和主 SDK **同版本发布**：

| 角色 | 说明 |
|---|---|
| 客户端 SDK | `vendor/builda-online/client-sdk/h5`（本包已带 0.20.1） |
| Room 服务端 | 你写一个 TypeScript/Rust 文件，平台托管运行 |
| Room Mock | 本地模拟网关，`ws://127.0.0.1:7350/ws`，用于本地双人调试 |
| 部署 CLI | `game/.builda-online/bin/builda-online` |
| 本地清单 | `builda.online.json`：matchKey、房间容量、tickRate、协议 revision |

版本锁只有一个：`game/.builda-agent/sdk-version`。`.builda-online/installation.json` 的 `releaseId` 必须与它一致。

## 2. 本包里的联机目录

```
game/
├── builda.online.example.json      ← 模板：需要联机时改名成 builda.online.json
├── builda.room.local.example.json  ← 本地 mock 的场景模板
├── server/
│   ├── room/                       ← 你的 Room 源码放这里（单个 .ts 文件）
│   ├── typescript/                 ← Room SDK（@cysj/room）
│   └── mock/typescript/            ← 本地 Room Mock
├── vendor/builda-online/client-sdk/h5/   ← 客户端 SDK
├── contracts/                      ← room-contract.json / resource-limits.json / 场景
└── .agents/skills/builda-online/   ← 官方联机技能（先读 SKILL.md）
```

## 3. 概念对齐

| 概念 | 含义 |
|---|---|
| `matchKey` | 匹配池的名字。一个游戏可以有多个（例如 `main` / `lobby`），客户端 `joinRoom(matchKey)` |
| `mode` | `room`（平台开房）等 |
| `teamCount` / `teamSize` | 分队数与每队人数 |
| `roomType` | `authoritative`（服务端权威，逻辑在 Room）或中继型 |
| `tickRate` | Room 每秒逻辑帧，常用 10；越高越贵 |
| `onlineCompatibilityRevision` | **客户端与 Room 的游戏协议版本**。只在「老客户端读不懂新协议」时 +1，日常改文案/UI 不动它 |

## 4. 本地跑通（不登录、不部署）

```bash
cd game
npm ci                      # 首次：装 @cysj/room、room-mock、online-h5
cp builda.online.example.json builda.online.json
cp builda.room.local.example.json builda.room.local.json

# 终端 A：起 Mock（读 builda.online.json 与 scenario）
node server/mock/typescript/src/cli.mjs \
  --room server/room/<你的Room>.ts \
  --sdk node_modules/@cysj/room \
  --source-root server/room \
  --scenario builda.room.local.json \
  --online-config builda.online.json --port 7350
```

启动日志里应出现 `"match_keys":["main"]`（与你配置的一致）。

```bash
# 终端 B：跑客户端
./.builda-agent/builda dev --web dist
# 用两个浏览器窗口打开 game-url，分别加：
#   &builda_mock_player=p1
#   &builda_mock_player=p2
```

验收至少要有：两个身份能互相看见、位置/状态同步、一个掉线另一个能继续。

## 5. 部署顺序（唯一权威：Skill 的 Release decision）

先分类，再动手：

| 变更类型 | 要做什么 |
|---|---|
| 只改客户端（文案/UI/表现） | 只跑 `builda publish`，**不要** deploy Room |
| 只改 Room，且协议兼容 | 只跑 `builda-online deploy`，不传 bundle，不要求玩家重下客户端 |
| 首次联机版本 / 协议不兼容升级 | **先同步客户端草稿 → 再激活同 revision 的 Room → 最后在 App 里发布客户端** |

命令：

```bash
# 客户端草稿
./.builda-agent/builda publish builda-web.zip

# Room（顺序不能反）
./.builda-online/bin/builda-online deploy
```

> 顺序反了会报业务码 `10003`（Room 侧还没有这个 matchKey / revision 对不上）。
> 遇到时不要反复重试，先确认客户端草稿是否已经是同一 revision。

## 6. 版本与协议的三条红线

1. `sdk-version` 是唯一版本锁；不要手改 `.builda-online/installation.json` 的 `releaseId`
2. `onlineCompatibilityRevision` 默认不动；只在老客户端确实无法解析新协议时 +1
3. Room 的 `version`、Bundle ID、Builda 版本号都不能替代 `onlineCompatibilityRevision`

## 7. 重装/修复联机工具链

```bash
./.builda-agent/builda sdk install --with-online
# 若提示 needs-room-language：
./.builda-agent/builda sdk install --with-online --room-language typescript   # 或 rust
```

装完必须重新读 `game/.agents/skills/builda-online/SKILL.md`，再按它的流程改代码。

## 8. 阅读顺序

1. `game/.agents/skills/builda-online/SKILL.md`（总规则与发布决策）
2. `game/.agents/skills/builda-online/references/integration-workflow.md`（一步步的接入流程）
3. `game/server/typescript/README.md`（Room SDK 的 API）
4. `game/contracts/room-contract.json`（帧格式、生命周期、版本号）
5. `docs/官方主题/md_agent_online.md`（官方摘要）
