import { Gump } from '../game/gump.js';
import { hasUoHtmlMarkup, uoHtmlFragment, appendServerText } from '../game/html.js';
import {
  ContainerWindow,
  PaperdollWindow,
  ShopWindow,
  BookWindow,
  ProfileWindow,
  StatusWindow,
  DebugGumpWindow,
} from '../game/windows.js';
import { Layer } from '../game/entity.js';
import { Reader } from '../util/binary.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.windows = [];
    this.mouseWalk = false;
    this.promptMode = false;
    this.chatHistory = [];
    this.chatIndex = -1;
    this.hues = null;
    this.skillInfo = null;
    this.lastStatusRefresh = 0;
    this.mouse = { x: 0, y: 0 };
    this.tooltipEl = $('tooltip');
    this.hoverId = null;
    this.hoverSerial = 0;
    this.hoverSince = 0;
    this.tooltipContentKey = '';
    this.gumpDebugWindow = null;
    this.bind();
  }

  bind() {
    $('connectBtn').addEventListener('click', () => this.connect());
    const showPass = $('showPass');
    if (showPass) {
      showPass.addEventListener('change', () => {
        $('password').type = showPass.checked ? 'text' : 'password';
      });
    }
    $('password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.connect();
    });
    $('sendBtn').addEventListener('click', () => this.sendChat());
    $('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendChat();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.historyStep(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.historyStep(1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        $('chatInput').value = '';
        $('chatInput').blur();
        this.promptMode = false;
        this.updatePrompt();
      }
    });

    $('btnBackpack').addEventListener('click', () => {
      const player = this.world.player;
      const backpack =
        player?.getItem(Layer.Backpack) ||
        [...(player?.items.values() || [])].find((item) => item.layer === Layer.Backpack);
      if (backpack) this.world.socket.out.doubleClick(backpack.serial);
    });
    $('btnPaperdoll').addEventListener('click', () => {
      if (this.world.player) this.world.socket.out.doubleClick(this.world.playerSerial);
    });
    $('btnSkills').addEventListener('click', () => {
      $('skillsPanel').classList.toggle('hidden');
      this.refreshSkills();
    });
    $('btnWar').addEventListener('click', () => {
      if (!this.world.player) return;
      const state = !this.world.player.inWarMode;
      this.world.player.inWarMode = state;
      this.world.socket.out.warMode(state);
      $('btnWar').textContent = state ? 'WAR' : 'PEACE';
    });
    $('btnStatus').addEventListener('click', () => this.showStatus());
    $('btnLogout').addEventListener('click', () => {
      this.world.socket.out.logoutNotification();
      setTimeout(() => this.game.disconnect('Logged out'), 250);
    });

    $('modalCancel').addEventListener('click', () => this.hideModal());
    $('modalOk').addEventListener('click', () => {
      const cb = this.modalOk;
      this.hideModal();
      cb?.();
    });
    $('modalBackdrop').addEventListener('mousedown', (e) => {
      if (e.target === $('modalBackdrop')) this.hideModal();
    });

    const canvas = $('game');
    canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    canvas.addEventListener('mouseleave', () => this.hideTooltip());
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.world.target.type) {
        this.world.clearTarget();
        this.onTargetChanged();
        return;
      }
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        const hit = this.hitTest(e.clientX, e.clientY);
        if (hit?.obj.scroll !== undefined) {
          hit.obj.scroll = Math.max(0, hit.obj.scroll + (e.deltaY > 0 ? 46 : -46));
          e.preventDefault();
        }
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.stopMouseWalk();
    });
    window.addEventListener('blur', () => {
      this.keyDir = {};
      this.shiftDown = false;
      this.stopMouseWalk();
    });
  }

  async init() {
    try {
      const [config, hues, skills] = await Promise.all([
        fetch('/api/config').then((r) => r.json()),
        fetch('/api/hues').then((r) => r.json()),
        fetch('/api/skills').then((r) => r.json()),
      ]);
      this.config = config;
      this.hues = hues;
      this.skillInfo = skills;
      this.game.config = Object.assign(this.game.config, config);
      if ($('clientVersion')) $('clientVersion').value = config.clientVersion || '7.0.116.0';
      if (config.defaultLoginHost && !$('host').value) $('host').value = config.defaultLoginHost;
      const saved = this.loadSavedLogin();
      if (saved) {
        $('host').value = saved.host || $('host').value;
        $('port').value = saved.port || $('port').value;
        if ($('clientVersion') && saved.version) $('clientVersion').value = saved.version;
        if (saved.remember) {
          if (saved.account) $('account').value = saved.account;
          if (saved.password) $('password').value = saved.password;
          if ($('rememberLogin')) $('rememberLogin').checked = true;
        }
      }
      this.game.assets.loadTileData();
      const meta = $('assetMeta');
      if (meta) {
        const f = config.files || {};
        const art = f.art ? (f.artUop ? 'UOP' : 'MUL') : 'NOT FOUND';
        const gumps = f.gumps ? (f.gumpUop ? 'UOP' : 'MUL') : 'NOT FOUND';
        const anim = f.anim ? (f.animUop ? 'UOP' : 'MUL') : 'NOT FOUND';
        const map = f.map0 ? 'ok' : 'NOT FOUND';
        meta.textContent = `UO data: ${config.uoDir || 'not configured'} · art: ${art} · gumps: ${gumps} · anim: ${anim} · map: ${map}`;
        meta.title = Object.entries(config.paths || {})
          .map(([k, v]) => `${k}: ${v || 'not found'}`)
          .join('\n');
        if (!f.art || !f.gumps) {
          meta.textContent += ' — check config.json uoDir / restart the server';
        }
      }
      if (config.defaultLoginHost && !$('host').value) $('host').value = config.defaultLoginHost;
    } catch (err) {
      this.setLoginStatus(`Could not reach asset server: ${err.message}`);
    }
  }

  hueColor(hue) {
    if (!this.hues) return '#e8e0c8';
    if (!hue) return '#e8e0c8';
    if (hue > 0 && hue <= this.hues.text.length) {
      const v = this.hues.text[hue - 1];
      return `#${(v & 0xffffff).toString(16).padStart(6, '0')}`;
    }
    const r = Math.round((((hue >> 10) & 0x1f) * 255) / 31);
    const g = Math.round((((hue >> 5) & 0x1f) * 255) / 31);
    const b = Math.round(((hue & 0x1f) * 255) / 31);
    return `rgb(${r},${g},${b})`;
  }

  /* ----------------------------- login ----------------------------- */

  loadSavedLogin() {
    try {
      return (
        JSON.parse(localStorage.getItem('legionuo.login.v3') || 'null') ||
        JSON.parse(localStorage.getItem('legionuo.login.v2') || 'null')
      );
    } catch {
      return null;
    }
  }

  saveLogin(data) {
    try {
      localStorage.setItem('legionuo.login.v3', JSON.stringify(data));
      localStorage.removeItem('legionuo.login.v2');
    } catch {
      /* ignore */
    }
  }

  setLoginStatus(text) {
    const el = $('loginStatus');
    if (el) el.textContent = text || '';
  }

  connect() {
    const account = $('account').value.trim();
    const password = $('password').value;
    const host = $('host').value.trim() || this.config?.defaultLoginHost || '127.0.0.1';
    const port = parseInt($('port').value, 10) || 2593;
    const version = ($('clientVersion')?.value || this.config?.clientVersion || '7.0.116.0').trim();
    if (!account || !password) {
      this.setLoginStatus('Enter an account and password.');
      return;
    }
    this.config.clientVersion = version;
    this.game.config.clientVersion = version;
    const remember = !!$('rememberLogin')?.checked;
    this.saveLogin(
      remember
        ? { account, password, host, port: String(port), version, remember: true }
        : { host, port: String(port), version, remember: false }
    );
    this.setLoginStatus(`Connecting with client ${version}...`);
    $('loginForm').classList.add('hidden');
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    this.game.connect(account, password, host, port);
  }

  showServers(servers) {
    $('loginForm').classList.add('hidden');
    $('serverList').classList.remove('hidden');
    $('charList').classList.add('hidden');
    const list = $('serverList');
    list.innerHTML = '';
    if (!servers.length) {
      this.showLoginError('The login server returned an empty server list.');
      return;
    }
    for (const s of servers) {
      const b = document.createElement('button');
      const name = document.createElement('span');
      name.className = 'serverName';
      appendServerText(name, s.name || `Server ${s.index}`);
      const meta = document.createElement('span');
      meta.className = 'serverMeta';
      meta.textContent = s.percentFull ? `${s.percentFull}%` : '';
      b.append(name, meta);
      b.addEventListener('click', () => {
        this.setLoginStatus(`Joining ${s.name}...`);
        list.classList.add('hidden');
        this.world.login.serverIndex = s.index;
        this.world.login.step = 'relay';
        this.game.startLoginWatchdog();
        this.world.socket.out.selectServer(s.index);
      });
      list.appendChild(b);
    }
  }

  showCharacters(chars, cities) {
    $('loginForm').classList.add('hidden');
    $('serverList').classList.add('hidden');
    $('charList').classList.remove('hidden');
    const list = $('charList');
    list.innerHTML = '';
    if (!chars.length) {
      const p = document.createElement('div');
      p.className = 'status';
      p.textContent = 'No characters on this account.';
      list.appendChild(p);
    }
    chars.forEach((name, index) => {
      if (!name) return;
      const b = document.createElement('button');
      appendServerText(b, name);
      b.addEventListener('click', () => {
        this.setLoginStatus('Entering world...');
        this.world.login.step = 'entering';
        list.classList.add('hidden');
        this.game.startLoginWatchdog();
        this.world.socket.out.selectCharacter(index, name, 0x0100007f);
      });
      list.appendChild(b);
    });
    if (chars.filter(Boolean).length < 5) {
      const create = document.createElement('button');
      create.textContent = 'Create character';
      create.addEventListener('click', () => this.showCreateCharacter(cities));
      list.appendChild(create);
    }

    const back = document.createElement('button');
    back.textContent = 'Back to servers';
    back.addEventListener('click', () => {
      this.world.login.step = 'servers';
      this.showServers(this.world.login.servers);
    });
    list.appendChild(back);
  }


  showCreateCharacter(cities = []) {
    const cityOptions = (cities.length ? cities : [{ index: 0, name: 'Britain' }])
      .map((c) => `<option value="${c.index}">${escapeHtml(c.name || `City ${c.index}`)}</option>`)
      .join('');
    const html = `
      <div style="display:grid;gap:8px;font-size:13px">
        <label>Name <input id="ccName" maxlength="30" value="New Adventurer"></label>
        <label>Gender <select id="ccGender"><option value="0">Male</option><option value="1">Female</option></select></label>
        <label>Race <select id="ccRace"><option value="1">Human</option><option value="2">Elf</option><option value="3">Gargoyle</option></select></label>
        <div style="display:flex;gap:8px">
          <label>Str <input id="ccStr" type="number" min="10" max="60" value="45"></label>
          <label>Dex <input id="ccDex" type="number" min="10" max="60" value="35"></label>
          <label>Int <input id="ccInt" type="number" min="10" max="60" value="10"></label>
        </div>
        <label>City <select id="ccCity">${cityOptions}</select></label>
      </div>`;
    this.showModal('Create Character', html, () => {
      const name = document.getElementById('ccName').value.trim() || 'New Adventurer';
      const female = document.getElementById('ccGender').value === '1';
      const race = parseInt(document.getElementById('ccRace').value, 10) || 1;
      const str = parseInt(document.getElementById('ccStr').value, 10) || 45;
      const dex = parseInt(document.getElementById('ccDex').value, 10) || 35;
      const int = parseInt(document.getElementById('ccInt').value, 10) || 10;
      const cityIndex = parseInt(document.getElementById('ccCity').value, 10) || 0;
      this.world.socket.out.createCharacter({
        name,
        female,
        race,
        strength: str,
        dexterity: dex,
        intelligence: int,
        cityIndex,
        skills: [[43, 50], [1, 50], [45, 50], [26, 50], [25, 50]],
      });
      this.setLoginStatus('Creating character...');
    }, true);
  }

  showLoginError(message) {
    this.setLoginStatus(message);
    const login = $('loginScreen');
    login.classList.remove('hidden');
    login.style.display = 'flex';
    $('loginForm').classList.remove('hidden');
    $('serverList').classList.add('hidden');
    $('charList').classList.add('hidden');
  }

  enterWorld() {
    const login = $('loginScreen');
    login.classList.add('hidden');
    login.style.display = 'none';
    $('hud').classList.remove('hidden');
    if (!this._enteredWorld) {
      this._enteredWorld = true;
      this.addJournal('Welcome to LegionUO.', '#d6b45d', true);
    }
    this.refreshStatus();
    this.refreshSkills();
    this.showStatus();
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    $('btnWar').textContent = this.world.player?.inWarMode ? 'WAR' : 'PEACE';
  }

  /* ----------------------------- HUD ----------------------------- */

  refreshStatus() {
    const p = this.world.player;
    if (!p) return;
    $('btnWar').textContent = p.inWarMode ? 'WAR' : 'PEACE';
  }

  refreshSkills() {
    const panel = $('skillsPanel');
    if (panel.classList.contains('hidden')) return;
    const list = this.skillInfo?.length ? this.skillInfo : this.world.skillList;
    if (!list) return;
    panel.innerHTML = '<div class="skillRow"><b>Skill</b><b>Value</b></div>';
    for (const skill of list) {
      const current = this.world.skills.get(skill.index) || {};
      const row = document.createElement('div');
      row.className = 'skillRow';
      const name = document.createElement('span');
      name.textContent = skill.name;
      const value = document.createElement('span');
      value.className = current.lock === 1 ? 'locked' : '';
      value.textContent = ((current.value || 0) / 10).toFixed(1);
      row.append(name, value);
      panel.appendChild(row);
    }
  }

  showStatus() {
    if (!this.world.player) return;
    const entry = this.windows.find((w) => w.kind === 'status');
    if (entry) {
      this.windows = this.windows.filter((w) => w !== entry);
      this.windows.push(entry);
      return;
    }
    this.addWindow('status', 'player', new StatusWindow(this.world));
  }

  closeStatus() {
    this.removeWindow('status', 'player');
  }

  addJournal(text, color = '#e2d6b4', isSystem = false) {
    const journal = $('journal');
    if (!journal) return;
    const nearBottom = journal.scrollHeight - journal.scrollTop - journal.clientHeight < 40;
    const div = document.createElement('div');
    div.className = `msg${isSystem ? ' system' : ''}`;
    div.style.color = color;
    if (hasUoHtmlMarkup(text)) {
      div.append(uoHtmlFragment(text, { defaultColor: color }));
      div.addEventListener('click', (event) => {
        const link = event.target.closest?.('[data-href]');
        if (!link) return;
        const href = link.dataset.href || '';
        if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
      });
    } else {
      div.textContent = text;
    }
    journal.appendChild(div);
    while (journal.children.length > 500) journal.removeChild(journal.firstChild);
    if (nearBottom) journal.scrollTop = journal.scrollHeight;
  }

  onMessage(msg) {
    const name = msg.name && msg.name.toLowerCase() !== 'system' ? `${msg.name}: ` : '';
    this.addJournal(`${name}${msg.text}`, this.hueColor(msg.hue), msg.type === 1);
  }

  sendChat() {
    const input = $('chatInput');
    const text = input.value;
    input.value = '';
    input.blur();
    if (!text) return;
    if (this.promptMode && this.world.prompt) {
      if (this.world.prompt.type === 'unicode') {
        this.world.socket.out.unicodePromptResponse(this.world.prompt.data, text, 'ENU', false);
      } else {
        this.world.socket.out.asciiPromptResponse(this.world.prompt.data, text, false);
      }
      this.world.prompt = null;
      this.promptMode = false;
      this.updatePrompt();
      return;
    }
    this.chatHistory.push(text);
    this.chatIndex = this.chatHistory.length;
    if (text.startsWith('-')) {
      this.command(text);
      return;
    }
    this.world.socket.out.unicodeSpeech(text, 0, 3, 0x3b2, 'ENU');
  }

  historyStep(delta) {
    if (!this.chatHistory.length) return;
    this.chatIndex = Math.max(0, Math.min(this.chatHistory.length, this.chatIndex + delta));
    $('chatInput').value = this.chatHistory[this.chatIndex] || '';
  }

  command(text) {
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const command = cmd.toLowerCase();
    if (command === 'help') {
      this.addJournal('Commands: -help -skills -status -where -war -peace -run -walk -resync -logout -open -target -debug', '#b8a06a', true);
    } else if (command === 'debug') {
      this.game.debug = !this.game.debug;
      if (!this.game.debug) {
        this.gumpDebugWindow?.close();
        this.gumpDebugWindow = null;
      }
      this.addJournal(`Debug mode: ${this.game.debug ? 'enabled' : 'disabled'}`, '#b8a06a', true);
    } else if (command === 'skills') {
      $('skillsPanel').classList.toggle('hidden');
      this.refreshSkills();
    } else if (command === 'status') {
      this.showStatus();
    } else if (command === 'where') {
      this.addJournal(`Position: ${this.world.player.x}, ${this.world.player.y}, ${this.world.player.z}`, '#b8a06a', true);
    } else if (command === 'war') {
      this.world.player.inWarMode = true;
      this.world.socket.out.warMode(true);
    } else if (command === 'peace') {
      this.world.player.inWarMode = false;
      this.world.socket.out.warMode(false);
    } else if (command === 'run' || command === 'walk') {
      this.world.alwaysRun = command === 'run';
      this.addJournal(`Movement: ${command === 'run' ? 'run' : 'walk'}`, '#b8a06a', true);
    } else if (command === 'resync') {
      this.world.socket.out.resync();
    } else if (command === 'logout') {
      this.world.socket.out.logoutNotification();
      setTimeout(() => this.game.disconnect('Logged out'), 250);
    } else if (command === 'open') {
      const alias = args[0] || '';
      if (alias === 'backpack') {
        const backpack = this.world.player.getItem(Layer.Backpack);
        if (backpack) this.world.socket.out.doubleClick(backpack.serial);
      }
    } else if (command === 'target') {
      this.world.setTarget(1, 0, 0);
      this.onTargetChanged();
    } else {
      this.addJournal(`Unknown command: -${cmd}`, '#c56a4a', true);
    }
  }

  updatePrompt() {
    const input = $('chatInput');
    if (this.promptMode) {
      input.placeholder = 'Enter response...';
      input.focus();
    } else {
      input.placeholder = 'Say something...';
    }
  }

  showPrompt(prompt) {
    this.promptMode = true;
    this.updatePrompt();
  }

  /* ----------------------------- windows ----------------------------- */

  addWindow(kind, key, obj) {
    const existing = this.windows.findIndex((w) => w.kind === kind && w.key === key);
    if (existing >= 0) {
      this.windows[existing].obj = obj;
      return;
    }
    this.windows.push({ kind, key, obj });
  }

  removeWindow(kind, key) {
    this.windows = this.windows.filter((w) => !(w.kind === kind && String(w.key) === String(key)));
  }

  getWindow(kind, key) {
    return this.windows.find((w) => w.kind === kind && String(w.key) === String(key))?.obj || null;
  }

  hitTest(mx, my) {
    for (let i = this.windows.length - 1; i >= 0; i--) {
      if (this.windows[i].obj.contains(mx, my)) return this.windows[i];
    }
    return null;
  }

  openGump(gump) {
    this.addWindow('gump', gump.id, gump);
    if (!this.game.debug) return;
    if (this.gumpDebugWindow) this.gumpDebugWindow.setGump(gump);
    else {
      this.gumpDebugWindow = new DebugGumpWindow(this.world, gump, () => {
        this.gumpDebugWindow = null;
      });
    }
  }

  closeGumpWindow(id) {
    this.removeWindow('gump', id);
  }

  openContainer(serial, graphic) {
    if (graphic === 0x30) {
      this.openShop(serial, true, 'Vendor');
      return;
    }
    const existing = this.getWindow('container', serial);
    if (existing) {
      existing.gumpId = graphic;
      return;
    }
    this.addWindow('container', serial, new ContainerWindow(this.world, serial, graphic));
  }

  closeContainer(serial) {
    this.removeWindow('container', serial);
  }

  onContainerItem(serial) {
    // Container window reads live entity data; nothing else is needed.
  }

  openShop(serial, isBuy, title) {
    let shop = this.getWindow('shop', serial);
    if (!shop) {
      shop = new ShopWindow(this.world, serial, isBuy, title);
      this.addWindow('shop', serial, shop);
    } else {
      shop.isBuy = isBuy;
      shop.title = title || shop.title;
      shop.items = [];
    }
    return shop;
  }

  closeShop(serial) {
    this.removeWindow('shop', serial);
  }

  onBuyList(r) {
    const containerSerial = r.readU32BE();
    const container = this.world.getItem(containerSerial);
    if (!container) return;
    const vendor = this.world.getMobile(container.container);
    if (!vendor) return;
    const shop = this.openShop(container.container, true, `Buy from ${vendor.name || 'vendor'}`);
    const count = r.readU8();
    let items = [];
    for (let layer = Layer.ShopBuyRestock; layer <= Layer.ShopBuy; layer++) {
      const box = vendor.getItem(layer);
      if (!box) continue;
      items.push(...box.items.values());
    }
    if (container.graphic !== 0x2af8) items.reverse();
    for (let i = 0; i < count && i < items.length; i++) {
      const item = items[i];
      item.price = r.readU32BE();
      const len = r.readU8();
      const name = r.readASCII(len);
      item.name = /^\d+$/.test(name) ? this.game.cliloc(parseInt(name, 10)) || name : name;
      shop.addItem(item);
    }
  }

  onSellList(r) {
    const vendor = this.world.getMobile(r.readU32BE());
    if (!vendor) return;
    const count = r.readU16BE();
    const shop = this.openShop(vendor.serial, false, `Sell to ${vendor.name || 'vendor'}`);
    for (let i = 0; i < count; i++) {
      const serial = r.readU32BE();
      const graphic = r.readU16BE();
      const hue = r.readU16BE();
      const amount = r.readU16BE();
      const price = r.readU16BE();
      const nameLen = r.readU16BE();
      const name = r.readASCII(nameLen);
      shop.addItem({
        serial,
        graphic,
        hue,
        amount,
        price,
        name: /^\d+$/.test(name) ? this.game.cliloc(parseInt(name, 10)) || name : name,
      });
    }
  }

  onPaperdoll(r) {
    const serial = r.readU32BE();
    const mobile = this.world.getMobile(serial);
    if (!mobile) return;
    mobile.title = r.readASCII(60);
    r.readU8();
    const existing = this.getWindow('paperdoll', serial);
    if (existing) existing.mobile = mobile;
    else this.addWindow('paperdoll', serial, new PaperdollWindow(this.world, mobile));
  }

  closePaperdoll(serial) {
    this.removeWindow('paperdoll', serial);
  }

  onBook(r) {
    const isOld = r.data[0] === 0x93;
    const serial = r.readU32BE();
    let editable = r.readBool();
    if (!isOld) editable = r.readBool();
    else r.skip(1);
    const existing = this.getWindow('book', serial);
    if (!existing) {
      const pages = r.readU16BE();
      const title = isOld ? r.readUTF8(60) : r.readUTF8(r.readU16BE());
      const author = isOld ? r.readUTF8(30) : r.readUTF8(r.readU16BE());
      const book = new BookWindow(this.world, serial, title, author, pages, editable);
      this.addWindow('book', serial, book);
      this.world.socket.out.bookPageRequest(serial, 1);
    }
  }

  onBookData(r) {
    const serial = r.readU32BE();
    const book = this.getWindow('book', serial);
    if (!book) return;
    const pageCount = r.readU16BE();
    for (let i = 0; i < pageCount; i++) {
      const page = r.readU16BE();
      const lineCount = r.readU16BE();
      const lines = [];
      for (let j = 0; j < lineCount; j++) lines.push(r.readUTF8Z());
      book.setPage(page, lines);
      if (page === book.page && !this.bookRequested) {
        // The first response is for page 1.
      }
    }
  }

  closeBook(serial) {
    this.removeWindow('book', serial);
  }

  onProfile(r) {
    const serial = r.readU32BE();
    const header = r.readASCII();
    const footer = r.readUnicodeBE();
    const body = r.readUnicodeBE();
    const profile = new ProfileWindow(this.world, serial, header, footer, body);
    this.addWindow('profile', serial, profile);
  }

  closeProfile(serial) {
    this.removeWindow('profile', serial);
  }

  onTextEntry(r) {
    const serial = r.readU32BE();
    const parentId = r.readU8();
    const buttonId = r.readU8();
    const len = r.readU16BE();
    const initial = r.readASCII(len);
    const hasCancel = r.readBool();
    const variant = r.readU8();
    const maxLength = r.readU32BE();
    const descLen = r.readU16BE();
    const desc = r.readASCII(descLen);
    this.showModalInput(desc || 'Enter text', initial, maxLength || 255, (value) => {
      this.world.socket.out.textEntryResponse(serial, parentId, buttonId, value, false);
    }, hasCancel);
  }

  editGumpText(gump, control) {
    const current = gump.entries.get(control.entryId) || '';
    this.showModalInput('Enter text', current, control.maxLength || 255, (value) => {
      gump.entries.set(control.entryId, value);
    }, true);
  }

  onDye(serial, graphic) {
    this.showModalInput('Dye hue (1-3000)', '1', 4, (value) => {
      const hue = Math.max(1, Math.min(3000, parseInt(value, 10) || 1));
      this.world.socket.out.dyeResponse(serial, graphic, hue);
    }, true);
  }

  onMenu(r) {
    const serial = r.readU32BE();
    const id = r.readU16BE();
    const nameLen = r.readU8();
    const name = r.readASCII(nameLen);
    const count = r.readU8();
    const peek = r.data.slice(r.position, r.position + 2);
    const menuId = (peek[0] << 8) | peek[1];
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-size:13px';
    for (let i = 0; i < count; i++) {
      const graphic = r.readU16BE();
      const hue = r.readU16BE();
      const len = r.readU8();
      const label = r.readASCII(len);
      const b = document.createElement('button');
      appendServerText(b, `${i + 1}. ${label}`);
      b.addEventListener('click', () => {
        this.hideModal();
        if (menuId !== 0) this.world.socket.out.menuResponse(serial, id, i + 1, graphic, hue);
        else this.world.socket.out.menuResponse(serial, id, i + 1);
      });
      body.appendChild(b);
    }
    this.showModal(name || 'Menu', body, null, false);
  }

  onTargetChanged() {
    const t = this.world.target;
    const hint = $('cursorHint');
    hint.classList.toggle('hidden', !t.type);
    if (t.multi) hint.textContent = 'Place the structure — right click to cancel';
    else hint.textContent = 'Select a target — right click to cancel';
  }

  onEquipmentChanged(serial) {
    const pd = this.getWindow('paperdoll', serial);
    if (pd) pd.mobile = this.world.get(serial);
  }

  onEntityRemoved(entity) {
    this.removeWindow('container', entity.serial);
    this.removeWindow('paperdoll', entity.serial);
  }

  onHeldChanged() {}

  onTradeChanged() {
    if (this.world.trade) {
      this.addJournal(`Trade window opened with ${this.world.trade.name || 'another player'}.`, '#c9b06c', true);
    } else {
      this.addJournal('Trade window closed.', '#c9b06c', true);
    }
  }

  onBulletinBoard(r) {
    const type = r.readU8();
    if (type === 0) {
      const serial = r.readU32BE();
      const name = r.readUTF8(22);
      this.addJournal(`Bulletin board: ${name}`, '#b8a06a', true);
    } else if (type === 1) {
      r.readU32BE();
      r.readU32BE();
      r.readU32BE();
      const posterLen = r.readU8();
      const poster = r.readUTF8(posterLen);
      const subjectLen = r.readU8();
      const subject = r.readUTF8(subjectLen);
      const dateLen = r.readU8();
      const date = r.readUTF8(dateLen);
      this.addJournal(`[Board] ${poster} - ${subject} - ${date}`, '#b8a06a', true);
    } else if (type === 2) {
      r.readU32BE();
      r.readU32BE();
      const posterLen = r.readU8();
      const poster = r.readUTF8(posterLen);
      const subjectLen = r.readU8();
      const subject = r.readUTF8(subjectLen);
      const dateLen = r.readU8();
      const date = r.readUTF8(dateLen);
      const lines = r.readU8();
      const text = [];
      for (let i = 0; i < lines; i++) text.push(r.readUTF8());
      const body = document.createElement('div');
      body.style.fontSize = '13px';
      const entry = document.createElement('div');
      entry.style.whiteSpace = 'pre-wrap';
      appendServerText(entry, text.join('\n'));
      body.appendChild(entry);
      const footer = document.createElement('div');
      footer.style.marginTop = '8px';
      footer.style.color = '#8f8262';
      footer.style.fontSize = '11px';
      appendServerText(footer, date);
      body.appendChild(footer);
      this.showModal(`${subject} — ${poster}`, body, null, false);
    }
  }

  onChatMessage() {}
  onMapGump() {
    this.addJournal('Map opened.', '#b8a06a', true);
  }
  onExtendedCommand(r) {
    try {
      const sub = r.readU16BE();
      if (sub === 0x06) {
        const type = r.readU8();
        if (type === 0x01) {
          const serial = r.readU32BE();
          const name = r.readASCII();
          this.world.partyInvite = { serial, name };
          this.addJournal(`${name || 'Someone'} invites you to a party.`, '#c9b06c', true);
        }
      }
    } catch {
      /* ignore malformed custom packet */
    }
  }
  onGenericCommand() {}
  onCustomHouse() {}
  onBuffDebuff(r) {
    try {
      const serial = r.readU32BE();
      const icon = r.readU16BE();
      const count = r.readU16BE();
      if (!count) {
        this.world.buffs = this.world.buffs.filter((b) => b.icon !== icon);
        return;
      }
      for (let i = 0; i < count; i++) {
        const sourceType = r.readU16BE();
        r.skip(2);
        const iconId = r.readU16BE();
        const queue = r.readU16BE();
        r.skip(4);
        const timer = r.readU16BE();
        r.skip(3);
        const title = r.readU32BE();
        const desc = r.readU32BE();
        const wtf = r.readU32BE();
        const argLen = r.readU16BE();
        const args = r.readUnicodeLE(argLen > 2 ? argLen : 0);
        this.world.buffs = this.world.buffs.filter((b) => b.icon !== icon);
        this.world.buffs.push({ icon, iconId, timer, title: this.game.cliloc(title, args) || '', time: Date.now() });
      }
    } catch {
      /* ignore */
    }
  }

  onLoginState() {}

  /* ----------------------------- mouse ----------------------------- */

  canvasPos(e) {
    return { x: e.clientX, y: e.clientY };
  }

  onMouseMove(e) {
    const { x, y } = this.canvasPos(e);
    this.mouse = { x, y };
    this.game.renderer.mouse.x = x;
    this.game.renderer.mouse.y = y;
    this.game.renderer.mouse.world = this.game.renderer.screenToTile(x, y);
    const hit = this.hitTest(x, y);
    if (this.dragTarget) {
      this.dragTarget.obj.onMouseMove?.(x, y);
      return;
    }
    if (hit) hit.obj.onMouseMove?.(x, y);
    this.updateTargetInfo(x, y);
    this.refreshTooltip();
  }

  onMouseDown(e) {
    this.hideTooltip();
    if (!$('loginScreen').classList.contains('hidden') || !$('modalBackdrop').classList.contains('hidden')) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const { x, y } = this.canvasPos(e);
    const button = e.button;
    const hit = this.hitTest(x, y);
    if (hit) {
      hit.obj.onMouseDown?.(x, y, button);
      if (hit.obj.dragging || hit.obj.onMouseMove) this.dragTarget = hit;
      return;
    }
    if (button === 0) {
      if (this.world.target.type) {
        this.sendTarget(x, y);
        return;
      }
      const tile = this.game.renderer.screenToTile(x, y);
      const entity = this.game.renderer.entityAt?.(x, y) || this.findEntityAt(tile.x, tile.y);
      if (!entity) return;
      if (e.shiftKey && entity.isItem) {
        this.world.held = entity;
        this.world.socket.out.pickup(entity.serial, entity.amount || 1);
        return;
      }
      this.world.socket.out.singleClick(entity.serial);
      return;
    }
    if (button === 2) {
      if (this.world.target.type) {
        this.world.clearTarget();
        this.onTargetChanged();
        return;
      }
      if (!this.world.held) this.startMouseWalk();
    }
  }

  startMouseWalk() {
    this.mouseWalk = true;
    this.game.cancelWalkPath();
  }

  stopMouseWalk() {
    this.mouseWalk = false;
  }

  mouseWalkDirection() {
    if (!this.mouseWalk || this.world.held) return null;
    const p = this.world.player;
    if (!p) return null;
    const tile = this.game.renderer.screenToTile(this.mouse.x, this.mouse.y);
    const dx = tile.x - p.x;
    const dy = tile.y - p.y;
    if (!dx && !dy) return null;
    if (dx > 0 && dy > 0) return 3;
    if (dx > 0 && dy < 0) return 1;
    if (dx < 0 && dy > 0) return 5;
    if (dx < 0 && dy < 0) return 7;
    if (dx > 0) return 2;
    if (dx < 0) return 6;
    if (dy > 0) return 4;
    return 0;
  }

  onMouseUp(e) {
    if (e.button === 2) this.stopMouseWalk();
    const { x, y } = this.canvasPos(e);
    if (this.dragTarget) {
      this.dragTarget.obj.onMouseUp?.(x, y);
      this.dragTarget = null;
    }
    if (this.world.held) {
      const hit = this.hitTest(x, y);
      if (hit) {
        hit.obj.onItemDrop?.(x, y);
      } else {
        const tile = this.game.renderer.screenToTile(x, y);
        const block = this.world.getBlock(tile.x >> 3, tile.y >> 3);
        let z = 0;
        if (block) z = block.cells[((tile.y & 7) << 3) | (tile.x & 7)].z;
        const held = this.world.held;
        this.world.held = null;
        this.world.socket.out.drop(held.serial, tile.x, tile.y, z, 0, 0);
      }
    }
  }

  onDoubleClick(e) {
    if (!$('modalBackdrop').classList.contains('hidden')) return;
    const { x, y } = this.canvasPos(e);
    const hit = this.hitTest(x, y);
    if (hit) {
      hit.obj.onDoubleClick?.(x, y);
      return;
    }
    const tile = this.game.renderer.screenToTile(x, y);
    const entity = this.findEntityAt(tile.x, tile.y);
    if (entity) this.world.socket.out.doubleClick(entity.serial);
  }

  findEntityAt(x, y) {
    let best = null;
    let bestScore = Infinity;
    for (const e of this.world.entities.values()) {
      if (e.isItem && e.container !== 0) continue;
      if (e === this.world.player) continue;
      const d = Math.abs(e.x - x) + Math.abs(e.y - y);
      if (d < bestScore) {
        bestScore = d;
        best = e;
      }
    }
    return bestScore <= 1 ? best : null;
  }

  onOPLUpdated(serial) {
    if (this.hoverSerial === (serial >>> 0)) this.refreshTooltip(true);
  }

  hideTooltipContent() {
    if (this.tooltipEl) this.tooltipEl.classList.add('hidden');
  }

  hideTooltip() {
    this.hoverId = null;
    this.hoverSerial = 0;
    this.hoverSince = 0;
    this.hideTooltipContent();
  }

  refreshTooltip(force = false) {
    if (!this.tooltipEl) return;
    if (
      !this.world.inGame ||
      !$('loginScreen').classList.contains('hidden') ||
      !$('modalBackdrop').classList.contains('hidden') ||
      this.dragTarget ||
      this.world.held
    ) {
      this.hideTooltip();
      return;
    }
    const { x, y } = this.mouse;
    if (document.elementFromPoint(x, y) !== this.game.renderer.canvas) {
      this.hideTooltip();
      return;
    }
    let target = null;
    const hit = this.hitTest(x, y);
    if (hit) {
      target = hit.obj.tooltipAt?.(x, y) || null;
    } else {
      const entity = this.game.renderer.entityAt?.(x, y);
      if (entity && (entity.isMobile || entity.container === 0)) {
        target = { id: `entity:${entity.serial}`, serial: entity.serial, title: entity.name, entity };
      }
    }
    if (!target) {
      this.hideTooltip();
      return;
    }
    const id = target.id || target.serial || target.title || '';
    const now = performance.now();
    if (this.hoverId !== id) {
      this.hoverId = id;
      this.hoverSince = now;
      this.hideTooltipContent();
    }
    this.hoverSerial = target.serial >>> 0;
    const data = this.buildTooltip(target);
    if (!data.title && !data.lines.length) {
      this.hideTooltipContent();
      return;
    }
    if (!force && now - this.hoverSince < 280) return;
    this.showTooltip(data, x, y);
  }

  buildTooltip(target) {
    let title = target.title || target.entity?.name || '';
    let lines = target.lines ? [...target.lines] : [];
    if (target.serial) {
      this.world.opl.request(target.serial);
      const opl = this.world.opl.resolve(target.serial);
      if (opl?.lines.length) {
        title = opl.lines[0] || title;
        lines = [...opl.lines.slice(1), ...lines];
      }
    }
    if (!title && lines.length) title = lines.shift();
    return { title, lines, key: `${title}|${lines.join('|')}` };
  }

  showTooltip(data, mx, my) {
    const el = this.tooltipEl;
    if (this.tooltipContentKey !== data.key) {
      this.tooltipContentKey = data.key;
      el.replaceChildren();
      if (data.title) {
        const title = document.createElement('div');
        title.className = 'tooltipTitle';
        appendServerText(title, data.title);
        el.append(title);
      }
      for (const line of data.lines) {
        const row = document.createElement('div');
        row.className = 'tooltipLine';
        appendServerText(row, line);
        el.append(row);
      }
    }
    el.classList.remove('hidden');
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    let left = mx + 18;
    let top = my + 18;
    if (left > maxLeft) left = mx - rect.width - 18;
    if (top > maxTop) top = my - rect.height - 18;
    el.style.left = `${Math.max(8, Math.min(maxLeft, left))}px`;
    el.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
  }

  sendTarget(mx, my) {
    const t = this.world.target;
    const tile = this.game.renderer.screenToTile(mx, my);
    const entity = this.findEntityAt(tile.x, tile.y);
    if (t.multi) {
      this.world.socket.out.targetXYZ(t.multi.multiId, entity?.x ?? tile.x, entity?.y ?? tile.y, entity?.z ?? 0, t.cursorId, t.cursorType);
    } else if (entity) {
      this.world.socket.out.targetObject(entity.serial, entity.graphic, entity.x, entity.y, entity.z, t.cursorId, t.cursorType);
    } else {
      let z = 0;
      const block = this.world.getBlock(tile.x >> 3, tile.y >> 3);
      if (block) z = block.cells[((tile.y & 7) << 3) | (tile.x & 7)].z;
      this.world.socket.out.targetXYZ(0, tile.x, tile.y, z, t.cursorId, t.cursorType);
    }
    this.world.clearTarget();
    this.onTargetChanged();
  }

  updateTargetInfo(mx, my) {
    const el = $('targetInfo');
    if (!this.world.inGame) return;
    const tile = this.game.renderer.screenToTile(mx, my);
    const entity = this.findEntityAt(tile.x, tile.y);
    if (entity) {
      el.classList.remove('hidden');
      el.textContent = `${entity.name || (entity.isMobile ? 'mobile' : 'item')} · 0x${entity.serial.toString(16)} · ${entity.x},${entity.y},${entity.z}${entity.hitsMax ? ` · ${entity.hits}/${entity.hitsMax}` : ''}`;
    } else {
      el.classList.remove('hidden');
      el.textContent = `${tile.x}, ${tile.y}`;
    }
  }

  /* ----------------------------- keyboard ----------------------------- */

  isTextInputFocused() {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
  }

  isMovementBlocked() {
    if (!$('modalBackdrop').classList.contains('hidden')) return true;
    if (this.promptMode) return true;
    return this.isTextInputFocused();
  }

  getMovementInput() {
    if (!this.world.inGame) return null;
    if (this.isMovementBlocked()) return null;
    const direction = this.computeDirection();
    if (direction != null) return { direction, run: !!this.shiftDown || !!this.world.alwaysRun };
    const mouseDirection = this.mouseWalkDirection();
    if (mouseDirection != null) return { direction: mouseDirection, run: !!this.shiftDown || !!this.world.alwaysRun };
    return null;
  }

  onKeyDown(e) {
    if (e.key === 'Shift') this.shiftDown = true;
    if (!$('modalBackdrop').classList.contains('hidden')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hideModal();
      }
      return;
    }
    if (!$('loginScreen').classList.contains('hidden')) return;
    const chat = $('chatInput');
    if (this.isTextInputFocused()) return;
    if (e.key === 'Enter') {
      chat.focus();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (this.world.target.type) {
        this.world.clearTarget();
        this.onTargetChanged();
      } else if (this.windows.length) {
        const top = this.windows[this.windows.length - 1].obj;
        top.close?.();
      }
      return;
    }
    if (e.code === 'KeyW' && e.altKey) {
      const state = !this.world.player?.inWarMode;
      if (this.world.player) this.world.player.inWarMode = state;
      this.world.socket.out.warMode(state);
      $('btnWar').textContent = state ? 'WAR' : 'PEACE';
      e.preventDefault();
      return;
    }
    if (e.code === 'F1') {
      this.command('-help');
      e.preventDefault();
      return;
    }
    if (e.key.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      e.preventDefault();
      this.keyDir = this.keyDir || {};
      this.keyDir[e.code] = true;
      this.game.cancelWalkPath();
      const direction = this.computeDirection();
      if (direction != null) this.world.walk(direction, !!this.shiftDown || !!this.world.alwaysRun);
    }
  }

  onKeyUp(e) {
    if (e.key === 'Shift') this.shiftDown = false;
    if (this.keyDir) delete this.keyDir[e.code];
  }

  computeDirection() {
    const k = this.keyDir || {};
    const up = k.ArrowUp || k.KeyW;
    const down = k.ArrowDown || k.KeyS;
    const left = k.ArrowLeft || k.KeyA;
    const right = k.ArrowRight || k.KeyD;
    if (up && down) return null;
    if (left && right) return null;
    if (up && left) return 7;
    if (up && right) return 1;
    if (down && left) return 5;
    if (down && right) return 3;
    if (up) return 0;
    if (down) return 4;
    if (left) return 6;
    if (right) return 2;
    return null;
  }

  /* ----------------------------- modal ----------------------------- */

  showModal(title, body, onOk, showCancel = true) {
    const titleEl = $('modalTitle');
    titleEl.textContent = '';
    appendServerText(titleEl, title);
    const bodyEl = $('modalBody');
    bodyEl.innerHTML = '';
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);
    $('modalBackdrop').classList.remove('hidden');
    $('modalCancel').style.display = showCancel ? '' : 'none';
    $('modalOk').textContent = onOk ? 'OK' : 'Close';
    $('modalOk').style.display = '';
    this.modalOk = onOk || (() => this.hideModal());
  }

  showModalInput(title, initial, maxLength, onOk, showCancel) {
    const input = document.createElement('input');
    input.value = initial || '';
    input.maxLength = maxLength || 255;
    this.showModal(title, input, () => onOk(input.value), showCancel);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 10);
  }

  hideModal() {
    $('modalBackdrop').classList.add('hidden');
    this.modalOk = null;
  }

  /* ----------------------------- drawing ----------------------------- */

  draw(ctx, now) {
    for (const w of this.windows) {
      w.obj.draw?.(ctx, now);
    }
  }

  update(now) {
    if (!this.world.inGame) return;
    if (now - this.lastStatusRefresh > 150) {
      this.lastStatusRefresh = now;
      this.refreshStatus();
      this.updateTargetInfo(this.game.renderer.mouse.x || 0, this.game.renderer.mouse.y || 0);
      this.refreshTooltip();
    }
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
