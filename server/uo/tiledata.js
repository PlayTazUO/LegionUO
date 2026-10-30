import { Reader } from '../lib/reader.js';

const LAND_GROUPS = 512;
const LAND_PER_GROUP = 32;

export const TILE_FLAG_PARTIAL_HUE = 0x00040000;

export class TileDataManager {
  constructor(files, version = '7.0.104.0', versionAtLeast = (v) => true) {
    this.files = files;
    this.version = version;
    this.isOld = versionCompare(version, '7.0.90.0') < 0;
    this.loaded = false;
    this.land = [];
    this.statics = [];
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    const filePath = this.files.find('tiledata.mul');
    if (!filePath) return;
    const reader = Reader.open(filePath);

    // Client version is not a reliable indicator of the Tiledata layout:
    // some shards ship a modern (8-byte flags) tiledata.mul while still
    // advertising an old client version. Detect the layout from the file size
    // instead, using the version only as a tie-breaker.
    const layoutFits = (flags) => {
      const landGroup = 4 + LAND_PER_GROUP * (flags + 2 + 20);
      const staticGroup = 4 + LAND_PER_GROUP * (flags + 1 + 1 + 4 + 2 + 2 + 2 + 1 + 20);
      if (reader.length < LAND_GROUPS * landGroup) return false;
      return (reader.length - LAND_GROUPS * landGroup) % staticGroup === 0;
    };
    const oldFits = layoutFits(4);
    const newFits = layoutFits(8);
    if (oldFits !== newFits) this.isOld = oldFits;

    const flagSize = this.isOld ? 4 : 8;
    const landItemSize = flagSize + 2 + 20;
    const staticItemSize = flagSize + 1 + 1 + 4 + 2 + 2 + 2 + 1 + 20;
    const landGroupSize = 4 + LAND_PER_GROUP * landItemSize;
    const staticGroupSize = 4 + LAND_PER_GROUP * staticItemSize;
    const staticGroups = Math.max(0, Math.floor((reader.length - LAND_GROUPS * landGroupSize) / staticGroupSize));

    const readFlags = () => (flagSize === 4 ? BigInt(reader.readU32()) : reader.readU64());
    const readName = () => {
      const b = reader.read(20);
      let end = b.indexOf(0);
      if (end < 0) end = 20;
      return b.subarray(0, end).toString('latin1');
    };

    reader.seek(0);
    for (let g = 0; g < LAND_GROUPS; g++) {
      reader.skip(4);
      for (let i = 0; i < LAND_PER_GROUP; i++) {
        if (reader.position + landItemSize > reader.length) break;
        const flags = readFlags();
        const textId = reader.readU16();
        const name = readName();
        this.land.push({ flags: Number(flags & 0xffffffffn), textId, name });
      }
    }

    for (let g = 0; g < staticGroups; g++) {
      if (reader.position + staticGroupSize > reader.length) break;
      reader.skip(4);
      for (let i = 0; i < LAND_PER_GROUP; i++) {
        const flags = readFlags();
        const weight = reader.readU8();
        const layer = reader.readU8();
        const count = reader.readI32();
        const animId = reader.readU16();
        const hue = reader.readU16();
        const lightIndex = reader.readU16();
        const height = reader.readU8();
        const name = readName();
        this.statics.push({
          flags: Number(flags & 0xffffffffn),
          weight,
          layer,
          count,
          animId,
          hue,
          lightIndex,
          height,
          name,
        });
      }
    }
    reader.close();
  }

  /** Whether this land/static graphic is flagged for partial hueing. */
  isPartialHue(id, isLand = false) {
    this.load();
    const entry = isLand ? this.land[id] : this.statics[id];
    return !!entry && (entry.flags & TILE_FLAG_PARTIAL_HUE) !== 0;
  }

  toJSON() {
    this.load();
    return {
      land: this.land.map((t) => [t.flags, t.name]),
      statics: this.statics.map((t) => [t.flags, t.height, t.layer, t.animId, t.name]),
    };
  }
}

export function versionCompare(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
