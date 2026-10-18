import { Gump } from '../game/gump.js';
import { appendServerText } from '../game/html.js';
import {
  BoardWindow,
  ContainerWindow,
  ContextMenuWindow,
  PaperdollWindow,
  ShopWindow,
  BookWindow,
  ProfileWindow,
  StatusWindow,
  OptionsWindow,
  SkillsWindow,
  SpellbookWindow,
  TradeWindow,
  PartyWindow,
  PartyInviteWindow,
  DebugGumpWindow,
} from '../game/windows.js';
import { Layer } from '../game/entity.js';
import { settings } from '../game/settings.js';
import { BuffBarWindow, buffGraphic } from '../game/buffs.js';
import { MapGumpWindow, MinimapWindow, WorldMapWindow } from '../game/maps.js';
import { WaypointWindow, addLocalWaypoint, clearLocalWaypoints, loadLocalWaypoints } from '../game/waypoints.js';
import { Reader } from '../util/binary.js';
import { Journal } from './journal.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.windows = [];
    this.mouseWalk = false;
    this.worldItemPress = null;
    this.lastTarget = null;
    this.promptMode = false;
    this.chatHistory = [];
    this.chatIndex = -1;
    this.hues = null;
    this.skillInfo = null;
    this.lastStatusRefresh = 0;
    this.statusRequestTime = 0;
    this.mouse = { x: 0, y: 0 };
    this.tooltipEl = $('tooltip');
    this.hoverId = null;
    this.hoverSerial = 0;
    this.hoverSince = 0;
    this.tooltipContentKey = '';
    this.gumpDebugWindow = null;
    this.contextMenu = null;
    this.contextMenuRequest = null;
    this.focusedGumpEntry = null;
    this.modalOk = null;
    this.modalCancel = null;
    this.journal = new Journal(this);
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
    $('chatInput').addEventListener('focus', () => this.clearGumpFocus());
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
    $('btnSkills').addEventListener('click', () => this.toggleSkills());
    $('btnParty')?.addEventListener('click', () => this.toggleParty());
    $('btnMap')?.addEventListener('click', () => this.toggleRadar());
    $('btnWorldMap')?.addEventListener('click', () => this.toggleWorldMap());
    $('btnWaypoints')?.addEventListener('click', () => this.toggleWaypoints());
    $('btnWar').addEventListener('click', () => this.toggleWarMode());
    $('btnStatus').addEventListener('click', () => this.showStatus());
    $('btnOptions')?.addEventListener('click', () => this.showOptions());
    $('btnJournal').addEventListener('click', () => this.journal.toggle());
    $('btnLogout').addEventListener('click', () => this.logout());

    $('modalCancel').addEventListener('click', () => this.cancelModal());
    $('modalOk').addEventListener('click', () => {
      const cb = this.modalOk;
      this.hideModal();
      cb?.();
    });
    $('modalBackdrop').addEventListener('mousedown', (e) => {
      if (e.target === $('modalBackdrop')) this.cancelModal();
    });

    const canvas = $('game');
    canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    canvas.addEventListener('mouseleave', () => {
      this.worldItemPress = null;
      this.hideTooltip();
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.world.target.active) {
        this.cancelTarget();
        return;
      }
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        const hit = this.hitTest(e.clientX, e.clientY);
        if (hit?.obj.onWheel?.(e.clientX, e.clientY, e.deltaY)) {
          e.preventDefault();
        } else if (hit?.obj.scroll !== undefined) {
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
      this.worldItemPress = null;
      this.stopMouseWalk();
      this.clearGumpFocus();
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
      this.journal.setAccount(this.game.loginCredentials?.account || '');
      this.journal.clear();
      this.journal.show();
      this.addJournal('Welcome to LegionUO.', '#d6b45d', true);
    }
    this.world.localWaypoints = loadLocalWaypoints(this.world);
    this.refreshStatus();
    this.refreshSkills();
    this.world.alwaysRun = !!settings.get('alwaysRun');
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
    this.getWindow('skills', 'player')?.clampScroll();
  }

  toggleWarMode() {
    const player = this.world.player;
    if (!player) return;
    const state = !player.inWarMode;
    player.inWarMode = state;
    this.world.socket.out.warMode(state);
    $('btnWar').textContent = state ? 'WAR' : 'PEACE';
  }

  logout() {
    this.world.socket.out.logoutNotification();
    setTimeout(() => this.game.disconnect('Logged out'), 250);
  }

  showStatus() {
    if (!this.world.player) return;
    const entry = this.windows.find((w) => w.kind === 'status');
    if (entry) {
      this.windows = this.windows.filter((w) => w !== entry);
      this.windows.push(entry);
      entry.obj.requestStatus?.();
      return;
    }
    const window = new StatusWindow(this.world);
    this.addWindow('status', 'player', window);
    window.requestStatus();
  }

  closeStatus() {
    this.removeWindow('status', 'player');
  }

  showOptions() {
    if (!this.world.player) return;
    const existing = this.getWindow('options', 'player');
    if (existing) {
      this.raiseWindow(existing);
      return;
    }
    this.addWindow('options', 'player', new OptionsWindow(this.world));
  }

  toggleOptions() {
    if (this.getWindow('options', 'player')) this.closeOptions();
    else this.showOptions();
  }

  closeOptions() {
    this.removeWindow('options', 'player');
  }

  requestStatus(force = false) {
    if (!this.world.player) return;
    const now = performance.now();
    if (!force && now - this.statusRequestTime < 750) return;
    this.statusRequestTime = now;
    this.world.socket.out.statusRequest(this.world.playerSerial);
  }

  showSkills() {
    if (!this.world.player) return;
    const existing = this.getWindow('skills', 'player');
    if (existing) {
      this.raiseWindow(existing);
      existing.requestSkills();
      return;
    }
    this.addWindow('skills', 'player', new SkillsWindow(this.world));
  }

  toggleSkills() {
    if (this.getWindow('skills', 'player')) this.closeSkills();
    else this.showSkills();
  }

  closeSkills() {
    this.removeWindow('skills', 'player');
  }

  showBuffs() {
    if (!this.world.player) return;
    const existing = this.getWindow('buffs', 'player');
    if (existing) {
      this.raiseWindow(existing);
      return;
    }
    this.addWindow('buffs', 'player', new BuffBarWindow(this.world));
  }

  toggleBuffs() {
    if (this.getWindow('buffs', 'player')) this.closeBuffs();
    else this.showBuffs();
  }

  closeBuffs() {
    this.removeWindow('buffs', 'player');
  }

  showParty() {
    if (!this.world.player) return;
    const existing = this.getWindow('party', 'player');
    if (existing) {
      this.raiseWindow(existing);
      return;
    }
    this.addWindow('party', 'player', new PartyWindow(this.world));
  }

  toggleParty() {
    if (this.getWindow('party', 'player')) this.closeParty();
    else this.showParty();
  }

  closeParty() {
    this.removeWindow('party', 'player');
  }

  showRadar() {
    if (!this.world.player) return;
    const existing = this.getWindow('radar', 'player');
    if (existing) {
      this.raiseWindow(existing);
      return;
    }
    this.addWindow('radar', 'player', new MinimapWindow(this.world));
  }

  toggleRadar() {
    if (this.getWindow('radar', 'player')) this.closeRadar();
    else this.showRadar();
  }

  closeRadar() {
    this.removeWindow('radar', 'player');
  }

  showWorldMap() {
    if (!this.world.player) return;
    const existing = this.getWindow('worldmap', 'player');
    if (existing) {
      this.raiseWindow(existing);
      return;
    }
    this.addWindow('worldmap', 'player', new WorldMapWindow(this.world));
  }

  toggleWorldMap() {
    if (this.getWindow('worldmap', 'player')) this.closeWorldMap();
    else this.showWorldMap();
  }

  closeWorldMap() {
    this.removeWindow('worldmap', 'player');
  }

  showWaypoints() {
    if (!this.world.player) return;
    const existing = this.getWindow('waypoints', 'player');
    if (existing) {
      this.raiseWindow(existing);
      return;
    }
    this.addWindow('waypoints', 'player', new WaypointWindow(this.world));
  }

  toggleWaypoints() {
    if (this.getWindow('waypoints', 'player')) this.closeWaypoints();
    else this.showWaypoints();
  }

  closeWaypoints() {
    this.removeWindow('waypoints', 'player');
  }

  showMapGump(window) {
    if (!window) return;
    this.addWindow('map', window.serial, window);
    this.raiseWindow(window);
  }

  closeMapGump(serial) {
    this.removeWindow('map', serial);
  }

  showPartyInvite(inviter) {
    if (!inviter) return;
    const existing = this.getWindow('partyinvite', 'invite');
    if (existing) {
      existing.inviter = inviter >>> 0;
      this.raiseWindow(existing);
      return;
    }
    this.addWindow('partyinvite', 'invite', new PartyInviteWindow(this.world, inviter));
  }

  closePartyInvite() {
    this.removeWindow('partyinvite', 'invite');
  }

  onPartyChanged(joined = false, left = false) {
    if (joined) {
      this.addJournal('You have joined a party.', '#c9b06c', true);
      this.showParty();
    }
    if (left) {
      this.addJournal('You have left the party.', '#c9b06c', true);
      this.closePartyInvite();
    }
  }

  openPartyChat() {
    this.journal.show();
    this.journal.settings.mode = 'party';
    this.journal.save();
    this.journal.applySettings();
    const input = $('chatInput');
    input?.focus();
  }

  addJournal(text, color = '#e2d6b4', isSystem = true) {
    this.journal.addSystem(text, color);
  }

  onMessage(msg) {
    this.journal.addMessage(msg);
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
    this.sendSpeech(text);
  }

  sendSpeech(text) {
    const mode = this.journal.settings.mode || 'say';
    if (mode === 'party') {
      this.world.socket.out.partyMessage(text);
      return;
    }
    const types = { say: 0, emote: 2, whisper: 8, yell: 9, guild: 13, alliance: 14 };
    this.world.socket.out.unicodeSpeech(text, types[mode] ?? 0, 3, 0x3b2, 'ENU');
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
      this.addJournal(
        'Commands: -help -skills -status -options -buffs -partywindow -radar -worldmap -waypoints -waypoint add [x y] [name]|clear -profile -where -war -peace -run -walk -resync -logout -open -target -lasttarget -debug -journal -clear -say -whisper -yell -emote -party -guild -alliance -ignore -unignore -ignorelist -timestamps',
        '#b8a06a',
        true
      );
    } else if (['say', 'whisper', 'yell', 'emote', 'party', 'guild', 'alliance'].includes(command)) {
      this.journal.settings.mode = command;
      this.journal.save();
      this.journal.applySettings();
      this.addJournal(`Speech mode: ${command}`, '#b8a06a', true);
    } else if (command === 'journal') {
      this.journal.toggle();
    } else if (command === 'clear') {
      this.journal.clear();
    } else if (command === 'ignore') {
      const name = args.join(' ').trim();
      if (!name) {
        this.command('-ignorelist');
      } else if (this.journal.addIgnore(name)) {
        this.addJournal(`Ignoring ${name}.`, '#b8a06a', true);
      }
    } else if (command === 'unignore') {
      const name = args.join(' ').trim();
      if (this.journal.removeIgnore(name)) this.addJournal(`No longer ignoring ${name}.`, '#b8a06a', true);
    } else if (command === 'ignorelist') {
      const list = this.journal.settings.ignore;
      this.addJournal(list.length ? `Ignored: ${list.join(', ')}` : 'Ignore list is empty.', '#b8a06a', true);
    } else if (command === 'timestamps') {
      this.journal.settings.timestamps = !this.journal.settings.timestamps;
      this.journal.save();
      this.journal.applySettings();
    } else if (command === 'debug') {
      this.game.setDebug(!this.game.debug);
      if (!this.game.debug) {
        this.gumpDebugWindow?.close();
        this.gumpDebugWindow = null;
      }
      for (const gump of this.world.gumps.values()) {
        for (const control of gump.controls) {
          control.htmlKey = null;
          control.htmlParsed = null;
        }
      }
      this.tooltipContentKey = '';
      this.journal.rerender();
      this.addJournal(`Debug mode: ${this.game.debug ? 'enabled' : 'disabled'}`, '#b8a06a', true);
    } else if (command === 'skills') {
      this.toggleSkills();
    } else if (command === 'status') {
      this.showStatus();
    } else if (command === 'options' || command === 'settings') {
      this.showOptions();
    } else if (command === 'buffs') {
      this.toggleBuffs();
    } else if (command === 'partywindow') {
      this.toggleParty();
    } else if (command === 'radar' || command === 'minimap') {
      this.toggleRadar();
    } else if (command === 'worldmap' || command === 'map') {
      this.toggleWorldMap();
    } else if (command === 'waypoints' || command === 'waypoint' || command === 'wp') {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'add') {
        const rest = args.slice(1);
        const hasCoords = rest.length >= 2 && rest[0] !== '' && rest[1] !== '' && Number.isFinite(Number(rest[0])) && Number.isFinite(Number(rest[1]));
        const x = hasCoords ? Number(rest[0]) : null;
        const y = hasCoords ? Number(rest[1]) : null;
        const name = (hasCoords ? rest.slice(2) : rest).join(' ');
        const waypoint = addLocalWaypoint(this.world, name, x, y);
        if (waypoint) {
          this.addJournal(`Added waypoint ${waypoint.name} at ${waypoint.x}, ${waypoint.y}.`, '#b8a06a', true);
          this.showWaypoints();
        }
      } else if (sub === 'clear') {
        clearLocalWaypoints(this.world);
        this.addJournal('Cleared local waypoints.', '#b8a06a', true);
      } else {
        this.toggleWaypoints();
      }
    } else if (command === 'profile') {
      if (this.world.player) this.world.socket.out.profileRequest(this.world.playerSerial);
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
      settings.set('alwaysRun', this.world.alwaysRun);
      this.addJournal(`Movement: ${command === 'run' ? 'run' : 'walk'}`, '#b8a06a', true);
    } else if (command === 'resync') {
      this.world.socket.out.resync();
    } else if (command === 'logout') {
      this.logout();
    } else if (command === 'open') {
      const alias = args[0] || '';
      if (alias === 'backpack') {
        const backpack = this.world.player.getItem(Layer.Backpack);
        if (backpack) this.world.socket.out.doubleClick(backpack.serial);
      } else if (alias === 'worldmap' || alias === 'map') {
        this.toggleWorldMap();
      } else if (alias === 'radar' || alias === 'minimap') {
        this.toggleRadar();
      }
    } else if (command === 'target') {
      this.world.setTarget(1, 0, 0);
      this.onTargetChanged();
    } else if (command === 'lasttarget' || command === 'last') {
      this.useLastTarget();
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
    this.journal.show();
    this.updatePrompt();
  }

  /* ----------------------------- windows ----------------------------- */

  addWindow(kind, key, obj) {
    const existing = this.windows.findIndex((w) => w.kind === kind && w.key === key);
    if (existing >= 0) {
      this.windows[existing].obj = obj;
      this.raiseWindow(obj);
      return;
    }
    this.windows.push({ kind, key, obj });
  }

  removeWindow(kind, key) {
    const removed = this.windows.filter((w) => w.kind === kind && String(w.key) === String(key));
    this.windows = this.windows.filter((w) => !(w.kind === kind && String(w.key) === String(key)));
    if (this.focusedGumpEntry && removed.some((w) => w.obj === this.focusedGumpEntry.gump)) {
      this.clearGumpFocus();
    }
  }

  raiseWindow(obj) {
    const index = this.windows.findIndex((w) => w.obj === obj);
    if (index < 0 || index === this.windows.length - 1) return;
    const [entry] = this.windows.splice(index, 1);
    this.windows.push(entry);
  }

  setGumpFocus(gump, control) {
    const previous = this.focusedGumpEntry;
    if (previous && previous.gump !== gump) previous.gump.onBlur?.();
    this.focusedGumpEntry = { gump, control };
    this.raiseWindow(gump);
  }

  clearGumpFocus(gump = null) {
    const focused = this.focusedGumpEntry;
    if (!focused || (gump && focused.gump !== gump)) return false;
    focused.gump.onBlur?.();
    this.focusedGumpEntry = null;
    return true;
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
    this.raiseWindow(gump);
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

  closeServerGump(serial, button = 0) {
    const gumps = [...this.world.gumps.values()].filter((gump) => gump.id === (serial >>> 0));
    for (const gump of gumps) {
      if (button) gump.sendResponse(button);
      else this.closeGumpAndDependents(gump);
    }
  }

  closeGumpAndDependents(gump) {
    this.clearGumpFocus(gump);
    this.world.removeGump(gump.id);
    this.closeGumpWindow(gump.id);
    for (const other of [...this.world.gumps.values()]) {
      if (other.masterGump === gump.id) this.closeGumpAndDependents(other);
    }
  }

  closeUserInterfaceWindow(id, serial) {
    switch (id) {
      case 1:
        this.closePaperdoll(serial);
        break;
      case 2:
        if (serial === this.world.playerSerial) this.closeStatus();
        break;
      case 8:
        this.closeProfile(serial);
        break;
      case 0x0c:
        this.closeContainer(serial);
        break;
      default:
        break;
    }
  }

  openContainer(serial, graphic) {
    if (graphic === 0xffff) {
      this.openSpellbook(serial);
      return;
    }
    if (graphic === 0x30) {
      const existing = this.getWindow('shop', serial);
      if (existing) {
        if (!existing.items.length) this.fillShopFromVendorLayers(existing, serial);
        this.raiseWindow(existing);
        return;
      }
      const shop = this.openShop(serial, true, 'Vendor');
      this.fillShopFromVendorLayers(shop, serial);
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

  openSpellbook(serial) {
    const item = this.world.getItem(serial) || this.world.getOrCreateItem(serial);
    const existing = this.getWindow('spellbook', serial);
    if (existing) {
      existing.item = item;
      this.raiseWindow(existing);
      return existing;
    }
    const window = new SpellbookWindow(this.world, item);
    this.addWindow('spellbook', serial, window);
    return window;
  }

  closeSpellbook(serial) {
    this.removeWindow('spellbook', serial);
  }

  onSpellbookContent(r) {
    r.skip(2);
    const serial = r.readU32BE();
    const graphic = r.readU16BE();
    const type = r.readU16BE();
    const item = this.world.getOrCreateItem(serial);
    item.graphic = graphic;
    if (type) item.spellbookType = type;
    item.spells = new Set();
    const low = r.readU32BE();
    const high = r.readU32BE();
    for (let i = 0; i < 32; i++) if (low & (1 << i)) item.spells.add(i + 1);
    for (let i = 0; i < 32; i++) if (high & (1 << i)) item.spells.add(i + 33);
    const window = this.getWindow('spellbook', serial);
    if (window) {
      window.item = item;
      window.clampPage();
    }
    return item;
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
      if (title) shop.title = title;
      this.raiseWindow(shop);
    }
    return shop;
  }

  closeShop(serial) {
    this.removeWindow('shop', serial);
  }

  fillShopFromVendorLayers(shop, serial) {
    const vendor = this.world.getMobile(serial);
    if (!vendor) return;
    for (let layer = Layer.ShopBuyRestock; layer <= Layer.ShopBuy; layer++) {
      const box = vendor.getItem(layer);
      if (!box) continue;
      const items = [...box.items.values()];
      if (box.graphic !== 0x2af8) items.reverse();
      for (const item of items) shop.addItem(item);
    }
  }

  onBuyList(r) {
    const containerSerial = r.readU32BE();
    const container = this.world.getItem(containerSerial);
    if (!container) return;
    const vendor = this.world.getMobile(container.container);
    if (!vendor) return;
    const shop = this.openShop(vendor.serial, true, `Buy from ${vendor.name || 'vendor'}`);
    shop.reset();
    const count = r.readU8();
    const items = [...container.items.values()];
    if (container.graphic === 0x2af8) items.sort((a, b) => a.x - b.x);
    else items.reverse();
    for (let i = 0; i < count; i++) {
      const price = r.readU32BE();
      const len = r.readU8();
      const name = r.readASCII(len);
      const item = items[i];
      if (!item) continue;
      item.price = price;
      item.name = /^\d+$/.test(name) ? this.game.cliloc(parseInt(name, 10)) || name : name;
      shop.addItem(item);
    }
  }

  onSellList(r) {
    const vendor = this.world.getMobile(r.readU32BE());
    if (!vendor) return;
    const count = r.readU16BE();
    const shop = this.openShop(vendor.serial, false, `Sell to ${vendor.name || 'vendor'}`);
    shop.reset();
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
      const book = new BookWindow(this.world, serial, title, author, pages, editable, isOld);
      this.addWindow('book', serial, book);
      this.world.socket.out.bookPageRequest(serial, 1);
    }
  }

  editBook(serial) {
    const book = this.getWindow('book', serial);
    if (!book || !book.editable) return;
    const title = document.createElement('input');
    title.value = book.title === 'Book' ? '' : book.title;
    title.maxLength = 60;
    const author = document.createElement('input');
    author.value = book.author || '';
    author.maxLength = 30;
    const text = document.createElement('textarea');
    text.value = (book.lines.get(book.page) || []).join('\n');
    text.maxLength = 4096;
    const body = document.createElement('div');
    body.appendChild(this.formField('Title', title));
    body.appendChild(this.formField('Author', author));
    body.appendChild(this.formField(`Page ${book.page}`, text));
    const oldTitle = book.title;
    const oldAuthor = book.author;
    const page = book.page;
    this.showModal(
      'Edit Book',
      body,
      () => {
        const nextTitle = title.value.trim().slice(0, 60) || 'Book';
        const nextAuthor = author.value.trim().slice(0, 30);
        const lines = text.value.replace(/\r\n?/g, '\n').split('\n');
        while (lines.length && !lines[lines.length - 1]) lines.pop();
        book.applyEdit(nextTitle, nextAuthor, lines);
        if (nextTitle !== oldTitle || nextAuthor !== oldAuthor) {
          if (book.old) this.world.socket.out.bookHeaderOld(serial, nextTitle, nextAuthor);
          else this.world.socket.out.bookHeader(serial, nextTitle, nextAuthor);
        }
        this.world.socket.out.bookPage(serial, lines, page);
        this.addJournal(`Book page ${page} saved.`, '#b8a06a', true);
      },
      true
    );
  }

  formField(labelText, control) {
    const label = document.createElement('label');
    label.className = 'modalField';
    const caption = document.createElement('span');
    caption.textContent = labelText;
    label.appendChild(caption);
    label.appendChild(control);
    return label;
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
    const editable = (serial >>> 0) === (this.world.playerSerial >>> 0);
    const profile = new ProfileWindow(this.world, serial, header, footer, body, editable);
    this.addWindow('profile', serial, profile);
  }

  editProfile(serial) {
    const profile = this.getWindow('profile', serial);
    if (!profile || !profile.editable) return;
    const text = document.createElement('textarea');
    text.value = profile.body || '';
    text.maxLength = 4096;
    const body = document.createElement('div');
    body.appendChild(this.formField('Profile', text));
    this.showModal(
      'Edit Profile',
      body,
      () => {
        const value = text.value.replace(/\r\n?/g, '\n');
        profile.setBody(value);
        this.world.socket.out.profileUpdate(serial, value);
        this.addJournal('Profile saved.', '#b8a06a', true);
      },
      true
    );
  }

  closeProfile(serial) {
    this.removeWindow('profile', serial);
  }

  openContextMenu(serial, x, y) {
    this.contextMenuRequest = { serial: serial >>> 0, x, y };
    this.world.socket.out.requestPopupMenu(serial);
  }

  showContextMenu(serial, items) {
    const request = this.contextMenuRequest;
    const at = request && request.serial === (serial >>> 0) ? request : this.mouse;
    this.closeContextMenu();
    if (!items.length) return;
    this.hideTooltip();
    const menu = new ContextMenuWindow(this.world, serial, items, at.x, at.y, (s, index) => {
      this.world.socket.out.popupMenuSelection(s, index);
    });
    this.contextMenu = menu;
    this.addWindow('contextmenu', 'menu', menu);
    this.raiseWindow(menu);
  }

  closeContextMenu() {
    if (!this.contextMenu) return;
    this.removeWindow('contextmenu', 'menu');
    this.contextMenu = null;
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
    const body = document.createElement('div');
    body.className = 'dyeBody';

    const layout = document.createElement('div');
    layout.className = 'dyeLayout';
    const grid = document.createElement('div');
    grid.className = 'dyeGrid';
    const side = document.createElement('div');
    side.className = 'dyeSide';

    const preview = document.createElement('img');
    preview.className = 'dyePreview';
    preview.alt = '';
    preview.draggable = false;
    const swatch = document.createElement('div');
    swatch.className = 'dyeSwatch';
    const label = document.createElement('div');
    label.className = 'dyeHueLabel';
    const shades = document.createElement('div');
    shades.className = 'dyeShades';
    const shadeLabel = document.createElement('div');
    shadeLabel.className = 'dyeSideLabel';
    shadeLabel.textContent = 'Shade';

    side.append(preview, swatch, label, shadeLabel, shades);
    layout.append(grid, side);
    body.append(layout);

    const hueCount = Math.max(1, this.hues?.text?.length || 1000);
    let graduation = 0;
    let selectedHue = 2;

    const hueAt = (index) => Math.min(hueCount - 1, 2 + graduation + index * 5);

    const selectHue = (hue) => {
      selectedHue = hue;
      const color = this.hueColor(hue);
      preview.src = `/api/art/static/${graphic}.png?hue=${hue}`;
      preview.style.display = graphic ? '' : 'none';
      swatch.style.background = color;
      label.textContent = `Hue ${hue}`;
      for (const cell of grid.children) cell.classList.toggle('selected', Number(cell.dataset.hue) === hue);
    };

    const buildGrid = () => {
      grid.replaceChildren();
      grid.style.gridTemplateColumns = 'repeat(20, 10px)';
      for (let i = 0; i < 200; i++) {
        const hue = hueAt(i);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'dyeCell';
        cell.dataset.hue = String(hue);
        cell.title = `Hue ${hue}`;
        cell.style.background = this.hueColor(hue);
        cell.addEventListener('click', () => selectHue(hue));
        grid.append(cell);
      }
      selectHue(selectedHue);
    };

    const buildShades = () => {
      shades.replaceChildren();
      for (let i = 0; i < 5; i++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dyeShade';
        button.textContent = String(i + 1);
        button.classList.toggle('active', i === graduation);
        button.style.borderColor = this.hueColor(Math.min(hueCount - 1, i + 2));
        button.addEventListener('click', () => {
          graduation = i;
          selectedHue = hueAt(0);
          buildGrid();
          buildShades();
        });
        shades.append(button);
      }
    };

    preview.addEventListener('error', () => {
      preview.style.display = 'none';
    });

    buildGrid();
    buildShades();

    this.showModal('Dye', body, () => {
      this.world.socket.out.dyeResponse(serial, graphic, selectedHue);
    });
  }

  onMenu(r) {
    const serial = r.readU32BE();
    const id = r.readU16BE();
    const nameLen = r.readU8();
    const name = r.readASCII(nameLen);
    const count = r.readU8();
    const entries = [];
    for (let i = 0; i < count; i++) {
      const graphic = r.readU16BE();
      const hue = r.readU16BE();
      const len = r.readU8();
      entries.push({ graphic, hue, label: r.readASCII(len) });
    }
    if (!entries.length) return;

    const gray = entries[0].graphic === 0;
    const body = document.createElement('div');

    if (gray) {
      body.className = 'uoGrayMenu';
      const group = `uoGrayMenu-${serial >>> 0}-${id}`;
      entries.forEach((entry, index) => {
        const label = document.createElement('label');
        label.className = 'uoMenuChoice';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = group;
        radio.value = String(index + 1);
        radio.checked = index === 0;
        const text = document.createElement('span');
        appendServerText(text, entry.label || `Choice ${index + 1}`);
        label.append(radio, text);
        body.append(label);
      });
      this.showModal(
        name || 'Menu',
        body,
        () => {
          const picked = body.querySelector('input[type="radio"]:checked');
          if (!picked) return;
          this.world.socket.out.menuResponse(serial, id, Number(picked.value));
        },
        true,
        () => this.world.socket.out.menuResponse(serial, id, 0)
      );
      return;
    }

    body.className = 'uoMenuGrid';
    entries.forEach((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'uoMenuItem';
      button.title = entry.label || `Item ${index + 1}`;
      const image = document.createElement('img');
      image.src = `/api/art/static/${entry.graphic}.png?hue=${entry.hue}`;
      image.alt = '';
      image.draggable = false;
      image.addEventListener('error', () => {
        image.style.display = 'none';
      });
      const number = document.createElement('span');
      number.className = 'uoMenuNumber';
      number.textContent = String(index + 1);
      button.append(image, number);
      button.addEventListener('click', () => {
        this.hideModal();
        this.world.socket.out.menuResponse(serial, id, index + 1, entry.graphic, entry.hue);
      });
      body.append(button);
    });
    this.showModal(
      name || 'Menu',
      body,
      null,
      true,
      () => this.world.socket.out.menuResponse(serial, id, 0)
    );
    $('modalOk').style.display = 'none';
  }

  onTargetChanged() {
    const t = this.world.target;
    const hint = $('cursorHint');
    hint.classList.toggle('hidden', !t.active);
    if (t.multi) hint.textContent = 'Place the structure — right click to cancel';
    else hint.textContent = 'Select a target — right click to cancel';
  }

  cancelTarget() {
    const t = this.world.target;
    if (!t.active) return;
    this.world.socket.out.targetCancel(t.type, t.cursorId, t.cursorType);
    this.world.clearTarget();
    this.onTargetChanged();
  }

  useLastTarget() {
    const t = this.world.target;
    const last = this.lastTarget;
    if (!t.active) {
      this.addJournal('No target cursor is active.', '#c56a4a', true);
      return;
    }
    if (!last) {
      this.addJournal('No previous target.', '#c56a4a', true);
      return;
    }
    if (last.serial) {
      const entity = this.world.get(last.serial);
      this.world.socket.out.targetObject(
        last.serial,
        entity?.graphic ?? last.graphic,
        entity?.x ?? last.x,
        entity?.y ?? last.y,
        entity?.z ?? last.z,
        t.cursorId,
        t.cursorType
      );
    } else {
      this.world.socket.out.targetXYZ(last.graphic, last.x, last.y, last.z, t.cursorId, t.cursorType);
    }
    this.world.clearTarget();
    this.onTargetChanged();
  }

  onEquipmentChanged(serial) {
    const pd = this.getWindow('paperdoll', serial);
    if (pd) pd.mobile = this.world.get(serial);
  }

  onEntityRemoved(entity) {
    this.removeWindow('container', entity.serial);
    this.removeWindow('paperdoll', entity.serial);
    this.removeWindow('spellbook', entity.serial);
    this.removeWindow('map', entity.serial);
  }

  onHeldChanged() {}

  onTradeChanged() {
    const trade = this.world.trade;
    const existing = this.windows.filter((w) => w.kind === 'trade');
    if (!trade) {
      if (existing.length) {
        this.windows = this.windows.filter((w) => w.kind !== 'trade');
        this.addJournal('Trade window closed.', '#c9b06c', true);
      }
      return;
    }
    const match = existing.find((w) => w.obj.trade?.serial === trade.serial);
    if (match) {
      match.obj.trade = trade;
      this.raiseWindow(match.obj);
      return;
    }
    for (const w of existing) this.removeWindow('trade', w.key);
    this.addWindow('trade', trade.serial, new TradeWindow(this.world, trade));
    this.addJournal(`Trade window opened with ${trade.name || 'another player'}.`, '#c9b06c', true);
  }

  onBulletinBoard(r) {
    const type = r.readU8();
    if (type === 0) {
      const serial = r.readU32BE();
      const name = r.readUTF8Z();
      this.openBoard(serial, name);
    } else if (type === 1) {
      const boardSerial = r.readU32BE();
      const msgSerial = r.readU32BE();
      const poster = r.readUTF8Z();
      const subject = r.readUTF8Z();
      const date = r.readUTF8Z();
      this.getWindow('board', boardSerial)?.addSummary({ serial: msgSerial, poster, subject, date });
    } else if (type === 2) {
      const boardSerial = r.readU32BE();
      const msgSerial = r.readU32BE();
      const poster = r.readUTF8Z();
      const subject = r.readUTF8Z();
      const date = r.readUTF8Z();
      const count = r.readU8();
      const lines = [];
      for (let i = 0; i < count; i++) lines.push(r.readUTF8Z());
      this.getWindow('board', boardSerial)?.setMessage({ serial: msgSerial, poster, subject, date, lines });
    }
  }

  openBoard(serial, name) {
    const existing = this.getWindow('board', serial);
    if (existing) {
      if (name) existing.name = name;
      this.raiseWindow(existing);
      return existing;
    }
    const window = new BoardWindow(this.world, serial, name);
    this.addWindow('board', serial, window);
    this.raiseWindow(window);
    return window;
  }

  closeBoard(serial) {
    this.removeWindow('board', serial);
  }

  onChatMessage() {}
  onMapGump(r, id = 0x90) {
    const serial = r.readU32BE();
    r.readU16BE();
    const startX = r.readU16BE();
    const startY = r.readU16BE();
    const endX = r.readU16BE();
    const endY = r.readU16BE();
    const width = r.readU16BE();
    const height = r.readU16BE();
    const facet = id === 0xf5 ? r.readU16BE() : 0;
    const existing = this.getWindow('map', serial);
    if (existing) this.closeMapGump(serial);
    this.showMapGump(new MapGumpWindow(this.world, serial, width, height, startX, startY, endX, endY, facet));
  }

  onMapData(r) {
    const serial = r.readU32BE();
    const action = r.readU8();
    const window = this.getWindow('map', serial);
    if (!window) return;
    if (action === 1) {
      r.skip(1);
      const x = r.readU16BE();
      const y = r.readU16BE();
      window.addPin(x, y);
    } else if (action === 5) {
      window.clearPins();
    } else if (action === 6 && r.remaining() > 0) {
      window.setPlotState(r.readU8());
    }
  }
  onExtendedCommand(r) {
    try {
      const sub = r.readU16BE();
      if (sub === 0x04) {
        const gumpId = r.readU32BE();
        const button = r.readU32BE();
        this.closeServerGump(gumpId, button);
      } else if (sub === 0x16) {
        const id = r.readU32BE();
        const serial = r.readU32BE();
        this.closeUserInterfaceWindow(id, serial);
      } else if (sub === 0x06) {
        this.onPartyPacket(r);
      } else if (sub === 0x14) {
        const mode = r.readU16BE();
        const serial = r.readU32BE();
        const count = r.readU8();
        const items = [];
        for (let i = 0; i < count; i++) {
          let cliloc;
          let index;
          let flags;
          if (mode >= 2) {
            cliloc = r.readU32BE();
            index = r.readU16BE();
            flags = r.readU16BE();
          } else {
            index = r.readU16BE();
            cliloc = r.readU16BE() + 3000000;
            flags = r.readU16BE();
            if (flags & 0x84) r.skip(2);
            if (flags & 0x40) r.skip(2);
            if (flags & 0x20) r.skip(2);
          }
          items.push({ index, cliloc, flags });
        }
        this.showContextMenu(serial, items);
      } else if (sub === 0x1b) {
        this.onSpellbookContent(r);
      }
    } catch {
      /* ignore malformed custom packet */
    }
  }
  onPartyPacket(r) {
    const type = r.readU8();
    const party = this.world.party;
    if (type === 0x01 || type === 0x02) {
      const add = type === 0x01;
      const count = r.readU8();
      if (count <= 1) {
        const hadParty = party.leader !== 0 || party.members.length > 0;
        party.members = [];
        party.leader = 0;
        party.inviter = 0;
        party.canLoot = false;
        this.onPartyChanged(false, hadParty);
        return;
      }
      let removeSerial = 0;
      if (!add && r.remaining() >= 4) removeSerial = r.readU32BE() >>> 0;
      const previousLeader = party.leader;
      const members = [];
      for (let i = 0; i < count && r.remaining() >= 4; i++) {
        const serial = r.readU32BE() >>> 0;
        if (!add && serial === removeSerial) continue;
        members.push(serial);
      }
      if (!add && (removeSerial === this.world.playerSerial || members.length <= 1)) {
        party.members = [];
        party.leader = 0;
        party.inviter = 0;
        party.canLoot = false;
        this.onPartyChanged(false, true);
        return;
      }
      party.members = members;
      party.leader = members[0] || 0;
      if (members.length) party.inviter = 0;
      this.onPartyChanged(add && previousLeader === 0 && members.length > 0, false);
      return;
    }
    if (type === 0x03 || type === 0x04) {
      const serial = r.readU32BE() >>> 0;
      const text = r.readUnicodeBE();
      const mobile = this.world.getMobile(serial);
      const name = serial === this.world.playerSerial ? this.world.player?.name || 'You' : mobile?.name || '';
      this.world.addMessage(text, 0x3b2, 0, name, 3, {
        serial,
        textType: 'party',
        overhead: false,
      });
      return;
    }
    if (type === 0x07) {
      const inviter = r.readU32BE() >>> 0;
      party.inviter = inviter;
      const mobile = this.world.getMobile(inviter);
      const name = mobile?.name || `0x${inviter.toString(16)}`;
      this.addJournal(`${name} invites you to a party.`, '#c9b06c', true);
      this.showPartyInvite(inviter);
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
        const titleId = r.readU32BE();
        const descId = r.readU32BE();
        const altId = r.readU32BE();
        const titleArgs = readBuffArgs(r);
        const descArgs = readBuffArgs(r);
        const altArgs = readBuffArgs(r);
        this.world.buffs = this.world.buffs.filter((b) => b.icon !== icon);
        this.world.buffs.push({
          icon,
          iconId,
          queue,
          sourceType,
          serial,
          graphic: buffGraphic(icon),
          timer,
          titleId,
          titleArgs,
          descId,
          descArgs,
          altId,
          altArgs,
          endsAt: timer > 0 ? Date.now() + timer * 1000 : 0,
          time: Date.now(),
        });
      }
      this.showBuffs();
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
    if (this.worldItemPress) {
      const dx = x - this.worldItemPress.x;
      const dy = y - this.worldItemPress.y;
      if (dx * dx + dy * dy >= 64) {
        const item = this.worldItemPress.item;
        this.worldItemPress = null;
        if (!this.world.held) {
          this.world.held = item;
          this.world.socket.out.pickup(item.serial, item.amount || 1);
          this.game.renderer.mouse.world = this.game.renderer.screenToTile(x, y);
        }
        return;
      }
    }
    const hit = this.hitTest(x, y);
    if (this.dragTarget) {
      this.dragTarget.obj.onMouseMove?.(x, y, e);
      return;
    }
    if (hit) hit.obj.onMouseMove?.(x, y, e);
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
    if (this.contextMenu && hit?.obj !== this.contextMenu) this.closeContextMenu();
    if (this.focusedGumpEntry && (!hit || hit.obj !== this.focusedGumpEntry.gump)) this.clearGumpFocus();
    if (hit) {
      if (button === 0 && this.world.target.active && !this.world.held) {
        const target = hit.obj.targetAt?.(x, y);
        if (target) {
          this.sendTargetEntity(target);
          return;
        }
      }
      this.raiseWindow(hit.obj);
      hit.obj.onMouseDown?.(x, y, button, e);
      if (hit.obj.dragging || hit.obj.onMouseMove) this.dragTarget = hit;
      return;
    }
    const arrow = this.game.renderer.questArrowScreen?.();
    if (arrow && !this.world.target.active && !this.world.held && Math.hypot(x - arrow.x, y - arrow.y) <= 12) {
      this.world.socket.out.clickQuestArrow(button === 2);
      if (button === 0) {
        const target = this.world.questArrow;
        if (target) this.game.walkTo(target.x, target.y);
      }
      return;
    }
    if (button === 0) {
      if (this.world.target.active) {
        this.sendTarget(x, y);
        return;
      }
      const tile = this.game.renderer.screenToTile(x, y);
      const entity = this.game.renderer.entityAt?.(x, y) || this.findEntityAt(tile.x, tile.y);
      if (!entity) return;
      if (entity.isItem && entity.container === 0 && !this.world.held) {
        if (e.shiftKey) {
          this.world.held = entity;
          this.world.socket.out.pickup(entity.serial, entity.amount || 1);
        } else if (e.detail < 2) {
          this.worldItemPress = { item: entity, x, y };
        }
        return;
      }
      this.world.socket.out.singleClick(entity.serial);
      return;
    }
    if (button === 2) {
      if (this.world.target.active) {
        this.cancelTarget();
        return;
      }
      if (this.world.held) return;
      const tile = this.game.renderer.screenToTile(x, y);
      const entity = this.game.renderer.entityAt?.(x, y) || this.findEntityAt(tile.x, tile.y);
      if (entity) {
        this.openContextMenu(entity.serial, x, y);
        return;
      }
      this.startMouseWalk();
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
    const renderer = this.game.renderer;
    const ps = renderer.playerScreen();
    const sx = this.mouse.x - (ps.x - renderer.camera.x);
    const sy = this.mouse.y - (ps.y - renderer.camera.y);
    if (sx * sx + sy * sy < 64) return null;
    const angle = Math.atan2(sy, sx);
    const index = Math.round((angle + Math.PI / 4) / (Math.PI / 4));
    return ((index % 8) + 8) % 8;
  }

  onMouseUp(e) {
    if (e.button === 2) this.stopMouseWalk();
    const { x, y } = this.canvasPos(e);
    if (this.dragTarget) {
      this.dragTarget.obj.onMouseUp?.(x, y);
      this.dragTarget = null;
    }
    if (this.worldItemPress) {
      const item = this.worldItemPress.item;
      this.worldItemPress = null;
      this.world.socket.out.singleClick(item.serial);
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
    this.worldItemPress = null;
    const { x, y } = this.canvasPos(e);
    const hit = this.hitTest(x, y);
    if (hit) {
      this.raiseWindow(hit.obj);
      if (this.focusedGumpEntry && hit.obj !== this.focusedGumpEntry.gump) this.clearGumpFocus();
      hit.obj.onDoubleClick?.(x, y);
      return;
    }
    const tile = this.game.renderer.screenToTile(x, y);
    const entity = this.game.renderer.entityAt?.(x, y) || this.findEntityAt(tile.x, tile.y);
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
    if (!t.active) return;
    const pick = this.game.renderer.targetAt?.(mx, my);
    if (pick?.kind === 'entity') {
      this.sendTargetEntity(pick.entity);
      return;
    }
    if (t.type === 4 || t.type === 5 || t.type === 7) return;
    if (t.type === 0 && (!pick || !pick.graphic)) return;
    const tile = this.game.renderer.screenToTile(mx, my);
    const graphic = t.type === 2 || t.multi ? 0 : pick?.graphic || 0;
    const x = t.type === 2 || t.multi ? tile.x : pick?.x ?? tile.x;
    const y = t.type === 2 || t.multi ? tile.y : pick?.y ?? tile.y;
    let z = pick?.z ?? 0;
    if (t.type === 2 || t.multi) {
      const block = this.world.getBlock(tile.x >> 3, tile.y >> 3);
      const cell = block?.cells[((tile.y & 7) << 3) | (tile.x & 7)];
      if (cell) z = cell.z;
    }
    this.world.socket.out.targetXYZ(graphic, x, y, z, t.cursorId, t.cursorType);
    this.lastTarget = { serial: 0, graphic, x, y, z };
    this.world.clearTarget();
    this.onTargetChanged();
  }

  sendTargetEntity(entity) {
    const t = this.world.target;
    if (!t.active || !entity) return false;
    this.world.socket.out.targetObject(entity.serial, entity.graphic, entity.x, entity.y, entity.z, t.cursorId, t.cursorType);
    this.lastTarget = { serial: entity.serial, graphic: entity.graphic, x: entity.x, y: entity.y, z: entity.z };
    this.world.clearTarget();
    this.onTargetChanged();
    return true;
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
    if (this.focusedGumpEntry) return true;
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
        this.cancelModal();
      }
      return;
    }
    if (!$('loginScreen').classList.contains('hidden')) return;
    if (this.isTextInputFocused()) {
      this.clearGumpFocus();
      return;
    }
    if (this.focusedGumpEntry) {
      if (this.focusedGumpEntry.gump.onKeyDown?.(e)) e.preventDefault();
      return;
    }
    const chat = $('chatInput');
    if (e.key === 'Enter') {
      this.journal.show();
      chat.focus();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (this.world.target.active) {
        this.cancelTarget();
      } else if (this.windows.length) {
        const top = this.windows[this.windows.length - 1].obj;
        if (top.canCloseWithEsc !== false) top.close?.();
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

  showModal(title, body, onOk, showCancel = true, onCancel = null) {
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
    this.modalCancel = onCancel || null;
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

  cancelModal() {
    const cb = this.modalCancel;
    this.hideModal();
    cb?.();
  }

  hideModal() {
    $('modalBackdrop').classList.add('hidden');
    this.modalOk = null;
    this.modalCancel = null;
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

function readBuffArgs(r) {
  const length = r.readU16BE();
  if (length > 2) return r.readUnicodeLE(length);
  return r.readUnicodeLE();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
