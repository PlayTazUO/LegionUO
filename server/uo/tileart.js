/**
 * Minimal TileArt.uop reader. Only the appearance table is needed: TazUO uses
 * it to map an item graphic + mobile body onto a paperdoll/gump appearance id.
 */
export class TileArtManager {
  constructor(files) {
    this.files = files;
    this.loaded = false;
    this.file = null;
    this.cache = new Map();
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.file = this.files.uop('tileart.uop', 'build/tileart/{0:D8}.bin');
  }

  get(graphic) {
    this.load();
    if (!this.file) return null;
    if (this.cache.has(graphic)) return this.cache.get(graphic);
    const entry = this.file.entries[graphic];
    if (!entry || entry.length <= 0) {
      this.cache.set(graphic, null);
      return null;
    }
    const buf = this.files.readEntry(this.file, entry);
    const appearances = buf ? parseAppearances(buf) : null;
    this.cache.set(graphic, appearances);
    return appearances;
  }
}

function parseAppearances(buf) {
  try {
    if (buf.length < 120) return null;
    let ptr = 0;
    const u8 = () => buf.readUInt8(ptr++);
    const u16 = () => {
      const value = buf.readUInt16LE(ptr);
      ptr += 2;
      return value;
    };
    const u32 = () => {
      const value = buf.readUInt32LE(ptr);
      ptr += 4;
      return value;
    };
    const skip = (count) => {
      ptr += count;
    };

    const version = u16();
    if (version !== 4) return null;
    u32();
    u32();
    u8();
    u8();
    for (let i = 0; i < 5; i++) u32();
    u32();
    u8();
    u32();
    u32();
    u32();
    u32();
    u32();
    skip(16);
    u32();
    skip(48);
    for (let i = 0; i < 2; i++) {
      const props = u8();
      skip(props * 5);
    }
    const aliases = u32();
    skip(aliases * 8);

    const out = {};
    const appearanceCount = u32();
    for (let i = 0; i < appearanceCount; i++) {
      const subType = u8();
      if (subType === 1) {
        u8();
        u32();
        continue;
      }
      const count = u32();
      for (let j = 0; j < count; j++) {
        const value = u32();
        const animId = u32();
        if (subType !== 0) continue;
        const body = value % 1000;
        const appearance = animId + Math.floor(value / 1000);
        if (appearance > 0 && appearance < 0x10000) out[body] = appearance;
      }
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
