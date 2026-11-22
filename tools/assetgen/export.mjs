// 把 js/render/weapon-models.js 的程序化武器导出成标准 glb。
//
// 为什么要走浏览器：几何构建依赖 three 的 Shape/Extrude/Capsule，Node 里能跑，
// 但材质带 canvas 程序纹理，只有浏览器能完整求值。与其在 Node 重写一遍，
// 不如在页面里构建一次，取顶点 + 材质参数，回 Node 写 glb。
//
//   node tools/assetgen/export.mjs [weapon-id...]
//
// 产出 assets/models/weapons/<id>.glb，可在 Blockbench 里 Import > glTF 继续编辑。

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
const OUT = join(ROOT, 'assets/models/weapons');
const ALL = ['ak', 'm4', 'awp', 'mp9', 'glock', 'usp', 'deagle', 'knife'];
const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const TARGETS = ids.length ? ids : ALL;

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
const profile = mkdtempSync(join(tmpdir(), 'assetgen-'));
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
  let grand = 0;

  for (const id of TARGETS) {
    const data = await cdp.eval(`
      const mod = await import('/js/render/weapon-models.js');
      const g = mod.buildWeaponModel('${id}', { hands: true, detail: 'high', depthTest: true, renderOrder: 0 });
      if (!g) return null;
      const parts = [];
      g.traverse((n) => {
        if (!n.isMesh || !n.geometry) return;
        const geo = n.geometry;
        const pos = geo.attributes.position;
        const nrm = geo.attributes.normal;
        const uv = geo.attributes.uv;
        const idx = geo.index;
        // 左右手在 assemble 里都被并成 glove / sleeve，用几何中心 x 的正负还原。
        let role = n.userData.role || 'metal';
        if (role === 'glove' || role === 'sleeve') {
          let sx = 0;
          for (let i = 0; i < pos.count; i++) sx += pos.getX(i);
          if (sx / pos.count < -0.005) role += 'L';
        }
        const m = n.material || {};
        parts.push({
          role,
          pos: Array.from(pos.array),
          nrm: nrm ? Array.from(nrm.array) : null,
          uv: uv ? Array.from(uv.array) : null,
          idx: idx ? Array.from(idx.array) : null,
          color: m.color ? m.color.getHex() : 0x8a9096,
          metalness: m.metalness != null ? m.metalness : 0.4,
          roughness: m.roughness != null ? m.roughness : 0.6,
          emissive: m.emissive && m.emissive.getHex() !== 0 ? m.emissive.getHex() : 0,
          opacity: m.opacity != null ? m.opacity : 1
        });
      });
      return { parts, triangles: (() => { let t = 0; g.traverse(n => { if (n.isMesh) { const q = n.geometry; t += (q.index ? q.index.count : q.attributes.position.count) / 3; } }); return Math.round(t); })() };
    `);
    if (!data || !data.parts) { console.error(id, 'no geometry'); continue; }

    const set = new MeshSet();
    const mats = {};
    for (const p of data.parts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      if (p.nrm) geo.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
      if (p.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      if (p.idx) geo.setIndex(p.idx);
      set.addRaw(p.role, geo);
      if (!mats[p.role]) {
        mats[p.role] = {
          color: p.color,
          metallic: p.metalness,
          roughness: p.roughness,
          opacity: p.opacity < 1 ? p.opacity : undefined,
          emissive: p.emissive ? [((p.emissive >> 16) & 255) / 255, ((p.emissive >> 8) & 255) / 255, (p.emissive & 255) / 255] : undefined
        };
      }
    }
    const res = writeGLB(join(OUT, id + '.glb'), set, mats, { name: id, extras: { generator: 'tools/assetgen/export.mjs' } });
    grand += res.tris;
    console.log(`${id.padEnd(8)} ${String(res.tris).padStart(6)} tris  ${(res.bytes / 1024).toFixed(1).padStart(7)} KB  ${String(res.primitives).padStart(2)} prims  ${Object.keys(mats).length} mats`);
  }
  console.log('total', grand, 'tris');
} catch (e) {
  console.error('export failed:', e.message);
  cleanup();
  process.exit(1);
}
cleanup();
