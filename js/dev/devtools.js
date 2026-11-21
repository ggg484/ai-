// 开发者地图审计工具。
// 只在 ?dev=1 时由 main.js 动态加载，普通玩家不会下载这个模块。
// 功能：碰撞盒可视化、悬浮/穿模/越界审计、传送、俯视、自由飞、线框。

import * as THREE from '../../vendor/three.module.js';

const SUSPENDED = new Set([
  'trim', 'cable', 'pipe', 'sign', 'lamp', 'fan', 'window', 'balcony',
  'awning', 'canopy', 'arch', 'palm', 'leaf', 'dome', 'tower', 'rail', 'light'
]);
const PROP_TAGS = new Set(['cover', 'container', 'crate', 'barrel', 'pallet', 'machine', 'platform']);

function boxOf(p) {
  return {
    minX: p.x - p.w / 2, maxX: p.x + p.w / 2,
    minY: p.y - p.h / 2, maxY: p.y + p.h / 2,
    minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2
  };
}

function overlapVolume(a, b) {
  const dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const dy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const dz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (dx <= 0.001 || dy <= 0.001 || dz <= 0.001) return 0;
  return dx * dy * dz;
}

function volumeOf(a) {
  return Math.max(0.0001, (a.maxX - a.minX) * (a.maxY - a.minY) * (a.maxZ - a.minZ));
}

export function audit(map) {
  const list = (map.placed || []).filter((p) => !p.hidden);
  const issues = [];
  const bounds = map.bounds || { minX: -36, maxX: 36, minZ: -32, maxZ: 32 };
  const boxes = list.map((p) => ({ p, b: boxOf(p) }));

  for (const { p, b } of boxes) {
    if (PROP_TAGS.has(p.tag) &&
        (b.minX < bounds.minX - 0.5 || b.maxX > bounds.maxX + 0.5 ||
         b.minZ < bounds.minZ - 0.5 || b.maxZ > bounds.maxZ + 0.5)) {
      issues.push({
        type: '越界', x: p.x, y: p.y, z: p.z,
        detail: (p.tag || p.kind) + ' 超出地图边界'
      });
    }

    if (PROP_TAGS.has(p.tag) && p.collide && p.tag !== 'machine' && b.minY > 0.08) {
      let supported = false;
      for (const o of boxes) {
        if (o.b.maxX <= b.minX + 0.02 || o.b.minX >= b.maxX - 0.02 ||
            o.b.maxZ <= b.minZ + 0.02 || o.b.minZ >= b.maxZ - 0.02) continue;
        if (Math.abs(o.b.maxY - b.minY) <= 0.14) { supported = true; break; }
      }
      if (!supported) {
        issues.push({
          type: '悬浮', x: p.x, y: b.minY, z: p.z,
          detail: (p.tag || p.kind) + ' 底部 y=' + b.minY.toFixed(2) + ' 无支撑'
        });
      }
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    const A = boxes[i];
    if (!A.p.collide) continue;
    if (!PROP_TAGS.has(A.p.tag)) continue;
    for (let j = i + 1; j < boxes.length; j++) {
      if (i === j) continue;
      const B = boxes[j];
      if (!B.p.collide) continue;
      const v = overlapVolume(A.b, B.b);
      if (v <= 0.02) continue;
      const ratio = v / Math.min(volumeOf(A.b), volumeOf(B.b));
      if (ratio < 0.42) continue;
      if (A.p.tag === B.p.tag && A.p.tag === 'cover' && A.p.w === B.p.w) continue;
      issues.push({
        type: ratio > 0.92 ? '完全嵌入' : '穿模',
        x: (A.p.x + B.p.x) / 2, y: Math.max(A.b.minY, B.b.minY) + 0.4, z: (A.p.z + B.p.z) / 2,
        detail: (A.p.tag || A.p.kind) + ' × ' + (B.p.tag || B.p.kind) +
          ' 重叠 ' + Math.round(ratio * 100) + '%'
      });
    }
  }

  // 窗户必须贴在外立面上；门前方 0.8m 内不能被掩体堵住。
  const solids = boxes.filter((o) => o.p.h > 1.2 && o.p.h < 30 && o.p.tag !== 'window' && o.p.tag !== 'door');
  for (const { p, b } of boxes) {
    if (p.tag === 'window') {
      const xFace = p.w <= 0.2 && p.d >= 0.3;
      const zFace = p.d <= 0.2 && p.w >= 0.3;
      let attached = false;
      for (const s of solids) {
        const yOver = Math.min(b.maxY, s.b.maxY) - Math.max(b.minY, s.b.minY) > 0.05;
        if (!yOver) continue;
        if (xFace) {
          const nearX = p.x > s.b.minX - 0.45 && p.x < s.b.maxX + 0.45;
          const zOver = Math.min(b.maxZ, s.b.maxZ) - Math.max(b.minZ, s.b.minZ) > 0.1;
          if (nearX && zOver) { attached = true; break; }
        } else if (zFace) {
          const nearZ = p.z > s.b.minZ - 0.45 && p.z < s.b.maxZ + 0.45;
          const xOver = Math.min(b.maxX, s.b.maxX) - Math.max(b.minX, s.b.minX) > 0.1;
          if (nearZ && xOver) { attached = true; break; }
        }
      }
      if (!attached) {
        issues.push({ type: '窗户离墙', x: p.x, y: p.y, z: p.z, detail: '窗户未贴在任何立面' });
      }
    }
    if (p.tag === 'door') {
      const dir = p.x > 0 ? 1 : -1;
      const px = p.x + dir * 0.8;
      const hit = map.world.overlaps(px - 0.2, 0.2, p.z - 0.8, px + 0.2, 1.8, p.z + 0.8, 'ground');
      if (hit && hit.tag !== 'door' && hit.tag !== 'ground') {
        issues.push({ type: '门被挡', x: p.x, y: 1.1, z: p.z, detail: '门前与 ' + (hit.tag || 'collider') + ' 重叠' });
      }
    }
  }

  const checkPoint = (label, x, z, yaw) => {
    const hit = map.world.overlaps(x - 0.36, 0.08, z - 0.36, x + 0.36, 1.72, z + 0.36, 'ground');
    if (hit && hit.tag !== 'platform') {
      issues.push({ type: '点位卡墙', x, y: 0.9, z, detail: label + ' 与 ' + (hit.tag || 'collider') + ' 重叠' });
    }
  };
  checkPoint('玩家出生点', map.spawns.player.x, map.spawns.player.z);
  map.spawns.bots.forEach((s, i) => checkPoint('Bot 出生点 ' + (i + 1), s.x, s.z));
  (map.waypoints || []).forEach((w, i) => checkPoint('导航点 ' + (i + 1), w.x, w.z));

  // 去重：同一位置同一类型只留一条
  const seen = new Set();
  return issues.filter((it) => {
    const k = it.type + '|' + it.detail + '|' + Math.round(it.x * 2) + ',' + Math.round(it.z * 2);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function installDevTools(game) {
  if (window.__devTools) return window.__devTools;
  const root = document.createElement('div');
  root.id = 'dev-tools';
  root.innerHTML = `
    <style>
      #dev-tools{position:fixed;top:8px;right:8px;width:310px;max-height:92vh;overflow:auto;z-index:99999;
        background:rgba(12,14,15,.94);color:#d8e0dc;font:11px/1.55 ui-monospace,Menlo,monospace;
        border:1px solid #3c4a44;border-radius:6px;padding:8px;box-shadow:0 8px 30px #000a}
      #dev-tools h3{margin:0 0 6px;font-size:12px;color:#8fd6b4;letter-spacing:.08em}
      #dev-tools .row{display:flex;flex-wrap:wrap;gap:4px;margin:5px 0}
      #dev-tools button{background:#1d2622;color:#cfe3d8;border:1px solid #3e5449;border-radius:3px;
        padding:3px 6px;cursor:pointer;font:inherit}
      #dev-tools button:hover{background:#2a3a32}
      #dev-tools button.on{background:#2f6b4f;border-color:#58a97f;color:#fff}
      #dev-tools select{background:#1d2622;color:#cfe3d8;border:1px solid #3e5449;border-radius:3px;
        padding:2px;font:inherit;max-width:100%}
      #dev-stats{color:#9fb3a9;white-space:pre-line;border-bottom:1px solid #2b3832;padding-bottom:5px;margin-bottom:5px}
      #dev-report{max-height:40vh;overflow:auto;border-top:1px solid #2b3832;padding-top:5px}
      #dev-report .it{padding:3px 4px;border-bottom:1px solid #1f2a25;cursor:pointer}
      #dev-report .it:hover{background:#22302a}
      #dev-report .t{color:#e4a55e}
      #dev-report .d{color:#8fa69b}
      #dev-tools .hint{color:#6f857b;font-size:10px}
    </style>
    <h3>DEV · 地图审计</h3>
    <div id="dev-stats">等待游戏启动…</div>
    <div class="row">
      <button id="dev-audit">重跑审计</button>
      <button id="dev-collide">碰撞盒</button>
      <button id="dev-grid">网格</button>
      <button id="dev-wire">线框</button>
    </div>
    <div class="row">
      <button id="dev-top">俯视</button>
      <button id="dev-free">自由飞</button>
      <button id="dev-match">进入对局</button>
      <button id="dev-editor">地图工坊</button>
      <button id="dev-rig">模型工坊</button>
      <button id="dev-cam">复制坐标</button>
    </div>
    <div class="row">
      <select id="dev-tp-select"></select>
      <button id="dev-tp">传送</button>
    </div>
    <div class="hint">自由飞：WASD 移动 / R F 升降 / Q E 转向 / Z X 俯仰 / Shift 加速</div>
    <div class="hint">P：准星射线检查碰撞体（结果写控制台 + 面板）</div>
    <div id="dev-report">审计尚未运行</div>
  `;
  document.body.appendChild(root);

  const $ = (id) => root.querySelector('#' + id);
  const statsEl = $('dev-stats');
  const reportEl = $('dev-report');
  const tpSelect = $('dev-tp-select');

  const state = {
    colliders: null, grid: null, issues: null, marker: null,
    wire: false, free: false, top: false,
    keys: new Set(), yaw: 0, pitch: 0, pos: new THREE.Vector3(0, 2, 0), lastInspect: ''
  };

  function map() { return game.map; }
  function inMatch() { return game.mode === 'match'; }

  function ensureColliders() {
    if (state.colliders) return state.colliders;
    const colliders = game.map.world.colliders;
    const pos = [], col = [];
    const palette = {
      wall: [1, .34, .28], ground: [.32, .36, .34], cover: [.34, .9, .55],
      platform: [.4, .7, 1], trim: [.85, .75, .35], '': [.55, .75, .95]
    };
    const push = (x1, y1, z1, x2, y2, z2, c) => {
      pos.push(x1, y1, z1, x2, y2, z2);
      col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
    };
    for (const c of colliders) {
      const p = palette[c.tag] || palette[''];
      const { minX, minY, minZ, maxX, maxY, maxZ } = c;
      for (const y of [minY, maxY]) {
        push(minX, y, minZ, maxX, y, minZ, p);
        push(maxX, y, minZ, maxX, y, maxZ, p);
        push(maxX, y, maxZ, minX, y, maxZ, p);
        push(minX, y, maxZ, minX, y, minZ, p);
      }
      push(minX, minY, minZ, minX, maxY, minZ, p);
      push(maxX, minY, minZ, maxX, maxY, minZ, p);
      push(maxX, minY, maxZ, maxX, maxY, maxZ, p);
      push(minX, minY, maxZ, minX, maxY, maxZ, p);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, depthTest: false, transparent: true, opacity: 0.85
    }));
    mesh.name = 'dev-colliders';
    mesh.renderOrder = 9999;
    mesh.visible = false;
    game.scene.add(mesh);
    state.colliders = mesh;
    return mesh;
  }

  function ensureGrid() {
    if (state.grid) return state.grid;
    const g = new THREE.Group();
    g.name = 'dev-grid';
    const grid = new THREE.GridHelper(72, 36, 0x4d6b5b, 0x2b3a32);
    grid.position.y = 0.03;
    g.add(grid);
    const axes = new THREE.AxesHelper(4);
    axes.position.set(0, 0.06, 0);
    g.add(axes);
    g.visible = false;
    game.scene.add(g);
    state.grid = g;
    return g;
  }

  function issuePoints(issues) {
    if (state.issues) {
      game.scene.remove(state.issues);
      state.issues.geometry.dispose();
      state.issues.material.dispose();
      state.issues = null;
    }
    if (!issues.length) return;
    const pos = [], col = [];
    for (const it of issues) {
      pos.push(it.x, it.y, it.z);
      if (it.type === '越界') col.push(1, .2, .2);
      else if (it.type === '悬浮') col.push(1, .8, .2);
      else if (it.type === '点位卡墙') col.push(.3, .7, 1);
      else col.push(1, .35, .9);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.65, vertexColors: true, depthTest: false, sizeAttenuation: true
    }));
    pts.name = 'dev-issues';
    pts.renderOrder = 10000;
    game.scene.add(pts);
    state.issues = pts;
  }

  function renderReport(issues) {
    if (!issues.length) {
      reportEl.innerHTML = '<div style="color:#7fd6a5">未发现明显问题</div>';
      return;
    }
    const counts = {};
    for (const it of issues) counts[it.type] = (counts[it.type] || 0) + 1;
    reportEl.innerHTML = '<div style="color:#9fb3a9;margin-bottom:4px">' +
      Object.entries(counts).map(([k, v]) => k + ' ' + v).join(' · ') + '</div>' +
      issues.map((it, i) =>
        '<div class="it" data-i="' + i + '"><span class="t">' + it.type + '</span> ' +
        it.detail + '<div class="d">' + it.x.toFixed(1) + ', ' + it.z.toFixed(1) + '</div></div>'
      ).join('');
    reportEl.querySelectorAll('.it').forEach((el) => {
      el.addEventListener('click', () => {
        const it = issues[parseInt(el.dataset.i, 10)];
        goto(it.x, it.z);
      });
    });
  }

  function runAudit() {
    const issues = audit(map());
    renderReport(issues);
    issuePoints(issues);
    window.__devAuditResult = issues;
    console.log('[dev-audit] ' + JSON.stringify(issues));
    return issues;
  }

  function goto(x, z, yaw) {
    if (game.mode !== 'match') game.startMatch('classic');
    game.teleportTo(x, 0, z, yaw == null ? 0 : yaw);
    if (state.free) toggleFree(false);
    if (state.top) toggleTop(false);
  }

  function toggleColliders(force) {
    const m = ensureColliders();
    m.visible = force == null ? !m.visible : force;
    $('dev-collide').classList.toggle('on', m.visible);
  }

  function toggleGrid(force) {
    const g = ensureGrid();
    g.visible = force == null ? !g.visible : force;
    $('dev-grid').classList.toggle('on', g.visible);
  }

  function toggleWire(force) {
    const on = force == null ? !state.wire : force;
    state.wire = on;
    game.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData._devWire) o.userData._devWire = o.material;
      const mat = o.userData._devWire;
      if (Array.isArray(mat)) return;
      mat.wireframe = on;
    });
    $('dev-wire').classList.toggle('on', on);
  }

  function toggleTop(force) {
    const on = force == null ? !state.top : force;
    state.top = on;
    game.debugTop = on;
    if (on && state.free) toggleFree(false);
    $('dev-top').classList.toggle('on', on);
  }

  function toggleFree(force) {
    const on = force == null ? !state.free : force;
    state.free = on;
    if (on) {
      if (state.top) toggleTop(false);
      state.pos.copy(game.engine.camera.position);
      state.yaw = game.engine.camera.rotation.y;
      state.pitch = game.engine.camera.rotation.x;
      game._devCam = { pos: state.pos, yaw: state.yaw, pitch: state.pitch, fov: 70 };
      game._devFreecam = true;
      game.input.setEnabled(false);
    } else {
      game._devFreecam = false;
      game._devCam = null;
      game.input.setEnabled(true);
    }
    $('dev-free').classList.toggle('on', on);
  }

  function inspect() {
    const cam = game.engine.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const hit = game.map.world.raycast(cam.position.x, cam.position.y, cam.position.z,
      dir.x, dir.y, dir.z, 200, 'ground');
    if (!hit) {
      state.lastInspect = 'P: 未命中';
      return null;
    }
    if (state.marker) {
      game.scene.remove(state.marker);
      state.marker.geometry.dispose();
      state.marker.material.dispose();
    }
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4fd8, depthTest: false })
    );
    m.position.set(hit.x, hit.y, hit.z);
    m.renderOrder = 10001;
    game.scene.add(m);
    state.marker = m;
    const text = 'P: ' + (hit.tag || 'collider') + ' @ ' +
      hit.x.toFixed(2) + ', ' + hit.y.toFixed(2) + ', ' + hit.z.toFixed(2) +
      '  n=' + [hit.nx, hit.ny, hit.nz].map((v) => v.toFixed(0)).join(',');
    console.log('[dev-inspect] ' + text);
    state.lastInspect = text;
    return hit;
  }

  function setCam(spec) {
    if (!spec) {
      if (state.free) toggleFree(false);
      return false;
    }
    const s = spec;
    if (state.top) toggleTop(false);
    state.free = true;
    state.pos.set(s.x || 0, s.y || 2, s.z || 0);
    state.yaw = s.yaw || 0;
    state.pitch = s.pitch || 0;
    game._devCam = { pos: state.pos, yaw: state.yaw, pitch: state.pitch, fov: s.fov || 55 };
    game._devFreecam = true;
    game.input.setEnabled(false);
    $('dev-free').classList.add('on');
    return true;
  }

  function refreshStats() {
    const p = window.__perf || {};
    const pos = game.player.position;
    statsEl.textContent =
      'mode ' + game.mode + '  ' + (p.fps || 0) + ' fps\n' +
      'calls ' + (p.calls || 0) + '  tris ' + ((p.triangles || 0) / 1000).toFixed(1) + 'k\n' +
      'pos ' + pos.x.toFixed(1) + ', ' + pos.y.toFixed(1) + ', ' + pos.z.toFixed(1) +
      (state.free ? '  FREE' : '') +
      (state.lastInspect ? '\n' + state.lastInspect : '');
  }

  function buildTeleports() {
    const m = map();
    const opts = [];
    for (const [k, v] of Object.entries(m.callouts || {})) opts.push([k, v.x, v.z, 0]);
    (m.waypoints || []).forEach((w, i) => opts.push(['waypoint ' + (i + 1), w.x, w.z, 0]));
    (m.spawns.bots || []).forEach((s, i) => opts.push(['bot spawn ' + (i + 1), s.x, s.z, s.yaw || 0]));
    opts.push(['T spawn', m.spawns.player.x, m.spawns.player.z, 0]);
    for (const [k, v] of Object.entries(m.sites || {})) opts.push(['site ' + k, v.x, v.z, 0]);
    tpSelect.innerHTML = opts.map((o, i) =>
      '<option value="' + i + '">' + o[0] + '</option>'
    ).join('');
    state.tp = opts;
  }

  $('dev-audit').addEventListener('click', runAudit);
  $('dev-collide').addEventListener('click', () => toggleColliders());
  $('dev-grid').addEventListener('click', () => toggleGrid());
  $('dev-wire').addEventListener('click', () => toggleWire());
  $('dev-top').addEventListener('click', () => toggleTop());
  $('dev-free').addEventListener('click', () => toggleFree());
  $('dev-match').addEventListener('click', () => {
    if (game.mode !== 'match') game.startMatch('classic');
  });
  $('dev-editor').addEventListener('click', () => {
    window.open(location.pathname + '?editor=1', '_blank');
  });
  $('dev-rig').addEventListener('click', () => {
    window.open(location.pathname + '?rig=1', '_blank');
  });
  $('dev-cam').addEventListener('click', () => {
    const c = game.engine.camera.position;
    const s = c.x.toFixed(2) + ',' + c.y.toFixed(2) + ',' + c.z.toFixed(2);
    navigator.clipboard && navigator.clipboard.writeText(s).catch(() => {});
    console.log('[dev-cam] ' + s);
  });
  $('dev-tp').addEventListener('click', () => {
    const o = (state.tp || [])[parseInt(tpSelect.value, 10)];
    if (o) goto(o[1], o[2], o[3]);
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' && !state.free) inspect();
    if (!state.free) return;
    state.keys.add(e.code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyZ', 'KeyX', 'ShiftLeft'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.code));
  window.addEventListener('blur', () => state.keys.clear());

  let last = performance.now();
  function tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.free && game._devCam) {
      const k = state.keys;
      const speed = (k.has('ShiftLeft') ? 30 : 12) * dt;
      const f = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
      const r = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
      const move = new THREE.Vector3();
      if (k.has('KeyW')) move.add(f);
      if (k.has('KeyS')) move.sub(f);
      if (k.has('KeyD')) move.add(r);
      if (k.has('KeyA')) move.sub(r);
      if (k.has('KeyR')) move.y += 1;
      if (k.has('KeyF')) move.y -= 1;
      if (move.lengthSq()) {
        move.normalize().multiplyScalar(speed);
        state.pos.add(move);
      }
      if (k.has('KeyQ')) state.yaw += dt * 1.6;
      if (k.has('KeyE')) state.yaw -= dt * 1.6;
      if (k.has('KeyZ')) state.pitch = Math.max(-1.5, state.pitch + dt * 1.2);
      if (k.has('KeyX')) state.pitch = Math.min(1.5, state.pitch - dt * 1.2);
      game._devCam.yaw = state.yaw;
      game._devCam.pitch = state.pitch;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  setInterval(refreshStats, 250);

  const api = {
    audit: runAudit,
    goto,
    setCam,
    colliders: toggleColliders,
    wire: toggleWire,
    free: toggleFree,
    top: toggleTop,
    get result() { return window.__devAuditResult || []; }
  };
  window.__devTools = api;
  window.__devAudit = runAudit;

  // 等地图就绪后自动跑一次审计
  let tries = 0;
  const boot = setInterval(() => {
    tries++;
    if (game.map && game.map.placed && game.map.placed.length) {
      clearInterval(boot);
      buildTeleports();
      runAudit();
    } else if (tries > 100) {
      clearInterval(boot);
    }
  }, 200);

  console.info('[dev] 地图审计工具已加载');
  return api;
}
