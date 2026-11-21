# T-003 阶段 2：Bot 目标系统与角色分工

- agent：other
- 分支：`task/other/T-003-bot-objectives`
- 依赖：阶段 1（导航 A*）已合并，main `68432fc4`

## 范围

| 能力 | 落地位置 |
|---|---|
| T Bot 自动下包 | `js/game/round.js` 指派 + 推进度，`js/game/bots.js` 走位站定 |
| CT Bot 自动拆包 | `js/game/round.js` `_defuseLogic()` |
| entry / anchor / rotator | `js/game/bots.js` 构造时轮转分配，只影响交战距离与推进方式 |

## 关键设计决定

**任务点由回合系统指派，不由 Bot 自己决策。**

`round.js` 持有 `this.game`，能直接拿到 `game.bots`，所以下包 / 拆包可以完全在回合层驱动，
不需要改 `js/game.js`（那是共享文件，加了钩子要等确认）。这样做还有两个好处：

1. 同一时刻只有一个下包人 / 拆包人，进度不会被多个 Bot 叠加。
2. 玩家永远是优先执行者——玩家站在包点按住使用键时，Bot 的进度逻辑不介入。

契约很小：

```js
bot.objective = { type: 'plant' | 'defuse', x, z }   // round.js 下发
bot.holding                                          // bots.js 到位站定后置 true
bot.engage                                           // 交战中禁止下包 / 拆包
```

## 行为细节

- **下包**：LIVE 阶段每帧选距目标包点最近的存活 T Bot，下发 `plant`。Bot 走到 0.9 m 内站定，
  3.2 s 完成。中途进入交战（`engage`）则中断。
- **拆包**：PLANTED 阶段选距炸弹最近的存活 CT Bot，站定 5 s 完成（`mode.defuseTime` 可配）。
  交战或走开则进度按 1.2/s 回退。
- **角色**：按入场顺序 `entry → anchor → rotator` 轮转。
  - entry：`dist > 5` 就往前压，移速 2.5
  - anchor：`dist < 11` 后退守位，移速 1.85，不追人
  - rotator：保持原来的 8 / 20 m 距离带，移速 2.1

  三者命中率与伤害完全一致，只改站位，避免变成数值平衡问题。

## 测试

`npm run smoke` **26/26**（阶段 1 的 23 条 + 新增 3 条），`npm run smoke:lobby` **12/12**。

新增断言：

| 断言 | 实测 |
|---|---|
| Bot 角色分三档 | entry=4 anchor=3 rotator=2 / 共 9 |
| T Bot 走到包点自动下包 | 指派=true，3.2 s，落点 (44, 16) |
| CT Bot 拆包成功并判 CT 胜 | 5.0 s，result=false，CT+1，炸弹已移除 |

## 已知限制

- 拆包 HUD 复用 `setObjective` 文本（`js/ui/hud.js` 不在归属区，`setPlant` 的文案写死「安放中」，
  直接借会显示错误文案）。
- 玩家侧拆包未实现：本作玩家固定为 T 方，没有拆包场景。
- 半场交换、加时、连败补偿留在阶段 3。
