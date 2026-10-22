import { serverCacheId, withServerParam } from './serverCache.js';

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
    this.serverId = serverCacheId(config);
    this.debug = false;
    this.images = new Map();
    this.animMeta = new Map();
    this.animPromise = new Map();
    this.animTypes = new Map();
    this.tileData = null;
    this.tileDataPromise = null;
    this.equipConversions = null;
    this.equipConvPromise = null;
    this.tileArt = new Map();
    this.tileArtPromise = new Map();
    this.multis = new Map();
    this.multiPending = new Set();
    this.multiPromises = new Map();
    this.fontMeta = new Map();
    this.fontPromise = new Map();
  }

  setDebug(enabled) {
    this.debug = !!enabled;
  }

  setConfig(config) {
    const nextServerId = serverCacheId(config);
    this.config = config;
    if (nextServerId === this.serverId) return false;
    this.serverId = nextServerId;
    this.images.clear();
    this.animMeta.clear();
    this.animPromise.clear();
    this.animTypes.clear();
    this.tileData = null;
    this.tileDataPromise = null;
    this.equipConversions = null;
    this.equipConvPromise = null;
    this.tileArt.clear();
    this.tileArtPromise.clear();
    this.multis.clear();
    this.multiPending.clear();
    this.multiPromises.clear();
    this.fontMeta.clear();
    this.fontPromise.clear();
    return true;
  }

  url(path) {
    return withServerParam(path, this.config);
  }

  imageKey(key) {
    return this.serverId ? `${this.serverId}|${key}` : key;
  }

  image(key, url, computeBounds = false) {
    const cacheKey = this.imageKey(key);
    let entry = this.images.get(cacheKey);
    if (entry) return entry.ready ? entry.img : null;
    const img = new Image();
    entry = { img, ready: false, failed: false, bounds: null };
    this.images.set(cacheKey, entry);
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

  pendingImageCount() {
    let pending = 0;
    for (const entry of this.images.values()) {
      if (!entry.ready && !entry.failed) pending++;
    }
    return pending;
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
    return this.image(`land|${id}|${hue}`, this.url(`/api/art/land/${id}.png?hue=${hue}`));
  }

  getStatic(id, hue = 0) {
    if (!this.debug && this.isNoDraw(id, false)) return null;
    return this.image(`static|${id}|${hue}`, this.url(`/api/art/static/${id}.png?hue=${hue}`), true);
  }

  staticBounds(id, hue = 0) {
    const entry = this.images.get(this.imageKey(`static|${id}|${hue}`));
    return entry?.ready ? entry.bounds : null;
  }

  getTexmap(id, hue = 0) {
    if (!id) return null;
    return this.image(`texmap|${id}|${hue}`, this.url(`/api/texmap/${id}.png?hue=${hue}`));
  }

  getGump(id, hue = 0) {
    return this.image(`gump|${id}|${hue}`, this.url(`/api/gump/${id}.png?hue=${hue}`));
  }

  gumpState(id, hue = 0) {
    const entry = this.images.get(this.imageKey(`gump|${id}|${hue}`));
    if (!entry) return 'unknown';
    if (entry.ready) return 'ready';
    if (entry.failed) return 'failed';
    return 'loading';
  }

  /**
   * Probe whether a gump id exists. Returns true/false once the image has
   * loaded/failed, or null while the check is still in flight.
   */
  gumpProbe(id, hue = 0) {
    this.getGump(id, hue);
    const state = this.gumpState(id, hue);
    if (state === 'unknown' || state === 'loading') return null;
    return state === 'ready';
  }

  getAnim(body, action, dir, hue = 0, equip = false) {
    const key = `${body}|${action}|${dir}|${hue}|${equip ? 'e' : ''}`;
    const meta = this.animMeta.get(key);
    const imageKey = `animimg|${key}`;
    this.image(imageKey, this.url(`/api/anim/${body}/${action}/${dir}.png?hue=${hue}${equip ? '&equip=1' : ''}`));
    if (meta) {
      const entry = this.images.get(this.imageKey(imageKey));
      if (entry && entry.ready) return { meta, img: entry.img };
      return null;
    }
    if (!this.animPromise.has(key)) {
      this.animPromise.set(
        key,
        fetch(this.url(`/api/anim/${body}/${action}/${dir}?hue=${hue}${equip ? '&equip=1' : ''}`))
          .then((r) => (r.ok ? r.json() : null))
          .then((m) => {
            if (m) {
              this.animMeta.set(key, m);
              if (m.type) this.animTypes.set(body, m.type);
            }
            return m;
          })
          .catch(() => null)
          .finally(() => this.animPromise.delete(key))
      );
    }
    return null;
  }

  animType(body) {
    return this.animTypes.get(body) || null;
  }

  getFont(font, hue = 0) {
    const id = Math.max(0, Math.min(9, font | 0));
    const imageKey = `fontimg|${id}|${hue}`;
    this.image(imageKey, this.url(`/api/font/${id}.png?hue=${hue}`));
    if (this.fontMeta.has(id)) {
      const meta = this.fontMeta.get(id);
      if (!meta) return null;
      const entry = this.images.get(this.imageKey(imageKey));
      if (entry?.ready) return { meta, img: entry.img };
      return null;
    }
    if (!this.fontPromise.has(id)) {
      this.fontPromise.set(
        id,
        fetch(this.url(`/api/font/${id}`))
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
    this.ensureMulti(id);
    return null;
  }

  ensureMulti(id) {
    if (this.multis.has(id)) return Promise.resolve(this.multis.get(id));
    if (this.multiPromises.has(id)) return this.multiPromises.get(id);
    if (!this.multiPending.has(id)) this.multiPending.add(id);
    const promise = fetch(this.url(`/api/multi/${id}`))
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const parts = Array.isArray(data) ? data : [];
        this.multis.set(id, parts);
        return parts;
      })
      .catch(() => {
        this.multis.set(id, []);
        return [];
      })
      .finally(() => {
        this.multiPending.delete(id);
        this.multiPromises.delete(id);
      });
    this.multiPromises.set(id, promise);
    return promise;
  }

  async loadTileData() {
    if (this.tileData) return this.tileData;
    if (this.tileDataPromise) return this.tileDataPromise;
    this.tileDataPromise = fetch(this.url('/api/tiledata?names=1&v=4'))
      .then((res) => {
        if (!res.ok) throw new Error(`tiledata HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.statics) && data.statics.length) this.tileData = data;
        return this.tileData;
      })
      .catch((err) => {
        console.warn('[assets] tiledata load failed, will retry:', err);
        return null;
      })
      .finally(() => {
        this.tileDataPromise = null;
      });
    return this.tileDataPromise;
  }

  async loadEquipConv() {
    if (this.equipConversions) return this.equipConversions;
    if (!this.equipConvPromise) {
      this.equipConvPromise = fetch(this.url('/api/equipconv'))
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          this.equipConversions = data && typeof data === 'object' ? data : {};
          return this.equipConversions;
        })
        .catch(() => {
          this.equipConversions = {};
          return this.equipConversions;
        })
        .finally(() => {
          this.equipConvPromise = null;
        });
    }
    return this.equipConvPromise;
  }

  getTileArt(graphic) {
    if (this.tileArt.has(graphic)) return this.tileArt.get(graphic);
    if (!this.tileArtPromise.has(graphic)) {
      this.tileArtPromise.set(
        graphic,
        fetch(this.url(`/api/tileart/${graphic}`))
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            const appearances = data && typeof data.appearances === 'object' ? data.appearances : null;
            this.tileArt.set(graphic, appearances);
            return appearances;
          })
          .catch(() => {
            this.tileArt.set(graphic, null);
            return null;
          })
          .finally(() => this.tileArtPromise.delete(graphic))
      );
    }
    return null;
  }

  tileArtAppearance(graphic, body) {
    const appearances = this.tileArt.get(graphic);
    if (!appearances) return 0;
    return appearances[body] || 0;
  }

  equipConv(bodyType, animId) {
    const body = this.equipConversions?.[bodyType];
    if (!body) return null;
    const entry = body[animId];
    if (!entry) return null;
    return { graphic: entry[0], gump: entry[1], color: entry[2] };
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
