// 检视模式：独立摄影棚，360° 展示枪械/道具与皮肤品相。
// 支持 ?photo=ak&skin=ak_redline&wear=0.236&seed=886&offset=0.71 直接出图。

import * as THREE from '../../vendor/three.module.js';
import { buildDisplayWeapon } from './weapon-models.js';
import { buildPropModel, PROP_INFO } from './prop-models.js';
import { applySkin } from './skin-material.js';
import { SKIN_MAP, skinsFor, defaultVariant, wearLabel, RARITIES } from '../config/skins.js';

export const PHOTO_WEAPONS = [
  { id: 'ak', name: 'AK-47', skin: 'ak_redline' },
  { id: 'm4', name: 'M4A4', skin: 'm4_ashen' },
  { id: 'awp', name: 'AWP', skin: 'awp_helix' },
  { id: 'usp', name: 'USP-S', skin: 'usp_ghost' },
  { id: 'deagle', name: '沙漠之鹰', skin: 'deagle_ember' },
  { id: 'mp9', name: 'MP9', skin: 'mp9_carbon' },
  { id: 'glock', name: 'GLOCK-18', skin: 'glock_neon' },
  { id: 'knife', name: '爪刀', skin: 'knife_gilded' }
];

export const PHOTO_PROPS = [
  { id: 'he' }, { id: 'flash' }, { id: 'smoke' }, { id: 'molotov' },
  { id: 'c4' }, { id: 'defuse' }, { id: 'armor' }, { id: 'case' }
];

/**
 * 摄影棚环境：不发一张 HDR，也能给金属一层像样的柔光反射。
 * 用几块自发光板拼一个「房间」，PMREM 烘成环境贴图。
 */
function studioEnvironment(renderer) {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(14, 9, 14),
    new THREE.MeshBasicMaterial({ color: 0x14181c, side: THREE.BackSide })
  );
  room.position.y = 2.5;
  s.add(room);
  const panel = (w, h, x, y, z, ry, color, power) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide })
    );
    m.material.color.multiplyScalar(power);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    s.add(m);
    return m;
  };
  // 顶部大柔光
  const top = panel(6, 5, 0, 6.8, 0, 0, 0xffffff, 7.5);
  top.rotation.x = Math.PI / 2;
  // 左暖右冷两条灯条
  panel(4, 3.2, -6.6, 3.2, 0.5, Math.PI / 2, 0xffe6c4, 5.0);
  panel(4, 2.6, 6.6, 2.8, -0.5, -Math.PI / 2, 0xbed8f0, 3.4);
  // 正面补光，避免枪口全黑
  panel(5, 2, 0, 2.2, 6.6, Math.PI, 0xfff4e2, 2.0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0.04);
  pmrem.dispose();
  s.traverse((o) => {
    if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
  });
  return rt;
}

function backdropTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 618;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#6d7883');
  g.addColorStop(0.42, '#3a434b');
  g.addColorStop(1, '#171c20');
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  const glow = x.createRadialGradient(c.width * 0.5, c.height * 0.42, 10, c.width * 0.5, c.height * 0.42, c.width * 0.46);
  glow.addColorStop(0, 'rgba(255,240,210,.35)');
  glow.addColorStop(0.45, 'rgba(180,175,160,.12)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = glow;
  x.fillRect(0, 0, c.width, c.height);
  // 细网格，增加摄影棚层次
  x.strokeStyle = 'rgba(255,255,255,.035)';
  x.lineWidth = 1;
  for (let i = 0; i < 24; i++) {
    x.beginPath(); x.moveTo(i * 44, 0); x.lineTo(i * 44, c.height); x.stroke();
  }
  for (let i = 0; i < 16; i++) {
    x.beginPath(); x.moveTo(0, i * 40); x.lineTo(c.width, i * 40); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class PhotoMode {
  constructor(engine, opts) {
    this.engine = engine;
    this.opts = opts || {};
    this.active = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x121518);
    this.scene.fog = new THREE.Fog(0x121518, 9, 20);
    this.camera = new THREE.PerspectiveCamera(14, 1, 0.05, 40);
    this.camera.position.set(0, 1.25, 6.2);
    this.camera.lookAt(0, 1.02, 0);

    this.pivot = new THREE.Group();
    this.pivot.position.set(0, 1.05, 0);
    this.scene.add(this.pivot);

    // 摄影棚背板 / 地面 / 展台
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 10),
      new THREE.MeshBasicMaterial({ map: backdropTexture(), toneMapped: false })
    );
    back.position.set(0, 4.2, -2.8);
    this.scene.add(back);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 22),
      new THREE.MeshStandardMaterial({ color: 0x3b444c, roughness: 0.3, metalness: 0.55, envMapIntensity: 1.5 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(1.02, 1.12, 0.12, 48),
      new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.28, metalness: 0.7 })
    );
    plinth.position.y = 0.06;
    this.scene.add(plinth);
    const plinthRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.02, 0.018, 6, 64),
      new THREE.MeshBasicMaterial({ color: 0xd9b47a, toneMapped: false })
    );
    plinthRing.rotation.x = Math.PI / 2;
    plinthRing.position.y = 0.13;
    this.scene.add(plinthRing);

    // 背后柔光板 + 接触阴影
    const soft = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 2.4),
      new THREE.MeshBasicMaterial({
        color: 0xffe6c0, transparent: true, opacity: 0.06,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      })
    );
    soft.position.set(0, 2.2, -2.1);
    this.scene.add(soft);
    const sh = document.createElement('canvas');
    sh.width = sh.height = 256;
    const sx = sh.getContext('2d');
    const sg = sx.createRadialGradient(128, 128, 4, 128, 128, 124);
    sg.addColorStop(0, 'rgba(0,0,0,.65)');
    sg.addColorStop(0.5, 'rgba(0,0,0,.25)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    sx.fillStyle = sg;
    sx.fillRect(0, 0, 256, 256);
    const shadowTex = new THREE.CanvasTexture(sh);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1.5),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.75, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.135;
    this.scene.add(shadow);

    // 三点灯光
    this.scene.add(new THREE.HemisphereLight(0xbcd4e8, 0x4a3420, 0.9));
    const key = new THREE.DirectionalLight(0xfff2d8, 2.6);
    key.position.set(3, 4, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -2;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xfff0dd, 1.5);
    fill.position.set(-1.2, 2.2, 4.5);
    this.scene.add(fill);
    const camFill = new THREE.DirectionalLight(0xe8f0ff, 0.9);
    camFill.position.set(0.6, 1.4, 6);
    this.scene.add(camFill);
    const rim = new THREE.PointLight(0x6fb8d8, 55, 12, 2);
    rim.position.set(-2.6, 2.3, -1.7);
    this.scene.add(rim);
    const warm = new THREE.PointLight(0xffb060, 28, 12, 2);
    warm.position.set(2.5, 1.5, -1.6);
    this.scene.add(warm);
    const top = new THREE.SpotLight(0xffe8c0, 55, 12, 0.55, 0.5, 2);
    top.position.set(0, 4.2, 0.4);
    top.target.position.set(0, 1, 0);
    top.castShadow = true;
    this.scene.add(top);
    this.scene.add(top.target);

    // 尘埃
    const dg = new THREE.BufferGeometry();
    const dp = new Float32Array(160 * 3);
    for (let i = 0; i < 160; i++) {
      dp[i * 3] = (Math.random() - 0.5) * 5;
      dp[i * 3 + 1] = 1 + Math.random() * 3;
      dp[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({
      color: 0xffe8c0, size: 0.018, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.scene.add(this.dust);

    this.studioEnv = studioEnvironment(engine.renderer);
    this.scene.environment = this.studioEnv.texture;
    this.model = null;
    this.kind = 'weapon';
    this.id = 'ak';
    this.angle = Math.PI / 2 - 0.16;
    this.still = /[?&]still=1/.test(location.search);
    this._t = 0;

    this.el = {
      root: document.getElementById('photo-ui'),
      title: document.getElementById('photo-title'),
      sub: document.getElementById('photo-sub'),
      meta: document.getElementById('photo-meta'),
      nav: document.getElementById('photo-nav'),
      close: document.getElementById('photo-close')
    };
    if (this.el.close) this.el.close.addEventListener('click', () => {
      if (this.opts.onClose) this.opts.onClose();
    });
    this._buildNav();
    this.resize();
  }

  _buildNav() {
    const nav = this.el.nav;
    if (!nav) return;
    nav.innerHTML = '';
    const addGroup = (label, items, kind) => {
      const group = document.createElement('div');
      group.className = 'photo-group';
      const l = document.createElement('span');
      l.className = 'pg-label';
      l.textContent = label;
      group.appendChild(l);
      items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.photoId = it.id;
        b.dataset.kind = kind;
        b.textContent = kind === 'prop' ? PROP_INFO[it.id].name : it.name;
        b.addEventListener('click', () => {
          this.show(kind, it.id);
        });
        group.appendChild(b);
      });
      nav.appendChild(group);
    };
    addGroup('枪械', PHOTO_WEAPONS, 'weapon');
    addGroup('战术道具', PHOTO_PROPS, 'prop');
  }

  _clear() {
    if (!this.model) return;
    this.pivot.remove(this.model);
    this.model.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.model = null;
  }

  show(kind, id, skinId, variant) {
    if (!this.el.root) return;
    this.kind = kind;
    this.id = id;
    this._clear();
    let name = id;
    let sub = '';
    let meta = '';

    if (kind === 'weapon') {
      const model = buildDisplayWeapon(id, false, false);
      model.userData.weaponId = id;
      const skin = SKIN_MAP[skinId] || skinsFor(id)[0] || null;
      const bare = /[?&]bare=1/.test(location.search);
      if (skin && !bare) {
        const v = variant || defaultVariant(skin);
        applySkin(model, skin, v);
        name = (PHOTO_WEAPONS.find((w) => w.id === id) || {}).name || skin.name;
        sub = skin.name + ' · ' + (RARITIES[skin.rarity] ? RARITIES[skin.rarity].name : '');
        meta = wearLabel(v.wear).name + ' · ' + v.wear.toFixed(4) + '   图案 ' + v.seed + ' · 偏移 ' + v.offset.toFixed(2);
      } else {
        name = (PHOTO_WEAPONS.find((w) => w.id === id) || {}).name || id;
        if (bare) sub = '原厂涂装 · 几何校验';
      }
      this.model = model;
    } else {
      const prop = buildPropModel(id);
      this.model = prop;
      const info = PROP_INFO[id] || { name: id, sub: '' };
      name = info.name;
      sub = info.sub;
      meta = '战术道具 · 3D 检视';
    }

    // 按包围盒自动居中与缩放
    const box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    let scale = (kind === 'weapon' ? 1.95 : 1.35) / maxDim;
    // 手枪的「长宽比」接近 2:1，按长度缩放会把枪管顶出画面；这里再按高度收一次。
    if (kind === 'weapon') scale = Math.min(scale, 0.92 / Math.max(0.001, size.y));
    this.model.scale.setScalar(scale);
    this.model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    this.pivot.add(this.model);
    this.pivot.rotation.y = this.angle;
    this.pivot.rotation.x = 0.03;
    this._t = 0;

    if (this.el.title) this.el.title.textContent = name;
    if (this.el.sub) this.el.sub.textContent = sub;
    if (this.el.meta) this.el.meta.textContent = meta;
    this.el.root.querySelectorAll('[data-photo-id]').forEach((b) => {
      const on = b.dataset.kind === kind && b.dataset.photoId === id;
      b.classList.toggle('on', on);
    });
    this.active = true;
    this.el.root.classList.remove('hidden');
    this._t = 0;
  }

  hide() {
    this.active = false;
    if (this.el.root) this.el.root.classList.add('hidden');
  }

  update(dt) {
    this._t += dt;
    this.pivot.rotation.y = this.angle + (this.still ? 0 : this._t * 0.16);
    if (this.dust) {
      const p = this.dust.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * 0.03;
        if (y > 4.4) y = 1;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
  }

  render() {
    const r = this.engine.renderer;
    const old = r.toneMappingExposure;
    r.toneMappingExposure = old * 1.32;
    r.render(this.scene, this.camera);
    r.toneMappingExposure = old;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }
}
