# 任务卡模板

复制为 `collab/tasks/T-XXX-<slug>.md`。

```markdown
# T-XXX 任务标题

- 状态：todo / doing / review / done
- owner：trae / other
- 分支：agent/<name>/T-XXX-<slug>
- base：<commit>
- 涉及文件：...
- 共享文件：是 / 否

## 目标

一句话说明要达成什么。

## 验收标准

- [ ] 可运行 / 可交互
- [ ] `npm run smoke` 通过
- [ ] `npm run smoke:lobby` 通过（涉及大厅时）
- [ ] 截图或现象说明

## 备注

边界、已知问题、需要对方配合的地方。
```
