// 渲染层：three.js 初始化、天空、光照、环境反射、画质档位。
// 目标：手机 WebView 稳 60；低端 30。所有画质开关都在这里。

import * as THREE from '../../vendor/three.module.js';
import { normalizeLighting } from '../world/lighting.js';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  // 天空球跟随相机移动，方向必须取局部坐标（球心即相机），不能用世界坐标
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform float cloudiness;
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 7.1;
    a *= 0.5;
  }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.72, h));
  col = mix(ground, col, smoothstep(-0.12, 0.01, h));
  // 卡通云只在较高仰角出现：地平线附近 uv 尺度极大，会把云糊成一片白雾
  vec2 uv = d.xz / max(0.14, d.y + 0.20);
  float c = fbm(uv * 1.1 + vec2(4.2, 2.7));
  float cloud = smoothstep(0.54, 0.72, c) * smoothstep(0.17, 0.40, h) * cloudiness;
  col = mix(col, vec3(1.0, 1.0, 1.0), cloud * 0.92);
  float haze = smoothstep(0.14, -0.02, h);
  col = mix(col, mix(horizon, vec3(1.0), 0.32), haze * 0.24);
  float sun = max(dot(d, normalize(sunDir)), 0.0);
  col += vec3(1.0, 0.90, 0.70) * pow(sun, 220.0) * 0.7;
  col += vec3(1.0, 0.82, 0.58) * pow(sun, 12.0) * 0.08;
  gl_FragColor = vec4(col, 1.0);
  // 天空不参与色调映射：ACES 会把高亮天空压成灰白，卡通风格需要干净的天空色
  #include <colorspace_fragment>
}`;

/** 设备分档：中端手机（骁龙 7 系）默认 medium，移动端关阴影、锁 DPR。 */
function detectDevice() {
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 1;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (touch && Math.min(window.screen.width, window.screen.height) < 820);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
    const lose = gl && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (e) { /* 忽略：只用于分档 */ }
  const m = /[?&]quality=(low|medium|high)/.exec(location.search);
  let quality = m ? m[1] : (mobile ? 'medium' : 'high');
  if (!m) {
    if (mobile && (cores <= 2 || mem <= 2)) quality = 'low';
    else if (!mobile && (cores <= 4 || mem <= 4)) quality = 'medium';
  }
  return { mobile, quality, cores, mem, gpu, dpr: window.devicePixelRatio || 1 };
}

/** 生成一张室内/沙漠都能用的等距柱状环境图，给金属和玻璃做反射。 */
function envCanvas() {
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#6f93bd');
  sky.addColorStop(0.55, '#c9c2ab');
  sky.addColorStop(1, '#e8d4ae');
  x.fillStyle = sky;
  x.fillRect(0, 0, w, h * 0.62);
  const ground = x.createLinearGradient(0, h * 0.62, 0, h);
  ground.addColorStop(0, '#b59870');
  ground.addColorStop(1, '#6b5a42');
  x.fillStyle = ground;
  x.fillRect(0, h * 0.62, w, h * 0.38);
  // 太阳
  const sun = x.createRadialGradient(w * 0.72, h * 0.25, 0, w * 0.72, h * 0.25, 26);
  sun.addColorStop(0, 'rgba(255,250,235,1)');
  sun.addColorStop(0.25, 'rgba(255,228,170,.9)');
  sun.addColorStop(1, 'rgba(255,210,140,0)');
  x.fillStyle = sun;
  x.fillRect(w * 0.6, h * 0.05, w * 0.25, h * 0.4);
  // 室内暖光带（让金属反射出暖色高光）
  const warm = x.createLinearGradient(0, h * 0.4, 0, h * 0.52);
  warm.addColorStop(0, 'rgba(255,196,120,0)');
  warm.addColorStop(0.5, 'rgba(255,196,120,.20)');
  warm.addColorStop(1, 'rgba(255,196,120,0)');
  x.fillStyle = warm;
  x.fillRect(0, h * 0.4, w, h * 0.14);
  return c;
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = detectDevice();
    this.isMobile = this.device.mobile;
    this.quality = this.device.quality;
    // 分辨率恒定：永远使用设备原生像素比，不随画质档/帧率降采样。
    // 画质档只影响阴影、云量等效果，不再影响清晰度。
    this.renderScale = 1;
    this.mood = 'match';
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !this.isMobile,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xd8c6a4, 46, 130);

    this.camera = new THREE.PerspectiveCamera(90, 1, 0.05, 320);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this._sky();
    this._lights();
    this._environment();
    this.resize();
    this.setQuality(this.quality);
  }

  _sky() {
    const geo = new THREE.SphereGeometry(260, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color(0x63b3e6) },
        horizon: { value: new THREE.Color(0xcfeaf8) },
        ground: { value: new THREE.Color(0x7cbf68) },
        sunDir: { value: new THREE.Vector3(0.55, 0.62, 0.45) },
        cloudiness: { value: 0.8 }
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG
    });
    const sky = new THREE.Mesh(geo, this.skyMat);
    sky.frustumCulled = false;
    // 天空球每帧跟随相机：否则相机远离场景中心时，球体远端会越过远裁剪面，
    // 在画面里漏出一块纯黑的「拱形」缺口（全景机位尤其明显）。
    this.sky = sky;
    this.scene.add(sky);
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight(0xa9c7e8, 0xc9a87c, 0.62);
    this.scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xfff0d2, 2.85);
    sun.position.set(38, 52, 22);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -62;
    sun.shadow.camera.right = 62;
    sun.shadow.camera.top = 56;
    sun.shadow.camera.bottom = -56;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 180;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.022;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    // 冷色补光：让背光面不死黑，也是 CS 味的一半
    const fill = new THREE.DirectionalLight(0x9fb8d8, 0.35);
    fill.position.set(-36, 26, -40);
    this.scene.add(fill);
    this.fill = fill;
  }

  _environment() {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const tex = new THREE.CanvasTexture(envCanvas());
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.envMap = pmrem.fromEquirectangular(tex).texture;
      this.scene.environment = this.envMap;
      tex.dispose();
      pmrem.dispose();
    } catch (e) {
      this.envMap = null;
    }
  }

  /** 'match' 户外底板 / 'lobby' 室内大厅：换一套光与雾（Roblox 版更亮更平）。 */
  setMood(mood) {
    this.mood = mood;
    if (mood === 'lobby') {
      this.scene.fog.color.setHex(0xcfe8f5);
      this.scene.fog.near = 46;
      this.scene.fog.far = 190;
      this.skyMat.uniforms.zenith.value.setHex(0x74bceb);
      this.skyMat.uniforms.horizon.value.setHex(0xcdecfa);
      this.skyMat.uniforms.ground.value.setHex(0x7cbf68);
      this.skyMat.uniforms.sunDir.value.set(0.45, 0.78, 0.3);
      this.skyMat.uniforms.cloudiness.value = 0.45;
      this.sun.color.setHex(0xfff2d6);
      this.sun.intensity = 1.9;
      this.sun.position.set(34, 58, 18);
      this.hemi.color.setHex(0xe6f4ff);
      this.hemi.groundColor.setHex(0xb0a58c);
      this.hemi.intensity = 1.05;
      this.fill.color.setHex(0xbfd8f0);
      this.fill.intensity = 0.5;
      this.renderer.toneMappingExposure = 1.0;
    } else if (mood === 'oasis') {
      this.scene.fog.color.setHex(0xe2c79b);
      this.scene.fog.near = 54;
      this.scene.fog.far = 180;
      this.skyMat.uniforms.zenith.value.setHex(0x2f8fbd);
      this.skyMat.uniforms.horizon.value.setHex(0xf2d7a8);
      this.skyMat.uniforms.ground.value.setHex(0xc69a5b);
      this.skyMat.uniforms.sunDir.value.set(0.72, 0.55, 0.32);
      this.skyMat.uniforms.cloudiness.value = 0.28;
      this.sun.color.setHex(0xffe2b0);
      this.sun.intensity = 2.35;
      this.sun.position.set(52, 56, 30);
      this.hemi.color.setHex(0xfff0d8);
      this.hemi.groundColor.setHex(0xc79a62);
      this.hemi.intensity = 1.1;
      this.fill.color.setHex(0x9fd0e8);
      this.fill.intensity = 0.36;
      this.renderer.toneMappingExposure = 1.05;
    } else {
      this.scene.fog.color.setHex(0xbfe4f5);
      this.scene.fog.near = 62;
      this.scene.fog.far = 210;
      this.skyMat.uniforms.zenith.value.setHex(0x4aa8e0);
      this.skyMat.uniforms.horizon.value.setHex(0xc2e6fa);
      this.skyMat.uniforms.ground.value.setHex(0x7cbf68);
      this.skyMat.uniforms.sunDir.value.set(0.55, 0.62, 0.45);
      this.skyMat.uniforms.cloudiness.value = 0.55;
      this.sun.color.setHex(0xfff6e2);
      this.sun.intensity = 2.1;
      this.sun.position.set(38, 52, 22);
      this.hemi.color.setHex(0xdcf0ff);
      this.hemi.groundColor.setHex(0xb0a58c);
      this.hemi.intensity = 1.05;
      this.fill.color.setHex(0xbfd8f0);
      this.fill.intensity = 0.3;
      this.renderer.toneMappingExposure = 1.02;
    }
  }

  setQuality(q) {
    this.quality = q;
    const m = this.isMobile;
    const caps = {
      low: { shadows: false },
      medium: { shadows: !m },
      high: { shadows: !m }
    };
    const cap = caps[q] || caps.medium;
    // 所有档位都锁在设备原生分辨率（上限 3，避免 4K 屏显存爆炸）。
    // 用户要求：宁可降特效，也不能降分辨率把画面糊掉。
    const dpr = window.devicePixelRatio || 1;
    this.basePixelRatio = Math.max(1, Math.min(3, dpr));
    this.renderScale = 1;
    if (this.skyMat) this.skyMat.uniforms.cloudiness.value = q === 'low' ? 0.3 : 0.55;
    this.renderer.setPixelRatio(this.basePixelRatio);
    const noShadows = /[?&]shadows=0/.test(location.search);
    this.renderer.shadowMap.enabled = cap.shadows && !noShadows;
    this.sun.castShadow = cap.shadows && !noShadows;
    const size = cap.shadows ? (q === 'high' ? 1024 : 512) : 512;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.resize();
  }

  /**
   * 应用一套光影数据（太阳/天光/补光/雾/天空/曝光）。
   * 光影工坊实时调用；对局启动时应用 assets/lighting.json。
   */
  applyLighting(input) {
    const l = normalizeLighting(input);
    this.lighting = l;
    const az = (l.sun.azimuth * Math.PI) / 180;
    const el = (l.sun.elevation * Math.PI) / 180;
    const r = 92;
    const sx = r * Math.cos(el) * Math.sin(az);
    const sy = r * Math.sin(el);
    const sz = r * Math.cos(el) * Math.cos(az);
    this.sun.position.set(sx, sy, sz);
    this.sun.color.set(l.sun.color);
    this.sun.intensity = l.sun.intensity;
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();

    this.hemi.color.set(l.hemi.sky);
    this.hemi.groundColor.set(l.hemi.ground);
    this.hemi.intensity = l.hemi.intensity;

    this.fill.color.set(l.fill.color);
    this.fill.intensity = l.fill.intensity;

    if (this.scene.fog) {
      this.scene.fog.color.set(l.fog.color);
      this.scene.fog.near = l.fog.near;
      this.scene.fog.far = l.fog.far;
    }

    if (this.skyMat) {
      const u = this.skyMat.uniforms;
      u.zenith.value.set(l.sky.zenith);
      u.horizon.value.set(l.sky.horizon);
      u.ground.value.set(l.sky.ground);
      u.cloudiness.value = l.sky.cloudiness;
      u.sunDir.value.set(sx, sy, sz).normalize();
    }

    this.renderer.toneMappingExposure = l.exposure;
    return l;
  }

  /** 把当前引擎光照读成可保存的数据，供工坊「读取当前」使用。 */
  captureLighting() {
    const p = this.sun.position;
    const r = Math.max(0.001, p.length());
    const el = (Math.asin(Math.max(-1, Math.min(1, p.y / r))) * 180) / Math.PI;
    let az = (Math.atan2(p.x, p.z) * 180) / Math.PI;
    if (az < 0) az += 360;
    const u = this.skyMat ? this.skyMat.uniforms : null;
    return normalizeLighting({
      sun: {
        azimuth: az,
        elevation: Math.max(1, el),
        color: '#' + this.sun.color.getHexString(),
        intensity: this.sun.intensity
      },
      hemi: {
        sky: '#' + this.hemi.color.getHexString(),
        ground: '#' + this.hemi.groundColor.getHexString(),
        intensity: this.hemi.intensity
      },
      fill: {
        color: '#' + this.fill.color.getHexString(),
        intensity: this.fill.intensity
      },
      fog: this.scene.fog ? {
        color: '#' + this.scene.fog.color.getHexString(),
        near: this.scene.fog.near,
        far: this.scene.fog.far
      } : undefined,
      sky: u ? {
        zenith: '#' + u.zenith.value.getHexString(),
        horizon: '#' + u.horizon.value.getHexString(),
        ground: '#' + u.ground.value.getHexString(),
        cloudiness: u.cloudiness.value
      } : undefined,
      exposure: this.renderer.toneMappingExposure
    });
  }

  /** 已停用动态分辨率：分辨率始终是原生档，任何调用都不会降清晰度。 */
  setRenderScale() {
    this.renderScale = 1;
    if (this.basePixelRatio) this.renderer.setPixelRatio(this.basePixelRatio);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render() {
    // 天空球跟着相机走，保证永远在远裁剪面内，也不会出现地平线缺口。
    if (this.sky) this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
