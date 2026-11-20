// 战术道具模型：手雷、C4、拆弹包、护甲、武器箱。
// 原创几何与配色，走「战术写实」风格；不使用任何 Valve 资产或商标。

import * as THREE from '../../vendor/three.module.js';
import { mergeGeos } from '../world/geo-utils.js';
import { metalTexture, polymerTexture, woodTexture } from '../world/textures.js';

let MATS = null;

function mats() {
  if (MATS) return MATS;
  const std = (color, metalness, roughness, map) => {
    const m = new THREE.MeshStandardMaterial({ color: color, metalness: metalness, roughness: roughness });
    if (map) m.map = map;
    m.envMapIntensity = 1.1;
    return m;
  };
  MATS = {
    metal: std(0x30363a, 0.85, 0.42, metalTexture({ tone: 62, scratch: 1.2 })),
    steel: std(0xc3c9cc, 0.96, 0.24, metalTexture({ tone: 168, scratch: 1.8 })),
    olive: std(0x4b5339, 0.25, 0.68, polymerTexture(52)),
    dark: std(0x1d2022, 0.4, 0.62, polymerTexture(28)),
    tan: std(0x9c8561, 0.08, 0.86),
    fabric: std(0x3f4536, 0.05, 0.94),
    brass: std(0xb18a42, 0.9, 0.3, metalTexture({ tone: 128, scratch: 0.5 })),
    orange: std(0xd9662f, 0.25, 0.5),
    red: std(0xa8322a, 0.3, 0.5),
    blue: std(0x2f6d8f, 0.35, 0.45),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xd6e0d2, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.28,
      depthWrite: false, side: THREE.DoubleSide
    }),
    amber: std(0xb4661f, 0.1, 0.35),
    screen: new THREE.MeshBasicMaterial({ color: 0x6fe39a, toneMapped: false }),
    led: new THREE.MeshBasicMaterial({ color: 0xff3b2f, toneMapped: false }),
    cyan: new THREE.MeshBasicMaterial({ color: 0x69d6e8, toneMapped: false })
  };
  return MATS;
}

function add(group, geo, mat, name) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = name || '';
  group.add(m);
  return m;
}

function cyl(r1, r2, h, seg, axis) {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg || 16);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  return g;
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x || 0, y || 0, z || 0);
  return g;
}

function ring(r, tube, x, y, z, axis) {
  const g = new THREE.TorusGeometry(r, tube, 8, 24);
  if (axis === 'x') g.rotateY(Math.PI / 2);
  else if (axis === 'y') g.rotateX(Math.PI / 2);
  g.translate(x || 0, y || 0, z || 0);
  return g;
}

function roundBox(w, h, d, r, x, y, z) {
  const s = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  r = Math.min(r || 0.02, hw * 0.4, hh * 0.4);
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh); s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r); s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh); s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r); s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: d, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004,
    bevelSegments: 2, curveSegments: 5, steps: 1
  });
  g.translate(0, 0, -d / 2);
  g.translate(x || 0, y || 0, z || 0);
  return g;
}

function labelTexture(lines, opts) {
  opts = opts || {};
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = opts.bg || '#141715';
  x.fillRect(0, 0, 256, 128);
  x.strokeStyle = opts.border || 'rgba(210,190,140,.55)';
  x.lineWidth = 3;
  x.strokeRect(6, 6, 244, 116);
  x.textAlign = 'center';
  x.fillStyle = opts.fg || '#e8e2d2';
  lines.forEach((ln, i) => {
    x.font = (i === 0 ? '700 ' : '600 ') + (i === 0 ? 34 : 22) + 'px ui-monospace, monospace';
    x.fillText(ln, 128, 48 + i * 34);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ------------------------------------------------------------------ */
/* 手雷                                                                */
/* ------------------------------------------------------------------ */

function grenadeBody(group, kind) {
  const m = mats();
  if (kind === 'he') {
    const body = new THREE.SphereGeometry(0.075, 18, 14);
    body.scale(0.82, 1.15, 0.82);
    body.translate(0, 0.08, 0);
    add(group, body, m.olive, 'body');
    for (let i = 0; i < 4; i++) {
      const y = 0.03 + i * 0.035;
      const r = 0.062 * Math.sqrt(1 - Math.pow((y - 0.08) / 0.086, 2));
      add(group, ring(r, 0.003, 0, y, 0, 'z'), m.dark);
      add(group, ring(r, 0.003, 0, y, 0, 'x'), m.dark);
    }
    add(group, cyl(0.022, 0.026, 0.035, 12), m.metal).position.set(0, 0.175, 0);
    add(group, box(0.052, 0.012, 0.018, 0, 0.196, 0), m.steel);
    add(group, box(0.012, 0.09, 0.026, 0.058, 0.13, 0), m.steel);
    add(group, ring(0.024, 0.004, -0.058, 0.15, 0, 'y'), m.steel);
    add(group, cyl(0.031, 0.031, 0.006, 12), m.brass).position.set(0, 0.154, 0);
  } else if (kind === 'flash') {
    add(group, cyl(0.045, 0.045, 0.16, 18), m.steel, 'body').position.set(0, 0.09, 0);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + row * 0.3;
        const hx = Math.sin(a) * 0.043;
        const hz = Math.cos(a) * 0.043;
        add(group, box(0.008, 0.014, 0.008, hx, 0.06 + row * 0.035, hz), m.dark);
      }
    }
    add(group, cyl(0.043, 0.048, 0.014, 18), m.dark).position.set(0, 0.015, 0);
    add(group, cyl(0.032, 0.038, 0.03, 16), m.brass).position.set(0, 0.182, 0);
    add(group, box(0.012, 0.09, 0.028, 0.052, 0.13, 0), m.steel);
    add(group, ring(0.024, 0.004, -0.058, 0.15, 0, 'y'), m.steel);
    add(group, ring(0.046, 0.004, 0, 0.105, 0, 'y'), m.cyan);
  } else if (kind === 'smoke') {
    add(group, cyl(0.05, 0.05, 0.18, 18), m.olive, 'body').position.set(0, 0.1, 0);
    for (let i = 0; i < 5; i++) {
      add(group, ring(0.051, 0.0035, 0, 0.035 + i * 0.032, 0, 'y'), m.dark);
    }
    add(group, cyl(0.048, 0.052, 0.016, 18), m.dark).position.set(0, 0.012, 0);
    add(group, cyl(0.03, 0.038, 0.032, 16), m.brass).position.set(0, 0.203, 0);
    add(group, box(0.012, 0.095, 0.026, 0.055, 0.14, 0), m.steel);
    add(group, ring(0.024, 0.004, -0.058, 0.16, 0, 'y'), m.steel);
    add(group, ring(0.053, 0.006, 0, 0.16, 0, 'y'), m.accent || m.orange);
  } else if (kind === 'molotov') {
    const body = new THREE.CylinderGeometry(0.048, 0.055, 0.18, 18);
    body.translate(0, 0.1, 0);
    add(group, body, m.glass, 'body');
    const liquid = new THREE.CylinderGeometry(0.043, 0.05, 0.11, 16);
    liquid.translate(0, 0.075, 0);
    add(group, liquid, m.amber, 'liquid');
    add(group, cyl(0.022, 0.03, 0.07, 12), m.glass).position.set(0, 0.22, 0);
    add(group, cyl(0.025, 0.025, 0.018, 12), m.dark).position.set(0, 0.26, 0);
    const rag = cyl(0.012, 0.02, 0.11, 8, 'z');
    add(group, rag, m.tan).position.set(0.012, 0.27, -0.04);
    add(group, cyl(0.018, 0.03, 0.03, 8, 'z'), m.tan).position.set(0, 0.28, 0.05);
  }
}

function buildGrenade(kind) {
  const g = new THREE.Group();
  grenadeBody(g, kind);
  g.userData.kind = 'prop';
  g.userData.prop = kind;
  return g;
}

/* ------------------------------------------------------------------ */
/* C4 / 拆弹包 / 护甲 / 武器箱                                          */
/* ------------------------------------------------------------------ */

function buildC4Model() {
  const m = mats();
  const g = new THREE.Group();
  // 主体：圆角块 + 上下金属护板，比纯盒子更像真实炸药包
  add(g, roundBox(0.28, 0.09, 0.18, 0.022, 0, 0.055, 0), m.dark, 'body');
  add(g, roundBox(0.29, 0.012, 0.19, 0.02, 0, 0.105, 0), m.metal);
  add(g, roundBox(0.292, 0.014, 0.192, 0.02, 0, 0.008, 0), m.metal);
  for (const sx of [-1, 1]) {
    add(g, box(0.012, 0.052, 0.162, sx * 0.143, 0.056, 0), m.metal);
    for (const sz of [-1, 1]) {
      add(g, cyl(0.005, 0.005, 0.012, 8), m.steel).position.set(sx * 0.136, 0.098, sz * 0.078);
    }
  }
  // 顶部控制面板
  add(g, roundBox(0.24, 0.008, 0.15, 0.008, 0, 0.11, 0), m.olive);

  // 显示屏：黑框 + 倒计时绿字
  add(g, box(0.104, 0.01, 0.07, -0.052, 0.116, 0.033), m.dark);
  const screenTex = labelTexture(['00:35', 'ARMED'], {
    bg: '#07110a', fg: '#7cf0a4', border: 'rgba(110,220,150,.35)'
  });
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.09, 0.052),
    new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false })
  );
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(-0.052, 0.1225, 0.031);
  g.add(screen);

  // 键盘：3×3 凸起按键 + 中央启动键
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      add(g, roundBox(0.024, 0.007, 0.018, 0.004, 0.03 + c * 0.03, 0.117, -0.04 + r * 0.03), m.steel);
    }
  }
  add(g, roundBox(0.03, 0.008, 0.024, 0.005, 0.115, 0.118, 0.052), m.red);
  add(g, cyl(0.006, 0.006, 0.008, 10), m.led).position.set(0.115, 0.124, -0.055);
  add(g, cyl(0.006, 0.006, 0.008, 10), m.screen).position.set(0.115, 0.124, -0.032);
  add(g, box(0.018, 0.008, 0.026, -0.115, 0.117, -0.022), m.steel);

  // 电线：从后端接入，末端有插头
  const wireMat = [m.red, m.blue, m.brass];
  for (let i = 0; i < 3; i++) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.11, 0.094, 0.04 + i * 0.012),
      new THREE.Vector3(-0.17, 0.125, 0.055 + i * 0.016),
      new THREE.Vector3(-0.2, 0.055, 0.0 + i * 0.016),
      new THREE.Vector3(-0.145, 0.012, -0.03 + i * 0.014)
    ]);
    add(g, new THREE.TubeGeometry(curve, 14, 0.0045, 6, false), wireMat[i]);
    add(g, cyl(0.008, 0.008, 0.02, 8), m.dark).position.set(-0.14, 0.008, -0.03 + i * 0.014);
  }

  // 绑带 + 金属扣
  for (const sz of [-1, 1]) {
    add(g, box(0.31, 0.022, 0.014, 0, 0.058, sz * 0.096), m.tan);
    add(g, box(0.026, 0.03, 0.02, 0.08, 0.058, sz * 0.1), m.steel);
  }

  // 天线：底座 + 细杆
  add(g, cyl(0.009, 0.011, 0.018, 10), m.dark).position.set(-0.095, 0.118, -0.06);
  add(g, cyl(0.0025, 0.0025, 0.11, 6), m.steel).position.set(-0.095, 0.182, -0.06);

  // 侧面警示标签
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.13, 0.065),
    new THREE.MeshBasicMaterial({ map: labelTexture(['C4', 'DEMOLITION'], { bg: '#17140f', fg: '#e6c98a', border: 'rgba(214,150,60,.6)' }), toneMapped: false })
  );
  label.position.set(0, 0.055, 0.0915);
  g.add(label);

  g.userData.kind = 'prop';
  g.userData.prop = 'c4';
  return g;
}

function buildDefuse() {
  const m = mats();
  const g = new THREE.Group();
  add(g, box(0.22, 0.07, 0.14, 0, 0.05, 0), m.fabric, 'body');
  add(g, box(0.225, 0.012, 0.145, 0, 0.09, 0), m.olive);
  add(g, box(0.20, 0.008, 0.02, 0, 0.096, 0.03), m.steel);
  add(g, box(0.05, 0.014, 0.06, 0.045, 0.1, -0.03), m.blue);
  add(g, box(0.03, 0.016, 0.03, 0.045, 0.108, -0.03), m.tan);
  for (let i = 0; i < 3; i++) {
    add(g, cyl(0.006, 0.006, 0.13, 6, 'z'), m.steel).position.set(-0.045 + i * 0.02, 0.07, 0.11);
    add(g, cyl(0.009, 0.009, 0.03, 8, 'z'), m.orange).position.set(-0.045 + i * 0.02, 0.07, 0.18);
  }
  add(g, ring(0.012, 0.003, -0.08, 0.09, 0.02, 'x'), m.brass);
  g.userData.kind = 'prop';
  g.userData.prop = 'defuse';
  return g;
}

function buildArmor() {
  const m = mats();
  const g = new THREE.Group();
  // 防弹衣：躯干剪影 + 领口，而不是一个立着的胶囊
  const s = new THREE.Shape();
  s.moveTo(-0.18, -0.24);
  s.lineTo(0.18, -0.24);
  s.quadraticCurveTo(0.225, -0.24, 0.225, -0.18);
  s.lineTo(0.225, 0.08);
  s.quadraticCurveTo(0.225, 0.17, 0.13, 0.195);
  s.lineTo(0.095, 0.215);
  s.quadraticCurveTo(0.065, 0.145, 0, 0.145);
  s.quadraticCurveTo(-0.065, 0.145, -0.095, 0.215);
  s.lineTo(-0.13, 0.195);
  s.quadraticCurveTo(-0.225, 0.17, -0.225, 0.08);
  s.lineTo(-0.225, -0.18);
  s.quadraticCurveTo(-0.225, -0.24, -0.18, -0.24);
  const vestGeo = new THREE.ExtrudeGeometry(s, {
    depth: 0.085, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012,
    bevelSegments: 3, curveSegments: 10, steps: 1
  });
  vestGeo.translate(0, 0.29, -0.0425);
  add(g, vestGeo, m.fabric, 'vest');
  // 前胸 MOLLE 织带
  for (let i = 0; i < 3; i++) {
    add(g, box(0.3, 0.022, 0.012, 0, 0.2 + i * 0.06, 0.058), m.olive);
  }
  // 弹匣袋 / 电台袋
  for (let i = 0; i < 3; i++) {
    add(g, roundBox(0.072, 0.09, 0.028, 0.01, -0.09 + i * 0.09, 0.145, 0.064), m.olive);
    add(g, box(0.06, 0.012, 0.008, -0.09 + i * 0.09, 0.19, 0.08), m.dark);
  }
  // 肩带
  for (const sx of [-1, 1]) {
    add(g, box(0.05, 0.16, 0.02, sx * 0.105, 0.4, 0.05), m.dark);
    add(g, box(0.05, 0.16, 0.02, sx * 0.105, 0.4, -0.05), m.dark);
  }
  // 腰部束带 + 侧扣
  add(g, box(0.47, 0.045, 0.13, 0, 0.09, 0), m.tan);
  for (const sx of [-1, 1]) {
    add(g, box(0.03, 0.06, 0.03, sx * 0.225, 0.09, 0.02), m.brass);
  }
  // 领口
  add(g, ring(0.075, 0.012, 0, 0.44, 0.0, 'y'), m.dark);
  // 头盔
  const shell = new THREE.SphereGeometry(0.125, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58);
  shell.translate(0.33, 0.16, 0);
  add(g, shell, m.olive, 'helmet');
  add(g, ring(0.122, 0.012, 0.33, 0.16, 0, 'y'), m.dark);
  add(g, box(0.17, 0.045, 0.035, 0.33, 0.175, -0.09), m.dark);
  add(g, box(0.14, 0.06, 0.01, 0.33, 0.175, -0.11), m.glass || m.cyan);
  // 标签
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.06),
    new THREE.MeshBasicMaterial({ map: labelTexture(['KEVLAR', 'LEVEL III-A'], { bg: '#1b1e18', fg: '#d9d2b8', border: 'rgba(190,180,140,.5)' }), toneMapped: false })
  );
  label.position.set(0, 0.31, 0.061);
  g.add(label);
  g.userData.kind = 'prop';
  g.userData.prop = 'armor';
  return g;
}

function buildCase() {
  const m = mats();
  const g = new THREE.Group();
  add(g, box(0.46, 0.3, 0.13, 0, 0.16, 0), m.metal, 'body');
  add(g, box(0.47, 0.02, 0.14, 0, 0.31, 0), m.brass);
  add(g, box(0.47, 0.02, 0.14, 0, 0.01, 0), m.brass);
  add(g, box(0.12, 0.03, 0.02, 0, 0.33, 0), m.dark);
  add(g, box(0.09, 0.05, 0.015, 0, 0.3, 0.07), m.olive);
  add(g, box(0.07, 0.02, 0.01, 0, 0.3, 0.077), m.tan);
  for (const x of [-0.16, 0.16]) {
    add(g, box(0.05, 0.02, 0.02, x, 0.31, -0.07), m.steel);
  }
  // 贴纸
  add(g, box(0.07, 0.055, 0.004, -0.12, 0.18, 0.066), m.red);
  add(g, box(0.06, 0.045, 0.004, 0.1, 0.12, 0.066), m.tan);
  add(g, box(0.04, 0.04, 0.004, 0.0, 0.24, 0.066), m.cyan);
  g.userData.kind = 'prop';
  g.userData.prop = 'case';
  return g;
}

const BUILDERS = {
  he: () => buildGrenade('he'),
  flash: () => buildGrenade('flash'),
  smoke: () => buildGrenade('smoke'),
  molotov: () => buildGrenade('molotov'),
  c4: buildC4Model,
  defuse: buildDefuse,
  armor: buildArmor,
  case: buildCase
};

export const PROP_INFO = {
  he: { name: '高爆手雷', sub: 'FRAG · 范围伤害' },
  flash: { name: '闪光弹', sub: 'FLASH · 致盲' },
  smoke: { name: '烟雾弹', sub: 'SMOKE · 遮蔽' },
  molotov: { name: '燃烧瓶', sub: 'INCENDIARY · 火焰' },
  c4: { name: 'C4 炸弹', sub: 'DEMOLITION · 目标' },
  defuse: { name: '拆弹工具', sub: 'DEFUSE KIT · 拆包' },
  armor: { name: '护甲与头盔', sub: 'KEVLAR · 防护' },
  case: { name: '武器箱', sub: 'WEAPON CASE · 藏品' }
};

export function buildPropModel(id) {
  const fn = BUILDERS[id] || BUILDERS.case;
  const g = fn();
  g.userData.weaponId = 'prop';
  return g;
}

/** 把一组道具按材质合并，给大厅展台用（避免每个小零件一个 draw call）。 */
export function mergePropsByMaterial(props) {
  const byMat = new Map();
  const root = new THREE.Group();
  props.forEach((g) => {
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.uuid;
      if (!byMat.has(key)) byMat.set(key, { mat: o.material, geos: [] });
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      byMat.get(key).geos.push(geo);
    });
  });
  byMat.forEach((v) => {
    const mesh = new THREE.Mesh(mergeGeos(v.geos), v.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    v.geos.forEach((g) => g.dispose());
  });
  return root;
}
