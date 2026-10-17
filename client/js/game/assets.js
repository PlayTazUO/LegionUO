export class AssetManager {
  constructor(config) {
    this.config = config;
    this.images = new Map();
    this.animMeta = new Map();
    this.animPromise = new Map();
    this.tileData = null;
    this.multis = new Map();
    this.multiPending = new Set();
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
    return this.image(`land|${id}|${hue}`, `/api/art/land/${id}.png?hue=${hue}`);
  }

  getStatic(id, hue = 0) {
    return this.image(`static|${id}|${hue}`, `/api/art/static/${id}.png?hue=${hue}`);
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
    const res = await fetch('/api/tiledata');
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

  landFlags(graphic) {
    return this.tileData?.land?.[graphic]?.[0] ?? 0;
  }
}
