export class LoginCrypt {
  constructor() {
    this.k1 = 0;
    this.k2 = 0;
    this.k3 = 0;
    this.key = new Uint32Array(2);
  }

  initialize(seed, k1, k2, k3) {
    seed >>>= 0;
    this.k1 = k1 >>> 0;
    this.k2 = k2 >>> 0;
    this.k3 = k3 >>> 0;
    this.key[0] = ((((~seed ^ 0x00001357) << 16) | ((seed ^ 0xffffaaaa) & 0x0000ffff)) >>> 0);
    this.key[1] = ((((seed ^ 0x43210000) >>> 16) | ((~seed ^ 0xabcdffff) & 0xffff0000)) >>> 0);
  }

  encrypt(src, dst, size) {
    for (let i = 0; i < size; i++) {
      dst[i] = src[i] ^ (this.key[0] & 0xff);
      const table0 = this.key[0];
      const table1 = this.key[1];
      this.key[1] =
        (((((table1 >>> 1) | (table0 << 31)) ^ this.k1) >>> 1) | (table0 << 31)) ^ this.k2;
      this.key[1] >>>= 0;
      this.key[0] = (((table0 >>> 1) | (table1 << 31)) ^ this.k3) >>> 0;
    }
    return dst;
  }
}
