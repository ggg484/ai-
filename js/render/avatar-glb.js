// 对局角色：Builda 扩展包里的 Roblox-Bacon-Hair 骨骼模型（CC-BY-4.0）。
// 只负责“把模型变成可用的对局单位外观”：骨骼克隆、阵营配色、暖肤色、走路动画。
// 命中判定、移动、AI 全部留在 game/bots.js，不因换模型改变。
// 加载失败时调用方自动回退到 render/character.js 的程序化方块人。

import * as THREE from '../../vendor/three.module.js';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';

const MODEL_URL = new URL('../../assets/models/bacon-avatar.glb', import.meta.url).href;

const state = {
  ready: false,
  template: null,
  clip: null,
  scale: 1,
  offset: new THREE.Vector3()
};

/** 模型原图偏白，乘一层暖色让皮肤接近沙城主题的日晒色。 */
const SKIN_TINT = new THREE.Color(0xf3a878);

function cloneSkinned(source) {
  const srcLookup = new Map();
  const clLookup = new Map();
  const clone = source.clone();
  (function walk(a, b) {
    srcLookup.set(b, a);
    clLookup.set(a, b);
    a.children.forEach((c, i) => b.children[i] && walk(c, b.children[i]));
  })(source, clone);
  clone.traverse((n) => {
    if (!n.isSkinnedMesh) return;
    const src = srcLookup.get(n);
    n.skeleton = src.skeleton.clone();
    n.bindMatrix.copy(src.bindMatrix);
    n.skeleton.bones = src.skeleton.bones.map((bn) => clLookup.get(bn));
    n.bind(n.skeleton, n.bindMatrix);
  });
  return clone;
}

/** 预加载模型。返回是否成功；失败时游戏继续用程序化角色。 */
export async function loadAvatarModel() {
  if (state.ready) return true;
  try {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const tmpl = gltf.scene;
    tmpl.updateMatrixWorld(true);

    // 这个 GLB 的原始几何包围盒离骨骼很远，必须用「蒙皮后的包围盒」定尺寸：
    // SkinnedMesh.computeBoundingBox() 会把骨骼变换算进去，得到真正渲染出来的范围。
    const box = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    tmpl.traverse((n) => {
      if (!n.isSkinnedMesh || !n.computeBoundingBox) return;
      n.computeBoundingBox();
      if (!n.boundingBox) return;
      tmpBox.copy(n.boundingBox).applyMatrix4(n.matrixWorld);
      box.union(tmpBox);
    });
    const inv = new THREE.Matrix4().copy(tmpl.matrixWorld).invert();
    box.applyMatrix4(inv);
    const size = box.getSize(new THREE.Vector3());
    if (!(size.y > 0.001)) throw new Error('模型高度异常');
    state.scale = 1.8 / size.y;
    state.offset.set(
      -(box.min.x + box.max.x) / 2,
      -box.min.y,
      -(box.min.z + box.max.z) / 2
    );
    state.template = tmpl;
    state.clip = gltf.animations && gltf.animations.length ? gltf.animations[0] : null;
    state.ready = true;
    // 调试 / 模型工坊读取：不改逻辑，只暴露同一份状态
    window.__avatarState = state;
    console.info('[avatar] bacon-avatar.glb 就绪，clip=' + (state.clip ? state.clip.duration.toFixed(2) + 's' : '无') +
      ' scale=' + state.scale.toFixed(3));
    return true;
  } catch (err) {
    console.warn('[avatar] GLB 加载失败，回退到程序化角色', err);
    return false;
  }
}

export function isAvatarReady() {
  return state.ready;
}

/**
 * 生成一个对局角色。root 的局部 -Z 是正面（与 Bot.group 的朝向约定一致）。
 * @returns {{root:THREE.Group, body:THREE.Object3D, mixer:THREE.AnimationMixer|null,
 *   action:THREE.AnimationAction|null, clip:THREE.AnimationClip|null,
 *   mats:{shirt:THREE.Material,pants:THREE.Material,skin:THREE.Material}}}
 */
export function createAvatar(faction) {
  if (!state.ready) return null;
  const f = faction === 't'
    ? { shirt: 0xc4621b, pants: 0x4a3624 }
    : { shirt: 0x0d69ac, pants: 0x33455e };

  const root = new THREE.Group();
  const facing = new THREE.Group();
  facing.rotation.y = Math.PI; // 模型正面朝 +Z，翻过来对上 Bot 的 -Z
  root.add(facing);

  const body = cloneSkinned(state.template);
  body.scale.setScalar(state.scale);
  body.position.copy(state.offset).multiplyScalar(state.scale);
  facing.add(body);

  // 按网格局部包围盒分部件：头发原贴图、头/手臂暖肤色、上衣/裤子阵营色
  const localBox = new THREE.Box3();
  body.traverse((n) => {
    if (!n.isMesh) return;
    n.geometry.computeBoundingBox();
    localBox.union(n.geometry.boundingBox);
  });
  const lMin = localBox.min.y;
  const lH = localBox.max.y - localBox.min.y;
  const lCX = (localBox.min.x + localBox.max.x) / 2;
  const lW = localBox.max.x - localBox.min.x;

  const shirtMat = new THREE.MeshLambertMaterial({ color: f.shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: f.pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  let skinReady = false;

  body.traverse((n) => {
    if (!n.isMesh) return;
    n.castShadow = true;
    n.receiveShadow = true;
    const b = n.geometry.boundingBox;
    const cy = (b.min.y + b.max.y) / 2 - lMin;
    const top = (b.max.y - lMin) / lH;
    const cx = (b.min.x + b.max.x) / 2;
    const h = cy / lH;
    const orig = Array.isArray(n.material) ? n.material[0] : n.material;
    if (top > 0.95) {
      // 头发：最高的一块是蓬起的头发，保留原贴图
      n.material = orig;
    } else if (top > 0.80) {
      // 头 / 脸：保留脸贴图，乘暖肤色
      if (!skinReady) {
        skinMat.map = orig.map || null;
        skinMat.color.copy(SKIN_TINT);
        skinMat.roughness = 0.92;
        skinMat.needsUpdate = true;
        skinReady = true;
      }
      n.material = skinMat;
    } else if (Math.abs(cx - lCX) > lW * 0.22) {
      // 手臂：保留皮肤贴图 + 暖色调
      if (!skinReady) {
        skinMat.map = orig.map || null;
        skinMat.color.copy(SKIN_TINT);
        skinMat.roughness = 0.92;
        skinMat.needsUpdate = true;
        skinReady = true;
      }
      n.material = skinMat;
    } else if (h < 0.36) {
      n.material = pantsMat;
    } else {
      n.material = shirtMat;
    }
  });

  let clip = null;
  let mixer = null;
  let action = null;
  if (state.clip) {
    clip = state.clip;
    mixer = new THREE.AnimationMixer(body);
    action = mixer.clipAction(clip);
    action.play();
    action.paused = false;
    action.time = 0;
    mixer.update(0.0001);
  }

  // 右手骨骼：枪挂点每帧跟随它，看起来像被握在手里
  // GLTFLoader 会去掉名字里的冒号（mixamorig:RightHand_019_38 → mixamorigRightHand_019_38）
  let hand = null;
  const bones = {};
  const bind = {};
  body.traverse((n) => {
    if (!n.isBone) return;
    const nm = n.name;
    if (!hand && nm.indexOf('RightHand') >= 0 && nm.indexOf('Index') < 0) hand = n;
    const key =
      nm.indexOf('RightShoulder') >= 0 ? 'rightShoulder' :
      nm.indexOf('RightForeArm') >= 0 ? 'rightForeArm' :
      nm.indexOf('RightArm') >= 0 ? 'rightArm' :
      nm.indexOf('LeftShoulder') >= 0 ? 'leftShoulder' :
      nm.indexOf('LeftForeArm') >= 0 ? 'leftForeArm' :
      nm.indexOf('LeftArm') >= 0 ? 'leftArm' :
      nm.indexOf('Spine2') >= 0 ? 'spine2' :
      nm.indexOf('Spine1') >= 0 ? 'spine1' :
      nm.indexOf('Spine_02') >= 0 ? 'spine' :
      nm.indexOf('Hips') >= 0 ? 'hips' :
      nm.indexOf('RightUpLeg') >= 0 ? 'rightUpLeg' :
      nm.indexOf('RightLeg') >= 0 ? 'rightLeg' :
      nm.indexOf('RightFoot') >= 0 ? 'rightFoot' :
      nm.indexOf('LeftUpLeg') >= 0 ? 'leftUpLeg' :
      nm.indexOf('LeftLeg') >= 0 ? 'leftLeg' :
      nm.indexOf('LeftFoot') >= 0 ? 'leftFoot' :
      nm.indexOf('Neck') >= 0 ? 'neck' :
      nm.indexOf('Head') >= 0 ? 'head' : null;
    if (!key || bones[key]) return;
    bones[key] = n;
    bind[key] = {
      q: n.quaternion.clone(),
      p: n.position.clone()
    };
  });

  // 按「当前看到的蒙皮包围盒」把角色精确归一到 1.8 m，并把脚底放到 y=0。
  // GLB 自带动画第一帧会把骨架缩放到和 bind pose 不同的比例，只靠模板尺寸不够。
  root.updateMatrixWorld(true);
  const fitBox = new THREE.Box3();
  const tmpB = new THREE.Box3();
  body.traverse((n) => {
    if (!n.isSkinnedMesh || !n.computeBoundingBox) return;
    n.computeBoundingBox();
    if (!n.boundingBox) return;
    tmpB.copy(n.boundingBox).applyMatrix4(n.matrixWorld);
    fitBox.union(tmpB);
  });
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  fitBox.applyMatrix4(invRoot);
  const fitSize = fitBox.getSize(new THREE.Vector3());
  const fitScale = fitSize.y > 0.001 ? 1.8 / fitSize.y : 1;
  const fitDrop = -fitBox.min.y * fitScale;
  root.scale.setScalar(fitScale);
  root.position.y = fitDrop;

  return {
    root,
    body,
    hand,
    bones,
    bind,
    mixer,
    action,
    clip,
    fitScale,
    fitDrop,
    mats: { shirt: shirtMat, pants: pantsMat, skin: skinMat }
  };
}

/* ------------------------------------------------------------------ */
/* 程序化上半身动作：走路由 GLB 片段驱动，手臂 / 射击 / 换弹 / 蹲下叠加 */
/* ------------------------------------------------------------------ */

// 持枪基准姿态（可被 assets/character-rig.json 覆盖）
const POSE = {
  rightArm: [-0.55, -0.30, -0.52],
  rightForeArm: [-0.55, 0, 0],
  leftArm: [-0.50, 0.40, 0.62],
  leftForeArm: [-0.75, 0, 0.1],
  spine: [0.05, 0, 0]
};

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

function applyPose(av, opts) {
  const b = av.bones;
  const bind = av.bind;
  if (!b || !bind) return;
  const speed = opts.speed || 0;
  const moving = speed > 0.15;
  const shoot = opts.shoot || 0;
  const reload = opts.reload || 0;
  const pose = av.pose || POSE;

  // 步行相位：腿由程序化摆动，避免 GLB 动画把骨架缩放到错误比例
  av.phase = (av.phase || 0) + (moving ? speed * 2.35 : 0.8) * (opts.dt || 0.016);
  const swing = Math.sin(av.phase) * (moving ? 0.62 : 0.05);
  const liftL = Math.max(0, -Math.sin(av.phase)) * (moving ? 0.9 : 0.1);
  const liftR = Math.max(0, Math.sin(av.phase)) * (moving ? 0.9 : 0.1);

  function reset(key) {
    if (b[key] && bind[key]) b[key].quaternion.copy(bind[key].q);
  }
  function add(key, x, y, z) {
    if (!b[key] || !bind[key]) return;
    _e.set(x || 0, y || 0, z || 0);
    b[key].quaternion.copy(bind[key].q).multiply(_q.setFromEuler(_e));
  }

  // 手臂：持枪姿态 + 后坐 / 换弹偏移。
  // 步枪的左手要更往前伸到护木；手枪是双手托握；刀只抬右手。
  const wc = av.weaponClass || 'pistol';
  const rifle = wc === 'rifle' ? 1 : 0;
  const knife = wc === 'knife' ? 1 : 0;
  add('rightArm', pose.rightArm[0] + shoot * 0.22, pose.rightArm[1], pose.rightArm[2]);
  add('rightForeArm', pose.rightForeArm[0] + shoot * 0.16, pose.rightForeArm[1], pose.rightForeArm[2]);
  add('leftArm',
    pose.leftArm[0] - reload * 0.6 - rifle * 0.28 + knife * 0.35,
    pose.leftArm[1] + rifle * 0.10,
    pose.leftArm[2] + rifle * 0.05);
  add('leftForeArm',
    pose.leftForeArm[0] - reload * 0.35 - rifle * 0.22,
    pose.leftForeArm[1],
    pose.leftForeArm[2] + reload * 0.25 + rifle * 0.10);

  // 腿：走路摆动；蹲下时收腿
  const crouch = opts.crouch ? 1 : 0;
  add('leftUpLeg', swing - crouch * 0.55, 0, 0);
  add('rightUpLeg', -swing - crouch * 0.55, 0, 0);
  add('leftLeg', liftL + crouch * 0.95, 0, 0);
  add('rightLeg', liftR + crouch * 0.95, 0, 0);
  add('leftFoot', -swing * 0.35 - crouch * 0.35, 0, 0);
  add('rightFoot', swing * 0.35 - crouch * 0.35, 0, 0);

  // 脊柱前倾 + 射击/换弹轻微扭动
  add('spine', pose.spine[0] + (moving ? 0.06 : 0) - shoot * 0.05 - reload * 0.07, 0, 0);
  add('spine2', -shoot * 0.04 - reload * 0.05, 0, 0);
  add('neck', -pose.spine[0] * 0.5 + shoot * 0.02, 0, 0);

  if (b.hips && bind.hips) {
    b.hips.position.y = bind.hips.p.y + (moving ? Math.abs(Math.sin(av.phase * 2)) * 0.035 : 0) - crouch * (av.crouchDrop || 0.26);
  }
  reset('leftShoulder');
  reset('rightShoulder');
}

/**
 * 驱动人物动作。speed 为水平速度（m/s）。
 * opts: { engage, shoot(0..1), reload(0..1), crouch, dead, dt }
 * 说明：只把 GLB 动画当静态握持底姿，肢体动作由程序化驱动，
 * 这样不会出现这个模型自带的骨架缩放问题。
 */
export function animateAvatar(av, dt, speed, opts) {
  if (!av) return;
  if (av.action) {
    av.action.paused = true;
    av.action.time = 0;
  }
  if (av.mixer) av.mixer.update(0);
  if (!opts || !opts.dead) applyPose(av, Object.assign({ dt: dt, speed: speed }, opts || {}));
}
