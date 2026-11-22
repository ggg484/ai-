// 程序化武器模型：用挤出截面 + 倒角 + 多材质零件，做出「有厚度、有倒角」的枪。
// 不是低多边形盒子堆；也不是最终资产（最终走 GLB + KTX2，见 docs/SKIN-PIPELINE.md）。
// 约定：枪口朝 -Z，Y 向上，单位米；Viewmodel 再整体缩放。

import * as THREE from '../../vendor/three.module.js';
import { mergeGeos } from '../world/geo-utils.js';
import { metalTexture, woodTexture, polymerTexture, getPhotoMaps } from '../world/textures.js';

/* ------------------------------------------------------------------ */
/* 几何工具                                                            */
/* ------------------------------------------------------------------ */

// 视角模型/检视用高细节，远处展柜用低细节；枪械不做减面处理。
let DETAIL = 2.2;

function shape2d(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/**
 * 把 2D 侧面轮廓沿宽度挤出，并旋转到「长轴 = Z、宽度 = X」。
 * pts 的 x 正方向 = 枪口方向（最终 -Z）。
 */
function profile(pts, width, bevelSeg, bevelSize) {
  const geo = new THREE.ExtrudeGeometry(shape2d(pts), {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevelSize == null ? 0.004 : bevelSize,
    bevelSize: bevelSize == null ? 0.004 : bevelSize,
    bevelSegments: bevelSeg == null ? (DETAIL > 1.5 ? 3 : 2) : bevelSeg,
    curveSegments: Math.max(8, Math.round(8 * DETAIL)),
    steps: 1
  });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

function cylinder(r, len, seg) {
  const g = new THREE.CylinderGeometry(r, r, len, Math.max(8, Math.round((seg || 14) * DETAIL)));
  g.rotateX(Math.PI / 2); // 轴向 -> Z
  return g;
}

function roundedBox(w, h, d) {
  // 用挤出的圆角截面代替 BoxGeometry，边缘有高光
  const r = Math.min(w, h) * 0.18;
  const pts = [
    [-w / 2 + r, -h / 2], [w / 2 - r, -h / 2], [w / 2, -h / 2 + r],
    [w / 2, h / 2 - r], [w / 2 - r, h / 2], [-w / 2 + r, h / 2],
    [-w / 2, h / 2 - r], [-w / 2, -h / 2 + r]
  ];
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: d, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003,
    bevelSegments: DETAIL > 1.5 ? 3 : 2,
    curveSegments: Math.max(4, Math.round(4 * DETAIL)), steps: 1
  });
  g.translate(0, 0, -d / 2);
  return g;
}

function place(geo, x, y, z, rx, ry, rz) {
  if (rx || ry || rz) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)));
  geo.translate(x || 0, y || 0, z || 0);
  return geo;
}

/* ------------------------------------------------------------------ */
/* 材质                                                                */
/* ------------------------------------------------------------------ */

function matSet(opts) {
  const depthTest = !(opts && opts.depthTest === false);
  const renderOrder = opts && opts.renderOrder != null ? opts.renderOrder : 1000;
  const base = {
    depthTest: depthTest,
    depthWrite: false,
    side: THREE.DoubleSide
  };
  function make(params, map) {
    const m = new THREE.MeshStandardMaterial(Object.assign({}, base, params));
    if (map) m.map = map;
    m.envMapIntensity = 1.25;
    return m;
  }
  const out = {
    metal: make({ color: 0x4c5257, metalness: 0.6, roughness: 0.52 }, metalTexture({ tone: 96, scratch: 1.3 })),
    steel: make({ color: 0xb3babd, metalness: 0.96, roughness: 0.26 }, metalTexture({ tone: 158, scratch: 1.8 })),
    wood: make({ color: 0x9a6238, metalness: 0.04, roughness: 0.54 }, woodTexture()),
    polymer: make({ color: 0x2a2d2f, metalness: 0.06, roughness: 0.74 }, polymerTexture(44)),
    accent: make({ color: 0x8d6a38, metalness: 0.7, roughness: 0.36 }, metalTexture({ tone: 104, scratch: 0.6 })),
    blade: make({ color: 0xd2d9dc, metalness: 1.0, roughness: 0.17 }, metalTexture({ tone: 186, scratch: 2.2 })),
    handle: make({ color: 0x26282a, metalness: 0.25, roughness: 0.62 }, polymerTexture(34)),
    lens: make({ color: 0x1e3650, metalness: 0.5, roughness: 0.05, emissive: 0x0a1f33, emissiveIntensity: 0.8 }),
    suppressor: make({ color: 0x24282b, metalness: 0.82, roughness: 0.4 }, metalTexture({ tone: 54, scratch: 1.2 })),
    olive: make({ color: 0x55603c, metalness: 0.05, roughness: 0.66 }, polymerTexture(70)),
    hardware: make({ color: 0x3a3f42, metalness: 0.86, roughness: 0.38 }, metalTexture({ tone: 64, scratch: 1.1 })),
    glove: make({ color: 0x40352a, metalness: 0.04, roughness: 0.88 }),
    sleeve: make({ color: 0x3d3e32, metalness: 0.02, roughness: 0.94 })
  };
  for (const [role, m] of Object.entries(out)) {
    m.userData.weaponRole = role;
    weaponMats.push(m);
    applyPhotoToMat(m, role);
  }
  return out;
}

const weaponMats = [];

function applyPhotoToMat(m, role) {
  let kind = null;
  let repeat = 1;
  if (role === 'wood') { kind = 'wood'; repeat = 3; }
  else if (role === 'polymer' || role === 'handle' || role === 'olive') { kind = 'polymer'; repeat = 2; }
  if (!kind) return;
  const tex = getPhotoMaps(kind, repeat);
  if (!tex) return;
  m.map = tex.map;
  m.normalMap = tex.normalMap;
  m.roughnessMap = null;
  m.normalScale.set(0.55, 0.55);
  if (role === 'wood') {
    m.color.setHex(0x7a4a2a);
    m.roughness = 0.78;
    m.envMapIntensity = 0.5;
  } else if (role === 'polymer' || role === 'handle') {
    m.color.setHex(0x333638);
    m.roughness = 0.84;
    m.envMapIntensity = 0.55;
  }
  m.needsUpdate = true;
}

/** 贴图异步加载完成后，刷新所有已创建的武器材质。 */
export function refreshWeaponTextures() {
  for (const m of weaponMats) applyPhotoToMat(m, m.userData.weaponRole);
  console.info('[weapons] CC0 武器材质已接入：' + weaponMats.length + ' 个材质');
}

/* ------------------------------------------------------------------ */
/* 手部 / 前臂                                                         */
/* ------------------------------------------------------------------ */

// 每把枪的右手握把点 + 左手托枪点（模型局部坐标，枪口 -Z，单位米）。
// 手枪的左手托住右手；刀只有右手。位置由各枪的握把/护木实际坐标决定。
const HAND_LAYOUT = {
  ak:     { right: [0.004, -0.105, 0.150], left: [-0.020, -0.092, -0.245] },
  m4:     { right: [0.004, -0.105, 0.130], left: [-0.020, -0.072, -0.300] },
  awp:    { right: [0.004, -0.110, 0.130], left: [-0.020, -0.078, -0.260] },
  mp9:    { right: [0.004, -0.105, 0.075], left: [-0.020, -0.062, -0.250] },
  glock:  { right: [0.004, -0.110, 0.055], left: [-0.048, -0.138, 0.035], pistol: true },
  usp:    { right: [0.004, -0.110, 0.055], left: [-0.048, -0.142, 0.035], pistol: true },
  deagle: { right: [0.004, -0.120, 0.060], left: [-0.052, -0.152, 0.040], pistol: true },
  knife:  { right: [0.004, -0.020, 0.060], left: null }
};

function capsuleBetween(a, b, rA, rB) {
  const from = new THREE.Vector3().fromArray(a);
  const to = new THREE.Vector3().fromArray(b);
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-4) return null;
  const g = new THREE.CylinderGeometry(rA, rB == null ? rA : rB, len, 10, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), dir.clone().normalize()
  ));
  const mid = from.clone().add(to).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function addForearm(parts, hand, side, pistol) {
  const sx = side === 'right' ? 1 : -1;
  const wrist = [hand[0] + sx * 0.012, hand[1] - 0.035, hand[2] + 0.055];
  // 右手前臂可以长一点；左手只留一小截，避免在步枪护木下变成一根横跨屏幕的杆。
  const elbow = side === 'right'
    ? [hand[0] + 0.300, hand[1] - 0.330, hand[2] + 0.460]
    : [hand[0] - (pistol ? 0.120 : 0.080), hand[1] - (pistol ? 0.180 : 0.130), hand[2] + (pistol ? 0.140 : 0.090)];
  const arm = capsuleBetween(wrist, elbow, 0.038, 0.058);
  if (arm) parts[side === 'right' ? 'sleeve' : 'sleeveL'].push(arm);
  // 袖口：比前臂粗一圈，颜色分界更清楚。
  const cuff = capsuleBetween(
    wrist,
    [wrist[0] + sx * 0.020, wrist[1] - 0.050, wrist[2] + 0.068],
    0.046, 0.052
  );
  if (cuff) parts[side === 'right' ? 'sleeve' : 'sleeveL'].push(cuff);
}

function addRightHand(parts, hand) {
  const [x, y, z] = hand;
  const palm = roundedBox(0.075, 0.095, 0.105);
  place(palm, x, y, z, 0, 0, 0.06);
  parts.glove.push(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.CapsuleGeometry(0.0095, 0.034, 3, 6);
    f.rotateZ(Math.PI / 2);
    place(f, x + 0.036, y - 0.055 + i * 0.017, z - 0.030, 0, 0, 0.12);
    parts.glove.push(f);
  }
  const th = new THREE.CapsuleGeometry(0.011, 0.038, 3, 6);
  th.rotateX(Math.PI / 2);
  place(th, x - 0.036, y - 0.004, z + 0.030, 0.15, 0, -0.35);
  parts.glove.push(th);
}

function addSupportHand(parts, hand, pistol) {
  const [x, y, z] = hand;
  const palm = roundedBox(pistol ? 0.062 : 0.082, pistol ? 0.075 : 0.070, pistol ? 0.085 : 0.110);
  place(palm, x, y, z, 0, pistol ? 0.35 : 0, pistol ? -0.45 : -0.12);
  parts.gloveL.push(palm);
  const n = pistol ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const f = new THREE.CapsuleGeometry(pistol ? 0.0085 : 0.009, pistol ? 0.028 : 0.032, 3, 6);
    if (pistol) {
      f.rotateZ(Math.PI / 2);
      place(f, x + 0.026, y - 0.026 + i * 0.014, z - 0.032, 0, 0.2, 0.35);
    } else {
      f.rotateX(Math.PI / 2);
      place(f, x + 0.038, y - 0.022 + i * 0.013, z, 0, 0, 0.1);
    }
    parts.gloveL.push(f);
  }
  const th = new THREE.CapsuleGeometry(0.010, pistol ? 0.030 : 0.034, 3, 6);
  th.rotateX(Math.PI / 2);
  place(th, x - 0.044, y + (pistol ? 0.012 : 0.02), z + (pistol ? 0.006 : -0.020), 0.2, 0, 0.35);
  parts.gloveL.push(th);
}

function addHands(parts, opts, id) {
  if (opts && opts.hands === false) return;
  const layout = HAND_LAYOUT[id] || HAND_LAYOUT.ak;
  if (!parts.gloveL) parts.gloveL = [];
  if (!parts.sleeveL) parts.sleeveL = [];
  addRightHand(parts, layout.right);
  addForearm(parts, layout.right, 'right', false);
  if (layout.left) {
    addSupportHand(parts, layout.left, !!layout.pistol);
    addForearm(parts, layout.left, 'left', !!layout.pistol);
  }
}

/* ------------------------------------------------------------------ */
/* AK-47                                                               */
/* ------------------------------------------------------------------ */

function buildAK(opts) {
  const parts = { metal: [], steel: [], wood: [], polymer: [], accent: [], hardware: [], glove: [], sleeve: [] };

  // 机匣：参考真实 AK 的冲压机匣比例（长 0.36、宽 0.062、高 0.10）
  parts.metal.push(place(profile([
    [-0.17, -0.048], [0.19, -0.048], [0.19, 0.026], [0.155, 0.05],
    [-0.14, 0.05], [-0.17, 0.032]
  ], 0.062, 2, 0.005), 0, 0, 0));

  // 防尘盖：圆弧顶，后部有加强筋
  parts.metal.push(place(profile([
    [-0.10, 0.045], [0.10, 0.045], [0.105, 0.064], [0.088, 0.076],
    [-0.088, 0.076], [-0.105, 0.064]
  ], 0.058, 2, 0.004), 0, 0, 0));
  for (let i = 0; i < 4; i++) {
    parts.metal.push(place(roundedBox(0.056, 0.006, 0.007), 0, 0.076, -0.01 + i * 0.032));
  }

  // 枪管 / 导气管 / 清洁通条
  parts.hardware.push(place(cylinder(0.0125, 0.16, 16), 0, 0.024, -0.28));
  parts.hardware.push(place(cylinder(0.0105, 0.34, 16), 0, 0.024, -0.55));
  parts.hardware.push(place(cylinder(0.0035, 0.26, 8), 0, 0.004, -0.53));
  parts.hardware.push(place(cylinder(0.0115, 0.24, 14), 0, 0.074, -0.39));
  // 枪口：AK 的斜切枪口帽
  parts.hardware.push(place(cylinder(0.015, 0.028, 14), 0, 0.024, -0.735));
  parts.hardware.push(place(cylinder(0.0165, 0.008, 14), 0, 0.024, -0.752));

  // 下护木：椭圆截面木管
  {
    const hg = new THREE.CylinderGeometry(0.037, 0.033, 0.20, 12);
    hg.rotateX(Math.PI / 2);
    hg.scale(1, 1.12, 1);
    hg.translate(0, -0.008, -0.245);
    parts.wood.push(hg);
  }
  // 手指槽（深色）
  for (let i = 0; i < 3; i++) {
    parts.hardware.push(place(roundedBox(0.06, 0.004, 0.012), 0, -0.046, -0.19 - i * 0.045));
  }
  // 上护木（导气管罩）：圆管覆盖导气管
  {
    const uh = new THREE.CylinderGeometry(0.027, 0.025, 0.175, 10);
    uh.rotateX(Math.PI / 2);
    uh.scale(1, 0.85, 1);
    uh.translate(0, 0.064, -0.235);
    parts.wood.push(uh);
  }

  // 导气箍 / 前准星：圆箍包住枪管，上方再接斜块
  parts.hardware.push(place(cylinder(0.022, 0.055, 12), 0, 0.024, -0.52));
  parts.hardware.push(place(profile([
    [0.495, 0.02], [0.55, 0.02], [0.55, 0.06], [0.52, 0.078], [0.495, 0.065]
  ], 0.034, 2, 0.004), 0, 0.0, 0));
  parts.hardware.push(place(cylinder(0.019, 0.045, 12), 0, 0.024, -0.64));
  parts.hardware.push(place(profile([
    [0.62, 0.03], [0.663, 0.03], [0.663, 0.055], [0.64, 0.066], [0.62, 0.055]
  ], 0.03, 2, 0.004), 0, 0.0, 0));
  // 准星柱 + 护耳
  parts.hardware.push(place(cylinder(0.004, 0.055, 8), 0, 0.098, -0.64));
  parts.hardware.push(place(roundedBox(0.034, 0.007, 0.024), 0, 0.126, -0.64));
  for (const sx of [-1, 1]) {
    parts.hardware.push(place(roundedBox(0.005, 0.045, 0.026), sx * 0.016, 0.108, -0.64));
  }

  // 弹匣：香蕉形，前缘外凸、后缘内凹（AK 最强识别特征之一）
  const mag = new THREE.Shape();
  mag.moveTo(0.02, 0.028);
  mag.bezierCurveTo(0.078, -0.04, 0.112, -0.115, 0.128, -0.19);
  mag.lineTo(0.062, -0.208);
  mag.bezierCurveTo(0.032, -0.132, -0.008, -0.05, -0.048, 0.028);
  mag.closePath();
  const magGeo = new THREE.ExtrudeGeometry(mag, {
    depth: 0.052, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004,
    bevelSegments: 2, curveSegments: 12, steps: 1
  });
  magGeo.translate(0, 0, -0.026);
  magGeo.rotateY(Math.PI / 2);
  magGeo.translate(0, -0.055, 0.015);
  parts.polymer.push(magGeo);
  // 弹匣侧面的冲压加强筋（贴在可见的左面）
  for (let i = 0; i < 3; i++) {
    const rib = roundedBox(0.0025, 0.006, 0.075);
    place(rib, -0.0275, -0.095 - i * 0.04, -0.035 - i * 0.01);
    parts.polymer.push(rib);
  }

  // 握把（深色聚合物、后倾、底部金属盖）
  parts.polymer.push(place(profile([
    [-0.028, 0.03], [0.028, 0.035], [0.018, -0.085], [-0.01, -0.105],
    [-0.043, -0.096], [-0.052, -0.02]
  ], 0.046, 2, 0.004), 0, -0.07, 0.15));
  parts.hardware.push(place(roundedBox(0.048, 0.01, 0.058), 0, -0.176, 0.158));

  // 扳机护圈 / 扳机
  const guard = new THREE.TorusGeometry(0.04, 0.005, 7, 16, Math.PI);
  guard.rotateY(Math.PI / 2);
  guard.rotateZ(Math.PI);
  place(guard, 0, -0.052, 0.09, 0.08);
  parts.hardware.push(guard);
  parts.hardware.push(place(roundedBox(0.008, 0.038, 0.012), 0, -0.064, 0.08, -0.2));

  // 枪托：平滑直背 + 下倾 + 背带槽
  {
    const st = new THREE.Shape();
    const pts = [
      [-0.17, 0.048], [-0.24, 0.044], [-0.31, 0.038], [-0.37, 0.030],
      [-0.41, 0.022], [-0.43, 0.010], [-0.435, -0.03], [-0.43, -0.075],
      [-0.405, -0.086], [-0.36, -0.082], [-0.30, -0.068], [-0.24, -0.052],
      [-0.19, -0.035], [-0.17, -0.016]
    ];
    st.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) st.lineTo(pts[i][0], pts[i][1]);
    st.closePath();
    const sg = new THREE.ExtrudeGeometry(st, {
      depth: 0.05, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005,
      bevelSegments: 2, curveSegments: 12, steps: 1
    });
    sg.translate(0, 0, -0.025);
    sg.rotateY(Math.PI / 2);
    parts.wood.push(sg);
  }
  // 枪托底板 + 螺钉 + 底板小门（盘面朝后 +Z，不能侧向露出）
  parts.hardware.push(place(roundedBox(0.052, 0.096, 0.012), 0, -0.036, 0.44));
  parts.hardware.push(place(cylinder(0.017, 0.005, 12), 0, -0.04, 0.447));
  for (const sy of [-0.072, -0.004]) {
    parts.hardware.push(place(cylinder(0.004, 0.005, 8), 0, sy, 0.447));
  }
  // 背带环
  {
    const loop = new THREE.TorusGeometry(0.009, 0.0025, 5, 10);
    loop.rotateY(Math.PI / 2);
    place(loop, -0.031, -0.08, 0.365);
    parts.hardware.push(loop);
  }

  // 表尺座 / 表尺：直接坐在防尘盖顶上，避免“悬浮”
  parts.hardware.push(place(roundedBox(0.052, 0.016, 0.055), 0, 0.084, -0.095));
  parts.hardware.push(place(roundedBox(0.03, 0.006, 0.055), 0, 0.096, -0.095, -0.22));
  // 机匣铆钉 / 抛壳口 / 快慢机
  for (let i = 0; i < 4; i++) {
    parts.hardware.push(place(cylinder(0.0042, 0.004, 8), 0.033, -0.02 + (i % 2) * 0.048, -0.10 + i * 0.06, 0, Math.PI / 2, 0));
  }
  parts.polymer.push(place(roundedBox(0.004, 0.03, 0.078), 0.033, 0.018, -0.035));
  // 快慢机：长条冲压件 + 转轴
  parts.hardware.push(place(roundedBox(0.006, 0.018, 0.15), 0.036, 0.008, 0.03, 0, 0, -0.05));
  parts.hardware.push(place(roundedBox(0.008, 0.026, 0.03), 0.036, 0.008, 0.105));
  parts.hardware.push(place(cylinder(0.009, 0.006, 10), 0.036, 0.008, 0.105, 0, Math.PI / 2, 0));
  // 拉机柄
  parts.hardware.push(place(cylinder(0.007, 0.032, 8), 0.04, 0.032, 0.045, 0, 0, Math.PI / 2));
  {
    const knob = new THREE.SphereGeometry(0.01, 8, 6);
    knob.translate(0.058, 0.032, 0.045);
    parts.hardware.push(knob);
  }
  // 前背带环
  {
    const loop = new THREE.TorusGeometry(0.014, 0.003, 5, 10);
    loop.rotateY(Math.PI / 2);
    place(loop, 0, -0.004, -0.515);
    parts.hardware.push(loop);
  }

  // 高细节件：铆钉、销、散热孔、枪口槽、握把防滑纹（只在视角/检视模型上加）
  if (DETAIL > 1.5) {
    // 机匣另一侧铆钉
    for (let i = 0; i < 4; i++) {
      parts.hardware.push(place(cylinder(0.0042, 0.004, 8), -0.033, -0.02 + (i % 2) * 0.048, -0.10 + i * 0.06, 0, Math.PI / 2, 0));
    }
    // 扳机组销
    for (const z of [0.045, 0.075, 0.105]) {
      parts.hardware.push(place(cylinder(0.0035, 0.005, 8), 0.033, -0.045, z, 0, Math.PI / 2, 0));
    }
    // 弹匣右侧加强筋
    for (let i = 0; i < 3; i++) {
      parts.polymer.push(place(roundedBox(0.0025, 0.006, 0.075), 0.0275, -0.095 - i * 0.04, -0.035 - i * 0.01));
    }
    // 上护木散热孔
    for (let i = 0; i < 6; i++) {
      const hole = new THREE.CylinderGeometry(0.0045, 0.0045, 0.006, 10);
      hole.rotateX(Math.PI / 2);
      hole.translate(0, 0.087, -0.175 - i * 0.025);
      parts.hardware.push(hole);
    }
    // 下护木手指槽补满
    for (let i = 0; i < 3; i++) {
      parts.hardware.push(place(roundedBox(0.06, 0.004, 0.012), 0, -0.046, -0.31 - i * 0.045));
    }
    // 枪口斜切槽
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      parts.hardware.push(place(roundedBox(0.004, 0.02, 0.02), Math.cos(a) * 0.014, 0.024 + Math.sin(a) * 0.014, -0.742));
    }
    // 枪托侧螺钉
    for (const z of [0.30, 0.40]) {
      parts.hardware.push(place(cylinder(0.0035, 0.005, 8), -0.028, -0.02, z, 0, Math.PI / 2, 0));
    }
    // 快慢机定位齿
    parts.hardware.push(place(roundedBox(0.006, 0.01, 0.014), 0.037, 0.008, 0.07));
  }

  addHands(parts, opts, 'ak');
  return assemble(parts, opts, new THREE.Vector3(0, 0.024, -0.76), 0.88);
}

/* ------------------------------------------------------------------ */
/* Glock-18                                                            */
/* ------------------------------------------------------------------ */

function buildGlock(opts) {
  const parts = { metal: [], steel: [], wood: [], polymer: [], accent: [], glove: [], sleeve: [] };

  // 套筒
  parts.steel.push(place(profile([
    [-0.1, -0.022], [0.1, -0.022], [0.1, 0.022], [0.09, 0.032],
    [-0.09, 0.032], [-0.1, 0.022]
  ], 0.034, 2, 0.003), 0, 0.032, -0.055));
  // 套筒前斜切
  parts.steel.push(place(profile([
    [0.06, -0.02], [0.105, -0.02], [0.105, 0.008], [0.075, 0.024], [0.06, 0.02]
  ], 0.036, 2, 0.003), 0, 0.032, -0.055));
  // 套筒防滑纹
  for (let i = 0; i < 6; i++) {
    parts.metal.push(place(roundedBox(0.037, 0.042, 0.004), 0, 0.032, 0.02 + i * 0.012));
  }
  // 枪管
  parts.metal.push(place(cylinder(0.0105, 0.055, 14), 0, 0.03, -0.18));
  parts.metal.push(place(cylinder(0.0115, 0.012, 14), 0, 0.03, -0.207));

  // 下机匣 / 框架
  parts.polymer.push(place(profile([
    [-0.095, -0.03], [0.095, -0.03], [0.095, 0.008], [0.05, 0.022],
    [-0.08, 0.022], [-0.095, 0.008]
  ], 0.032, 2, 0.003), 0, -0.008, -0.05));
  // 握把
  parts.polymer.push(place(profile([
    [-0.034, 0.03], [0.034, 0.03], [0.045, -0.1], [0.018, -0.13],
    [-0.02, -0.125], [-0.038, -0.06]
  ], 0.036, 2, 0.003), 0, -0.085, 0.038, -0.2, 0, 0));
  // 扳机护圈
  const guard = new THREE.TorusGeometry(0.032, 0.0042, 6, 12, Math.PI);
  guard.rotateY(Math.PI / 2);
  guard.rotateZ(Math.PI);
  place(guard, 0, -0.045, -0.015, 0.05);
  parts.polymer.push(guard);
  parts.metal.push(place(roundedBox(0.006, 0.03, 0.01), 0, -0.05, -0.02, -0.2));
  // 弹匣底板
  parts.polymer.push(place(roundedBox(0.038, 0.03, 0.07), 0, -0.17, 0.045, 0.2));

  // 准星 / 照门
  parts.metal.push(place(roundedBox(0.008, 0.012, 0.012), 0, 0.062, -0.14));
  parts.metal.push(place(roundedBox(0.024, 0.01, 0.012), 0, 0.062, 0.04));
  parts.accent.push(place(cylinder(0.0025, 0.004, 6), 0, 0.068, -0.14));

  // 抛壳口 / 分解杆
  parts.metal.push(place(roundedBox(0.038, 0.016, 0.055), 0, 0.045, -0.01));
  parts.steel.push(place(roundedBox(0.004, 0.008, 0.03), 0.018, 0.005, -0.03));
  // 下导轨：给战术灯/激光留接口，剪影上多一层细节
  parts.metal.push(place(roundedBox(0.03, 0.016, 0.09), 0, -0.05, -0.11));
  for (let i = 0; i < 3; i++) {
    parts.metal.push(place(roundedBox(0.032, 0.005, 0.007), 0, -0.059, -0.14 + i * 0.026));
  }

  addHands(parts, opts, 'glock');

  return assemble(parts, opts, new THREE.Vector3(0, 0.034, -0.25));
}

/* ------------------------------------------------------------------ */
/* 刀（弯爪刀）                                                        */
/* ------------------------------------------------------------------ */

function buildKnife(opts) {
  const parts = { metal: [], steel: [], wood: [], polymer: [], accent: [], blade: [], handle: [], glove: [], sleeve: [] };

  // 刀身：新月形（爪刀）；控制点保证不自交，否则会渲染成两个叶片
  const s = new THREE.Shape();
  s.moveTo(0.02, -0.02);
  s.quadraticCurveTo(-0.08, -0.085, -0.20, -0.055);
  s.quadraticCurveTo(-0.30, -0.03, -0.355, 0.075);
  s.quadraticCurveTo(-0.29, 0.015, -0.22, -0.005);
  s.quadraticCurveTo(-0.12, -0.03, 0.02, 0.005);
  s.closePath();
  const blade = new THREE.ExtrudeGeometry(s, {
    depth: 0.0075, bevelEnabled: true, bevelThickness: 0.0018, bevelSize: 0.0018,
    bevelSegments: 2, curveSegments: 14, steps: 1
  });
  blade.translate(0, 0, -0.00375);
  blade.rotateY(-Math.PI / 2); // shape 的 -x 是刀尖，转到 -Z 正前方
  blade.rotateZ(0.06);
  place(blade, 0, 0.01, -0.04);
  parts.blade.push(blade);

  // 护手 / 刀柄
  parts.handle.push(place(roundedBox(0.026, 0.04, 0.055), 0, 0.005, -0.045));
  parts.handle.push(place(profile([
    [-0.07, -0.018], [0.07, -0.016], [0.08, 0.014], [0.05, 0.028],
    [-0.05, 0.026], [-0.078, 0.008]
  ], 0.025, 2, 0.003), 0, -0.005, 0.045, 0.04, 0, 0));
  // 柄上防滑槽
  for (let i = 0; i < 4; i++) {
    const rib = roundedBox(0.027, 0.006, 0.012);
    place(rib, 0, 0.006, 0.02 + i * 0.028);
    parts.handle.push(rib);
  }
  // 尾环
  const ring = new THREE.TorusGeometry(0.031, 0.006, 8, 20);
  ring.rotateY(Math.PI / 2);
  place(ring, 0, -0.002, 0.145);
  parts.handle.push(ring);

  // 金工装饰
  parts.accent.push(place(roundedBox(0.03, 0.012, 0.02), 0, 0.02, -0.055));
  parts.accent.push(place(cylinder(0.004, 0.03, 8), 0, 0.004, 0.1, 0, 0, Math.PI / 2));

  // 握刀的手 + 前臂
  addHands(parts, opts, 'knife');

  return assemble(parts, opts, new THREE.Vector3(0, 0.02, -0.3));
}


/* ------------------------------------------------------------------ */
/* M4A4                                                                */
/* ------------------------------------------------------------------ */

function buildM4(opts) {
  const parts = { metal: [], steel: [], wood: [], polymer: [], accent: [], lens: [], hardware: [], glove: [], sleeve: [] };

  // 机匣：参考 M4A1 的平顶机匣 + 弹匣井
  parts.metal.push(place(profile([
    [-0.17, -0.05], [0.17, -0.05], [0.17, 0.026], [0.135, 0.045],
    [-0.13, 0.045], [-0.17, 0.028]
  ], 0.064, 2, 0.005), 0, 0, 0));
  // 顶部皮卡汀尼导轨
  parts.metal.push(place(roundedBox(0.05, 0.012, 0.24), 0, 0.052, -0.01));
  for (let i = 0; i < 8; i++) {
    parts.metal.push(place(roundedBox(0.053, 0.008, 0.008), 0, 0.06, -0.11 + i * 0.026));
  }
  // 提把：M4A4 辨识度最高的部件
  parts.polymer.push(place(roundedBox(0.042, 0.018, 0.18), 0, 0.118, -0.02));
  parts.polymer.push(place(roundedBox(0.02, 0.06, 0.022), 0, 0.09, -0.10));
  parts.polymer.push(place(roundedBox(0.02, 0.06, 0.022), 0, 0.09, 0.07));
  // 提把后端的照门：坐在提把上，而不是悬空在枪托上方
  parts.hardware.push(place(roundedBox(0.036, 0.02, 0.036), 0, 0.128, 0.055));
  parts.hardware.push(place(roundedBox(0.012, 0.018, 0.016), 0, 0.146, 0.055));
  parts.hardware.push(place(roundedBox(0.03, 0.012, 0.03), 0, 0.108, -0.105));

  // 枪管 / 消焰器
  parts.hardware.push(place(cylinder(0.0105, 0.42, 16), 0, 0.022, -0.40));
  parts.hardware.push(place(cylinder(0.013, 0.05, 14), 0, 0.022, -0.63));
  parts.metal.push(place(cylinder(0.0165, 0.06, 14), 0, 0.022, -0.68));
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    parts.hardware.push(place(roundedBox(0.003, 0.006, 0.04), Math.cos(a) * 0.015, 0.022 + Math.sin(a) * 0.015, -0.68, a));
  }
  // 导气箍
  parts.hardware.push(place(cylinder(0.018, 0.04, 12), 0, 0.022, -0.50));

  // 圆形护木 + 环形防滑筋
  {
    const hg = new THREE.CylinderGeometry(0.034, 0.033, 0.26, 12);
    hg.rotateX(Math.PI / 2);
    hg.scale(1, 0.95, 1);
    hg.translate(0, 0.012, -0.31);
    parts.polymer.push(hg);
    for (let i = 0; i < 6; i++) {
      const rib = new THREE.CylinderGeometry(0.035, 0.035, 0.006, 12, 1, true);
      rib.rotateX(Math.PI / 2);
      rib.scale(1, 0.95, 1);
      rib.translate(0, 0.012, -0.20 - i * 0.04);
      parts.polymer.push(rib);
    }
    // 护木顶部导轨
    parts.polymer.push(place(roundedBox(0.045, 0.01, 0.22), 0, 0.05, -0.31));
  }

  // 前准星：A 字形护耳
  parts.hardware.push(place(cylinder(0.016, 0.045, 12), 0, 0.022, -0.545));
  for (const sx of [-1, 1]) {
    parts.hardware.push(place(roundedBox(0.008, 0.075, 0.016), sx * 0.017, 0.068, -0.545, 0, 0, sx * 0.2));
  }
  parts.hardware.push(place(roundedBox(0.038, 0.008, 0.018), 0, 0.104, -0.545));
  parts.hardware.push(place(cylinder(0.004, 0.05, 8), 0, 0.095, -0.545));

  // 弹匣：STANAG，略微前弯 + 底板
  const mag = new THREE.Shape();
  mag.moveTo(0.03, 0.02);
  mag.bezierCurveTo(0.06, -0.05, 0.08, -0.10, 0.095, -0.16);
  mag.lineTo(0.045, -0.178);
  mag.bezierCurveTo(0.02, -0.11, -0.005, -0.05, -0.035, 0.02);
  mag.closePath();
  const magGeo = new THREE.ExtrudeGeometry(mag, {
    depth: 0.055, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004,
    bevelSegments: 2, curveSegments: 10, steps: 1
  });
  magGeo.translate(0, 0, -0.0275);
  magGeo.rotateY(Math.PI / 2);
  magGeo.translate(0, -0.06, 0.0);
  parts.polymer.push(magGeo);
  parts.hardware.push(place(roundedBox(0.058, 0.012, 0.07), 0, -0.228, -0.04));
  // 弹匣侧面加强筋
  for (let i = 0; i < 3; i++) {
    parts.polymer.push(place(roundedBox(0.0025, 0.006, 0.07), -0.028, -0.10 - i * 0.038, -0.03 - i * 0.008));
  }

  // 握把 / 扳机护圈
  parts.polymer.push(place(profile([
    [-0.034, 0.04], [0.034, 0.04], [0.044, -0.105], [0.016, -0.132],
    [-0.026, -0.124], [-0.04, -0.03]
  ], 0.048, 2, 0.004), 0, -0.07, 0.115, -0.16, 0, 0));
  const guard = new THREE.TorusGeometry(0.036, 0.0045, 6, 14, Math.PI);
  guard.rotateY(Math.PI / 2);
  guard.rotateZ(Math.PI);
  place(guard, 0, -0.052, 0.07, 0.08);
  parts.hardware.push(guard);
  parts.hardware.push(place(roundedBox(0.008, 0.036, 0.012), 0, -0.062, 0.06, -0.2));

  // 缓冲管 + 伸缩枪托
  parts.metal.push(place(cylinder(0.017, 0.20, 12), 0, 0.015, 0.255));
  {
    const st = new THREE.Shape();
    const pts = [
      [-0.295, 0.052], [-0.36, 0.047], [-0.415, 0.03], [-0.438, -0.01],
      [-0.432, -0.078], [-0.398, -0.09], [-0.34, -0.062], [-0.295, -0.03]
    ];
    st.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) st.lineTo(pts[i][0], pts[i][1]);
    st.closePath();
    const sg = new THREE.ExtrudeGeometry(st, {
      depth: 0.05, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004,
      bevelSegments: 2, curveSegments: 10, steps: 1
    });
    sg.translate(0, 0, -0.025);
    sg.rotateY(Math.PI / 2);
    parts.polymer.push(sg);
  }
  parts.hardware.push(place(roundedBox(0.052, 0.105, 0.014), 0, -0.012, 0.442));
  parts.polymer.push(place(roundedBox(0.05, 0.028, 0.11), 0, 0.052, 0.36));
  {
    const loop = new THREE.TorusGeometry(0.013, 0.003, 5, 10);
    loop.rotateY(Math.PI / 2);
    place(loop, -0.028, -0.05, 0.38);
    parts.hardware.push(loop);
  }

  // 拉机柄 / 抛壳口 / 辅助推机柄 / 弹匣释放
  parts.hardware.push(place(roundedBox(0.02, 0.012, 0.035), 0.034, 0.028, 0.05));
  parts.polymer.push(place(roundedBox(0.004, 0.022, 0.06), 0.033, 0.02, -0.03));
  parts.hardware.push(place(cylinder(0.008, 0.03, 10), 0.035, 0.03, 0.115, 0, 0, Math.PI / 2));
  parts.hardware.push(place(roundedBox(0.008, 0.03, 0.04), -0.036, -0.005, 0.05));

  // 高细节件：护木散热孔、枪托调节孔、弹匣筋、销、提把防滑纹
  if (DETAIL > 1.5) {
    // 护木两侧散热孔
    for (let i = 0; i < 6; i++) {
      for (const sx of [-1, 1]) {
        const hole = new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 10);
        hole.rotateZ(Math.PI / 2);
        hole.translate(sx * 0.033, 0.012, -0.21 - i * 0.038);
        parts.hardware.push(hole);
      }
    }
    // 伸缩托调节孔
    for (let i = 0; i < 5; i++) {
      for (const sx of [-1, 1]) {
        parts.hardware.push(place(cylinder(0.0035, 0.004, 8), sx * 0.026, -0.015, 0.32 + i * 0.022, 0, Math.PI / 2, 0));
      }
    }
    // 弹匣两侧加强筋
    for (let i = 0; i < 3; i++) {
      parts.polymer.push(place(roundedBox(0.0025, 0.006, 0.07), 0.028, -0.10 - i * 0.038, -0.03 - i * 0.008));
    }
    // 扳机销
    for (const z of [0.06, 0.09]) {
      parts.hardware.push(place(cylinder(0.0035, 0.005, 8), 0.033, -0.04, z, 0, Math.PI / 2, 0));
    }
    // 提把防滑纹
    for (let i = 0; i < 5; i++) {
      parts.polymer.push(place(roundedBox(0.044, 0.004, 0.008), 0, 0.128, -0.08 + i * 0.03));
    }
    // 托底螺钉
    for (const sy of [-0.055, 0.03]) {
      parts.hardware.push(place(cylinder(0.0035, 0.005, 8), 0, sy, 0.45));
    }
    // 弹匣底板卡扣
    parts.hardware.push(place(roundedBox(0.02, 0.008, 0.02), 0, -0.235, -0.04));
  }

  addHands(parts, opts, 'm4');
  // 前背带环：挂在护木下缘，别悬空
  {
    const loop = new THREE.TorusGeometry(0.011, 0.0025, 5, 10);
    loop.rotateY(Math.PI / 2);
    place(loop, -0.02, -0.028, -0.44);
    parts.hardware.push(loop);
  }
  return assemble(parts, opts, new THREE.Vector3(0, 0.022, -0.72), 0.92);
}

/* ------------------------------------------------------------------ */
/* AWP                                                                 */
/* ------------------------------------------------------------------ */

function buildAWP(opts) {
  const parts = { metal: [], steel: [], wood: [], polymer: [], olive: [], hardware: [], accent: [], lens: [], glove: [], sleeve: [] };

  // 一体式枪身（AWP 标志性的橄榄绿底盘）
  parts.olive.push(place(profile([
    [-0.22, -0.04], [0.22, -0.045], [0.3, -0.02], [0.32, 0.04],
    [0.22, 0.075], [-0.08, 0.075], [-0.18, 0.055]
  ], 0.062, 2, 0.006), 0, 0, 0.0));
  // 机匣
  parts.metal.push(place(profile([
    [-0.12, -0.035], [0.12, -0.035], [0.12, 0.035], [-0.12, 0.035]
  ], 0.058, 2, 0.005), 0, 0.01, -0.04));
  // 长枪管
  parts.hardware.push(place(cylinder(0.013, 0.56, 18), 0, 0.026, -0.48));
  parts.hardware.push(place(cylinder(0.02, 0.16, 16), 0, 0.026, -0.76));
  parts.metal.push(place(cylinder(0.024, 0.07, 16), 0, 0.026, -0.86));
  // 枪口制退器
  parts.metal.push(place(cylinder(0.028, 0.02, 16), 0, 0.026, -0.90));
  // 枪托拇指孔：外轮廓 + 内部椭圆孔
  {
    const shape = new THREE.Shape();
    shape.moveTo(0.06, -0.04);
    shape.lineTo(0.34, -0.06);
    shape.lineTo(0.38, 0.02);
    shape.lineTo(0.34, 0.09);
    shape.lineTo(0.15, 0.1);
    shape.lineTo(0.06, 0.06);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absellipse(0.24, 0.02, 0.055, 0.032, 0, Math.PI * 2, false);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.05, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004,
      bevelSegments: 2, curveSegments: 10, steps: 1
    });
    geo.translate(0, 0, -0.025);
    geo.rotateY(Math.PI / 2);
    geo.scale(1, 1, -1);
    parts.polymer.push(geo);
  }
  // 贴腮板
  parts.olive.push(place(roundedBox(0.055, 0.035, 0.18), 0, 0.105, 0.22));
  parts.polymer.push(place(roundedBox(0.06, 0.1, 0.02), 0, 0.02, 0.375));
  // 握把
  parts.polymer.push(place(profile([
    [-0.036, 0.035], [0.036, 0.035], [0.046, -0.13], [0.016, -0.15],
    [-0.026, -0.14], [-0.04, -0.03]
  ], 0.052, 2, 0.004), 0, -0.065, 0.12, -0.14, 0, 0));
  // 扳机护圈
  const guard = new THREE.TorusGeometry(0.038, 0.0045, 6, 14, Math.PI);
  guard.rotateY(Math.PI / 2);
  guard.rotateZ(Math.PI);
  place(guard, 0, -0.045, 0.07, 0.06);
  parts.metal.push(guard);
  // 瞄准镜（按真实 AWP 的比例收细）
  // 先把镜座下方的整段导轨补出来，避免从侧面看瞄准镜像悬空。
  parts.metal.push(place(roundedBox(0.05, 0.022, 0.36), 0, 0.086, -0.08));
  const scopeY = 0.145;
  parts.metal.push(place(cylinder(0.032, 0.30, 18), 0, scopeY, -0.08));
  parts.metal.push(place(cylinder(0.044, 0.10, 18), 0, scopeY, -0.28));
  parts.metal.push(place(cylinder(0.036, 0.06, 18), 0, scopeY, 0.10));
  parts.lens.push(place(cylinder(0.042, 0.006, 18), 0, scopeY, -0.331));
  parts.lens.push(place(cylinder(0.033, 0.006, 18), 0, scopeY, 0.131));
  [ -0.18, 0.02 ].forEach((z) => {
    const r = new THREE.TorusGeometry(0.036, 0.007, 8, 20);
    place(r, 0, scopeY, z);
    parts.metal.push(r);
    // 镜座：把瞄准镜和机匣连起来，避免「悬浮镜」
    parts.metal.push(place(roundedBox(0.052, 0.075, 0.03), 0, 0.108, z));
  });
  parts.metal.push(place(cylinder(0.014, 0.026, 12), 0, scopeY + 0.04, -0.06));
  parts.metal.push(place(cylinder(0.013, 0.026, 12), 0.036, scopeY, -0.06, 0, 0, Math.PI / 2));
  // 拉栓
  parts.steel.push(place(cylinder(0.008, 0.07, 10), 0.045, 0.045, 0.02, 0, 0, Math.PI / 2));
  const knob = new THREE.SphereGeometry(0.018, 10, 8);
  knob.translate(0.09, 0.045, 0.02);
  parts.steel.push(knob);
  // 弹匣
  parts.polymer.push(place(roundedBox(0.05, 0.09, 0.08), 0, -0.08, 0.02));
  parts.metal.push(place(roundedBox(0.055, 0.02, 0.085), 0, -0.13, 0.02));
  // 背带环
  const loop = new THREE.TorusGeometry(0.014, 0.003, 5, 10);
  loop.rotateY(Math.PI / 2);
  place(loop, 0, -0.06, 0.34);
  parts.metal.push(loop);

  // 高细节件：枪管导条、镜环螺钉、炮塔、托底螺钉、扳机销
  if (DETAIL > 1.5) {
    // 枪管六条导条
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const rib = new THREE.CylinderGeometry(0.0018, 0.0018, 0.5, 6);
      rib.rotateX(Math.PI / 2);
      rib.translate(Math.cos(a) * 0.0125, 0.026 + Math.sin(a) * 0.0125, -0.48);
      parts.hardware.push(rib);
    }
    // 镜环螺钉
    for (const z of [-0.18, 0.02]) {
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        parts.hardware.push(place(cylinder(0.0035, 0.006, 8),
          Math.cos(a) * 0.038, scopeY + Math.sin(a) * 0.038, z, 0, 0, 0));
      }
    }
    // 炮塔顶/侧旋钮
    parts.hardware.push(place(cylinder(0.012, 0.018, 12), 0, scopeY + 0.048, -0.06));
    parts.hardware.push(place(cylinder(0.011, 0.016, 12), 0.046, scopeY, -0.06, 0, 0, Math.PI / 2));
    // 托底与贴腮板螺钉
    for (const sy of [-0.01, 0.06]) {
      parts.hardware.push(place(cylinder(0.0035, 0.005, 8), 0, sy, 0.405));
    }
    // 扳机销
    for (const z of [0.055, 0.09]) {
      parts.hardware.push(place(cylinder(0.003, 0.005, 8), 0.026, -0.03, z, 0, Math.PI / 2, 0));
    }
    // 弹匣底板卡扣
    parts.hardware.push(place(roundedBox(0.03, 0.008, 0.02), 0, -0.142, 0.02));
  }

  addHands(parts, opts, 'awp');
  return assemble(parts, opts, new THREE.Vector3(0, 0.026, -0.94));
}

/* ------------------------------------------------------------------ */
/* USP-S                                                               */
/* ------------------------------------------------------------------ */

function buildUSP(opts) {
  const parts = { metal: [], steel: [], wood: [], polymer: [], accent: [], lens: [], suppressor: [], glove: [], sleeve: [] };
  // 套筒
  parts.steel.push(place(profile([
    [-0.11, -0.022], [0.11, -0.022], [0.11, 0.022], [0.09, 0.03],
    [-0.09, 0.03], [-0.11, 0.022]
  ], 0.034, 2, 0.003), 0, 0.034, -0.06));
  parts.steel.push(place(profile([
    [0.06, -0.02], [0.11, -0.02], [0.11, 0.01], [0.08, 0.024], [0.06, 0.02]
  ], 0.036, 2, 0.003), 0, 0.034, -0.06));
  for (let i = 0; i < 7; i++) {
    parts.metal.push(place(roundedBox(0.037, 0.038, 0.004), 0, 0.034, 0.015 + i * 0.012));
  }
  // 枪管 + 消音器
  parts.metal.push(place(cylinder(0.0105, 0.06, 14), 0, 0.032, -0.19));
  parts.suppressor.push(place(cylinder(0.024, 0.20, 18), 0, 0.032, -0.32));
  parts.suppressor.push(place(cylinder(0.026, 0.018, 18), 0, 0.032, -0.23));
  parts.suppressor.push(place(cylinder(0.026, 0.018, 18), 0, 0.032, -0.42));
  parts.suppressor.push(place(cylinder(0.016, 0.01, 14), 0, 0.032, -0.432));
  // 消音器上的散热刻线
  for (let i = 0; i < 5; i++) {
    parts.suppressor.push(place(cylinder(0.0245, 0.004, 18), 0, 0.032, -0.26 - i * 0.028));
  }
  // 下机匣 / 握把
  parts.polymer.push(place(profile([
    [-0.1, -0.03], [0.1, -0.03], [0.1, 0.008], [0.05, 0.022],
    [-0.085, 0.022], [-0.1, 0.008]
  ], 0.032, 2, 0.003), 0, -0.008, -0.055));
  parts.polymer.push(place(profile([
    [-0.032, 0.03], [0.032, 0.03], [0.044, -0.11], [0.018, -0.14],
    [-0.02, -0.13], [-0.036, -0.06]
  ], 0.036, 2, 0.003), 0, -0.085, 0.04, -0.2, 0, 0));
  const guard = new THREE.TorusGeometry(0.032, 0.004, 6, 12, Math.PI);
  guard.rotateY(Math.PI / 2);
  guard.rotateZ(Math.PI);
  place(guard, 0, -0.045, -0.015, 0.05);
  parts.polymer.push(guard);
  parts.metal.push(place(roundedBox(0.006, 0.03, 0.01), 0, -0.05, -0.02, -0.2));
  parts.polymer.push(place(roundedBox(0.038, 0.03, 0.07), 0, -0.18, 0.045, 0.2));
  // 准星 / 照门
  parts.metal.push(place(roundedBox(0.008, 0.012, 0.012), 0, 0.064, -0.15));
  parts.metal.push(place(roundedBox(0.024, 0.01, 0.012), 0, 0.064, 0.04));
  parts.accent.push(place(cylinder(0.0025, 0.004, 6), 0, 0.07, -0.15));
  // USP 的战术导轨
  parts.metal.push(place(roundedBox(0.028, 0.014, 0.08), 0, -0.048, -0.12));
  addHands(parts, opts, 'usp');
  return assemble(parts, opts, new THREE.Vector3(0, 0.032, -0.45));
}

/* ------------------------------------------------------------------ */
/* 沙漠之鹰                                                            */
/* ------------------------------------------------------------------ */

function buildDeagle(opts) {
  const parts = { metal: [], steel: [], wood: [], polymer: [], accent: [], lens: [], glove: [], sleeve: [] };
  parts.steel.push(place(profile([
    [-0.12, -0.03], [0.12, -0.03], [0.12, 0.04], [0.09, 0.052],
    [-0.09, 0.052], [-0.12, 0.04]
  ], 0.04, 2, 0.003), 0, 0.04, -0.05));
  parts.steel.push(place(profile([
    [0.07, -0.025], [0.13, -0.025], [0.13, 0.02], [0.09, 0.04], [0.07, 0.03]
  ], 0.042, 2, 0.003), 0, 0.04, -0.05));
  for (let i = 0; i < 6; i++) {
    parts.metal.push(place(roundedBox(0.043, 0.045, 0.004), 0, 0.04, 0.025 + i * 0.012));
  }
  // 顶部散热槽
  for (let i = 0; i < 4; i++) {
    parts.metal.push(place(roundedBox(0.03, 0.006, 0.05), 0, 0.094, -0.10 + i * 0.05));
  }
  // 枪管 / 枪口
  parts.metal.push(place(cylinder(0.013, 0.06, 16), 0, 0.038, -0.20));
  parts.accent.push(place(cylinder(0.017, 0.012, 16), 0, 0.038, -0.235));
  // 下机匣 / 握把
  parts.polymer.push(place(profile([
    [-0.11, -0.035], [0.11, -0.035], [0.11, 0.012], [0.05, 0.03],
    [-0.09, 0.03], [-0.11, 0.012]
  ], 0.036, 2, 0.003), 0, -0.008, -0.05));
  parts.polymer.push(place(profile([
    [-0.04, 0.03], [0.04, 0.03], [0.052, -0.13], [0.02, -0.17],
    [-0.022, -0.16], [-0.044, -0.06]
  ], 0.04, 2, 0.003), 0, -0.09, 0.045, -0.2, 0, 0));
  const guard = new THREE.TorusGeometry(0.038, 0.005, 6, 12, Math.PI);
  guard.rotateY(Math.PI / 2);
  guard.rotateZ(Math.PI);
  place(guard, 0, -0.05, -0.01, 0.05);
  parts.polymer.push(guard);
  parts.metal.push(place(roundedBox(0.007, 0.035, 0.012), 0, -0.055, -0.015, -0.2));
  parts.polymer.push(place(roundedBox(0.042, 0.03, 0.08), 0, -0.2, 0.05, 0.2));
  // 准星 / 照门
  parts.metal.push(place(roundedBox(0.01, 0.016, 0.014), 0, 0.072, -0.16));
  parts.metal.push(place(roundedBox(0.03, 0.012, 0.014), 0, 0.072, 0.05));
  parts.accent.push(place(roundedBox(0.03, 0.004, 0.04), 0, 0.098, -0.05));
  // 沙鹰下导轨
  parts.metal.push(place(roundedBox(0.03, 0.015, 0.08), 0, -0.052, -0.12));
  addHands(parts, opts, 'deagle');
  return assemble(parts, opts, new THREE.Vector3(0, 0.038, -0.25));
}

/* ------------------------------------------------------------------ */
/* MP9                                                                 */
/* ------------------------------------------------------------------ */

function buildMP9(opts) {
  const parts = { metal: [], steel: [], wood: [], polymer: [], accent: [], lens: [], glove: [], sleeve: [] };
  parts.polymer.push(place(profile([
    [-0.12, -0.05], [0.12, -0.05], [0.12, 0.04], [0.08, 0.055],
    [-0.1, 0.055], [-0.12, 0.03]
  ], 0.052, 2, 0.004), 0, 0, -0.04));
  // 枪管护罩
  parts.metal.push(place(cylinder(0.024, 0.16, 14), 0, 0.02, -0.27));
  parts.steel.push(place(cylinder(0.009, 0.09, 12), 0, 0.02, -0.38));
  for (let i = 0; i < 4; i++) {
    parts.metal.push(place(roundedBox(0.052, 0.008, 0.02), 0, 0.048, -0.27 + i * 0.035));
  }
  // 顶部导轨
  parts.metal.push(place(roundedBox(0.04, 0.01, 0.2), 0, 0.062, -0.06));
  for (let i = 0; i < 7; i++) {
    parts.metal.push(place(roundedBox(0.042, 0.006, 0.008), 0, 0.07, -0.14 + i * 0.024));
  }
  // 握把 + 弹匣（握把内）
  parts.polymer.push(place(profile([
    [-0.033, 0.035], [0.033, 0.035], [0.045, -0.12], [0.018, -0.145],
    [-0.02, -0.14], [-0.036, -0.04]
  ], 0.048, 2, 0.004), 0, -0.075, 0.06, -0.12, 0, 0));
  parts.metal.push(place(roundedBox(0.05, 0.02, 0.06), 0, -0.14, 0.07, -0.12));
  const guard = new THREE.TorusGeometry(0.032, 0.004, 6, 12, Math.PI);
  guard.rotateY(Math.PI / 2);
  guard.rotateZ(Math.PI);
  place(guard, 0, -0.05, 0.01, 0.05);
  parts.polymer.push(guard);
  // 折叠枪托：两根拉杆沿 +Z 向后，别横着穿出机匣
  parts.metal.push(place(cylinder(0.006, 0.18, 8), 0.03, 0.03, 0.20, Math.PI / 2, 0, 0));
  parts.metal.push(place(cylinder(0.006, 0.18, 8), -0.03, 0.03, 0.20, Math.PI / 2, 0, 0));
  parts.polymer.push(place(roundedBox(0.08, 0.09, 0.02), 0, 0.02, 0.30));
  // 照门 / 拉机柄
  parts.metal.push(place(roundedBox(0.008, 0.014, 0.012), 0, 0.078, -0.24));
  parts.metal.push(place(roundedBox(0.026, 0.01, 0.012), 0, 0.078, 0.01));
  parts.steel.push(place(cylinder(0.006, 0.03, 8), 0.035, 0.045, 0.02, 0, 0, Math.PI / 2));
  // 折叠前握把：贴在前护罩下方，增加 MP9 的辨识度
  parts.polymer.push(place(roundedBox(0.026, 0.07, 0.07), 0, -0.050, -0.20, 0.22));
  addHands(parts, opts, 'mp9');
  return assemble(parts, opts, new THREE.Vector3(0, 0.02, -0.43));
}

/* ------------------------------------------------------------------ */
/* 组装                                                                */
/* ------------------------------------------------------------------ */

/**
 * Extrude/Cylinder 的默认 UV 是以「米」为单位的，皮肤贴图会被裁成一小块。
 * 这里按零件包围盒做一次盒式投影，让每个零件都能完整铺一张花纹。
 */
function normalizeUV(geo) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const sx = Math.max(1e-4, bb.max.x - bb.min.x);
  const sy = Math.max(1e-4, bb.max.y - bb.min.y);
  const sz = Math.max(1e-4, bb.max.z - bb.min.z);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) {
      u = (pos.getZ(i) - bb.min.z) / sz;
      v = (pos.getY(i) - bb.min.y) / sy;
    } else if (ay >= ax && ay >= az) {
      u = (pos.getX(i) - bb.min.x) / sx;
      v = (pos.getZ(i) - bb.min.z) / sz;
    } else {
      u = (pos.getX(i) - bb.min.x) / sx;
      v = (pos.getY(i) - bb.min.y) / sy;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function assemble(parts, opts, muzzlePos, squash) {
  const mats = matSet(opts);
  const g = new THREE.Group();
  g.name = 'weapon';
  Object.keys(parts).forEach((role) => {
    const list = parts[role];
    if (!list || !list.length) return;
    const isHand = role === 'glove' || role === 'sleeve' || role === 'gloveL' || role === 'sleeveL';
    list.forEach((x) => {
      if (squash && !isHand) x.scale(1, squash, 1);
      normalizeUV(x);
    });
    const geo = mergeGeos(list);
    const mat = role === 'gloveL' ? mats.glove : role === 'sleeveL' ? mats.sleeve : (mats[role] || mats.metal);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.role = role === 'gloveL' ? 'glove' : role === 'sleeveL' ? 'sleeve' : role;
    mesh.renderOrder = opts && opts.renderOrder != null ? opts.renderOrder : 1000;
    mesh.frustumCulled = false;
    g.add(mesh);
    if (role === 'gloveL' || role === 'sleeveL') {
      g.userData.left = g.userData.left || {};
      g.userData.left[role === 'gloveL' ? 'glove' : 'sleeve'] = mesh;
    }
    list.forEach((x) => x.dispose());
  });
  const muzzle = new THREE.Object3D();
  muzzle.position.copy(muzzlePos);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.userData.materials = mats;
  return g;
}

const BUILDERS = {
  ak: buildAK, glock: buildGlock, knife: buildKnife,
  m4: buildM4, awp: buildAWP, usp: buildUSP, deagle: buildDeagle, mp9: buildMP9
};

export function buildWeaponModel(id, opts) {
  const fn = BUILDERS[id] || BUILDERS.glock;
  const o = opts || {};
  DETAIL = o.detail === 'low' ? 1 : 2.2;
  return fn(o);
}

/** 极低面数的展示替身：用于远处展位，皮肤贴图仍然生效。 */
export function buildProxyWeapon(id) {
  const prev = DETAIL;
  DETAIL = 1;
  const parts = [];
  if (id === 'knife') {
    const blade = roundedBox(0.012, 0.1, 0.34);
    blade.translate(0, 0.02, -0.18);
    parts.push(blade);
    const handle = roundedBox(0.022, 0.04, 0.16);
    handle.translate(0, 0, 0.06);
    parts.push(handle);
    const ring = new THREE.TorusGeometry(0.03, 0.006, 4, 8);
    ring.rotateY(Math.PI / 2);
    ring.translate(0, 0, 0.15);
    parts.push(ring);
  } else if (id === 'glock') {
    const slide = roundedBox(0.034, 0.05, 0.24);
    slide.translate(0, 0.02, -0.06);
    parts.push(slide);
    const grip = roundedBox(0.032, 0.12, 0.06);
    grip.rotateX(-0.2);
    grip.translate(0, -0.08, 0.04);
    parts.push(grip);
    const barrel = new THREE.CylinderGeometry(0.01, 0.01, 0.05, 6);
    barrel.rotateX(Math.PI / 2);
    barrel.translate(0, 0.03, -0.2);
    parts.push(barrel);
  } else {
    const receiver = roundedBox(0.06, 0.085, 0.38);
    receiver.translate(0, 0, 0);
    parts.push(receiver);
    const barrel = new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6);
    barrel.rotateX(Math.PI / 2);
    barrel.translate(0, 0.02, -0.34);
    parts.push(barrel);
    const mag = roundedBox(0.05, 0.15, 0.07);
    mag.rotateX(0.14);
    mag.translate(0, -0.1, 0.02);
    parts.push(mag);
    const stock = roundedBox(0.055, 0.09, 0.24);
    stock.translate(0, -0.01, 0.28);
    parts.push(stock);
  }
  const geo = mergeGeos(parts);
  parts.forEach((g) => g.dispose());
  const mainRole = id === 'glock' ? 'steel' : id === 'knife' ? 'blade' : 'metal';
  const base = new THREE.MeshStandardMaterial({
    color: id === 'knife' ? 0xb9c1c4 : 0x4a4e51,
    metalness: id === 'knife' ? 0.95 : 0.8,
    roughness: 0.32
  });
  const mesh = new THREE.Mesh(geo, base);
  mesh.userData.role = mainRole;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.weaponId = id;
  DETAIL = prev;
  return g;
}

/** 给展示柜用：不戴手、不写深度偏移、可投影。simple=true 时按材质合并成两个 mesh。 */
export function buildDisplayWeapon(id, simple, hands) {
  const g = buildWeaponModel(id, { hands: !!hands, depthTest: true, renderOrder: 0, detail: simple ? 'low' : 'high' });
  if (simple) {
    const all = [];
    let mainRole = (id === 'glock' || id === 'usp' || id === 'deagle') ? 'steel' : id === 'knife' ? 'blade' : 'metal';
    let mainBase = null;
    g.traverse((o) => {
      if (!o.isMesh) return;
      all.push(o.geometry);
      if (!mainBase && o.userData.role === mainRole) mainBase = o.material;
    });
    if (!mainBase) mainBase = g.children[0] ? g.children[0].material : null;
    const out = new THREE.Group();
    if (all.length && mainBase) {
      const mm = new THREE.Mesh(mergeGeos(all), mainBase.clone());
      mm.userData.role = mainRole;
      mm.castShadow = true;
      mm.receiveShadow = true;
      mm.material.depthWrite = true;
      mm.material.transparent = false;
      out.add(mm);
    }
    out.userData.weaponId = id;
    out.userData.muzzle = g.userData.muzzle;
    return out;
  }
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = true;
      if (o.material) {
        o.material.depthWrite = true;
        o.material.transparent = false;
      }
    }
  });
  return g;
}
