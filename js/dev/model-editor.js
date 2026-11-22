// 模型工坊（?rig=1）：武器挂点 + 人物持枪姿势的可视化调节器。
// 只服务皮肤/模型美术：改位置/旋转/缩放，导出 JSON，不碰玩法与命中判定。

import * as THREE from '../../vendor/three.module.js';
import { Engine } from '../render/engine.js';
import { buildWeaponModel } from '../render/weapon-models.js';
import { preloadWeaponModels } from '../render/model-assets.js';
import { createAvatar, animateAvatar, loadAvatarModel } from '../render/avatar-glb.js';
import {
  loadWeaponRig, saveWeaponRig, loadCharRig, saveCharRig,
  fetchStaticWeaponRig, fetchStaticCharRig
} from '../render/rig.js';

const WEAPON_IDS = ['ak', 'm4', 'awp', 'mp9', 'glock', 'usp', 'deagle', 'knife'];
const WEAPON_NAMES = {
  ak: 'AK-47', m4: 'M4A4', awp: 'AWP', mp9: 'MP9',
  glock: 'GLOCK-18', usp: 'USP-S', deagle: '沙漠之鹰', knife: '爪刀'
};

const CSS = `
#rig-ui{position:fixed;inset:0;z-index:40;pointer-events:none;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#ece7d8}
#rig-ui .rig-top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:14px;
  padding:10px 16px;background:linear-gradient(180deg,rgba(10,11,9,.92),rgba(10,11,9,.55));pointer-events:auto}
#rig-ui .rig-title{font:700 13px/1 var(--mono);letter-spacing:.18em;color:#d9b47a}
#rig-ui .rig-tab{padding:6px 14px;border:1px solid rgba(236,231,216,.22);background:rgba(20,22,17,.8);
  color:#a49d8a;font:600 11px/1 var(--mono);cursor:pointer;letter-spacing:.08em}
#rig-ui .rig-tab.on{color:#111;background:#d9b47a;border-color:#d9b47a}
#rig-ui .rig-spacer{flex:1}
#rig-ui .rig-link{color:#a49d8a;font:600 10px/1 var(--mono);text-decoration:none;
  border:1px solid rgba(236,231,216,.18);padding:6px 10px}
#rig-ui .rig-side{position:absolute;right:14px;top:62px;bottom:14px;width:310px;overflow:auto;
  background:rgba(12,14,10,.9);border:1px solid rgba(217,180,122,.28);padding:12px 14px;pointer-events:auto}
#rig-ui .rig-group{margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid rgba(236,231,216,.09)}
#rig-ui .rig-group h4{margin:0 0 8px;font:700 10px/1 var(--mono);letter-spacing:.16em;color:#d9b47a}
#rig-ui .rig-weps{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
#rig-ui .rig-weps button{padding:7px 2px;font:600 9.5px/1 var(--mono);border:1px solid rgba(236,231,216,.16);
  background:rgba(24,26,20,.8);color:#a49d8a;cursor:pointer}
#rig-ui .rig-weps button.on{background:rgba(217,180,122,.18);color:#f0e6cf;border-color:#d9b47a}
#rig-ui .rig-row{display:flex;align-items:center;gap:8px;margin:5px 0;font:600 9.5px/1 var(--mono);color:#a49d8a}
#rig-ui .rig-row label{width:44px;flex:0 0 auto}
#rig-ui .rig-row input[type=range]{flex:1;min-width:0;accent-color:#e06a35}
#rig-ui .rig-row b{width:44px;text-align:right;color:#ece7d8;font-weight:600}
#rig-ui .rig-btns{display:flex;gap:6px;flex-wrap:wrap}
#rig-ui .rig-btns button{flex:1;min-width:64px;padding:8px 6px;border:1px solid rgba(236,231,216,.2);
  background:rgba(24,26,20,.85);color:#d9d2c0;font:600 10px/1 var(--mono);cursor:pointer}
#rig-ui .rig-btns button.primary{background:linear-gradient(135deg,#d9662f,#c4501f);border-color:#e08a3a;color:#fff}
#rig-ui .rig-btns button.state.on{background:rgba(224,106,53,.28);border-color:#e06a35;color:#ffd9c0}
#rig-ui .rig-note{font:500 9.5px/1.6 var(--mono);color:rgba(236,231,216,.45);margin-top:8px}
#rig-ui .rig-hint{position:absolute;left:16px;bottom:12px;font:600 10px/1.6 var(--mono);
  color:rgba(236,231,216,.4);pointer-events:none}
#rig-ui .rig-status{position:absolute;right:330px;bottom:12px;font:600 10px/1.6 var(--mono);
  color:rgba(217,180,122,.75)}
@media (max-width:760px){
  #rig-ui .rig-side{width:220px;top:58px}
  #rig-ui .rig-status{right:246px}
}
`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function startModelEditor(canvas) {
  ['boot', 'hud', 'lobby-ui', 'touch', 'photo-ui'].forEach((id) => {
    const n = document.getElementById(id);
    if (n) n.classList.add('hidden');
  });
  document.body.classList.remove('in-lobby', 'in-match');

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const engine = new Engine(canvas);
  engine.setMood('match');
  engine.setQuality('high');

  const env = new THREE.Group();
  engine.scene.add(env);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.92, metalness: 0.03 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  env.add(ground);
  const grid = new THREE.GridHelper(40, 40, 0x6a5a3c, 0x3a3428);
  grid.position.y = 0.002;
  env.add(grid);
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(14, 7, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x8a7a5e, roughness: 0.9 })
  );
  wall.position.set(0, 3.5, -3.4);
  wall.receiveShadow = true;
  env.add(wall);

  // 轨道相机
  const orbit = { theta: 0, phi: 0.22, dist: 4.2, target: new THREE.Vector3(0, 1.2, 0) };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, button: e.button };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.button === 2) {
      const s = orbit.dist * 0.0016;
      orbit.target.x -= dx * s;
      orbit.target.y += dy * s;
    } else {
      orbit.theta -= dx * 0.006;
      orbit.phi = Math.max(-0.35, Math.min(1.2, orbit.phi + dy * 0.005));
    }
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    orbit.dist = Math.max(1.2, Math.min(12, orbit.dist + e.deltaY * 0.003));
    e.preventDefault();
  }, { passive: false });

  function applyCamera() {
    const r = orbit.dist;
    engine.camera.position.set(
      orbit.target.x + r * Math.cos(orbit.phi) * Math.sin(orbit.theta),
      orbit.target.y + r * Math.sin(orbit.phi) + 0.25,
      orbit.target.z + r * Math.cos(orbit.phi) * Math.cos(orbit.theta)
    );
    engine.camera.lookAt(orbit.target);
  }

  /* ---------------- UI 骨架 ---------------- */
  const ui = el('div');
  ui.id = 'rig-ui';
  const top = el('div', 'rig-top');
  top.appendChild(el('span', 'rig-title', 'MODEL LAB · 模型工坊'));
  const tabWeapon = el('button', 'rig-tab on', '武器挂点');
  const tabChar = el('button', 'rig-tab', '人物姿势');
  top.appendChild(tabWeapon);
  top.appendChild(tabChar);
  top.appendChild(el('span', 'rig-spacer'));
  const link = el('a', 'rig-link', '地图工坊 →');
  link.href = location.pathname + '?editor=1';
  top.appendChild(link);
  const link2 = el('a', 'rig-link', '回游戏 →');
  link2.href = location.pathname;
  top.appendChild(link2);
  ui.appendChild(top);
  const side = el('div', 'rig-side');
  ui.appendChild(side);
  const hint = el('div', 'rig-hint', '左键拖动旋转 · 滚轮缩放 · 右键平移');
  ui.appendChild(hint);
  const status = el('div', 'rig-status', '');
  ui.appendChild(status);
  document.body.appendChild(ui);

  let tab = /[?&]tab=char/.test(location.search) ? 'char' : 'weapon';
  let weaponRig = loadWeaponRig();
  let charRig = loadCharRig();
  let weaponRoot = null;
  let weaponId = 'ak';
  const weaponAnchor = new THREE.Group();
  weaponAnchor.position.set(0, 1.55, 0);
  env.add(weaponAnchor);
  let charGroup = null;
  let charAv = null;
  let charGun = null;
  let charState = 'aim';
  let charReady = false;

  function flashStatus(text) {
    status.textContent = text;
  }

  /* ---------------- 武器页 ---------------- */
  function setWeapon(id) {
    weaponId = id;
    if (weaponRoot) {
      weaponAnchor.remove(weaponRoot);
      weaponRoot.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    weaponRoot = buildWeaponModel(id, { hands: true, depthTest: true, renderOrder: 0 });
    weaponRoot.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    weaponAnchor.add(weaponRoot);
    applyWeaponRig();
  }

  function applyWeaponRig() {
    if (!weaponRoot) return;
    const r = weaponRig.weapons[weaponId];
    weaponRoot.position.fromArray(r.pos);
    weaponRoot.rotation.set(r.rot[0], r.rot[1], r.rot[2]);
    weaponRoot.scale.setScalar(r.scale);
  }

  function buildWeaponPanel() {
    side.innerHTML = '';
    const g1 = el('div', 'rig-group');
    g1.appendChild(el('h4', null, '武器'));
    const weps = el('div', 'rig-weps');
    WEAPON_IDS.forEach((id) => {
      const b = el('button', null, WEAPON_NAMES[id]);
      b.classList.toggle('on', id === weaponId);
      b.addEventListener('click', () => {
        setWeapon(id);
        buildWeaponPanel();
      });
      weps.appendChild(b);
    });
    g1.appendChild(weps);
    side.appendChild(g1);

    const r = weaponRig.weapons[weaponId];
    const g2 = el('div', 'rig-group');
    g2.appendChild(el('h4', null, '位置 / 旋转 / 缩放'));
    const addRange = (label, min, max, step, get, set, fmt) => {
      const row = el('div', 'rig-row');
      row.appendChild(el('label', null, label));
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step;
      input.value = get();
      const val = el('b', null, fmt(get()));
      input.addEventListener('input', () => {
        set(parseFloat(input.value));
        val.textContent = fmt(get());
        applyWeaponRig();
      });
      row.appendChild(input);
      row.appendChild(val);
      g2.appendChild(row);
    };
    const f2 = (v) => v.toFixed(2);
    ['x', 'y', 'z'].forEach((axis, i) => {
      addRange('位置 ' + axis.toUpperCase(), -1.5, 1.5, 0.01,
        () => r.pos[i], (v) => { r.pos[i] = v; }, f2);
    });
    ['X', 'Y', 'Z'].forEach((axis, i) => {
      addRange('旋转 ' + axis, -1.6, 1.6, 0.01,
        () => r.rot[i], (v) => { r.rot[i] = v; }, f2);
    });
    addRange('缩放', 0.3, 1.6, 0.01, () => r.scale, (v) => { r.scale = v; }, f2);
    side.appendChild(g2);

    const g3 = el('div', 'rig-group');
    const btns = el('div', 'rig-btns');
    const save = el('button', 'primary', '保存本机');
    save.addEventListener('click', () => {
      saveWeaponRig(weaponRig);
      flashStatus('武器挂点已保存到本机 · 游戏内用 ?rigEdits=1 预览');
    });
    const reset = el('button', null, '恢复随包');
    reset.addEventListener('click', async () => {
      weaponRig = await fetchStaticWeaponRig();
      applyWeaponRig();
      buildWeaponPanel();
      flashStatus('已恢复 assets/weapon-rig.json');
    });
    const exp = el('button', null, '导出 JSON');
    exp.addEventListener('click', () => download('weapon-rig.json', weaponRig));
    btns.appendChild(save);
    btns.appendChild(reset);
    btns.appendChild(exp);
    g3.appendChild(btns);
    g3.appendChild(el('div', 'rig-note',
      '坐标是相对第一人称相机的偏移：Z 负值朝前。导出的 JSON 覆盖 assets/weapon-rig.json 后随包生效。'));
    side.appendChild(g3);
  }

  /* ---------------- 人物页 ---------------- */
  function ensureChar() {
    if (charReady) return Promise.resolve();
    return loadAvatarModel().then((ok) => {
      if (!ok) {
        flashStatus('GLB 人物加载失败，无法编辑');
        return;
      }
      charGroup = new THREE.Group();
      env.add(charGroup);
      charAv = createAvatar('ct');
      if (!charAv) return;
      charGroup.add(charAv.root);
      charAv.pose = charRig.pose;
      charAv.crouchDrop = charRig.crouchDrop;
      charAv.root.scale.setScalar((charAv.fitScale || 1) * charRig.scale);
      charAv.root.position.y = (charAv.fitDrop || 0) * charRig.scale;
      charGun = buildWeaponModel('ak', { hands: false, detail: 'low' });
      charGun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      charGroup.add(charGun);
      charReady = true;
      applyCharRig();
    });
  }

  function applyCharRig() {
    if (!charAv) return;
    charAv.pose = charRig.pose;
    charAv.crouchDrop = charRig.crouchDrop;
    charAv.root.scale.setScalar((charAv.fitScale || 1) * charRig.scale);
    charAv.root.position.y = (charAv.fitDrop || 0) * charRig.scale;
    animateAvatar(charAv, 0, 0, { engage: true });
    updateCharMount();
  }

  const _hp = new THREE.Vector3();
  const _tilt = new THREE.Quaternion();
  function updateCharMount() {
    if (!charAv || !charAv.hand || !charGun) return;
    charGroup.updateMatrixWorld(true);
    charAv.hand.getWorldPosition(_hp);
    charGroup.worldToLocal(_hp);
    charGun.position.copy(_hp).add(new THREE.Vector3().fromArray(charRig.mount.offset));
    charGun.quaternion.setFromEuler(new THREE.Euler(
      charRig.mount.tilt[0], charRig.mount.tilt[1], charRig.mount.tilt[2]
    ));
    charGun.rotateY(0);
  }

  function buildCharPanel() {
    side.innerHTML = '';
    const mkGroup = (title) => {
      const g = el('div', 'rig-group');
      g.appendChild(el('h4', null, title));
      side.appendChild(g);
      return g;
    };
    const addRange = (parent, label, min, max, step, get, set, fmt) => {
      const row = el('div', 'rig-row');
      row.appendChild(el('label', null, label));
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step;
      input.value = get();
      const val = el('b', null, fmt(get()));
      input.addEventListener('input', () => {
        set(parseFloat(input.value));
        val.textContent = fmt(get());
        applyCharRig();
      });
      row.appendChild(input);
      row.appendChild(val);
      parent.appendChild(row);
    };
    const f2 = (v) => v.toFixed(2);

    if (!charReady) {
      const g = mkGroup('人物模型');
      g.appendChild(el('div', 'rig-note', '正在加载 GLB…'));
    } else {
      const gp = mkGroup('枪口挂点');
      ['x', 'y', 'z'].forEach((axis, i) => {
        addRange(gp, '偏移 ' + axis.toUpperCase(), -0.4, 0.4, 0.01,
          () => charRig.mount.offset[i], (v) => { charRig.mount.offset[i] = v; }, f2);
      });
      ['X', 'Y', 'Z'].forEach((axis, i) => {
        addRange(gp, '旋转 ' + axis, -1.6, 1.6, 0.01,
          () => charRig.mount.tilt[i], (v) => { charRig.mount.tilt[i] = v; }, f2);
      });

      const ga = mkGroup('持枪姿势（左 / 右臂）');
      ['rightArm', 'rightForeArm', 'leftArm', 'leftForeArm']
        .forEach((key) => {
          ['X', 'Y', 'Z'].forEach((axis, i) => {
            addRange(ga, key + ' ' + axis, -1.8, 1.8, 0.01,
              () => charRig.pose[key][i], (v) => { charRig.pose[key][i] = v; }, f2);
          });
        });
      addRange(ga, '脊柱 X', -0.5, 0.5, 0.01,
        () => charRig.pose.spine[0], (v) => { charRig.pose.spine[0] = v; }, f2);

      const gs = mkGroup('整体');
      addRange(gs, '模型缩放', 0.7, 1.3, 0.01, () => charRig.scale, (v) => { charRig.scale = v; }, f2);
      addRange(gs, '蹲下下沉', 0, 0.5, 0.01, () => charRig.crouchDrop, (v) => { charRig.crouchDrop = v; }, f2);

      const st = mkGroup('动作预览');
      const btns = el('div', 'rig-btns');
      [['aim', '瞄准'], ['shoot', '射击'], ['reload', '换弹'], ['idle', '待机'], ['death', '倒地']]
        .forEach(([key, text]) => {
          const b = el('button', charState === key ? 'state on' : 'state', text);
          b.addEventListener('click', () => {
            charState = key;
            buildCharPanel();
          });
          btns.appendChild(b);
        });
      st.appendChild(btns);
    }

    const g4 = mkGroup('导出');
    const btns = el('div', 'rig-btns');
    const save = el('button', 'primary', '保存本机');
    save.addEventListener('click', () => {
      saveCharRig(charRig);
      flashStatus('人物姿势已保存到本机 · 游戏内用 ?rigEdits=1 预览');
    });
    const reset = el('button', null, '恢复随包');
    reset.addEventListener('click', async () => {
      charRig = await fetchStaticCharRig();
      applyCharRig();
      buildCharPanel();
      flashStatus('已恢复 assets/character-rig.json');
    });
    const exp = el('button', null, '导出 JSON');
    exp.addEventListener('click', () => download('character-rig.json', charRig));
    btns.appendChild(save);
    btns.appendChild(reset);
    btns.appendChild(exp);
    g4.appendChild(btns);
    g4.appendChild(el('div', 'rig-note',
      '人物姿势参数会写进 assets/character-rig.json；后续做皮肤/换装时只改模型，不用再碰 AI 代码。'));
  }

  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flashStatus('已导出 ' + name);
  }

  function setTab(next) {
    tab = next;
    tabWeapon.classList.toggle('on', tab === 'weapon');
    tabChar.classList.toggle('on', tab === 'char');
    env.children.forEach((n) => {
      if (n === weaponAnchor) n.visible = tab === 'weapon';
      if (n === charGroup) n.visible = tab === 'char';
    });
    orbit.target.set(0, tab === 'weapon' ? 1.28 : 1.0, tab === 'weapon' ? -0.45 : 0);
    orbit.dist = tab === 'weapon' ? 0.85 : 0.85;
    orbit.theta = tab === 'weapon' ? Math.PI * 0.72 : Math.PI;
    orbit.phi = 0.08;
    if (tab === 'weapon') {
      buildWeaponPanel();
      setWeapon(weaponId);
    } else {
      buildCharPanel();
      ensureChar().then(buildCharPanel);
    }
  }

  tabWeapon.addEventListener('click', () => setTab('weapon'));
  tabChar.addEventListener('click', () => setTab('char'));

  // 初始：武器
  setWeapon(weaponId);
  setTab(tab);

  // 工坊也要看 glb 版本：否则调完挂点，进游戏发现模型换了材质/细节。
  preloadWeaponModels().then((n) => {
    if (n > 0) setWeapon(weaponId);
  });

  let last = performance.now();
  let stateT = 0;
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    applyCamera();
    if (tab === 'char' && charAv) {
      stateT += dt;
      let opts = { engage: true };
      if (charState === 'shoot') opts = { engage: true, shoot: (Math.sin(stateT * 18) * 0.5 + 0.5) };
      else if (charState === 'reload') opts = { engage: true, reload: (Math.sin(stateT * 3) * 0.5 + 0.5) };
      else if (charState === 'idle') opts = { engage: false };
      else if (charState === 'death') opts = { engage: false, dead: true };
      if (charState === 'death') {
        charGroup.rotation.z = -Math.PI / 2;
        charGroup.position.y = 0.25;
      } else {
        charGroup.rotation.z = 0;
        charGroup.position.y = 0;
      }
      animateAvatar(charAv, dt, 0, opts);
      updateCharMount();
    }
    engine.render();
  }
  loop();

  window.__modelEditor = {
    engine,
    get weaponRig() { return weaponRig; },
    get charRig() { return charRig; },
    get tab() { return tab; },
    setTab,
    setWeapon,
    applyWeaponRig,
    applyCharRig,
    saveWeaponRig: () => saveWeaponRig(weaponRig),
    saveCharRig: () => saveCharRig(charRig)
  };
  console.info('[rig] model editor ready');
}
