import fs from 'node:fs';

/** Bounds-checked random-access reader over a Buffer or an open file. */
export class Reader {
  constructor(source) {
    if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
      this.buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
      this.fd = null;
      this.length = this.buffer.length;
    } else {
      this.fd = source.fd;
      this.length = source.size;
      this.buffer = null;
    }
    this.position = 0;
  }

  static open(path) {
    const fd = fs.openSync(path, 'r');
    const { size } = fs.fstatSync(fd);
    return new Reader({ fd, size });
  }

  seek(pos) {
    this.position = Math.max(0, Math.min(pos, this.length));
    return this;
  }

  skip(n) {
    this.position = Math.max(0, Math.min(this.position + n, this.length));
    return this;
  }

  remaining() {
    return this.length - this.position;
  }

  read(n) {
    if (n <= 0) return Buffer.alloc(0);
    const count = Math.min(n, this.remaining());
    let out;
    if (this.buffer) {
      out = this.buffer.subarray(this.position, this.position + count);
    } else {
      out = Buffer.allocUnsafe(count);
      fs.readSync(this.fd, out, 0, count, this.position);
    }
    this.position += count;
    return out;
  }

  readU8() {
    return this.remaining() >= 1 ? this.read(1)[0] : 0;
  }

  readI8() {
    const v = this.readU8();
    return v > 127 ? v - 256 : v;
  }

  readU16() {
    if (this.remaining() < 2) return 0;
    const b = this.read(2);
    return b[0] | (b[1] << 8);
  }

  readI16() {
    const v = this.readU16();
    return v > 32767 ? v - 65536 : v;
  }

  readU32() {
    if (this.remaining() < 4) return 0;
    return this.read(4).readUInt32LE(0);
  }

  readI32() {
    if (this.remaining() < 4) return 0;
    return this.read(4).readInt32LE(0);
  }

  readU64() {
    if (this.remaining() < 8) return 0n;
    return this.read(8).readBigUInt64LE(0);
  }

  readI64() {
    if (this.remaining() < 8) return 0n;
    return this.read(8).readBigInt64LE(0);
  }

  readAt(pos, n) {
    if (this.buffer) return this.buffer.subarray(pos, pos + n);
    const out = Buffer.allocUnsafe(n);
    fs.readSync(this.fd, out, 0, n, pos);
    return out;
  }

  close() {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        /* ignore */
      }
      this.fd = null;
    }
  }
}
