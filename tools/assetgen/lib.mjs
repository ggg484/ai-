// 极简 GLB 2.0 导出器。
//
// 为什么自己写：项目不引第三方依赖（vendor 里只有 three 与 GLTFLoader），
// 而 Node 端导出只需要 POSITION / NORMAL / TEXCOORD_0 / indices 加 PBR 材质，
// 手写 300 行比塞一个 exporter 依赖更可控，也方便直接控制合批粒度。
//
// 产出的 .glb 是标准 glTF 2.0：Blockbench（File > Import > glTF）、
// Blender、three.js GLTFLoader 都能直接打开，模型师可以在 Blockbench 里
// 继续改，不必回来改 js 代码。

import * as THREE from '../../vendor/three.module.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const COMP = { 5126: 4, 5125: 4, 5123: 2 };
const TARGET = { ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963 };

/** 把若干 three 几何按材质收集起来，最后按材质合成一个 primitive。 */
export class MeshSet {
  constructor() {
    this.groups = new Map();
  }

  /** @param {string} mat 材质名 @param {THREE.BufferGeometry} geo @param {THREE.Matrix4} [matrix] */
  add(mat, geo, matrix) {
    let g = this.groups.get(mat);
    if (!g) {
      g = { pos: [], nrm: [], uv: [], idx: [], count: 0 };
      this.groups.set(mat, g);
    }
    const src = matrix ? geo.clone().applyMatrix4(matrix) : geo;
    const p = src.attributes.position;
    if (!p) throw new Error('geometry without position');
    if (!src.attributes.normal) src.computeVertexNormals();
    const n = src.attributes.normal;
    const u = src.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      g.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      g.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      g.uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    const base = g.count;
    g.count += p.count;
    if (src.index) {
      const a = src.index.array;
      for (let i = 0; i < a.length; i++) g.idx.push(base + a[i]);
    } else {
      for (let i = 0; i < p.count; i++) g.idx.push(base + i);
    }
    if (matrix) src.dispose();
    return this;
  }

  /** 直接塞一个已经烘焙好的几何（不克隆）。 */
  addRaw(mat, geo) {
    return this.add(mat, geo, null);
  }

  get triangleCount() {
    let t = 0;
    for (const g of this.groups.values()) t += g.idx.length / 3;
    return Math.round(t);
  }

  get vertexCount() {
    let t = 0;
    for (const g of this.groups.values()) t += g.count;
    return t;
  }
}

/**
 * @param {string} file 输出路径
 * @param {MeshSet} set
 * @param {Record<string, {color:number[]|number, metallic?:number, roughness?:number, emissive?:number[], opacity?:number, name?:string}>} materials
 * @param {{name?:string, extras?:object}} [meta]
 */
export function writeGLB(file, set, materials, meta = {}) {
  const chunk = [];
  const accessors = [];
  const bufferViews = [];
  const prims = [];
  const matList = [];
  const matIndex = new Map();
  let byteOffset = 0;

  const align4 = (n) => (n + 3) & ~3;
  const pushView = (buf, target) => {
    const pad = align4(byteOffset) - byteOffset;
    if (pad) {
      chunk.push(Buffer.alloc(pad));
      byteOffset += pad;
    }
    const off = byteOffset;
    chunk.push(buf);
    byteOffset += buf.length;
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: buf.length, target });
    return bufferViews.length - 1;
  };

  const accessor = (view, componentType, count, type, min, max) => {
    const a = { bufferView: view, componentType, count, type };
    if (min) a.min = min;
    if (max) a.max = max;
    accessors.push(a);
    return accessors.length - 1;
  };

  // glTF 的 baseColorFactor 是线性空间；材质表里写的是 sRGB 十六进制，
  // 直接塞进去会整体发亮发灰（木头变米黄），必须转一次。
  const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const colorOf = (c) => {
    const s = Array.isArray(c) ? c : [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, 1];
    return s.map((v, i) => (i === 3 ? v : srgbToLinear(v)));
  };

  for (const [matName, g] of set.groups) {
    if (!g.idx.length) continue;
    const vcount = g.count;

    const posBuf = Buffer.alloc(vcount * 12);
    const nrmBuf = Buffer.alloc(vcount * 12);
    const uvBuf = Buffer.alloc(vcount * 8);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vcount; i++) {
      const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2];
      posBuf.writeFloatLE(x, i * 12);
      posBuf.writeFloatLE(y, i * 12 + 4);
      posBuf.writeFloatLE(z, i * 12 + 8);
      nrmBuf.writeFloatLE(g.nrm[i * 3], i * 12);
      nrmBuf.writeFloatLE(g.nrm[i * 3 + 1], i * 12 + 4);
      nrmBuf.writeFloatLE(g.nrm[i * 3 + 2], i * 12 + 8);
      uvBuf.writeFloatLE(g.uv[i * 2], i * 8);
      uvBuf.writeFloatLE(g.uv[i * 2 + 1], i * 8 + 4);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const idxBuf = Buffer.alloc(g.idx.length * 4);
    for (let i = 0; i < g.idx.length; i++) idxBuf.writeUInt32LE(g.idx[i], i * 4);

    const vPos = pushView(posBuf, TARGET.ARRAY_BUFFER);
    const vNrm = pushView(nrmBuf, TARGET.ARRAY_BUFFER);
    const vUv = pushView(uvBuf, TARGET.ARRAY_BUFFER);
    const vIdx = pushView(idxBuf, TARGET.ELEMENT_ARRAY_BUFFER);

    const aPos = accessor(vPos, 5126, vcount, 'VEC3', [minX, minY, minZ], [maxX, maxY, maxZ]);
    const aNrm = accessor(vNrm, 5126, vcount, 'VEC3');
    const aUv = accessor(vUv, 5126, vcount, 'VEC2');
    const aIdx = accessor(vIdx, 5125, g.idx.length, 'SCALAR');

    if (!matIndex.has(matName)) {
      const m = materials[matName] || {};
      const pbr = {
        name: m.name || matName,
        pbrMetallicRoughness: {
          baseColorFactor: colorOf(m.color == null ? 0xb0b4b8 : m.color),
          metallicFactor: m.metallic == null ? 0.4 : m.metallic,
          roughnessFactor: m.roughness == null ? 0.6 : m.roughness
        },
        doubleSided: m.doubleSided !== false
      };
      if (m.emissive) {
        pbr.emissiveFactor = m.emissive;
        if (m.emissiveIntensity != null) pbr.emissiveStrength = m.emissiveIntensity;
      }
      if (m.opacity != null && m.opacity < 1) {
        pbr.alphaMode = 'BLEND';
        pbr.pbrMetallicRoughness.baseColorFactor[3] = m.opacity;
      }
      if (m.extras) pbr.extras = m.extras;
      matIndex.set(matName, matList.length);
      matList.push(pbr);
    }

    prims.push({
      attributes: { POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv },
      indices: aIdx,
      material: matIndex.get(matName),
      mode: 4
    });
  }

  const totalBin = byteOffset;
  const binBuf = Buffer.concat(chunk, totalBin);
  const binPadded = Buffer.concat([binBuf, Buffer.alloc(align4(totalBin) - totalBin)]);

  const json = {
    asset: { version: '2.0', generator: 'dust-protocol assetgen' },
    scene: 0,
    scenes: [{ nodes: [0], name: meta.name || 'Scene' }],
    nodes: [{ name: meta.name || 'Model', mesh: 0 }],
    meshes: [{ name: meta.name || 'Model', primitives: prims }],
    materials: matList,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binPadded.length }]
  };
  if (meta.extras) json.nodes[0].extras = meta.extras;

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadded = Buffer.concat([
    jsonBuf,
    Buffer.alloc(align4(jsonBuf.length) - jsonBuf.length, 0x20)
  ]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);

  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonPadded.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);

  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binPadded.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);

  const out = Buffer.concat([header, jsonHead, jsonPadded, binHead, binPadded]);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out);
  return { file, bytes: out.length, primitives: prims.length, tris: set.triangleCount, verts: set.vertexCount };
}

/* ------------------------------------------------------------------ */
/* 建模辅助                                                            */
/* ------------------------------------------------------------------ */

/** 位移 + 旋转 + 缩放的便捷矩阵。角度用弧度。 */
export function TRS(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return m;
}

/** 圆角盒：比 BoxGeometry 多两段倒角，低模也能看出金属折边。 */
export function roundedBox(w, h, d, r = 0.006, seg = 1) {
  const g = new THREE.BoxGeometry(w, h, d, seg + 1, seg + 1, seg + 1);
  const p = g.attributes.position;
  const hs = [w / 2 - r, h / 2 - r, d / 2 - r];
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const cx = Math.max(-hs[0], Math.min(hs[0], v.x));
    const cy = Math.max(-hs[1], Math.min(hs[1], v.y));
    const cz = Math.max(-hs[2], Math.min(hs[2], v.z));
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const len = Math.hypot(dx, dy, dz) || 1;
    p.setXYZ(i, cx + (dx / len) * r, cy + (dy / len) * r, cz + (dz / len) * r);
  }
  g.computeVertexNormals();
  return g;
}

/** 沿 -Z 的圆柱（与武器坐标一致）。 */
export function tubeZ(r, len, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  g.rotateX(Math.PI / 2);
  return g;
}

/** 2D 轮廓沿 Z 挤出。pts 为 [x,y] 数组，自动闭合。 */
export function extrudeZ(pts, depth, bevel = 0.004) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 10,
    steps: 1
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** 用若干点串起来的梯形棱柱（做握把、枪托、护木收口都够用）。 */
export function boxTaper(w0, w1, h0, h1, d) {
  const g = new THREE.BoxGeometry(1, 1, d, 1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const w = y > 0 ? w1 : w0;
    const h = y > 0 ? h1 : h0;
    p.setXYZ(i, p.getX(i) * w, y * h, p.getZ(i));
  }
  g.computeVertexNormals();
  return g;
}
