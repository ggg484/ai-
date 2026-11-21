// 地图工坊（开发用）：?editor=1
// 只编辑结构盒体（map.placed），不改地形/贴图/装饰网格；
// 改动以「相对基础地图」的 edits 保存，试玩时 ?mapEdits=1 加载。
//
// 操作：左键空白旋转 / 右键平移 / 滚轮缩放 / 点击选中 / 选中后再拖拽移动
//       [ ] 调整高度 / Del 删除 / Ctrl+D 复制 / Ctrl+Z 撤销 / Ctrl+Y 重做

import * as THREE from '../../vendor/three.module.js';
import { Engine } from '../render/engine.js';
import { buildMap } from '../world/map.js';
import { audit } from './devtools.js';
import {
  emptyEdits, normalizeEdits, countEdits,
  loadStoredEdits, saveStoredEdits, clearStoredEdits, fetchStaticEdits
} from '../world/map-edits.js';
import {
  PRESETS as LIGHT_PRESETS, cloneLighting, normalizeLighting,
  loadStoredLighting, saveStoredLighting, fetchStaticLighting
} from '../world/lighting.js';

const SNAPS = [0.25, 0.5, 1];

const PRESETS = {
  wall: { label: '墙体 4×4×0.8', w: 4, h: 4, d: 0.8, kind: 'plaster', tag: 'wall' },
  cover: { label: '木制掩体 2.4×1.1×1.2', w: 2.4, h: 1.1, d: 1.2, kind: 'wood', tag: 'cover' },
  sandbag: { label: '沙袋墙 2.8×1×1.3', w: 2.8, h: 1, d: 1.3, kind: 'fabric', tag: 'cover', repeat: 4 },
  crate: { label: '木箱 1.2³', w: 1.2, h: 1.2, d: 1.2, kind: 'wood', tag: 'cover' },
  platform: { label: '平台 4×0.4×4', w: 4, h: 0.4, d: 4, kind: 'concrete', tag: 'platform' },
  pillar: { label: '立柱 0.6×4×0.6', w: 0.6, h: 4, d: 0.6, kind: 'concrete', tag: 'wall' }
};

const CSS = `
#me-top{position:fixed;left:14px;top:12px;z-index:80;pointer-events:none;
  font:12px/1.5 ui-monospace,Menlo,monospace;color:#e7efec;text-shadow:0 2px 10px #000}
#me-top b{font-size:15px;letter-spacing:.08em;color:#fff}
#me-top span{color:#79c7e8;margin-left:8px;font-size:11px;letter-spacing:.14em}
#me-hint{margin-top:5px;color:#a9bdb6;font-size:11px;max-width:560px}
#me-panel{position:fixed;right:12px;top:12px;bottom:12px;width:330px;z-index:80;overflow:auto;
  background:rgba(12,16,18,.93);border:1px solid #35505a;border-radius:8px;padding:10px;
  color:#dce7e3;font:11px/1.55 ui-monospace,Menlo,monospace;box-shadow:0 16px 44px #000b;
  backdrop-filter:blur(6px)}
#me-panel h3{margin:0 0 8px;font-size:12px;color:#8ad7f2;letter-spacing:.1em}
#me-panel .sec{border-top:1px solid #263a42;padding-top:8px;margin-top:8px}
#me-panel .sec:first-of-type{border-top:0;padding-top:0;margin-top:0}
#me-panel .row{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin:5px 0}
#me-panel .row>b{color:#a9bdb6;font-weight:600;margin-right:3px}
#me-panel button{background:#17252b;color:#cfe6ee;border:1px solid #35505a;border-radius:4px;
  padding:4px 7px;cursor:pointer;font:inherit}
#me-panel button:hover{background:#213842;border-color:#4f7c8c}
#me-panel button.primary{background:#1d4b5c;border-color:#3f8aa8;color:#fff}
#me-panel button.danger{background:#3a2020;border-color:#7c4141;color:#ffd6d6}
#me-panel button:disabled{opacity:.4;cursor:default}
#me-panel select{background:#17252b;color:#cfe6ee;border:1px solid #35505a;border-radius:4px;
  padding:3px;font:inherit;max-width:100%}
#me-fields{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:6px 0}
#me-fields label{display:flex;align-items:center;gap:4px;color:#8fa7a0}
#me-fields input{width:100%;min-width:0;background:#0e181c;color:#e8f5fa;border:1px solid #2d4852;
  border-radius:3px;padding:3px 4px;font:inherit}
#me-fields input:disabled{opacity:.4}
#me-status{margin-top:6px;color:#9fc7b4;white-space:pre-line;border-top:1px solid #263a42;padding-top:6px}
#me-status .warn{color:#e8b56a}
#me-issues{max-height:24vh;overflow:auto;margin-top:5px}
#me-issues .it{padding:3px 4px;border-bottom:1px solid #1c2a30;cursor:pointer}
#me-issues .it:hover{background:#1b3038}
#me-issues .t{color:#e8a55e}
#me-issues .d{color:#8fa7a0}
#me-panel .hint{color:#6f8b84;font-size:10px;line-height:1.5}
#me-tabs button{flex:1}
#me-tabs button.on{background:#1d4b5c;border-color:#3f8aa8;color:#fff}
#me-light-tab label{display:flex;align-items:center;gap:4px;color:#8fa7a0;flex:1;min-width:0}
#me-light-tab input[type=number]{width:100%;min-width:0;background:#0e181c;color:#e8f5fa;border:1px solid #2d4852;
  border-radius:3px;padding:3px 4px;font:inherit}
#me-light-tab input[type=color]{width:30px;height:22px;padding:0;border:1px solid #2d4852;border-radius:3px;background:#0e181c}
#me-light-tab input[type=range]{flex:1;min-width:0}
#me-light-tab .val{color:#dff4ff;min-width:34px;text-align:right}
#me-light-tab .row>b{flex:0 0 auto}
#me-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:90;
  background:#102026;border:1px solid #3f8aa8;color:#dff4ff;border-radius:6px;padding:8px 14px;
  font:12px ui-monospace,monospace;opacity:0;transition:opacity .2s;pointer-events:none}
`;

export function startEditor(canvas) {
  for (const id of ['boot', 'hud', 'lobby-ui', 'range-hud']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  for (const id of ['perf', 'grade', 'grain']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  document.body.style.overflow = 'hidden';
  document.body.style.background = '#0b1012';

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const engine = new Engine(canvas);
  engine.setMood('match');
  const qm = /[?&]quality=(low|medium|high)/.exec(location.search);
  engine.setQuality(qm ? qm[1] : 'medium');
  engine.camera.fov = 55;
  engine.camera.updateProjectionMatrix();
  engine.scene.fog.near = 150;
  engine.scene.fog.far = 460;

  const mapRoot = new THREE.Group();
  mapRoot.name = 'editor-map';
  engine.scene.add(mapRoot);

  let edits = loadStoredEdits() || emptyEdits();
  let savedJson = JSON.stringify(edits);
  let lighting = loadStoredLighting() || cloneLighting(LIGHT_PRESETS.golden);
  let savedLightJson = JSON.stringify(lighting);
  let lightingTouched = false;
  engine.applyLighting(lighting);
  let map = buildMap(mapRoot, { edits });
  let baseCount = map.baseCount;
  let selectedId = null;
  let copiedBox = null;
  let snap = 0.5;
  let wireVisible = false;
  let wire = null;
  let lastSize = 0;
  const undoStack = [];
  const redoStack = [];
  const raycaster = new THREE.Raycaster();
  const boxA = new THREE.Box3();
  const hitPoint = new THREE.Vector3();
  const dragPlane = new THREE.Plane();
  const planePoint = new THREE.Vector3();
  const ndc = new THREE.Vector2();

  /* ---------------- 相机 ---------------- */
  const orbit = {
    target: new THREE.Vector3(0, 1.5, 0),
    radius: 84,
    theta: 0.62,
    phi: 0.95
  };

  function applyCam() {
    const sp = Math.sin(orbit.phi);
    engine.camera.position.set(
      orbit.target.x + orbit.radius * sp * Math.sin(orbit.theta),
      orbit.target.y + orbit.radius * Math.cos(orbit.phi),
      orbit.target.z + orbit.radius * sp * Math.cos(orbit.theta)
    );
    engine.camera.lookAt(orbit.target);
  }
  applyCam();

  /* ---------------- 辅助显示 ---------------- */
  const grid1 = new THREE.GridHelper(120, 120, 0x4c8496, 0x2c4650);
  grid1.position.y = 0.06;
  grid1.material.transparent = true;
  grid1.material.opacity = 0.34;
  grid1.material.depthWrite = false;
  engine.scene.add(grid1);

  const grid5 = new THREE.GridHelper(120, 24, 0x69b6cf, 0x3f6675);
  grid5.position.y = 0.07;
  grid5.material.transparent = true;
  grid5.material.opacity = 0.42;
  grid5.material.depthWrite = false;
  engine.scene.add(grid5);

  const bb = map.bounds;
  const boundsGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(bb.minX, 0.09, bb.minZ), new THREE.Vector3(bb.maxX, 0.09, bb.minZ),
    new THREE.Vector3(bb.maxX, 0.09, bb.maxZ), new THREE.Vector3(bb.minX, 0.09, bb.maxZ),
    new THREE.Vector3(bb.minX, 0.09, bb.minZ)
  ]);
  const boundsLine = new THREE.Line(boundsGeo, new THREE.LineBasicMaterial({ color: 0x8fd7ff }));
  engine.scene.add(boundsLine);

  const selHelper = new THREE.Box3Helper(new THREE.Box3(), 0x45e3ff);
  selHelper.material.depthTest = false;
  selHelper.material.transparent = true;
  selHelper.material.opacity = 0.95;
  selHelper.renderOrder = 999;
  selHelper.visible = false;
  engine.scene.add(selHelper);

  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x5fe7ff, transparent: true, opacity: 0.3,
      depthWrite: false, wireframe: false
    })
  );
  ghost.visible = false;
  ghost.renderOrder = 998;
  engine.scene.add(ghost);

  // 出生点 / 导航点标记：可直接拖拽（移动后写进 edits.spawns / edits.waypoints）。
  const markerGroup = new THREE.Group();
  engine.scene.add(markerGroup);
  const ringGeo = new THREE.RingGeometry(0.34, 0.52, 18);
  ringGeo.rotateX(-Math.PI / 2);
  const pinGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.1, 6);
  pinGeo.translate(0, 0.62, 0);
  const markerMats = {
    player: new THREE.MeshBasicMaterial({ color: 0x47d7ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    bot: new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }),
    waypoint: new THREE.MeshBasicMaterial({ color: 0x7ee08a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
  };

  function buildMarkers() {
    markerGroup.clear();
    const add = (x, z, kind, index) => {
      const g = new THREE.Group();
      g.position.set(x, 0.1, z);
      g.userData.markerKind = kind;
      g.userData.markerIndex = index;
      g.add(new THREE.Mesh(ringGeo, markerMats[kind]));
      g.add(new THREE.Mesh(pinGeo, markerMats[kind]));
      if (kind === 'waypoint') g.scale.setScalar(0.8);
      markerGroup.add(g);
    };
    add(map.spawns.player.x, map.spawns.player.z, 'player', -1);
    map.spawns.bots.forEach((s, i) => add(s.x, s.z, 'bot', i));
    (map.waypoints || []).forEach((w, i) => add(w.x, w.z, 'waypoint', i));
  }
  buildMarkers();

  /* ---------------- UI ---------------- */
  const ui = document.createElement('div');
  ui.innerHTML = `
    <div id="me-top">
      <b>沙线 · 地图工坊</b><span>BLOCKOUT / DEV</span>
      <div id="me-hint">左键空白旋转 · 右键平移 · 滚轮缩放 · 点击选中 · 选中后再拖拽移动 · [ ] 调高度 · Del 删除 · Ctrl+D 复制 · Ctrl+C/V 复制粘贴 · Ctrl+Z 撤销</div>
    </div>
    <div id="me-panel">
      <h3>MAP WORKBENCH</h3>
      <div class="row" id="me-tabs">
        <button id="me-tab-map" class="on">地图</button>
        <button id="me-tab-light">光影</button>
      </div>
      <div id="me-map-tab">
      <div class="sec">
        <div class="row"><b>选中</b><span id="me-sel">未选择</span></div>
        <div id="me-fields">
          <label>X<input id="me-x" type="number" step="0.25" disabled></label>
          <label>Y<input id="me-y" type="number" step="0.25" disabled></label>
          <label>Z<input id="me-z" type="number" step="0.25" disabled></label>
          <label>W<input id="me-w" type="number" step="0.25" min="0.05" disabled></label>
          <label>H<input id="me-h" type="number" step="0.25" min="0.05" disabled></label>
          <label>D<input id="me-d" type="number" step="0.25" min="0.05" disabled></label>
        </div>
        <div class="row">
          <button id="me-focus">聚焦</button>
          <button id="me-dup">复制</button>
          <button id="me-del" class="danger">删除</button>
        </div>
      </div>
      <div class="sec">
        <div class="row"><b>添加</b>
          <select id="me-preset"></select>
          <button id="me-add" class="primary">放到焦点</button>
        </div>
        <div class="hint">新增件落在轨道焦点、地面吸附；墙体高 4m，掩体默认 1.1m。</div>
      </div>
      <div class="sec">
        <div class="row"><b>吸附</b>
          <select id="me-snap">
            <option value="0.25">0.25 m</option>
            <option value="0.5" selected>0.5 m</option>
            <option value="1">1 m</option>
          </select>
          <button id="me-grid" class="on">网格</button>
          <button id="me-wire">线框</button>
        </div>
        <div class="row"><b>视角</b>
          <button data-cam="overview">全景</button>
          <button data-cam="t">T</button>
          <button data-cam="ct">CT</button>
          <button data-cam="mid">中</button>
          <button data-cam="a">A</button>
          <button data-cam="b">B</button>
        </div>
      </div>
      <div class="sec">
        <div class="row">
          <button id="me-undo">撤销</button>
          <button id="me-redo">重做</button>
          <button id="me-view">复位视角</button>
        </div>
        <div class="row">
          <button id="me-save" class="primary">保存</button>
          <button id="me-play">试玩</button>
          <button id="me-export">导出</button>
          <button id="me-import-btn">导入</button>
        </div>
        <div class="row">
          <button id="me-audit">审计</button>
          <button id="me-clear" class="danger">清空改动</button>
        </div>
        <input type="file" id="me-import" accept="application/json" hidden>
        <div class="hint">保存只写本机 localStorage；试玩使用 ?mapEdits=1。导出 map-edits.json 放到 assets/ 即可随包生效。</div>
      </div>
      </div>
      <div id="me-light-tab" hidden>
        <div class="sec">
          <div class="row"><b>预设</b>
            <select id="me-lp-preset"></select>
            <button id="me-lp-apply" class="primary">应用</button>
          </div>
          <div class="row"><b>视角</b>
            <button data-cam="overview">全景</button>
            <button data-cam="mid">中路</button>
            <button data-cam="ct">CT 院</button>
            <button data-cam="a">A 点</button>
            <button data-cam="b">B 点</button>
          </div>
        </div>
        <div class="sec">
          <div class="row">
            <button id="me-lp-save" class="primary">保存光照</button>
            <button id="me-lp-play">试玩</button>
            <button id="me-lp-export">导出</button>
            <button id="me-lp-import-btn">导入</button>
          </div>
          <div class="row">
            <button id="me-lp-capture">读取当前</button>
            <button id="me-lp-shipped">随包光照</button>
            <button id="me-lp-default">正午默认</button>
          </div>
          <input type="file" id="me-lp-import" accept="application/json" hidden>
          <div class="hint">导出 lighting.json 覆盖 assets/lighting.json 后随包生效；试玩 = ?lightEdits=1。地图改动仍用地图页的「试玩」。</div>
        </div>
        <div class="sec">
          <div class="row"><b>太阳</b>
            <label>方位<input id="me-lp-az" type="number" min="0" max="360" step="1"></label>
            <label>高度<input id="me-lp-el" type="number" min="1" max="88" step="1"></label>
          </div>
          <div class="row">
            <label>颜色<input id="me-lp-sun-color" type="color"></label>
            <label>强度<input id="me-lp-sun-i" type="number" min="0" max="6" step="0.05"></label>
          </div>
        </div>
        <div class="sec">
          <div class="row"><b>天光</b>
            <label>天空<input id="me-lp-hemi-sky" type="color"></label>
            <label>地面<input id="me-lp-hemi-ground" type="color"></label>
            <label>强度<input id="me-lp-hemi-i" type="number" min="0" max="2.5" step="0.05"></label>
          </div>
          <div class="row"><b>补光</b>
            <label>颜色<input id="me-lp-fill-color" type="color"></label>
            <label>强度<input id="me-lp-fill-i" type="number" min="0" max="2.5" step="0.05"></label>
          </div>
        </div>
        <div class="sec">
          <div class="row"><b>雾</b><label>颜色<input id="me-lp-fog-color" type="color"></label></div>
          <div class="row">
            <label>起点<input id="me-lp-fog-near" type="number" min="5" max="200" step="1"></label>
            <label>终点<input id="me-lp-fog-far" type="number" min="30" max="420" step="5"></label>
          </div>
        </div>
        <div class="sec">
          <div class="row"><b>天空</b>
            <label>天顶<input id="me-lp-sky-zenith" type="color"></label>
            <label>地平线<input id="me-lp-sky-horizon" type="color"></label>
          </div>
          <div class="row">
            <label>地面<input id="me-lp-sky-ground" type="color"></label>
            <label>云量<input id="me-lp-cloud" type="number" min="0" max="1" step="0.05"></label>
          </div>
        </div>
        <div class="sec">
          <div class="row"><b>曝光</b>
            <input id="me-lp-exp" type="range" min="0.5" max="2" step="0.01">
            <span id="me-lp-expv" class="val"></span>
          </div>
        </div>
      </div>
      <div id="me-status">载入中…</div>
      <div id="me-issues"></div>
    </div>
    <div id="me-toast"></div>
  `;
  document.body.appendChild(ui);
  const $ = (id) => ui.querySelector('#' + id);

  const presetSel = $('me-preset');
  presetSel.innerHTML = Object.entries(PRESETS)
    .map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
  const fields = {
    x: $('me-x'), y: $('me-y'), z: $('me-z'),
    w: $('me-w'), h: $('me-h'), d: $('me-d')
  };

  function toast(msg) {
    const el = $('me-toast');
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.style.opacity = '0'; }, 1500);
  }

  /* ---------------- 光影编辑器 ---------------- */
  const LIGHT_FIELD_IDS = [
    'me-lp-az', 'me-lp-el', 'me-lp-sun-color', 'me-lp-sun-i',
    'me-lp-hemi-sky', 'me-lp-hemi-ground', 'me-lp-hemi-i',
    'me-lp-fill-color', 'me-lp-fill-i',
    'me-lp-fog-color', 'me-lp-fog-near', 'me-lp-fog-far',
    'me-lp-sky-zenith', 'me-lp-sky-horizon', 'me-lp-sky-ground', 'me-lp-cloud',
    'me-lp-exp'
  ];

  function syncLightFields() {
    const l = lighting;
    $('me-lp-az').value = l.sun.azimuth.toFixed(0);
    $('me-lp-el').value = l.sun.elevation.toFixed(0);
    $('me-lp-sun-color').value = l.sun.color;
    $('me-lp-sun-i').value = l.sun.intensity.toFixed(2);
    $('me-lp-hemi-sky').value = l.hemi.sky;
    $('me-lp-hemi-ground').value = l.hemi.ground;
    $('me-lp-hemi-i').value = l.hemi.intensity.toFixed(2);
    $('me-lp-fill-color').value = l.fill.color;
    $('me-lp-fill-i').value = l.fill.intensity.toFixed(2);
    $('me-lp-fog-color').value = l.fog.color;
    $('me-lp-fog-near').value = l.fog.near.toFixed(0);
    $('me-lp-fog-far').value = l.fog.far.toFixed(0);
    $('me-lp-sky-zenith').value = l.sky.zenith;
    $('me-lp-sky-horizon').value = l.sky.horizon;
    $('me-lp-sky-ground').value = l.sky.ground;
    $('me-lp-cloud').value = l.sky.cloudiness.toFixed(2);
    $('me-lp-exp').value = l.exposure.toFixed(2);
    $('me-lp-expv').textContent = l.exposure.toFixed(2);
  }

  function readLightFields() {
    const n = (id, def) => {
      const v = Number($(id).value);
      return Number.isFinite(v) ? v : def;
    };
    const c = (id, def) => $(id).value || def;
    lighting = normalizeLighting({
      sun: { azimuth: n('me-lp-az', 246), elevation: n('me-lp-el', 24), color: c('me-lp-sun-color', '#ffd1a1'), intensity: n('me-lp-sun-i', 2.75) },
      hemi: { sky: c('me-lp-hemi-sky', '#a8c6e8'), ground: c('me-lp-hemi-ground', '#c7a47a'), intensity: n('me-lp-hemi-i', 0.74) },
      fill: { color: c('me-lp-fill-color', '#8fb0d8'), intensity: n('me-lp-fill-i', 0.4) },
      fog: { color: c('me-lp-fog-color', '#e2c6a6'), near: n('me-lp-fog-near', 58), far: n('me-lp-fog-far', 235) },
      sky: { zenith: c('me-lp-sky-zenith', '#4a96cc'), horizon: c('me-lp-sky-horizon', '#f6d7b0'), ground: c('me-lp-sky-ground', '#7ebf68'), cloudiness: n('me-lp-cloud', 0.55) },
      exposure: n('me-lp-exp', 1.06)
    });
    engine.applyLighting(lighting);
    $('me-lp-expv').textContent = lighting.exposure.toFixed(2);
    lightingTouched = true;
  }

  function downloadLighting() {
    const blob = new Blob([JSON.stringify(normalizeLighting(lighting), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lighting.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  $('me-lp-preset').innerHTML = Object.entries(LIGHT_PRESETS)
    .map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
  $('me-lp-apply').addEventListener('click', () => {
    const p = LIGHT_PRESETS[$('me-lp-preset').value];
    if (!p) return;
    lighting = cloneLighting(p);
    engine.applyLighting(lighting);
    syncLightFields();
    lightingTouched = true;
    toast('已应用：' + p.label);
  });
  for (const id of LIGHT_FIELD_IDS) {
    const el = $(id);
    if (el) el.addEventListener('input', readLightFields);
  }
  $('me-lp-save').addEventListener('click', () => {
    if (saveStoredLighting(lighting)) {
      savedLightJson = JSON.stringify(lighting);
      updateStatus();
      toast('光照已保存到本机');
    }
  });
  $('me-lp-play').addEventListener('click', () => {
    saveStoredLighting(lighting);
    savedLightJson = JSON.stringify(lighting);
    window.open(location.pathname + '?autostart=1&mapEdits=1&lightEdits=1&dev=1', '_blank');
  });
  $('me-lp-export').addEventListener('click', downloadLighting);
  $('me-lp-import-btn').addEventListener('click', () => $('me-lp-import').click());
  $('me-lp-import').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        lighting = normalizeLighting(JSON.parse(String(reader.result)));
        engine.applyLighting(lighting);
        syncLightFields();
        lightingTouched = true;
        toast('光照已导入');
      } catch (err) {
        console.error(err);
        toast('导入失败：JSON 格式错误');
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  });
  $('me-lp-capture').addEventListener('click', () => {
    lighting = engine.captureLighting();
    syncLightFields();
    lightingTouched = true;
    toast('已读取当前引擎光照');
  });
  $('me-lp-shipped').addEventListener('click', () => {
    fetchStaticLighting().then((l) => {
      if (!l) { toast('未找到 assets/lighting.json'); return; }
      lighting = l;
      savedLightJson = JSON.stringify(l);
      engine.applyLighting(l);
      syncLightFields();
      lightingTouched = true;
      updateStatus();
      toast('已恢复随包光照');
    });
  });
  $('me-lp-default').addEventListener('click', () => {
    lighting = cloneLighting(LIGHT_PRESETS.noon);
    engine.applyLighting(lighting);
    syncLightFields();
    lightingTouched = true;
    toast('已恢复正午默认');
  });

  const CAM_PRESETS = {
    overview: { t: [0, 1.5, 0], r: 84, th: 0.62, ph: 0.95 },
    t: { t: [0, 2, -38], r: 24, th: 0.35, ph: 1.05 },
    ct: { t: [0, 2, 38], r: 24, th: -0.35, ph: 1.05 },
    mid: { t: [0, 2, 0], r: 30, th: 0.35, ph: 1.03 },
    a: { t: [44, 2, 16], r: 28, th: 0.85, ph: 1.02 },
    b: { t: [-44, 2, 16], r: 28, th: -0.85, ph: 1.02 }
  };
  function setCamPreset(id) {
    const c = CAM_PRESETS[id];
    if (!c) return;
    orbit.target.set(c.t[0], c.t[1], c.t[2]);
    orbit.radius = c.r;
    orbit.theta = c.th;
    orbit.phi = c.ph;
    applyCam();
  }
  ui.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cam]');
    if (b) setCamPreset(b.dataset.cam);
  });

  function showTab(name) {
    const light = name === 'light';
    $('me-map-tab').hidden = light;
    $('me-light-tab').hidden = !light;
    $('me-tab-map').classList.toggle('on', !light);
    $('me-tab-light').classList.toggle('on', light);
  }
  $('me-tab-map').addEventListener('click', () => showTab('map'));
  $('me-tab-light').addEventListener('click', () => showTab('light'));
  if (/[?&](?:tab=light|light=1)/.test(location.search)) showTab('light');
  syncLightFields();

  // 没有本机光照预览时，读取随包 assets/lighting.json；用户已经开始调时不覆盖。
  if (!loadStoredLighting()) {
    fetchStaticLighting().then((l) => {
      if (!l || lightingTouched) return;
      lighting = l;
      savedLightJson = JSON.stringify(l);
      engine.applyLighting(l);
      syncLightFields();
      updateStatus();
    }).catch(() => {});
  }

  function snapVal(v) {
    return Math.round(v / snap) * snap;
  }

  function boxOf(p) {
    return new THREE.Box3(
      new THREE.Vector3(p.x - p.w / 2, p.y - p.h / 2, p.z - p.d / 2),
      new THREE.Vector3(p.x + p.w / 2, p.y + p.h / 2, p.z + p.d / 2)
    );
  }

  function findById(id) {
    return map.placed[id] && map.placed[id].id === id
      ? map.placed[id]
      : map.placed.find((p) => p.id === id) || null;
  }

  function updateStatus(extra) {
    const moved = Object.keys(edits.moved || {}).length;
    const hidden = Object.keys(edits.hidden || {}).length;
    const added = edits.added ? edits.added.length : 0;
    const spawnEdits = ((edits.spawns && edits.spawns.player) ? 1 : 0) +
      Object.keys((edits.spawns && edits.spawns.bots) || {}).length +
      Object.keys(edits.waypoints || {}).length;
    const dirty = JSON.stringify(edits) !== savedJson;
    const lightDirty = JSON.stringify(lighting) !== savedLightJson;
    const info = engine.renderer.info.render;
    $('me-status').innerHTML =
      `盒体 ${map.placed.length} · 基础 ${baseCount} · 新增 ${added} · 改动 ${moved} · 删除 ${hidden} · 点位 ${spawnEdits}\n` +
      `draw ${info.calls} · tris ${(info.triangles / 1000).toFixed(1)}k` +
      (dirty ? ' · <span class="warn">地图未保存</span>' : ' · 地图已保存') +
      (lightDirty ? ' · <span class="warn">光照未保存</span>' : ' · 光照已保存') +
      (extra ? '\n' + extra : '');
  }

  function updateFieldState(p) {
    const on = !!p;
    for (const k of Object.keys(fields)) {
      fields[k].disabled = !on;
      if (on) fields[k].value = (+p[k]).toFixed(2);
    }
    $('me-sel').textContent = on
      ? `#${p.id} · ${p.tag || '无标签'} · ${p.kind}` + (p.id >= baseCount ? ' · 新增' : '')
      : '未选择';
    $('me-focus').disabled = !on;
    $('me-dup').disabled = !on;
    $('me-del').disabled = !on;
  }

  function select(id, focus) {
    const p = id == null ? null : findById(id);
    if (!p || p.hidden) {
      selectedId = null;
      selHelper.visible = false;
      ghost.visible = false;
      updateFieldState(null);
      return;
    }
    selectedId = id;
    selHelper.box.copy(boxOf(p));
    selHelper.visible = true;
    updateFieldState(p);
    if (focus) {
      orbit.target.set(p.x, p.y, p.z);
      orbit.radius = Math.max(9, Math.max(p.w, p.h, p.d) * 5.5);
      applyCam();
    }
  }

  function clearSelection() {
    select(null);
  }

  function pushHistory() {
    undoStack.push(JSON.stringify(edits));
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }

  function disposeMapRoot() {
    mapRoot.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    mapRoot.clear();
  }

  function rebuild(selectAfter) {
    const t0 = performance.now();
    ghost.visible = false;
    selHelper.visible = false;
    selectedId = null;
    disposeMapRoot();
    map = buildMap(mapRoot, { edits });
    baseCount = map.baseCount;
    buildMarkers();
    if (wireVisible) buildWire();
    if (selectAfter != null) select(selectAfter, false);
    else clearSelection();
    updateStatus(`重建 ${Math.round(performance.now() - t0)} ms`);
    markAuditDirty();
  }

  function upsertBase(id, patch) {
    const p = findById(id);
    if (!p) return;
    if (id >= baseCount) {
      const idx = id - baseCount;
      const a = edits.added[idx];
      if (!a) return;
      edits.added[idx] = Object.assign({}, a, patch);
    } else {
      edits.moved[id] = {
        x: p.x, y: p.y, z: p.z, w: p.w, h: p.h, d: p.d,
        ...patch
      };
    }
  }

  function commitSelected(patch) {
    if (selectedId == null) return;
    pushHistory();
    upsertBase(selectedId, patch);
    rebuild(selectedId);
  }

  function deleteSelected() {
    if (selectedId == null) return;
    const id = selectedId;
    pushHistory();
    if (id >= baseCount) edits.added.splice(id - baseCount, 1);
    else edits.hidden[id] = true;
    selectedId = null;
    rebuild(null);
    toast('已删除 #' + id);
  }

  function duplicateSelected() {
    if (selectedId == null) return;
    const p = findById(selectedId);
    if (!p) return;
    pushHistory();
    edits.added.push({
      kind: p.kind, tag: p.tag, color: p.color, repeat: p.repeat,
      x: p.x + snap, y: p.y, z: p.z,
      w: p.w, h: p.h, d: p.d,
      collide: p.collide
    });
    rebuild(baseCount + edits.added.length - 1);
    toast('已复制到新增层');
  }

  function addPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    const bounds = map.bounds;
    const x = snapVal(THREE.MathUtils.clamp(orbit.target.x, bounds.minX + 2, bounds.maxX - 2));
    const z = snapVal(THREE.MathUtils.clamp(orbit.target.z, bounds.minZ + 2, bounds.maxZ - 2));
    pushHistory();
    edits.added.push({
      kind: preset.kind, tag: preset.tag, repeat: preset.repeat,
      x, y: preset.h / 2, z,
      w: preset.w, h: preset.h, d: preset.d,
      collide: true
    });
    rebuild(baseCount + edits.added.length - 1);
    toast('已添加 ' + preset.label);
  }

  function applyFields() {
    if (selectedId == null) return;
    const p = findById(selectedId);
    if (!p) return;
    const v = {};
    for (const k of ['x', 'y', 'z', 'w', 'h', 'd']) {
      const n = Number(fields[k].value);
      if (!Number.isFinite(n)) { updateFieldState(p); return; }
      v[k] = (k === 'w' || k === 'h' || k === 'd') ? Math.max(0.05, n) : n;
    }
    commitSelected(v);
  }

  function refillFields() {
    const p = selectedId == null ? null : findById(selectedId);
    updateFieldState(p);
  }

  function markAuditDirty() {
    $('me-issues').innerHTML = '<div class="hint">改动后请重新审计。</div>';
  }

  function renderIssues(issues) {
    const el = $('me-issues');
    if (!issues.length) {
      el.innerHTML = '<div style="color:#7fd6a5">未发现明显问题</div>';
      return;
    }
    el.innerHTML = issues.slice(0, 40).map((it, i) =>
      `<div class="it" data-i="${i}"><span class="t">${it.type}</span> ${it.detail}` +
      `<div class="d">${it.x.toFixed(1)}, ${it.z.toFixed(1)}</div></div>`
    ).join('');
    el.querySelectorAll('.it').forEach((row) => {
      row.addEventListener('click', () => {
        const it = issues[parseInt(row.dataset.i, 10)];
        orbit.target.set(it.x, 2, it.z);
        orbit.radius = Math.max(14, orbit.radius * 0.6);
        applyCam();
      });
    });
  }

  function runAudit() {
    const t0 = performance.now();
    const issues = audit(map);
    window.__mapAuditResult = issues;
    renderIssues(issues);
    updateStatus(`审计 ${issues.length} 个问题 · ${Math.round(performance.now() - t0)} ms`);
    toast(issues.length ? `审计：${issues.length} 个问题` : '审计通过');
    return issues;
  }

  function buildWire() {
    if (wire) {
      engine.scene.remove(wire);
      wire.geometry.dispose();
      wire.material.dispose();
      wire = null;
    }
    const pos = [];
    for (const p of map.placed) {
      if (p.hidden || p.editable === false) continue;
      const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2;
      const y0 = p.y - p.h / 2, y1 = p.y + p.h / 2;
      const z0 = p.z - p.d / 2, z1 = p.z + p.d / 2;
      const v = [
        [x0, y0, z0], [x1, y0, z0], [x1, y0, z0], [x1, y0, z1],
        [x1, y0, z1], [x0, y0, z1], [x0, y0, z1], [x0, y0, z0],
        [x0, y1, z0], [x1, y1, z0], [x1, y1, z0], [x1, y1, z1],
        [x1, y1, z1], [x0, y1, z1], [x0, y1, z1], [x0, y1, z0],
        [x0, y0, z0], [x0, y1, z0], [x1, y0, z0], [x1, y1, z0],
        [x1, y0, z1], [x1, y1, z1], [x0, y0, z1], [x0, y1, z1]
      ];
      for (const q of v) pos.push(q[0], q[1], q[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wire = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: 0x6fe3ff, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false
    }));
    wire.renderOrder = 5;
    engine.scene.add(wire);
  }

  function download() {
    const data = Object.assign({}, edits, { baseCount, savedAt: new Date().toISOString() });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'map-edits.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data.baseCount != null && +data.baseCount !== baseCount) {
          toast('注意：baseCount 不一致，ID 可能错位');
        }
        pushHistory();
        edits = normalizeEdits(data);
        rebuild(null);
        toast('已导入 ' + countEdits(edits) + ' 项改动');
      } catch (err) {
        console.error(err);
        toast('导入失败：JSON 格式错误');
      }
    };
    reader.readAsText(file);
  }

  function resetView() {
    orbit.target.set(0, 1.5, 0);
    orbit.radius = 84;
    orbit.theta = 0.62;
    orbit.phi = 0.95;
    applyCam();
  }

  /* ---------------- 拾取 ---------------- */
  function setRay(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
    );
    raycaster.setFromCamera(ndc, engine.camera);
  }

  function pickMarker(clientX, clientY) {
    setRay(clientX, clientY);
    const hits = raycaster.intersectObjects(markerGroup.children, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.markerKind) o = o.parent;
    return o && o.userData.markerKind ? o : null;
  }

  function applyMarkerEdit(kind, index, x, z) {
    if (!edits.spawns) edits.spawns = {};
    if (kind === 'player') {
      edits.spawns.player = { x, z };
    } else if (kind === 'bot') {
      if (!edits.spawns.bots) edits.spawns.bots = {};
      edits.spawns.bots[index] = { x, z };
    } else {
      if (!edits.waypoints) edits.waypoints = {};
      edits.waypoints[index] = { x, z };
    }
  }

  function pick(clientX, clientY) {
    setRay(clientX, clientY);
    let best = null;
    let bestDist = Infinity;
    for (const p of map.placed) {
      if (p.hidden || p.editable === false) continue;
      boxA.min.set(p.x - p.w / 2, p.y - p.h / 2, p.z - p.d / 2);
      boxA.max.set(p.x + p.w / 2, p.y + p.h / 2, p.z + p.d / 2);
      if (raycaster.ray.intersectBox(boxA, hitPoint)) {
        const d = hitPoint.distanceToSquared(engine.camera.position);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
    }
    return best;
  }

  /* ---------------- 指针 / 相机 ---------------- */
  let drag = null;
  const lastPointer = { x: 0, y: 0 };

  function onPointerDown(e) {
    if (e.target !== canvas) return;
    canvas.focus();
    if (e.button === 2) {
      drag = { mode: 'pan', x: e.clientX, y: e.clientY, moved: 0 };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const mk = pickMarker(e.clientX, e.clientY);
    if (mk) {
      dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, mk.position.y, 0));
      const point = new THREE.Vector3();
      const onPlane = raycaster.ray.intersectPlane(dragPlane, point);
      drag = {
        mode: 'marker', marker: mk,
        kind: mk.userData.markerKind, index: mk.userData.markerIndex,
        offX: onPlane ? point.x - mk.position.x : 0,
        offZ: onPlane ? point.z - mk.position.z : 0,
        x: e.clientX, y: e.clientY, moved: 0
      };
      pushHistory();
      return;
    }
    const hit = pick(e.clientX, e.clientY);
    const p = selectedId == null ? null : findById(selectedId);
    if (p && hit && hit.id === selectedId) {
      dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(p.x, p.y, p.z));
      const point = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, point)) {
        drag = {
          mode: 'move', id: selectedId,
          offX: point.x - p.x, offZ: point.z - p.z,
          x: e.clientX, y: e.clientY, moved: 0, base: p
        };
        ghost.position.set(p.x, p.y, p.z);
        ghost.scale.set(p.w, p.h, p.d);
        ghost.visible = true;
        return;
      }
    }
    drag = { mode: 'orbit', x: e.clientX, y: e.clientY, moved: 0, hit };
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  }

  function onPointerMove(e) {
    if (!drag) {
      if (e.target === canvas) {
        const mk = pickMarker(e.clientX, e.clientY);
        if (mk) { canvas.style.cursor = 'move'; return; }
        const hit = pick(e.clientX, e.clientY);
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;

    if (drag.mode === 'marker') {
      setRay(e.clientX, e.clientY);
      if (raycaster.ray.intersectPlane(dragPlane, planePoint)) {
        const nx = snapVal(planePoint.x - drag.offX);
        const nz = snapVal(planePoint.z - drag.offZ);
        drag.marker.position.set(nx, 0.1, nz);
        applyMarkerEdit(drag.kind, drag.index, nx, nz);
        updateStatus('拖动点位 ' + nx.toFixed(1) + ', ' + nz.toFixed(1));
      }
      return;
    }
    if (drag.mode === 'orbit') {
      orbit.theta -= dx * 0.0055;
      orbit.phi = THREE.MathUtils.clamp(orbit.phi - dy * 0.0055, 0.12, 1.45);
      applyCam();
      return;
    }
    if (drag.mode === 'pan') {
      const scale = orbit.radius * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(engine.camera.matrixWorld, 0);
      right.y = 0;
      right.normalize();
      const fwd = new THREE.Vector3().subVectors(orbit.target, engine.camera.position);
      fwd.y = 0;
      fwd.normalize();
      orbit.target.addScaledVector(right, -dx * scale);
      orbit.target.addScaledVector(fwd, dy * scale);
      applyCam();
      return;
    }
    if (drag.mode === 'move') {
      setRay(e.clientX, e.clientY);
      if (raycaster.ray.intersectPlane(dragPlane, planePoint)) {
        const nx = snapVal(planePoint.x - drag.offX);
        const nz = snapVal(planePoint.z - drag.offZ);
        ghost.position.set(nx, drag.base.y, nz);
        fields.x.value = nx.toFixed(2);
        fields.z.value = nz.toFixed(2);
      }
    }
  }

  function onPointerUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    ghost.visible = false;
    if (d.mode === 'marker') {
      if (d.moved > 2) {
        rebuild(null);
        toast('点位已移动');
      }
      return;
    }
    if (d.mode === 'move') {
      if (d.moved > 3 && (Math.abs(ghost.position.x - d.base.x) > 0.001 || Math.abs(ghost.position.z - d.base.z) > 0.001)) {
        pushHistory();
        upsertBase(d.id, { x: ghost.position.x, y: d.base.y, z: ghost.position.z });
        rebuild(d.id);
        toast(`移动到 ${ghost.position.x.toFixed(1)}, ${ghost.position.z.toFixed(1)}`);
      }
      return;
    }
    if (d.mode === 'orbit' && d.moved < 4) {
      if (d.hit) select(d.hit.id);
      else clearSelection();
    }
  }

  function onContext(e) { e.preventDefault(); }
  function onWheel(e) {
    if (e.target !== canvas) return;
    e.preventDefault();
    orbit.radius = THREE.MathUtils.clamp(orbit.radius * Math.exp(e.deltaY * 0.0011), 8, 130);
    applyCam();
  }

  function onKey(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    if (k === '[' || k === ']') {
      if (selectedId == null) return;
      const p = findById(selectedId);
      if (!p) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : snap;
      commitSelected({ y: Math.max(0.05, p.y + (k === ']' ? step : -step)) });
      return;
    }
    if (k === 'Escape') { clearSelection(); return; }
    if (k === 'g' || k === 'G') { toggleGrid(); return; }
    if (k === 'w' || k === 'W') { toggleWire(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'd' || k === 'D')) { e.preventDefault(); duplicateSelected(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'c' || k === 'C')) {
      if (selectedId == null) return;
      const p = findById(selectedId);
      if (p) { copiedBox = { ...p }; toast('已复制盒体 #' + p.id); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (k === 'v' || k === 'V')) {
      if (!copiedBox) return;
      e.preventDefault();
      const p = copiedBox;
      pushHistory();
      edits.added.push({
        kind: p.kind, tag: p.tag, color: p.color, repeat: p.repeat,
        x: p.x + snap, y: p.y, z: p.z + snap,
        w: p.w, h: p.h, d: p.d, collide: p.collide
      });
      rebuild(baseCount + edits.added.length - 1);
      toast('已粘贴盒体');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
  }

  function toggleGrid(force) {
    const on = force == null ? !grid1.visible : force;
    grid1.visible = on;
    grid5.visible = on;
    boundsLine.visible = on;
    $('me-grid').classList.toggle('on', on);
  }

  function toggleWire(force) {
    wireVisible = force == null ? !wireVisible : force;
    if (wireVisible) buildWire();
    else if (wire) {
      engine.scene.remove(wire);
      wire.geometry.dispose();
      wire.material.dispose();
      wire = null;
    }
    $('me-wire').classList.toggle('on', wireVisible);
  }

  function undo() {
    if (!undoStack.length) { toast('没有可撤销的改动'); return; }
    redoStack.push(JSON.stringify(edits));
    edits = normalizeEdits(JSON.parse(undoStack.pop()));
    rebuild(null);
    toast('已撤销');
  }

  function redo() {
    if (!redoStack.length) { toast('没有可重做的改动'); return; }
    undoStack.push(JSON.stringify(edits));
    edits = normalizeEdits(JSON.parse(redoStack.pop()));
    rebuild(null);
    toast('已重做');
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);

  $('me-snap').addEventListener('change', (e) => { snap = Number(e.target.value) || 0.5; });
  $('me-focus').addEventListener('click', () => select(selectedId, true));
  $('me-dup').addEventListener('click', duplicateSelected);
  $('me-del').addEventListener('click', deleteSelected);
  $('me-add').addEventListener('click', () => addPreset(presetSel.value));
  $('me-grid').addEventListener('click', () => toggleGrid());
  $('me-wire').addEventListener('click', () => toggleWire());
  $('me-undo').addEventListener('click', undo);
  $('me-redo').addEventListener('click', redo);
  $('me-view').addEventListener('click', resetView);
  $('me-save').addEventListener('click', () => {
    if (saveStoredEdits(edits)) {
      savedJson = JSON.stringify(edits);
      updateStatus();
      toast('已保存到本机');
    } else {
      toast('保存失败');
    }
  });
  $('me-play').addEventListener('click', () => {
    saveStoredEdits(edits);
    savedJson = JSON.stringify(edits);
    window.open(location.pathname + '?autostart=1&mapEdits=1&dev=1', '_blank');
  });
  $('me-export').addEventListener('click', download);
  $('me-import-btn').addEventListener('click', () => $('me-import').click());
  $('me-import').addEventListener('change', (e) => {
    importFile(e.target.files && e.target.files[0]);
    e.target.value = '';
  });
  $('me-audit').addEventListener('click', runAudit);
  $('me-clear').addEventListener('click', () => {
    if (!confirm('清空本机所有地图改动？')) return;
    pushHistory();
    edits = emptyEdits();
    clearStoredEdits();
    savedJson = JSON.stringify(edits);
    rebuild(null);
    toast('已清空');
  });
  for (const k of Object.keys(fields)) {
    fields[k].addEventListener('change', applyFields);
  }

  /* ---------------- 循环 ---------------- */
  let last = performance.now();
  let statAt = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dt > 0) engine.render();
    if (now - statAt > 700) {
      statAt = now;
      updateStatus();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function onResize() { engine.resize(); }
  window.addEventListener('resize', onResize);

  updateStatus('左键在空白处旋转；点选盒体后可拖拽。改动不会影响正常对局。');
  markAuditDirty();

  // 没有本机预览时，载入随包发布的 assets/map-edits.json，保证工坊看到的就是玩家看到的版本。
  if (!countEdits(edits)) {
    fetchStaticEdits().then((staticEdits) => {
      if (!staticEdits || countEdits(edits)) return;
      edits = staticEdits;
      savedJson = JSON.stringify(edits);
      rebuild(null);
      updateStatus('已载入 assets/map-edits.json');
      toast('已载入随包编辑数据');
    }).catch(() => {});
  }

  // 供无头测试/脚本使用
  window.__mapEditor = {
    get map() { return map; },
    get edits() { return edits; },
    get baseCount() { return baseCount; },
    get selectedId() { return selectedId; },
    select, focus: (id) => select(id, true),
    add: addPreset, duplicate: duplicateSelected, remove: deleteSelected,
    undo, redo,
    markers: markerGroup,
    moveMarker: (kind, index, x, z) => {
      pushHistory();
      applyMarkerEdit(kind, index, x, z);
      rebuild(null);
    },
    move: (dx, dy, dz) => {
      if (selectedId == null) return;
      const p = findById(selectedId);
      if (!p) return;
      commitSelected({ x: p.x + (dx || 0), y: p.y + (dy || 0), z: p.z + (dz || 0) });
    },
    audit: runAudit,
    save: () => saveStoredEdits(edits),
    exportEdits: () => JSON.parse(JSON.stringify(edits)),
    setEdits: (d) => { edits = normalizeEdits(d); rebuild(null); },
    rebuild,
    orbit,
    engine,
    toggleGrid,
    toggleWire,
    updateStatus
  };
  console.info('[map-editor] ready, boxes=' + map.placed.length + ', base=' + baseCount);
}
