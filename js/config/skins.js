// 皮肤目录：原创命名与原创花纹，不使用任何 Valve 资产或商标。
// 首发全部可自由试穿；购买/稀有度投放按 docs/MONETIZATION-PLAN.md 待裁定后再接。

export const RARITIES = {
  industrial: { id: 'industrial', name: '工业级', color: '#7f9bb5' },
  milspec: { id: 'milspec', name: '军规级', color: '#4f7fb8' },
  restricted: { id: 'restricted', name: '受限', color: '#8b64c8' },
  classified: { id: 'classified', name: '保密', color: '#c0508e' },
  covert: { id: 'covert', name: '隐秘', color: '#c94f45' },
  archive: { id: 'archive', name: '典藏', color: '#d9b47a' }
};

export const SKINS = [
  // ---------------- AK-47 ----------------
  {
    id: 'ak_redline', weapon: 'ak', name: '赤线', rarity: 'classified',
    desc: '哑光黑漆上的一道赤色速度线，边角留出金属磨损。',
    pattern: 'redline', colors: ['#17181a', '#b3262c', '#e8e2d2'],
    metalness: 0.68, roughness: 0.42, wood: 0x2a2320, polymer: 0x1e1e20
  },
  {
    id: 'ak_sandstorm', weapon: 'ak', name: '沙暴', rarity: 'restricted',
    desc: '沙线与旧城交界处的三色迷彩，枪托保留了原油木纹。',
    pattern: 'camo', colors: ['#b59a6d', '#7d6644', '#4b4030'],
    metalness: 0.45, roughness: 0.62, wood: 0x6b4a2c, polymer: 0x3d372c
  },
  {
    id: 'ak_midnight', weapon: 'ak', name: '极夜', rarity: 'milspec',
    desc: '深蓝碳纤维与冷色拉丝钢，适合夜战。',
    pattern: 'carbon', colors: ['#121822', '#1f2c3d', '#6d8aa8'],
    metalness: 0.8, roughness: 0.34, wood: 0x1a2028, polymer: 0x14181e
  },
  {
    id: 'ak_chalk', weapon: 'ak', name: '白垩', rarity: 'covert',
    desc: '白色陶瓷底漆与橙色几何色块，边角自然掉漆。',
    pattern: 'geo', colors: ['#e8e5dc', '#d96a2f', '#2b2b2b'],
    metalness: 0.4, roughness: 0.5, wood: 0x8a6a48, polymer: 0x2a2a2a
  },
  {
    id: 'ak_molten', weapon: 'ak', name: '熔金', rarity: 'archive',
    desc: '黑曜石底与流动的金色纹脉，典藏展柜常客。',
    pattern: 'marble', colors: ['#171614', '#c9a25a', '#6d4f22'],
    metalness: 0.86, roughness: 0.3, wood: 0x3a2c1a, polymer: 0x1c1a16
  },
  {
    id: 'ak_rust', weapon: 'ak', name: '锈蚀', rarity: 'industrial',
    desc: '从废城捡回来的老枪，锈迹与旧漆层层叠叠。',
    pattern: 'rust', colors: ['#6a5a4a', '#8a4c2a', '#3c342c'],
    metalness: 0.55, roughness: 0.72, wood: 0x5a3a24, polymer: 0x33302a
  },

  // ---------------- Glock-18 ----------------
  {
    id: 'glock_ash', weapon: 'glock', name: '灰烬', rarity: 'industrial',
    desc: '水泥灰聚合物枪身，滑套带细密拉丝。',
    pattern: 'carbon', colors: ['#41464a', '#2c3033', '#7d878c'],
    metalness: 0.62, roughness: 0.5, wood: 0x333333, polymer: 0x2c2f31
  },
  {
    id: 'glock_neon', weapon: 'glock', name: '霓虹脉冲', rarity: 'covert',
    desc: '暗色底漆上流动的青与品红脉冲线。',
    pattern: 'neon', colors: ['#0c1014', '#37e0d8', '#d84bd0'],
    metalness: 0.55, roughness: 0.38, wood: 0x202020, polymer: 0x15181c,
    emissive: '#25b8b0', emissiveIntensity: 0.55
  },
  {
    id: 'glock_caramel', weapon: 'glock', name: '焦糖', rarity: 'milspec',
    desc: '焦糖棕与奶油色的双色涂装，温暖但不俗气。',
    pattern: 'geo', colors: ['#b98a58', '#e6d3ae', '#4b3826'],
    metalness: 0.42, roughness: 0.56, wood: 0x7a5634, polymer: 0x4a3826
  },
  {
    id: 'glock_frost', weapon: 'glock', name: '霜纹', rarity: 'restricted',
    desc: '冷白底色上的冰裂纹，握把保持深色防滑颗粒。',
    pattern: 'frost', colors: ['#dbe6ea', '#8db6c6', '#2c3a42'],
    metalness: 0.5, roughness: 0.4, wood: 0x2c3a42, polymer: 0x263035
  },


  // ---------------- M4A4 ----------------
  {
    id: 'm4_ashen', weapon: 'm4', name: '灰烬协议', rarity: 'classified',
    desc: '石墨灰底漆与冷白战术条纹，机匣边缘保留金属磨损。',
    pattern: 'carbon', colors: ['#2b3136', '#596770', '#d8d4c8'],
    metalness: 0.72, roughness: 0.4, wood: 0x2c3136, polymer: 0x23282c
  },
  {
    id: 'm4_dune', weapon: 'm4', name: '沙脊', rarity: 'restricted',
    desc: '沙线地形的三色迷彩，护木缠着旧布带。',
    pattern: 'camo', colors: ['#b59a6d', '#7a6648', '#3f3628'],
    metalness: 0.45, roughness: 0.62, wood: 0x6b4a2c, polymer: 0x3d372c
  },

  // ---------------- AWP ----------------
  {
    id: 'awp_helix', weapon: 'awp', name: '螺旋', rarity: 'covert',
    desc: '深绿与冷金的螺旋纹，瞄准镜筒保持哑光金属。',
    pattern: 'marble', colors: ['#18231e', '#3e6b5a', '#c9a25a'],
    metalness: 0.85, roughness: 0.3, wood: 0x1a2420, polymer: 0x222a25
  },
  {
    id: 'awp_aurora', weapon: 'awp', name: '极光', rarity: 'archive',
    desc: '从深蓝到青绿的极光渐变，典藏展柜的远射主角。',
    pattern: 'fade', colors: ['#101a2a', '#2f7a8f', '#9fd8c8'],
    metalness: 0.9, roughness: 0.26, wood: 0x14202a, polymer: 0x17242c
  },

  // ---------------- USP-S ----------------
  {
    id: 'usp_ghost', weapon: 'usp', name: '幽灵', rarity: 'classified',
    desc: '白灰几何面板与黑色消音器，干净得像一张战术图纸。',
    pattern: 'geo', colors: ['#e6e6e0', '#20242a', '#8fb2c9'],
    metalness: 0.55, roughness: 0.42, wood: 0x2a2e32, polymer: 0x1d2024
  },

  // ---------------- 沙漠之鹰 ----------------
  {
    id: 'deagle_ember', weapon: 'deagle', name: '余烬', rarity: 'covert',
    desc: '黑铁底与暗橙速度线，枪口保留高抛光钢。',
    pattern: 'redline', colors: ['#1a1614', '#d9662f', '#e8d4a8'],
    metalness: 0.88, roughness: 0.32, wood: 0x241c18, polymer: 0x1a1816
  },

  // ---------------- MP9 ----------------
  {
    id: 'mp9_carbon', weapon: 'mp9', name: '青棱', rarity: 'restricted',
    desc: '碳纤维与青色棱线，轻量冲锋枪的冷色方案。',
    pattern: 'carbon', colors: ['#15181a', '#2f6a72', '#a8c9c4'],
    metalness: 0.7, roughness: 0.38, wood: 0x1a1e20, polymer: 0x14181a
  },
  // ---------------- 刀 ----------------
  {
    id: 'knife_gilded', weapon: 'knife', name: '鎏金', rarity: 'archive',
    desc: '整刀鎏金，刃口保留冷钢原色。典藏家展位上的常驻主角。',
    pattern: 'gold', colors: ['#c9a25a', '#f0d79a', '#5c441c'],
    metalness: 0.95, roughness: 0.22, handle: 0x3a2c18
  },
  {
    id: 'knife_quench', weapon: 'knife', name: '淬火', rarity: 'covert',
    desc: '高温淬火形成的蓝紫斑纹，每一把的纹路都不同。',
    pattern: 'marble', colors: ['#232a3a', '#5f7fb8', '#c9a25a'],
    metalness: 0.92, roughness: 0.26, handle: 0x1e2228
  },
  {
    id: 'knife_marble', weapon: 'knife', name: '流云', rarity: 'classified',
    desc: '暖沙、玫红与米白的大理石渐变，像沙丘日落。',
    pattern: 'fade', colors: ['#d9b47a', '#c0507a', '#e8ddc8'],
    metalness: 0.88, roughness: 0.28, handle: 0x3a2c28
  },
  {
    id: 'knife_obsidian', weapon: 'knife', name: '黑曜', rarity: 'restricted',
    desc: '镜面黑刃，只有刃口反出一线冷光。',
    pattern: 'obsidian', colors: ['#101214', '#2a2e36', '#9fb8c9'],
    metalness: 0.98, roughness: 0.16, handle: 0x18191c
  },
  {
    id: 'knife_fang', weapon: 'knife', name: '赤獠', rarity: 'milspec',
    desc: '暗红与骨白的刃面，握把缠着旧布。',
    pattern: 'redline', colors: ['#2a1c1a', '#a83a32', '#d8c8b0'],
    metalness: 0.85, roughness: 0.34, handle: 0x3a2420
  }
];

export const SKIN_MAP = {};
SKINS.forEach((s) => { SKIN_MAP[s.id] = s; });

/* ------------------------------------------------------------------ */
/* 品相：磨损度 + 图案种子/偏移                                         */
/* ------------------------------------------------------------------ */

export const WEAR_BANDS = [
  { max: 0.07, name: '崭新出厂', color: '#7fc48a' },
  { max: 0.15, name: '略有磨损', color: '#8fb2c9' },
  { max: 0.38, name: '久经沙场', color: '#d9b47a' },
  { max: 0.45, name: '破损不堪', color: '#c98a5a' },
  { max: 1.01, name: '战痕累累', color: '#c94f45' }
];

export function wearLabel(w) {
  const v = Math.max(0, Math.min(1, w || 0));
  for (const b of WEAR_BANDS) if (v < b.max) return b;
  return WEAR_BANDS[WEAR_BANDS.length - 1];
}

/** 5 个预设品相；同一件皮肤可以有完全不同的磨损与图案。 */
export const VARIANT_PRESETS = [
  { wear: 0.028, seed: 132, offset: 0.18 },
  { wear: 0.102, seed: 509, offset: 0.52 },
  { wear: 0.236, seed: 886, offset: 0.71 },
  { wear: 0.412, seed: 1207, offset: 0.37 },
  { wear: 0.548, seed: 1734, offset: 0.86 }
];

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

export function defaultVariant(skin, presetIndex) {
  const idx = presetIndex != null ? presetIndex : hashId(skin.id) % VARIANT_PRESETS.length;
  const p = VARIANT_PRESETS[idx];
  return { wear: p.wear, seed: p.seed, offset: p.offset, preset: idx };
}

export function nextVariant(skin, variant) {
  const cur = variant && variant.preset != null
    ? variant.preset
    : defaultVariant(skin).preset;
  return defaultVariant(skin, (cur + 1) % VARIANT_PRESETS.length);
}

/** 纹理缓存用的量化 key；界面仍显示真实小数。 */
export function variantKey(v) {
  if (!v) return '0.00_0_0';
  const w = Math.round(Math.max(0, Math.min(1, v.wear || 0)) * 20) / 20;
  const s = Math.abs((v.seed || 0) | 0) % 4;
  const o = Math.round((v.offset || 0) * 4) % 4;
  return w.toFixed(2) + '_' + s + '_' + o;
}

export function entryId(entry) {
  if (!entry) return null;
  return typeof entry === 'string' ? entry : entry.id;
}

export function entryVariant(entry, skin) {
  if (entry && typeof entry === 'object' && entry.variant) return entry.variant;
  return skin ? defaultVariant(skin) : null;
}

export function makeEntry(id, variant) {
  return { id: id, variant: Object.assign({}, variant) };
}

export const DEFAULT_LOADOUT = {
  ak: makeEntry('ak_redline', { wear: 0.236, seed: 886, offset: 0.71, preset: 2 }),
  glock: makeEntry('glock_ash', { wear: 0.102, seed: 509, offset: 0.52, preset: 1 }),
  knife: makeEntry('knife_quench', { wear: 0.028, seed: 132, offset: 0.18, preset: 0 })
};

export function cloneLoadout() {
  const out = {};
  Object.keys(DEFAULT_LOADOUT).forEach((k) => {
    const e = DEFAULT_LOADOUT[k];
    out[k] = { id: e.id, variant: Object.assign({}, e.variant) };
  });
  return out;
}

export function skinsFor(weapon) {
  return SKINS.filter((s) => s.weapon === weapon);
}

export function defaultSkinFor(weapon) {
  const list = skinsFor(weapon);
  return list.length ? list[0].id : null;
}
