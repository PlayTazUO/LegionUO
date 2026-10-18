const REQUEST_COOLDOWN = 1200;

export class OPLManager {
  constructor(world) {
    this.world = world;
    this.cache = new Map();
    this.revisions = new Map();
    this.requestedAt = new Map();
  }

  reset() {
    this.cache.clear();
    this.revisions.clear();
    this.requestedAt.clear();
  }

  setRevision(serial, revision) {
    serial = serial >>> 0;
    revision = revision >>> 0;
    const previous = this.revisions.get(serial);
    this.revisions.set(serial, revision);
    if (previous !== undefined && previous !== revision) {
      const cached = this.cache.get(serial);
      if (cached) cached.stale = true;
    }
  }

  set(serial, revision, entries) {
    serial = serial >>> 0;
    revision = revision >>> 0;
    this.revisions.set(serial, revision);
    this.cache.set(serial, {
      revision,
      entries: entries || [],
      received: performance.now(),
      stale: false,
    });
    this.requestedAt.delete(serial);
    const entity = this.world.get(serial);
    const first = entries?.[0];
    if (entity && !entity.isMobile && first) {
      const name = this.world.game.cliloc(first.cliloc, first.args);
      if (name) entity.name = name;
    }
  }

  get(serial) {
    return this.cache.get(serial >>> 0) || null;
  }

  isFresh(serial) {
    const cached = this.cache.get(serial >>> 0);
    if (!cached || cached.stale) return false;
    const revision = this.revisions.get(serial >>> 0);
    return revision === undefined || revision === cached.revision;
  }

  request(serial) {
    serial = serial >>> 0;
    if (!serial || !this.world.inGame) return;
    if (this.isFresh(serial)) return;
    const now = performance.now();
    const last = this.requestedAt.get(serial) || 0;
    if (now - last < REQUEST_COOLDOWN) return;
    this.requestedAt.set(serial, now);
    this.world.socket.out.megaClilocRequest([serial]);
  }

  resolve(serial) {
    const cached = this.cache.get(serial >>> 0);
    if (!cached) return null;
    const game = this.world.game;
    const lines = [];
    const seen = new Set();
    for (const entry of cached.entries) {
      let text = game.cliloc(entry.cliloc, entry.args);
      if (text == null) text = entry.text;
      if (text == null) continue;
      text = String(text).replace(/\r/g, '').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      lines.push(text);
    }
    if (!lines.length) return null;
    return {
      revision: cached.revision,
      stale: cached.stale,
      lines,
      name: lines[0],
      properties: lines.slice(1),
    };
  }
}
