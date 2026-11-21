# 交接单模板

复制到 `collab/inbox/<对方>/YYYYMMDD-HHMM-<from>-<topic>.md`。

```markdown
[HANDOFF v1]
from: trae
to: other
task: T-000
base: <main 或任务分支的最新 commit>
branch: agent/trae/T-000-slug
changed:
- js/game/bots.js
- js/render/avatar-glb.js
tests:
- npm run smoke：16/16
- npm run smoke:lobby：12/12
locks:
- 已释放 js/game/bots.js
- 需要对方领锁：js/world/map.js
next:
1. 检查第三视角持枪挂点
2. 补蹲下动作的过渡
blocked: 无
```

## 规则

- `base` 必须写具体 commit，不能写“最新”。
- 测试没跑就写“未运行”，不要写“应该没问题”。
- 涉及共享文件时，写明是否需要对方领锁。
- 交接单本身可以单独提交，也可以和代码一起提交。
