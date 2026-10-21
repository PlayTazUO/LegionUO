import fs from 'node:fs';
import path from 'node:path';
import { color16To32 } from './colors.js';

export const MAX_LAND = 0x4000;
export const MAX_STATIC = 0x14000;

export class ArtManager {
  constructor(files, hues) {
    this.files = files;
    this.hues = hues;
    this.loaded = false;
    this.filesList = [];
    this.file = null;
    this.isUop = false;
    this.ourLand = new Map();
    this.ourStatics = new Map();
    this.empty = { width: 0, height: 0, pixels: new Uint32Array(0) };
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    const uop = this.files.uop('artLegacyMUL.uop', 'build/artlegacymul/{0:D8}.tga', false);
    const mul = this.files.mul('art.mul', 'artidx.mul');
    // Individual entries can be missing from a UOP while the legacy MUL still
    // contains them, so keep both archives and fall through per entry.
    this.filesList = [uop, mul].filter(Boolean);
    this.file = this.filesList[0] || null;
    this.isUop = this.file === uop && !!uop;
    this.scanOurs();
  }

  scanOurs() {
    const scan = (dirName, map, limit) => {
      const dir = path.join(this.files.dir, dirName);
      try {
        if (!fs.existsSync(dir)) return;
        for (const name of fs.readdirSync(dir)) {
          if (!name.toLowerCase().endsWith('.art')) continue;
          const id = parseInt(name.slice(0, -4), 10);
          if (!Number.isFinite(id) || id < 0 || id >= limit) continue;
          map.set(id, path.join(dir, name));
        }
      } catch {
        /* ignore */
      }
    };
    scan('Art/Land', this.ourLand, MAX_LAND);
    scan('Art/Statics', this.ourStatics, MAX_STATIC - MAX_LAND);
  }

  entryFor(index) {
    this.load();
    for (const file of this.filesList) {
      const entry = file.entries[index];
      if (entry && entry.length > 0) return { file, entry };
    }
    return null;
  }

  entry(index) {
    return this.entryFor(index)?.entry || null;
  }

  getLand(id, hue = 0) {
    this.load();
    if (this.ourLand.has(id)) {
      const raw = readFileSafe(this.ourLand.get(id));
      if (raw && raw.length >= 2024) return makeLand(raw.subarray(0, 2024), this.hues, hue);
    }
    for (const file of this.filesList) {
      const entry = file.entries[id];
      if (!entry || entry.length <= 0) continue;
      const raw = this.files.readEntry(file, { ...entry, compression: 0 });
      if (raw && raw.length >= 2024) return makeLand(raw.subarray(0, 2024), this.hues, hue);
    }
    return this.empty;
  }

  getStatic(id, hue = 0) {
    this.load();
    if (this.ourStatics.has(id)) {
      const raw = readFileSafe(this.ourStatics.get(id));
      if (raw && raw.length >= 8) {
        const width = raw.readInt16LE(4);
        const height = raw.readInt16LE(6);
        if (width > 0 && height > 0) return runs(raw.subarray(8), width, height, this.hues, hue);
      }
    }
    const index = id + MAX_LAND;
    for (const file of this.filesList) {
      const entry = file.entries[index];
      if (!entry || entry.length <= 0) continue;
      const raw = this.files.readEntry(file, entry);
      if (!raw || raw.length < 8) continue;
      const width = raw.readInt16LE(4);
      const height = raw.readInt16LE(6);
      if (width <= 0 || height <= 0 || width > 4096 || height > 4096) continue;
      if (raw.length < 8 + height * 2 + 4) continue;
      return runs(raw.subarray(8), width, height, this.hues, hue);
    }
    return this.empty;
  }
}

function readFileSafe(file) {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

function makeLand(raw, hues, hue) {
  const pixels = new Uint32Array(44 * 44);
  let at = 0;
  for (let i = 0; i < 22; ++i) {
    let pos = i * 44 + (22 - (i + 1));
    const end = 22 - (i + 1) + ((i + 1) << 1);
    for (let j = 22 - (i + 1); j < end; ++j, at += 2) {
      const c = raw[at] | (raw[at + 1] << 8);
      pixels[pos++] = (255 << 24) | color16To32(hues.getColor16(c, hue));
    }
  }
  for (let i = 0; i < 22; ++i) {
    let pos = (i + 22) * 44 + i;
    const end = i + ((22 - i) << 1);
    for (let j = i; j < end; ++j, at += 2) {
      const c = raw[at] | (raw[at + 1] << 8);
      pixels[pos++] = (255 << 24) | color16To32(hues.getColor16(c, hue));
    }
  }
  return { width: 44, height: 44, pixels };
}

function runs(buf, width, height, hues, hue) {
  const pixels = new Uint32Array(width * height);
  const lineOffsets = new Uint16Array(height);
  for (let i = 0; i < height; i++) lineOffsets[i] = buf.readUInt16LE(i * 2);

  const dataStart = height * 2;
  let x = 0;
  let y = 0;
  let ptr = dataStart + lineOffsets[0] * 2;

  while (y < height && ptr + 4 <= buf.length) {
    const xoffs = buf.readUInt16LE(ptr);
    const run = buf.readUInt16LE(ptr + 2);
    ptr += 4;
    if (xoffs + run >= 2048) break;
    if (xoffs + run !== 0) {
      if (ptr + run * 2 > buf.length) break;
      x += xoffs;
      let pos = y * width + x;
      if (pos + run > pixels.length) break;
      for (let j = 0; j < run; ++j, ++pos) {
        const val = buf.readUInt16LE(ptr);
        ptr += 2;
        if (val !== 0) pixels[pos] = (255 << 24) | color16To32(hues.getColor16(val, hue));
      }
      x += run;
    } else {
      x = 0;
      ++y;
      if (y >= height) break;
      const nextOffset = lineOffsets[y];
      ptr = dataStart + nextOffset * 2;
    }
  }
  return { width, height, pixels };
}
