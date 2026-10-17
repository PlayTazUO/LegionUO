import { DEC_TREE } from './huffman-table.js';

/** Stateful Huffman decompressor. State intentionally survives across chunks. */
export class Huffman {
  constructor() {
    this.reset();
  }

  reset() {
    this.bitNum = 8;
    this.value = 0;
    this.mask = 0;
    this.treePos = 0;
  }

  decompress(src, maxSize = 65536) {
    const dest = new Uint8Array(maxSize);
    let destIndex = 0;
    let pos = 0;

    while (true) {
      if (this.bitNum >= 8) {
        if (pos >= src.length) return dest.subarray(0, destIndex);
        this.value = src[pos++];
        this.bitNum = 0;
        this.mask = 0x80;
      }

      this.treePos = this.value & this.mask ? DEC_TREE[this.treePos * 2] : DEC_TREE[this.treePos * 2 + 1];
      this.mask >>= 1;
      this.bitNum++;

      if (this.treePos <= 0) {
        if (this.treePos === -256) {
          this.bitNum = 8;
          this.treePos = 0;
          continue;
        }
        if (destIndex >= dest.length) return dest.subarray(0, destIndex);
        dest[destIndex++] = -this.treePos & 0xff;
        this.treePos = 0;
      }
    }
  }
}
