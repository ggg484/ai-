// 入口：第一件事必须是 ready()，不能等资源加载。
import { ready } from './platform/builda.js';
import { Game } from './game.js';

console.info('[boot] main module loaded');
ready();

const canvas = document.getElementById('game');
let game = null;

try {
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
