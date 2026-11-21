# GitHub MCP 协作指南

给通过 GitHub MCP 接入的 AI 看。读完这一页就按这里的流程操作。

## 读什么

按顺序读：

1. `collab/README.md`（总协议）
2. `collab/agent-guide.md`（本文件）
3. `collab/state.json`（当前 owner / 任务 / base / 测试）
4. `collab/locks.json`（文件锁）
5. `collab/inbox/<自己>/`（有没有给你的交接单）

## 你的分支

- 从 `main` 切：`task/<你的名字>/<task-id>-<slug>`
- 不要直接推 `main`（已开启分支保护）
- 不要 force push 别人的分支
- PR 必须通过 `smoke` 检查才能合并；PR 标题带 `[agent:<名字>]` 会自动打标签

## 标准动作

1. 用 GitHub MCP 读 `collab/state.json` 和 `collab/locks.json`。
2. 建任务分支。
3. 在 `collab/locks.json` 里领锁（共享文件必须先领）。
4. 改代码，小步提交。
5. 开 PR，标题：`T-XXX 标题 [agent:<名字>]`，描述用 `.github/PULL_REQUEST_TEMPLATE.md`。
6. 在 PR 评论里写交接单（格式见 `collab/HANDOFF-TEMPLATE.md`）。
7. 如果测试跑不了，写“未运行”，不要写“应该没问题”。
8. 完成后释放锁，更新 `collab/state.json` 和 `collab/STATE.md`。

## 共享文件

`index.html`、`js/game.js`、`js/main.js`、`js/core/`、`js/ui/`、`js/config/`、`js/platform/`、`package.json`、`README.md`、`collab/`。

改之前必须在 `collab/locks.json` 里出现你的锁；没有锁就先别改。
例外：新建 `collab/tasks/*.md` 或 `collab/inbox/**` 不用锁；改 `locks.json`、`state.json`、`STATE.md`、`README.md` 要锁。
两个 AI 同时改共享文件时，后到的先等，或者拆文件。

## 交接单

写到 PR 评论，或 `collab/inbox/<对方>/YYYYMMDD-HHMM-<from>-<topic>.md`。
必须包含：

- base commit
- 改了哪些文件
- 测试结果
- 下一步
- 是否需要对方领锁

## 测试

GitHub Actions 会在 PR / push 时自动跑 `smoke`（对局冒烟 + 大厅冒烟）。
本地能跑就跑：

```bash
npm run smoke
npm run smoke:lobby
```

跑不了就以 CI 结果为准，不要假报通过。

## 冲突

- `push` 被拒：先同步 `main`，再重试；不要强推。
- 锁冲突：等对方释放，或在 `collab/state.json` 里记一笔后拆文件。
- PR 冲突：以 `main` 为准，重新应用自己的改动。
