// 阵营视觉：T / CT 的衣服配色与命中标记颜色。
// Roblox 方块人的阵营辨识主要靠躯干色块，所以阵营色直接落在衬衫/裤子上，
// 不额外挂几何件（避免 draw call 与遮挡问题）。

import * as THREE from '../../vendor/three.module.js';
import { PALETTE } from './roblox.js';

export const FACTION = {
  t: {
    key: 't', label: 'T',
    shirt: '#c4621b',     // Bright orange：暖色阵营
    pants: '#4a3624',     // 深棕裤子
    skin: PALETTE.skin,
    markerHex: 0xff8c1a
  },
  ct: {
    key: 'ct', label: 'CT',
    shirt: '#0d69ac',     // Bright blue：冷色阵营
    pants: '#33455e',
    skin: PALETTE.skin,
    markerHex: 0x39b6ff
  }
};

export function factionOf(key) {
  return FACTION[key] || FACTION.ct;
}

/**
 * 给角色换阵营配色。材质是每个角色独立的实例（buildHumanoid 已 clone），
 * 这里直接改 material.color，不碰几何，也不会互相污染。
 */
export function applyFaction(humanoid, key) {
  const f = factionOf(key);
  if (!humanoid || !humanoid.userData || !humanoid.userData.parts) return humanoid;
  if (humanoid.userData.faction === f.key) return humanoid;
  humanoid.userData.faction = f.key;

  const m = humanoid.userData.mats;
  if (m) {
    if (m.shirt) m.shirt.color.set(f.shirt);
    if (m.pants) m.pants.color.set(f.pants);
  } else {
    // 兜底：按材质名推断（老结构）
    const parts = humanoid.userData.parts;
    if (parts.torso && parts.torso.material) parts.torso.material.color.set(f.shirt);
    for (const p of [parts.legL, parts.legR]) {
      if (p && p.children[0] && p.children[0].material) p.children[0].material.color.set(f.pants);
    }
  }
  return humanoid;
}
