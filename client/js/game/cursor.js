const CURSOR_NORMAL_BASE = 0x206a;
const CURSOR_WAR_BASE = 0x2053;
const CURSOR_IDLE_INDEX = 9;
const CURSOR_DRAG_INDEX = 8;
const CURSOR_TARGET_INDEX = 12;
const CURSOR_MIN_DIRECTION_DISTANCE = 10;

export class GameCursor {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.assets = game.assets;
    this.canvas = document.getElementById('cursorLayer');
    this.ctx = this.canvas?.getContext('2d') || null;
    this.sprites = new Map();
    this.dpr = 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.pointerCursor = false;
    this.resize();
    for (let i = 0; i < 8; i++) this.sprite(CURSOR_NORMAL_BASE + i);
    this.sprite(CURSOR_NORMAL_BASE + CURSOR_IDLE_INDEX);
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.round(window.innerWidth));
    this.height = Math.max(1, Math.round(window.innerHeight));
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.dpr = dpr;
  }

  spriteKey(id) {
    return `${this.assets.serverId}|${id}`;
  }

  sprite(id) {
    const key = this.spriteKey(id);
    let entry = this.sprites.get(key);
    if (entry) return entry;
    entry = { canvas: null, hotX: 0, hotY: 0, failed: false };
    this.sprites.set(key, entry);

    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) {
        entry.failed = true;
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        entry.failed = true;
        return;
      }
      ctx.drawImage(img, 0, 0);
      let image;
      try {
        image = ctx.getImageData(0, 0, width, height);
      } catch {
        entry.failed = true;
        return;
      }
      const data = image.data;
      let hotX = 0;
      let hotY = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          if (!data[offset + 3]) continue;
          if (data[offset] === 0 && data[offset + 1] === 255 && data[offset + 2] === 0) {
            if (x === 0) hotY = y;
            if (y === 0) hotX = x;
            data[offset + 3] = 0;
            continue;
          }
          if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
            data[offset + 3] = 0;
          }
        }
      }
      ctx.putImageData(image, 0, 0);
      entry.canvas = canvas;
      entry.hotX = hotX;
      entry.hotY = hotY;
    };
    img.onerror = () => {
      entry.failed = true;
    };
    img.src = this.assets.url(`/api/art/static/${id}.png?hue=0&partial=0`);
    return entry;
  }

  isOverWorld(ui) {
    if (!ui || ui.pointerOverDomUi) return false;
    const { x, y } = ui.mouse;
    if (ui.hitTest(x, y)) return false;
    return document.elementFromPoint(x, y) === this.game.renderer.canvas;
  }

  directionIndex(ui) {
    const renderer = this.game.renderer;
    const dx = ui.gameMouse.x - renderer.width / 2;
    const dy = ui.gameMouse.y - renderer.height / 2;
    if (Math.hypot(dx, dy) < CURSOR_MIN_DIRECTION_DISTANCE) return CURSOR_IDLE_INDEX;
    const angle = Math.atan2(dy, dx);
    return ((Math.round((angle + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
  }

  cursorId() {
    const ui = this.game.ui;
    const war = !!this.world.player?.inWarMode;
    const base = war ? CURSOR_WAR_BASE : CURSOR_NORMAL_BASE;
    let index = CURSOR_IDLE_INDEX;
    if (this.world.target.active) index = CURSOR_TARGET_INDEX;
    else if (this.world.held || ui?.dragTarget) index = CURSOR_DRAG_INDEX;
    else if (this.isOverWorld(ui)) index = this.directionIndex(ui);
    return base + index;
  }

  readySprite(id) {
    const idle = (this.world.player?.inWarMode ? CURSOR_WAR_BASE : CURSOR_NORMAL_BASE) + CURSOR_IDLE_INDEX;
    const wanted = this.sprite(id);
    if (wanted.canvas) return wanted;
    const fallback = this.sprite(idle);
    return fallback.canvas ? fallback : null;
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.width, this.height);

    const inGame = !!this.world.inGame;
    const idle = inGame
      ? this.sprite(
          (this.world.player?.inWarMode ? CURSOR_WAR_BASE : CURSOR_NORMAL_BASE) + CURSOR_IDLE_INDEX
        )
      : null;
    const active = inGame && !!idle?.canvas;
    if (this.pointerCursor !== active) {
      this.pointerCursor = active;
      document.body.classList.toggle('uo-cursor', active);
    }
    if (!active) return;

    const sprite = this.readySprite(this.cursorId());
    if (!sprite) return;

    const { x, y } = this.game.ui.mouse;
    ctx.drawImage(sprite.canvas, Math.round(x - sprite.hotX), Math.round(y - sprite.hotY));
  }
}
