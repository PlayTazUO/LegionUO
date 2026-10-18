const LAND_BLOCK_LENGTH = 64 * 3;
const STATIC_SIZE = 7;
const CRC_BLOCKS = 5;

function wrap(value, size) {
  return ((value % size) + size) % size;
}

function decodeBase64(text) {
  if (!text) return null;
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function cellsToLand(cells) {
  const land = new Uint8Array(LAND_BLOCK_LENGTH);
  for (let i = 0; i < 64; i++) {
    const cell = cells[i] || { tile: 0, z: 0 };
    const p = i * 3;
    land[p] = cell.tile & 0xff;
    land[p + 1] = (cell.tile >> 8) & 0xff;
    land[p + 2] = cell.z & 0xff;
  }
  return land;
}

function landToCells(land) {
  const cells = new Array(64);
  for (let i = 0; i < 64; i++) {
    const p = i * 3;
    cells[i] = {
      tile: (land[p] | (land[p + 1] << 8)) & 0x3fff,
      z: (land[p + 2] << 24) >> 24,
    };
  }
  return cells;
}

function parseStatics(raw) {
  const statics = [];
  for (let p = 0; p + STATIC_SIZE <= raw.length; p += STATIC_SIZE) {
    const graphic = raw[p] | (raw[p + 1] << 8);
    if (graphic === 0 || graphic === 0xffff) continue;
    statics.push({
      graphic,
      x: raw[p + 2],
      y: raw[p + 3],
      z: (raw[p + 4] << 24) >> 24,
      hue: raw[p + 5] | (raw[p + 6] << 8),
    });
  }
  return statics;
}

function fletcher16(data) {
  let sum1 = 0;
  let sum2 = 0;
  for (let i = 0; i < data.length; i++) {
    sum1 += data[i];
    if (sum1 >= 255) sum1 -= 255;
    sum2 += sum1;
    if (sum2 >= 255) sum2 -= 255;
  }
  return ((sum2 << 8) | sum1) & 0xffff;
}

export class UltimaLiveManager {
  constructor(world) {
    this.world = world;
    this.active = false;
    this.shardName = '';
    this.patches = new Map();
    this.sizes = new Map();
  }

  reset() {
    this.active = false;
    this.shardName = '';
    this.patches.clear();
    this.sizes.clear();
  }

  mapSize(mapIndex) {
    const config = this.world.config?.maps?.[mapIndex];
    if (Array.isArray(config) && config.length >= 2) return config;
    const server = this.sizes.get(mapIndex);
    if (server) return server;
    return [7168, 4096];
  }

  blocksX(mapIndex) {
    return Math.max(0, this.mapSize(mapIndex)[0] >> 3);
  }

  blocksY(mapIndex) {
    return Math.max(0, this.mapSize(mapIndex)[1] >> 3);
  }

  blockFor(mapIndex, bx, by) {
    return bx * this.blocksY(mapIndex) + by;
  }

  onPacket(r) {
    r.seek(13);
    const command = r.readU8();
    const mapId = r.readU8();

    if (command === 0x02) {
      r.seek(15);
      this.shardName = r.readASCII();
      this.active = true;
      return;
    }

    if (command === 0x01) {
      r.seek(7);
      const count = Math.floor((r.readU32BE() * 7) / 9);
      r.seek(15);
      for (let i = 0; i < count && r.remaining() >= 9; i++) {
        const index = r.readU8();
        const width = r.readU16BE();
        const height = r.readU16BE();
        r.readU16BE();
        r.readU16BE();
        if (width > 0 && height > 0) this.sizes.set(index, [width, height]);
      }
      return;
    }

    if (command === 0x10) {
      r.seek(14);
      const count = r.readU8();
      for (let i = 0; i < count && r.remaining() >= 5; i++) {
        const index = r.readU8();
        const width = r.readU16BE();
        const height = r.readU16BE();
        if (width > 0 && height > 0) this.sizes.set(index, [width, height]);
      }
      return;
    }

    if (command === 0xff) {
      r.seek(3);
      const block = r.readU32BE();
      r.seek(14);
      const map = r.readU8();
      this.queryHashes(block, map);
      return;
    }

    if (command === 0x00) {
      r.seek(3);
      const block = r.readU32BE();
      const count = r.readU32BE();
      r.seek(14);
      const map = r.readU8();
      const raw = new Uint8Array(r.readBytes(count * STATIC_SIZE));
      if (!raw.length) return;
      this.storePatch(map, block, { statics: parseStatics(raw), staticsRaw: raw });
    }
  }

  onTerrain(r) {
    const block = r.readU32BE();
    const land = new Uint8Array(r.readBytes(LAND_BLOCK_LENGTH));
    r.seek(200);
    const mapId = r.readU8();
    if (land.length !== LAND_BLOCK_LENGTH) return;
    this.storePatch(mapId, block, { land });
  }

  async queryHashes(block, mapId) {
    if (mapId !== this.world.mapIndex) return;
    const blocksX = this.blocksX(mapId);
    const blocksY = this.blocksY(mapId);
    if (blocksX <= 0 || blocksY <= 0) return;
    if (block < 0 || block >= blocksX * blocksY) return;

    const blockX = Math.floor(block / blocksY);
    const blockY = block % blocksY;
    const checksums = new Uint16Array(CRC_BLOCKS * CRC_BLOCKS);
    const tasks = [];

    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const bx = wrap(blockX + dx, blocksX);
        const by = wrap(blockY + dy, blocksY);
        tasks.push(
          this.world.requestBlock(bx, by).then((data) => {
            checksums[(dx + 2) * CRC_BLOCKS + (dy + 2)] = data ? this.blockCrc(data) : 0;
          })
        );
      }
    }

    await Promise.all(tasks);
    if (mapId !== this.world.mapIndex) return;
    this.world.socket?.out?.uoLiveHash(block, mapId, checksums);
  }

  storePatch(mapId, block, patch) {
    const key = `${mapId}|${block}`;
    const existing = this.patches.get(key) || {};
    this.patches.set(key, { ...existing, ...patch });

    const blocksY = this.blocksY(mapId);
    if (blocksY <= 0) return;
    const bx = Math.floor(block / blocksY);
    const by = block % blocksY;
    const cacheKey = `${mapId}|${this.world.useXMapFiles ? 'x' : 'm'}|${bx}|${by}`;
    const data = this.world.mapCache.get(cacheKey);
    if (!data) return;

    this.applyToBlock(data, mapId, bx, by);
    for (const cb of this.world.mapListeners) cb(cacheKey, data);
  }

  applyToBlock(data, mapId, bx, by) {
    if (!data) return data;
    if (!data.landRaw && data.land) {
      data.landRaw = decodeBase64(data.land);
      delete data.land;
    }
    if (!data.staticsRawBytes && data.staticsRaw) {
      data.staticsRawBytes = decodeBase64(data.staticsRaw);
      delete data.staticsRaw;
    }

    const blocksY = this.blocksY(mapId);
    if (blocksY <= 0) return data;
    const patch = this.patches.get(`${mapId}|${bx * blocksY + by}`);
    if (!patch) return data;

    if (patch.land) {
      data.landRaw = patch.land;
      data.cells = landToCells(patch.land);
    }
    if (patch.statics) {
      data.statics = patch.statics.map((s) => ({ ...s }));
      data.staticsRawBytes = patch.staticsRaw;
      delete data._staticGrid;
    }
    return data;
  }

  blockCrc(data) {
    const land = data.landRaw || cellsToLand(data.cells || []);
    const staticBytes = data.staticsRawBytes || staticsToBytes(data.statics || []);
    const bytes = new Uint8Array(land.length + staticBytes.length);
    bytes.set(land, 0);
    bytes.set(staticBytes, land.length);
    return fletcher16(bytes);
  }
}

function staticsToBytes(statics) {
  const bytes = new Uint8Array(statics.length * STATIC_SIZE);
  let p = 0;
  for (const s of statics) {
    bytes[p++] = s.graphic & 0xff;
    bytes[p++] = (s.graphic >> 8) & 0xff;
    bytes[p++] = s.x & 0xff;
    bytes[p++] = s.y & 0xff;
    bytes[p++] = s.z & 0xff;
    bytes[p++] = s.hue & 0xff;
    bytes[p++] = (s.hue >> 8) & 0xff;
  }
  return bytes;
}

export { fletcher16, parseStatics, cellsToLand, landToCells };
