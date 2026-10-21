const STORAGE_KEY = 'legionuo.gameWindow.v1';
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 700;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class GameWindow {
  constructor(game, onChange) {
    this.game = game;
    this.onChange = onChange;
    this.root = document.getElementById('gameWindow');
    this.titleBar = document.getElementById('gameTitleBar');
    this.resizeHandle = document.getElementById('gameResize');
    if (!this.root || !this.titleBar || !this.resizeHandle) return;

    const saved = this.load();
    this.width = clamp(saved.width ?? DEFAULT_WIDTH, MIN_WIDTH, Math.max(MIN_WIDTH, window.innerWidth));
    this.height = clamp(saved.height ?? DEFAULT_HEIGHT, MIN_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - this.titleHeight()));
    this.x = clamp(saved.x ?? Math.round((window.innerWidth - this.width) / 2), 0, Math.max(0, window.innerWidth - this.width));
    this.y = clamp(
      saved.y ?? Math.round((window.innerHeight - this.height - this.titleHeight()) / 2),
      0,
      Math.max(0, window.innerHeight - this.height - this.titleHeight())
    );
    this.apply();
    this.bind();
  }

  titleHeight() {
    return this.titleBar?.offsetHeight || 26;
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  }

  save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x: this.x, y: this.y, width: this.width, height: this.height })
      );
    } catch {
      /* ignore quota errors */
    }
  }

  apply() {
    this.root.style.left = `${this.x}px`;
    this.root.style.top = `${this.y}px`;
    this.root.style.width = `${this.width}px`;
    this.root.style.height = `${this.height + this.titleHeight()}px`;
  }

  notify() {
    this.onChange?.();
  }

  bind() {
    this.titleBar.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();
      this.startDrag(event);
    });

    this.resizeHandle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.startResize(event);
    });

    window.addEventListener('resize', () => this.onWindowResize());
  }

  startDrag(event) {
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = this.x;
    const originY = this.y;
    this.root.classList.add('dragging');
    const move = (ev) => {
      this.x = clamp(originX + ev.clientX - startX, 0, Math.max(0, window.innerWidth - this.width));
      this.y = clamp(
        originY + ev.clientY - startY,
        0,
        Math.max(0, window.innerHeight - this.height - this.titleHeight())
      );
      this.root.style.left = `${this.x}px`;
      this.root.style.top = `${this.y}px`;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this.root.classList.remove('dragging');
      this.save();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  startResize(event) {
    const startX = event.clientX;
    const startY = event.clientY;
    const originW = this.width;
    const originH = this.height;
    this.root.classList.add('resizing');
    const move = (ev) => {
      const maxW = Math.max(MIN_WIDTH, window.innerWidth - this.x);
      const maxH = Math.max(MIN_HEIGHT, window.innerHeight - this.y - this.titleHeight());
      this.width = clamp(originW + ev.clientX - startX, Math.min(MIN_WIDTH, maxW), maxW);
      this.height = clamp(originH + ev.clientY - startY, Math.min(MIN_HEIGHT, maxH), maxH);
      this.apply();
      this.notify();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this.root.classList.remove('resizing');
      this.save();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  onWindowResize() {
    const maxW = Math.max(MIN_WIDTH, window.innerWidth);
    const maxH = Math.max(MIN_HEIGHT, window.innerHeight - this.titleHeight());
    this.width = clamp(this.width, Math.min(MIN_WIDTH, maxW), maxW);
    this.height = clamp(this.height, Math.min(MIN_HEIGHT, maxH), maxH);
    this.x = clamp(this.x, 0, Math.max(0, window.innerWidth - this.width));
    this.y = clamp(this.y, 0, Math.max(0, window.innerHeight - this.height - this.titleHeight()));
    this.apply();
    this.notify();
    this.save();
  }
}
