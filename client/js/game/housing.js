// 0xD8 design data is split into "planes" that each hold one storey worth of
// tiles. Plane 0 is the foundation level (z 0), planes 1-4 are floors at
// z 7/27/47/67 and planes 5-8 are the matching walls. Anything that does not
// fit a plane (stairs, odd z values) is sent in 5-byte stair records.
const PLANE_HEADER = 4;

/**
 * Parse the fixed header and the compressed plane records from a 0xD8 packet.
 * The returned blocks own copies of their compressed bytes, so the caller can
 * decompress them asynchronously after the socket buffer has moved on.
 */
export function parseCustomHousePacket(reader) {
  const compression = reader.readU8();
  const responds = reader.readBool();
  const serial = reader.readU32BE() >>> 0;
  const revision = reader.readU32BE() >>> 0;
  const tileCount = reader.readU16BE();
  const bufferLength = reader.readU16BE();
  const planeCount = reader.readU8();

  const blocks = [];
  for (let i = 0; i < planeCount; i++) {
    if (reader.remaining() < PLANE_HEADER) break;
    const header = reader.readU32BE();
    const plane = (header >>> 24) & 0x0f;
    const mode = (header >>> 28) & 0x0f;
    const size = ((header >>> 16) & 0xff) | ((header & 0xf0) << 4);
    const compressedLength = ((header >>> 8) & 0xff) | ((header & 0x0f) << 8);

    if (compressedLength <= 0) continue;
    if (reader.remaining() < compressedLength) break;
    const payload = reader.readBytes(compressedLength).slice();
    blocks.push({ plane, mode, size, payload });
  }

  return {
    compression,
    responds,
    serial,
    revision,
    tileCount,
    bufferLength,
    planeCount,
    blocks,
  };
}

/**
 * The design packet stores positions relative to the house multi's bounding
 * box, so the base multi tells us the origin and row length to rebuild tile
 * coordinates. Hidden components are ignored except for the first record,
 * matching the server's MultiComponentList bounds calculation.
 */
export function multiBounds(parts) {
  if (!parts?.length) return null;
  // The server (and ClassicUO) start the bounds at the origin, so an all
  // positive multi still has its minimum at 0,0 rather than its first part.
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i !== 0 && !part.visible) continue;
    if (part.x < minX) minX = part.x;
    if (part.y < minY) minY = part.y;
    if (part.x > maxX) maxX = part.x;
    if (part.y > maxY) maxY = part.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function inflateWith(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateBytes(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is unavailable');
  }
  try {
    return await inflateWith(bytes, 'deflate');
  } catch {
    // A few third-party shards use raw DEFLATE instead of a zlib wrapper.
    return inflateWith(bytes, 'deflate-raw');
  }
}

function decodePlanarPlane(view, plane, bounds, parts) {
  // The server sends the empty foundation + one extra row for the steps, so a
  // design is one row taller than the base multi in multi.mul.
  const designHeight = bounds.maxY - bounds.minY + 2;

  if (plane === 0) {
    // Foundation level: floors, stairs and foundation walls all live at z 0.
    decodePlaneGrid(view, designHeight, bounds.minX, bounds.minY, 0, parts);
    return;
  }

  if (plane <= 4) {
    // Interior floor for levels 1-4. The server trims the outer row/column.
    const z = ((plane - 1) % 4) * 20 + 7;
    decodePlaneGrid(view, designHeight - 2, bounds.minX + 1, bounds.minY + 1, z, parts);
    return;
  }

  // Wall plane for levels 1-4. Only the last row is omitted.
  const z = ((plane - 5) % 4) * 20 + 7;
  decodePlaneGrid(view, designHeight - 1, bounds.minX, bounds.minY, z, parts);
}

function decodePlaneGrid(view, stride, offX, offY, z, parts) {
  if (stride <= 0) return;
  const cells = Math.floor(view.byteLength / 2);
  for (let i = 0; i < cells; i++) {
    const graphic = view.getUint16(i * 2, false);
    if (!graphic) continue;
    const x = offX + Math.floor(i / stride);
    const y = offY + (i % stride);
    parts.push({ graphic, x, y, z, visible: true });
  }
}

function decodeStairPlane(view, parts) {
  // 5-byte records: graphic, x, y, z. Coordinates are already absolute
  // house offsets and the z value is the real (not plane) height.
  const count = Math.floor(view.byteLength / 5);
  for (let i = 0; i < count; i++) {
    const offset = i * 5;
    const graphic = view.getUint16(offset, false);
    if (!graphic) continue;
    const x = view.getInt8(offset + 2);
    const y = view.getInt8(offset + 3);
    const z = view.getInt8(offset + 4);
    parts.push({ graphic, x, y, z, visible: true });
  }
}

function decodeLegacyPlane(view, plane, parts) {
  // Older servers used 4-byte records (graphic, x, y) and derived z from the
  // plane number. Kept for compatibility with pre-ServUO shards.
  const count = Math.floor(view.byteLength / 4);
  const z = plane > 0 ? ((plane - 1) % 4) * 20 + 7 : 0;
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    const graphic = view.getUint16(offset, false);
    if (!graphic) continue;
    const x = view.getInt8(offset + 2);
    const y = view.getInt8(offset + 3);
    parts.push({ graphic, x, y, z, visible: true });
  }
}

/**
 * Decompress and decode every plane of a custom house design.
 * Returns null when the packet does not contain usable plane data.
 */
export async function decodeCustomHouseDesign(blocks, bounds) {
  if (!bounds || !blocks?.length) return null;

  const decoded = await Promise.all(
    blocks.map(async (block) => {
      let data;
      try {
        data = await inflateBytes(block.payload);
      } catch {
        return null;
      }
      const recordSize = block.mode === 0 ? 5 : block.mode === 1 ? 4 : 2;
      if (data.length % recordSize !== 0) return null;
      return { block, data };
    })
  );

  const parts = [];
  let decodedBlocks = 0;
  for (const entry of decoded) {
    if (!entry) continue;
    const { block, data } = entry;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (block.mode === 0) decodeStairPlane(view, parts);
    else if (block.mode === 1) decodeLegacyPlane(view, block.plane, parts);
    else if (block.mode === 2) decodePlanarPlane(view, block.plane, bounds, parts);
    else continue;
    decodedBlocks++;
  }
  // Never replace a visible foundation with an empty design when every plane
  // failed to decompress; the caller will fall back to the base multi.
  return decodedBlocks ? parts : null;
}
