import fs from 'node:fs';
import { color16To32 } from './colors.js';

const MAX_TEXMAP_SIZE = 128;
const MIN_TEXMAP_SIZE = 64;

export class TexmapManager {
  constructor(files, hues) {
    this.files = files;
    this.hues = hues;
    this.loaded = false;
    this.file = null;
    this.empty = { width: 0, height: 0, pixels: new Uint32Array(0) };
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.file = this.files.mul('texmaps.mul', 'texidx.mul');
    this.loadTerrDef();
  }

  loadTerrDef() {
    if (!this.file) return;
    const filePath = this.files.find('TexTerr.def');
    if (!filePath) return;
    let text;
    try {
      text = fs.readFileSync(filePath, 'latin1');
    } catch {
      return;
    }
    const entries = this.file.entries;
    for (const rawLine of String(text).split(/\r?\n/)) {
      let line = rawLine.trim();
      if (!line || line[0] === '#' || !/[0-9]/.test(line[0])) continue;
      const comment = line.indexOf('#');
      if (comment >= 0) line = line.slice(0, comment);
      const open = line.indexOf('{');
      const close = line.indexOf('}');
      if (open < 0 || close < open) continue;
      const index = parseInt(line.slice(0, open).trim(), 10);
      if (!Number.isFinite(index) || index < 0 || index >= entries.length) continue;
      const group = line
        .slice(open + 1, close)
        .split(/[,\s]+/)
        .map((value) => parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value >= 0 && value < entries.length);
      for (const checkIndex of group) entries[index] = entries[checkIndex];
    }
  }

  entry(index) {
    this.load();
    if (!this.file) return null;
    const entry = this.file.entries[index];
    if (!entry || entry.length <= 0 || entry.offset === 0xffffffff) return null;
    return entry;
  }

  get(index, hue = 0) {
    const entry = this.entry(index);
    if (!entry) return this.empty;
    const raw = this.files.readEntry(this.file, entry);
    if (!raw || raw.length < 8) return this.empty;

    let size = entry.length === 0x2000 ? MIN_TEXMAP_SIZE : MAX_TEXMAP_SIZE;
    if (raw.length < size * size * 2) {
      if (raw.length >= MIN_TEXMAP_SIZE * MIN_TEXMAP_SIZE * 2) size = MIN_TEXMAP_SIZE;
      else return this.empty;
    }

    const pixels = new Uint32Array(size * size);
    for (let i = 0; i < pixels.length; i++) {
      const c = raw[i * 2] | (raw[i * 2 + 1] << 8);
      pixels[i] = color16To32(this.hues.getColor16(c, hue));
    }
    return { width: size, height: size, pixels };
  }
}
