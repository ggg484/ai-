// 轻量确定性噪声：皮肤花纹用。与 world/textures.js 的实现保持一致的口径。

export function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + (seed || 0) * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export function smooth(t) { return t * t * (3 - 2 * t); }

export function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbm(x, y, oct, seed) {
  let v = 0, amp = 0.5, f = 1, total = 0;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x * f, y * f, (seed || 0) + i * 17) * amp;
    total += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / total;
}
