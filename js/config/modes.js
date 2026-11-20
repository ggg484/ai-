// 对局模式配置。所有模式共用同一套移动/射击/回合内核，只改规则参数。

export const GAME_MODES = [
  {
    id: 'classic',
    name: '经典爆破',
    sub: 'COMPETITIVE',
    tag: '5V5 · MR12',
    desc: '先到 13 分。买枪、下包、拆包，完整经济与半场节奏。',
    winScore: 13,
    freezeTime: 12,
    roundTime: 100,
    bombTime: 40,
    startMoney: 800,
    pistolOnly: false,
    accent: '#e06a35'
  },
  {
    id: 'quick',
    name: '快速爆破',
    sub: 'QUICK MATCH',
    tag: '5V5 · MR8',
    desc: '先到 9 分。更短的购买与回合时间，适合碎片时间。',
    winScore: 9,
    freezeTime: 8,
    roundTime: 75,
    bombTime: 35,
    startMoney: 1000,
    pistolOnly: false,
    accent: '#d9b47a'
  },
  {
    id: 'pistol',
    name: '手枪局',
    sub: 'PISTOL ONLY',
    tag: '5V5 · 手枪限定',
    desc: '只允许手枪与护甲。没有长枪，拼的是准星和走位。',
    winScore: 7,
    freezeTime: 8,
    roundTime: 70,
    bombTime: 35,
    startMoney: 800,
    pistolOnly: true,
    accent: '#8fb2c9'
  },
  {
    id: 'range',
    name: '靶场训练',
    sub: 'TRAINING',
    tag: '自由练习',
    desc: '东侧三条靶道：手枪 15 m、步枪 25 m、狙击 40 m。无限弹药。',
    type: 'range',
    accent: '#6f8f5e'
  }
];

export const MODE_MAP = {};
GAME_MODES.forEach((m) => { MODE_MAP[m.id] = m; });
