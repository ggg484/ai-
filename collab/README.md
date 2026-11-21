# 双 AI 协作协议（Git 版）

两个 AI 分别在不同平台、没有 MCP、也不是常驻进程。
所以这里不追求「同时编辑同一个文件」，而是：

- **Git 是唯一的代码真相**
- **`collab/` 是消息与任务总线**
- **每次只让一个 AI 改一个区域**
- **改前领文件锁，改后写交接单**

## 分支策略

| 分支 | 用途 | 谁能推 |
|---|---|---|
| `main` | 可运行、可打包的稳定线 | 只接受合并，不直接开发 |
| `agent/trae` | Trae 这一侧的集成分支 | Trae |
| `agent/other` | 另一个 AI 的集成分支 | 另一个 AI |
| `agent/<name>/<task-id>-<slug>` | 单个任务分支 | 对应 Agent |

规则：

1. 从最新 `main` 切任务分支。
2. 一个任务一个分支，提交尽量小于 200 行。
3. 推送前先 `git pull --rebase origin main`。
4. 合并回 `main` 用 PR；PR 标题带任务号和 `[agent:<名字>]`。
5. 禁止 force push 到 `main` 和别人的 `agent/*` 分支。
6. 共享文件（见下）必须先领锁。
7. `main` 受保护：必须走 PR，且 `smoke` 检查通过；不能直接 push、force push 或删除。
8. PR 标题里带 `[agent:trae]` / `[agent:other]` 会自动打标签。

提交格式：

```
feat(bots): 补齐换弹动作 [agent:trae] [task:T-003]
fix(touch): 修正摇杆左右方向 [agent:other] [task:T-004]
```

## 目录分工

| 归属 | 路径 |
|---|---|
| Trae | `js/render/`、`js/dev/`、`css/`、`assets/` |
| 另一个 AI | `js/game/`、`js/player/`、`js/world/`、`tools/` |
| 共享（必须领锁） | `index.html`、`js/game.js`、`js/main.js`、`package.json`、`README.md`、`collab/` |

共享文件冲突时：先让持有锁的一方完成并推送，另一方 `pull --rebase` 后再改。
不要用「我这边更新」直接覆盖对方提交。

## 每次协作的固定循环

1. `git fetch origin && git pull --rebase origin main`
2. 读 `collab/STATE.md` 和 `collab/inbox/<自己>/`
3. 在 `collab/tasks/` 建任务卡（或更新已有任务）
4. 在 `collab/locks.json` 领文件锁，提交并推送
5. 改代码
6. 跑测试：`npm run smoke`、`npm run smoke:lobby`（能跑就跑）
7. 小步提交并推送到自己的 `agent/*` 分支
8. 更新 `collab/STATE.md`、写 `collab/inbox/<对方>/` 交接单
9. 释放文件锁
10. 叫醒对方

## 文件锁

`collab/locks.json`：

```json
{
  "version": 1,
  "ttlMinutes": 30,
  "locks": {
    "js/game.js": {
      "owner": "trae",
      "task": "T-003",
      "acquired": "2026-11-21T19:30:00+08:00",
      "expires": "2026-11-21T20:00:00+08:00"
    }
  }
}
```

- 路径按前缀匹配：锁 `js/render/` 表示整个目录。
- TTL 默认 30 分钟；过期锁可被对方移除，但必须在 `STATE.md` 里记一笔。
- 领锁提交被拒绝（push rejected）：`pull --rebase` 后重新检查，不要强推。
- 改完立即释放；不要长期占锁。

## 交接单

统一放在 `collab/inbox/<对方>/`，文件名：

```
YYYYMMDD-HHMM-<from>-<topic>.md
```

内容使用 `collab/HANDOFF-TEMPLATE.md`。
必须包含：base commit、改了哪些文件、测试结果、下一步、是否需要对方领锁。

## 状态文件

`collab/STATE.md` 只保留「当前」状态，不写历史：

- 当前 owner
- 当前任务
- 当前分支
- base commit
- 共享文件锁
- 最近一次测试结果
- 下一步

历史都留在 Git 提交和 inbox 里。

## 如果对方用 GitHub MCP

GitHub MCP 能直接读写仓库、建 Issue/PR，所以**不需要自建消息中继**：

- 任务：用 Issue（模板 `.github/ISSUE_TEMPLATE/task.md`）
- 代码：开 PR，使用 `.github/PULL_REQUEST_TEMPLATE.md`
- 交接：写在 PR / Issue 评论里，格式同 `HANDOFF-TEMPLATE.md`
- 机器状态：`collab/state.json` + `collab/locks.json`
- 人工摘要：`collab/STATE.md`
- 对方 AI 的入口说明：`collab/agent-guide.md`

注意：

- 两个 AI 如果共用同一个 GitHub 账号，PR 无法互相 approve；分支保护只能要求“走 PR”，不要要求 review。
- GitHub MCP 通常不能跑本地命令；测试跑不了就写“未运行”，交给有执行环境的一方或 CI。
- `main` 仍然是稳定线，GitHub MCP 也不要直接推 `main`。

## 人类在环

两个手机 AI 都不是常驻进程，所以真正的“触发器”是使用者：

- 一方完成交接单后，由使用者通知另一方去读。
- 如果双方都能访问 GitHub，用 Issue/PR 评论当通知。
- 如果只能聊天，就把交接单整段贴过去。

## 快速开始

```bash
# 拉最新
git pull --rebase origin main

# 建任务分支
git checkout -b agent/trae/T-001-bot-anim main

# 改完提交
git add -A
git commit -m "feat(bots): ... [agent:trae] [task:T-001]"
git push -u origin HEAD

# 看自己的消息
ls collab/inbox/trae/
```
