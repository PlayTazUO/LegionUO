export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * The layout viewport. Unlike the visual viewport this does not shrink when the
 * on-screen keyboard opens, so client panels keep their position relative to
 * the full screen while the user is typing.
 *
 * Reading documentElement dimensions forces a layout flush, so keep a cached
 * copy for the many per-frame callers and refresh it only when the viewport
 * itself changes.
 */
let cachedLayoutViewport = null;

function measureLayoutViewport() {
  const width = Math.round(
    document.documentElement?.clientWidth || window.innerWidth || 1
  );
  const height = Math.round(
    document.documentElement?.clientHeight || window.innerHeight || 1
  );
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function layoutViewportSize() {
  if (!cachedLayoutViewport) cachedLayoutViewport = measureLayoutViewport();
  return cachedLayoutViewport;
}

if (typeof window !== 'undefined') {
  const refreshLayoutViewport = () => {
    cachedLayoutViewport = null;
  };
  window.addEventListener('resize', refreshLayoutViewport);
  window.addEventListener('orientationchange', () => setTimeout(refreshLayoutViewport, 120));
}

/**
 * The visible viewport. Kept in one place so every panel uses the same
 * dimensions when the client is running on a phone or tablet. The visual
 * viewport tracks the actual on-screen area while mobile browser chrome and
 * orientation change, whereas window.innerWidth/innerHeight can lag behind it
 * and let fixed elements extend past the edge of the screen.
 */
export function viewportSize() {
  const layout = layoutViewportSize();
  const visual = window.visualViewport;
  const width = Math.round(visual?.width || layout.width);
  const height = Math.round(visual?.height || layout.height);
  // A soft keyboard shrinks the visual viewport while leaving the layout
  // viewport intact. Ignore that shrink so opening the journal or chat does not
  // resize the game window or drag the hotbar halfway up the screen.
  const sameWidth = Math.abs(width - layout.width) <= layout.width * 0.05;
  if (sameWidth && height < layout.height * 0.75) return layout;
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
