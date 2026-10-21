export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clampPosition(x, y, width, height) {
  return {
    x: Math.max(0, Math.min(x, Math.max(0, window.innerWidth - width))),
    y: Math.max(0, Math.min(y, Math.max(0, window.innerHeight - height))),
  };
}

export function notorietyColor(noto) {
  switch (noto) {
    case 1:
      return '#6fb7ff';
    case 2:
      return '#7ee08a';
    case 3:
      return '#c8c8c8';
    case 4:
      return '#ffd34a';
    case 5:
      return '#ff8a3a';
    case 6:
      return '#ff4a4a';
    case 7:
      return '#ff5cd6';
    default:
      return '#e8e8e8';
  }
}

export function fitText(ctx, text, maxWidth) {
  const value = String(text ?? '');
  if (!value || maxWidth <= 0) return '';
  if (ctx.measureText(value).width <= maxWidth) return value;
  const suffix = '...';
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(value.slice(0, mid) + suffix).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? value.slice(0, lo) + suffix : '';
}

export function accountStorageKey(world, base) {
  const account = (world?.game?.loginCredentials?.account || '').trim().toLowerCase();
  return account ? `${base}.${account}` : base;
}
