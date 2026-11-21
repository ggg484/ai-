# T-009 阶段 2：Bot 购买与武器差异

- 负责人：other
- 分支：`task/other/T-009-bot-buy`
- 基线：`e2597aae`
- 关联：Issue #10

## 目标

冻结时间内让 Bot 按经济与角色购买主武器/护甲，武器差异体现在射速、精度、爆头率；无甲/有甲伤害不同。

## 实现

### 购买规则（`round._botBuyPhase()`，冻结时间执行）

| 余额 | 行为 |
|---|---|
| < 2000 且无长枪 | **eco 存钱**，继续用手枪 |
| ≥ 2700 | 买 AK（`WEAPONS.ak.price`） |
| 买枪后 ≥ 650 | 补护甲（`BUY_ITEMS[armor].price`） |

价格全部从 `js/config/weapons.js` 只读获取，不在回合层硬编码。扣钱走 `_addBotMoney()`，不会出现负余额。

### 武器差异（`js/game/bots.js`）

| 维度 | Glock | AK | 实现 |
|---|---|---|---|
| 射击间隔 | 1.05~1.60 s | 0.74~1.12 s | `_shotDelay()` 按 `420 / rpm` 折算 |
| 20 m 散布 | 0.033 | 0.028 | `_spreadAt()` 读 `weapon.spread` |
| 爆头率 | 5% / 8% | 6.75% / 10.8% | 精度高的武器 ×1.35 |
| 单发伤害 | game.js 固定 | 同左 | **见风险** |

### 护甲

`Bot.damage()` 增加护甲吸收：伤害减半，护甲按原始伤害的一半消耗（与 `player.damage` 一致）。护甲不跨回合，死亡掉枪。

## 边界

| 文件 | 改动 |
|---|---|
| `js/game/bots.js` | 武器/护甲字段、射速、散布、爆头率、减伤 |
| `js/game/round.js` | 冻结时间购买 |
| `tools/smoke.mjs` | +7 条断言 |
| `collab/tasks/T-009-bot-buy.md` | 本卡 |

`js/config/weapons.js` 只读，未修改。未触碰 `js/game.js`、`js/ui/hud.js`、`js/world/map.js`。

## 验收

`npm run smoke` 49/49 → **56/56**，新增：

1. 有钱买 AK + 护甲（4000 → 650 余额）
2. eco 存钱不硬买（1500 不花）
3. 只够枪时先买枪（2800 → AK，剩 100）
4. 护甲吸收一半伤害（40 → hp -20 / armor -20；无甲 -40）
5. AK 射速快于手枪
6. AK 精度高于手枪
7. Bot 死亡掉枪

## 风险

- **单发伤害仍由 `js/game.js` 的 `_onBotShoot` 写死**（`16 + Math.random()*10`），不在本任务允许改的文件内。武器差异目前通过射速、精度、爆头率体现，有效 DPS 已有明显差距。要接单发伤害需在 `game.js` 增加 `shot.damage`，需另行确认。
- 玩家半场保留武器，Bot 死亡掉枪；两边规则不同，属于当前简化。
- 购买没有「保枪」判断（存活且已有 AK 不重复买，已覆盖）。
