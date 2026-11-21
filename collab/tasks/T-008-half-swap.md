# T-008 半场交换与阵营钩子

- 状态：review
- owner：trae
- 分支：task/trae/T-008-half-swap
- 涉及文件：`js/world/map.js`、`js/game.js`、`js/ui/hud.js`、`css/game.css`
- 共享文件：是（按 T-000 分工由 Trae 负责）

## 目标

只做半场交换的共享层钩子，不实现回合规则。`round.js` 继续由另一个 AI 负责。

## 新增 API

### map.js

```js
map.spawns.playerCT   // CT 玩家出生点 (0, 36.5, yaw=π)
map.spawns.ctAllies   // 玩家在 CT 时的 4 名 CT 队友出生点
map.spawns.tBots      // 玩家在 CT 时的 5 名 T 敌人出生点
```

保留 `player` / `allies` / `bots`，T 方启动行为不变。

### game.js

```js
game.playerSide          // 't' | 'ct'，默认 't'
game.setPlayerSide(side) // 切玩家出生点、重建 Bot、刷新 HUD、同步 round.playerSide
game.isPlayerTeam(unit)  // 玩家或 allyBots
game.tBots / game.ctBots // 按阵营分组的 Bot
```

- Bot 重建时按队伍保留 kills/deaths。
- `_pickTarget` 的 ctx 增加 `playerTeam`；Bot 只在玩家属于敌方时把玩家加入目标列表。
- Bot 对 Bot 的击杀反馈按 `playerSide` 显示队友/敌人。

### hud.js

```js
hud.setPlayerSide(side)
```

- 小队列表给玩家阵营加下划线。
- Tab 战报标题显示“（我方）”。
- 冻结期切换阵营时，目标文案立即改成进攻/防守。

## round.js 3b 集成契约

```js
// 半场交换时：
g.setPlayerSide(nextSide);
g.player.reset(g.player.respawnPoint);
g.bots.forEach((b) => b.reset());
```

`setPlayerSide` 已同步 `g.round.playerSide`，回合计分/目标文案由 round.js 自己换算。

## 验证

- 临时断言：T→CT→T 切换，Bot 数量 4+5、team 正确、玩家 CT 出生 (0,36.5)、HUD 同步、`isPlayerTeam` 正确
- 临时断言跑完 30/30；移除后 `npm run smoke` 26/26
- `npm run smoke:lobby` 12/12
- CT 视角截图：`screenshots/half-swap/40-ct-spawn.png`

## 注意

- `js/game/bots.js` 只改了 `_pickTarget` 一处（约 8 行），已和 T-009 的任务说明对齐。
- 不改 `js/game/round.js`、`js/config/weapons.js`、`tools/smoke.mjs`（临时断言已移除）。
