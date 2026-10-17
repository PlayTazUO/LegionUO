import { Reader } from '../lib/reader.js';
import { color16To32, color16ToRgb } from './colors.js';

const GROUP_SIZE = 4 + 8 * 88;
const BLOCK_SIZE = 88;

export class HueManager {
  constructor(files) {
    this.files = files;
    this.loaded = false;
    this.groups = 0;
    this.table = null;
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    const file = this.files.mul('hues.mul');
    if (!file) return;
    this.groups = Math.floor(file.reader.length / GROUP_SIZE);
    const colors = new Uint16Array(this.groups * 8 * 32);
    for (let g = 0; g < this.groups; g++) {
      const base = g * GROUP_SIZE + 4;
      for (let e = 0; e < 8; e++) {
        const offset = base + e * BLOCK_SIZE;
        for (let i = 0; i < 32; i++) {
          colors[(g * 8 + e) * 32 + i] = file.reader.readAt(offset + i * 2, 2).readUInt16LE(0);
        }
      }
    }
    this.table = colors;
  }

  get count() {
    this.load();
    return this.groups * 8;
  }

  /** Returns the 16-bit replacement colour for a grey 16-bit colour and hue. */
  getColor16(value, hue) {
    this.load();
    if (hue && hue < this.count && this.table) {
      const index = hue - 1;
      return this.table[index * 32 + ((value >> 10) & 0x1f)];
    }
    return value;
  }

  getRgb16(value, hue) {
    return color16ToRgb(this.getColor16(value, hue));
  }

  /** Resolve a UO hue to the representative text colour (color table index 8). */
  getTextColor(hue) {
    this.load();
    if (hue && hue < this.count && this.table) return this.table[(hue - 1) * 32 + 8];
    return hue;
  }

  /** Apply a hue to a Uint32Array of 0xAABBGGRR pixels in place. */
  applyHue(pixels, hue) {
    this.load();
    if (!hue || hue >= this.count || !this.table) return pixels;
    const base = (hue - 1) * 32;
    for (let i = 0; i < pixels.length; i++) {
      const v = pixels[i];
      if ((v >>> 24) === 0) continue;
      const r = v & 0xff;
      const index = (r * 31) / 255 | 0;
      const color = this.table[base + index];
      pixels[i] = color16To32(color);
    }
    return pixels;
  }

  toBuffer() {
    this.load();
    if (!this.table) return Buffer.alloc(0);
    const buf = Buffer.alloc(this.table.length * 2);
    for (let i = 0; i < this.table.length; i++) buf.writeUInt16LE(this.table[i], i * 2);
    return buf;
  }
}
