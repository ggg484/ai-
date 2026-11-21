# T-009 阶段 3：Bot 战术执行

- 负责人：other
- 分支：`task/other/T-009-bot-tactics`
- 基线：`d515ce07`
- 关联：Issue #10

## 目标

把「单点指派」升级为队伍级战术：T 全队 execute、CT anchor 守点、下包后 T 散开守包 / CT 全员回防。

## 实现

### 进攻（LIVE）

- `_plantSite` 选定后，**全队**收到目标：
  - 距包点最近的 T Bot：`plant`（贴到 0.9 m 站定下包）
  - entry：`push` 直接压包点
  - anchor：`push` 拖后 7 m 当第二梯队
  - rotator：`push` 向侧面偏 5 m 补枪线
- 偏移以「Bot → 包点」的实时方向计算，换包点 / 换边不用改配置。

### 防守（LIVE）

- CT 的 `anchor` 守包点（A/B 交替），entry/rotator 保持巡逻。
- 只让 anchor 站桩，避免全队龟缩导致进攻方无路可走。

### 下包后（PLANTED）

- T：围绕炸弹 5~8 m 散开 `guard`，不再原地站桩。
- CT：距炸弹最近的人 `defuse`，其余围绕炸弹 4~7 m `retake`。

### 到达判定

`_steerToObjective` 按任务类型分半径：

| 类型 | 半径 | holding |
|---|---|---|
| `plant` / `defuse` | 0.9 m | true（下包/拆包判定用） |
| `push` / `guard` / `retake` | 2.0 m | false |

## 边界

| 文件 | 改动 |
|---|---|
| `js/game/bots.js` | 到达半径按任务类型 |
| `js/game/round.js` | 队伍级任务指派 |
| `tools/smoke.mjs` | +6 条断言 |
| `collab/tasks/T-009-bot-tactics.md` | 本卡 |

未触碰 `js/game.js`、`js/ui/hud.js`、`js/world/map.js`、`js/config/**`。

## 验收

`npm run smoke` 56/56 → **62/62**，新增：

1. T 全队执行 execute（5/5 有目标，下包人任务为 `plant`）
2. entry 比 anchor 更靠前（目标距 A：0 m vs 7 m）
3. CT anchor 守包点
4. execute 让 T 集体压上（8 秒平均距 A 67.3 → 52.2 m）
5. 下包后 T 散开守包（5 人）
6. 下包后 CT 全员回防（最近的人拆包，目标都在炸弹 8.5 m 内）

## 风险

- 偏移点可能落在墙里，A* 的 `_nearestOpen` 会兜底，但站位可能挤在门口。
- CT 只有一个 anchor 守点，防守强度仍偏低；要全队布防需要更多战术点位配置。
- 交战优先级高于任务：`engage` 时 Bot 会脱离 objective 追人，属于预期。
