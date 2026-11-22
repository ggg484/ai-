// 导出战术道具（手雷 / C4 / 拆弹包 / 护甲 / 武器箱）为 glb。
//   node tools/assetgen/export-props.mjs
// 与 export.mjs 同一套思路，只是源换成 js/render/prop-models.js。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../../vendor/three.module.js';
import { startServer } from '../../scripts/serve.mjs';
import { MeshSet, writeGLB } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(ROOT, 'assets/models/props');

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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP timeout ' + method)); } }, 120000);
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
const profile = mkdtempSync(join(tmpdir(), 'props-'));
const child = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage',
  '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--mute-audio', '--window-size=800,600', '--remote-debugging-port=0',
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
  await cdp.send('Page.navigate', { url: url + 'tools/assetgen/preview.html?f=/assets/models/weapons/ak.glb' });
  await sleep(1500);

  mkdirSync(OUT, { recursive: true });
  const IDS = ['he', 'flash', 'smoke', 'molotov', 'c4', 'defuse', 'armor', 'case'];
  let grand = 0;

  for (const id of IDS) {
    const data = await cdp.eval(`
      const mod = await import('/js/render/prop-models.js');
      const g = mod.buildPropModel('${id}');
      g.updateMatrixWorld(true);
      const parts = [];
      const seen = new Map();
      g.traverse((n) => {
        if (!n.isMesh) return;
        const geo = n.geometry.clone();
        geo.applyMatrix4(n.matrixWorld);
        const pos = geo.attributes.position;
        const nrm = geo.attributes.normal;
        const uv = geo.attributes.uv;
        const idx = geo.index;
        const m = n.material || {};
        const key = m.uuid || ('m' + parts.length);
        const role = seen.get(key) || ('mat' + seen.size);
        seen.set(key, role);
        parts.push({
          role,
          pos: Array.from(pos.array),
          nrm: nrm ? Array.from(nrm.array) : null,
          uv: uv ? Array.from(uv.array) : null,
          idx: idx ? Array.from(idx.array) : null,
          color: m.color ? m.color.getHex() : 0x8a9096,
          metalness: m.metalness != null ? m.metalness : 0.4,
          roughness: m.roughness != null ? m.roughness : 0.6,
          opacity: m.opacity != null ? m.opacity : 1,
          transparent: !!m.transparent
        });
      });
      return { parts };
    `);
    if (!data || !data.parts.length) { console.error(id, 'no geometry'); continue; }

    const set = new MeshSet();
    const mats = {};
    for (const p of data.parts) {
      if (!mats[p.role]) {
        mats[p.role] = {
          name: p.role,
          color: p.color,
          metallic: p.metalness,
          roughness: p.roughness,
          opacity: p.transparent && p.opacity < 1 ? p.opacity : undefined
        };
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      if (p.nrm) geo.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
      if (p.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      if (p.idx) geo.setIndex(p.idx);
      set.addRaw(p.role, geo);
    }
    const res = writeGLB(join(OUT, id + '.glb'), set, mats, { name: id, extras: { generator: 'tools/assetgen/export-props.mjs' } });
    grand += res.tris;
    console.log(`${id.padEnd(9)} ${String(res.tris).padStart(5)} tris  ${(res.bytes / 1024).toFixed(1).padStart(6)} KB  ${String(res.primitives).padStart(2)} prims`);
  }
  console.log('total', grand, 'tris');
} catch (e) {
  console.error('export failed:', e.message);
  cleanup();
  process.exit(1);
}
cleanup();
