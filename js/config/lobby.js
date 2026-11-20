import { cloneLoadout } from './skins.js';

// 大厅运营配置：声望等级、展位主角、收藏家榜、活动入口、大厅广播。
// 注：本文件只描述展示与入口，不接支付、不发奖励；付费方案见 docs/MONETIZATION-PLAN.md。

export const TIERS = [
  { id: 0, name: '列兵', short: 'RECRUIT', color: '#93999d', aura: 0x6f7a82, ring: 0.0 },
  { id: 1, name: '鉴赏家', short: 'CONNOISSEUR', color: '#6d9ec9', aura: 0x4f7fb8, ring: 0.0 },
  { id: 2, name: '收藏家', short: 'COLLECTOR', color: '#a97bd6', aura: 0x8b64c8, ring: 0.5 },
  { id: 3, name: '典藏家', short: 'ARCHIVIST', color: '#d9b47a', aura: 0xd9b47a, ring: 1.0 }
];

export function tierById(id) {
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, id | 0))];
}

/** 玩家档案：默认免费玩家，带一点收藏等级用于展示系统联调。 */
export function defaultProfile(name) {
  return {
    name: name || '玩家',
    tier: 1,
    collection: 12,
    showcase: 'ak_redline',
    equipped: cloneLoadout(),
    badges: ['首测玩家']
  };
}

export const LOBBY_TELEPORTS = [
  { id: 'gallery', label: '中央展位', x: 4.5, z: 10.0, tx: 2.8, tz: 6.5, yaw: Math.PI, y: 0, color: 0xd9b47a },
  { id: 'armory', label: '藏品墙', x: -17.0, z: 9.0, tx: -22.2, tz: 4.6, yaw: -Math.PI / 2, y: 0, color: 0xd9b47a },
  { id: 'range', label: '靶场', x: 17.0, z: 9.0, tx: 34.2, tz: 0, yaw: Math.PI / 2, y: 0, color: 0x8fbf78 },
  { id: 'mezz', label: '二层看台', x: -17.0, z: -13.5, tx: 20.0, tz: -19.6, yaw: 0, y: 5.42, color: 0x9bb8d9 }
];

export const HERO_SHOWCASE = [
  {
    id: 'h1', name: '夜航', tier: 3, collection: 428,
    title: '典藏家', subtitle: '鎏金 · 永久陈列',
    weapon: 'knife', skin: 'knife_gilded',
    variant: { wear: 0.028, seed: 132, offset: 0.18, preset: 0 },
    x: -7.2, z: 0.5, yaw: 0.9, helmet: true, scale: 1.05, tint: 0xa88456
  },
  {
    id: 'h2', name: '灰狐', tier: 2, collection: 216,
    title: '收藏家', subtitle: '白垩 · AK-47',
    weapon: 'ak', skin: 'ak_chalk',
    variant: { wear: 0.184, seed: 886, offset: 0.71, preset: 2 },
    x: 7.2, z: 0.5, yaw: -0.9, helmet: false, scale: 1.02, tint: 0x7890a8
  },
  {
    id: 'h3', name: '岚', tier: 3, collection: 371,
    title: '典藏家', subtitle: '流云 · 爪刀',
    weapon: 'knife', skin: 'knife_marble',
    variant: { wear: 0.061, seed: 509, offset: 0.52, preset: 1 },
    x: -7.2, z: -8.5, yaw: 2.2, helmet: false, scale: 0.98, tint: 0x8a6a9a
  },
  {
    id: 'h4', name: '北纬三十', tier: 2, collection: 188,
    title: '收藏家', subtitle: '熔金 · AK-47',
    weapon: 'ak', skin: 'ak_molten',
    variant: { wear: 0.412, seed: 1207, offset: 0.37, preset: 3 },
    x: 7.2, z: -8.5, yaw: -2.2, helmet: true, scale: 1.06, tint: 0x7a8a5e
  }
];

export const LEADERBOARD = [
  { rank: 1, name: '夜航', tier: 3, value: '428 件', highlight: '鎏金 · 流云 · 赤线' },
  { rank: 2, name: '岚', tier: 3, value: '371 件', highlight: '流云 · 极夜' },
  { rank: 3, name: '灰狐', tier: 2, value: '216 件', highlight: '白垩 · 焦糖' },
  { rank: 4, name: '北纬三十', tier: 2, value: '188 件', highlight: '熔金 · 淬火' },
  { rank: 5, name: '砾', tier: 2, value: '164 件', highlight: '沙暴 · 霜纹' },
  { rank: 6, name: '长街', tier: 2, value: '151 件', highlight: '赤线 · 黑曜' },
  { rank: 7, name: '白噪音', tier: 2, value: '139 件', highlight: '霓虹脉冲' },
  { rank: 8, name: '沙丘', tier: 2, value: '126 件', highlight: '锈蚀 · 赤獠' },
  { rank: 9, name: '旧钟', tier: 1, value: '98 件', highlight: '灰烬 · 沙暴' },
  { rank: 10, name: '灯塔', tier: 1, value: '87 件', highlight: '淬火' }
];

export const ACTIVITIES = [
  {
    id: 'board', name: '收藏家榜', sub: '本期典藏家排行', tag: 'TOP 10',
    desc: '查看大厅收藏值与展位排行，不参与任何战斗加成。', action: 'leaderboard', accent: '#d9b47a'
  },
  {
    id: 'gallery', name: '传奇陈列', sub: '前往中央展位', tag: 'GALLERY',
    desc: '近距离查看典藏家展位与限定皮肤，可自由试穿。', action: 'gallery', accent: '#a97bd6'
  },
  {
    id: 'armory', name: '军械库', sub: '8 把枪 · 360° 检视', tag: 'ARMORY',
    desc: 'AK / M4 / AWP / USP / 沙鹰 / MP9 / 爪刀，以及手雷 / C4 / 护甲等战术道具。', action: 'armory', accent: '#d9b47a'
  },
  {
    id: 'challenge', name: '靶场挑战', sub: '30 秒限时打靶', tag: 'TRAINING',
    desc: '三条靶道，30 秒内尽可能命中。成绩只记录在大厅。', action: 'range', accent: '#6f8f5e'
  },
  {
    id: 'supply', name: '每日军需', sub: '付费体系裁定后开放', tag: 'LOCKED',
    desc: '首个版本不接入充值、不开箱、不发军需；等付费方案经你裁定后再开发。', action: 'notice', locked: true, accent: '#6a6f73'
  },
  {
    id: 'news', name: '版本公告', sub: 'v0.2 · 军械大厅', tag: 'NEWS',
    desc: '新增 3D 大厅、藏品墙、三条靶道、模式与活动传送点。', action: 'news', accent: '#8fb2c9'
  }
];

export const LOBBY_FEED = [
  { text: '典藏家「夜航」进入大厅', tier: 3 },
  { text: '收藏家「灰狐」在展位检视了 白垩 · AK-47', tier: 2 },
  { text: '典藏家「岚」展示了 流云 · 爪刀', tier: 3 },
  { text: '收藏家「北纬三十」完成了 25 m 靶道 30 连中', tier: 2 },
  { text: '鉴赏家「长街」进入大厅', tier: 1 },
  { text: '大厅广播：中央展位即将更换本期典藏陈列', tier: 3 },
  { text: '收藏家「砾」在藏品墙试穿了 沙暴', tier: 2 },
  { text: '新玩家「白噪音」完成了首次靶场训练', tier: 1 }
];

/** 大厅各处的交互点（世界坐标，单位米）。 */
export const LOBBY_INTERACTIONS = [
  {
    id: 'armory', label: '打开藏品墙', hint: 'E / 互动',
    x: -24.2, z: 2.0, r: 4.0
  },
  {
    id: 'modes', label: '进入作战传送', hint: 'E / 互动',
    x: -15.0, z: -18.0, r: 3.2
  },
  {
    id: 'activities', label: '进入活动传送', hint: 'E / 互动',
    x: 15.0, z: -18.0, r: 3.2
  },
  {
    id: 'props', label: '查看战术道具', hint: 'E / 互动',
    x: 12.0, z: 13.6, r: 3.4
  },
  {
    id: 'board', label: '查看收藏家榜', hint: 'E / 互动',
    x: 0.0, z: -19.0, r: 4.2
  },
  {
    id: 'range', label: '进入靶场', hint: '向前走',
    x: 30.0, z: 0.0, r: 4.0
  }
];
