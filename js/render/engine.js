// 渲染层：three.js 初始化、天空、光照、环境反射、画质档位。
// 目标：手机 WebView 稳 60；低端 30。所有画质开关都在这里。

import * as THREE from '../../vendor/three.module.js';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = (modelMatrix * vec4(position, 1.0)).xyz;
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
  vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.6, h));
  col = mix(ground, col, smoothstep(-0.18, 0.02, h));
  // 沙尘薄云：高空气团 + 地平线霾
  vec2 uv = d.xz / max(0.12, d.y + 0.18);
  float c = fbm(uv * 1.25 + vec2(4.2, 2.7));
  float cloud = smoothstep(0.52, 0.78, c) * smoothstep(0.02, 0.24, h) * cloudiness;
  float c2 = fbm(uv * 3.2 + vec2(8.1, 1.7));
  float cloud2 = smoothstep(0.56, 0.8, c2) * smoothstep(0.05, 0.3, h) * cloudiness;
  col = mix(col, vec3(0.96, 0.93, 0.86), cloud * 0.45 + cloud2 * 0.18);
  float haze = smoothstep(0.28, -0.02, h);
  col = mix(col, vec3(0.80, 0.70, 0.55), haze * 0.22);
  float sun = max(dot(d, normalize(sunDir)), 0.0);
  col += vec3(1.0, 0.86, 0.62) * pow(sun, 220.0) * 0.9;
  col += vec3(1.0, 0.72, 0.45) * pow(sun, 12.0) * 0.10;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
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
    this.renderScale = this.isMobile ? 0.9 : 1;
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
        zenith: { value: new THREE.Color(0x7fa8d6) },
        horizon: { value: new THREE.Color(0xe8d4ae) },
        ground: { value: new THREE.Color(0xa8855c) },
        sunDir: { value: new THREE.Vector3(0.55, 0.62, 0.45) },
        cloudiness: { value: 0.55 }
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG
    });
    const sky = new THREE.Mesh(geo, this.skyMat);
    sky.frustumCulled = false;
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

  /** 'match' 沙漠外场 / 'lobby' 室内大厅：换一套光与雾。 */
  setMood(mood) {
    this.mood = mood;
    if (mood === 'lobby') {
      this.scene.fog.color.setHex(0x8a7a62);
      this.scene.fog.near = 26;
      this.scene.fog.far = 105;
      this.skyMat.uniforms.zenith.value.setHex(0x8fb2d9);
      this.skyMat.uniforms.horizon.value.setHex(0xdcc9a8);
      this.skyMat.uniforms.ground.value.setHex(0x8a7558);
      this.skyMat.uniforms.sunDir.value.set(0.45, 0.78, 0.3);
      this.sun.color.setHex(0xffe2b0);
      this.sun.intensity = 2.05;
      this.sun.position.set(34, 58, 18);
      this.hemi.color.setHex(0xbdd4ea);
      this.hemi.groundColor.setHex(0xc9a87c);
      this.hemi.intensity = 0.58;
      this.fill.color.setHex(0x9fb8d8);
      this.fill.intensity = 0.45;
      this.renderer.toneMappingExposure = 0.82;
    } else {
      this.scene.fog.color.setHex(0xd8c6a4);
      this.scene.fog.near = 46;
      this.scene.fog.far = 130;
      this.skyMat.uniforms.zenith.value.setHex(0x7fa8d6);
      this.skyMat.uniforms.horizon.value.setHex(0xe8d4ae);
      this.skyMat.uniforms.ground.value.setHex(0xa8855c);
      this.skyMat.uniforms.sunDir.value.set(0.55, 0.62, 0.45);
      this.sun.color.setHex(0xfff0d2);
      this.sun.intensity = 3.0;
      this.sun.position.set(38, 52, 22);
      this.hemi.color.setHex(0xa9c7e8);
      this.hemi.groundColor.setHex(0xc9a87c);
      this.hemi.intensity = 0.42;
      this.fill.color.setHex(0x9fb8d8);
      this.fill.intensity = 0.24;
      this.renderer.toneMappingExposure = 0.88;
    }
  }

  setQuality(q) {
    this.quality = q;
    const m = this.isMobile;
    const caps = {
      low: { dpr: 1, shadows: false },
      medium: { dpr: m ? 1.25 : 1.5, shadows: !m },
      high: { dpr: m ? 1.5 : 2, shadows: !m }
    };
    const cap = caps[q] || caps.medium;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, cap.dpr);
    if (q === 'low') this.renderScale = 1;
    if (this.skyMat) this.skyMat.uniforms.cloudiness.value = q === 'low' ? 0.3 : 0.55;
    this.renderer.setPixelRatio(this.basePixelRatio * this.renderScale);
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

  /** 动态分辨率：0.6–1.0，由主循环根据实测帧率调节。 */
  setRenderScale(scale) {
    const s = Math.max(0.6, Math.min(1, scale));
    if (Math.abs(s - this.renderScale) < 0.01) return;
    this.renderScale = s;
    if (!this.basePixelRatio) this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(this.basePixelRatio * s);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
