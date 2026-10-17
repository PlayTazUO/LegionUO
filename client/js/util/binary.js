export class Reader {
  constructor(data) {
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    this.position = 0;
    this.length = this.data.length;
  }

  remaining() {
    return this.length - this.position;
  }

  seek(pos) {
    this.position = Math.max(0, Math.min(pos, this.length));
    return this;
  }

  skip(n) {
    return this.seek(this.position + n);
  }

  readU8() {
    if (this.position >= this.length) return 0;
    return this.data[this.position++];
  }

  readI8() {
    const v = this.readU8();
    return v > 127 ? v - 256 : v;
  }

  readBool() {
    return this.readU8() !== 0;
  }

  readU16BE() {
    if (this.position + 2 > this.length) return 0;
    const v = this.view.getUint16(this.position, false);
    this.position += 2;
    return v;
  }

  readU16LE() {
    if (this.position + 2 > this.length) return 0;
    const v = this.view.getUint16(this.position, true);
    this.position += 2;
    return v;
  }

  readI16BE() {
    if (this.position + 2 > this.length) return 0;
    const v = this.view.getInt16(this.position, false);
    this.position += 2;
    return v;
  }

  readI16LE() {
    if (this.position + 2 > this.length) return 0;
    const v = this.view.getInt16(this.position, true);
    this.position += 2;
    return v;
  }

  readU32BE() {
    if (this.position + 4 > this.length) return 0;
    const v = this.view.getUint32(this.position, false);
    this.position += 4;
    return v;
  }

  readU32LE() {
    if (this.position + 4 > this.length) return 0;
    const v = this.view.getUint32(this.position, true);
    this.position += 4;
    return v;
  }

  readI32BE() {
    if (this.position + 4 > this.length) return 0;
    const v = this.view.getInt32(this.position, false);
    this.position += 4;
    return v;
  }

  readI32LE() {
    if (this.position + 4 > this.length) return 0;
    const v = this.view.getInt32(this.position, true);
    this.position += 4;
    return v;
  }

  readU64BE() {
    if (this.position + 8 > this.length) return 0n;
    const v = this.view.getBigUint64(this.position, false);
    this.position += 8;
    return v;
  }

  readU64LE() {
    if (this.position + 8 > this.length) return 0n;
    const v = this.view.getBigUint64(this.position, true);
    this.position += 8;
    return v;
  }

  readASCII(length) {
    if (length === undefined) {
      const start = this.position;
      while (this.position < this.length && this.data[this.position] !== 0) this.position++;
      return asciiDecode(this.data.subarray(start, this.position));
    }
    const end = Math.min(this.position + length, this.length);
    const bytes = this.data.subarray(this.position, end);
    this.position = end;
    let stop = bytes.indexOf(0);
    if (stop < 0) stop = bytes.length;
    return asciiDecode(bytes.subarray(0, stop));
  }

  readUTF8(length) {
    const end = Math.min(this.position + (length ?? this.remaining()), this.length);
    const bytes = this.data.subarray(this.position, end);
    this.position = end;
    let stop = bytes.indexOf(0);
    if (stop < 0) stop = bytes.length;
    return new TextDecoder('utf-8').decode(bytes.subarray(0, stop));
  }

  readUTF8Z() {
    const start = this.position;
    while (this.position < this.length && this.data[this.position] !== 0) this.position++;
    const bytes = this.data.subarray(start, this.position);
    if (this.position < this.length) this.position++;
    return new TextDecoder('utf-8').decode(bytes);
  }

  readUnicodeBE(byteLength) {
    if (byteLength === undefined) {
      const codes = [];
      while (this.position + 2 <= this.length) {
        const c = this.readU16BE();
        if (c === 0) break;
        codes.push(c);
      }
      return String.fromCharCode(...codes);
    }
    const count = Math.floor(byteLength / 2);
    const codes = [];
    for (let i = 0; i < count && this.position + 2 <= this.length; i++) {
      const c = this.readU16BE();
      if (c === 0) break;
      codes.push(c);
    }
    this.position = Math.min(this.position + Math.max(0, count - codes.length) * 2, this.length);
    return String.fromCharCode(...codes);
  }

  readUnicodeBEAt(byteLength) {
    return this.readUnicodeBE(byteLength);
  }

  readUnicodeLE(byteLength) {
    if (byteLength === undefined) {
      const codes = [];
      while (this.position + 2 <= this.length) {
        const c = this.readU16LE();
        if (c === 0) break;
        codes.push(c);
      }
      return String.fromCharCode(...codes);
    }
    const count = Math.floor(byteLength / 2);
    const codes = [];
    for (let i = 0; i < count && this.position + 2 <= this.length; i++) {
      const c = this.readU16LE();
      if (c === 0) break;
      codes.push(c);
    }
    return String.fromCharCode(...codes);
  }

  readBytes(length) {
    const end = Math.min(this.position + length, this.length);
    const out = this.data.subarray(this.position, end);
    this.position = end;
    return out;
  }

  at(offset) {
    return this.data[offset] ?? 0;
  }
}

function asciiDecode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export class Writer {
  constructor(size = 128) {
    this.data = new Uint8Array(size);
    this.view = new DataView(this.data.buffer);
    this.position = 0;
  }

  ensure(n) {
    if (this.position + n <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.position + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.data.subarray(0, this.position));
    this.data = next;
    this.view = new DataView(next.buffer);
  }

  writeU8(v) {
    this.ensure(1);
    this.data[this.position++] = v & 0xff;
    return this;
  }

  writeI8(v) {
    return this.writeU8(v);
  }

  writeU16BE(v) {
    this.ensure(2);
    this.view.setUint16(this.position, v & 0xffff, false);
    this.position += 2;
    return this;
  }

  writeU16LE(v) {
    this.ensure(2);
    this.view.setUint16(this.position, v & 0xffff, true);
    this.position += 2;
    return this;
  }

  writeI16BE(v) {
    this.ensure(2);
    this.view.setInt16(this.position, v, false);
    this.position += 2;
    return this;
  }

  writeU32BE(v) {
    this.ensure(4);
    this.view.setUint32(this.position, v >>> 0, false);
    this.position += 4;
    return this;
  }

  writeU32LE(v) {
    this.ensure(4);
    this.view.setUint32(this.position, v >>> 0, true);
    this.position += 4;
    return this;
  }

  writeU64BE(v) {
    this.ensure(8);
    this.view.setBigUint64(this.position, BigInt(v), false);
    this.position += 8;
    return this;
  }

  writeBytes(bytes) {
    this.ensure(bytes.length);
    this.data.set(bytes, this.position);
    this.position += bytes.length;
    return this;
  }

  writeZero(n) {
    this.ensure(n);
    this.data.fill(0, this.position, this.position + n);
    this.position += n;
    return this;
  }

  writeASCII(str, fixedLength) {
    const bytes = asciiEncode(str);
    if (fixedLength === undefined) {
      this.ensure(bytes.length + 1);
      this.data.set(bytes, this.position);
      this.position += bytes.length;
      this.data[this.position++] = 0;
      return this;
    }
    this.ensure(fixedLength);
    this.data.fill(0, this.position, this.position + fixedLength);
    this.data.set(bytes.subarray(0, fixedLength), this.position);
    this.position += fixedLength;
    return this;
  }

  writeUTF8(str) {
    const bytes = new TextEncoder().encode(str);
    this.writeBytes(bytes);
    return this;
  }

  writeUnicodeBE(str) {
    this.ensure(str.length * 2 + 2);
    for (let i = 0; i < str.length; i++) this.writeU16BE(str.charCodeAt(i));
    return this;
  }

  writeUnicodeBENull(str) {
    this.writeUnicodeBE(str);
    this.writeU16BE(0);
    return this;
  }

  patchU16BE(offset, v) {
    this.view.setUint16(offset, v & 0xffff, false);
    return this;
  }

  get buffer() {
    return this.data.subarray(0, this.position);
  }

  get length() {
    return this.position;
  }
}

function asciiEncode(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}
