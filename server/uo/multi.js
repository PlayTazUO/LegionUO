export class MultiManager {
  constructor(files, version = '7.0.104.0') {
    this.files = files;
    this.version = version;
    this.loaded = false;
    this.file = null;
    this.isUop = false;
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    const uop = this.files.uop('MultiCollection.uop', 'build/multicollection/{0:D6}.bin', false);
    if (uop) {
      this.file = uop;
      this.isUop = true;
    } else {
      const mul = this.files.mul('multi.mul', 'multi.idx');
      if (mul) this.file = mul;
    }
  }

  get(id) {
    this.load();
    if (!this.file) return [];
    const entry = this.file.entries[id];
    if (!entry || entry.length <= 0) return [];
    const data = this.files.readEntry(this.file, entry);
    if (!data) return [];

    const list = [];
    if (this.isUop || entry.compression >= 1) {
      if (data.length < 8) return [];
      const count = data.readInt32LE(4);
      let ptr = 8;
      for (let i = 0; i < count && ptr + 16 <= data.length; i++) {
        const graphic = data.readUInt16LE(ptr);
        const x = data.readInt16LE(ptr + 2);
        const y = data.readInt16LE(ptr + 4);
        const z = data.readInt16LE(ptr + 6);
        const flags = data.readUInt16LE(ptr + 8);
        ptr += 12;
        const unknown = data.readUInt32LE(ptr);
        ptr += 4;
        if (unknown !== 0) ptr += unknown * 4;
        list.push({ graphic, x, y, z, visible: flags === 0 || flags === 0x100 });
      }
    } else {
      const size = 2 + 2 + 2 + 2 + 4;
      const count = Math.floor(entry.length / size);
      let ptr = 0;
      for (let i = 0; i < count && ptr + size <= data.length; i++) {
        const graphic = data.readUInt16LE(ptr);
        const x = data.readInt16LE(ptr + 2);
        const y = data.readInt16LE(ptr + 4);
        const z = data.readInt16LE(ptr + 6);
        const flags = data.readUInt32LE(ptr + 8);
        ptr += size;
        list.push({ graphic, x, y, z, visible: flags !== 0 });
      }
    }
    return list;
  }
}
