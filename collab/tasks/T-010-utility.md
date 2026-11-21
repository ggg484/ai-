# T-010 投掷道具系统：HE / 闪光 / 烟雾 / 燃烧瓶

- 状态：review
- owner：trae
- 分支：task/trae/T-010-utility
- 涉及文件：`js/config/weapons.js`、`js/game.js`、`js/game/grenade.js`、`js/ui/hud.js`、`js/core/input.js`、`index.html`、`css/game.css`、`js/core/audio.js`
- 共享文件：是（按 T-000 分工由 Trae 负责）

## 玩法

- 开局 1 颗 HE / 闪光 / 烟雾 / 燃烧瓶；购买菜单可补到 2 颗
- 桌面：`4`–`7` 选择，`G` 投掷
- 触屏：HUD 右侧投掷物栏点选，右下“投掷”按钮
- 投掷物走抛物线，重力 15.5，碰墙反弹 0.4，闪光/烟雾/HE 引信 1.5–1.6 s
- HE：半径 6 m，中心 98 伤害，距离衰减，隔墙 0.35 倍
- 闪光：12 m 内按距离/是否直视计算 1.5–4.9 s 白屏；Bot 同步 `flashT` / `shootCd`
- 烟雾：18 s 体积，视觉遮蔽（Points + 烟雾贴图，1 draw call）
- 燃烧瓶：撞击碎裂，7 s 火区，每 0.28 s 对范围内玩家/Bot 造成伤害
- 本地 WebAudio 合成 throw / bounce / explode / flash / smoke / molotov / fire 音效

## 验证

- 临时断言 40/40：投掷消耗、HE 伤害、闪光致盲、烟雾生成、火区持续伤害、真实引信、燃烧瓶撞击
- 移除临时断言后 `npm run smoke` 33/33
- `npm run smoke:lobby` 12/12
- 截图：投掷物 HUD、购买菜单、烟雾/火区/爆炸、闪光白屏

## 已知边界

- 烟雾目前只做视觉遮蔽，Bot 视线遮蔽留给后续（需要改 `bots.js`）
- Bot 投掷物 AI 未做，留给 T-009 后续阶段
- 音效目前走本地合成；OGG 资源可后续用 `tools/make-sfx.py` 生成
- 购买菜单 7 项在矮屏上需要滚动；后续可做分类页签
