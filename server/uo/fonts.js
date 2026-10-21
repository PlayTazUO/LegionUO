import fs from 'node:fs';
import { encodePNG } from '../lib/png.js';
import { color16To32 } from './colors.js';

const GLYPHS = 224;

export class FontManager {
  constructor(files, hues) {
    this.files = files;
    this.hues = hues;
    this.loaded = false;
    this.fonts = [];
    this.cache = new Map();
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    const path = this.files.find('fonts.mul');
    if (!path) return;
    let data;
    try {
      data = fs.readFileSync(path);
    } catch {
      return;
    }
    let pos = 0;
    while (pos < data.length) {
      pos++;
      const glyphs = new Array(GLYPHS).fill(null);
      let ok = true;
      for (let i = 0; i < GLYPHS; i++) {
        if (pos + 3 > data.length) {
          ok = false;
          break;
        }
        const width = data[pos++];
        const height = data[pos++];
        pos++;
        const size = width * height * 2;
        if (pos + size > data.length) {
          ok = false;
          break;
        }
        const pixels = new Uint16Array(width * height);
        for (let p = 0; p < pixels.length; p++) {
          pixels[p] = data.readUInt16LE(pos + p * 2);
        }
        pos += size;
        glyphs[i] = { width, height, pixels };
      }
      if (!ok) break;
      this.fonts.push(glyphs);
    }
  }

  get count() {
    this.load();
    return this.fonts.length;
  }

  atlas(font, hue = 0) {
    this.load();
    const index = Number(font) || 0;
    if (index < 0 || index >= this.fonts.length) return null;
    const key = `${index}|${hue >>> 0}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const glyphs = this.fonts[index];
    let width = 0;
    let height = 0;
    for (const glyph of glyphs) {
      if (!glyph) continue;
      width += glyph.width;
      height = Math.max(height, glyph.height);
    }
    if (!width || !height) return null;
    const pixels = new Uint32Array(width * height);
    const meta = [];
    let offsetX = 0;
    for (const glyph of glyphs) {
      if (!glyph) {
        meta.push({ x: offsetX, y: 0, w: 0, h: 0, advance: 0 });
        continue;
      }
      for (let y = 0; y < glyph.height; y++) {
        for (let x = 0; x < glyph.width; x++) {
          const value = glyph.pixels[y * glyph.width + x];
          if (!value) continue;
          const color = this.hues.getColor16(value, hue);
          pixels[y * width + offsetX + x] = color16To32(color);
        }
      }
      meta.push({ x: offsetX, y: 0, w: glyph.width, h: glyph.height, advance: glyph.width });
      offsetX += glyph.width;
    }
    const result = {
      meta: { width, height, glyphs: meta },
      png: encodePNG(width, height, pixels),
    };
    this.cache.set(key, result);
    return result;
  }
}
