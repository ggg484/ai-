// 地图注册表：后续第三张地图只需要在这里加一项。
import { buildMap } from './map.js';
import { buildOasis } from './map-oasis.js';

export const MAPS = {
  sandline: {
    id: 'sandline',
    name: '沙城协议',
    nameEn: 'SANDLINE',
    desc: 'A 大 / B 洞 / 中路，经典沙城三角',
    build: buildMap
  },
  oasis: {
    id: 'oasis',
    name: '绿洲',
    nameEn: 'OASIS',
    desc: 'A 长 / B 公寓 / 中路窗口，暖砂岩新城',
    build: buildOasis
  }
};

export function mapById(id) {
  return MAPS[id] || MAPS.sandline;
}

export function mapList() {
  return Object.values(MAPS);
}
