export function color16ToRgb(c) {
  return [
    Math.round((((c >> 10) & 0x1f) * 255) / 31),
    Math.round((((c >> 5) & 0x1f) * 255) / 31),
    Math.round(((c & 0x1f) * 255) / 31),
  ];
}

export function color16To32(c) {
  const [r, g, b] = color16ToRgb(c);
  return (255 << 24) | (b << 16) | (g << 8) | r;
}
