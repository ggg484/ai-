// 冒烟测试：无头 Chrome 里跑一遍主流程，断言移动/射击/击杀/下包/引爆/结算。
//
// 零依赖：用 Node 22 内置的 fetch + WebSocket 直连 CDP，不需要 playwright/puppeteer。
// 无 GPU 的 Linux 上会自动用 xvfb-run 重跑自己（headless + swiftshader 需要 X display）。
//
//   npm run smoke
//   npm run smoke -- --verbose      # 打印页面 console
//   npm run smoke -- --no-xvfb      # 不自动套 xvfb（自己已有 DISPLAY 时）

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../scripts/serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ARGS = process.argv.slice(2);
const VERBOSE = ARGS.includes('--verbose');

/* ------------------------------------------------------------------ */
/* Chrome 定位                                                         */
/* ------------------------------------------------------------------ */

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    candidates.push('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
  } else {
    // 优先 Playwright 自带的那份：系统 chrome 的 WebGL 常被 GPU blocklist 掉，
    // 而 Playwright 的构建配合 swiftshader 是验证过能拿到 WebGL2 的组合。
    const base = join(process.env.HOME || '/root', '.cache', 'ms-playwright');
    if (existsSync(base)) {
      for (const d of readdirSync(base).sort().reverse()) {
        if (!d.startsWith('chromium-')) continue;
        candidates.push(join(base, d, 'chrome-linux64', 'chrome'));
        candidates.push(join(base, d, 'chrome-linux', 'chrome'));
      }
    }
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/* ------------------------------------------------------------------ */
/* CDP 客户端（Node 22 自带 WebSocket）                                 */
/* ------------------------------------------------------------------ */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.logs = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' ');
        this.logs.push('[' + msg.params.type + '] ' + text);
        if (VERBOSE) console.log('    page> ' + text);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.logs.push('[exception] ' + (d.exception && d.exception.description ? d.exception.description : d.text));
      }
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new CDP(ws)));
      ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败: ' + url)));
    });
  }

  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时: ' + method));
        }
      }, 60000);
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(async () => { ' + expression + ' })()',
      awaitPromise: true,
      returnByValue: true
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面内异常: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    }
    return r.result ? r.result.value : undefined;
  }

  close() { try { this.ws.close(); } catch (e) {} }
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasXvfb() {
  try {
    return spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).status !== null;
  } catch (e) { return false; }
}

async function waitFor(fn, timeoutMs, stepMs) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(stepMs || 120);
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const LOBBY = ARGS.includes('--lobby');
  const results = [];
  let failed = 0;

  function check(name, ok, detail) {
    results.push({ name, ok });
    if (!ok) failed++;
    const mark = ok ? 'PASS' : 'FAIL';
    console.log('  ' + mark + '  ' + name + (detail ? '   ' + detail : ''));
  }

  const chrome = findChrome();
  if (!chrome) {
    console.error('[smoke] 找不到 Chrome/Chromium。设置 CHROME_PATH 指向可执行文件后重试。');
    process.exit(2);
  }

  console.log('[smoke] chrome = ' + chrome);

  const { server, port, url } = await startServer({ root: ROOT, port: 0 });
  console.log('[smoke] server = ' + url);

  const profile = mkdtempSync(join(tmpdir(), 'smoke-profile-'));
  const child = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--ignore-gpu-blocklist',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--mute-audio',
    '--window-size=1280,720',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderrBuf = '';
  child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

  let cdp = null;
  const cleanup = () => {
    if (cdp) cdp.close();
    try { child.kill('SIGKILL'); } catch (e) {}
    try { server.close(); } catch (e) {}
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  };

  const bail = (code) => { cleanup(); process.exit(code); };

  try {
    // 等 DevToolsActivePort
    const portFile = join(profile, 'DevToolsActivePort');
    const ready = await waitFor(() => existsSync(portFile) && readFileSync(portFile, 'utf8').trim().split('\n').length >= 2, 15000);
    if (!ready) {
      console.error('[smoke] Chrome 没起来。stderr:\n' + stderrBuf.split('\n').slice(-15).join('\n'));
      bail(2);
    }
    const devPort = readFileSync(portFile, 'utf8').trim().split('\n')[0];

    // 复用启动时的那个 page target，不要新建 tab：
    // headless 里后台 tab 的 requestAnimationFrame 会被节流到几乎不跑，主循环就停了。
    const list = await fetch('http://127.0.0.1:' + devPort + '/json/list').then((r) => r.json());
    const page = list.find((t) => t.type === 'page');
    if (!page) {
      console.error('[smoke] 找不到 page target');
      bail(2);
    }

    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    if (LOBBY) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390, height: 844, deviceScaleFactor: 2.6, mobile: true
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36'
      });
    }

    await cdp.send('Page.navigate', { url: url + (LOBBY ? '?perf=1&quality=medium&noadapt=1' : '?autostart=1') });
    await sleep(300);

    // 等游戏起来
    const booted = await waitFor(() => cdp.eval('return !!(window.__game && window.__game.started)').catch(() => false), 20000);
    if (!booted) {
      console.error('[smoke] 游戏没启动。页面日志：\n' + cdp.logs.slice(-20).join('\n'));
      bail(1);
    }

    if (LOBBY) {
      const lobbyReady = await waitFor(() => cdp.eval(
        'return !!(window.__game && window.__game.mode === "lobby" && window.__perf)'
      ).catch(() => false), 25000);
      check('进入大厅', !!lobbyReady);

      const samples = [];
      for (let i = 0; i < 14; i++) {
        await sleep(500);
        samples.push(await cdp.eval('return window.__perf').catch(() => null));
      }
      const stable = samples.slice(2).filter(Boolean);
      const avg = stable.reduce((a, s) => a + s.fps, 0) / Math.max(1, stable.length);
      const min = stable.length ? Math.min.apply(null, stable.map((s) => s.fps)) : 0;
      const last = stable[stable.length - 1] || {};
      console.log('[lobby] 移动端模拟  FPS avg=' + avg.toFixed(1) + ' min=' + min +
        ' calls=' + last.calls + ' tris=' + last.triangles +
        ' crowd=' + last.crowd + ' detail=' + last.detail + ' far=' + last.far +
        ' dpr=' + last.dpr + ' quality=' + last.quality);
      check('大厅 DPR ≤ 1.15', last.dpr <= 1.15, 'dpr=' + last.dpr);
      check('大厅 draw call ≤ 130', last.calls <= 130, 'calls=' + last.calls);
      check('大厅三角形 ≤ 140k', last.triangles <= 140000, 'tris=' + last.triangles);
      check('同屏人数 ≥ 350', last.crowd >= 350, 'crowd=' + last.crowd);
      check('细节人数 ≤ 220', last.detail <= 220, 'detail=' + last.detail);

      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await sleep(2500);
      const th = [];
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        th.push(await cdp.eval('return window.__perf').catch(() => null));
      }
      const thS = th.filter(Boolean);
      const thAvg = thS.reduce((a, s) => a + s.fps, 0) / Math.max(1, thS.length);
      const thLast = thS[thS.length - 1] || {};
      console.log('[lobby] 4x CPU 节流  FPS avg=' + thAvg.toFixed(1) +
        ' calls=' + thLast.calls + ' tris=' + thLast.triangles +
        ' dpr=' + thLast.dpr + ' detail=' + thLast.detail + ' far=' + thLast.far);

      const lobbyShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync('/workspace/lobby-perf.png', Buffer.from(lobbyShot.data, 'base64'));
      console.log('[lobby] screenshot=/workspace/lobby-perf.png');

      // 皮肤品相：打开面板，换一个磨损/图案，再装备
      await cdp.eval("window.__game.lobbyUi.showSkins('ak', 'ak_redline'); 1").catch(() => null);
      await sleep(700);
      const wear1 = await cdp.eval("return document.getElementById('sd-variant') ? document.getElementById('sd-variant').innerText : ''").catch(() => '');
      await cdp.eval("document.getElementById('btn-variant').click(); 1").catch(() => null);
      await sleep(400);
      const wear2 = await cdp.eval("return document.getElementById('sd-variant') ? document.getElementById('sd-variant').innerText : ''").catch(() => '');
      await cdp.eval("document.getElementById('btn-equip').click(); 1").catch(() => null);
      await sleep(500);
      check('品相可切换', !!wear1 && wear1 !== wear2, (wear1 || '?') + ' -> ' + (wear2 || '?'));
      const applied = await cdp.eval('const v = window.__game.viewmodel.skins.ak; return v && v.variant ? v.variant : null').catch(() => null);
      check('品相写入视角模型', !!applied && Math.abs(applied.wear - 0.412) < 0.001, applied ? JSON.stringify(applied) : 'null');
      const skinShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync('/workspace/lobby-skins.png', Buffer.from(skinShot.data, 'base64'));
      console.log('[lobby] skins screenshot=/workspace/lobby-skins.png');

      // 快速传送：关掉面板，点「二层看台」
      await cdp.eval("window.__game.lobbyUi.closePanels(); 1").catch(() => null);
      await sleep(300);
      await cdp.eval("document.querySelector('#quick-tp [data-tp=\"mezz\"]').click(); 1").catch(() => null);
      await sleep(800);
      const tp = await cdp.eval("return { x: +window.__game.player.position.x.toFixed(1), y: +window.__game.player.position.y.toFixed(2), z: +window.__game.player.position.z.toFixed(1) }").catch(() => null);
      const panelOpen = await cdp.eval('return !!(window.__game.lobbyUi && window.__game.lobbyUi.panel)').catch(() => true);
      check('快速传送到二层看台', !!tp && tp.y > 5 && tp.z < -18 && !panelOpen, (tp ? JSON.stringify(tp) : 'null') + ' panel=' + panelOpen);
      const mezzShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync('/workspace/lobby-mezz.png', Buffer.from(mezzShot.data, 'base64'));
      console.log('[lobby] mezz screenshot=/workspace/lobby-mezz.png');

      // 3D 检视：AWP 与 C4
      await cdp.eval("window.__game.openPhoto('weapon','awp'); 1").catch(() => null);
      await sleep(1500);
      const photo = await cdp.eval("return { active: window.__game.photoActive, title: document.getElementById('photo-title').textContent, nav: document.querySelectorAll('#photo-nav button').length }").catch(() => null);
      check('3D 检视模式', !!photo && photo.active && photo.title.indexOf('AWP') >= 0 && photo.nav >= 12, photo ? JSON.stringify(photo) : 'null');
      const photoShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync('/workspace/photo-awp.png', Buffer.from(photoShot.data, 'base64'));
      console.log('[lobby] photo screenshot=/workspace/photo-awp.png');
      await cdp.eval("window.__game.photo.show('prop','c4'); 1").catch(() => null);
      await sleep(900);
      const propPhoto = await cdp.eval("return document.getElementById('photo-title').textContent").catch(() => '');
      check('道具检视模式', propPhoto.indexOf('C4') >= 0 || propPhoto.indexOf('炸弹') >= 0, propPhoto);
      const propShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync('/workspace/photo-c4.png', Buffer.from(propShot.data, 'base64'));
      console.log('[lobby] prop screenshot=/workspace/photo-c4.png');
      await cdp.eval("window.__game.closePhoto(); 1").catch(() => null);

      const errs = cdp.logs.filter((l) => l.indexOf('[exception]') === 0);
      check('无运行时异常', errs.length === 0, errs.slice(0, 2).join(' | '));
      console.log('\n[lobby] ' + results.filter((r) => r.ok).length + '/' + results.length + ' 通过');
      cleanup();
      process.exit(failed ? 1 : 0);
    }

    console.log('\n[smoke] 开始断言\n');

    /* 1. 渲染后端 */
    const gl = await cdp.eval(`
      const g = window.__game;
      const ctx = g.engine.renderer.getContext();
      const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext;
      return { isGL2, version: ctx.getParameter(ctx.VERSION) };
    `);
    check('WebGL2 上下文', !!gl.isGL2, gl.version);

    /* 2. 开局状态 */
    const boot = await cdp.eval(`
      const g = window.__game;
      return {
        phase: g.round.phase,
        z: +g.player.position.z.toFixed(2),
        x: +g.player.position.x.toFixed(2),
        hp: g.player.hp,
        money: g.money,
        round: g.round.round
      };
    `);
    check('进入冻结时间', boot.phase === 'freeze', 'phase=' + boot.phase);
    check('玩家在 T 出生点', Math.abs(boot.z + 28) < 1.2 && Math.abs(boot.x) < 1.2, 'pos=(' + boot.x + ', ' + boot.z + ')');
    check('初始生命与金钱', boot.hp === 100 && boot.money === 800, 'hp=' + boot.hp + ' money=' + boot.money);

    /* 3. 移动（在冻结时间内，Bot 不动） */
    const move = await cdp.eval(`
      const g = window.__game;
      const step = (n) => { for (let i = 0; i < n; i++) g.simulate(1 / 64); };
      const z0 = g.player.position.z;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      step(200);                                  // 3.125 s 模拟，不依赖真实帧率
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
      step(1);
      return {
        z0: +z0.toFixed(2), z1: +g.player.position.z.toFixed(2),
        diag: { alive: g.player.alive, en: g.input.enabled, paused: g.paused, ending: g.roundEnding }
      };
    `);
    const moved = move.z1 - move.z0;
    if (moved <= 1.5) console.log('        diag: ' + JSON.stringify(move.diag));
    check('按 W 向前移动', moved > 8, 'z ' + move.z0 + ' → ' + move.z1 + '  (+' + moved.toFixed(2) + ' m)');

    /* 4. 冻结期不能开火 */
    const frozen = await cdp.eval(`
      const g = window.__game;
      const step = (n) => { for (let i = 0; i < n; i++) g.simulate(1 / 64); };
      g.weapon.refill();
      const mag = g.weapon.def.mag;
      const c = document.getElementById('game');
      c.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      step(6);
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
      return { mag, ammo: g.weapon.ammo, phase: g.round.phase };
    `);
    check('冻结时间禁止开火', frozen.ammo === frozen.mag, 'ammo=' + frozen.ammo + '/' + frozen.mag);

    /* 5. 进入进行中 + 能开火 */
    const live = await cdp.eval(`
      const g = window.__game;
      const step = (n) => { for (let i = 0; i < n; i++) g.simulate(1 / 64); };
      g.round.timer = 0.02;
      step(2);
      g.weapon.refill();
      const mag = g.weapon.def.mag;
      const c = document.getElementById('game');
      c.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      step(2);
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
      return { phase: g.round.phase, mag, ammo: g.weapon.ammo };
    `);
    check('冻结结束进入进行中', live.phase === 'live', 'phase=' + live.phase);
    check('进行中可以开火', live.ammo < live.mag, 'ammo=' + live.ammo + '/' + live.mag);

    /* 6. 击杀（直接驱动命中管线，避免依赖鼠标瞄准） */
    const kill = await cdp.eval(`
      const g = window.__game;
      const b = g.bots.find((x) => x.alive);
      if (!b) return { err: 'no bot alive' };
      g.player.position.set(b.pos.x, g.player.position.y, b.pos.z - 8);
      g.player.velocity.set(0, 0, 0);
      g.player.hp = 100; g.player.alive = true;
      const eyeY = g.player.position.y + g.player.height * 0.9;
      g.player.yaw = Math.atan2(0, 8);
      g.player.pitch = Math.atan2(1.62 - eyeY, 8);
      g.player.recoilPitch = 0; g.player.recoilYaw = 0;
      const money0 = g.money;
      g.weapon.refill();
      let shots = 0;
      for (let i = 0; i < 8 && b.alive; i++) { g.weapon.cooldown = 0; if (g.weapon.fire()) { g._hitscan(0); shots++; } }
      return { hp: +b.hp.toFixed(1), alive: b.alive, shots, money0, money1: g.money };
    `);
    check('命中并击杀 Bot', kill.alive === false, 'hp=' + kill.hp + ' shots=' + kill.shots);
    check('击杀奖励金钱', kill.money1 > kill.money0, '$' + kill.money0 + ' → $' + kill.money1);

    /* 7. 下包 */
    const plant = await cdp.eval(`
      const g = window.__game;
      const step = (n) => { for (let i = 0; i < n; i++) g.simulate(1 / 64); };
      g.round.phase = 'live';
      g.round.timer = 100;
      g.player.hp = 100; g.player.alive = true;
      const s = g.map.sites.A;
      g.player.position.set(s.x, 0, s.z);
      g.player.velocity.set(0, 0, 0);
      g.input.held.use = true;
      g.round.plantProgress = 0.97;
      step(8);
      g.input.held.use = false;
      return { phase: g.round.phase, bomb: !!g.round.bomb, timer: +g.round.timer.toFixed(1) };
    `);
    check('包点下包成功', plant.phase === 'planted' && plant.bomb, 'phase=' + plant.phase + ' bomb=' + plant.bomb);

    /* 8. 引爆结算 */
    const boom = await cdp.eval(`
      const g = window.__game;
      const step = (n) => { for (let i = 0; i < n; i++) g.simulate(1 / 64); };
      g.player.hp = 100; g.player.alive = true;
      g.round.timer = 0.02;
      step(3);
      return { phase: g.round.phase, scoreT: g.round.scoreT, scoreCT: g.round.scoreCT, money: g.money };
    `);
    check('炸弹引爆结算', boom.phase === 'ended' && boom.scoreT === 1, 'score=' + boom.scoreT + ':' + boom.scoreCT);

    /* 9. 下一回合自动开始 */
    const next = await cdp.eval(`
      const g = window.__game;
      const step = (n) => { for (let i = 0; i < n; i++) g.simulate(1 / 64); };
      g.round.endTimer = 0.02;
      step(3);
      return { phase: g.round.phase, round: g.round.round, hp: g.player.hp, ammo: g.weapon.ammo };
    `);
    check('进入第 2 回合', next.round === 2 && next.phase === 'freeze', 'round=' + next.round + ' phase=' + next.phase);
    check('回合重置补满状态', next.hp === 100 && next.ammo > 0, 'hp=' + next.hp + ' ammo=' + next.ammo);

    /* 10. 渲染开销 */
    const perf = await cdp.eval(`
      const g = window.__game;
      await new Promise((r) => setTimeout(r, 200));
      const info = g.engine.renderer.info;
      return { calls: info.render.calls, tris: info.render.triangles, textures: info.memory.textures };
    `);
    // v0.3 增加 A 大/B 洞立面、集装箱、道具展台后，对局基线上升到 ~88 calls；仍远低于 120 预算
    check('draw call ≤ 100', perf.calls <= 100, 'calls=' + perf.calls);
    // v0.2 换成真武器/人物模型后三角面上调；仍远低于 PRINCIPLES 的 250k 移动端预算
    check('三角形 ≤ 80000', perf.tris <= 80000, 'tris=' + perf.tris);

    /* 汇总 */
    console.log('\n[smoke] ' + (results.length - failed) + '/' + results.length + ' 通过');
    if (failed) {
      console.log('[smoke] 页面日志（最后 20 条）：');
      for (const l of cdp.logs.slice(-20)) console.log('  ' + l);
    }
    bail(failed ? 1 : 0);
  } catch (err) {
    console.error('\n[smoke] 运行失败：' + (err && err.message ? err.message : err));
    if (cdp) for (const l of cdp.logs.slice(-20)) console.log('  ' + l);
    if (stderrBuf) console.error('[smoke] chrome stderr:\n' + stderrBuf.split('\n').slice(-12).join('\n'));
    bail(2);
  }
}

/* ------------------------------------------------------------------ */
/* 入口：无 DISPLAY 时套 xvfb-run 重跑                                  */
/* ------------------------------------------------------------------ */

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  // Linux 上 dl 一个虚拟屏跑。不能用「DISPLAY 是否存在」判断：
  // 很多容器里 DISPLAY 被设成 :0 但没有真的 X server，chrome 会 xcb_connect 失败。
  // 有 xvfb-run 就套上，swiftshader 本来也不需要真 GPU。
  const needXvfb = process.platform === 'linux' && !ARGS.includes('--no-xvfb') && !process.env.SMOKE_XVFB;
  if (needXvfb && hasXvfb()) {
    const r = spawnSync('xvfb-run', ['-a', process.execPath, process.argv[1], ...ARGS], {
      stdio: 'inherit',
      env: Object.assign({}, process.env, { SMOKE_XVFB: '1' })
    });
    process.exit(r.status == null ? 2 : r.status);
  }
  main();
}
