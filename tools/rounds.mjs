// 迭代轮次工具：多视口截图 + 量化测量 + 报错统计。
// 用法：
//   ROUND=r1 SHOT_DIR=/workspace/screenshots/round-r1 node tools/rounds.mjs
//   SHOT_VP=desktop|mobile|both   SHOT_FILTER=combat,unit
// 视口：desktop = 1920x1080 @1x，mobile = 390x844 @2x（Android UA + 触摸）。
// 依赖：仅 Node 内置模块 + ImageMagick（可选，用于锐度评分）。

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../scripts/serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ROUND = process.env.ROUND || 'r0';
const OUT = process.env.SHOT_DIR || join('/workspace/screenshots', 'round-' + ROUND);
const CHROME = process.env.CHROME_PATH || '/root/.cache/puppeteer/chrome-headless-shell/linux-155.0.8059.39/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, dsf: 1, mobile: false },
  mobile: { width: 390, height: 844, dsf: 2, mobile: true }
};

class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map();
    this.logs = []; this.exceptions = []; this.failed = [];
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        this.logs.push('[' + m.params.type + '] ' + (m.params.args || [])
          .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.exceptions.push((d.exception && d.exception.description) || d.text);
      }
      if (m.method === 'Network.loadingFailed') this.failed.push(m.params.errorText);
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
        this.failed.push(m.params.response.status + ' ' + m.params.response.url);
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

/** 用 ImageMagick 估算锐度：灰度 Laplacian 均值 ×1000（越大越锐）。 */
function sharpness(file) {
  try {
    const out = execFileSync('convert', [file, '-colorspace', 'Gray', '-define',
      'convolve:Scale=3!', '-morphology', 'Convolve', 'Laplacian:0', '-format', '%[fx:mean]', 'info:'],
    { encoding: 'utf8' });
    return Math.round(parseFloat(out) * 10000);
  } catch (e) {
    return null;
  }
}

const DEV = '&dev=1';

const SHOTS = [
  {
    id: 'map-panorama', group: 'map',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1' + DEV,
    ready: 'return !!(window.__devTools && window.__game.mode === "match" && window.__game.started);',
    action: 'window.__devTools.setCam({x:0,y:44,z:-62,yaw:Math.PI,pitch:-0.46,fov:64}); return 1;',
    wait: 1800
  },
  {
    id: 'site-a', group: 'map',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1' + DEV,
    ready: 'return !!(window.__devTools && window.__game.mode === "match" && window.__game.started);',
    action: 'window.__devTools.setCam({x:26,y:2.3,z:5,yaw:Math.PI,pitch:-0.02,fov:72}); return 1;',
    wait: 1400
  },
  {
    id: 'site-b', group: 'map',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1' + DEV,
    ready: 'return !!(window.__devTools && window.__game.mode === "match" && window.__game.started);',
    action: 'window.__devTools.setCam({x:-24,y:2.3,z:1,yaw:Math.PI,pitch:-0.02,fov:72}); return 1;',
    wait: 1400
  },
  {
    id: 'mid', group: 'map',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1' + DEV,
    ready: 'return !!(window.__devTools && window.__game.mode === "match" && window.__game.started);',
    action: 'window.__devTools.setCam({x:0,y:2.3,z:-19,yaw:Math.PI,pitch:0,fov:72}); return 1;',
    wait: 1400
  },
  {
    id: 'unit-closeup', group: 'unit',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1' + DEV,
    ready: 'return !!(window.__devTools && window.__game.bots && window.__game.bots.length);',
    action: `
      const g = window.__game, b = g.bots[0], p = b.pos;
      const cx = p.x + 2.1, cz = p.z + 2.1;
      const yaw = Math.atan2(-(p.x - cx), -(p.z - cz));
      window.__devTools.setCam({x:cx,y:1.75,z:cz,yaw:yaw,pitch:-0.12,fov:38});
      return 1;`,
    wait: 1500
  },
  {
    id: 'unit-duo', group: 'unit',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1' + DEV,
    ready: 'return !!(window.__devTools && window.__game.bots && window.__game.bots.length > 1);',
    action: `
      const g = window.__game, b = g.bots[1], p = b.pos;
      const cx = p.x + 1.4, cz = p.z + 3.4;
      const yaw = Math.atan2(-(p.x - cx), -(p.z - cz));
      window.__devTools.setCam({x:cx,y:1.9,z:cz,yaw:yaw,pitch:-0.10,fov:46});
      return 1;`,
    wait: 1500
  },
  {
    id: 'weapon-ak', group: 'weapon',
    url: '?photo=ak&bare=1&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive);',
    wait: 1600
  },
  {
    id: 'weapon-m4', group: 'weapon',
    url: '?photo=m4&bare=1&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive);',
    wait: 1600
  },
  {
    id: 'weapon-awp', group: 'weapon',
    url: '?photo=awp&bare=1&still=1&quality=high',
    ready: 'return !!(window.__game && window.__game.photoActive);',
    wait: 1600
  },
  {
    id: 'combat', group: 'combat',
    url: '?autostart=1&quality=high&shadows=0&noadapt=1' + DEV,
    ready: 'return !!(window.__devTools && window.__game.bots && window.__game.bots.length);',
    action: `
      const g = window.__game, b = g.bots[0], p = b.pos;
      const px = p.x + 3.4, pz = p.z + 3.4;
      g.teleportTo(px, 0, pz, Math.atan2(p.x - px, p.z - pz));
      await new Promise(r => setTimeout(r, 700));
      window.__devTools.setCam(null);
      return 1;`,
    wait: 1200,
    post: `
      const g = window.__game, v = g.viewmodel, b = g.bots[0];
      v.flash.visible = true; v.flashT = 9; v.flash.rotation.z = 0.5;
      const muzzle = v.muzzlePosition(g.player.position.clone());
      const end = b.pos.clone(); end.y += 1.15;
      g._spawnTracer(muzzle, end, 0xffe2a8);
      b.bodyMat.emissive.setHex(0x992233);
      return 1;`
  },
  {
    id: 'lobby', group: 'scene',
    url: '?quality=high&noadapt=1&crowd=220&far=180' + DEV,
    ready: 'return !!(window.__devTools && window.__game.mode === "lobby" && window.__game.started);',
    action: 'window.__game.teleportTo(0, 0, 14, Math.PI); window.__game.player.pitch = -0.05; return 1;',
    wait: 2200
  }
];

async function main() {
  if (!existsSync(CHROME)) { console.error('No Chrome at ' + CHROME); process.exit(2); }
  mkdirSync(OUT, { recursive: true });
  const { server, url } = await startServer({ root: ROOT, port: 0 });
  const profile = mkdtempSync(join(tmpdir(), 'rounds-'));
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage',
    '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--mute-audio', '--window-size=1920,1080', '--remote-debugging-port=0',
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
  const report = { round: ROUND, viewport: {}, shots: [], errors: [], failedRequests: [] };
  try {
    const pf = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 120 && !existsSync(pf); i++) await sleep(100);
    if (!existsSync(pf)) throw new Error('chrome not up: ' + stderr.slice(-300));
    const port = readFileSync(pf, 'utf8').trim().split('\n')[0];
    const list = await fetch('http://127.0.0.1:' + port + '/json/list').then((r) => r.json());
    const page = list.find((t) => t.type === 'page');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');

    const vpMode = process.env.SHOT_VP || 'both';
    const vps = vpMode === 'both' ? ['desktop', 'mobile'] : [vpMode];
    const filter = (process.env.SHOT_FILTER || '').split(',').map((s) => s.trim()).filter(Boolean);

    for (const vp of vps) {
      const v = VIEWPORTS[vp];
      report.viewport[vp] = v;
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: v.width, height: v.height, deviceScaleFactor: v.dsf, mobile: v.mobile
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: v.mobile, maxTouchPoints: v.mobile ? 5 : 1 });
      if (v.mobile) {
        await cdp.send('Emulation.setUserAgentOverride', { userAgent: ANDROID_UA });
      } else {
        await cdp.send('Emulation.setUserAgentOverride', { userAgent: '' });
      }

      for (const shot of SHOTS) {
        if (filter.length && !filter.some((f) => shot.id.indexOf(f) >= 0)) continue;
        const file = join(OUT, vp + '-' + shot.id + '.png');
        console.log('[round ' + ROUND + '] ' + vp + '/' + shot.id);
        await cdp.send('Page.navigate', { url: url + shot.url });
        const ok = await waitFor(() => cdp.eval(shot.ready), 30000);
        if (!ok) {
          console.error('  ready failed:', cdp.logs.slice(-4).join(' | '));
          report.shots.push({ vp, id: shot.id, error: 'ready-failed' });
          continue;
        }
        await sleep(shot.wait || 1200);
        if (shot.action) await cdp.eval(shot.action).catch((e) => console.error('  action:', e.message));
        await sleep(700);
        await cdp.eval('window.requestAnimationFrame = function(){ return 0; }; 1');
        await sleep(250);
        if (shot.post) await cdp.eval(shot.post).catch((e) => console.error('  post:', e.message));
        await sleep(150);
        const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(file, Buffer.from(png.data, 'base64'));
        const info = await cdp.eval(
          'const i = window.__engine ? window.__engine.renderer.info.render : null; ' +
          'const p = window.__perf || {}; ' +
          'return i ? { calls: i.calls, tris: i.triangles, fps: p.fps || 0, dpr: p.dpr || 0 } : null;'
        ).catch(() => null);
        const sharp = sharpness(file);
        report.shots.push(Object.assign({ vp, id: shot.id, file: file, sharpness: sharp }, info || {}));
        console.log('  saved ' + vp + '-' + shot.id +
          (info ? ' calls=' + info.calls + ' tris=' + info.tris + ' fps=' + info.fps : '') +
          ' sharp=' + sharp);
      }
    }
    report.errors = cdp.exceptions;
    report.failedRequests = cdp.failed;
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    const agg = report.shots.filter((s) => !s.error);
    const avg = (k) => {
      const v = agg.map((s) => s[k]).filter((x) => typeof x === 'number');
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
    };
    console.log('[round ' + ROUND + '] shots=' + agg.length +
      ' avgCalls=' + avg('calls') + ' avgTris=' + avg('tris') +
      ' avgSharp=' + avg('sharpness') +
      ' jsErrors=' + report.errors.length + ' failedRequests=' + report.failedRequests.length);
    cleanup();
  } catch (e) {
    console.error('[round] FAIL', e.message);
    if (cdp) console.error(cdp.logs.slice(-12).join('\n'));
    cleanup();
    process.exit(1);
  }
}

main();
