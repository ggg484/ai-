# T-016 武器模型重做 + 第一人称持枪 + Bot 持枪姿态

- 状态：review
- owner：trae
- 分支：task/trae/T-016-weapons
- 涉及文件：`js/render/weapon-models.js`、`js/render/viewmodel.js`、`js/render/rig.js`、`js/render/avatar-glb.js`、`js/game/bots.js`、`assets/weapon-rig.json`、`docs/WEAPON-VISUAL-PIPELINE.md`
- 共享文件：只动了 `bots.js` 的持枪渲染，不改 AI/回合/地图逻辑

## 目标

- 8 把武器（AK / M4A4 / AWP / USP-S / 沙鹰 / MP9 / Glock / 爪刀）全部能在第一人称显示
- 第一人称有双手 + 前臂/袖口，待机/走路/冲刺/开火/换弹/切枪有动画
- Bot 按实际 weaponId 显示正确枪型，持枪姿态按步枪/手枪/刀区分
- 把经验沉淀成 `docs/WEAPON-VISUAL-PIPELINE.md`

## 本次改动

### 模型 / 手部

- 废弃“一套固定 addHands”方案，改为 `HAND_LAYOUT` 每把枪独立右手握把点 + 左手托枪点
- 手枪不再多出一只飘在枪口前的手；Glock/USP/沙鹰改为双手托握
- 新增左右前臂 + 袖口；左手是独立 `gloveL/sleeveL` mesh，换弹时可离开护木
- 修复 AWP 瞄准镜悬空：镜座下补整段导轨
- 修复 MP9 折叠托拉杆方向：沿 +Z 向后，不再横穿机匣
- 手套/袖口颜色提亮，暗色枪身上可读

### 第一人称

- `WEAPON_IDS` 覆盖 8 把；按需构建，切枪不卡首帧
- 每把枪独立 rig（AK/M4 步枪、AWP 长枪、MP9 短枪、手枪、刀）
- 动画层：待机呼吸、走路 bob、冲刺、开火后坐、换弹左手动作、切枪抬枪、抛壳、枪口焰
- 视野隐藏（死亡/暂停/大厅面板）时自动隐藏枪口焰和弹壳

### Bot

- 不再所有人共用方块枪，按 `weaponId` 用低模代理（1 mesh / 1 draw call）
- `avatar.weaponClass` 驱动左臂：步枪前伸、手枪托握、刀单手
- 开火时枪挂点后移 + 上抬，不再只闪枪焰
- 性能：对局 69 draw calls / 28,423 tris（改动前 67 / 28,255，+0.6%）

## 验证

- [x] `npm run smoke`：81/81
- [x] `npm run smoke:lobby`：12/12
- [x] 第一人称截图：AK / M4 / AWP / MP9 / Glock / 沙鹰 / 爪刀
- [x] 换弹截图：左手离开护木、枪身下沉
- [x] Bot 持枪截图：AK 步枪双手前伸、Glock 双手托握
- [x] 绿洲 64 号 Bot 截图更新
- [x] AWP / MP9 模型断件修复

## 已知边界

- 实际可购买武器仍是 Glock / AK / 爪刀；M4/AWP/USP/沙鹰/MP9 本轮只做视觉与第一人称，不改经济和 Bot 购买
- AWP 没有开镜；需要单独任务（FOV/镜片遮罩）
- 手枪套筒、步枪拉机柄没有独立动画（几何按材质合并，需要拆 mesh）
- 第一人称手臂是固定几何，没有 IK；贴墙/蹲下不会自动收臂
- Bot 用低模枪，近距离细节不如第一人称模型

## 相关

- 经验文档：`docs/WEAPON-VISUAL-PIPELINE.md`
- 地图经验：`docs/MAP-DESIGN-PLAYBOOK.md`（第 10 节可共创）
- Issue：#31
