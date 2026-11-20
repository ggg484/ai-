# 你的 Room 源码放这里

一个 Room 就是一个 **TypeScript 单文件**（Rust 则是 cargo workspace），由平台托管运行。
本目录现在是空的，因为开工包不带任何具体游戏的联机逻辑。

## 最小接入步骤

1. 读 `../../.agents/skills/builda-online/SKILL.md` 与 `references/integration-workflow.md`
2. 把 `../builda.online.example.json`（工程根）复制成 `builda.online.json`，改 `matchKeys` 与 `roomRoute`
3. 在本目录新建 `main-room.ts`（名字随意），按 Room SDK 的 `setup / join / leave / onMessage / onTick` 写逻辑
4. 本地起 Mock 时用 `--room server/room/main-room.ts`

## 约定

- 只写**服务端权威**逻辑：位置校验、伤害结算、掉落、发奖
- 不要在这里读写玩家私有存档（那是客户端的 `privateKV`）；需要持久化用 Room SDK 提供的存储
- 协议字段的增删要评估 `onlineCompatibilityRevision`：老客户端读不懂时才 +1
- 不要打印或转存任何凭据
