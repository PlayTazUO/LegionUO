import { UOSocket } from '../net/socket.js';
import { Outgoing } from '../net/outgoing.js';
import { Handlers } from '../net/handlers.js';
import { versionValue, buildLengthTable } from '../net/packet-length.js';
import { World } from './world.js';
import { AssetManager } from './assets.js';
import { EffectsManager } from './effects.js';
import { AudioManager } from './audio.js';
import { Renderer } from './renderer.js';
import { Gump } from './gump.js';
import { findPath } from './pathfinding.js';
import { UI } from '../ui/ui.js';
import { Reader } from '../util/binary.js';

export class Game {
  constructor(config) {
    this.config = config;
    this.debug = new URLSearchParams(location.search).has('debug');
    this.assets = new AssetManager(config);
    this.socket = new UOSocket({ clientVersion: config.clientVersion });
    this.world = new World(config, this.assets, this.socket);
    this.world.game = this;
    this.effects = new EffectsManager(this.world, this.assets);
    this.audio = new AudioManager();
    this.outgoing = new Outgoing(this.socket, config.clientVersion);
    this.socket.out = this.outgoing;
    this.handlers = new Handlers(this);
    this.renderer = new Renderer(document.getElementById('game'), this.world, this.assets, this.effects, this);
    this.ui = new UI(this);
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

  async start() {
    await this.ui.init();
    this.loadClilocs();
    requestAnimationFrame((t) => this.loop(t));
  }

  async loadClilocs() {
    try {
      const res = await fetch('/api/cliloc/all');
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
        fetch(`/api/cliloc/${id}`)
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

  connect(account, password, host, port) {
    this.loginCredentials = { account, password, host, port };
    this.world.resetWorld();
    this.world.resetLogin();
    this.ui.windows = [];
    this.pendingRelay = null;
    this.lastPingSent = 0;
    this.pingSeq = 0;
    this.socket.clientVersion = this.config.clientVersion;
    this.socket.clientVersionValue = versionValue(this.config.clientVersion);
    this.socket.lengthTable = buildLengthTable(this.config.clientVersion);
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

  disconnect(message) {
    this.world.socket.close();
    this._enteredWorld = false;
    this.ui._enteredWorld = false;
    this.world.resetWorld();
    this.ui.windows = [];
    this.held = null;
    this.cancelWalkPath();
    document.getElementById('hud').classList.add('hidden');
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
    const gump = new Gump(gumpId, sender, x || 100, y || 100, layout, lines, this.world);
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
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
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

  loop(now) {
    const dt = Math.min(50, now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (this.world.inGame && now - this.lastPingSent > 10000) {
      this.lastPingSent = now;
      this.pingSeq = (this.pingSeq + 1) & 0xff;
      this.outgoing.ping(this.pingSeq);
    }
    this.world.update(dt);
    this.effects.update(dt);
    this.updateMovement(now);
    this.renderer.draw(now);
    this.ui.draw(this.renderer.ctx, now);
    this.ui.update(now);
    if (this.world.target.type) this.drawTargetCursor();
    requestAnimationFrame((t) => this.loop(t));
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
