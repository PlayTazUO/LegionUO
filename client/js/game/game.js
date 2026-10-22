import { UOSocket } from '../net/socket.js';
import { Outgoing } from '../net/outgoing.js';
import { Handlers } from '../net/handlers.js';
import { versionValue, buildLengthTable } from '../net/packet-length.js';
import { World } from './world.js';
import { AssetManager } from './assets.js';
import { EffectsManager } from './effects.js';
import { AudioManager } from './audio.js';
import { Renderer } from './renderer.js';
import { GameCursor } from './cursor.js';
import { Gump } from './gump.js';
import { findPath } from './pathfinding.js';
import { UI } from '../ui/ui.js';
import { GameWindow } from '../ui/gameWindow.js';
import { Reader } from '../util/binary.js';
import { setRawText } from './html.js';
import { settings } from './settings.js';

const PING_INTERVAL = 1000;
const PING_SAMPLE_COUNT = 5;
const PING_TIMEOUT = 10000;

export class Game {
  constructor(config) {
    this.config = config;
    this.debug = new URLSearchParams(location.search).has('debug');
    setRawText(this.debug);
    this.assets = new AssetManager(config);
    this.assets.setDebug(this.debug);
    this.socket = new UOSocket({
      clientVersion: config.clientVersion,
      loginEncryption: config.loginEncryption,
      gameEncryption: config.gameEncryption,
    });
    this.world = new World(config, this.assets, this.socket);
    this.world.game = this;
    this.effects = new EffectsManager(this.world, this.assets);
    this.audio = new AudioManager(config);
    this.outgoing = new Outgoing(this.socket, config.clientVersion);
    this.socket.out = this.outgoing;
    this.handlers = new Handlers(this);
    this.gameWindow = new GameWindow(this, () => this.renderer?.resize());
    this.renderer = new Renderer(document.getElementById('game'), this.world, this.assets, this.effects, this);
    this.heldCanvas = document.getElementById('heldLayer');
    this.heldCtx = this.heldCanvas?.getContext('2d') || null;
    this.uiCanvas = document.getElementById('uiLayer');
    this.uiCtx = this.uiCanvas?.getContext('2d') || null;
    this.uiTopCanvas = document.getElementById('uiTopLayer');
    this.uiTopCtx = this.uiTopCanvas?.getContext('2d') || null;
    this.resizeHeldLayer();
    this.resizeUiLayer();
    this.resizeUiTopLayer();
    window.addEventListener('resize', () => {
      this.resizeHeldLayer();
      this.resizeUiLayer();
      this.resizeUiTopLayer();
      this.cursor?.resize();
    });
    this.ui = new UI(this);
    this.cursor = new GameCursor(this);
    this.held = null;
    this.clilocs = new Map();
    this.walkTarget = null;
    this.walkPath = null;
    this.walkIndex = 0;
    this.walkRequestId = 0;
    this.pathRun = false;
    this.pathLastProgress = 0;
    this.pendingRelay = null;
    this.loginCredentials = { account: '', password: '', host: '', port: 2593 };
    this.lastFrame = performance.now();
    this.pingSeq = 0;
    this.lastPingSent = 0;
    this.pingPending = new Map();
    this.pingSamples = [];
    this.ping = null;
    this.fps = 0;
    this.fpsFrames = 0;
    this.fpsWindowStart = 0;
    this.frameLimit = 0;
    this.nextFrameAt = 0;
    this.perfFpsEl = document.getElementById('perfFps');
    this.perfPingEl = document.getElementById('perfPing');
    this.warCursor = false;
    this.worldLoadingToken = 0;
    this.worldLoadingStartedAt = 0;
    this.worldLoadingMapReadyAt = 0;
    this.worldLoadingTimer = null;

    this.world.onMessage((msg) => this.ui.onMessage(msg));
    this.socket.on('packet', ({ data, header }) => this.handlers.handle(data[0], data, header));
    this.socket.on('open', () => this.onTcpOpen());
    this.socket.on('close', () => this.onTcpClose());
    this.socket.on('error', (message) => this.onSocketError(message));
  }

  get held() {
    return this.world.held;
  }

  set held(value) {
    this.world.held = value;
  }

  setDebug(enabled) {
    this.debug = !!enabled;
    setRawText(this.debug);
    this.assets.setDebug(this.debug);
  }

  async start() {
    await this.ui.init();
    this.loadClilocs();
    requestAnimationFrame((t) => this.loop(t));
  }

  async loadClilocs() {
    try {
      const res = await fetch(this.assets.url('/api/cliloc/all'));
      if (!res.ok) return;
      const obj = await res.json();
      for (const [id, text] of Object.entries(obj)) this.clilocs.set(Number(id), text);
    } catch {
      /* cliloc isn't required to play */
    }
  }

  cliloc(id, args = '') {
    let text = this.clilocs.get(id);
    if (text == null) {
      if (!this._clilocPending.has(id)) {
        this._clilocPending.add(id);
        fetch(this.assets.url(`/api/cliloc/${id}`))
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data && data.text != null) this.clilocs.set(id, data.text);
          })
          .catch(() => {})
          .finally(() => this._clilocPending.delete(id));
      }
      return null;
    }
    if (args) {
      const parts = String(args)
        .split('\t')
        .map((part) => {
          const ref = part.match(/^#(\d+)$/);
          return ref ? this.cliloc(Number(ref[1])) ?? part : part;
        });
      text = text.replace(/~(\d+)(?:_[^~]*)?~/g, (match, index) => {
        const i = parseInt(index, 10) - 1;
        return i >= 0 && i < parts.length ? parts[i] : '';
      });
    }
    return text;
  }

  get _clilocPending() {
    if (!this.__clilocPending) this.__clilocPending = new Set();
    return this.__clilocPending;
  }

  hueColor(hue) {
    return this.ui.hueColor(hue);
  }

  getAnimType(body) {
    if (body < 200) return 'high';
    if (body < 400) return 'low';
    return 'people';
  }

  async refreshAssetServer() {
    try {
      const next = await fetch('/api/config', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
      if (!next) return;
      const clientVersion = this.config.clientVersion;
      Object.assign(this.config, next, { clientVersion });
      this.ui.config = this.config;
      if (!this.assets.setConfig(this.config)) return;
      this.clilocs.clear();
      this.loadClilocs();
      this.assets.loadTileData();
      this.assets.loadEquipConv();
      const [hues, skills] = await Promise.all([
        fetch(this.assets.url('/api/hues')).then((r) => (r.ok ? r.json() : null)),
        fetch(this.assets.url('/api/skills')).then((r) => (r.ok ? r.json() : null)),
      ]).catch(() => [null, null]);
      if (hues) this.ui.hues = hues;
      if (skills) this.ui.skillInfo = skills;
    } catch {
      /* keep the current asset server config */
    }
  }

  async connect(account, password, host, port) {
    this.loginCredentials = { account, password, host, port };
    await this.refreshAssetServer();
    this.world.resetWorld();
    this.world.resetLogin();
    this.ui.closeMacros?.();
    this.ui.cancelMacroPlayback?.();
    this.ui.clearWindows?.();
    this.ui.closeContextMenu();
    this.pendingRelay = null;
    this.lastPingSent = 0;
    this.pingSeq = 0;
    this.pingPending.clear();
    this.pingSamples = [];
    this.ping = null;
    this.updatePerfDisplay();
    this.socket.clientVersion = this.config.clientVersion;
    this.socket.clientVersionValue = versionValue(this.config.clientVersion);
    this.socket.lengthTable = buildLengthTable(this.config.clientVersion);
    this.socket.loginEncryption = this.config.loginEncryption !== false;
    this.socket.gameEncryption = this.config.gameEncryption !== false;
    this.outgoing.setVersion(this.config.clientVersion);
    this.ui.setLoginStatus('Connecting...');
    this.startLoginWatchdog();
    this.socket.connect(host, port, { clientVersion: this.config.clientVersion }).then((ok) => {
      if (!ok) {
        this.clearLoginWatchdog();
        this.ui.showLoginError('Could not open the proxy WebSocket. Is the asset server running?');
      }
    });
  }

  startLoginWatchdog() {
    this.clearLoginWatchdog();
    this.loginWatchdog = setTimeout(() => {
      this.loginWatchdog = null;
      if (this.world.inGame) return;
      const step = this.world.login.step;
      if (step === 'servers' || step === 'characters' || step === 'error') return;
      this.ui.showLoginError('Login timed out. Check the host, port, client version, and that the shard is reachable.');
    }, 10000);
  }

  clearLoginWatchdog() {
    if (this.loginWatchdog) {
      clearTimeout(this.loginWatchdog);
      this.loginWatchdog = null;
    }
  }

  onTcpOpen() {
    if (this.pendingRelay) {
      const { seed } = this.pendingRelay;
      this.pendingRelay = null;
      this.socket.initializeGameEncryption(seed);
      this.socket.enableCompression();
      this.socket.send(
        new Uint8Array([(seed >>> 24) & 0xff, (seed >>> 16) & 0xff, (seed >>> 8) & 0xff, seed & 0xff]),
        { skipEncryption: true }
      );
      this.outgoing.secondLogin(this.loginCredentials.account, this.loginCredentials.password, seed);
      this.ui.setLoginStatus('Entering world...');
      return;
    }

    this.socket.initializeLoginEncryption(0x0100007f);
    const parts = String(this.config.clientVersion)
      .replace(/,/g, '.')
      .split('.')
      .map((x) => parseInt(x, 10) || 0);
    this.outgoing.seed(0x0100007f, parts[0] || 7, parts[1] || 0, parts[2] || 0, parts[3] || 0);
    this.outgoing.firstLogin(this.loginCredentials.account, this.loginCredentials.password);
    this.ui.setLoginStatus('Verifying account...');
  }

  relay(host, port, seed) {
    this.world.login.step = 'relay';
    this.ui.setLoginStatus('Connecting to game server...');
    this.startLoginWatchdog();
    this.pendingRelay = { host, port, seed };
    this.socket.reconnectTCP(host, port);
  }

  onTcpClose() {
    if (this.debug) console.warn('[net] TCP closed');
    this.clearLoginWatchdog();
    if (this.world.inGame) {
      this.disconnect('Connection to server lost.');
    } else if (!this.pendingRelay) {
      this.ui.setLoginStatus(this.world.login.error || 'Disconnected from server.');
      this.ui.showLoginError(this.world.login.error || 'Disconnected from server.');
    }
  }

  onSocketError(message) {
    this.clearLoginWatchdog();
    if (this.world.inGame) {
      this.world.addMessage(message, 0x22, 1, 'System');
    } else {
      this.ui.showLoginError(message);
    }
  }

  enterWorld() {
    this.clearLoginWatchdog();
    this.ui.enterWorld();
    this.showWorldLoading();
    this.world.ensureMapAround(this.world.player.x, this.world.player.y, 4);
    const player = this.world.player;
    if (player) {
      this.outgoing.gameWindowSize(this.renderer.width, this.renderer.height);
      this.outgoing.language('ENU');
      this.outgoing.clientVersion(this.config.clientVersion);
      this.outgoing.singleClick(player.serial);
      this.outgoing.skillsRequest(player.serial);
      this.outgoing.statusRequest(player.serial);
    }
  }

  showWorldLoading() {
    const token = ++this.worldLoadingToken;
    this.worldLoadingStartedAt = performance.now();
    this.worldLoadingMapReadyAt = 0;
    if (this.worldLoadingTimer) {
      clearTimeout(this.worldLoadingTimer);
      this.worldLoadingTimer = null;
    }
    const overlay = document.getElementById('worldLoading');
    if (overlay) overlay.classList.remove('hidden');
    this.setWorldLoadingDetail('Contacting shard...');
    this.pollWorldLoading(token);
  }

  hideWorldLoading() {
    this.worldLoadingToken++;
    this.worldLoadingMapReadyAt = 0;
    if (this.worldLoadingTimer) {
      clearTimeout(this.worldLoadingTimer);
      this.worldLoadingTimer = null;
    }
    const overlay = document.getElementById('worldLoading');
    if (overlay) overlay.classList.add('hidden');
  }

  setWorldLoadingDetail(text) {
    const detail = document.getElementById('worldLoadingDetail');
    if (detail) detail.textContent = text || '';
  }

  pollWorldLoading(token) {
    if (token !== this.worldLoadingToken) return;
    this.worldLoadingTimer = null;
    const player = this.world.player;
    if (!player) {
      this.hideWorldLoading();
      return;
    }

    const radius = 3;
    const bx = player.x >> 3;
    const by = player.y >> 3;
    const size = this.config.maps?.[this.world.mapIndex];
    const maxBx = size ? (size[0] >> 3) - 1 : Infinity;
    const maxBy = size ? (size[1] >> 3) - 1 : Infinity;
    let total = 0;
    let loaded = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const tx = bx + dx;
        const ty = by + dy;
        if (tx < 0 || ty < 0 || tx > maxBx || ty > maxBy) continue;
        total++;
        if (this.world.isBlockLoaded(tx, ty)) loaded++;
      }
    }

    const now = performance.now();
    const elapsed = now - this.worldLoadingStartedAt;
    const mapsPending = this.world.mapPending.size;
    const mapsReady = mapsPending === 0 && loaded >= total;
    if (mapsReady) {
      if (!this.worldLoadingMapReadyAt) this.worldLoadingMapReadyAt = now;
    } else {
      this.worldLoadingMapReadyAt = 0;
    }

    const artPending = this.assets.pendingImageCount();
    const mapSettled = this.worldLoadingMapReadyAt && now - this.worldLoadingMapReadyAt >= 200;
    if ((mapSettled && artPending === 0 && elapsed >= 350) || elapsed > 15000) {
      // Clear the initial player animation prefetch as well; it is usually
      // the last thing still streaming in after the map blocks arrive.
      this.hideWorldLoading();
      return;
    }

    if (!mapsReady) {
      this.setWorldLoadingDetail(`Loading map ${loaded}/${total}...`);
    } else if (artPending > 0) {
      this.setWorldLoadingDetail(`Loading art (${artPending} remaining)...`);
    } else {
      this.setWorldLoadingDetail('Finalizing...');
    }
    this.worldLoadingTimer = setTimeout(() => this.pollWorldLoading(token), 100);
  }

  disconnect(message) {
    this.hideWorldLoading();
    this.world.socket.close();
    this._enteredWorld = false;
    this.ui._enteredWorld = false;
    this.world.resetWorld();
    this.ui.closeMacros?.();
    this.ui.cancelMacroPlayback?.();
    this.ui.clearWindows?.();
    this.ui.closeContextMenu();
    this.ui.clearGumpFocus();
    this.held = null;
    this.cancelWalkPath();
    document.getElementById('hud').classList.add('hidden');
    this.ui.journal?.hide(false);
    const login = document.getElementById('loginScreen');
    login.classList.remove('hidden');
    login.style.display = 'flex';
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('serverList').classList.add('hidden');
    document.getElementById('charList').classList.add('hidden');
    this.ui.setLoginStatus(message || 'Disconnected.');
    if (message) this.ui.addJournal(message, '#c56a4a', true);
  }

  openGump(sender, gumpId, x, y, layout, lines) {
    if (!layout) return;
    const key = gumpId >>> 0;
    const existing = this.world.gumps.get(key);
    if (existing && existing.sender === (sender >>> 0)) {
      this.ui.clearGumpFocus(existing);
      existing.setLayout(layout, lines);
      this.world.addGump(existing);
      this.ui.openGump(existing);
      return;
    }
    const saved = this.world.getGumpPosition(gumpId);
    const gx = saved ? saved.x : x || 100;
    const gy = saved ? saved.y : y || 100;
    const gump = new Gump(gumpId, sender, gx, gy, layout, lines, this.world);
    if (!saved) this.world.rememberGumpPosition(gumpId, gx, gy);
    this.world.addGump(gump);
    this.ui.openGump(gump);
  }

  async openCompressedGump(r) {
    try {
      const sender = r.readU32BE();
      const gumpId = r.readU32BE();
      const x = r.readU32BE();
      const y = r.readU32BE();
      const rawLen = r.readU32BE();
      if (rawLen < 4) return;
      const compressedLen = rawLen - 4;
      const decompressedLen = r.readU32BE();
      const compressed = r.readBytes(compressedLen);
      const layoutBytes = await inflateZlib(compressed);
      const layout = new TextDecoder('utf-8').decode(layoutBytes.subarray(0, decompressedLen));
      const lines = [];
      const lineCount = r.readU32BE();
      if (lineCount !== 0) {
        const lineRawLen = r.readU32BE();
        if (lineRawLen < 4) return;
        const lineCompressedLen = lineRawLen - 4;
        const lineDecompressedLen = r.readU32BE();
        const lineBytes = await inflateZlib(r.readBytes(lineCompressedLen));
        const lr = new Reader(lineBytes.subarray(0, lineDecompressedLen));
        for (let i = 0; i < lineCount; i++) {
          if (lr.remaining() < 2) {
            lines.push('');
            continue;
          }
          const len = lr.readU16BE();
          lines.push(len > 0 ? lr.readUnicodeBE(len * 2) : '');
        }
      }
      this.openGump(sender, gumpId, x, y, layout, lines);
    } catch (err) {
      console.error('[gump] failed to decompress', err);
    }
  }

  async walkTo(x, y) {
    if (!this.world.player) return;
    const requestId = ++this.walkRequestId;
    this.walkPath = null;
    this.walkIndex = 0;
    this.walkTarget = { x, y };
    const player = this.world.player;
    if (this.debug) {
      this.walkPath = [{ x, y }];
      this.walkIndex = 0;
      this.pathRun = Math.abs(x - player.x) + Math.abs(y - player.y) > 4;
      this.pathLastProgress = performance.now();
      return;
    }
    const path = await findPath(this.world, player.x, player.y, x, y);
    if (requestId !== this.walkRequestId || !this.world.player) return;
    if (!path) {
      this.walkTarget = null;
      return;
    }
    if (!path.length) {
      this.walkTarget = null;
      return;
    }
    this.walkPath = path;
    this.walkIndex = 0;
    this.pathRun = Math.abs(x - player.x) + Math.abs(y - player.y) > 4;
    this.pathLastProgress = performance.now();
  }

  cancelWalkPath() {
    this.walkPath = null;
    this.walkTarget = null;
    this.walkIndex = 0;
    this.walkRequestId++;
  }

  onMovementDenied() {
    this.cancelWalkPath();
  }

  createWeather(type, count, temp) {
    const particles = [];
    const n = Math.max(10, Math.min(400, count * 30));
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * (this.renderer.width + 100) - 50,
        y: Math.random() * this.renderer.height,
        vx: type === 1 ? -60 : Math.random() * 20 - 10,
        vy: type === 1 ? 320 : 20 + Math.random() * 40,
        life: 2 + Math.random() * 3,
      });
    }
    this.world.weather.particles = particles;
  }

  updateMovement(now) {
    if (!this.world.inGame || !this.world.player) return;
    if (this.world.isMovementBlocked()) return;
    const input = this.ui?.getMovementInput?.();
    if (input) {
      if (this.walkPath || this.walkTarget) this.cancelWalkPath();
      this.world.walk(input.direction, input.run);
      return;
    }
    this.updateWalkPath(now);
  }

  updateWalkPath(now) {
    if (!this.walkPath || !this.world.player) return;
    const p = this.world.player;
    while (this.walkIndex < this.walkPath.length) {
      const node = this.walkPath[this.walkIndex];
      if (node.x === p.x && node.y === p.y) this.walkIndex++;
      else break;
    }
    if (this.walkIndex >= this.walkPath.length) {
      this.walkPath = null;
      this.walkTarget = null;
      return;
    }
    const node = this.walkPath[this.walkIndex];
    const dx = node.x - p.x;
    const dy = node.y - p.y;
    if (!this.debug && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
      const target = this.walkTarget;
      if (target) this.walkTo(target.x, target.y);
      else this.cancelWalkPath();
      return;
    }
    let dir = 0;
    if (dx > 0 && dy > 0) dir = 3;
    else if (dx > 0 && dy < 0) dir = 1;
    else if (dx < 0 && dy > 0) dir = 5;
    else if (dx < 0 && dy < 0) dir = 7;
    else if (dx > 0) dir = 2;
    else if (dx < 0) dir = 6;
    else if (dy > 0) dir = 4;
    else if (dy < 0) dir = 0;
    if (this.world.walk(dir, this.pathRun)) {
      this.pathLastProgress = now;
    } else if (now - this.pathLastProgress > 2000) {
      this.cancelWalkPath();
    }
  }

  measureFps(now) {
    if (!this.fpsWindowStart) {
      this.fpsWindowStart = now;
      this.fpsFrames = 0;
      return;
    }
    this.fpsFrames++;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed < 500) return;
    this.fps = Math.round((this.fpsFrames * 1000) / elapsed);
    this.fpsFrames = 0;
    this.fpsWindowStart = now;
    this.updatePerfDisplay();
  }

  sendPing(now) {
    this.lastPingSent = now;
    this.pingSeq = (this.pingSeq + 1) & 0xff;
    this.pingPending.set(this.pingSeq, now);
    for (const [seq, sentAt] of this.pingPending) {
      if (now - sentAt > PING_TIMEOUT) this.pingPending.delete(seq);
    }
    this.outgoing.ping(this.pingSeq);
  }

  onPingResponse(seq) {
    let sentAt = this.pingPending.get(seq);
    if (sentAt == null) {
      for (const pendingAt of this.pingPending.values()) {
        if (sentAt == null || pendingAt > sentAt) sentAt = pendingAt;
      }
      this.pingPending.clear();
    } else {
      this.pingPending.delete(seq);
    }
    if (sentAt == null) return;
    const elapsed = performance.now() - sentAt;
    if (elapsed < 0 || elapsed > 60000) return;
    this.pingSamples.push(elapsed);
    if (this.pingSamples.length > PING_SAMPLE_COUNT) this.pingSamples.shift();
    const sorted = [...this.pingSamples].sort((a, b) => a - b);
    this.ping = Math.round(sorted[(sorted.length - 1) >> 1]);
    this.updatePerfDisplay();
  }

  updatePerfDisplay() {
    if (this.perfFpsEl) this.perfFpsEl.textContent = `FPS ${this.fps || '--'}`;
    if (!this.perfPingEl) return;
    this.perfPingEl.textContent = `Ping ${this.ping == null ? '--' : `${this.ping}ms`}`;
    this.perfPingEl.classList.toggle('good', this.ping != null && this.ping < 100);
    this.perfPingEl.classList.toggle('warn', this.ping != null && this.ping >= 100 && this.ping < 250);
    this.perfPingEl.classList.toggle('bad', this.ping != null && this.ping >= 250);
  }

  shouldSkipFrame(now) {
    const limit = Math.max(0, Number(settings.get('frameLimit')) || 0);
    if (!limit) {
      this.frameLimit = 0;
      this.nextFrameAt = 0;
      return false;
    }
    if (this.frameLimit !== limit) {
      this.frameLimit = limit;
      this.nextFrameAt = now + 1000 / limit;
      return false;
    }
    if (now + 0.5 < this.nextFrameAt) return true;
    this.nextFrameAt += 1000 / limit;
    if (this.nextFrameAt <= now) this.nextFrameAt = now + 1000 / limit;
    return false;
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    if (this.shouldSkipFrame(now)) return;
    const dt = Math.min(50, now - this.lastFrame) / 1000;
    this.lastFrame = now;
    this.measureFps(now);
    if (this.world.inGame && (this.lastPingSent === 0 || now - this.lastPingSent > PING_INTERVAL)) {
      this.sendPing(now);
    }
    this.world.update(dt);
    this.effects.update(dt);
    this.updateMovement(now);
    this.updateWarCursor();
    this.renderer.draw(now);
    this.drawUiOverlay(now);
    this.ui.update(now);
    if (this.world.target.active) this.drawTargetCursor();
    this.drawHeldOverlay();
    this.cursor.draw();
  }

  resizeLayer(canvas, layer) {
    if (!canvas) return null;
    const width = Math.max(1, Math.round(window.innerWidth));
    const height = Math.max(1, Math.round(window.innerHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    layer.dpr = dpr;
    layer.width = width;
    layer.height = height;
    return layer;
  }

  resizeHeldLayer() {
    if (!this.heldCanvas || !this.heldCtx) return;
    this.heldLayer = this.resizeLayer(this.heldCanvas, this.heldLayer || {});
    this.heldDpr = this.heldLayer?.dpr || 1;
    this.heldWidth = this.heldLayer?.width || window.innerWidth;
    this.heldHeight = this.heldLayer?.height || window.innerHeight;
  }

  resizeUiLayer() {
    if (!this.uiCanvas || !this.uiCtx) return;
    this.uiLayer = this.resizeLayer(this.uiCanvas, this.uiLayer || {});
    this.uiDpr = this.uiLayer?.dpr || 1;
    this.uiWidth = this.uiLayer?.width || window.innerWidth;
    this.uiHeight = this.uiLayer?.height || window.innerHeight;
  }

  resizeUiTopLayer() {
    if (!this.uiTopCanvas || !this.uiTopCtx) return;
    this.uiTopLayer = this.resizeLayer(this.uiTopCanvas, this.uiTopLayer || {});
    this.uiTopDpr = this.uiTopLayer?.dpr || 1;
    this.uiTopWidth = this.uiTopLayer?.width || window.innerWidth;
    this.uiTopHeight = this.uiTopLayer?.height || window.innerHeight;
  }

  drawUiOverlay(now) {
    if (!this.uiCtx) return;
    this.uiCtx.setTransform(this.uiDpr, 0, 0, this.uiDpr, 0, 0);
    this.uiCtx.clearRect(0, 0, this.uiWidth, this.uiHeight);
    if (this.uiTopCtx) {
      this.uiTopCtx.setTransform(this.uiTopDpr, 0, 0, this.uiTopDpr, 0, 0);
      this.uiTopCtx.clearRect(0, 0, this.uiTopWidth, this.uiTopHeight);
    }
    this.ui.draw(this.uiCtx, now, this.uiTopCtx);
  }

  drawHeldOverlay() {
    if (!this.heldCtx) return;
    this.heldCtx.setTransform(this.heldDpr, 0, 0, this.heldDpr, 0, 0);
    this.heldCtx.clearRect(0, 0, this.heldWidth, this.heldHeight);
    const rect = this.renderer.canvas.getBoundingClientRect();
    this.heldCtx.translate(rect.left, rect.top);
    this.renderer.drawHeld(this.heldCtx);
  }

  updateWarCursor() {
    const war = !!this.world.player?.inWarMode;
    if (war === this.warCursor) return;
    this.warCursor = war;
    this.renderer.canvas.classList.toggle('war-mode', war);
  }

  drawTargetCursor() {
    const ctx = this.renderer.ctx;
    const m = this.renderer.mouse;
    ctx.save();
    ctx.strokeStyle = '#e8c34a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 10, 0, Math.PI * 2);
    ctx.moveTo(m.x - 16, m.y);
    ctx.lineTo(m.x - 4, m.y);
    ctx.moveTo(m.x + 4, m.y);
    ctx.lineTo(m.x + 16, m.y);
    ctx.moveTo(m.x, m.y - 16);
    ctx.lineTo(m.x, m.y - 4);
    ctx.moveTo(m.x, m.y + 4);
    ctx.lineTo(m.x, m.y + 16);
    ctx.stroke();
    ctx.restore();
  }
}

async function inflateZlib(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not supported by this browser');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
