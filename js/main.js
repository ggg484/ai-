// 入口：第一件事必须是 ready()，不能等资源加载。
import { ready } from './platform/builda.js';
import { Game } from './game.js';
import { fetchStaticEdits, loadStoredEdits } from './world/map-edits.js';
import { fetchStaticLighting, loadStoredLighting } from './world/lighting.js';
import {
  loadWeaponRig, fetchStaticWeaponRig, loadCharRig, fetchStaticCharRig
} from './render/rig.js';

console.info('[boot] main module loaded');
ready();

const canvas = document.getElementById('game');
let game = null;

async function bootGame() {
  try {
    // 随包发布的地图/光照（工坊导出 → assets/*.json）；
    // ?mapEdits=1 / ?lightEdits=1 时改用本机工坊预览数据。
    const mapPreview = /[?&]mapEdits=1/.test(location.search);
    const lightPreview = /[?&]lightEdits=1/.test(location.search);
    const rigPreview = /[?&]rigEdits=1/.test(location.search);
    const [mapEdits, lighting, weaponRig, charRig] = await Promise.all([
      mapPreview ? Promise.resolve(loadStoredEdits()) : fetchStaticEdits(),
      lightPreview
        ? Promise.resolve(loadStoredLighting() || null).then((v) => v || fetchStaticLighting())
        : fetchStaticLighting(),
      rigPreview ? Promise.resolve(loadWeaponRig()) : fetchStaticWeaponRig(),
      rigPreview ? Promise.resolve(loadCharRig()) : fetchStaticCharRig()
    ]);
    window.__mapEdits = mapEdits;
    window.__lighting = lighting;
    window.__weaponRig = weaponRig;
    window.__charRig = charRig;
    game = new Game(canvas);
    console.info('[boot] game constructed');
    window.__game = game;
    if (/[?&]dev=1/.test(location.search)) {
      import('./dev/devtools.js')
        .then(({ installDevTools }) => installDevTools(game))
        .catch((err) => console.error('[dev] 加载失败', err));
    }
    game.init().then(() => console.info('[boot] game init done')).catch((err) => {
      console.error('[boot] init failed', err);
      const s = document.getElementById('boot-text');
      if (s) {
        s.textContent = '初始化失败：' + (err && err.message ? err.message : err);
        s.style.color = '#c94f45';
      }
    });
  } catch (err) {
    console.error('[boot] create failed', err);
    const s = document.getElementById('boot-text');
    if (s) {
      s.textContent = '当前环境不支持 WebGL2：' + (err && err.message ? err.message : err);
      s.style.color = '#c94f45';
    }
  }
}

if (/[?&]editor=1/.test(location.search)) {
  // 地图工坊：独立场景，不启动大厅/对局。
  import('./dev/map-editor.js')
    .then(({ startEditor }) => startEditor(canvas))
    .catch((err) => {
      console.error('[editor] 启动失败', err);
      const s = document.getElementById('boot-text');
      if (s) s.textContent = '地图工坊启动失败：' + (err && err.message ? err.message : err);
    });
} else if (/[?&]rig=1/.test(location.search)) {
  // 武器 / 人物模型工坊：独立场景，不启动大厅/对局。
  import('./dev/model-editor.js')
    .then(({ startModelEditor }) => startModelEditor(canvas))
    .catch((err) => {
      console.error('[rig] 启动失败', err);
      const s = document.getElementById('boot-text');
      if (s) s.textContent = '模型工坊启动失败：' + (err && err.message ? err.message : err);
    });
} else {
  bootGame();
}
