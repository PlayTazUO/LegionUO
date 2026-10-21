import fs from 'node:fs';
import path from 'node:path';
import { color16To32 } from './colors.js';

export class GumpsManager {
  constructor(files, hues) {
    this.files = files;
    this.hues = hues;
    this.loaded = false;
    this.file = null;
    this.isUop = false;
    this.ours = new Map();
    this.empty = { width: 0, height: 0, pixels: new Uint32Array(0) };
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    const uop = this.files.uop('gumpartLegacyMUL.uop', 'build/gumpartlegacymul/{0:D8}.tga', true);
    if (uop) {
      this.file = uop;
      this.isUop = true;
    } else {
      const mul = this.files.mul('gumpart.mul', 'gumpidx.mul');
      if (mul) {
        this.file = mul;
        this.isUop = false;
      }
    }
    this.scanOurs();
  }

  scanOurs() {
    const dir = path.join(this.files.dir, 'Gumps');
    try {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        if (!name.toLowerCase().endsWith('.gump')) continue;
        const id = parseInt(name.slice(0, -5), 10);
        if (Number.isFinite(id) && id >= 0 && id < 0x10000) this.ours.set(id, path.join(dir, name));
      }
    } catch {
      /* ignore */
    }
  }

  exists(id) {
    this.load();
    if (this.ours.has(id)) return true;
    if (!this.file) return false;
    const entry = this.file.entries[id];
    return !!entry && entry.length > 0;
  }

  get(id, hue = 0) {
    this.load();
    if (this.ours.has(id)) {
      const ours = this.readOurs(this.ours.get(id));
      if (ours.width > 0) return ours;
    }
    if (!this.file) return this.empty;
    const entry = this.file.entries[id];
    if (!entry || entry.length <= 0) return this.empty;

    if (entry.compression >= 1) {
      const data = this.files.readEntry(this.file, entry);
      if (!data || data.length < 8) return this.empty;
      const width = data.readUInt32LE(0);
      const height = data.readUInt32LE(4);
      if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return this.empty;
      return this.decode(data.subarray(8), width, height, hue);
    }

    const width = entry.width;
    const height = entry.height;
    if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return this.empty;
    const data = this.files.readEntry(this.file, { ...entry, compression: 0 });
    if (!data || data.length < height * 4) return this.empty;
    return this.decode(data, width, height, hue);
  }

  readOurs(file) {
    try {
      const raw = fs.readFileSync(file);
      if (raw.length < 8) return this.empty;
      const width = raw.readUInt32LE(0);
      const height = raw.readUInt32LE(4);
      if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return this.empty;
      return this.decode(raw.subarray(8), width, height);
    } catch {
      return this.empty;
    }
  }

  decode(data, width, height, hue = 0) {
    const pixels = new Uint32Array(width * height);
    const rowLookup = new Int32Array(height);
    for (let i = 0; i < height; i++) rowLookup[i] = data.readInt32LE(i * 4);
    const halfLen = data.length >> 2;
    let ptr = 0;
    for (let y = 0; y < height; y++) {
      const start = rowLookup[y];
      ptr = start * 4;
      let pixelIndex = y * width;
      const gsize = y < height - 1 ? rowLookup[y + 1] - start : halfLen - start;
      for (let i = 0; i < gsize; i++) {
        if (ptr + 4 > data.length) break;
        const value = data.readUInt16LE(ptr);
        const run = data.readUInt16LE(ptr + 2);
        ptr += 4;
        if (pixelIndex < 0 || run <= 0 || pixelIndex + run > pixels.length) break;
        const color = value !== 0 ? (255 << 24) | color16To32(this.hues.getColor16(value, hue)) : 0;
        pixels.fill(color, pixelIndex, pixelIndex + run);
        pixelIndex += run;
      }
    }
    return { width, height, pixels };
  }

}
