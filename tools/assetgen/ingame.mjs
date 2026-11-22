// 游戏内第一人称截图（临时验收用）：node tools/assetgen/ingame.mjs out.png [weapon] [map]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../scripts/serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const [outArg, weaponArg, mapArg] = process.argv.slice(2);
if (!outArg) { console.error('usage: node tools/assetgen/ingame.mjs out.png [weapon] [map]'); process.exit(2); }

if (!process.env.XVFB && process.platform === 'linux') {
  const r = spawnSync('xvfb-run', ['-a', process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, XVFB: '1' }
  });
  process.exit(r.status == null ? 1 : r.status);
}

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = join(process.env.HOME || '/root', '.cache', 'ms-playwright');
  if (existsSync(base)) {
    for (const d of readdirSync(base).sort().reverse()) {
      if (!d.startsWith('chromium-')) continue;
      for (const p of [join(base, d, 'chrome-linux64', 'chrome'), join(base, d, 'chrome-linux', 'chrome')]) {
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (existsSync(p)) return p;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.logs = [];
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        const t = (m.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' ');
        this.logs.push('[' + m.params.type + '] ' + t);
        console.log('  page>', t);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        console.log('  page!', d.exception?.description || d.text);
      }
    });
  }
  static connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => res(new CDP(ws)));
      ws.addEventListener('error', () => rej(new Error('CDP connect failed')));
    });
  }
  send(method, params) {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP timeout ' + method)); } }, 40000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(async () => { ' + expression + ' })()', awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

const chrome = findChrome();
if (!chrome) { console.error('no chrome'); process.exit(2); }
const { server, url } = await startServer({ root: ROOT, port: 0 });
const profile = mkdtempSync(join(tmpdir(), 'ingame-'));
const child = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage',
  '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--mute-audio', '--window-size=1280,720', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let cdp = null;
const cleanup = () => {
  if (cdp) cdp.close();
  try { child.kill('SIGKILL'); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
};

try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  const devPort = readFileSync(portFile, 'utf8').trim().split('\n')[0];
  const list = await fetch(`http://127.0.0.1:${devPort}/json/list`).then((r) => r.json());
  cdp = await CDP.connect(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  const map = mapArg || 'harbor';
  await cdp.send('Page.navigate', { url: `${url}?map=${map}&autostart=1&quality=high&noadapt=1` });
  for (let i = 0; i < 160; i++) {
    const ok = await cdp.eval('return !!(window.__game && window.__game.started)').catch(() => false);
    if (ok) break;
    await sleep(200);
  }
  await sleep(1200);

  const info = await cdp.eval(`
    const g = window.__game;
    const w = '${weaponArg || 'ak'}';
    g.round.beginMatch();
    g.round.phase = 'live';
    g.teleportTo(0, 0, -18, 0);
    // 验模型本身：先卸掉皮肤，避免花纹盖住原厂材质
    try { g.viewmodel.setSkin(w, null); } catch (e) {}
    g.setWeapon(w);
    g.player.pitch = 0.0;
    await new Promise(r => setTimeout(r, 900));
    const vm = g.viewmodel;
    const gun = vm.guns[vm.current];
    let meshes = 0, mats = [];
    if (gun) gun.traverse(o => { if (o.isMesh && o.visible) { meshes++; if (o.material) mats.push(o.material.name || '?'); } });
    return { weapon: vm.current, meshes, mats: [...new Set(mats)],
             hasMuzzle: !!(gun && gun.userData.muzzle), hands: !!(gun && gun.userData.left) };
  `);
  console.log('info', JSON.stringify(info));
  await sleep(200);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(outArg), { recursive: true });
  writeFileSync(outArg, Buffer.from(shot.data, 'base64'));
  console.log('saved', outArg);
} catch (e) {
  console.error('failed:', e.message);
  cleanup();
  process.exit(1);
}
cleanup();
