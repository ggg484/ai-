// 任意页面的无头截图：node tools/assetgen/shoturl.mjs "/?editor=1" /tmp/editor.png [waitMs]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../scripts/serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const [pathArg, outArg, waitArg] = process.argv.slice(2);
if (!pathArg || !outArg) { console.error('usage: node tools/assetgen/shoturl.mjs "/?editor=1" out.png [waitMs]'); process.exit(2); }

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
    this.ws = ws; this.seq = 0; this.pending = new Map();
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
        if (process.env.VERBOSE) console.log('  page>', t);
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
const profile = mkdtempSync(join(tmpdir(), 'shoturl-'));
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
  await cdp.send('Page.navigate', { url: url.replace(/\/$/, '') + pathArg });
  await sleep(+(waitArg || 6000));
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
