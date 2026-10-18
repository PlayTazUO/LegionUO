import { Reader } from '../lib/reader.js';
import { encodePNG } from '../lib/png.js';
import { color16To32 } from './colors.js';

const MAX_OUTPUT = 1024;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Crop a facet map (facetXX.mul) and encode it as PNG.
 *
 * Format: u16 width, u16 height, then for every row a u32 byte length followed
 * by runs of u8 count + u16 colour. The source image is one pixel per world
 * tile, so the requested bounds are directly tile coordinates.
 */
export function renderFacetCrop(files, facet, x0, y0, x1, y1, outWidth, outHeight) {
  const path =
    files.find(`facet${String(facet).padStart(2, '0')}.mul`) ||
    files.find(`facet${facet}.mul`);
  if (!path) return null;

  let reader = null;
  try {
    reader = Reader.open(path);
    const facetWidth = reader.readU16();
    const facetHeight = reader.readU16();
    if (!facetWidth || !facetHeight) return null;

    const left = clamp(Math.floor(x0), 0, facetWidth - 1);
    const top = clamp(Math.floor(y0), 0, facetHeight - 1);
    const right = clamp(Math.ceil(x1), left + 1, facetWidth);
    const bottom = clamp(Math.ceil(y1), top + 1, facetHeight);

    const sourceWidth = right - left;
    const sourceHeight = bottom - top;
    const width = clamp(Math.round(outWidth) || sourceWidth, 1, MAX_OUTPUT);
    const height = clamp(Math.round(outHeight) || sourceHeight, 1, MAX_OUTPUT);
    const pixels = new Uint32Array(width * height);

    for (let y = 0; y < facetHeight; y++) {
      const rowLength = reader.readI32();
      if (rowLength <= 0) {
        if (rowLength < 0) break;
        continue;
      }
      if (y < top || y >= bottom) {
        reader.skip(rowLength);
        continue;
      }

      const outYStart = clamp(Math.floor(((y - top) * height) / sourceHeight), 0, height - 1);
      const outYEnd = clamp(Math.ceil(((y + 1 - top) * height) / sourceHeight), outYStart + 1, height);
      const runCount = Math.floor(rowLength / 3);
      let x = 0;

      for (let i = 0; i < runCount; i++) {
        const size = reader.readU8();
        const color = reader.readU16();
        if (!size) continue;
        const runStart = x;
        const runEnd = x + size;
        x = runEnd;

        if (runEnd <= left || runStart >= right) continue;

        const start = Math.max(runStart, left);
        const end = Math.min(runEnd, right);
        const outStart = clamp(Math.floor(((start - left) * width) / sourceWidth), 0, width);
        const outEnd = clamp(Math.ceil(((end - left) * width) / sourceWidth), outStart, width);
        if (outEnd <= outStart) continue;

        const packed = color16To32(color);
        for (let oy = outYStart; oy < outYEnd; oy++) {
          const rowBase = oy * width;
          for (let px = outStart; px < outEnd; px++) pixels[rowBase + px] = packed;
        }
      }

      const remaining = rowLength - runCount * 3;
      if (remaining > 0) reader.skip(remaining);
    }

    return encodePNG(width, height, pixels);
  } catch {
    return null;
  } finally {
    reader?.close();
  }
}
