import { LoginCrypt } from './login-crypt.js';
import { Twofish } from './twofish.js';

export function versionToUInt(version) {
  const parts = String(version || '7.0.104.0')
    .replace(/,/g, '.')
    .replace(/ /g, '')
    .toLowerCase()
    .split('.')
    .map((x) => {
      const n = parseInt(x, 10);
      return Number.isFinite(n) ? n : 0;
    });
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  const build = parts[2] || 0;
  const extra = parts[3] || 0;
  return ((major << 24) | (minor << 16) | (build << 8) | extra) >>> 0;
}

export const EncryptionType = {
  NONE: 'NONE',
  OLD_BFISH: 'OLD_BFISH',
  BLOWFISH: 'BLOWFISH',
  BLOWFISH_203: 'BLOWFISH_203',
  TWOFISH_MD5: 'TWOFISH_MD5',
};

function calculateKeys(version) {
  const a = (version >>> 24) & 0xff;
  const b = (version >>> 16) & 0xff;
  const c = (version >>> 8) & 0xff;

  let temp = ((((a << 9) | b) << 10) | c) ^ ((c * c) << 5);
  const key2 = (((temp << 4) ^ (b * b) ^ (b * 0x0b000000) ^ (c * 0x380000) ^ 0x2c13a5fd) >>> 0);
  temp = (((((a << 9) | c) << 10) | b) * 8) ^ (c * c * 0x0c00);
  const key3 = (((temp ^ (b * b) ^ (b * 0x6800000) ^ (c * 0x1c0000) ^ 0x0a31d527f) >>> 0));
  const key1 = (key2 - 1) >>> 0;
  return [key1, key2, key3];
}

export class EncryptionHelper {
  constructor(version) {
    this.version = versionToUInt(version);
    this.type = EncryptionType.TWOFISH_MD5;
    this.keys = calculateKeys(this.version);
    this.loginCrypt = new LoginCrypt();
    this.twofish = new Twofish();
    this.isLogin = true;
    this.initialized = false;
  }

  initialize(isLogin, seed) {
    this.isLogin = isLogin;
    this.initialized = true;
    if (isLogin) {
      this.loginCrypt.initialize(seed >>> 0, this.keys[0], this.keys[1], this.keys[2]);
    } else {
      this.twofish.initialize(seed >>> 0, this.type === EncryptionType.TWOFISH_MD5);
    }
  }

  encryptLogin(src, dst, size) {
    return this.loginCrypt.encrypt(src, dst, size);
  }

  encryptGame(src, dst, size) {
    return this.twofish.encrypt(src, dst, size);
  }

  decryptGame(src) {
    const dst = new Uint8Array(src.length);
    this.twofish.decrypt(src, dst, src.length);
    return dst;
  }
}
