// 人物模型统一走圆润卡通人形（1.8 m，胶囊四肢 + 球形头 + 烘焙五官）。
// 具体几何、脸、头发与材质都在 render/roblox.js，这里只保留原有导出名，
// 让人群 / 展位 / Bot 三处调用方无需改动。

export {
  avatarGeometries,
  avatarMaterials,
  crowdGeometries,
  characterCloth,
  buildHumanoid,
  animateHumanoid,
  buildHero,
  makeNameplate,
  PALETTE,
  AVATAR
} from './roblox.js';
