import { versionCompare } from './tiledata.js';

// Client 7.0.9.0 (High Seas) switched the multi entries in multi.mul from the
// 12-byte layout to a 16-byte layout with a 64-bit tile flag field. ServUO's
// MapDefinitions enables that layout unconditionally for modern shards, so the
// advertised client version is what tells us which stride to use.
const POST_HS_MULTI_VERSION = '7.0.9.0';

export class MultiManager {
  constructor(files, version = '7.0.104.0') {
    this.files = files;
    this.version = version;
    this.postHSFormat = versionCompare(version, POST_HS_MULTI_VERSION) >= 0;
    this.loaded = false;
    this.filesList = [];
    this.file = null;
    this.isUop = false;
    this.legacyEntrySize = this.postHSFormat ? 16 : 12;
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    const uop = this.files.uop('MultiCollection.uop', 'build/multicollection/{0:D6}.bin', false);
    const mul = this.files.mul('multi.mul', 'multi.idx');
    this.filesList = [
      uop ? { file: uop, isUop: true } : null,
      mul ? { file: mul, isUop: false } : null,
    ].filter(Boolean);
    this.file = this.filesList[0]?.file || null;
    this.isUop = !!this.filesList[0]?.isUop;
    this.legacyEntrySize = this.detectLegacyEntrySize();
  }

  /**
   * The version check is the normal signal, but some installations advertise a
   * modern client while shipping an old multi.mul (or the reverse). Entry
   * lengths are an exact multiple of the record stride, so use them to break
   * ties or override a bad version string.
   */
  detectLegacyEntrySize() {
    const mul = this.filesList.find((source) => !source.isUop)?.file;
    if (!mul?.entries?.length) return this.postHSFormat ? 16 : 12;
    let fits16 = 0;
    let fits12 = 0;
    let sampled = 0;
    for (const entry of mul.entries) {
      if (!entry || entry.length < 12) continue;
      if (entry.length % 16 === 0) fits16++;
      if (entry.length % 12 === 0) fits12++;
      if (++sampled >= 512) break;
    }
    if (fits16 !== fits12) return fits16 > fits12 ? 16 : 12;
    return this.postHSFormat ? 16 : 12;
  }

  get(id) {
    this.load();
    for (const source of this.filesList) {
      const entry = source.file.entries[id];
      if (!entry || entry.length <= 0) continue;
      const data = this.files.readEntry(source.file, entry);
      if (!data) continue;
      return this.readMulti(data, entry, source.isUop);
    }
    return [];
  }

  readMulti(data, entry, isUop) {
    const list = [];
    if (isUop) {
      // MultiCollection.uop files are a count followed by 14-byte records:
      // id (u16), x/y/z (i16), flags (u16), cliloc count (u32), clilocs.
      // The cliloc count sits at offset 10, not 12; getting that wrong
      // desynchronises every following record.
      if (data.length < 8) return [];
      const count = data.readInt32LE(4);
      let ptr = 8;
      for (let i = 0; i < count && ptr + 14 <= data.length; i++) {
        const graphic = data.readUInt16LE(ptr);
        const x = data.readInt16LE(ptr + 2);
        const y = data.readInt16LE(ptr + 4);
        const z = data.readInt16LE(ptr + 6);
        const flags = data.readUInt16LE(ptr + 8);
        const clilocs = data.readUInt32LE(ptr + 10);
        ptr += 14;
        if (clilocs > 0) ptr += clilocs * 4;
        // ClassicUO treats flags 0 (background) and 0x100 (generic) as
        // visible in UOP multis; 1 (none) is a hidden component.
        list.push({ graphic, x, y, z, visible: flags === 0 || flags === 0x100 });
      }
    } else if (this.legacyEntrySize === 16) {
      // Post-High-Seas 16-byte records: id, x, y, z, 64-bit flags.
      // Only the first component is shown when its flag is zero; every other
      // component must have a real flag to be visible.
      const size = 16;
      const count = Math.floor(entry.length / size);
      let ptr = 0;
      for (let i = 0; i < count && ptr + size <= data.length; i++) {
        const graphic = data.readUInt16LE(ptr);
        const x = data.readInt16LE(ptr + 2);
        const y = data.readInt16LE(ptr + 4);
        const z = data.readInt16LE(ptr + 6);
        const flags = data.readBigUInt64LE(ptr + 8);
        ptr += size;
        list.push({ graphic, x, y, z, visible: i === 0 || flags !== 0n });
      }
    } else {
      // Pre-High-Seas 12-byte records: id, x, y, z, 32-bit flags.
      const size = 12;
      const count = Math.floor(entry.length / size);
      let ptr = 0;
      for (let i = 0; i < count && ptr + size <= data.length; i++) {
        const graphic = data.readUInt16LE(ptr);
        const x = data.readInt16LE(ptr + 2);
        const y = data.readInt16LE(ptr + 4);
        const z = data.readInt16LE(ptr + 6);
        const flags = data.readUInt32LE(ptr + 8);
        ptr += size;
        list.push({ graphic, x, y, z, visible: i === 0 || flags !== 0 });
      }
    }
    return list;
  }
}
