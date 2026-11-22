// 冒烟测试：无头 Chrome 里跑一遍主流程，断言移动/射击/击杀/下包/引爆/结算。
//
// 零依赖：用 Node 22 内置的 fetch + WebSocket 直连 CDP，不需要 playwright/puppeteer。
// 无 GPU 的 Linux 上会自动用 xvfb-run 重跑自己（headless + swiftshader 需要 X display）。
//
//   npm run smoke
//   npm run smoke -- --verbose      # 打印页面 console
//   npm run smoke -- --no-xvfb      # 不自动套 xvfb（自己已有 DISPLAY 时）

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../scripts/serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SHOT_DIR = process.env.SHOT_DIR || join(ROOT, 'screenshots');
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
      // 分辨率策略：永远原生 DPR，不允许动态降采样（产品硬性要求）
      check('大厅锁原生分辨率', last.dpr >= 2.5, 'dpr=' + last.dpr);
      check('大厅 draw call ≤ 130', last.calls <= 130, 'calls=' + last.calls);
      check('大厅三角形 ≤ 140k', last.triangles <= 140000, 'tris=' + last.triangles);
      check('大厅无占位 NPC', last.crowd === 0, 'crowd=' + last.crowd);
      check('细节人数为 0', last.detail === 0, 'detail=' + last.detail);

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
      mkdirSync(SHOT_DIR, { recursive: true });
      const lobbyPath = join(SHOT_DIR, 'lobby-perf.png');
      writeFileSync(lobbyPath, Buffer.from(lobbyShot.data, 'base64'));
      console.log('[lobby] screenshot=' + lobbyPath);

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
      const skinPath = join(SHOT_DIR, 'lobby-skins.png');
      writeFileSync(skinPath, Buffer.from(skinShot.data, 'base64'));
      console.log('[lobby] skins screenshot=' + skinPath);

      // 快速传送：关掉面板，点「二层看台」
      await cdp.eval("window.__game.lobbyUi.closePanels(); 1").catch(() => null);
      await sleep(300);
      await cdp.eval("document.querySelector('#quick-tp [data-tp=\"mezz\"]').click(); 1").catch(() => null);
      await sleep(800);
      const tp = await cdp.eval("return { x: +window.__game.player.position.x.toFixed(1), y: +window.__game.player.position.y.toFixed(2), z: +window.__game.player.position.z.toFixed(1) }").catch(() => null);
      const panelOpen = await cdp.eval('return !!(window.__game.lobbyUi && window.__game.lobbyUi.panel)').catch(() => true);
      check('快速传送到二层看台', !!tp && tp.y > 5 && tp.z < -18 && !panelOpen, (tp ? JSON.stringify(tp) : 'null') + ' panel=' + panelOpen);
      const mezzShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const mezzPath = join(SHOT_DIR, 'lobby-mezz.png');
      writeFileSync(mezzPath, Buffer.from(mezzShot.data, 'base64'));
      console.log('[lobby] mezz screenshot=' + mezzPath);

      // 3D 检视：AWP 与 C4
      await cdp.eval("window.__game.openPhoto('weapon','awp'); 1").catch(() => null);
      await sleep(1500);
      const photo = await cdp.eval("return { active: window.__game.photoActive, title: document.getElementById('photo-title').textContent, nav: document.querySelectorAll('#photo-nav button').length }").catch(() => null);
      check('3D 检视模式', !!photo && photo.active && photo.title.indexOf('AWP') >= 0 && photo.nav >= 12, photo ? JSON.stringify(photo) : 'null');
      const photoShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const photoPath = join(SHOT_DIR, 'photo-awp.png');
      writeFileSync(photoPath, Buffer.from(photoShot.data, 'base64'));
      console.log('[lobby] photo screenshot=' + photoPath);
      await cdp.eval("window.__game.photo.show('prop','c4'); 1").catch(() => null);
      await sleep(900);
      const propPhoto = await cdp.eval("return document.getElementById('photo-title').textContent").catch(() => '');
      check('道具检视模式', propPhoto.indexOf('C4') >= 0 || propPhoto.indexOf('炸弹') >= 0, propPhoto);
      const propShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const propPath = join(SHOT_DIR, 'photo-c4.png');
      writeFileSync(propPath, Buffer.from(propShot.data, 'base64'));
      console.log('[lobby] prop screenshot=' + propPath);
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
    check('玩家在 T 出生点', Math.abs(boot.z + 38) < 1.2 && Math.abs(boot.x) < 1.2, 'pos=(' + boot.x + ', ' + boot.z + ')');
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

    /* 10. 导航网格 + A*（T-003 阶段 1） */
    const navInfo = await cdp.eval(`
      const g = window.__game;
      const nav = g.bots[0].nav;
      const s = nav.stats();
      return Object.assign(s, { shared: g.bots.every((b) => b.nav === nav) });
    `);
    check('导航网格已构建', navInfo.cells > 5000 && navInfo.free > navInfo.cells * 0.35 && navInfo.step === 0.75,
      navInfo.w + '×' + navInfo.h + ' 格 / 可走 ' + navInfo.free + ' / 9 Bot 共用 ' + navInfo.shared);

    const navPaths = await cdp.eval(`
      const g = window.__game;
      const nav = g.bots[0].nav;
      const A = g.map.sites.A, B = g.map.sites.B;
      const sample = (pts) => {
        let bad = 0, n = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.3));
          for (let s = 1; s <= k; s++) {
            n++;
            if (!nav.isFree(a.x + (b.x - a.x) * s / k, a.z + (b.z - a.z) * s / k)) bad++;
          }
        }
        return { n, bad };
      };
      const t = nav.path(0, -38, A.x, A.z);
      const ct = nav.path(0, 38, B.x, B.z);
      return {
        t: t ? t.length : 0, ct: ct ? ct.length : 0,
        sample: (t ? sample(t) : { n: 0, bad: 999 }).bad + (ct ? sample(ct) : { n: 0, bad: 999 }).bad,
        n: (t ? sample(t) : { n: 0 }).n + (ct ? sample(ct) : { n: 0 }).n
      };
    `);
    check('A* 连得通 T→A / CT→B', navPaths.t >= 2 && navPaths.ct >= 2,
      'T→A ' + navPaths.t + ' 点 / CT→B ' + navPaths.ct + ' 点');
    check('路径全程不穿墙', navPaths.sample === 0,
      '采样 ' + navPaths.n + ' 点，越界 ' + navPaths.sample);

    /* 11. Bot 实走：CT 出生点 → A 点，T 出生点 → B 点（不穿墙、限时到达） */
    const walkTo = (botExpr, siteKey) => `
      const g = window.__game;
      const b = ${botExpr};
      b.reset();
      const site = g.map.sites.${siteKey};
      const from = { x: +b.pos.x.toFixed(1), z: +b.pos.z.toFixed(1) };
      const goals = [{ x: site.x, z: site.z }];
      const ctx = { player: { alive: false }, tBots: [], ctBots: [] };
      const cb = { onBotShoot() {}, onBotReload() {} };
      let t = 0, inside = 0, minD = 1e9;
      for (let i = 0; i < 64 * 45; i++) {
        b.update(1 / 64, ctx, goals, cb);
        t += 1 / 64;
        const d = Math.hypot(b.pos.x - site.x, b.pos.z - site.z);
        if (d < minD) minD = d;
        if (b.world.overlaps(b.pos.x - 0.24, b.pos.y + 0.2, b.pos.z - 0.24,
                             b.pos.x + 0.24, b.pos.y + 1.3, b.pos.z + 0.24)) inside++;
        if (d < 5) break;
      }
      b.reset();
      return { from, t: +t.toFixed(1), minD: +minD.toFixed(1), inside };
    `;

    const walkA = await cdp.eval(walkTo('g.enemyBots[0]', 'A'));
    check('CT Bot 走到 A 点', walkA.minD < 5.5 && walkA.inside === 0,
      `(${walkA.from.x}, ${walkA.from.z}) → A，${walkA.t} s，最近 ${walkA.minD} m，嵌墙 ${walkA.inside} 帧`);

    const walkB = await cdp.eval(walkTo('g.allyBots[0]', 'B'));
    check('T Bot 走到 B 点', walkB.minD < 5.5 && walkB.inside === 0,
      `(${walkB.from.x}, ${walkB.from.z}) → B，${walkB.t} s，最近 ${walkB.minD} m，嵌墙 ${walkB.inside} 帧`);

    /* 12. 门口通行：合成地图上 2.4 m 门洞，必须从门洞中间穿过 */
    const door = await cdp.eval(`
      const m = await import('/js/game/bots.js');
      const boxes = [
        { minX: -0.4, maxX: 0.4, minY: 0, maxY: 3, minZ: -12, maxZ: -1.2 },
        { minX: -0.4, maxX: 0.4, minY: 0, maxY: 3, minZ: 1.2, maxZ: 12 },
        { minX: -30, maxX: 30, minY: -1, maxY: 0, minZ: -30, maxZ: 30 }
      ];
      const nav = new m.NavGrid({ boxes });
      const p = nav.path(-6, 0, 6, 0);
      if (!p) return { ok: false, crossZ: null, pts: 0 };
      let crossZ = null;
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], c = p[i + 1];
        if ((a.x < 0) !== (c.x < 0)) crossZ = a.z + (c.z - a.z) * (0 - a.x) / (c.x - a.x);
      }
      return { ok: true, pts: p.length, crossZ: crossZ == null ? null : +crossZ.toFixed(2) };
    `);
    check('门口通行（2.4 m 门洞）', door.ok && door.crossZ != null && Math.abs(door.crossZ) < 1.2,
      door.ok ? ('路径 ' + door.pts + ' 点，穿门 z=' + door.crossZ) : '不可达');

    /* 13. 卡住恢复：撞死墙后必须在 2 s 内换航点，且不能穿墙 */
    const stuck = await cdp.eval(`
      const g = window.__game;
      const Bot = g.bots[0].constructor;
      const stub = { add() {}, remove() {} };
      const world = {
        boxes: [{ minX: -6, maxX: 6, minY: 0, maxY: 3, minZ: 1.2, maxZ: 2.2 }],
        move(pos, vel, dt, radius) {
          const hit = (x, z) => x > -6 - radius && x < 6 + radius && z > 1.2 - radius && z < 2.2 + radius;
          const nx = pos.x + vel.x * dt;
          const nz = pos.z + vel.z * dt;
          if (!hit(pos.x, nz)) pos.z = nz; else vel.z = 0;
          if (!hit(nx, pos.z)) pos.x = nx; else vel.x = 0;
          return true;
        },
        lineOfSight() { return false; }
      };
      const b = new Bot(stub, { x: 0, z: 0 }, world, { team: 'ct' });
      const goals = [{ x: 0, z: 6 }, { x: 0, z: -4 }];
      b.waypoint = 0;
      const ctx = { player: { alive: false }, tBots: [], ctBots: [] };
      const cb = { onBotShoot() {}, onBotReload() {} };
      let recover = -1, maxStuck = 0, zMax = -1e9;
      for (let i = 0; i < 64 * 3; i++) {
        b.update(1 / 64, ctx, goals, cb);
        zMax = Math.max(zMax, b.pos.z);
        if (b.waypoint > 0) { if (recover < 0) recover = i / 64; }
        else maxStuck = Math.max(maxStuck, b.stuck);
      }
      return { recover: +recover.toFixed(2), maxStuck: +maxStuck.toFixed(2), zMax: +zMax.toFixed(2) };
    `);
    check('卡住 2 s 内换航点且不穿墙',
      stuck.recover > 0 && stuck.maxStuck > 0.4 && stuck.maxStuck < 2.0 && stuck.zMax < 1.0,
      '卡住 ' + stuck.maxStuck + ' s 后恢复（总 ' + stuck.recover + ' s），最远 z=' + stuck.zMax);

    /* 13. 阶段 2：角色分工 + Bot 下包 + CT Bot 拆包 */
    const roleInfo = await cdp.eval(`
      const g = window.__game;
      const c = { entry: 0, anchor: 0, rotator: 0 };
      for (const b of g.bots) c[b.role] = (c[b.role] || 0) + 1;
      return { c, n: g.bots.length, all: g.bots.every((b) => !!b.role) };
    `);
    check('Bot 角色分三档', roleInfo.all && roleInfo.c.entry > 0 && roleInfo.c.anchor > 0 && roleInfo.c.rotator > 0,
      `entry=${roleInfo.c.entry} anchor=${roleInfo.c.anchor} rotator=${roleInfo.c.rotator} / 共 ${roleInfo.n}`);

    const bombFlow = await cdp.eval(`
      const g = window.__game;
      const A = g.map.sites.A;
      const t = g.allyBots[0], ct = g.enemyBots[0];
      // 只留两个 Bot，其余判死：避免中途互相清场导致回合提前结束
      for (const b of g.bots) {
        if (b === t || b === ct) continue;
        b.alive = false; b.hp = 0; b.group.visible = false;
      }
      g.player.alive = false; g.player.hp = 0;
      t.reset(); ct.reset();
      t.pos.set(A.x, 0, A.z); t.group.position.copy(t.pos);
      ct.pos.set(-6, 0, -34); ct.group.position.copy(ct.pos);
      g.round.phase = 'live';
      g.round.timer = 100;
      g.round._plantSite = 'A';
      g.round.bomb = null;

      let assigned = false, planted = false, plantFrames = 0;
      for (let i = 0; i < 64 * 20; i++) {
        g.simulate(1 / 64);
        plantFrames++;
        if (g.round._planter === t) assigned = true;
        if (g.round.phase === 'planted') { planted = true; break; }
      }
      const bomb = g.round.bomb ? { x: +g.round.bomb.x.toFixed(1), z: +g.round.bomb.z.toFixed(1) } : null;

      // 下包后把 T 撤掉，否则双方交火会打断拆包
      t.alive = false; t.hp = 0; t.group.visible = false;
      const beforeCT = g.round.scoreCT;
      let defused = false, defuseFrames = 0, sawProgress = false;
      if (bomb) {
        ct.pos.set(bomb.x + 0.6, 0, bomb.z);
        ct.group.position.copy(ct.pos);
        for (let i = 0; i < 64 * 20; i++) {
          g.simulate(1 / 64);
          defuseFrames++;
          if (g.round._defuseProgress > 0.2) sawProgress = true;
          if (g.round.phase === 'ended') { defused = true; break; }
        }
      }
      const out = { assigned, planted, plantFrames, bomb, defused, defuseFrames, sawProgress,
        result: g.round.result, scoreCT: g.round.scoreCT - beforeCT, bombGone: g.round.bomb === null };
      g.round.start();   // 还原成干净的冻结局，避免影响后面的渲染断言
      return out;
    `);
    check('T Bot 走到包点自动下包', bombFlow.assigned && bombFlow.planted && bombFlow.bomb,
      `指派=${bombFlow.assigned} 下包=${bombFlow.planted} 耗时 ${(bombFlow.plantFrames / 64).toFixed(1)} s` +
      (bombFlow.bomb ? ` 落点 (${bombFlow.bomb.x}, ${bombFlow.bomb.z})` : ''));
    check('CT Bot 拆包成功并判 CT 胜', bombFlow.defused && bombFlow.result === false && bombFlow.scoreCT === 1 && bombFlow.bombGone,
      `拆包=${bombFlow.defused} 进度出现过=${bombFlow.sawProgress} 耗时 ${(bombFlow.defuseFrames / 64).toFixed(1)} s ` +
      `结果=${bombFlow.result} CT+${bombFlow.scoreCT}`);

    /* 14. 加时赛 + 连败补偿（T-003 阶段 3a） */
    const otInfo = await cdp.eval(`
      const g = window.__game;
      const r = g.round;

      // --- 连败补偿：连续输 4 局，应拿到 1400 / 1900 / 2400 / 2900 ---
      r.beginMatch(r.mode);
      g.money = 800;
      const gains = [];
      for (let i = 0; i < 4; i++) {
        const before = g.money;
        r.end(false, 'test');
        gains.push(g.money - before);
        r.phase = 'freeze';       // 跳过 4 s 结算，直接进下一局
        r.matchOver = false;
        r.endTimer = 0;
      }
      const streak4 = r.lossStreak.t;
      // 赢一局后自己的连败清零，对手连败 +1
      r.end(true, 'test');
      const streakWin = r.lossStreak.t;
      const oppStreak = r.lossStreak.ct;

      // --- 加时：12:12 触发，起始资金 10000，先到 4 分结束 ---
      r.beginMatch(r.mode);
      g.money = 800;
      r.scoreT = 12; r.scoreCT = 11;
      r.end(false, 'test');        // CT 赢 → 12:12
      const ot1 = r.overtime;
      const notOver = !r.matchOver;
      r.update(4.1);               // 结算结束 → 加时第 1 回合 start
      const otMoney = g.money;
      const otPhase = r.phase;
      r.scoreT = r.otBase.t + 4;
      r.end(true, 'test');
      const otFinished = r.matchOver;

      // --- 加时 3:3 进入下一个加时（最多 3 个） ---
      r.beginMatch(r.mode);
      r.overtime = 1; r.otBase = { t: 12, ct: 12 };
      r.scoreT = 14; r.scoreCT = 15;
      r.end(true, 'test');         // 15:15 → 加时 3:3
      const ot2 = r.overtime;
      const ot2Base = r.otBase.t + ':' + r.otBase.ct;

      // --- 第 3 个加时仍 3:3 → 战平收场 ---
      r.beginMatch(r.mode);
      r.overtime = 3; r.otBase = { t: 15, ct: 15 };
      r.scoreT = 17; r.scoreCT = 18;
      r.end(true, 'test');         // 18:18 → 3 个加时打满
      const drawOver = r.matchOver && r.draw;

      // 复位，别污染后面的渲染断言
      r.beginMatch(r.mode);
      g.money = 800;
      g.hud.setMoney(g.money);

      return { gains, streak4, streakWin, oppStreak, ot1, notOver, otMoney, otPhase,
        otFinished, ot2, ot2Base, drawOver,
        curve: [1, 2, 3, 4, 5, 6].map((n) => r._lossBonus(n)) };
    `);
    check('连败补偿按 1400/1900/2400/2900 递增',
      JSON.stringify(otInfo.gains) === JSON.stringify([1400, 1900, 2400, 2900]) && otInfo.streak4 === 4,
      'gains=' + JSON.stringify(otInfo.gains) + ' 连败=' + otInfo.streak4);
    check('连败补偿第 5 局起封顶 3400',
      otInfo.curve[4] === 3400 && otInfo.curve[5] === 3400,
      '曲线=' + JSON.stringify(otInfo.curve));
    check('赢一局重置连败计数',
      otInfo.streakWin === 0 && otInfo.oppStreak === 1,
      '自己=' + otInfo.streakWin + ' 对手=' + otInfo.oppStreak);
    check('12:12 进入加时且发 10000',
      otInfo.ot1 === 1 && otInfo.notOver && otInfo.otMoney === 10000 && otInfo.otPhase === 'freeze',
      '加时=' + otInfo.ot1 + ' 起始资金=' + otInfo.otMoney + ' 阶段=' + otInfo.otPhase);
    check('加时先到 4 分结束比赛',
      otInfo.otFinished === true, 'matchOver=' + otInfo.otFinished);
    check('加时 3:3 进入下一个加时',
      otInfo.ot2 === 2 && otInfo.ot2Base === '15:15',
      '第 ' + otInfo.ot2 + ' 个加时，基准 ' + otInfo.ot2Base);
    check('三个加时后 3:3 判战平',
      otInfo.drawOver === true, 'matchOver+draw=' + otInfo.drawOver);

    /* 15. Bot 经济：钱包 / 击杀 / 回合 / 下包 / 拆包 / 封顶（T-009 阶段 1） */
    const botEco = await cdp.eval(`
      const g = window.__game;
      const r = g.round;
      const CAP = 16000;
      r.beginMatch(r.mode);
      const startMoney = r.mode.startMoney || 800;
      const init = g.bots.map((b) => b.money);
      const b0 = g.bots[0], b1 = g.bots[1];
      const keep = b0.money;
      b0.money += 500;
      const independent = b1.money === keep;
      b0.money = keep;

      // 击杀：T Bot 走 game._onBotShoot 真实链路打死 CT Bot
      const t = g.allyBots[0], ct = g.enemyBots[0];
      t.reset(); ct.reset();
      t.money = 800; ct.money = 800;
      const k0 = t.kills;
      let shots = 0;
      while (ct.alive && shots < 40) {
        g._onBotShoot(t, { hit: true, head: false, dir: { x: 0, y: 0, z: 1 } }, ct);
        shots++;
      }
      r.update(0);
      const killCount = t.kills - k0;
      const killGain = t.money - 800;

      // 回合：CT 胜 → CT Bot +3250，T Bot 首败 +1400
      const tBefore = t.money, ctBefore = ct.money;
      r.end(false, 'test');
      const lossGain = t.money - tBefore;
      const winGain = ct.money - ctBefore;

      // 第二连败 → +1900
      r.phase = 'freeze'; r.matchOver = false; r.endTimer = 0;
      const tBefore2 = t.money;
      r.end(false, 'test');
      const lossGain2 = t.money - tBefore2;

      // 下包奖励：actor 是 Bot 时进 Bot 钱包
      r.phase = 'live'; r.removeBomb();
      const pm = t.money;
      r.plant('A', { x: 44, y: 0, z: 16 }, t);
      const plantGain = t.money - pm;
      r.removeBomb();

      // 拆包：300 拆包奖 + 3250 回合胜利
      r.bomb = { x: 44, z: 16, site: 'A' };
      r.phase = 'planted';
      r._defuseProgress = 0.99;
      r._defuser = ct;
      ct.alive = true; ct.holding = true; ct.engage = false;
      ct.pos.set(44, 0, 16); ct.group.position.copy(ct.pos);
      const cm = ct.money;
      r._defuseLogic(0.2);
      const defuseGain = ct.money - cm;

      // 封顶
      r._addBotMoney(t, 999999, 'cap-test');
      const capped = t.money === CAP;

      // 日志（重置前取，重置会清空）
      const logLen = r.economyLog.length;
      const logOk = logLen > 0 && r.economyLog.every((e) =>
        e.bot && e.team && e.reason && Number.isFinite(e.money) && Number.isFinite(e.delta));
      const reasons = Array.from(new Set(r.economyLog.map((e) => e.reason)));

      // 比赛开始重置
      r.beginMatch(r.mode);
      const afterReset = g.bots.every((b) => b.money === startMoney);

      return { startMoney, init, independent, shots, killCount, killGain,
        lossGain, winGain, lossGain2, plantGain, defuseGain, capped,
        logLen, logOk, reasons, afterReset };
    `);
    check('Bot 初始钱包按模式起始资金且互相独立',
      botEco.init.every((m) => m === botEco.startMoney) && botEco.independent,
      'startMoney=' + botEco.startMoney + ' 数量=' + botEco.init.length + ' init=' + JSON.stringify(botEco.init));
    check('Bot 击杀奖励 300', botEco.killCount === 1 && botEco.killGain === 300,
      '击杀=' + botEco.killCount + ' 奖励=' + botEco.killGain + ' (' + botEco.shots + ' 枪)');
    check('Bot 回合胜负结算', botEco.lossGain === 1400 && botEco.winGain === 3250,
      '败方 +' + botEco.lossGain + ' / 胜方 +' + botEco.winGain);
    check('Bot 连败补偿递增', botEco.lossGain2 === 1900, '第 2 连败 +' + botEco.lossGain2);
    check('Bot 下包奖励 300', botEco.plantGain === 300, '+' + botEco.plantGain);
    check('Bot 拆包奖励 300 + 回合胜利', botEco.defuseGain === 3550, '+' + botEco.defuseGain);
    check('Bot 经济封顶 16000', botEco.capped === true, 'cap=' + botEco.capped);
    check('经济日志可核对', botEco.logOk && botEco.logLen > 0,
      botEco.logLen + ' 条 / 类型=' + JSON.stringify(botEco.reasons));
    check('比赛开始重置 Bot 经济', botEco.afterReset === true,
      '全部回到 ' + botEco.startMoney + ' / afterReset=' + botEco.afterReset + ' init=' + JSON.stringify(botEco.init));

    /* 16. 半场交换（T-003 阶段 3b） */
    const swapInfo = await cdp.eval(`
      const g = window.__game;
      const r = g.round;
      const A = g.map.sites.A;

      // 常规赛第 12 局结束（7:5）→ 排队换边，下一回合生效
      r.beginMatch(r.mode);
      r.scoreT = 6; r.scoreCT = 5; r.round = 12;
      const sideBefore = r.playerSide;
      r.end(true, 'test');
      const pending = r._swapPending;
      const sideAtEnd = r.playerSide;            // 结算时还没换
      const scoreKeep = [r.scoreT, r.scoreCT];

      r.update(4.1);                             // 进入下半场
      const sideAfter = r.playerSide;
      const ctSpawn = [g.map.spawns.playerCT.x, g.map.spawns.playerCT.z];
      const pos = [g.player.position.x, g.player.position.z];
      const atCTSpawn = Math.hypot(pos[0] - ctSpawn[0], pos[1] - ctSpawn[1]) < 0.5;
      const moneyReset = g.money === (r.mode.startMoney || 800);
      const botMoneyReset = g.bots.every((b) => b.money === (r.mode.startMoney || 800));
      const scoreStill = r.scoreT === scoreKeep[0] && r.scoreCT === scoreKeep[1];

      // 阵容与视角：tBots/ctBots 按阵营稳定，allyBots/enemyBots 按玩家视角翻转
      const tAll = g.tBots.every((b) => b.team === 't');
      const ctAll = g.ctBots.every((b) => b.team === 'ct');
      const allyCT = g.allyBots.every((b) => b.team === 'ct');
      const enemyT = g.enemyBots.every((b) => b.team === 't');

      // 换边后：下包必须指派给 T 方，拆包给 CT 方
      r.phase = 'live'; r.timer = 100; r._plantSite = 'A';
      r._assignBotObjectives('live');
      const planterTeam = r._planter ? r._planter.team : null;
      r.phase = 'planted';
      r.bomb = { x: A.x, z: A.z, site: 'A' };
      r._assignBotObjectives('planted');
      const defuserTeam = r._defuser ? r._defuser.team : null;
      r.phase = 'freeze';

      // 玩家是 CT 时按住使用键也不能下包
      const prevIsDown = g.input.isDown;
      g.input.isDown = () => true;
      g.player.alive = true; g.player.position.set(A.x, 0, A.z);
      r.plantProgress = 0;
      r._plantLogic(0.5);
      const ctCannotPlant = r.plantProgress === 0;
      g.input.isDown = prevIsDown;

      // 加时：每 3 局换边
      r.beginMatch(r.mode);
      r.overtime = 1; r.otBase = { t: 12, ct: 12 };
      r.scoreT = 12; r.scoreCT = 12; r.round = 25; r._otRoundCount = 0;
      for (let i = 0; i < 3; i++) {
        r.phase = 'live';
        r.end(true, 'test');
        if (!r.matchOver) r.phase = 'freeze';
      }
      const otPending = r._swapPending;
      const otScore = [r.scoreT, r.scoreCT];

      // 复位
      r.beginMatch(r.mode);
      g.money = 800;
      g.hud.setMoney(g.money);

      return { sideBefore, pending, sideAtEnd, sideAfter, atCTSpawn, moneyReset,
        botMoneyReset, scoreStill, tAll, ctAll, allyCT, enemyT,
        planterTeam, defuserTeam, ctCannotPlant, otPending, otScore };
    `);
    check('第 12 局结束排队换边',
      swapInfo.sideBefore === 't' && swapInfo.pending && swapInfo.sideAtEnd === 't',
      '结算前=' + swapInfo.sideBefore + ' 排队=' + swapInfo.pending + ' 结算时=' + swapInfo.sideAtEnd);
    check('下半场玩家切到 CT 并换出生点',
      swapInfo.sideAfter === 'ct' && swapInfo.atCTSpawn,
      '阵营=' + swapInfo.sideAfter + ' 在 CT 出生点=' + swapInfo.atCTSpawn);
    check('换边后阵容与视角正确',
      swapInfo.tAll && swapInfo.ctAll && swapInfo.allyCT && swapInfo.enemyT,
      'tBots=T ' + swapInfo.tAll + ' / ctBots=CT ' + swapInfo.ctAll +
      ' / 队友=CT ' + swapInfo.allyCT + ' / 敌人=T ' + swapInfo.enemyT);
    check('换边保留比分并重置经济',
      swapInfo.scoreStill && swapInfo.moneyReset && swapInfo.botMoneyReset,
      '比分保留=' + swapInfo.scoreStill + ' 玩家钱=' + swapInfo.moneyReset + ' Bot 钱=' + swapInfo.botMoneyReset);
    check('换边后下包归 T / 拆包归 CT',
      swapInfo.planterTeam === 't' && swapInfo.defuserTeam === 'ct',
      '下包=' + swapInfo.planterTeam + ' 拆包=' + swapInfo.defuserTeam);
    check('CT 玩家不能下包', swapInfo.ctCannotPlant === true, '进度未推进=' + swapInfo.ctCannotPlant);
    check('加时每 3 局换边',
      swapInfo.otPending === true && swapInfo.otScore[0] === 15 && swapInfo.otScore[1] === 12,
      '排队=' + swapInfo.otPending + ' 比分=' + swapInfo.otScore.join(':'));

    /* 17. Bot 购买与武器差异（T-009 阶段 2） */
    const buyInfo = await cdp.eval(`
      const g = window.__game;
      const r = g.round;
      r.beginMatch(r.mode);
      const b = g.bots[0];

      // 买满：4000 → AK 2700 + 护甲 650
      b.money = 4000;
      r.start();
      const richWeapon = b.weaponId, richMoney = b.money, richArmor = b.armor;

      // eco：1500 存钱，不硬买
      b.money = 1500; b.weaponId = 'glock'; b.armor = 0;
      r.start();
      const ecoWeapon = b.weaponId, ecoMoney = b.money;

      // 只够枪：2800 → AK，剩 100，买不起甲
      b.money = 2800; b.weaponId = 'glock'; b.armor = 0;
      r.start();
      const gunOnlyWeapon = b.weaponId, gunOnlyMoney = b.money, gunOnlyArmor = b.armor;

      // 护甲减伤：40 伤害 → 20 hp，护甲 -20
      b.alive = true; b.hp = 100; b.armor = 100;
      b.damage(40);
      const armoredHp = b.hp, armoredArmor = b.armor;

      // 无甲：40 伤害全吃
      b.alive = true; b.hp = 100; b.armor = 0;
      b.damage(40);
      const bareHp = b.hp;

      // 射速：AK 的射击间隔显著短于 Glock
      b.weaponId = 'ak';
      let akDelay = 0;
      for (let i = 0; i < 200; i++) akDelay += b._shotDelay();
      b.weaponId = 'glock';
      let glockDelay = 0;
      for (let i = 0; i < 200; i++) glockDelay += b._shotDelay();

      // 精度：同一距离 AK 散布更小
      b.weaponId = 'ak';
      const akSpread = b._spreadAt(20);
      b.weaponId = 'glock';
      const glockSpread = b._spreadAt(20);

      // 死亡掉枪
      b.weaponId = 'ak'; b.alive = false;
      b.reset();
      const droppedWeapon = b.weaponId;

      // 复位
      r.beginMatch(r.mode);
      g.money = 800; g.hud.setMoney(g.money);

      return { richWeapon, richMoney, richArmor, ecoWeapon, ecoMoney,
        gunOnlyWeapon, gunOnlyMoney, gunOnlyArmor,
        armoredHp, armoredArmor, bareHp,
        akDelay: +(akDelay / 200).toFixed(3), glockDelay: +(glockDelay / 200).toFixed(3),
        akSpread: +akSpread.toFixed(4), glockSpread: +glockSpread.toFixed(4),
        droppedWeapon };
    `);
    check('有钱买 AK + 护甲',
      buyInfo.richWeapon === 'ak' && buyInfo.richMoney === 650 && buyInfo.richArmor === 100,
      `武器=${buyInfo.richWeapon} 余额=${buyInfo.richMoney} 护甲=${buyInfo.richArmor}`);
    check('eco 存钱不硬买',
      buyInfo.ecoWeapon === 'glock' && buyInfo.ecoMoney === 1500,
      `武器=${buyInfo.ecoWeapon} 余额=${buyInfo.ecoMoney}`);
    check('只够枪时先买枪',
      buyInfo.gunOnlyWeapon === 'ak' && buyInfo.gunOnlyMoney === 100 && buyInfo.gunOnlyArmor === 0,
      `武器=${buyInfo.gunOnlyWeapon} 余额=${buyInfo.gunOnlyMoney} 护甲=${buyInfo.gunOnlyArmor}`);
    check('护甲吸收一半伤害',
      buyInfo.armoredHp === 80 && buyInfo.armoredArmor === 80 && buyInfo.bareHp === 60,
      `有甲 hp=${buyInfo.armoredHp} armor=${buyInfo.armoredArmor} / 无甲 hp=${buyInfo.bareHp}`);
    check('AK 射速快于手枪',
      buyInfo.akDelay < buyInfo.glockDelay * 0.85,
      `AK ${buyInfo.akDelay}s / Glock ${buyInfo.glockDelay}s`);
    check('AK 精度高于手枪',
      buyInfo.akSpread < buyInfo.glockSpread,
      `AK ${buyInfo.akSpread} / Glock ${buyInfo.glockSpread} @20m`);
    check('Bot 死亡掉枪', buyInfo.droppedWeapon === 'glock', '复活武器=' + buyInfo.droppedWeapon);

    /* 18. 战术执行：execute / retake / 角色站位（T-009 阶段 3） */
    const tactic = await cdp.eval(`
      const g = window.__game;
      const r = g.round;
      const A = g.map.sites.A;
      const distToA = (b) => Math.hypot(b.pos.x - A.x, b.pos.z - A.z);
      const avg = (arr) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
      const goalD = (b) => (b.objective ? Math.hypot(b.objective.x - A.x, b.objective.z - A.z) : 999);

      // --- 1) LIVE 指派：T 全队 execute，entry 压点、anchor 拖后 ---
      r.beginMatch(r.mode);
      g.player.alive = false; g.player.hp = 0;
      r.phase = 'live'; r.timer = 120; r._plantSite = 'A';
      r._assignBotObjectives('live');
      const tAlive = g.tBots.filter((b) => b.alive);
      const pushCount = tAlive.filter((b) =>
        b.objective && (b.objective.type === 'push' || b.objective.type === 'plant')).length;
      const entry = tAlive.find((b) => b.role === 'entry');
      const anchor = tAlive.find((b) => b.role === 'anchor');
      const entryGoalD = entry ? +goalD(entry).toFixed(1) : 999;
      const anchorGoalD = anchor ? +goalD(anchor).toFixed(1) : 999;
      const planterType = r._planter && r._planter.objective ? r._planter.objective.type : null;
      const ctGuard = g.ctBots.filter((b) =>
        b.alive && b.objective && b.objective.type === 'guard').length;

      // --- 2) 8 秒纯 Bot 推进：T 平均距 A 应明显缩短 ---
      const beforeD = avg(g.tBots.filter((b) => b.alive).map(distToA));
      for (let i = 0; i < 64 * 8; i++) {
        if (r.phase === 'ended') break;
        g.simulate(1 / 64);
      }
      const afterD = avg(g.tBots.filter((b) => b.alive).map(distToA));

      // --- 3) 下包后指派：T 散开守包、CT 回防、拆包人最近 ---
      r.beginMatch(r.mode);
      const ct0 = g.ctBots[0];
      ct0.pos.set(A.x + 1, 0, A.z); ct0.group.position.copy(ct0.pos);
      g.player.alive = false; g.player.hp = 0;
      r.phase = 'planted'; r.timer = 40;
      r.bomb = { x: A.x, z: A.z, site: 'A' };
      r._assignBotObjectives('planted');
      const tGuard = g.tBots.filter((b) =>
        b.alive && b.objective && b.objective.type === 'guard').length;
      const ctRetake = r._defuser
        ? 1 + g.ctBots.filter((b) => b.alive && b !== r._defuser &&
            b.objective && b.objective.type === 'retake').length
        : 0;
      const defuserIsClosest = r._defuser === ct0;
      const retakeNear = g.ctBots
        .filter((b) => b.alive && b.objective && b.objective.type === 'retake')
        .every((b) => Math.hypot(b.objective.x - A.x, b.objective.z - A.z) <= 8.5);

      r.beginMatch(r.mode);
      g.money = 800; g.hud.setMoney(g.money);

      return { pushCount, tCount: tAlive.length, planterType, entryGoalD, anchorGoalD, ctGuard,
        beforeD: +beforeD.toFixed(1), afterD: +afterD.toFixed(1),
        tGuard, ctRetake, defuserIsClosest, retakeNear };
    `);
    check('T 全队执行 execute',
      tactic.pushCount === tactic.tCount && tactic.tCount >= 4 && tactic.planterType === 'plant',
      `有目标=${tactic.pushCount}/${tactic.tCount} 下包人任务=${tactic.planterType}`);
    check('entry 比 anchor 更靠前',
      tactic.entryGoalD < tactic.anchorGoalD && tactic.entryGoalD <= 2.5,
      `entry 目标距 A ${tactic.entryGoalD} m / anchor ${tactic.anchorGoalD} m`);
    check('CT anchor 守包点', tactic.ctGuard >= 1, '守点 anchor=' + tactic.ctGuard);
    check('execute 让 T 集体压上',
      tactic.afterD < tactic.beforeD - 5,
      `平均距 A ${tactic.beforeD} → ${tactic.afterD} m`);
    check('下包后 T 散开守包', tactic.tGuard >= 3, '守包人数=' + tactic.tGuard);
    check('下包后 CT 全员回防',
      tactic.ctRetake >= 3 && tactic.defuserIsClosest && tactic.retakeNear,
      `回防=${tactic.ctRetake} 最近的人拆包=${tactic.defuserIsClosest} 目标都在炸弹 8.5 m 内=${tactic.retakeNear}`);


    /* 19. 渲染开销 */
    const perf = await cdp.eval(`
      const g = window.__game;
      await new Promise((r) => setTimeout(r, 200));
      const info = g.engine.renderer.info;
      return { calls: info.render.calls, tris: info.render.triangles, textures: info.memory.textures };
    `);
    // v0.3 增加 A 大/B 洞立面、集装箱、道具展台后，对局基线上升到 ~88 calls；仍远低于 120 预算
    check('draw call ≤ 120', perf.calls <= 120, 'calls=' + perf.calls);
    // v0.2 换成真武器/人物模型后三角面上调；仍远低于 PRINCIPLES 的 250k 移动端预算
    check('三角形 ≤ 80000', perf.tris <= 80000, 'tris=' + perf.tris);

    /* 20. 合成地图：地图无关回归（T-011） */
    const fixture = await cdp.eval(`
      const { buildFixtureMap, createArena } = await import('/tools/map-fixture.mjs');
      const map = buildFixtureMap({ siteCount: 2 });

      // 契约自查：字段名与 buildMap() 完全一致
      const contract = {
        hasWorld: !!(map.world && map.world.colliders && typeof map.world.raycast === 'function'),
        hasRoot: !!map.root,
        bounds: map.bounds,
        siteKeys: Object.keys(map.sites),
        spawnKeys: Object.keys(map.spawns),
        waypoints: map.waypoints.length,
        callouts: Object.keys(map.callouts).length,
        buyZone: !!map.buyZone
      };

      const arena = await createArena(map);
      arena.begin();
      // 固定攻打 A，保证断言可复现（随机选点本身也是被测行为）
      arena.round._plantSite = 'A';

      // 1) A*：T 出生点 → A 点。中墙挡路，路径必须绕行（长于直线）
      const siteA = map.sites.A;
      const path = arena.tBots[0].nav.path(0, -26, siteA.x, siteA.z);
      let pathLen = 0;
      if (path) {
        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          const q = path[i - 1] || { x: 0, z: -26 };
          pathLen += Math.hypot(p.x - q.x, p.z - q.z);
        }
      }
      const straight = Math.hypot(siteA.x, siteA.z + 26);

      // 2) 下包：进入 live 后由 round 指派，Bot 自己走到包点
      const live = arena.runUntil((r) => r.phase === 'live', 64 * 16);
      const planted = arena.runUntil((r) => r.phase === 'planted', 64 * 45);
      const plantState = arena.state();

      // 3) 拆包 + 结算：CT Bot 自己走到炸弹
      const defused = planted ? arena.runUntil((r) => r.phase === 'ended', 64 * 45) : false;
      const endState = arena.state();

      return {
        contract, live, planted, defused, plantState, endState,
        pathing: { cells: path ? path.length : 0, pathLen: +pathLen.toFixed(1), straight: +straight.toFixed(1) }
      };
    `);

    const fc = fixture.contract;
    const EXPECT_SPAWNS = ['player', 'playerCT', 'allies', 'ctAllies', 'bots', 'tBots'];
    check('合成地图契约与 map.js 一致',
      fc.hasWorld && fc.hasRoot && fc.buyZone && fc.callouts > 0 &&
      EXPECT_SPAWNS.every((k) => fc.spawnKeys.indexOf(k) >= 0) && fc.waypoints > 0,
      `spawns=${fc.spawnKeys.length} waypoints=${fc.waypoints} callouts=${fc.callouts}`);
    check('合成地图 64×64 且两个包点',
      fc.bounds.maxX - fc.bounds.minX === 64 && fc.bounds.maxZ - fc.bounds.minZ === 64 &&
      fc.siteKeys.join('/') === 'A/B',
      `${fc.bounds.maxX - fc.bounds.minX}×${fc.bounds.maxZ - fc.bounds.minZ} sites=${fc.siteKeys.join('/')}`);
    check('合成地图 A* 绕开中墙',
      fixture.pathing.cells > 0 && fixture.pathing.pathLen > fixture.pathing.straight + 4,
      `路径 ${fixture.pathing.cells} 格 ${fixture.pathing.pathLen} m / 直线 ${fixture.pathing.straight} m`);
    check('合成地图 Bot 走到包点自动下包',
      fixture.planted && fixture.plantState.bomb && fixture.plantState.bomb.site === 'A' &&
      Math.hypot(fixture.plantState.bomb.x - 18, fixture.plantState.bomb.z - 10) <= 5,
      `phase=${fixture.plantState.phase} bomb=${JSON.stringify(fixture.plantState.bomb)} 站点=${fixture.plantState.plantSite}`);
    check('合成地图 CT Bot 拆包并结算',
      fixture.defused && fixture.endState.phase === 'ended' &&
      fixture.endState.result === false && fixture.endState.score[1] === 1 && !fixture.endState.bomb,
      `phase=${fixture.endState.phase} result=${fixture.endState.result} 比分=${fixture.endState.score.join(':')}`);

    /* 21. 三包点地图：包点数量不再写死（T-011） */
    const fixture3 = await cdp.eval(`
      const { buildFixtureMap, createArena } = await import('/tools/map-fixture.mjs');
      const map = buildFixtureMap({ siteCount: 3 });
      const arena = await createArena(map);
      arena.begin();
      arena.runUntil((r) => r.phase === 'live', 64 * 16);
      const r = arena.round;
      r._plantSite = 'C';
      r._assignBotObjectives('live');
      const planter = r._planter;
      const obj = planter && planter.objective;
      const target = obj ? { x: +obj.x.toFixed(1), z: +obj.z.toFixed(1), r: obj.r } : null;
      // 强制换包点后必须重新指派，不能继续用旧目标
      r._plantSite = 'B';
      r._assignBotObjectives('live');
      const obj2 = r._planter && r._planter.objective;
      return {
        keys: r.siteKeys(),
        label: r.siteLabel(),
        target,
        siteC: { x: +map.sites.C.x.toFixed(1), z: +map.sites.C.z.toFixed(1), r: map.sites.C.r },
        retarget: obj2 ? { x: +obj2.x.toFixed(1), z: +obj2.z.toFixed(1) } : null,
        siteB: { x: +map.sites.B.x.toFixed(1), z: +map.sites.B.z.toFixed(1) }
      };
    `);
    check('三包点地图：site 键与 HUD 标签按地图生成',
      fixture3.keys.join('/') === 'A/B/C' && fixture3.label === 'A / B / C',
      `keys=${fixture3.keys.join('/')} label="${fixture3.label}"`);
    check('三包点地图：第三个点能被指派为下包点',
      !!fixture3.target && fixture3.target.x === fixture3.siteC.x &&
      fixture3.target.z === fixture3.siteC.z && fixture3.target.r === fixture3.siteC.r,
      `objective=${JSON.stringify(fixture3.target)} / siteC=${JSON.stringify(fixture3.siteC)}`);
    check('三包点地图：换包点后目标跟着改',
      !!fixture3.retarget && fixture3.retarget.x === fixture3.siteB.x && fixture3.retarget.z === fixture3.siteB.z,
      `objective=${JSON.stringify(fixture3.retarget)} / siteB=${JSON.stringify(fixture3.siteB)}`);

    /* 22. 整场回归：纯 Bot 从开局打到结束（T-009 阶段 4） */
    const matchSoak = await cdp.eval(`
      const g = window.__game;
      const r = g.round;
      const origMode = r.mode;
      // 压缩时间参数：先到 3 分，2 局后换边，单局 20 秒
      const fast = Object.assign({}, origMode, {
        winScore: 3, freezeTime: 0.3, roundTime: 20, bombTime: 8
      });
      r.beginMatch(fast);
      let err = null, frames = 0;
      for (let i = 0; i < 64 * 400; i++) {
        try { g.simulate(1 / 64); } catch (e) { err = e.message; break; }
        frames++;
        if (r.matchOver) break;
      }
      const nan = g.bots.filter((b) => !Number.isFinite(b.pos.x + b.pos.y + b.pos.z)).length;
      const scoreOk = r.scoreT >= 0 && r.scoreT <= 6 && r.scoreCT >= 0 && r.scoreCT <= 6;
      const out = {
        err, frames, matchOver: r.matchOver, score: [r.scoreT, r.scoreCT],
        swapCount: r.swapCount, overtime: r.overtime, nan,
        botsAlive: g.bots.filter((b) => b.alive).length,
        moneyOk: g.bots.every((b) => b.money >= 0 && b.money <= 16000)
      };
      r.beginMatch(origMode);
      g.money = 800; g.hud.setMoney(g.money);
      return out;
    `);
    check('整场对局无异常', matchSoak.err === null,
      matchSoak.err ? matchSoak.err : `模拟 ${(matchSoak.frames / 64).toFixed(0)} s 无抛错`);
    check('整场比分与坐标合法',
      matchSoak.matchOver && matchSoak.score[0] <= 3 && matchSoak.score[1] <= 3 &&
      matchSoak.nan === 0 && matchSoak.moneyOk,
      `比分 ${matchSoak.score.join(':')} / NaN=${matchSoak.nan} / 钱包合法=${matchSoak.moneyOk}`);
    check('整场至少换边一次', matchSoak.swapCount >= 1,
      `换边 ${matchSoak.swapCount} 次 / 加时 ${matchSoak.overtime}`);

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
