import fs from 'node:fs';
import path from 'node:path';
import { color16To32 } from './colors.js';

export class GumpsManager {
  constructor(files, hues) {
    this.files = files;
    this.hues = hues;
    this.loaded = false;
    this.filesList = [];
    this.file = null;
    this.isUop = false;
    this.ours = new Map();
    this.defs = new Map();
    this.empty = { width: 0, height: 0, pixels: new Uint32Array(0) };
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    const uop = this.files.uop('gumpartLegacyMUL.uop', 'build/gumpartlegacymul/{0:D8}.tga', true);
    const mul = this.files.mul('gumpart.mul', 'gumpidx.mul');
    // Keep both archives: a UOP can miss individual gumps that the legacy
    // MUL still has, and vice versa.
    this.filesList = [uop, mul].filter(Boolean);
    this.file = this.filesList[0] || null;
    this.isUop = this.file === uop && !!uop;
    this.scanOurs();
    this.loadDefs();
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

  /**
   * Gump.def only fills an empty gump slot, exactly like TazUO: a shard can
   * point a paperdoll id that its art does not contain (for example UOAlive's
   * 50759 Arcane robe) at a gump it does ship.
   */
  loadDefs() {
    const file = this.files.find('gump.def');
    if (!file) return;
    let text;
    try {
      text = fs.readFileSync(file, 'latin1');
    } catch {
      return;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      if (!line) continue;
      const match = line.match(/^(\d+)\s*\{([^}]*)\}/);
      if (!match) continue;
      const target = Number.parseInt(match[1], 10);
      if (!(target >= 0 && target < 0x10000)) continue;
      const options = match[2]
        .split(/[\s,]+/)
        .map((part) => Number.parseInt(part, 10))
        .filter((id) => Number.isFinite(id) && id >= 0 && id < 0x10000);
      if (options.length) this.defs.set(target, options);
    }
  }

  entryFor(id) {
    for (const file of this.filesList) {
      const entry = file.entries[id];
      if (entry && entry.length > 0) return { file, entry };
    }
    return null;
  }

  hasEntry(id) {
    if (this.ours.has(id)) return true;
    return !!this.entryFor(id);
  }

  aliasFor(id) {
    const options = this.defs.get(id);
    if (!options) return -1;
    for (const source of options) {
      if (this.hasEntry(source)) return source;
    }
    return -1;
  }

  exists(id) {
    this.load();
    if (this.hasEntry(id)) return true;
    return this.aliasFor(id) >= 0;
  }

  get(id, hue = 0, partial = false) {
    this.load();
    if (this.ours.has(id)) {
      const ours = this.readOurs(this.ours.get(id));
      if (ours.width > 0) return ours;
    }
    let found = this.entryFor(id);
    if (!found) {
      const source = this.aliasFor(id);
      if (source < 0) return this.empty;
      if (this.ours.has(source)) {
        const ours = this.readOurs(this.ours.get(source));
        if (ours.width > 0) return ours;
      }
      found = this.entryFor(source);
      if (!found) return this.empty;
    }
    return this.readEntry(found.file, found.entry, hue, partial);
  }

  readEntry(file, entry, hue = 0, partial = false) {
    if (entry.compression >= 1) {
      const data = this.files.readEntry(file, entry);
      if (!data || data.length < 8) return this.empty;
      const width = data.readUInt32LE(0);
      const height = data.readUInt32LE(4);
      if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return this.empty;
      return this.decode(data.subarray(8), width, height, hue, partial);
    }

    const width = entry.width;
    const height = entry.height;
    if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return this.empty;
    const data = this.files.readEntry(file, { ...entry, compression: 0 });
    if (!data || data.length < height * 4) return this.empty;
    return this.decode(data, width, height, hue, partial);
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

  decode(data, width, height, hue = 0, partial = false) {
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
        const color = value !== 0 ? (255 << 24) | color16To32(this.hues.getColor16(value, hue, partial)) : 0;
        pixels.fill(color, pixelIndex, pixelIndex + run);
        pixelIndex += run;
      }
    }
    return { width, height, pixels };
  }

}
