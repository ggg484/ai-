// 几何合批工具：把大量小盒子/零件压成少数几个 draw call。
// 静态场景和武器模型都走这里。

import * as THREE from '../../vendor/three.module.js';

const EPS = 1e-4;

/** 按面的真实尺寸缩放 UV，保证不同大小的墙面纹理密度一致。 */
export function scaleBoxUV(geo, w, h, d, tile) {
  const t = tile || 2.6;
  const uv = geo.attributes.uv;
  const scales = [
    [d / t, h / t], [d / t, h / t],
    [w / t, d / t], [w / t, d / t],
    [w / t, h / t], [w / t, h / t]
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * scales[f][0], uv.getY(i) * scales[f][1]);
    }
  }
  uv.needsUpdate = true;
}

function ensureIndexed(geo) {
  if (geo.index) return geo;
  const count = geo.attributes.position.count;
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/** 合并多个几何体（position/normal/uv，可选 color）。 */
export function mergeGeos(geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) {
    ensureIndexed(g);
    vCount += g.attributes.position.count;
    iCount += g.index.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const hasColor = geos.every((g) => !!g.attributes.color);
  const col = hasColor ? new Float32Array(vCount * 3) : null;
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    if (hasColor) col.set(g.attributes.color.array, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (hasColor) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** 给几何体刷单色顶点色（用于合并后靠顶点色区分零件）。 */
export function paint(geo, r, g, b) {
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = r; arr[i * 3 + 1] = g; arr[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** 静态场景批次：同一材质的所有盒子最后合并成一个 Mesh。 */
export class GeoBatch {
  constructor(root, world, tile) {
    this.root = root;
    this.world = world;
    this.tile = tile || 2.6;
    this.groups = new Map();
  }

  box(cx, cy, cz, w, h, d, kind, opts) {
    opts = opts || {};
    const key = kind + '|' + (opts.color || '') + '|' + (opts.roughness || '') + '|' + (opts.repeat || '');
    if (!this.groups.has(key)) this.groups.set(key, { kind: kind, opts: opts, geos: [] });
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(g, w, h, d, this.tile);
    g.translate(cx, cy, cz);
    this.groups.get(key).geos.push(g);
    if (opts.collide !== false && this.world) {
      this.world.add({
        minX: cx - w / 2, maxX: cx + w / 2,
        minY: cy - h / 2, maxY: cy + h / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
        tag: opts.tag || ''
      });
    }
    return g;
  }

  /** 任意几何体，已带最终位置/旋转。 */
  geo(kind, geometry, opts) {
    opts = opts || {};
    const key = kind + '|' + (opts.color || '') + '|' + (opts.roughness || '') + '|' + (opts.repeat || '');
    if (!this.groups.has(key)) this.groups.set(key, { kind: kind, opts: opts, geos: [] });
    this.groups.get(key).geos.push(geometry);
    return geometry;
  }

  build(materialFn) {
    const meshes = [];
    this.groups.forEach((g) => {
      if (!g.geos.length) return;
      const geo = mergeGeos(g.geos);
      const mesh = new THREE.Mesh(geo, materialFn(g.kind, g.opts));
      mesh.castShadow = g.opts.castShadow !== false;
      mesh.receiveShadow = g.opts.receiveShadow !== false;
      mesh.name = 'batch:' + g.kind;
      this.root.add(mesh);
      meshes.push(mesh);
      g.geos.forEach((x) => x.dispose());
    });
    return meshes;
  }
}

export { EPS };
