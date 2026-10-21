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

  image(key, url) {
    let entry = this.images.get(key);
    if (entry) return entry.ready ? entry.img : null;
    const img = new Image();
    entry = { img, ready: false, failed: false };
    this.images.set(key, entry);
    img.onload = () => {
      entry.ready = true;
    };
    img.onerror = () => {
      entry.failed = true;
    };
    img.src = url;
    return null;
  }

  getLand(id, hue = 0) {
    if ((id & 0xffff) === 0 && !this.debug) return null;
    return this.image(`land|${id}|${hue}`, `/api/art/land/${id}.png?hue=${hue}`);
  }

  getStatic(id, hue = 0) {
    if ((id & 0xffff) === 0 && !this.debug) return null;
    return this.image(`static|${id}|${hue}`, `/api/art/static/${id}.png?hue=${hue}`);
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
