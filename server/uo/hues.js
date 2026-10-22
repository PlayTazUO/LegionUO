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

  /**
   * Returns the 16-bit replacement colour for a grey 16-bit colour and hue.
   * With `partial`, coloured texels are left alone and only true greys take
   * the hue, exactly like TazUO's partial-hue shader.
   */
  getColor16(value, hue, partial = false) {
    this.load();
    // 0x8000 is the wire flag for an explicit partial hue, not part of the
    // hue number; TazUO strips it before looking the ramp up.
    if (hue & 0x8000) {
      hue &= 0x7fff;
      partial = true;
    }
    if (hue && hue < this.count && this.table) {
      if (partial && !isGray16(value)) return value;
      const index = hue - 1;
      return this.table[index * 32 + ((value >> 10) & 0x1f)];
    }
    return value;
  }

  getRgb16(value, hue, partial = false) {
    return color16ToRgb(this.getColor16(value, hue, partial));
  }

  /** Resolve a UO hue to the representative text colour (color table index 8). */
  getTextColor(hue) {
    this.load();
    if (hue && hue < this.count && this.table) return this.table[(hue - 1) * 32 + 8];
    return hue;
  }

  /** Apply a hue to a Uint32Array of 0xAABBGGRR pixels in place. */
  applyHue(pixels, hue, partial = false) {
    this.load();
    if (hue & 0x8000) {
      hue &= 0x7fff;
      partial = true;
    }
    if (!hue || hue >= this.count || !this.table) return pixels;
    const base = (hue - 1) * 32;
    for (let i = 0; i < pixels.length; i++) {
      const v = pixels[i];
      if ((v >>> 24) === 0) continue;
      const r = v & 0xff;
      const g = (v >> 8) & 0xff;
      const b = (v >> 16) & 0xff;
      if (partial && (r !== g || r !== b)) continue;
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

/** True when a 16-bit 555 colour has equal red, green and blue channels. */
export function isGray16(value) {
  const r = (value >> 10) & 0x1f;
  return r === ((value >> 5) & 0x1f) && r === (value & 0x1f);
}
