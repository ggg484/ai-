// Builda SDK 薄封装。
// 规则：所有平台能力都从这里出去，业务代码不直接碰 window.Builda / 宿主 bridge。
// 没有宿主时（本地浏览器直开）全部降级为 no-op，游戏仍可运行。

const sdk = typeof window !== 'undefined' ? window.Builda : null;

export const hasHost = !!(sdk && sdk.runtime);

/** 必须在入口第一时间调用。 */
export function ready() {
  try {
    if (sdk && sdk.runtime && sdk.runtime.ready) {
      sdk.runtime.ready().catch(function () {});
    }
  } catch (e) { /* 平台不可用时不影响本地预览 */ }
}

export function hostVersion() {
  try { return sdk && sdk.runtime ? sdk.runtime.appVersion() : '1.83.0'; } catch (e) { return '1.83.0'; }
}

export function language() {
  try { return (sdk && sdk.runtime && sdk.runtime.language()) || 'zh'; } catch (e) { return 'zh'; }
}

export async function whoami() {
  if (!sdk || !sdk.whoami) return { id: 'local', name: '本地玩家' };
  try {
    const r = await sdk.whoami();
    if (r && r.ok && r.data) return r.data;
  } catch (e) {}
  return { id: 'local', name: '本地玩家' };
}

/** 安全区（CSS 像素），无宿主时返回 0。 */
export function safeArea() {
  try {
    if (sdk && sdk.runtime && sdk.runtime.safeArea) {
      const a = sdk.runtime.safeArea();
      if (a && typeof a.top === 'number') return a;
    }
  } catch (e) {}
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/** 平台右上角胶囊菜单占位；无宿主时返回 0。 */
export function capsuleMenuRect() {
  try {
    if (sdk && sdk.runtime && sdk.runtime.capsuleMenuRect) {
      const r = sdk.runtime.capsuleMenuRect();
      if (r && typeof r.width === 'number') return r;
    }
  } catch (e) {}
  return { top: 0, right: 0, width: 0, height: 0 };
}

export function applySafeArea() {
  const a = safeArea();
  const cap = capsuleMenuRect();
  const s = document.documentElement.style;
  s.setProperty('--safe-top', Math.max(0, a.top) + 'px');
  s.setProperty('--safe-right', Math.max(0, a.right) + 'px');
  s.setProperty('--safe-bottom', Math.max(0, a.bottom) + 'px');
  s.setProperty('--safe-left', Math.max(0, a.left) + 'px');
  s.setProperty('--capsule-w', Math.max(0, cap.width || 0) + 8 + 'px');
  s.setProperty('--capsule-h', Math.max(0, cap.height || 0) + 'px');
}

function decode(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try { return new TextDecoder().decode(v); } catch (e) { return null; }
}

export async function kvGet(key) {
  if (!sdk || !sdk.privateKV) return null;
  try {
    const r = await sdk.privateKV.get(key);
    if (r && r.ok) return decode(r.data);
  } catch (e) {}
  return null;
}

export async function kvSet(key, text) {
  if (!sdk || !sdk.privateKV) return false;
  try {
    const r = await sdk.privateKV.set(key, text);
    return !!(r && r.ok);
  } catch (e) { return false; }
}

const SETTINGS_KEY = 'settings_v1';

export function defaultSettings() {
  return { sensitivity: 1.0, fov: 74, quality: 'medium', invertY: false };
}

export async function loadSettings() {
  const raw = await kvGet(SETTINGS_KEY);
  if (!raw) return defaultSettings();
  try {
    const o = JSON.parse(raw);
    return Object.assign(defaultSettings(), o && typeof o === 'object' ? o : {});
  } catch (e) { return defaultSettings(); }
}

export function saveSettings(settings) {
  return kvSet(SETTINGS_KEY, JSON.stringify(settings));
}

/** 合并 appVisibility 与 pausePanel：任一要求暂停即暂停。 */
export function onPauseChange(cb) {
  if (!sdk || !sdk.events) return function () {};
  let appVisible = true;
  let panelVisible = false;
  const emit = function () { cb(!appVisible || panelVisible); };
  let offA = function () {};
  let offB = function () {};
  try {
    offA = sdk.events.on('appVisibility', function (p) {
      appVisible = !!(p && p.visible);
      emit();
    }) || offA;
    offB = sdk.events.on('pausePanel', function (p) {
      panelVisible = !!(p && p.visible);
      emit();
    }) || offB;
  } catch (e) {}
  return function () { try { offA(); offB(); } catch (e) {} };
}

export async function playSfx(name, opts) {
  if (!sdk || !sdk.audio) return false;
  try {
    const r = await sdk.audio.playSFX('audio/sfx/' + name + '.ogg', opts || {});
    return !!(r && r.ok && r.data && r.data.available);
  } catch (e) { return false; }
}

export function vibrate(level) {
  try {
    if (sdk && sdk.audio && sdk.audio.vibrate) sdk.audio.vibrate(level);
  } catch (e) {}
}

export function keepScreenOn(on) {
  try {
    if (sdk && sdk.runtime && sdk.runtime.setKeepScreenOn) {
      sdk.runtime.setKeepScreenOn(!!on).catch(function () {});
    }
  } catch (e) {}
}
