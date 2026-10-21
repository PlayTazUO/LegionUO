function opaqueBounds(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (data[(row + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export class AssetManager {
  constructor(config) {
    this.config = config;
    this.debug = false;
    this.images = new Map();
    this.animMeta = new Map();
    this.animPromise = new Map();
    this.tileData = null;
    this.multis = new Map();
    this.multiPending = new Set();
    this.fontMeta = new Map();
    this.fontPromise = new Map();
  }

  setDebug(enabled) {
    this.debug = !!enabled;
  }

  image(key, url, computeBounds = false) {
    let entry = this.images.get(key);
    if (entry) return entry.ready ? entry.img : null;
    const img = new Image();
    entry = { img, ready: false, failed: false, bounds: null };
    this.images.set(key, entry);
    img.onload = () => {
      if (computeBounds) entry.bounds = opaqueBounds(img);
      entry.ready = true;
    };
    img.onerror = () => {
      entry.failed = true;
    };
    img.src = url;
    return null;
  }

  isNoDraw(id, isLand = false) {
    const graphic = id & 0xffff;
    if (graphic === 0xffff) return true;
    const entry = isLand ? this.tileData?.land?.[graphic] : this.tileData?.statics?.[graphic];
    const name = isLand ? entry?.[2] : entry?.[4];
    if (name) return /^no[\s_-]?draw/i.test(String(name).trim());
    // Fall back until tiledata has loaded.
    return isLand ? graphic === 2 : graphic <= 1;
  }

  getLand(id, hue = 0) {
    if (!this.debug && this.isNoDraw(id, true)) return null;
    return this.image(`land|${id}|${hue}`, `/api/art/land/${id}.png?hue=${hue}`);
  }

  getStatic(id, hue = 0) {
    if (!this.debug && this.isNoDraw(id, false)) return null;
    return this.image(`static|${id}|${hue}`, `/api/art/static/${id}.png?hue=${hue}`, true);
  }

  staticBounds(id, hue = 0) {
    const entry = this.images.get(`static|${id}|${hue}`);
    return entry?.ready ? entry.bounds : null;
  }

  getTexmap(id, hue = 0) {
    if (!id) return null;
    return this.image(`texmap|${id}|${hue}`, `/api/texmap/${id}.png?hue=${hue}`);
  }

  getGump(id, hue = 0) {
    return this.image(`gump|${id}|${hue}`, `/api/gump/${id}.png?hue=${hue}`);
  }

  getAnim(body, action, dir, hue = 0) {
    const key = `${body}|${action}|${dir}|${hue}`;
    const meta = this.animMeta.get(key);
    const imageKey = `animimg|${key}`;
    this.image(imageKey, `/api/anim/${body}/${action}/${dir}.png?hue=${hue}`);
    if (meta) {
      const entry = this.images.get(imageKey);
      if (entry && entry.ready) return { meta, img: entry.img };
      return null;
    }
    if (!this.animPromise.has(key)) {
      this.animPromise.set(
        key,
        fetch(`/api/anim/${body}/${action}/${dir}?hue=${hue}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((m) => {
            if (m) this.animMeta.set(key, m);
            return m;
          })
          .catch(() => null)
          .finally(() => this.animPromise.delete(key))
      );
    }
    return null;
  }

  getFont(font, hue = 0) {
    const id = Math.max(0, Math.min(9, font | 0));
    const imageKey = `fontimg|${id}|${hue}`;
    this.image(imageKey, `/api/font/${id}.png?hue=${hue}`);
    if (this.fontMeta.has(id)) {
      const meta = this.fontMeta.get(id);
      if (!meta) return null;
      const entry = this.images.get(imageKey);
      if (entry?.ready) return { meta, img: entry.img };
      return null;
    }
    if (!this.fontPromise.has(id)) {
      this.fontPromise.set(
        id,
        fetch(`/api/font/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            this.fontMeta.set(id, data || null);
            return data;
          })
          .catch(() => null)
          .finally(() => this.fontPromise.delete(id))
      );
    }
    return null;
  }

  getMulti(id) {
    if (this.multis.has(id)) return this.multis.get(id);
    if (!this.multiPending.has(id)) {
      this.multiPending.add(id);
      fetch(`/api/multi/${id}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          this.multis.set(id, Array.isArray(data) ? data : []);
        })
        .catch(() => this.multis.set(id, []))
        .finally(() => this.multiPending.delete(id));
    }
    return this.multis.get(id) || null;
  }

  async loadTileData() {
    if (this.tileData) return this.tileData;
    const res = await fetch('/api/tiledata?names=1&v=2');
    if (!res.ok) {
      this.tileData = { land: [], statics: [] };
      return this.tileData;
    }
    this.tileData = await res.json();
    return this.tileData;
  }

  staticFlags(graphic) {
    return this.tileData?.statics?.[graphic]?.[0] ?? 0;
  }

  staticHeight(graphic) {
    return this.tileData?.statics?.[graphic]?.[1] ?? 0;
  }

  staticLayer(graphic) {
    return this.tileData?.statics?.[graphic]?.[2] ?? 0;
  }

  staticAnimId(graphic) {
    return this.tileData?.statics?.[graphic]?.[3] ?? graphic;
  }

  staticName(graphic) {
    return this.tileData?.statics?.[graphic]?.[4] || '';
  }

  landFlags(graphic) {
    return this.tileData?.land?.[graphic]?.[0] ?? 0;
  }

  landTexId(graphic) {
    return this.tileData?.land?.[graphic]?.[1] ?? 0;
  }
}
