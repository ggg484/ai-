// 武器 / 移动 / 经济 参数。所有手感数值集中在这里，改完刷新即可。
// 说明：后坐力图谱是按 CS 量级生成的占位曲线，后续用实测数据替换。

function recoilPattern(n, up, sway) {
  const out = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    const u = up * (i < 4 ? 1 : 0.52);
    if (i > 3) x += Math.sin(i * 0.85) * sway + (i % 7 === 0 ? sway * 1.8 : 0);
    out.push([u, x]);
  }
  return out;
}

export const WEAPONS = {
  glock: {
    id: 'glock',
    name: 'GLOCK-18',
    slot: 1,
    damage: 30,
    rpm: 400,
    mag: 20,
    reserve: 60,
    reload: 2.0,
    auto: false,
    spread: 0.011,
    moveSpread: 0.030,
    recoil: recoilPattern(20, 0.30, 0.055),
    range: 70,
    price: 200,
    killReward: 300,
    falloff: 0.82
  },
  ak: {
    id: 'ak',
    name: 'AK-47',
    slot: 1,
    damage: 36,
    rpm: 600,
    mag: 30,
    reserve: 90,
    reload: 2.4,
    auto: true,
    spread: 0.006,
    moveSpread: 0.055,
    recoil: recoilPattern(30, 0.46, 0.085),
    range: 90,
    price: 2700,
    killReward: 300,
    falloff: 0.88
  },
  knife: {
    id: 'knife',
    name: '爪刀',
    slot: 3,
    melee: true,
    damage: 65,
    rpm: 120,
    mag: 0,
    reserve: 0,
    reload: 0,
    auto: false,
    spread: 0,
    moveSpread: 0,
    recoil: [[0, 0]],
    range: 2.6,
    price: 0,
    killReward: 1500,
    falloff: 1
  }
};

export const MOVEMENT = {
  runSpeed: 5.0,
  walkSpeed: 2.6,
  crouchSpeed: 1.7,
  accel: 11.0,
  airAccel: 22.0,
  friction: 6.2,
  stopSpeed: 2.0,
  jumpSpeed: 5.0,
  gravity: 15.5,
  stepHeight: 0.36,
  standHeight: 1.80,
  crouchHeight: 1.22,
  radius: 0.30
};

export const ECONOMY = {
  start: 800,
  cap: 16000,
  kill: 300,
  win: 3250,
  loss: 1400,
  plant: 300
};

// 投掷物：价格、引信、半径、持续时间都集中在这里。
export const UTILITY = {
  he: {
    id: 'he', name: 'HE 手雷', slot: 4, price: 300,
    fuse: 1.6, radius: 6.0, damage: 98, bounce: 0.4
  },
  flash: {
    id: 'flash', name: '闪光弹', slot: 5, price: 200,
    fuse: 1.5, radius: 12.0, maxBlind: 4.9, bounce: 0.4
  },
  smoke: {
    id: 'smoke', name: '烟雾弹', slot: 6, price: 300,
    fuse: 1.4, radius: 3.2, duration: 18, bounce: 0.35
  },
  molotov: {
    id: 'molotov', name: '燃烧瓶', slot: 7, price: 400,
    fuse: 0, radius: 3.0, duration: 7, bounce: 0
  }
};

export const UTILITY_ORDER = ['he', 'flash', 'smoke', 'molotov'];

export const BUY_ITEMS = [
  { id: 'ak', name: 'AK-47', desc: '一枪爆头，30 发弹道', price: 2700 },
  { id: 'armor', name: '护甲', desc: '吸收 50% 伤害，+100 护甲', price: 650 },
  { id: 'he', name: 'HE 手雷', desc: '6 m 范围伤害', price: 300, utility: 'he' },
  { id: 'flash', name: '闪光弹', desc: '致盲 1.5–4.9 s', price: 200, utility: 'flash' },
  { id: 'smoke', name: '烟雾弹', desc: '18 s 视觉遮蔽', price: 300, utility: 'smoke' },
  { id: 'molotov', name: '燃烧瓶', desc: '7 s 火区持续伤害', price: 400, utility: 'molotov' },
  { id: 'ammo', name: '备弹', desc: '当前武器补满备用弹药', price: 100 }
];
