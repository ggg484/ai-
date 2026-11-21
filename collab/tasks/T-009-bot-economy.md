# T-009 阶段 1：Bot 钱包 + 回合经济结算

- 负责人：other
- 分支：`task/other/T-009-bot-economy`
- 基线：`9afbb31d`
- 关联：Issue #10

## 目标

给每个 Bot 独立钱包，接入击杀 / 回合胜负 / 下包 / 拆包奖励，按 `ECONOMY.cap` 封顶，并提供可核对的经济日志。

## 实现

### 钱包

- `Bot.money` 字段，构造时 0，比赛开始由 `round.resetBotEconomy()` 初始化为 `mode.startMoney`。
- 回合之间保留，只有比赛开始 / 半场交换才重置。

### 收入

| 来源 | 金额 | 挂载点 |
|---|---|---|
| 击杀 | `ECONOMY.kill` = 300 | `_syncBotKillRewards()` 对比 `Bot.kills` 增量 |
| 回合胜利 | `ECONOMY.win` = 3250 | `_applyEconomy()` |
| 回合失败 | `_lossBonus()` 1400~3400 | `_applyEconomy()`，按阵营连败计数 |
| 下包 | `ECONOMY.plant` = 300 | `plant(site, pos, actor)` |
| 拆包 | 300（`DEFUSE_REWARD`） | `_defuseLogic()` |

击杀不改 `js/game.js` 的 `_onBotShoot`：Bot 的 `kills` 本来由它维护，回合层每帧对比增量补发，等价且零侵入。

### 封顶与日志

- `_addBotMoney()` 统一走 `Math.min(ECONOMY.cap, ...)`，不可能出现无限钱。
- `round.economyLog` 记录 `{ round, bot, team, delta, money, reason }`，上限 120 条。

## 边界

| 文件 | 改动 |
|---|---|
| `js/game/bots.js` | `money` 字段 |
| `js/game/round.js` | 经济结算、击杀轮询、日志 |
| `tools/smoke.mjs` | +9 条断言 |
| `collab/tasks/T-009-bot-economy.md` | 本卡 |

未触碰 `js/game.js`、`js/ui/hud.js`、`js/world/map.js`、`js/config/**`。
`_pickTarget` 未改动（T-008 占用）。

## 验收

`npm run smoke` 33/33 → **42/42**，新增：

1. Bot 初始钱包按模式起始资金且互相独立
2. Bot 击杀奖励 300（真实走 `_onBotShoot` 击杀链路）
3. Bot 回合胜负结算（胜 +3250 / 首败 +1400）
4. Bot 连败补偿递增（第 2 连败 +1900）
5. Bot 下包奖励 300
6. Bot 拆包奖励 300 + 回合胜利
7. Bot 经济封顶 16000
8. 经济日志字段完整
9. 比赛开始重置 Bot 经济

## 风险

- 击杀结算有一帧延迟（下一帧 `round.update` 补发），对经济数值无影响。
- `ECONOMY` 里没有拆包项，暂用 300；要改配置需在 Issue #10 单独提。
- 阶段 2 购买系统会直接读 `bot.money`，本阶段先把钱包与结算打稳。
