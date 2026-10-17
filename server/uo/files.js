import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Reader } from '../lib/reader.js';
import { bwtDecompress } from './bwt.js';

const UOP_MAGIC = 0x50594d;

function createHash(s) {
  let eax = 0;
  let ecx = 0;
  let edx = 0;
  let ebx = 0;
  let esi = 0;
  let edi = 0;
  ebx = edi = esi = (s.length + 0xdeadbeef) >>> 0;

  let i = 0;
  for (; i + 12 < s.length; i += 12) {
    edi = (((s.charCodeAt(i + 7) << 24) | (s.charCodeAt(i + 6) << 16) | (s.charCodeAt(i + 5) << 8) | s.charCodeAt(i + 4)) + edi) >>> 0;
    esi = (((s.charCodeAt(i + 11) << 24) | (s.charCodeAt(i + 10) << 16) | (s.charCodeAt(i + 9) << 8) | s.charCodeAt(i + 8)) + esi) >>> 0;
    edx = ((((s.charCodeAt(i + 3) << 24) | (s.charCodeAt(i + 2) << 16) | (s.charCodeAt(i + 1) << 8) | s.charCodeAt(i)) - esi) >>> 0);
    edx = ((edx + ebx) ^ (esi >>> 28) ^ (esi << 4)) >>> 0;
    esi = (esi + edi) >>> 0;
    edi = ((edi - edx) ^ (edx >>> 26) ^ (edx << 6)) >>> 0;
    edx = (edx + esi) >>> 0;
    esi = ((esi - edi) ^ (edi >>> 24) ^ (edi << 8)) >>> 0;
    edi = (edi + edx) >>> 0;
    ebx = ((edx - esi) ^ (esi >>> 16) ^ (esi << 16)) >>> 0;
    esi = (esi + edi) >>> 0;
    edi = ((edi - ebx) ^ (ebx >>> 13) ^ (ebx << 19)) >>> 0;
    ebx = (ebx + esi) >>> 0;
    esi = ((esi - edi) ^ (edi >>> 28) ^ (edi << 4)) >>> 0;
    edi = (edi + ebx) >>> 0;
  }

  if (s.length - i > 0) {
    const rem = s.length - i;
    if (rem >= 12) esi = (esi + (s.charCodeAt(i + 11) << 24)) >>> 0;
    if (rem >= 11) esi = (esi + (s.charCodeAt(i + 10) << 16)) >>> 0;
    if (rem >= 10) esi = (esi + (s.charCodeAt(i + 9) << 8)) >>> 0;
    if (rem >= 9) esi = (esi + s.charCodeAt(i + 8)) >>> 0;
    if (rem >= 8) edi = (edi + (s.charCodeAt(i + 7) << 24)) >>> 0;
    if (rem >= 7) edi = (edi + (s.charCodeAt(i + 6) << 16)) >>> 0;
    if (rem >= 6) edi = (edi + (s.charCodeAt(i + 5) << 8)) >>> 0;
    if (rem >= 5) edi = (edi + s.charCodeAt(i + 4)) >>> 0;
    if (rem >= 4) ebx = (ebx + (s.charCodeAt(i + 3) << 24)) >>> 0;
    if (rem >= 3) ebx = (ebx + (s.charCodeAt(i + 2) << 16)) >>> 0;
    if (rem >= 2) ebx = (ebx + (s.charCodeAt(i + 1) << 8)) >>> 0;
    if (rem >= 1) ebx = (ebx + s.charCodeAt(i)) >>> 0;

    esi = ((esi ^ edi) - ((edi >>> 18) ^ (edi << 14))) >>> 0;
    ecx = ((esi ^ ebx) - ((esi >>> 21) ^ (esi << 11))) >>> 0;
    edi = ((edi ^ ecx) - ((ecx >>> 7) ^ (ecx << 25))) >>> 0;
    esi = ((esi ^ edi) - ((edi >>> 16) ^ (edi << 16))) >>> 0;
    edx = ((esi ^ ecx) - ((esi >>> 28) ^ (esi << 4))) >>> 0;
    edi = ((edi ^ edx) - ((edx >>> 18) ^ (edx << 14))) >>> 0;
    eax = ((esi ^ edi) - ((edi >>> 8) ^ (edi << 24))) >>> 0;

    return (BigInt(edi) << 32n) | BigInt(eax >>> 0);
  }

  return (BigInt(esi >>> 0) << 32n) | BigInt(eax >>> 0);
}

export class UOFileManager {
  constructor(uoDir, options = {}) {
    this.dir = uoDir || '';
    this.options = options;
    this.pathCache = new Map();
    this.mulCache = new Map();
    this.uopCache = new Map();
    this.uopEntryCache = new Map();
    this.index = null;
  }

  setDir(dir) {
    this.dir = dir || '';
    this.pathCache.clear();
    this.index = null;
    this.closeAll();
  }

  buildIndex() {
    if (this.index) return this.index;
    const index = new Map();
    const skip = new Set(['node_modules', '.git', 'System Volume Information', '$RECYCLE.BIN']);
    const walk = (dir, depth) => {
      if (depth > 4) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile()) {
          const key = entry.name.toLowerCase();
          if (!index.has(key)) index.set(key, full);
        } else if (entry.isDirectory() && !skip.has(entry.name)) {
          walk(full, depth + 1);
        }
      }
    };
    walk(this.dir, 0);
    this.index = index;
    return index;
  }

  closeAll() {
    for (const file of this.mulCache.values()) file.reader.close();
    for (const file of this.uopCache.values()) file.reader.close();
    this.mulCache.clear();
    this.uopCache.clear();
    this.uopEntryCache.clear();
  }

  find(fileName) {
    const key = fileName.toLowerCase();
    if (this.pathCache.has(key)) return this.pathCache.get(key);

    let result = null;
    try {
      const direct = path.join(this.dir, fileName);
      if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
        result = direct;
      } else {
        const entries = fs.readdirSync(this.dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.toLowerCase() === key) {
            result = path.join(this.dir, entry.name);
            break;
          }
        }
      }
    } catch {
      result = null;
    }
    if (!result) {
      result = this.buildIndex().get(key) || null;
    }
    this.pathCache.set(key, result);
    return result;
  }

  has(fileName) {
    return this.find(fileName) !== null;
  }

  /* MUL/IDX ------------------------------------------------------------ */

  mul(fileName, idxName = null) {
    const filePath = this.find(fileName);
    if (!filePath) return null;
    const idxPath = idxName ? this.find(idxName) : null;
    const key = `${filePath}|${idxPath || ''}`;
    if (this.mulCache.has(key)) return this.mulCache.get(key);

    const data = Reader.open(filePath);
    const idx = idxPath ? Reader.open(idxPath) : data;
    const entries = new Array(Math.floor(idx.length / 12));
    for (let i = 0; i < entries.length; i++) {
      idx.seek(i * 12);
      const offset = idx.readU32();
      const length = idx.readI32();
      const extra = idx.readI32();
      entries[i] = {
        offset,
        length,
        decompressedLength: 0,
        compression: 0,
        width: extra > 0 ? (extra >> 16) : 0,
        height: extra > 0 ? (extra & 0xffff) : 0,
        hue: 0,
      };
    }
    const spec = { type: 'mul', reader: data, idx, entries };
    this.mulCache.set(key, spec);
    return spec;
  }

  /* UOP ---------------------------------------------------------------- */

  getUopRaw(fileName) {
    const filePath = this.find(fileName);
    if (!filePath) return null;
    const key = filePath;
    let spec = this.uopCache.get(key);
    if (!spec) {
      spec = this.parseUop(filePath, '', false);
      if (!spec) return null;
      this.uopCache.set(key, spec);
    }
    return spec;
  }

  uop(fileName, pattern, hasExtra = false) {
    const filePath = this.find(fileName);
    if (!filePath) return null;
    const key = filePath;
    let spec = this.uopCache.get(key);
    if (!spec) {
      spec = this.parseUop(filePath, pattern, hasExtra);
      if (!spec) return null;
      this.uopCache.set(key, spec);
    }
    if (!this.uopEntryCache.has(`${key}|${pattern}`)) {
      const entries = new Array(Math.max(spec.total, 0xffff) + 0x4000);
      for (let i = 0; i < entries.length; i++) {
        const hash = createHash(pattern.replace('{0:D8}', String(i).padStart(8, '0')).replace('{0:D6}', String(i).padStart(6, '0')).replace('{0:D2}', String(i).padStart(2, '0')));
        entries[i] = spec.hashes.get(hash) || null;
      }
      this.uopEntryCache.set(`${key}|${pattern}`, entries);
    }
    spec.entries = this.uopEntryCache.get(`${key}|${pattern}`);
    spec.pattern = pattern;
    return spec;
  }

  parseUop(filePath, pattern, hasExtra) {
    try {
      const reader = Reader.open(filePath);
      reader.seek(0);
      if (reader.readU32() !== UOP_MAGIC) {
        reader.close();
        return null;
      }
      reader.readU32();
      reader.readU32();
      let nextBlock = Number(reader.readI64());
      reader.readU32();
      reader.readI32();

      const hashes = new Map();
      let total = 0;
      let guard = 0;
      while (nextBlock !== 0 && guard++ < 100000) {
        reader.seek(nextBlock);
        const filesCount = reader.readI32();
        nextBlock = Number(reader.readI64());
        total += filesCount;
        for (let i = 0; i < filesCount; i++) {
          const rawOffset = reader.readI64();
          const headerLength = reader.readI32();
          const compressedLength = reader.readI32();
          const decompressedLength = reader.readI32();
          const hash = reader.readU64();
          reader.readU32();
          const flag = reader.readI16();
          if (rawOffset === 0n) continue;
          let offset = Number(rawOffset) + headerLength;
          const length = flag === 1 ? compressedLength : decompressedLength;
          if (hasExtra && flag !== 3) {
            const pos = reader.position;
            reader.seek(offset);
            const width = reader.readI32();
            const height = reader.readI32();
            reader.seek(pos);
            hashes.set(hash, {
              offset: offset + 8,
              length: compressedLength - 8,
              decompressedLength,
              compression: flag,
              width,
              height,
              hue: 0,
            });
          } else {
            hashes.set(hash, {
              offset,
              length,
              decompressedLength,
              compression: flag,
              width: 0,
              height: 0,
              hue: 0,
            });
          }
        }
      }
      return { type: 'uop', reader, hashes, total, entries: [] };
    } catch {
      return null;
    }
  }

  /* entry access ------------------------------------------------------- */

  getEntry(spec, index) {
    if (!spec || index < 0 || index >= spec.entries.length) return null;
    const entry = spec.entries[index];
    if (!entry || entry.length <= 0) return null;
    return entry;
  }

  readEntry(spec, entry) {
    if (!entry) return null;
    const reader = spec.reader;
    let data = Buffer.from(reader.readAt(entry.offset, entry.length));
    if (entry.compression === 1) {
      data = zlib.inflateSync(data);
    } else if (entry.compression === 3) {
      data = bwtDecompress(zlib.inflateSync(data));
    }
    return data;
  }
}

export { createHash };
