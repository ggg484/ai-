// 外部建模资产加载：assets/models/weapons/*.glb。
//
// 模型由 tools/assetgen 生成（标准 glTF 2.0），可以在 Blockbench 里
// File > Import > glTF 打开继续改，改完再导出覆盖同名文件即可，不用动代码。
// 加载失败时上层自动回退到 js/render/weapon-models.js 的程序化模型。

import * as THREE from '../../vendor/three.module.js';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';

const WEAPON_IDS = ['ak', 'm4', 'awp', 'mp9', 'glock', 'usp', 'deagle', 'knife'];

// glb 里的材质名 → 游戏内的材质角色（皮肤系统按角色换材质）。
const ROLE_BY_MAT = {
  gunmetal: 'metal',
  steel: 'steel',
  alloy: 'metal',
  polymer: 'polymer',
  polymerDark: 'polymer',
  olive: 'olive',
  wood: 'wood',
  woodDark: 'wood',
  brass: 'accent',
  accentRed: 'accent',
  lens: 'lens',
  glove: 'glove',
  sleeve: 'sleeve',
  gloveL: 'glove',
  sleeveL: 'sleeve'
};

// 每把枪的枪口位置（与程序化模型完全一致，viewmodel 的枪焰挂在这里）。
const MUZZLE = {
  ak: [0, 0.024, -0.76],
  m4: [0, 0.022, -0.72],
  awp: [0, 0.026, -0.94],
  mp9: [0, 0.032, -0.45],
  glock: [0, 0.034, -0.25],
  usp: [0, 0.038, -0.25],
  deagle: [0, 0.02, -0.3],
  knife: [0, 0.02, -0.43]
};

const CACHE = new Map();
let loadedCount = 0;
let propLoaded = 0;
let started = false;
let finished = false;

/** 已加载的武器数量（用于启动日志与 smoke 断言）。 */
export function loadedWeaponModels() {
  return loadedCount;
}

export function weaponModelsSettled() {
  return finished;
}

/** 已加载的道具数量。 */
export function loadedPropModels() {
  return propLoaded;
}

/** 预热所有武器 glb。失败不抛错，只是继续用程序化模型。 */
export async function preloadWeaponModels() {
  if (started) return loadedCount;
  started = true;
  const loader = new GLTFLoader();
  await Promise.all(WEAPON_IDS.map(async (id) => {
    const url = new URL(`../../assets/models/weapons/${id}.glb`, import.meta.url).href;
    try {
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene;
      root.traverse((n) => {
        if (!n.isMesh) return;
        const matName = n.material && n.material.name ? n.material.name : '';
        n.userData.role = ROLE_BY_MAT[matName] || 'metal';
        n.castShadow = true;
        n.receiveShadow = true;
      });
      CACHE.set(id, root);
      loadedCount++;
    } catch (e) {
      console.warn('[assets] 缺少武器模型 ' + id + '，回退程序化几何');
    }
  }));
  finished = true;
  if (loadedCount) console.info('[assets] GLB 武器接入 ' + loadedCount + '/' + WEAPON_IDS.length);
  return loadedCount;
}

/**
 * 取一份可直接挂进场景的武器实例。
 * @param {string} id
 * @param {{hands?:boolean, depthTest?:boolean, renderOrder?:number}} [opts]
 */
export function buildWeaponAsset(id, opts) {
  const src = CACHE.get(id);
  if (!src) return null;
  const o = opts || {};
  const withHands = o.hands !== false;
  const depthTest = o.depthTest !== false;
  const renderOrder = o.renderOrder != null ? o.renderOrder : 1000;

  const g = src.clone(true);
  g.name = 'weapon';
  const left = {};
  const drop = [];

  g.traverse((n) => {
    if (!n.isMesh) return;
    const role = n.userData.role || 'metal';
    // 材质名以 L 结尾的是左手（gloveL / sleeveL），单独记下来给 reload 动画用。
    const matName = (n.material && n.material.name) || '';
    const isLeft = matName.endsWith('L');
    const isHand = role === 'glove' || role === 'sleeve';
    if (isHand && !withHands) {
      // 必须真的移出场景：Box3.setFromObject 不认 visible=false，
      // 留着会把手算进包围盒，检视模式会缩得很小。
      drop.push(n);
      return;
    }
    n.castShadow = true;
    n.receiveShadow = true;
    n.renderOrder = renderOrder;
    n.frustumCulled = false;
    // 每个实例克隆材质：第一人称要关 depthTest，皮肤系统也会按实例替换。
    if (n.material) {
      const m = n.material.clone();
      m.depthTest = depthTest;
      m.depthWrite = false;
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
      n.material = m;
    }
    // 左手节点：reload 时 viewmodel 会直接改它们的 position / rotation。
    if (isLeft && isHand) left[role] = n;
  });

  for (const n of drop) if (n.parent) n.parent.remove(n);

  const mp = MUZZLE[id] || MUZZLE.ak;
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.fromArray(mp);
  g.add(muzzle);

  if (withHands) g.userData.left = left;
  g.userData.muzzle = muzzle;
  g.userData.weaponId = id;
  return g;
}


/* ------------------------------------------------------------------ */
/* 战术道具                                                            */
/* ------------------------------------------------------------------ */

const PROP_IDS = ['he', 'flash', 'smoke', 'molotov', 'c4', 'defuse', 'armor', 'case'];
const PROP_CACHE = new Map();
let propStarted = false;

export async function preloadPropModels() {
  if (propStarted) return propLoaded;
  propStarted = true;
  const loader = new GLTFLoader();
  await Promise.all(PROP_IDS.map(async (id) => {
    const url = new URL(`../../assets/models/props/${id}.glb`, import.meta.url).href;
    try {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((n) => {
        if (!n.isMesh) return;
        n.castShadow = true;
        n.receiveShadow = true;
      });
      PROP_CACHE.set(id, gltf.scene);
      propLoaded++;
    } catch (e) {
      console.warn('[assets] 缺少道具模型 ' + id + '，回退程序化几何');
    }
  }));
  if (propLoaded) console.info('[assets] GLB 道具接入 ' + propLoaded + '/' + PROP_IDS.length);
  return propLoaded;
}

export function buildPropAsset(id) {
  const src = PROP_CACHE.get(id);
  if (!src) return null;
  const g = src.clone(true);
  g.traverse((n) => {
    if (!n.isMesh) return;
    n.castShadow = true;
    n.receiveShadow = true;
    if (n.material) {
      const m = n.material.clone();
      m.side = THREE.DoubleSide;
      n.material = m;
    }
  });
  return g;
}
