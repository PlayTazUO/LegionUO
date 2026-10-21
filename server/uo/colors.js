const FIVE_BIT = new Uint8Array(32);
for (let i = 0; i < 32; i++) FIVE_BIT[i] = Math.round((i * 255) / 31);

export function color16ToRgb(c) {
  return [FIVE_BIT[(c >> 10) & 0x1f], FIVE_BIT[(c >> 5) & 0x1f], FIVE_BIT[c & 0x1f]];
}

export function color16To32(c) {
  const r = FIVE_BIT[(c >> 10) & 0x1f];
  const g = FIVE_BIT[(c >> 5) & 0x1f];
  const b = FIVE_BIT[c & 0x1f];
  return (255 << 24) | (b << 16) | (g << 8) | r;
}
