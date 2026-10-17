import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Encode an RGBA pixel array to PNG. Pixels may be a Uint8Array (already RGBA)
 * or a Uint32Array in 0xAABBGGRR little-endian layout (the layout used by UO art).
 */
export function encodePNG(width, height, pixels, options = {}) {
  if (width <= 0 || height <= 0) {
    width = 1;
    height = 1;
    pixels = new Uint8Array(4);
  }
  const rgba = new Uint8Array(width * height * 4);
  if (pixels instanceof Uint32Array) {
    const src = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    for (let i = 0, p = 0; i < width * height; i++, p += 4) {
      const v = src.readUInt32LE(p);
      rgba[p] = v & 0xff;
      rgba[p + 1] = (v >>> 8) & 0xff;
      rgba[p + 2] = (v >>> 16) & 0xff;
      rgba[p + 3] = (v >>> 24) & 0xff;
    }
  } else if (pixels.length === width * height * 4) {
    rgba.set(pixels);
  } else if (pixels.length === width * height * 3) {
    for (let i = 0, p = 0, q = 0; i < width * height; i++, p += 4, q += 3) {
      rgba[p] = pixels[q];
      rgba[p + 1] = pixels[q + 1];
      rgba[p + 2] = pixels[q + 2];
      rgba[p + 3] = 255;
    }
  }

  // Explicit alpha isn't needed for fully opaque images and helps PNG size.
  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      hasAlpha = true;
      break;
    }
  }
  const colorType = hasAlpha ? 6 : 2;
  const bpp = hasAlpha ? 4 : 3;
  const raw = Buffer.allocUnsafe((width * bpp + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const p = row + x * 4;
      raw[o++] = rgba[p];
      raw[o++] = rgba[p + 1];
      raw[o++] = rgba[p + 2];
      if (hasAlpha) raw[o++] = rgba[p + 3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const level = options.level ?? 6;
  const idat = zlib.deflateSync(raw, { level });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
