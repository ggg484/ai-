// 生成交付用截图：大厅 / 道具展台 / 对局 / 枪械检视。
// 零依赖：Node 内置 fetch + WebSocket 直连 CDP。
//   node tools/screenshots.mjs

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../scripts/serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = process.env.SHOT_DIR || join(ROOT, 'screenshots');
const CHROME = process.env.CHROME_PATH || '/root/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = join(process.env.HOME || '/root', '.cache', 'ms-playwright');
  if (existsSync(base)) {
    for (const d of readdirSync(base).sort().reverse()) {
      if (!d.startsWith('chromium-')) continue;
      const p = join(base, d, 'chrome-linux64', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return existsSync(CHROME) ? CHROME : null;
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.logs = [];
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        const text = (m.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' ');
        this.logs.push('[' + m.params.type + '] ' + text);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.logs.push('[exception] ' + (d.exception && d.exception.description ? d.exception.description : d.text));
      }
    });
  }
  static connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => res(new CDP(ws)));
      ws.addEventListener('error', () => rej(new Error('ws fail')));
    });
  }
  send(method, params) {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 90000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(200);
  }
  return null;
}

const SHOTS = [
  {
    file: '01-lobby-hall.png',
    url: '?quality=high&noadapt=1&crowd=220&far=140',
    ready: 'return !!(window.__game && window.__game.mode === "lobby" && window.__game.started)',
    action: 'window.__game.teleportTo(0, 0, 8, Math.PI); window.__game.lobbyUi.setInteract(null); return 1;',
    wait: 3500
  },
  {
    file: '02-props-wall.png',
    url: '?quality=high&shadows=0&noadapt=1&crowd=120&far=80',
    ready: 'return !!(window.__game && window.__game.mode === "lobby" && window.__game.started)',
    action: 'window.__game.teleportTo(12, 0, 14.4, Math.PI); window.__game.player.pitch = -0.2; window.__game.lobbyUi.setInteract(null); return 1;',
    postAction: 'window.__game.started = false; window.__game.viewmodel.root.visible = false; return 1;',
    wait: 3000
  },
  {
    file: '03-match-a-long.png',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1',
    ready: 'return !!(window.__game && window.__game.mode === "match" && window.__game.started)',
    action: 'window.__game.teleportTo(24, 0, -23, 0.08); window.__game.player.pitch = 0.03; return 1;',
    wait: 3000
  },
  {
    file: '04-ak-redline.png',
    url: '?photo=ak&skin=ak_redline&wear=0.236&seed=886&offset=0.71&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '05-m4-ashen.png',
    url: '?photo=m4&skin=m4_ashen&wear=0.102&seed=509&offset=0.52&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '06-awp-helix.png',
    url: '?photo=awp&skin=awp_helix&wear=0.028&seed=132&offset=0.18&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '07-knife-gilded.png',
    url: '?photo=knife&skin=knife_gilded&wear=0.028&seed=132&offset=0.18&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '08-c4-props.png',
    url: '?photo=c4&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '09-usp-ghost.png',
    url: '?photo=usp&skin=usp_ghost&wear=0.102&seed=509&offset=0.52&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '10-armor-vest.png',
    url: '?photo=armor&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '11-glock-neon.png',
    url: '?photo=glock&skin=glock_neon&wear=0.028&seed=132&offset=0.18&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '12-deagle-ember.png',
    url: '?photo=deagle&skin=deagle_ember&wear=0.102&seed=509&offset=0.52&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '13-mp9-carbon.png',
    url: '?photo=mp9&skin=mp9_carbon&wear=0.236&seed=886&offset=0.71&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '14-ak-bare.png',
    url: '?photo=ak&bare=1&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '15-m4-bare.png',
    url: '?photo=m4&bare=1&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '16-awp-bare.png',
    url: '?photo=awp&bare=1&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive)',
    wait: 1600
  },
  {
    file: '17-wall-check.png',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1',
    ready: 'return !!(window.__game && window.__game.mode === "match" && window.__game.started)',
    action: 'window.__game.teleportTo(25.5, 0, -10, -Math.PI / 2); window.__game.player.pitch = 0.05; return 1;',
    wait: 2500
  },
  {
    file: '18-b-tunnel.png',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1',
    ready: 'return !!(window.__game && window.__game.mode === "match" && window.__game.started)',
    action: 'window.__game.teleportTo(-26, 0, -23, 0); window.__game.player.pitch = 0.02; return 1;',
    wait: 2500
  },
  {
    file: '19-a-site.png',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1',
    ready: 'return !!(window.__game && window.__game.mode === "match" && window.__game.started)',
    action: 'window.__game.teleportTo(26, 0, 9, 0); window.__game.player.pitch = 0.02; return 1;',
    wait: 2500
  },
  {
    file: '20-mid.png',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1',
    ready: 'return !!(window.__game && window.__game.mode === "match" && window.__game.started)',
    action: 'window.__game.teleportTo(0, 0, -16, 0); window.__game.player.pitch = 0.02; return 1;',
    wait: 2500
  },
  {
    file: '60-oasis.png',
    url: '?map=oasis&autostart=1&quality=high&shadows=0&noadapt=1',
    ready: 'return !!(window.__game && window.__game.mode === "match" && window.__game.started)',
    action: 'const g = window.__game; g.teleportTo(0, 0, -30, 0); g.player.pitch = 0.02; return 1;',
    wait: 2200
  },
  {
    file: '61-oasis-a.png',
    url: '?map=oasis&autostart=1&quality=high&shadows=0&noadapt=1',
    ready: 'return !!(window.__game && window.__game.mode === "match" && window.__game.started)',
    action: 'const g = window.__game; g.teleportTo(30, 0.5, 12, 0); g.player.pitch = 0.04; return 1;',
    wait: 2200
  },
  {
    file: '62-oasis-b.png',
    url: '?map=oasis&autostart=1&quality=high&shadows=0&noadapt=1',
    ready: 'return !!(window.__game && window.__game.mode === "match" && window.__game.started)',
    action: 'const g = window.__game; g.teleportTo(-30, 0.5, 12, 0); g.player.pitch = 0.04; return 1;',
    wait: 2200
  },
  {
    file: '63-oasis-overview.png',
    url: '?map=oasis&autostart=1&quality=high&shadows=0&noadapt=1&dev=1',
    ready: 'return !!(window.__devTools && window.__game && window.__game.mode === "match" && window.__game.started)',
    action: 'window.__devTools.setCam({ x: 0, y: 58, z: -8, pitch: -1.25, yaw: 0, fov: 70 }); return 1;',
    wait: 2200
  },
  {
    file: '64-oasis-bots.png',
    url: '?map=oasis&autostart=1&quality=high&shadows=0&noadapt=1',
    ready: 'return !!(window.__game && window.__game.mode === "match" && window.__game.started)',
    action: `
      const g = window.__game;
      if (g.mapId !== 'oasis' || g.bots.length !== 9) throw new Error('oasis init');
      if (!g.map.stats || g.map.stats.covers < 30 || g.map.stats.waypoints < 55 || g.map.stats.callouts < 18) throw new Error('oasis depth');
      if (Math.abs(g.player.position.z + 36) > 1 || Math.abs(g.player.position.x) > 1) throw new Error('spawn');
      const before = g.bots.map((b) => ({ x: b.pos.x, z: b.pos.z }));
      g.round.phase = 'live';
      for (let i = 0; i < 180; i++) g.simulate(1 / 64);
      const moved = g.bots.filter((b, i) => Math.hypot(b.pos.x - before[i].x, b.pos.z - before[i].z) > 0.5).length;
      if (moved < 3) throw new Error('bots stuck: ' + moved);
      return 1;`,
    wait: 1500
  },
  {
    file: '21-lobby-crowd.png',
    url: '?quality=high&noadapt=1&crowd=220&far=180',
    ready: 'return !!(window.__game && window.__game.mode === "lobby" && window.__game.started)',
    action: 'window.__game.teleportTo(0, 0, 14, Math.PI); window.__game.player.pitch = -0.05; return 1;',
    wait: 2500
  }
];

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('No Chrome'); process.exit(2); }
  mkdirSync(OUT, { recursive: true });
  const { server, url } = await startServer({ root: ROOT, port: 0 });
  const profile = mkdtempSync(join(tmpdir(), 'shots-'));
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage',
    '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--mute-audio', '--window-size=1280,720', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  let cdp = null;
  const cleanup = () => {
    if (cdp) cdp.close();
    try { child.kill('SIGKILL'); } catch (e) {}
    try { server.close(); } catch (e) {}
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  };
  try {
    const pf = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 120 && !existsSync(pf); i++) await sleep(100);
    if (!existsSync(pf)) throw new Error('chrome not up: ' + stderr.slice(-400));
    const port = readFileSync(pf, 'utf8').trim().split('\n')[0];
    const list = await fetch('http://127.0.0.1:' + port + '/json/list').then((r) => r.json());
    const page = list.find((t) => t.type === 'page');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 720, deviceScaleFactor: 1, mobile: false
    });

    const filter = process.env.SHOT_FILTER || '';
    const filters = filter.split(',').map((s) => s.trim()).filter(Boolean);
    for (const shot of SHOTS) {
      if (filters.length && !filters.some((f) => shot.file.indexOf(f) >= 0)) continue;
      console.log('[shots] ' + shot.file);
      await cdp.send('Page.navigate', { url: url + shot.url });
      const ok = await waitFor(() => cdp.eval(shot.ready), 30000);
      if (!ok) {
        console.error('[shots]   ready failed; logs:', cdp.logs.slice(-6).join(' | '));
        continue;
      }
      await sleep(shot.wait || 1500);
      if (shot.action) await cdp.eval(shot.action);
      await sleep(900);
      if (shot.postAction) await cdp.eval(shot.postAction).catch(() => null);
      await sleep(500);
      await cdp.eval('window.requestAnimationFrame = function(){ return 0; }; 1');
      await sleep(300);
      const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, shot.file), Buffer.from(png.data, 'base64'));
      const info = await cdp.eval('const i = window.__engine ? window.__engine.renderer.info.render : null; return i ? { calls: i.calls, tris: i.triangles } : null;').catch(() => null);
      console.log('[shots]   saved' + (info ? ' ' + JSON.stringify(info) : ''));
    }
    console.log('[shots] done -> ' + OUT);
    cleanup();
  } catch (e) {
    console.error('[shots] FAIL', e.message);
    if (cdp) console.error(cdp.logs.slice(-12).join('\n'));
    cleanup();
    process.exit(1);
  }
}

main();
