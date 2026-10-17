import { P0, P1 } from './twofish-tables.js';
import { md5 } from './md5.js';

const INPUT_WHITEN = 0;
const OUTPUT_WHITEN = 4;
const ROUND_SUBKEYS = 8;
const TOTAL_SUBKEYS = 40;
const ROUNDS = 16;
const SK_STEP = 0x02020202;
const SK_BUMP = 0x01010101;
const SK_ROTL = 9;
const RS_GF_FDBK = 0x14d;
const MDS_GF_FDBK = 0x169;

const MASK32 = 0xffffffff;

function rol(x, n) {
  n &= 31;
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function ror(x, n) {
  n &= 31;
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function lfsr1(x) {
  return (x >>> 1) ^ (x & 1 ? MDS_GF_FDBK >>> 1 : 0);
}

function lfsr2(x) {
  return (x >>> 2) ^ (x & 2 ? MDS_GF_FDBK >>> 1 : 0) ^ (x & 1 ? MDS_GF_FDBK >>> 2 : 0);
}

const mx1 = (x) => x;
const mxX = (x) => (x ^ lfsr2(x)) & 0xff;
const mxY = (x) => (x ^ lfsr1(x) ^ lfsr2(x)) & 0xff;

const M00 = (x) => mx1(x);
const M01 = (x) => mxY(x);
const M02 = (x) => mxX(x);
const M03 = (x) => mxX(x);
const M10 = (x) => mxX(x);
const M11 = (x) => mxY(x);
const M12 = (x) => mxY(x);
const M13 = (x) => mx1(x);
const M20 = (x) => mxY(x);
const M21 = (x) => mxX(x);
const M22 = (x) => mx1(x);
const M23 = (x) => mxY(x);
const M30 = (x) => mxY(x);
const M31 = (x) => mx1(x);
const M32 = (x) => mxY(x);
const M33 = (x) => mxX(x);

function rsRem(x) {
  const b = (x >>> 24) & 0xff;
  const g2 = (((b << 1) ^ (b & 0x80 ? RS_GF_FDBK : 0)) & 0xff) >>> 0;
  const g3 = (((b >>> 1) & 0x7f) ^ (b & 1 ? RS_GF_FDBK >>> 1 : 0) ^ g2) >>> 0;
  return ((x << 8) ^ (g3 << 24) ^ (g2 << 16) ^ (g3 << 8) ^ b) >>> 0;
}

function rsMdsEncode(k0, k1) {
  let r = 0;
  for (let i = 0; i < 2; i++) {
    r = (r ^ (i > 0 ? k0 : k1)) >>> 0;
    for (let j = 0; j < 4; j++) r = rsRem(r);
  }
  return r >>> 0;
}

export function f32(x, k32) {
  const k0 = k32[0] >>> 0;
  const k1 = k32[1] >>> 0;
  let b0 = x & 0xff;
  let b1 = (x >>> 8) & 0xff;
  let b2 = (x >>> 16) & 0xff;
  let b3 = (x >>> 24) & 0xff;

  b0 = P1[P0[P0[b0] ^ (k1 & 0xff)] ^ (k0 & 0xff)];
  b1 = P0[P0[P1[b1] ^ ((k1 >>> 8) & 0xff)] ^ ((k0 >>> 8) & 0xff)];
  b2 = P1[P1[P0[b2] ^ ((k1 >>> 16) & 0xff)] ^ ((k0 >>> 16) & 0xff)];
  b3 = P0[P1[P1[b3] ^ ((k1 >>> 24) & 0xff)] ^ ((k0 >>> 24) & 0xff)];

  return (
    ((M00(b0) ^ M01(b1) ^ M02(b2) ^ M03(b3)) |
      ((M10(b0) ^ M11(b1) ^ M12(b2) ^ M13(b3)) << 8) |
      ((M20(b0) ^ M21(b1) ^ M22(b2) ^ M23(b3)) << 16) |
      ((M30(b0) ^ M31(b1) ^ M32(b2) ^ M33(b3)) << 24)) >>>
    0
  );
}

export class Twofish {
  constructor() {
    this.key = new Uint32Array([0, 0, 0, 0]);
    this.sboxKeys = new Uint32Array(4);
    this.subKeys = new Uint32Array(TOTAL_SUBKEYS);
    this.cipherTable = new Uint8Array(256);
    this.xorData = new Uint8Array(16);
    this.rectPos = 0;
    this.sendPos = 0;
  }

  reKey(key32) {
    const k32e = [key32[0] >>> 0, key32[2] >>> 0];
    const k32o = [key32[1] >>> 0, key32[3] >>> 0];
    this.sboxKeys[1] = rsMdsEncode(k32e[0], k32o[0]);
    this.sboxKeys[0] = rsMdsEncode(k32e[1], k32o[1]);

    for (let i = 0; i < 20; i++) {
      let A = f32((i * SK_STEP) >>> 0, k32e);
      let B = f32((i * SK_STEP + SK_BUMP) >>> 0, k32o);
      B = rol(B, 8);
      this.subKeys[2 * i] = (A + B) >>> 0;
      this.subKeys[2 * i + 1] = rol((A + 2 * B) >>> 0, SK_ROTL);
    }
  }

  blockEncrypt(x) {
    x[0] ^= this.subKeys[INPUT_WHITEN];
    x[1] ^= this.subKeys[INPUT_WHITEN + 1];
    x[2] ^= this.subKeys[INPUT_WHITEN + 2];
    x[3] ^= this.subKeys[INPUT_WHITEN + 3];

    for (let r = 0; r < ROUNDS; r++) {
      const t0 = f32(x[0], this.sboxKeys);
      const t1 = f32(rol(x[1], 8), this.sboxKeys);
      x[3] = rol(x[3], 1);
      x[2] = (x[2] ^ ((t0 + t1 + this.subKeys[ROUND_SUBKEYS + 2 * r]) >>> 0)) >>> 0;
      x[3] = (x[3] ^ ((t0 + 2 * t1 + this.subKeys[ROUND_SUBKEYS + 2 * r + 1]) >>> 0)) >>> 0;
      x[2] = ror(x[2], 1);
      if (r < ROUNDS - 1) {
        let tmp = x[0];
        x[0] = x[2];
        x[2] = tmp;
        tmp = x[1];
        x[1] = x[3];
        x[3] = tmp;
      }
    }

    x[0] = (x[0] ^ this.subKeys[OUTPUT_WHITEN]) >>> 0;
    x[1] = (x[1] ^ this.subKeys[OUTPUT_WHITEN + 1]) >>> 0;
    x[2] = (x[2] ^ this.subKeys[OUTPUT_WHITEN + 2]) >>> 0;
    x[3] = (x[3] ^ this.subKeys[OUTPUT_WHITEN + 3]) >>> 0;
  }

  refreshCipherTable() {
    const cache = new Uint32Array(4);
    for (let i = 0; i < 256; i += 16) {
      for (let j = 0; j < 4; j++) {
        const p = i + j * 4;
        cache[j] =
          (this.cipherTable[p] |
            (this.cipherTable[p + 1] << 8) |
            (this.cipherTable[p + 2] << 16) |
            (this.cipherTable[p + 3] << 24)) >>>
          0;
      }
      this.blockEncrypt(cache);
      for (let j = 0; j < 4; j++) {
        const v = cache[j];
        this.cipherTable[i + j * 4] = v & 0xff;
        this.cipherTable[i + j * 4 + 1] = (v >>> 8) & 0xff;
        this.cipherTable[i + j * 4 + 2] = (v >>> 16) & 0xff;
        this.cipherTable[i + j * 4 + 3] = (v >>> 24) & 0xff;
      }
    }
    this.rectPos = 0;
  }

  initialize(seed, useMd5 = true) {
    const keyBytes = new Uint8Array(16);
    keyBytes[0] = keyBytes[4] = keyBytes[8] = keyBytes[12] = (seed >>> 24) & 0xff;
    keyBytes[1] = keyBytes[5] = keyBytes[9] = keyBytes[13] = (seed >>> 16) & 0xff;
    keyBytes[2] = keyBytes[6] = keyBytes[10] = keyBytes[14] = (seed >>> 8) & 0xff;
    keyBytes[3] = keyBytes[7] = keyBytes[11] = keyBytes[15] = seed & 0xff;
    for (let i = 0; i < 4; i++) {
      const p = i * 4;
      this.key[i] = (keyBytes[p] | (keyBytes[p + 1] << 8) | (keyBytes[p + 2] << 16) | (keyBytes[p + 3] << 24)) >>> 0;
    }

    this.reKey(this.key);

    for (let i = 0; i < 256; i++) this.cipherTable[i] = i & 0xff;
    this.sendPos = 0;
    this.refreshCipherTable();

    if (useMd5) {
      this.xorData = md5(this.cipherTable);
    } else {
      this.xorData = new Uint8Array(16);
    }
  }

  encrypt(src, dst, size) {
    for (let i = 0; i < size; i++) {
      if (this.rectPos >= 0x100) this.refreshCipherTable();
      dst[i] = src[i] ^ this.cipherTable[this.rectPos++];
    }
  }

  decrypt(src, dst, size) {
    for (let i = 0; i < size; i++) {
      dst[i] = src[i] ^ this.xorData[this.sendPos];
      this.sendPos = (this.sendPos + 1) & 0x0f;
    }
  }
}
