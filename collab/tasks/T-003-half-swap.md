# T-003 阶段 3b：半场交换

- 负责人：other
- 分支：`task/other/T-003-half-swap`
- 基线：`a8764d5c`（已含 T-008 钩子）
- 关联：Issue #5 / T-008

## 目标

在 `round.js` 里接入半场交换：MR12 第 12 局结束、加时每 3 局结束交换阵营。阵营重建复用 T-008 的 `game.setPlayerSide()`。

## 实现

### 换边时机

- 常规赛：第 12 局结束（`mode.winScore - 1`），先记 `_swapPending`，下一回合 `start()` 开头执行。
- 加时：每 3 局（`_otRoundCount === 3`）。
- 12:12 进加时的同一局仍会换边（先记 flag，再判比赛结束）。
- 比赛已结束时不再换边。

### 换边动作（`_swapSides`）

1. `game.setPlayerSide(next, true)`：重建 Bot、切换出生点、同步 `round.playerSide` 与 HUD。
2. 双方经济重置为 `mode.startMoney`（Bot 走 `resetBotEconomy()`，玩家单独写）。
3. 比分保留，玩家视角胜负由 `end(tWin)` 按 `playerSide` 折算。

### 阵营修正

- `_assignBotObjectives` 改用 `tBots` / `ctBots`：换边后 `allyBots` 变成 CT，继续用玩家视角会把下包指派给 CT。
- `update()` 存活统计按 `playerSide` 把玩家计入正确阵营。
- `_plantLogic` 只有玩家是 T 时才能下包。
- `start()` 的重生点与文案按 `playerSide` 选择。

### 经济

- 半场：双方回到 800（classic）。
- 加时：双方统一 10000（`_grantOvertimeMoney` 现在同步 Bot）。
- `resetBotEconomy()` 清空击杀快照，避免换边重建 Bot 后把历史击杀折现。

## 边界

| 文件 | 改动 |
|---|---|
| `js/game/round.js` | 换边时机、阵营修正、经济重置 |
| `tools/smoke.mjs` | +7 条断言 |
| `collab/tasks/T-003-half-swap.md` | 本卡 |

未触碰 `js/game.js`（T-008 的钩子只调用）、`js/ui/hud.js`、`js/world/map.js`、`js/config/**`。

## 验收

`npm run smoke` 42/42 → **49/49**，新增：

1. 第 12 局结束排队换边
2. 下半场玩家切到 CT 并换出生点
3. 换边后阵容与视角正确
4. 换边保留比分并重置经济
5. 换边后下包归 T / 拆包归 CT
6. CT 玩家不能下包
7. 加时每 3 局换边

## 风险

- 换边时玩家保留已购武器（`owned` 不清空），与 CS 的半场重开有差异；要清空需改 `game.js`，本阶段不动。
- `setPlayerSide` 会重建 Bot 对象，`_planter` / `_defuser` 引用在 `start()` 里清空，不会悬挂。
- HUD 的换边提示会被 `start()` 的「下半场 · 购买时间」覆盖，属于预期。
