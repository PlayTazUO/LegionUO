export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * The visible layout viewport. Kept in one place so every panel uses the same
 * dimensions when the client is running on a phone or tablet.
 */
export function viewportSize() {
  const width = Math.round(window.innerWidth || document.documentElement?.clientWidth || 1);
  const height = Math.round(window.innerHeight || document.documentElement?.clientHeight || 1);
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

export function isCoarsePointer() {
  try {
    if (window.matchMedia) return !!window.matchMedia('(pointer: coarse)').matches;
  } catch {
    /* fall through */
  }
  return 'ontouchstart' in window;
}

/**
 * Mobile layout is used for touch devices and narrow desktop windows. It only
 * changes how client-drawn panels are fitted; server gumps keep their native
 * size.
 */
export function isMobileLayout() {
  return isCoarsePointer() || viewportSize().width < 700;
}

export function clampPosition(x, y, width, height) {
  const { width: vw, height: vh } = viewportSize();
  // Windows and gumps may be moved partly outside the viewport, but at least
  // this much of them stays reachable so they can be dragged back.
  const keepX = Math.min(20, Math.max(0, width));
  const keepY = Math.min(20, Math.max(0, height));
  return {
    x: Math.max(-(width - keepX), Math.min(x, vw - keepX)),
    y: Math.max(-(height - keepY), Math.min(y, vh - keepY)),
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
