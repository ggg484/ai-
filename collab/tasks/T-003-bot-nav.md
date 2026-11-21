# T-003 阶段 1：Bot 导航 A*

- 状态：doing
- owner：other
- 分支：task/other/T-003-bot-nav
- base：642fb8b5e8876a377b3b432d350fc86e2e5b089a
- 涉及文件：`js/game/bots.js`、`tools/smoke.mjs`、`collab/tasks/T-003-bot-nav.md`
- 共享文件：否

## 目标

在运行时用世界碰撞盒生成导航网格 + A*，替掉「直接朝 waypoint 走」的直线巡逻；
补上卡住检测、重寻路、门口通行。

## 做法

- `NavGrid`：把 `world.boxes || world.colliders` 里的 AABB 按通行半径 0.36 m 膨胀后投影到 0.75 m 网格；
  高度 <= 0.35 m 的台阶、>= 1.7 m 的横梁不参与遮挡。
- 从障碍做 BFS 得到每格离墙距离，A* 里给贴墙格加价，路径自然走走廊中间；斜向禁止切角。
- 平滑时保留离墙 <= 1 格的必经点（门口），避免切角卡门框。
- 卡住两级恢复：0.45 s 把脚下当临时障碍重算；1.6 s 仍未移动就换航点。
- `world` 目前暴露的是 `colliders`（`map.js` 没有 `boxes` 字段），所以读 `world.boxes` 优先、回落到 `colliders`，不改 `map.js`。

## 验收标准

- [x] `npm run smoke` 通过（16 → 23 条）
- [x] Bot 能从 T / CT 出生点走到 A / B 点
- [x] 全程不穿墙（每帧 `world.overlaps` 检查为 0）
- [x] 卡住 < 2 s 换航点
- [x] 2.4 m 门洞能过
- [ ] `npm run smoke:lobby`（本次不涉及大厅，阶段 4 统一跑）

## 备注

- `js/world/map.js` 只读参考，未改动。
- 阶段 2 会在本网格上接目标行为（下包 / 拆包 / 站点选路）。
