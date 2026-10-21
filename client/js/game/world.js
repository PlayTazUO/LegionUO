import { Entity, isGhostGraphic, isMobileSerial, Layer } from './entity.js';
import { OPLManager } from './opl.js';
import { UltimaLiveManager } from './uolive.js';

export class Mobile extends Entity {
  constructor(serial) {
    super(serial, true);
  }
}

export class Item extends Entity {
  constructor(serial) {
    super(serial, false);
  }
}

export class World {
  constructor(config, assets, socket) {
    this.config = config;
    this.assets = assets;
    this.socket = socket;
    this.entities = new Map();
    this.player = null;
    this.inGame = false;
    this.mapIndex = 0;
    this.useXMapFiles = false;
    this.range = 24;
    this.light = { overall: 0, personal: 0, displayOverall: 0, displayPersonal: 0 };
    this.realSeason = 0;
    this.season = 0;
    this.weather = { type: 0, count: 0, temp: 0, particles: [] };
    this.lightTarget = { overall: 0, personal: 0 };
    this.messages = [];
    this.messageListeners = [];
    this.gumps = new Map();
    this.gumpPositions = new Map();
    this.gumpScales = new Map();
    this.gumpStateLoaded = false;
    this.gumpListeners = [];
    this.target = { active: false, type: 0, cursorId: 0, cursorType: 0, multi: null };
    this.skills = new Map();
    this.skillList = [];
    this.party = {
      members: [],
      leader: 0,
      inviter: 0,
      canLoot: false,
    };
    this.buffs = [];
    this.chat = { channels: [], current: '', username: '' };
    this.trade = null;
    this.containers = new Map();
    this.walkSeq = 0;
    this.steps = [];
    this.pendingSteps = [];
    this.lastWalkSent = 0;
    this.lastStepTime = 0;
    this.nextStepTime = 0;
    this.denyCooldownUntil = 0;
    this.lastBlockedDirection = -1;
    this.lastBlockedTurn = 0;
    this.alwaysRun = false;
    this.stunnedUntil = 0;
    this.maxPendingSteps = 5;
    this.stepLead = 35;
    this.moveSpeedMultiplier = Number(config.moveSpeedMultiplier) || 1;
    this.walkTiming = {
      walk: Number(config.walkDelay) || 400,
      run: Number(config.runDelay) || 200,
      mountedWalk: Number(config.mountedWalkDelay) || 200,
      mountedRun: Number(config.mountedRunDelay) || 100,
    };
    this.turnDelay = Number(config.turnDelay) || 80;
    this.serverTime = 0;
    this.stats = { str: 0, dex: 0, int: 0, weight: 0, weightMax: 0, gold: 0 };
    this.statLocks = { str: 0, dex: 0, int: 0 };
    this.resist = {};
    this.features = {};
    this.opl = new OPLManager(this);
    this.mapCache = new Map();
    this.mapFailures = new Map();
    this.mapPending = new Set();
    this.blockPromises = new Map();
    this.mapListeners = [];
    this.uolive = new UltimaLiveManager(this);
    this.hues = null;
    this.textScale = 1;
    this.playerSerial = 0;
    this.targetEntity = null;
    this.lastAttack = 0;
    this.openContainers = new Map();
    this.board = null;
    this.profile = { serial: 0, text: '' };
    this.questArrow = null;
    this.waypoints = [];
    this.localWaypoints = [];
    this.corpses = new Map();
    this.held = null;
    this.heldAmount = 0;
    this.login = { step: 'connecting', servers: [], characters: [], cities: [], error: null, characterListFlags: 0 };
  }

  get held() {
    return this._held || null;
  }

  set held(value) {
    this._held = value || null;
    if (!this._held) this.heldAmount = 0;
  }

  getTileData() {
    return this.assets.tileData;
  }

  update(dt) {
    const now = performance.now();
    this.updateLight(dt);
    this.updateSteps(now);
    for (const entity of this.entities.values()) {
      if (entity === this.player) this.updatePlayerRender(now);
      else this.updateEntityRender(entity, now);
    }
    // Expire short-lived world text and advance particles.
    if (this.weather.particles.length) {
      for (const p of this.weather.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) {
          p.x = Math.random() * 2000;
          p.y = -20;
          p.life = 2 + Math.random() * 3;
        }
      }
    }
  }

  updateLight(dt) {
    const target = this.lightTarget;
    const light = this.light;
    const speed = Math.max(0, Math.min(1, dt * 1.4));
    light.displayOverall = (light.displayOverall ?? light.overall) + ((target.overall ?? light.overall) - (light.displayOverall ?? light.overall)) * speed;
    light.displayPersonal = (light.displayPersonal ?? light.personal) + ((target.personal ?? light.personal) - (light.displayPersonal ?? light.personal)) * speed;
    if (Math.abs(light.displayOverall - target.overall) < 0.01) light.displayOverall = target.overall;
    if (Math.abs(light.displayPersonal - target.personal) < 0.01) light.displayPersonal = target.personal;
  }

  setLight(overall = 0, personal = 0) {
    this.light.overall = overall;
    this.light.personal = personal;
    this.lightTarget.overall = overall;
    this.lightTarget.personal = personal;
  }

  setStunned(ms = 1200) {
    this.stunnedUntil = Math.max(this.stunnedUntil, performance.now() + ms);
    if (this.player) this.player.isStunned = true;
  }

  clearStunned() {
    this.stunnedUntil = 0;
    if (this.player) this.player.isStunned = false;
  }

  get(serial) {
    return this.entities.get(serial >>> 0) || null;
  }

  getMobile(serial) {
    const e = this.get(serial);
    return e && e.isMobile ? e : null;
  }

  getItem(serial) {
    const e = this.get(serial);
    return e && e.isItem ? e : null;
  }

  createPlayer(serial) {
    this.playerSerial = serial >>> 0;
    let player = this.getMobile(serial);
    if (!player) {
      player = new Mobile(serial);
      this.entities.set(player.serial, player);
    }
    this.player = player;
    this.inGame = true;
    return player;
  }

  getOrCreateMobile(serial) {
    let e = this.get(serial);
    if (!e) {
      e = new Mobile(serial);
      this.entities.set(e.serial, e);
    }
    return e;
  }

  getOrCreateItem(serial) {
    let e = this.get(serial);
    if (!e) {
      e = new Item(serial);
      this.entities.set(e.serial, e);
    }
    return e;
  }

  remove(serial) {
    const e = this.get(serial);
    if (!e) return;
    if (e.container) {
      const parent = this.get(e.container);
      if (parent) parent.removeItem(e);
    }
    this.entities.delete(serial >>> 0);
    this.corpses.delete(serial >>> 0);
  }

  removeFromContainer(entity) {
    if (entity.container) {
      const parent = this.get(entity.container);
      if (parent) parent.removeItem(entity);
    }
    entity.container = 0;
    entity.layer = Layer.Invalid;
  }

  updateObject(data) {
    const {
      serial,
      graphic,
      graphicInc = 0,
      amount = 1,
      x,
      y,
      z,
      direction = 0,
      hue = 0,
      flags = 0,
      isMobile,
      type = 1,
    } = data;
    const mobile = isMobile ?? isMobileSerial(serial);
    let entity = this.get(serial);
    const created = !entity;
    if (!entity) {
      entity = mobile ? new Mobile(serial) : new Item(serial);
      this.entities.set(serial, entity);
    }
    if (created) this.setEntityPosition(entity, x, y, z);
    entity.graphic = graphic + graphicInc;
    if (hue) entity.hue = hue;
    if (flags) entity.flags = flags;
    this.refreshGhostState(entity);
    if (!mobile) {
      entity.x = x;
      entity.y = y;
      entity.z = z;
      entity.renderX = x;
      entity.renderY = y;
      entity.renderZ = z;
      entity.hasPosition = true;
      if (direction !== undefined) entity.direction = direction & 7;
      entity.amount = Math.max(1, amount || 1);
      entity.isCorpse = graphic === 0x2006;
      entity.isMulti = type === 2 || (graphic & 0x4000) !== 0;
      if (entity.isMulti) entity.graphic = graphic & 0x3fff;
      entity.layer = Layer.Invalid;
    } else {
      entity.isCorpse = false;
      if (entity !== this.player) this.moveMobile(entity, x, y, z, direction);
      if (entity.animation.group === undefined) entity.animation.group = 4;
    }
    return entity;
  }

  setEntityPosition(entity, x, y, z) {
    entity.x = x;
    entity.y = y;
    entity.z = z;
    entity.renderX = x;
    entity.renderY = y;
    entity.renderZ = z;
    entity.motion = null;
    entity.motionQueue = [];
    entity.hasPosition = true;
  }

  refreshGhostState(entity) {
    if (!entity?.isMobile) return;
    const wasGhost = entity.isGhost;
    const ghost = isGhostGraphic(entity.graphic);
    entity.isGhost = ghost;
    if (ghost) {
      entity.isDead = true;
    } else if (wasGhost || entity === this.player) {
      entity.isDead = false;
      entity.livingGraphic = 0;
    }
  }

  setPlayerGhost() {
    const player = this.player;
    if (!player) return;
    if (!player.isGhost) player.livingGraphic = player.graphic;
    const female = player.isFemale || (player.flags & 0x02) !== 0;
    player.graphic = player.race === 3 ? 0x02b6 + (female ? 1 : 0) : 0x0192 + (female ? 1 : 0);
    player.isDead = true;
    player.isGhost = true;
    player.moving = false;
    player.motion = null;
    player.walkQueue = [];
    player.renderX = player.x;
    player.renderY = player.y;
    player.renderZ = player.z;
    this.cancelPendingSteps();
  }

  clearPlayerGhost() {
    const player = this.player;
    if (!player) return;
    if (player.livingGraphic) player.graphic = player.livingGraphic;
    player.livingGraphic = 0;
    player.isDead = false;
    player.isGhost = false;
  }

  buildMotionSegments(entity, fromX, fromY, fromZ, toX, toY, toZ, running) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (steps <= 0) return [];
    const duration = this.stepDuration(running, entity);
    const segments = [];
    let lastX = fromX;
    let lastY = fromY;
    let lastZ = fromZ;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = Math.round(fromX + dx * t);
      const sy = Math.round(fromY + dy * t);
      const sz = Math.round(fromZ + (toZ - fromZ) * t);
      if (sx === lastX && sy === lastY && sz === lastZ) continue;
      segments.push({
        fromX: lastX,
        fromY: lastY,
        fromZ: lastZ,
        toX: sx,
        toY: sy,
        toZ: sz,
        start: 0,
        duration,
        run: running,
      });
      lastX = sx;
      lastY = sy;
      lastZ = sz;
    }
    if (lastX !== toX || lastY !== toY || lastZ !== toZ) {
      segments.push({
        fromX: lastX,
        fromY: lastY,
        fromZ: lastZ,
        toX,
        toY,
        toZ,
        start: 0,
        duration,
        run: running,
      });
    }
    return segments;
  }

  moveMobile(entity, x, y, z, direction = entity.direction) {
    const now = performance.now();
    const previousX = entity.x;
    const previousY = entity.y;
    const previousZ = entity.z;
    const hadPosition = entity.hasPosition;
    if (direction !== undefined) entity.direction = direction & 7;

    if (!hadPosition) {
      this.setEntityPosition(entity, x, y, z);
      return;
    }
    if (previousX === x && previousY === y && previousZ === z) return;

    const chebyshev = Math.max(Math.abs(x - previousX), Math.abs(y - previousY));
    const dz = Math.abs(z - previousZ);
    const sinceLastStep = entity.lastStepTime ? now - entity.lastStepTime : Infinity;

    // Genuine teleports/resyncs snap; ordinary movement updates are walked
    // tile by tile so mobiles never visibly jump between tiles.
    if (chebyshev > 32 || dz > 24) {
      this.setEntityPosition(entity, x, y, z);
      return;
    }

    const running = chebyshev > 1 || sinceLastStep < 300;
    const segments = this.buildMotionSegments(entity, previousX, previousY, previousZ, x, y, z, running);
    if (segments.length) {
      if (!entity.motionQueue) entity.motionQueue = [];
      entity.motionQueue.push(...segments);
      entity.moving = true;
    }
    entity.x = x;
    entity.y = y;
    entity.z = z;
    entity.hasPosition = true;
    entity.lastStepTime = now;
    entity.moveStart = now;
  }

  addItemToContainer(itemData) {
    const item = this.getOrCreateItem(itemData.serial);
    item.graphic = itemData.graphic;
    item.amount = itemData.amount;
    item.x = itemData.x;
    item.y = itemData.y;
    item.hue = itemData.hue;
    item.layer = Layer.Invalid;
    item.container = itemData.container;
    const parent = this.get(itemData.container);
    if (parent) parent.addItem(item);
    return item;
  }

  animateMobile(serial, group, opts = {}) {
    const mobile = this.getMobile(serial);
    if (!mobile) return;
    const now = performance.now();
    mobile.animation = {
      group,
      frame: 0,
      start: now,
      repeat: opts.repeat ?? false,
      forward: opts.forward ?? true,
      frameCount: opts.frameCount ?? 0,
      repeatCount: opts.repeatCount ?? 0,
      delay: opts.delay ?? 0,
      fromServer: opts.fromServer ?? true,
    };
    if (mobile === this.player) this.playerAnim = mobile.animation;
  }

  playAnimationFrame(mobile, now) {
    // Server-driven animations advance by wall clock. Walking/idle groups loop.
    const anim = mobile.animation;
    if (!anim) return;
    const isMoving = mobile.moving;
    if (isMoving && now - (mobile.lastStepTime || 0) > 380) {
      mobile.moving = false;
    }
  }

  stepDuration(run = false, entity = this.player) {
    const mounted = !!entity?.mount;
    let ms = mounted
      ? run
        ? this.walkTiming.mountedRun
        : this.walkTiming.mountedWalk
      : run
        ? this.walkTiming.run
        : this.walkTiming.walk;
    if (run && entity === this.player && entity?.staminaMax > 0 && entity.stamina <= 0) {
      ms = mounted ? this.walkTiming.mountedWalk : this.walkTiming.walk;
    }
    const modifier = this.moveSpeedMultiplier > 0 ? this.moveSpeedMultiplier : 1;
    return Math.max(60, Math.round(ms / modifier));
  }

  updateSteps(now) {
    this.steps = this.steps.filter((step) => now < step.startTime + step.duration + 1500);
    for (const step of this.steps) {
      if (step.completed || now < step.startTime + step.duration) continue;
      step.completed = true;
      const info = this.tileInfo(step.toX, step.toY);
      this.game?.audio?.footstep?.({
        run: step.run,
        mounted: !!this.player?.mount,
        tile: info?.tile || 0,
      });
    }
  }

  playerStepAt(now) {
    for (const step of this.steps) {
      if (now < step.startTime + step.duration) return step;
    }
    return null;
  }

  stepPosition(step, now) {
    const t = step.duration > 0 ? Math.max(0, Math.min(1, (now - step.startTime) / step.duration)) : 1;
    return {
      x: step.fromX + (step.toX - step.fromX) * t,
      y: step.fromY + (step.toY - step.fromY) * t,
      z: step.fromZ + (step.toZ - step.fromZ) * t,
    };
  }

  updatePlayerRender(now) {
    const player = this.player;
    if (!player) return;
    if (!player.moving) {
      player.walkStepIndex = -1;
      player.currentStep = null;
    }
    const step = this.playerStepAt(now);
    if (step) {
      if (player.currentStep !== step) {
        player.currentStep = step;
        player.walkStepIndex = (player.walkStepIndex ?? -1) + 1;
      }
      const pos = this.stepPosition(step, now);
      player.renderX = pos.x;
      player.renderY = pos.y;
      player.renderZ = pos.z;
      player.moving = true;
      player.stepProgress = step.duration > 0 ? Math.max(0, Math.min(1, (now - step.startTime) / step.duration)) : 1;
      return;
    }
    const last = this.steps[this.steps.length - 1];
    player.renderX = last ? last.toX : player.x;
    player.renderY = last ? last.toY : player.y;
    player.renderZ = last ? last.toZ : player.z;
    player.moving = false;
    player.stepProgress = null;
  }

  updateEntityRender(entity, now) {
    if (!entity.motionQueue) entity.motionQueue = [];
    if (!entity.motion) entity.walkStepIndex = -1;
    if (!entity.motion && entity.motionQueue.length) {
      entity.motion = entity.motionQueue.shift();
      entity.motion.start = now;
      entity.walkStepIndex = (entity.walkStepIndex ?? -1) + 1;
    }

    let motion = entity.motion;
    while (motion) {
      const end = motion.start + motion.duration;
      if (now < end) {
        const t = Math.max(0, Math.min(1, (now - motion.start) / Math.max(1, motion.duration)));
        entity.renderX = motion.fromX + (motion.toX - motion.fromX) * t;
        entity.renderY = motion.fromY + (motion.toY - motion.fromY) * t;
        entity.renderZ = motion.fromZ + (motion.toZ - motion.fromZ) * t;
        entity.moving = true;
        entity.stepProgress = t;
        return;
      }
      entity.renderX = motion.toX;
      entity.renderY = motion.toY;
      entity.renderZ = motion.toZ;
      entity.motion = null;
      const next = entity.motionQueue.length ? entity.motionQueue.shift() : null;
      if (!next) {
        entity.moving = false;
        entity.stepProgress = null;
        entity.walkStepIndex = -1;
        return;
      }
      next.start = end;
      entity.motion = next;
      entity.walkStepIndex = (entity.walkStepIndex ?? -1) + 1;
      motion = next;
    }

    entity.renderX = entity.x;
    entity.renderY = entity.y;
    entity.renderZ = entity.z;
    entity.moving = false;
    entity.stepProgress = null;
    entity.walkStepIndex = -1;
  }

  staticsAt(block, lx, ly) {
    if (!block._staticGrid) {
      block._staticGrid = Array.from({ length: 64 }, () => []);
      for (const s of block.statics || []) {
        const idx = (s.y << 3) | s.x;
        if (idx >= 0 && idx < 64) block._staticGrid[idx].push(s);
      }
    }
    return block._staticGrid[(ly << 3) | lx] || [];
  }

  tileInfo(x, y) {
    if (x < 0 || y < 0) return null;
    const block = this.getBlock(x >> 3, y >> 3);
    if (!block || !block.cells) return null;
    const lx = x & 7;
    const ly = y & 7;
    const cell = block.cells[(ly << 3) | lx];
    if (!cell) return null;
    const landFlags = (this.assets.landFlags(cell.tile) || 0) >>> 0;
    let noDiagonal = (landFlags & 0x01000000) !== 0;
    if (landFlags & 0x40) {
      return { walkable: false, z: cell.z, tile: cell.tile, noDiagonal };
    }

    const statics = this.staticsAt(block, lx, ly);
    let z = cell.z;
    for (const s of statics) {
      const flags = (this.assets.staticFlags(s.graphic) || 0) >>> 0;
      if (flags & 0x01000000) noDiagonal = true;
      const surface = (flags & 0x00000100) !== 0 || (flags & 0x00000200) !== 0;
      if (surface && s.z >= z - 1 && s.z <= z + 8) z = Math.max(z, s.z);
    }

    let blocked = false;
    for (const s of statics) {
      const flags = (this.assets.staticFlags(s.graphic) || 0) >>> 0;
      if (!(flags & 0x40)) continue;
      const height = this.assets.staticHeight(s.graphic) || 0;
      const top = s.z + Math.max(1, height);
      if (top > z + 1 && s.z < z + 16) {
        blocked = true;
        break;
      }
    }
    const multi = this.multiAt(x, y, z);
    if (multi) {
      blocked = blocked || multi.blocked;
      noDiagonal = noDiagonal || multi.noDiagonal;
      if (multi.surface != null) z = Math.max(z, multi.surface);
    }
    return { walkable: !blocked, z, tile: cell.tile, noDiagonal };
  }

  multiAt(x, y, z) {
    let result = null;
    for (const entity of this.entities.values()) {
      if (!entity.isItem || !entity.isMulti || !entity.hasPosition) continue;
      const parts = this.assets.getMulti(entity.graphic);
      if (!parts || !parts.length) continue;
      const dx = x - entity.x;
      const dy = y - entity.y;
      if (Math.abs(dx) > 32 || Math.abs(dy) > 32) continue;
      for (const part of parts) {
        if (part.x !== dx || part.y !== dy) continue;
        const flags = (this.assets.staticFlags(part.graphic) || 0) >>> 0;
        if (!flags) continue;
        const partZ = entity.z + (part.z || 0);
        if (flags & 0x01000000) {
          result = result || { blocked: false, noDiagonal: true, surface: null };
          result.noDiagonal = true;
        }
        if ((flags & 0x00000100) !== 0 || (flags & 0x00000200) !== 0) {
          result = result || { blocked: false, noDiagonal: false, surface: null };
          if (partZ >= z - 1 && partZ <= z + 8) result.surface = Math.max(result.surface ?? partZ, partZ);
        }
        if (!(flags & 0x40)) continue;
        const height = this.assets.staticHeight(part.graphic) || 0;
        const top = partZ + Math.max(1, height);
        if (top > z + 1 && partZ < z + 16) {
          result = result || { blocked: false, noDiagonal: false, surface: null };
          result.blocked = true;
        }
      }
    }
    return result;
  }

  addMessage(text, hue = 0x3b2, type = 0, name = '', font = 3, extra = {}) {
    const msg = { text, hue, type, name, font, time: Date.now(), ...extra };
    this.messages.push(msg);
    if (this.messages.length > 500) this.messages.shift();
    for (const cb of this.messageListeners) cb(msg);
    return msg;
  }

  onMessage(cb) {
    this.messageListeners.push(cb);
  }

  onGump(cb) {
    this.gumpListeners.push(cb);
  }

  onMap(cb) {
    this.mapListeners.push(cb);
  }

  addGump(gump) {
    this.gumps.set(gump.id, gump);
    for (const cb of this.gumpListeners) cb(gump);
  }

  gumpStateKey() {
    const account = (this.game?.loginCredentials?.account || '').trim().toLowerCase();
    return account ? `legionuo.gumps.v1.${account}` : 'legionuo.gumps.v1';
  }

  loadGumpState() {
    if (this.gumpStateLoaded) return;
    this.gumpStateLoaded = true;
    try {
      const saved = JSON.parse(localStorage.getItem(this.gumpStateKey()) || 'null');
      if (!saved || typeof saved !== 'object') return;
      for (const [key, value] of Object.entries(saved)) {
        const id = Number(key) >>> 0;
        if (value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))) {
          this.gumpPositions.set(id, { x: Number(value.x), y: Number(value.y) });
        }
        if (value && Number.isFinite(Number(value.scale))) this.gumpScales.set(id, Number(value.scale));
      }
    } catch {
      /* ignore corrupt gump state */
    }
  }

  saveGumpState() {
    try {
      const out = {};
      for (const id of new Set([...this.gumpPositions.keys(), ...this.gumpScales.keys()])) {
        const position = this.gumpPositions.get(id);
        const scale = this.gumpScales.get(id);
        out[String(id)] = { ...(position || {}), ...(scale ? { scale } : {}) };
      }
      localStorage.setItem(this.gumpStateKey(), JSON.stringify(out));
    } catch {
      /* ignore quota errors */
    }
  }

  getGumpPosition(id) {
    this.loadGumpState();
    return this.gumpPositions.get(id >>> 0) || null;
  }

  rememberGumpPosition(id, x, y) {
    this.gumpPositions.set(id >>> 0, { x, y });
    this.saveGumpState();
  }

  getGumpScale(id) {
    this.loadGumpState();
    return this.gumpScales.get(id >>> 0) || 1;
  }

  rememberGumpScale(id, scale) {
    this.gumpScales.set(id >>> 0, scale);
    this.saveGumpState();
  }

  removeGump(id) {
    const key = id >>> 0;
    const gump = this.gumps.get(key);
    if (gump) this.rememberGumpPosition(key, gump.x, gump.y);
    this.gumps.delete(key);
  }

  getBlock(bx, by) {
    const key = `${this.mapIndex}|${this.useXMapFiles ? 'x' : 'm'}|${bx}|${by}`;
    const cached = this.mapCache.get(key);
    if (cached) return cached;
    if (this.mapCache.has(key)) {
      const retryAt = this.mapFailures.get(key) || 0;
      if (performance.now() < retryAt) return null;
      this.mapCache.delete(key);
    }
    this.requestBlock(bx, by);
    return null;
  }

  setMapIndex(mapIndex) {
    const mapCount = Number(this.config.mapCount) || this.config.maps?.length || 6;
    if (!Number.isFinite(mapIndex) || mapIndex < 0 || mapIndex >= mapCount) return;
    if (mapIndex === this.mapIndex) return;
    this.mapIndex = mapIndex;
    // Blocks are cached per facet, so there is no need to drop the old map.
    // Keeping it avoids a black frame while the new facet streams in.
    if (this.player) this.ensureMapAround(this.player.x, this.player.y, 4);
  }

  requestBlock(bx, by) {
    const mapIndex = this.mapIndex;
    const useX = this.useXMapFiles;
    const key = `${mapIndex}|${useX ? 'x' : 'm'}|${bx}|${by}`;
    const cached = this.mapCache.get(key);
    if (cached) return Promise.resolve(cached);
    if (this.mapCache.has(key)) {
      const retryAt = this.mapFailures.get(key) || 0;
      if (performance.now() < retryAt) return Promise.resolve(null);
      this.mapCache.delete(key);
    }
    if (!this.blockPromises) this.blockPromises = new Map();
    if (this.blockPromises.has(key)) return this.blockPromises.get(key);
    this.mapPending.add(key);
    const xQuery = useX ? '?x=1' : '';
    const promise = fetch(this.assets.url(`/api/map/${mapIndex}/${bx}/${by}${xQuery}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        data = this.uolive.applyToBlock(data, mapIndex, bx, by);
        if (data) {
          this.mapCache.set(key, data);
          this.mapFailures.delete(key);
        } else {
          this.mapCache.delete(key);
          this.mapFailures.set(key, performance.now() + 2000);
        }
        return data;
      })
      .catch(() => {
        this.mapCache.delete(key);
        this.mapFailures.set(key, performance.now() + 2000);
        return null;
      })
      .finally(() => {
        this.mapPending.delete(key);
        this.blockPromises.delete(key);
      });
    this.blockPromises.set(key, promise);
    promise.then((data) => {
      for (const cb of this.mapListeners) cb(key, data);
    });
    return promise;
  }

  async preloadRegion(minX, minY, maxX, maxY) {
    const bx0 = Math.max(0, minX >> 3);
    const by0 = Math.max(0, minY >> 3);
    const bx1 = Math.max(0, maxX >> 3);
    const by1 = Math.max(0, maxY >> 3);
    const size = this.config.maps?.[this.mapIndex];
    const maxBx = size ? (size[0] >> 3) - 1 : Infinity;
    const maxBy = size ? (size[1] >> 3) - 1 : Infinity;
    const tasks = [];
    for (let bx = bx0; bx <= Math.min(bx1, maxBx); bx++) {
      for (let by = by0; by <= Math.min(by1, maxBy); by++) {
        tasks.push(this.requestBlock(bx, by));
        if (tasks.length >= 512) break;
      }
      if (tasks.length >= 512) break;
    }
    await Promise.all(tasks);
  }

  ensureMapAround(x, y, radiusBlocks = 3) {
    const bx = x >> 3;
    const by = y >> 3;
    for (let dx = -radiusBlocks; dx <= radiusBlocks; dx++) {
      for (let dy = -radiusBlocks; dy <= radiusBlocks; dy++) {
        this.getBlock(bx + dx, by + dy);
      }
    }
  }

  isMovementBlocked() {
    if (!this.player || !this.inGame) return true;
    if (this.player.isDead && !this.player.isGhost) return true;
    if ((this.player.flags & 0x01) !== 0 || this.player.isFrozen) return true;
    if (this.stunnedUntil && performance.now() < this.stunnedUntil) return true;
    if (this.player.isStunned) return true;
    if (this.game?.ui?.isMovementBlocked?.()) return true;
    return false;
  }

  nextTile(x, y, direction) {
    const dir = direction & 7;
    let nx = x;
    let ny = y;
    if (dir === 0) ny--;
    else if (dir === 1) {
      nx++;
      ny--;
    } else if (dir === 2) nx++;
    else if (dir === 3) {
      nx++;
      ny++;
    } else if (dir === 4) ny++;
    else if (dir === 5) {
      nx--;
      ny++;
    } else if (dir === 6) nx--;
    else if (dir === 7) {
      nx--;
      ny--;
    }
    return { x: nx, y: ny };
  }

  advanceWalkSeq() {
    if (this.walkSeq === 0xff) this.walkSeq = 1;
    else this.walkSeq = (this.walkSeq + 1) & 0xff;
  }

  cancelPendingSteps() {
    this.pendingSteps = [];
    this.steps = [];
    this.nextStepTime = 0;
    if (this.player) this.player.moving = false;
  }

  resetSteps() {
    this.cancelPendingSteps();
    this.walkSeq = 0;
    this.lastStepTime = 0;
    this.lastWalkSent = 0;
  }

  snapPlayer(x, y, z, direction) {
    const player = this.player;
    if (!player) return;
    this.setEntityPosition(player, x, y, z);
    if (direction !== undefined && direction !== null) player.direction = direction & 7;
    player.moving = false;
  }

  walk(direction, run = false) {
    if (this.isMovementBlocked()) return false;
    const now = performance.now();
    if (now < this.denyCooldownUntil) return false;
    if (this.pendingSteps.length >= this.maxPendingSteps) return false;
    if (now + this.stepLead < this.nextStepTime) return false;

    const dir = direction & 7;
    const player = this.player;

    const lastStep = this.steps[this.steps.length - 1];
    const fromX = lastStep ? lastStep.toX : player.x;
    const fromY = lastStep ? lastStep.toY : player.y;
    const fromZ = lastStep ? lastStep.toZ : player.z;

    if (dir !== (player.direction & 7)) {
      player.direction = dir;
      this.socket.out.walkRequest(dir, this.walkSeq & 0xff, run);
      this.advanceWalkSeq();
      this.nextStepTime = Math.max(this.nextStepTime, now + this.turnDelay + this.stepLead);
      return false;
    }

    const next = this.nextTile(fromX, fromY, dir);
    const info = this.tileInfo(next.x, next.y);
    if (!this.game?.debug && info && !info.walkable) {
      return false;
    }

    const sequence = this.walkSeq & 0xff;
    this.socket.out.walkRequest(dir, sequence, run);
    this.advanceWalkSeq();

    const startTime = Math.max(now, this.nextStepTime);
    const duration = this.stepDuration(run);
    const toZ = info ? info.z : fromZ;
    const step = {
      sequence,
      direction: dir,
      run,
      fromX,
      fromY,
      fromZ,
      toX: next.x,
      toY: next.y,
      toZ,
      startTime,
      duration,
      serverConfirmed: false,
      completed: false,
      localOnly: false,
    };
    this.steps.push(step);
    this.pendingSteps.push(step);
    this.nextStepTime = startTime + duration;
    this.lastStepTime = now;
    this.lastWalkSent = now;

    player.x = next.x;
    player.y = next.y;
    player.z = toZ;
    player.hasPosition = true;
    player.moving = true;
    this.ensureMapAround(next.x, next.y);
    return true;
  }

  serverWalk(direction, run = false) {
    if (!this.player) return false;
    const now = performance.now();
    const dir = direction & 7;
    const player = this.player;
    player.direction = dir;
    const lastStep = this.steps[this.steps.length - 1];
    const fromX = lastStep ? lastStep.toX : player.x;
    const fromY = lastStep ? lastStep.toY : player.y;
    const fromZ = lastStep ? lastStep.toZ : player.z;
    const next = this.nextTile(fromX, fromY, dir);
    const info = this.tileInfo(next.x, next.y);
    if (info && !info.walkable) return false;

    const startTime = Math.max(now, this.nextStepTime);
    const step = {
      sequence: -1,
      direction: dir,
      run,
      fromX,
      fromY,
      fromZ,
      toX: next.x,
      toY: next.y,
      toZ: info ? info.z : fromZ,
      startTime,
      duration: this.stepDuration(run),
      serverConfirmed: true,
      completed: false,
      localOnly: true,
    };
    this.steps.push(step);
    this.nextStepTime = startTime + step.duration;
    player.x = next.x;
    player.y = next.y;
    player.z = step.toZ;
    player.hasPosition = true;
    player.moving = true;
    this.ensureMapAround(next.x, next.y);
    return true;
  }

  confirmWalk(seq, notoriety) {
    const index = this.pendingSteps.findIndex((step) => step.sequence === seq);
    if (index >= 0) {
      const [step] = this.pendingSteps.splice(index, 1);
      step.serverConfirmed = true;
    }
    if (this.player) this.player.notoriety = notoriety;
  }

  denyWalk(seq, x, y, z, direction) {
    if (!this.player) return;
    this.resetSteps();
    this.snapPlayer(x, y, z, direction);
    this.denyCooldownUntil = performance.now() + (this.player.mount ? 150 : 300);
    this.ensureMapAround(x, y);
    this.game?.cancelWalkPath?.();
    this.game?.onMovementDenied?.();
  }

  reconcilePlayerPosition(x, y, z, direction, { force = false } = {}) {
    const player = this.player;
    if (!player) return false;
    const dist = Math.abs(player.x - x) + Math.abs(player.y - y);
    const dz = Math.abs(player.z - z);
    if (!force && dist <= 2 && dz <= 2) {
      if (direction !== undefined && direction !== null) player.direction = direction & 7;
      return false;
    }
    this.resetSteps();
    this.snapPlayer(x, y, z, direction);
    this.denyCooldownUntil = performance.now() + 100;
    this.ensureMapAround(x, y);
    this.game?.cancelWalkPath?.();
    return true;
  }

  setTarget(type, cursorId, cursorType, multi = null) {
    this.target = { active: true, type, cursorId, cursorType, multi };
    this.targetEntity = null;
  }

  clearTarget() {
    this.target = { active: false, type: 0, cursorId: 0, cursorType: 0, multi: null };
    this.targetEntity = null;
  }

  /* ---- login helpers ---- */

  resetLogin() {
    this.login = { step: 'connecting', servers: [], characters: [], cities: [], error: null, characterListFlags: 0 };
  }

  setLoginStep(step) {
    this.login.step = step;
    for (const cb of this.loginListeners || []) cb(step);
  }

  onLogin(cb) {
    if (!this.loginListeners) this.loginListeners = [];
    this.loginListeners.push(cb);
  }

  resetWorld() {
    this.entities.clear();
    this.opl?.reset();
    this.player = null;
    this.playerSerial = 0;
    this.inGame = false;
    this.mapIndex = 0;
    this.useXMapFiles = false;
    this.uolive?.reset();
    this.mapCache.clear();
    this.mapFailures.clear();
    this.mapPending.clear();
    if (this.blockPromises) this.blockPromises.clear();
    this.steps = [];
    this.pendingSteps = [];
    this.stunnedUntil = 0;
    this.walkSeq = 0;
    this.lastWalkSent = 0;
    this.lastStepTime = 0;
    this.nextStepTime = 0;
    this.denyCooldownUntil = 0;
    this.lastBlockedDirection = -1;
    this.lastBlockedTurn = 0;
    this.alwaysRun = false;
    this.target = { active: false, type: 0, cursorId: 0, cursorType: 0, multi: null };
    this.gumps.clear();
    this.gumpPositions.clear();
    this.gumpStateLoaded = false;
    this.gumpScales.clear();
    this.containers.clear();
    this.openContainers.clear();
    this.buffs = [];
    this.chat = { channels: [], current: '', username: '' };
    this.trade = null;
    this.party = { members: [], leader: 0, inviter: 0, canLoot: false };
    this.skills.clear();
    this.skillList = [];
    this.statLocks = { str: 0, dex: 0, int: 0 };
    this.messages = [];
    this.weather = { type: 0, count: 0, temp: 0, particles: [] };
    this.lightTarget = { overall: 0, personal: 0 };
    this.light = { overall: 0, personal: 0, displayOverall: 0, displayPersonal: 0 };
    this.season = 0;
    this.realSeason = 0;
    this.prompt = null;
    this.questArrow = null;
    this.waypoints = [];
    this.localWaypoints = [];
    this.corpses.clear();
    this.held = null;
    this.walkTarget = null;
  }
}

