// 碰撞：AABB 世界 + 胶囊近似为 AABB 的逐轴扫掠。
// 骨架版够用：台阶、地面吸附、墙角滑动、射线命中。
// TODO(net/phys): 换成 capsule sweep + 空间划分；当前是 O(n) 遍历，n < 400。

const EPS = 1e-4;

export class World {
  constructor(colliders) {
    this.colliders = colliders || [];
  }

  add(c) { this.colliders.push(c); }

  overlaps(minX, minY, minZ, maxX, maxY, maxZ, ignoreTag) {
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (ignoreTag && c.tag === ignoreTag) continue;
      if (minX < c.maxX - EPS && maxX > c.minX + EPS &&
          minY < c.maxY - EPS && maxY > c.minY + EPS &&
          minZ < c.maxZ - EPS && maxZ > c.minZ + EPS) return c;
    }
    return null;
  }

  move(pos, vel, dt, radius, height, stepHeight, grounded) {
    const dx = vel.x * dt;
    const dy = vel.y * dt;
    const dz = vel.z * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.14));
    const sx = dx / steps, sy = dy / steps, sz = dz / steps;
    let outGrounded = false;

    for (let i = 0; i < steps; i++) {
      // --- Y ---
      if (sy !== 0) {
        const ny = pos.y + sy;
        if (this.overlaps(pos.x - radius, ny, pos.z - radius, pos.x + radius, ny + height, pos.z + radius)) {
          if (sy < 0) outGrounded = true;
          vel.y = 0;
        } else {
          pos.y = ny;
        }
      }

      // --- X ---
      if (sx !== 0) {
        const nx = pos.x + sx;
        if (!this.overlaps(nx - radius, pos.y, pos.z - radius, nx + radius, pos.y + height, pos.z + radius)) {
          pos.x = nx;
        } else if (grounded && stepHeight > 0) {
          const ny = pos.y + stepHeight;
          if (!this.overlaps(nx - radius, ny, pos.z - radius, nx + radius, ny + height, pos.z + radius) &&
              this.supportAt(nx, ny, pos.z, radius) != null) {
            pos.x = nx; pos.y = ny; outGrounded = true;
          } else { vel.x = 0; }
        } else { vel.x = 0; }
      }

      // --- Z ---
      if (sz !== 0) {
        const nz = pos.z + sz;
        if (!this.overlaps(pos.x - radius, pos.y, nz - radius, pos.x + radius, pos.y + height, nz + radius)) {
          pos.z = nz;
        } else if (grounded && stepHeight > 0) {
          const ny = pos.y + stepHeight;
          if (!this.overlaps(pos.x - radius, ny, nz - radius, pos.x + radius, ny + height, nz + radius) &&
              this.supportAt(pos.x, ny, nz, radius) != null) {
            pos.z = nz; pos.y = ny; outGrounded = true;
          } else { vel.z = 0; }
        } else { vel.z = 0; }
      }
    }

    // --- 地面吸附 ---
    if (vel.y <= 0.01) {
      const top = this.supportAt(pos.x, pos.y, pos.z, radius);
      if (top != null && pos.y - top <= 0.14 && pos.y >= top - 0.02) {
        pos.y = top;
        if (vel.y < 0) vel.y = 0;
        outGrounded = true;
      }
    }

    return outGrounded;
  }

  /** 脚下 0.6m 内最高的支撑面；没有返回 null。 */
  supportAt(x, y, z, radius) {
    let best = null;
    const minX = x - radius + EPS, maxX = x + radius - EPS;
    const minZ = z - radius + EPS, maxZ = z + radius - EPS;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (c.maxX <= minX || c.minX >= maxX || c.maxZ <= minZ || c.minZ >= maxZ) continue;
      if (c.maxY <= y + 0.02 && c.maxY > y - 0.65) {
        if (best == null || c.maxY > best) best = c.maxY;
      }
    }
    return best;
  }

  /** 射线 vs AABB（slab），返回最近命中 {t, x,y,z, nx,ny,nz, tag}。 */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, ignoreTag) {
    let best = null;
    const ix = dx !== 0 ? 1 / dx : 1e30;
    const iy = dy !== 0 ? 1 / dy : 1e30;
    const iz = dz !== 0 ? 1 / dz : 1e30;

    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (ignoreTag && c.tag === ignoreTag) continue;
      let t1 = (c.minX - ox) * ix, t2 = (c.maxX - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      let axis = 0;
      t1 = (c.minY - oy) * iy; t2 = (c.maxY - oy) * iy;
      let a = Math.min(t1, t2), b = Math.max(t1, t2);
      if (a > tmin) { tmin = a; axis = 1; }
      if (b < tmax) tmax = b;
      t1 = (c.minZ - oz) * iz; t2 = (c.maxZ - oz) * iz;
      a = Math.min(t1, t2); b = Math.max(t1, t2);
      if (a > tmin) { tmin = a; axis = 2; }
      if (b < tmax) tmax = b;
      if (tmax < 0 || tmin > tmax || tmin < 0 || tmin > maxDist) continue;
      if (best == null || tmin < best.t) {
        let nx = 0, ny = 0, nz = 0;
        const sign = axis === 0 ? (dx > 0 ? -1 : 1) : axis === 1 ? (dy > 0 ? -1 : 1) : (dz > 0 ? -1 : 1);
        if (axis === 0) nx = sign; else if (axis === 1) ny = sign; else nz = sign;
        best = {
          t: tmin,
          x: ox + dx * tmin,
          y: oy + dy * tmin,
          z: oz + dz * tmin,
          nx: nx, ny: ny, nz: nz,
          tag: c.tag || ''
        };
      }
    }
    return best;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.001) return true;
    const hit = this.raycast(ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.05);
    return !hit;
  }
}

/** 射线 vs 球，返回 t 或 -1。 */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  const t0 = tca - thc;
  const t1 = tca + thc;
  if (t1 < 0) return -1;
  return t0 >= 0 ? t0 : t1;
}

/** 射线 vs 轴对齐盒，返回 t 或 -1。 */
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxDist) {
  const ix = dx !== 0 ? 1 / dx : 1e30;
  const iy = dy !== 0 ? 1 / dy : 1e30;
  const iz = dz !== 0 ? 1 / dz : 1e30;
  let t1 = (minX - ox) * ix, t2 = (maxX - ox) * ix;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (minY - oy) * iy; t2 = (maxY - oy) * iy;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (minZ - oz) * iz; t2 = (maxZ - oz) * iz;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < 0 || tmin > tmax) return -1;
  const t = tmin >= 0 ? tmin : tmax;
  return t <= maxDist ? t : -1;
}
