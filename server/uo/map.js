import { Reader } from '../lib/reader.js';

export const MAP_SIZES = [
  [7168, 4096],
  [7168, 4096],
  [2304, 1600],
  [2560, 2048],
  [1448, 1448],
  [1280, 4096],
];

const MAP_BLOCK_SIZE = 196;
const STAIDX_SIZE = 12;
const STATIC_SIZE = 7;

export class MapManager {
  constructor(files, mapCount = 6) {
    this.files = files;
    this.mapCount = mapCount;
    this.maps = new Map();
    this.sizes = MAP_SIZES.slice(0, mapCount).map(([w, h]) => [w, h]);
  }

  get(mapIndex, useXFiles = false) {
    if (mapIndex < 0 || mapIndex >= this.mapCount) return null;
    const key = `${mapIndex}|${useXFiles ? 'x' : ''}`;
    if (this.maps.has(key)) return this.maps.get(key);

    let map = null;
    let uop = null;
    if (useXFiles) {
      uop = this.files.uop(`map${mapIndex}xLegacyMUL.uop`, `build/map${mapIndex}legacymul/{0:D8}.dat`, false);
    }
    if (!uop) {
      uop = this.files.uop(`map${mapIndex}LegacyMUL.uop`, `build/map${mapIndex}legacymul/{0:D8}.dat`, false);
    }
    if (uop) {
      map = { type: 'uop', file: uop };
    } else {
      let mul = null;
      if (useXFiles) mul = this.files.mul(`map${mapIndex}x.mul`);
      if (!mul) mul = this.files.mul(`map${mapIndex}.mul`);
      if (mul) map = { type: 'mul', file: mul };
    }
    if (!map) {
      this.maps.set(key, null);
      return null;
    }

    let staticFile = null;
    let idxFile = null;
    if (useXFiles) {
      staticFile = this.files.mul(`statics${mapIndex}x.mul`);
      idxFile = this.files.mul(`staidx${mapIndex}x.mul`);
    }
    if (!staticFile) staticFile = this.files.mul(`statics${mapIndex}.mul`);
    if (!idxFile) idxFile = this.files.mul(`staidx${mapIndex}.mul`);
    map.statics = staticFile;
    map.staidx = idxFile;
    map.width = this.sizes[mapIndex][0];
    map.height = this.sizes[mapIndex][1];
    map.blocksX = map.width >> 3;
    map.blocksY = map.height >> 3;
    this.maps.set(key, map);
    return map;
  }

  getBlock(mapIndex, bx, by, useXFiles = false) {
    const map = this.get(mapIndex, useXFiles);
    if (!map || bx < 0 || by < 0 || bx >= map.blocksX || by >= map.blocksY) return null;
    const block = bx * map.blocksY + by;

    let mapPos;
    if (map.type === 'mul') {
      mapPos = block * MAP_BLOCK_SIZE;
    } else {
      const chunk = block >> 12 & 0xfff;
      const entry = map.file.entries[chunk];
      if (!entry) return null;
      // UOP map files store 4096 blocks per file entry.
      mapPos = entry.offset + (block & 0xfff) * MAP_BLOCK_SIZE;
    }

    const raw = map.file.reader.readAt(mapPos, MAP_BLOCK_SIZE);
    if (!raw || raw.length < MAP_BLOCK_SIZE) return null;
    const cells = new Array(64);
    for (let i = 0; i < 64; i++) {
      const p = 4 + i * 3;
      cells[i] = { tile: raw.readUInt16LE(p) & 0x3fff, z: raw.readInt8(p + 2) };
    }

    let staticsRaw = null;
    const statics = [];
    if (map.staidx) {
      const idxPos = block * STAIDX_SIZE;
      const idxRaw = map.staidx.reader.readAt(idxPos, STAIDX_SIZE);
      if (idxRaw && idxRaw.length >= STAIDX_SIZE) {
        const position = idxRaw.readUInt32LE(0);
        const size = idxRaw.readUInt32LE(4);
        if (size > 0 && position !== 0xffffffff && map.statics) {
          const count = Math.min(1024, Math.floor(size / STATIC_SIZE));
          const staticRaw = map.statics.reader.readAt(position, count * STATIC_SIZE);
          if (staticRaw) {
            staticsRaw = staticRaw;
            for (let i = 0; i < count; i++) {
              const p = i * STATIC_SIZE;
              if (p + STATIC_SIZE > staticRaw.length) break;
              const graphic = staticRaw.readUInt16LE(p);
              if (graphic === 0 || graphic === 0xffff) continue;
              statics.push({
                graphic,
                x: staticRaw.readUInt8(p + 2),
                y: staticRaw.readUInt8(p + 3),
                z: staticRaw.readInt8(p + 4),
                hue: staticRaw.readUInt16LE(p + 5),
              });
            }
          }
        }
      }
    }

    return {
      bx,
      by,
      cells,
      statics,
      land: raw.subarray(4, 4 + 64 * 3).toString('base64'),
      staticsRaw: staticsRaw ? staticsRaw.toString('base64') : '',
    };
  }
}
