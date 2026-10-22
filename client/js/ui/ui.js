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
  SkillButtonWindow,
  SpellbookWindow,
  TradeWindow,
  PartyWindow,
  PartyInviteWindow,
  DebugGumpWindow,
  FriendListWindow,
  HouseWindow,
  HealthBarWindow,
  HelpWindow,
  VirtueWindow,
  loadSkillButtons,
  saveSkillButtons,
  saveFriends,
} from '../game/windows.js';
import { Layer } from '../game/entity.js';
import { parseCustomHousePacket } from '../game/housing.js';
import { settings } from '../game/settings.js';
import { BuffBarWindow, buffGraphic } from '../game/buffs.js';
import {
  HotbarWindow,
  hotbarCommandSlot,
  hotbarItemSlot,
  hotbarMacroSlot,
  hotbarSkillSlot,
  hotbarSlotForKey,
  hotbarSpellSlot,
} from '../game/hotbar.js';
import {
  MACRO_POTIONS,
  MACRO_VIRTUES,
  MacroButtonWindow,
  MacroWindow,
  WAIT_FOR_TARGET_MS,
  loadMacroButtons,
  loadMacros,
  macroHasLoop,
  normalizeMacroActions,
  saveMacroButtons,
  saveMacros,
} from '../game/macros.js';
import { findSpellByName } from '../game/spells.js';
import { MapGumpWindow, MinimapWindow, WorldMapWindow } from '../game/maps.js';
import { WaypointWindow, addLocalWaypoint, clearLocalWaypoints, loadLocalWaypoints } from '../game/waypoints.js';
import { Reader } from '../util/binary.js';
import { accountStorageKey } from '../util/ui.js';
import { Journal } from './journal.js';

const $ = (id) => document.getElementById(id);

const OPEN_WINDOWS_STORAGE_BASE = 'legionuo.openwindows.v1';
const PERSISTED_WINDOW_KINDS = new Set([
  'status',
  'skills',
  'hotbar',
  'party',
  'radar',
  'worldmap',
  'waypoints',
  'buffs',
  'friends',
  'paperdoll',
  'container',
]);
const SERVER_WINDOW_KINDS = new Set(['paperdoll', 'container']);
const SERVER_WINDOW_RETRIES = 10;
const SERVER_WINDOW_RETRY_MS = 500;

function openWindowsStorageKey(world) {
  return accountStorageKey(world, OPEN_WINDOWS_STORAGE_BASE);
}

function loadOpenWindows(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(openWindowsStorageKey(world)) || 'null');
    if (!Array.isArray(saved)) return null;
    const entries = [];
    for (const entry of saved) {
      if (!entry || !PERSISTED_WINDOW_KINDS.has(entry.kind) || entry.key == null) continue;
      entries.push({ kind: entry.kind, key: String(entry.key) });
    }
    return entries;
  } catch {
    return null;
  }
}

function saveOpenWindows(world, windows) {
  try {
    const entries = [];
    const seen = new Set();
    for (const entry of windows) {
      if (!PERSISTED_WINDOW_KINDS.has(entry.kind) || entry.key == null) continue;
      const key = String(entry.key);
      const id = `${entry.kind}:${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push({ kind: entry.kind, key });
    }
    localStorage.setItem(openWindowsStorageKey(world), JSON.stringify(entries));
  } catch {
    /* ignore quota errors */
  }
}

function windowRestoreId(kind, key) {
  return `${kind}:${String(key)}`;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.windows = [];
    this.windowPersistence = false;
    this.pendingWindowRestores = new Set();
    this.requestedWindowRestores = new Set();
    this.serverWindowRetryTimer = null;
    this.mouseWalk = false;
    this.worldItemPress = null;
    this.selection = null;
    this.lastTarget = null;
    this.lastObject = 0;
    this.lastSkill = null;
    this.lastSpell = null;
    this.savedHands = { main: 0, off: 0 };
    this.promptMode = false;
    this.chatHistory = [];
    this.chatIndex = -1;
    this.hues = null;
    this.skillInfo = null;
    this.lastStatusRefresh = 0;
    this.statusRequestTime = 0;
    this.nameRequestAt = new Map();
    this.lastNameSweep = 0;
    this.mouse = { x: 0, y: 0 };
    this.gameMouse = { x: 0, y: 0 };
    this.tooltipEl = $('tooltip');
    this.hoverId = null;
    this.hoverSerial = 0;
    this.hoverSince = 0;
    this.tooltipContentKey = '';
    this.gumpDebugWindow = null;
    this.contextMenu = null;
    this.contextMenuRequest = null;
    this.contextMenuTimer = null;
    this.focusedGumpEntry = null;
    this.modalOk = null;
    this.modalCancel = null;
    this.journal = new Journal(this);
    this.journalEntry = { kind: 'journal', key: 'journal', obj: this.journal };
    this.windows.push(this.journalEntry);
    this.macros = null;
    this.macroPlayback = null;
    this.pendingResource = null;
    // Outgoing actions are the single choke point for the "last ..." macro
    // actions, whether they come from the world, a container, the hotbar,
    // the spellbook, a skill button or another macro.
    this.world.socket.out.onDoubleClick = (serial) => this.rememberLastObject(serial);
    this.world.socket.out.onCastSpell = (id) => {
      this.lastSpell = id;
    };
    this.world.socket.out.onUseSkill = (index) => {
      this.lastSkill = index;
    };
    this.world.socket.out.onAttack = (serial) => {
      const mobile = this.world.getMobile(serial);
      if (mobile) {
        this.lastTarget = {
          serial: mobile.serial,
          graphic: mobile.graphic,
          x: mobile.x,
          y: mobile.y,
          z: mobile.z,
        };
      }
    };
    const commands = this.createCommands();
    this.commandDefs = commands.defs;
    this.commandMap = commands.map;
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
    $('btnHotbar')?.addEventListener('click', () => this.toggleHotbar());
    $('btnMacros')?.addEventListener('click', () => this.toggleMacros());
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
    canvas.addEventListener('mouseleave', () => {
      this.worldItemPress = null;
      this.hideTooltip();
    });
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), true);
    window.addEventListener('mousedown', (e) => this.onMouseDown(e), true);
    window.addEventListener('mouseup', (e) => this.onMouseUp(e), true);
    window.addEventListener('dblclick', (e) => this.onDoubleClick(e), true);
    window.addEventListener('contextmenu', (e) => this.onContextMenu(e), true);
    window.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('compositionend', (e) => {
      if (this.focusedGumpEntry?.gump?.insertText?.(e.data)) e.preventDefault?.();
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
      const saved = this.loadSavedLogin();
      if (saved?.remember) {
        if (saved.account) $('account').value = saved.account;
        if (saved.password) $('password').value = saved.password;
        if ($('rememberLogin')) $('rememberLogin').checked = true;
      }
      this.game.assets.loadTileData();
      this.game.assets.loadEquipConv();
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
    const host = this.config?.defaultLoginHost || '127.0.0.1';
    const port = Number(this.config?.defaultLoginPort) || 2593;
    const version = (this.config?.clientVersion || '7.0.116.0').trim();
    if (!account || !password) {
      this.setLoginStatus('Enter an account and password.');
      return;
    }
    this.config.clientVersion = version;
    this.game.config.clientVersion = version;
    const remember = !!$('rememberLogin')?.checked;
    this.saveLogin(remember ? { account, password, remember: true } : { remember: false });
    this.setLoginStatus('Connecting...');
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
      settings.setAccount(this.game.loginCredentials?.account || '');
      this.journal.setAccount(this.game.loginCredentials?.account || '');
      this.macros = null;
      this.journal.clear();
      this.journal.show();
      this.addJournal('Welcome to LegionUO.', '#d6b45d', true);
      this.restoreOpenWindows();
    }
    this.cancelMacroPlayback();
    this.lastTarget = null;
    this.lastObject = 0;
    this.lastSkill = null;
    this.lastSpell = null;
    this.savedHands = { main: 0, off: 0 };
    this.world.localWaypoints = loadLocalWaypoints(this.world);
    this.refreshStatus();
    this.refreshSkills();
    this.world.alwaysRun = !!settings.get('alwaysRun');
    this.restoreSkillButtons();
    this.restoreMacroButtons();
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
    this.cancelMacroPlayback();
    this.closeMacros();
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

  createSkillButton(skill, x, y, persist = true) {
    if (!skill || skill.hasAction === false) return null;
    const index = Number(skill.index);
    if (!Number.isFinite(index) || index < 0) return null;
    const existing = this.getWindow('skillbutton', index);
    if (existing) {
      this.raiseWindow(existing);
      return existing;
    }
    const window = new SkillButtonWindow(this.world, skill, x, y);
    this.addWindow('skillbutton', index, window);
    this.raiseWindow(window);
    if (persist) this.persistSkillButtons();
    return window;
  }

  removeSkillButton(index) {
    this.removeWindow('skillbutton', index);
    this.persistSkillButtons();
  }

  restoreSkillButtons() {
    const saved = loadSkillButtons(this.world);
    for (const entry of saved) {
      const index = Number(entry?.index);
      if (!Number.isFinite(index) || index < 0) continue;
      const info =
        this.skillInfo?.find((skill) => Number(skill.index) === index) ||
        this.world.skillList?.find((skill) => Number(skill.index) === index);
      if (info && info.hasAction === false) continue;
      const x = Number(entry.x);
      const y = Number(entry.y);
      this.createSkillButton(
        { index, name: entry.name || info?.name, hasAction: info?.hasAction },
        Number.isFinite(x) ? x : 40,
        Number.isFinite(y) ? y : 40,
        false
      );
    }
  }

  persistSkillButtons() {
    const buttons = this.windows
      .filter((entry) => entry.kind === 'skillbutton')
      .map((entry) => ({
        index: entry.obj.skill.index,
        name: entry.obj.skill.name,
        x: Math.round(entry.obj.x),
        y: Math.round(entry.obj.y),
      }));
    saveSkillButtons(this.world, buttons);
  }

  createMacroButton(name, x, y, persist = true) {
    if (!String(name || '').trim() || !this.getMacros()[name]) return null;
    const existing = this.getWindow('macrobutton', name);
    if (existing) {
      this.raiseWindow(existing);
      return existing;
    }
    const window = new MacroButtonWindow(this.world, name, x, y);
    this.addWindow('macrobutton', name, window);
    this.raiseWindow(window);
    if (persist) this.persistMacroButtons();
    return window;
  }

  removeMacroButton(name) {
    this.removeWindow('macrobutton', name);
    this.persistMacroButtons();
  }

  renameMacroButton(oldName, newName) {
    const window = this.getWindow('macrobutton', oldName);
    if (!window) return;
    this.removeWindow('macrobutton', oldName);
    window.name = newName;
    this.addWindow('macrobutton', newName, window);
    this.persistMacroButtons();
  }

  restoreMacroButtons() {
    const saved = loadMacroButtons(this.world);
    for (const entry of saved) {
      this.createMacroButton(entry.name, entry.x, entry.y, false);
    }
    this.persistMacroButtons();
  }

  persistMacroButtons() {
    const buttons = this.windows
      .filter((entry) => entry.kind === 'macrobutton')
      .map((entry) => ({
        name: entry.obj.name,
        x: Math.round(entry.obj.x),
        y: Math.round(entry.obj.y),
      }));
    saveMacroButtons(this.world, buttons);
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

  showFriends() {
    if (!this.world.player) return;
    const existing = this.getWindow('friends', 'player');
    if (existing) {
      this.raiseWindow(existing);
      return;
    }
    this.addWindow('friends', 'player', new FriendListWindow(this.world));
  }

  toggleFriends() {
    if (this.getWindow('friends', 'player')) this.removeWindow('friends', 'player');
    else this.showFriends();
  }

  friendCommand(args) {
    const sub = String(args[0] || '').toLowerCase();
    const name = args.slice(1).join(' ').trim();
    if (!sub || sub === 'help') {
      this.showFriends();
      return;
    }
    const window = this.getWindow('friends', 'player') || (this.showFriends(), this.getWindow('friends', 'player'));
    if (!window) return;
    if (sub === 'add') {
      if (!name) {
        this.addJournal('Usage: -friend add <name>', '#c56a4a', true);
        return;
      }
      if (!window.friends.some((friend) => friend.toLowerCase() === name.toLowerCase())) {
        window.friends.push(name);
        saveFriends(this.world, window.friends);
      }
      this.addJournal(`Added ${name} to friends.`, '#b8a06a', true);
      return;
    }
    if (sub === 'remove' || sub === 'delete') {
      const before = window.friends.length;
      window.friends = window.friends.filter((friend) => friend.toLowerCase() !== name.toLowerCase());
      saveFriends(this.world, window.friends);
      this.addJournal(before === window.friends.length ? `No friend named ${name}.` : `Removed ${name}.`, before === window.friends.length ? '#c56a4a' : '#b8a06a', true);
      return;
    }
    if (sub === 'list') {
      this.addJournal(window.friends.length ? `Friends: ${window.friends.join(', ')}` : 'No friends added.', '#b8a06a', true);
      return;
    }
    this.addJournal(`Unknown friend command: ${sub}`, '#c56a4a', true);
  }

  showHotbar() {
    if (!this.world.player) return null;
    const existing = this.getWindow('hotbar', 'player');
    if (existing) {
      this.raiseWindow(existing);
      return existing;
    }
    const window = new HotbarWindow(this.world);
    this.addWindow('hotbar', 'player', window);
    return window;
  }

  toggleHotbar() {
    if (this.getWindow('hotbar', 'player')) this.closeHotbar();
    else this.showHotbar();
  }

  closeHotbar() {
    this.removeWindow('hotbar', 'player');
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

  sendSpeech(text, mode = this.journal.settings.mode || 'say') {
    if (mode === 'party') {
      this.world.socket.out.partyMessage(text);
      return;
    }
    const types = { say: 0, emote: 2, whisper: 8, yell: 9, guild: 13, alliance: 14 };
    this.world.socket.out.unicodeSpeech(text, types[mode] ?? 0, 3, 0x3b2, this.journal.settings.language || 'ENU');
  }

  historyStep(delta) {
    if (!this.chatHistory.length) return;
    this.chatIndex = Math.max(0, Math.min(this.chatHistory.length, this.chatIndex + delta));
    $('chatInput').value = this.chatHistory[this.chatIndex] || '';
  }

  command(text) {
    const trimmed = String(text || '').slice(1).trim();
    if (!trimmed) return;
    const [cmd, ...args] = trimmed.split(/\s+/);
    const def = this.commandMap.get(cmd.toLowerCase());
    if (!def) {
      this.addJournal(`Unknown command: -${cmd}`, '#c56a4a', true);
      return;
    }
    def.run(args, cmd.toLowerCase());
  }

  showHelp(args) {
    const topic = String(args[0] || '').replace(/^-/, '').toLowerCase();
    if (topic) {
      const def = this.commandMap.get(topic);
      if (!def) {
        this.addJournal(`Unknown command: -${topic}`, '#c56a4a', true);
        return;
      }
      this.addJournal(`${def.usage} — ${def.description}`, '#b8a06a', true);
      return;
    }
    const existing = this.getWindow('help', 'player');
    if (existing) {
      existing.commands = this.commandDefs;
      this.raiseWindow(existing);
      return;
    }
    this.addWindow('help', 'player', new HelpWindow(this.world, this.commandDefs));
  }

  createCommands() {
    const defs = [
      {
        name: 'help',
        usage: '-help [command]',
        description: 'Show all commands, or details for a single command.',
        run: (args) => this.showHelp(args),
      },
      {
        name: 'say',
        aliases: ['whisper', 'yell', 'emote', 'party', 'guild', 'alliance'],
        usage: '-say | -whisper | -yell | -emote | -party | -guild | -alliance',
        description: 'Set the chat speech mode.',
        run: (args, cmd) => {
          this.journal.settings.mode = cmd;
          this.journal.save();
          this.journal.applySettings();
          this.addJournal(`Speech mode: ${cmd}`, '#b8a06a', true);
        },
      },
      {
        name: 'journal',
        usage: '-journal',
        description: 'Toggle the journal window.',
        run: () => this.journal.toggle(),
      },
      {
        name: 'clear',
        usage: '-clear',
        description: 'Clear the journal log.',
        run: () => this.journal.clear(),
      },
      {
        name: 'ignore',
        usage: '-ignore <name>',
        description: 'Ignore chat from a player.',
        run: (args) => {
          const name = args.join(' ').trim();
          if (!name) this.command('-ignorelist');
          else if (this.journal.addIgnore(name)) this.addJournal(`Ignoring ${name}.`, '#b8a06a', true);
        },
      },
      {
        name: 'unignore',
        usage: '-unignore <name>',
        description: 'Stop ignoring a player.',
        run: (args) => {
          const name = args.join(' ').trim();
          if (this.journal.removeIgnore(name)) this.addJournal(`No longer ignoring ${name}.`, '#b8a06a', true);
        },
      },
      {
        name: 'ignorelist',
        usage: '-ignorelist',
        description: 'Show ignored players.',
        run: () => {
          const list = this.journal.settings.ignore;
          this.addJournal(list.length ? `Ignored: ${list.join(', ')}` : 'Ignore list is empty.', '#b8a06a', true);
        },
      },
      {
        name: 'export',
        usage: '-export',
        description: 'Export the journal log to a file.',
        run: () => {
          this.journal.exportLog();
          this.addJournal('Journal exported.', '#b8a06a', true);
        },
      },
      {
        name: 'gumpfont',
        usage: '-gumpfont <0-9>',
        description: 'Set the gump font size.',
        run: (args) => {
          const value = Number.parseInt(args[0], 10);
          if (Number.isFinite(value)) {
            settings.set('gumpFont', Math.max(0, Math.min(9, value)));
            this.addJournal(`Gump font: ${settings.get('gumpFont')}`, '#b8a06a', true);
          } else {
            this.addJournal(`Gump font: ${settings.get('gumpFont')} (usage: -gumpfont 0-9)`, '#b8a06a', true);
          }
        },
      },
      {
        name: 'lang',
        aliases: ['language'],
        usage: '-lang <code>',
        description: 'Set the speech language code (e.g. ENU).',
        run: (args) => {
          const code = String(args[0] || '').toUpperCase().slice(0, 3);
          if (!code) {
            this.addJournal(`Language: ${this.journal.settings.language}`, '#b8a06a', true);
          } else {
            this.journal.settings.language = code;
            this.journal.save();
            this.addJournal(`Language: ${code}`, '#b8a06a', true);
          }
        },
      },
      {
        name: 'chat',
        usage: '-chat <join|create|leave|msg|list|open> ...',
        description: 'Manage chat channels.',
        run: (args) => this.chatCommand(args),
      },
      {
        name: 'macro',
        aliases: ['macros'],
        usage: '-macro [edit] | list | play <name> | stop | delete <name>',
        description: 'Create, edit, and play macros.',
        run: (args) => this.macroCommand(args),
      },
      {
        name: 'timestamps',
        usage: '-timestamps',
        description: 'Toggle timestamps in the journal.',
        run: () => {
          this.journal.settings.timestamps = !this.journal.settings.timestamps;
          this.journal.save();
          this.journal.applySettings();
        },
      },
      {
        name: 'debug',
        usage: '-debug',
        description: 'Toggle debug mode, including hovered object borders.',
        run: () => {
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
        },
      },
      {
        name: 'skills',
        usage: '-skills',
        description: 'Toggle the skills window.',
        run: () => this.toggleSkills(),
      },
      {
        name: 'status',
        usage: '-status',
        description: 'Open your status window.',
        run: () => this.showStatus(),
      },
      {
        name: 'options',
        aliases: ['settings'],
        usage: '-options',
        description: 'Open the options window.',
        run: () => this.showOptions(),
      },
      {
        name: 'buffs',
        usage: '-buffs [row|column|small|large]',
        description: 'Toggle the buff bar or change its layout.',
        run: (args) => {
          const option = String(args[0] || '').toLowerCase();
          if (['row', 'column', 'small', 'large', 'normal'].includes(option)) {
            this.showBuffs();
            this.getWindow('buffs', 'player')?.configure(option);
            this.addJournal(`Buffs layout: ${option}`, '#b8a06a', true);
          } else {
            this.toggleBuffs();
          }
        },
      },
      {
        name: 'friends',
        aliases: ['friend'],
        usage: '-friends [add|remove|list] [name]',
        description: 'Manage your friend list.',
        run: (args) => this.friendCommand(args),
      },
      {
        name: 'hotbar',
        usage: '-hotbar <set|clear|use> ...',
        description: 'Configure hotbar slots, spells, skills, macros and commands.',
        run: (args) => this.hotbarCommand(args),
      },
      {
        name: 'partywindow',
        usage: '-partywindow',
        description: 'Toggle the party window.',
        run: () => this.toggleParty(),
      },
      {
        name: 'radar',
        aliases: ['minimap'],
        usage: '-radar',
        description: 'Toggle the radar minimap.',
        run: () => this.toggleRadar(),
      },
      {
        name: 'worldmap',
        aliases: ['map'],
        usage: '-worldmap',
        description: 'Toggle the world map.',
        run: () => this.toggleWorldMap(),
      },
      {
        name: 'waypoints',
        aliases: ['waypoint', 'wp'],
        usage: '-waypoints | -waypoint add [x y] [name] | -waypoint clear',
        description: 'Show waypoints, or add/clear local waypoints.',
        run: (args) => {
          const sub = (args[0] || '').toLowerCase();
          if (sub === 'add') {
            const rest = args.slice(1);
            const hasCoords =
              rest.length >= 2 &&
              rest[0] !== '' &&
              rest[1] !== '' &&
              Number.isFinite(Number(rest[0])) &&
              Number.isFinite(Number(rest[1]));
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
        },
      },
      {
        name: 'virtue',
        usage: '-virtue',
        description: 'Open the virtues window.',
        run: () => {
          const existing = this.getWindow('virtue', 'player');
          if (existing) this.raiseWindow(existing);
          else this.addWindow('virtue', 'player', new VirtueWindow(this.world));
        },
      },
      {
        name: 'quest',
        aliases: ['questlog'],
        usage: '-quest',
        description: 'Open the quest log.',
        run: () => this.world.socket.out.questMenu(),
      },
      {
        name: 'guildmenu',
        usage: '-guildmenu',
        description: 'Open the guild menu.',
        run: () => this.world.socket.out.guildMenu(),
      },
      {
        name: 'house',
        usage: '-house <serial>',
        description: 'Open a house sign by serial.',
        run: (args) => {
          const serial = Number.parseInt(args[0], 0);
          if (Number.isFinite(serial)) this.showHouse(serial >>> 0);
          else this.addJournal('Usage: -house <house sign serial>', '#c56a4a', true);
        },
      },
      {
        name: 'profile',
        usage: '-profile',
        description: 'Open your character profile.',
        run: () => {
          if (this.world.player) this.world.socket.out.profileRequest(this.world.playerSerial);
        },
      },
      {
        name: 'where',
        usage: '-where',
        description: 'Print your current position.',
        run: () =>
          this.addJournal(
            `Position: ${this.world.player.x}, ${this.world.player.y}, ${this.world.player.z}`,
            '#b8a06a',
            true
          ),
      },
      {
        name: 'war',
        usage: '-war',
        description: 'Enter war mode.',
        run: () => {
          this.world.player.inWarMode = true;
          this.world.socket.out.warMode(true);
        },
      },
      {
        name: 'peace',
        usage: '-peace',
        description: 'Enter peace mode.',
        run: () => {
          this.world.player.inWarMode = false;
          this.world.socket.out.warMode(false);
        },
      },
      {
        name: 'run',
        aliases: ['walk'],
        usage: '-run | -walk',
        description: 'Always run or always walk.',
        run: (args, cmd) => {
          this.world.alwaysRun = cmd === 'run';
          settings.set('alwaysRun', this.world.alwaysRun);
          this.addJournal(`Movement: ${cmd === 'run' ? 'run' : 'walk'}`, '#b8a06a', true);
        },
      },
      {
        name: 'resync',
        usage: '-resync',
        description: 'Resync your position with the server.',
        run: () => this.world.socket.out.resync(),
      },
      {
        name: 'logout',
        usage: '-logout',
        description: 'Log out to the character selection screen.',
        run: () => this.logout(),
      },
      {
        name: 'open',
        usage: '-open <backpack|worldmap|radar>',
        description: 'Open your backpack, world map or radar.',
        run: (args) => {
          const alias = args[0] || '';
          if (alias === 'backpack') {
            const backpack = this.world.player.getItem(Layer.Backpack);
            if (backpack) this.world.socket.out.doubleClick(backpack.serial);
          } else if (alias === 'worldmap' || alias === 'map') {
            this.toggleWorldMap();
          } else if (alias === 'radar' || alias === 'minimap') {
            this.toggleRadar();
          }
        },
      },
      {
        name: 'target',
        usage: '-target [self|nearest|last|resource <type>]',
        description: 'Start a target cursor, or target self/nearest/last.',
        run: (args) => {
          const sub = String(args[0] || '').toLowerCase();
          if (sub === 'self') {
            this.sendTargetEntity(this.world.player);
          } else if (sub === 'last' || sub === 'lasttarget') {
            this.useLastTarget();
          } else if (sub === 'nearest') {
            let best = null;
            let bestDist = Infinity;
            for (const entity of this.world.entities.values()) {
              if (!entity.isMobile || entity === this.world.player) continue;
              const dist = Math.max(
                Math.abs(entity.x - this.world.player.x),
                Math.abs(entity.y - this.world.player.y)
              );
              if (dist < bestDist) {
                bestDist = dist;
                best = entity;
              }
            }
            if (best) {
              this.world.setTarget(1, 0, 0);
              this.onTargetChanged();
              this.sendTargetEntity(best);
            } else {
              this.addJournal('No nearby mobile.', '#c56a4a', true);
            }
          } else if (sub === 'resource') {
            const type = Number.parseInt(args[1], 0) || 0;
            this.pendingResource = type;
            this.world.setTarget(1, 0, 0);
            this.onTargetChanged();
            this.addJournal(`Select a resource target (type ${type}).`, '#b8a06a', true);
          } else {
            this.world.setTarget(1, 0, 0);
            this.onTargetChanged();
          }
        },
      },
      {
        name: 'targetresource',
        usage: '-targetresource <type>',
        description: 'Target a resource with the given type id.',
        run: (args) => {
          const type = Number.parseInt(args[0], 0) || 0;
          this.pendingResource = type;
          this.world.setTarget(1, 0, 0);
          this.onTargetChanged();
        },
      },
      {
        name: 'lasttarget',
        aliases: ['last'],
        usage: '-lasttarget',
        description: 'Target your last target again.',
        run: () => this.useLastTarget(),
      },
    ];

    const map = new Map();
    for (const def of defs) {
      map.set(def.name, def);
      for (const alias of def.aliases || []) map.set(alias, def);
    }
    return { defs, map };
  }

  hotbarCommand(args) {
    const sub = String(args[0] || '').toLowerCase();
    if (!sub) {
      this.toggleHotbar();
      return;
    }
    const window = this.showHotbar();
    if (!window) return;
    const usage =
      'Usage: -hotbar [set n item <serial>|spell <name>|skill <name>|command <text>|macro <name> | clear [n] | use n]';
    const slotNumber = Number.parseInt(args[1], 10);
    const index = Number.isFinite(slotNumber) ? slotNumber - 1 : -1;
    if (sub === 'clear') {
      if (index >= 0 && index < window.slots.length) {
        window.clearSlot(index);
        this.addJournal(`Cleared hotbar slot ${index + 1}.`, '#b8a06a', true);
      } else if (index < 0) {
        for (let i = 0; i < window.slots.length; i++) window.clearSlot(i);
        this.addJournal('Cleared all hotbar slots.', '#b8a06a', true);
      } else {
        this.addJournal(usage, '#c56a4a', true);
      }
      return;
    }
    if (index < 0 || index >= window.slots.length) {
      this.addJournal(usage, '#c56a4a', true);
      return;
    }
    if (sub === 'use') {
      if (!window.use(index)) this.addJournal(`Hotbar slot ${index + 1} is empty.`, '#c56a4a', true);
      return;
    }
    if (sub !== 'set') {
      this.addJournal(usage, '#c56a4a', true);
      return;
    }
    const type = String(args[2] || '').toLowerCase();
    const rest = args.slice(3).join(' ').trim();
    let slot = null;
    if (type === 'item') {
      const serial = Number.parseInt(rest, /^0x/i.test(rest) ? 16 : 10);
      const item = Number.isFinite(serial) ? this.world.getItem(serial >>> 0) : null;
      if (!item) {
        this.addJournal('No item with that serial is loaded. Drag an item onto a slot instead.', '#c56a4a', true);
        return;
      }
      slot = hotbarItemSlot(item);
    } else if (type === 'spell') {
      const spell = findSpellByName(rest);
      if (!spell) {
        this.addJournal(`Unknown spell: ${rest || '(none)'}`, '#c56a4a', true);
        return;
      }
      slot = hotbarSpellSlot(spell);
    } else if (type === 'skill') {
      const needle = rest.toLowerCase();
      const skills = this.skillInfo?.length ? this.skillInfo : this.world.skillList || [];
      const skill =
        skills.find((entry) => (entry.name || '').toLowerCase() === needle) ||
        skills.find((entry) => (entry.name || '').toLowerCase().includes(needle));
      if (!skill) {
        this.addJournal(`Unknown skill: ${rest || '(none)'}`, '#c56a4a', true);
        return;
      }
      slot = hotbarSkillSlot(skill);
    } else if (type === 'command') {
      slot = hotbarCommandSlot(rest, rest.replace(/^-/, ''));
    } else if (type === 'macro') {
      const macros = this.getMacros();
      const macro = macros[rest];
      if (!macro?.actions?.length) {
        this.addJournal(`Unknown macro: ${rest || '(none)'}`, '#c56a4a', true);
        return;
      }
      slot = hotbarMacroSlot(rest, macro.actions);
    } else {
      this.addJournal(usage, '#c56a4a', true);
      return;
    }
    if (slot && window.setSlot(index, slot)) {
      this.addJournal(`Hotbar slot ${index + 1}: ${slot.name}.`, '#b8a06a', true);
    }
  }

  getMacros() {
    if (!this.macros) this.macros = loadMacros(this.world);
    return this.macros;
  }

  showMacros() {
    if (!this.world.player) return null;
    const existing = this.getWindow('macros', 'player');
    if (existing) {
      this.raiseWindow(existing);
      return existing;
    }
    const window = new MacroWindow(this.world, () => this.removeWindow('macros', 'player'));
    this.addWindow('macros', 'player', window);
    return window;
  }

  toggleMacros() {
    if (this.getWindow('macros', 'player')) this.closeMacros();
    else this.showMacros();
  }

  closeMacros() {
    const window = this.getWindow('macros', 'player');
    this.removeWindow('macros', 'player');
    window?.close?.();
  }

  playMacro(name) {
    const macro = this.getMacros()[name];
    if (!macro?.actions?.length) {
      this.addJournal(`Unknown or empty macro: ${name || '(none)'}`, '#c56a4a', true);
      return false;
    }
    return this.playMacroActions(macro.actions, name);
  }

  playMacroActions(actions, name = 'Macro') {
    const steps = normalizeMacroActions(actions);
    if (!steps.length) {
      this.addJournal(`Macro ${name} has no actions.`, '#c56a4a', true);
      return false;
    }
    // A loop macro is a toggle: pressing it again stops the running loop.
    if (this.macroPlayback?.name === name && macroHasLoop(steps)) {
      this.cancelMacroPlayback(`Macro ${name} stopped.`);
      return true;
    }
    this.cancelMacroPlayback();
    this.macroPlayback = {
      name,
      stack: [{ actions: steps, index: 0, loop: null }],
      timer: 0,
      retries: 0,
      waitDeadline: 0,
    };
    this.addJournal(`Playing macro ${name}.`, '#b8a06a', true);
    this.stepMacroPlayback();
    return true;
  }

  cancelMacroPlayback(reason = '') {
    if (!this.macroPlayback) return;
    clearTimeout(this.macroPlayback.timer);
    this.macroPlayback = null;
    if (reason) this.addJournal(reason, '#c56a4a', true);
  }

  stopMacroPlayback(playback, message) {
    this.cancelMacroPlayback(`Macro ${playback.name} stopped: ${message}`);
    return null;
  }

  stepMacroPlayback() {
    const playback = this.macroPlayback;
    if (!playback) return;
    let guard = 0;
    while (this.macroPlayback === playback) {
      // Guards against an empty loop chain spinning the browser.
      if (guard++ > 10000) {
        this.cancelMacroPlayback(`Macro ${playback.name} stopped: loop did not make progress.`);
        return;
      }
      const frame = playback.stack[playback.stack.length - 1];
      if (!frame) {
        this.macroPlayback = null;
        this.addJournal(`Macro ${playback.name} finished.`, '#b8a06a', true);
        return;
      }
      if (frame.index >= frame.actions.length) {
        if (frame.loop) {
          const next = frame.loop.iteration + 1;
          if (frame.loop.infinite || next < frame.loop.count) {
            frame.loop.iteration = next;
            frame.index = 0;
            if (frame.loop.delay > 0) {
              playback.timer = setTimeout(() => this.stepMacroPlayback(), frame.loop.delay);
              return;
            }
            continue;
          }
        }
        playback.stack.pop();
        continue;
      }

      const action = frame.actions[frame.index];
      const result = this.runMacroAction(playback, action);
      if (!result || this.macroPlayback !== playback) return;
      if (result.retry) {
        playback.timer = setTimeout(() => this.stepMacroPlayback(), result.delay);
        return;
      }
      frame.index += 1;
      if (result.push) {
        playback.stack.push({ actions: result.push, index: 0, loop: result.loop });
        continue;
      }
      playback.timer = setTimeout(() => this.stepMacroPlayback(), result.delay ?? 140);
      return;
    }
  }

  runMacroAction(playback, action) {
    if (action.type === 'say' || action.type === 'emote' || action.type === 'whisper' || action.type === 'yell') {
      this.sendSpeech(action.text, action.type);
      return { delay: 140 };
    }

    switch (action.type) {
      case 'command':
        this.command(action.command);
        return { delay: 140 };

      case 'wait':
        return { delay: action.ms };

      case 'waitForTarget':
        if (this.world.target.active) {
          playback.waitDeadline = 0;
          return { delay: 100 };
        }
        if (!playback.waitDeadline) playback.waitDeadline = performance.now() + WAIT_FOR_TARGET_MS;
        if (performance.now() >= playback.waitDeadline) {
          return this.stopMacroPlayback(
            playback,
            `no target cursor within ${WAIT_FOR_TARGET_MS / 1000} seconds.`
          );
        }
        return { retry: true, delay: 100 };

      case 'targetLast':
        if (!this.useLastTarget()) {
          return this.stopMacroPlayback(playback, 'no target cursor or previous target.');
        }
        playback.waitDeadline = 0;
        return { delay: 140 };

      case 'targetSelf':
        if (this.world.target.active && this.world.player) {
          const previous = this.lastTarget;
          this.sendTargetEntity(this.world.player);
          // Targeting yourself should not replace the last enemy target.
          this.lastTarget = previous;
          playback.waitDeadline = 0;
        }
        return { delay: 140 };

      case 'targetNext': {
        const next = this.findNextMobile();
        if (!next) return this.stopMacroPlayback(playback, 'no nearby mobile.');
        if (this.world.target.active) {
          this.sendTargetEntity(next);
          playback.waitDeadline = 0;
        } else {
          this.lastTarget = {
            serial: next.serial,
            graphic: next.graphic,
            x: next.x,
            y: next.y,
            z: next.z,
          };
        }
        return { delay: 140 };
      }

      case 'attackLast': {
        const last = this.lastTarget?.serial ? this.world.getMobile(this.lastTarget.serial) : null;
        if (!last) return this.stopMacroPlayback(playback, 'no last target.');
        this.world.socket.out.attack(last.serial);
        return { delay: 140 };
      }

      case 'lastObject': {
        const object = this.lastObject ? this.world.get(this.lastObject) : null;
        if (!object) return this.stopMacroPlayback(playback, 'no last object.');
        this.world.socket.out.doubleClick(object.serial);
        return { delay: 140 };
      }

      case 'useItemInHand': {
        const player = this.world.player;
        const item = player?.getItem(Layer.OneHanded) || player?.getItem(Layer.TwoHanded);
        if (!item) return this.stopMacroPlayback(playback, 'nothing is equipped in your hands.');
        this.world.socket.out.doubleClick(item.serial);
        return { delay: 140 };
      }

      case 'useObject': {
        const item = this.findPlayerItem(
          (entry) =>
            entry.graphic === action.graphic && (action.hue == null || entry.hue === action.hue)
        );
        if (!item) {
          return this.stopMacroPlayback(
            playback,
            `no item with graphic 0x${action.graphic.toString(16)} in your backpack.`
          );
        }
        this.world.socket.out.doubleClick(item.serial);
        return { delay: 140 };
      }

      case 'usePotion': {
        const potion = this.findPotion(action.potion);
        if (!potion) return this.stopMacroPlayback(playback, 'no matching potion in your backpack.');
        this.world.socket.out.doubleClick(potion.serial);
        return { delay: 140 };
      }

      case 'useSkill': {
        const skill = this.findSkill(action.skill);
        if (!skill) return this.stopMacroPlayback(playback, `unknown skill: ${action.skill}.`);
        this.lastSkill = skill.index;
        this.world.socket.out.useSkill(skill.index);
        return { delay: 140 };
      }

      case 'lastSkill':
        if (this.lastSkill == null) return this.stopMacroPlayback(playback, 'no last skill.');
        this.world.socket.out.useSkill(this.lastSkill);
        return { delay: 140 };

      case 'castSpell': {
        const spell = findSpellByName(action.spell);
        if (!spell) return this.stopMacroPlayback(playback, `unknown spell: ${action.spell}.`);
        this.lastSpell = spell.id;
        this.world.socket.out.castSpell(spell.id);
        return { delay: 140 };
      }

      case 'lastSpell':
        if (this.lastSpell == null) return this.stopMacroPlayback(playback, 'no last spell.');
        this.world.socket.out.castSpell(this.lastSpell);
        return { delay: 140 };

      case 'bandageSelf': {
        const player = this.world.player;
        const bandage = this.findBandage();
        if (!player || !bandage) {
          return this.stopMacroPlayback(playback, 'no bandages in your backpack.');
        }
        this.world.socket.out.targetSelectedObject(bandage.serial, player.serial);
        this.lastObject = bandage.serial;
        return { delay: 200 };
      }

      case 'combatAbility':
        this.world.socket.out.useCombatAbility(action.ability);
        return { delay: 140 };

      case 'equipLastWeapon':
        this.world.socket.out.equipLastWeapon();
        return { delay: 140 };

      case 'clearHands': {
        const player = this.world.player;
        if (!player) return { delay: 140 };
        const main = player.getItem(Layer.OneHanded);
        const off = player.getItem(Layer.TwoHanded);
        this.savedHands = { main: main?.serial || 0, off: off?.serial || 0 };
        const layers = [];
        if (main) layers.push(Layer.OneHanded);
        if (off) layers.push(Layer.TwoHanded);
        if (layers.length) this.world.socket.out.unequipMacroKR(layers);
        return { delay: 140 };
      }

      case 'equipHands': {
        const serials = [this.savedHands.main, this.savedHands.off].filter(Boolean);
        const items = serials
          .map((serial) => this.world.getItem(serial))
          .filter((item) => item && item.container !== this.world.player?.serial);
        if (items.length) this.world.socket.out.equipMacroKR(items.map((item) => item.serial));
        return { delay: 140 };
      }

      case 'warPeace':
        this.toggleWarMode();
        return { delay: 140 };

      case 'invokeVirtue': {
        const virtue = MACRO_VIRTUES.find((entry) => entry.value === action.virtue);
        if (!virtue) return this.stopMacroPlayback(playback, `unknown virtue: ${action.virtue}.`);
        this.world.socket.out.invokeVirtue(virtue.id);
        return { delay: 140 };
      }

      case 'openDoor':
        this.world.socket.out.openDoor();
        return { delay: 140 };

      case 'toggleMount': {
        const player = this.world.player;
        const mount = player?.mount || player?.getItem(Layer.Mount);
        if (!mount) return this.stopMacroPlayback(playback, 'you are not mounted.');
        this.world.socket.out.doubleClick(mount.serial);
        return { delay: 140 };
      }

      case 'resync':
        this.world.socket.out.resync();
        return { delay: 140 };

      case 'alwaysRun':
        this.world.alwaysRun = !this.world.alwaysRun;
        settings.set('alwaysRun', this.world.alwaysRun);
        this.addJournal(`Movement: ${this.world.alwaysRun ? 'run' : 'walk'}`, '#b8a06a', true);
        return { delay: 140 };

      case 'names':
        settings.toggle('showNames');
        this.addJournal(`Names: ${settings.get('showNames') ? 'on' : 'off'}`, '#b8a06a', true);
        return { delay: 140 };

      case 'useHotbar': {
        const hotbar = this.getWindow('hotbar', 'player') || this.showHotbar();
        if (!hotbar) return this.stopMacroPlayback(playback, 'no hotbar is available.');
        if (!hotbar.use(action.slot - 1)) {
          return this.stopMacroPlayback(playback, `hotbar slot ${action.slot} is empty.`);
        }
        return { delay: 140 };
      }

      case 'move':
        if (!this.world.walk(action.direction, false)) {
          playback.retries += 1;
          if (playback.retries > 60) {
            return this.stopMacroPlayback(playback, 'movement was blocked.');
          }
          return { retry: true, delay: 50 };
        }
        playback.retries = 0;
        return { delay: Math.max(120, this.world.stepDuration(false)) };

      case 'loop':
        if (!action.actions.length) return { delay: 0 };
        return {
          push: action.actions,
          loop: {
            iteration: 0,
            count: action.count,
            delay: action.delay,
            infinite: action.count === 0,
          },
        };
    }

    return { delay: 140 };
  }

  rememberLastObject(serial) {
    const entity = this.world.get(serial);
    if (!entity) return;
    if (entity.isItem || (entity.isMobile && entity.name)) this.lastObject = entity.serial;
  }

  findPlayerItem(predicate) {
    const player = this.world.player;
    if (!player) return null;
    const seen = new Set();
    const visit = (parent) => {
      for (const item of parent.items.values()) {
        if (seen.has(item.serial)) continue;
        seen.add(item.serial);
        if (predicate(item)) return item;
        const nested = visit(item);
        if (nested) return nested;
      }
      return null;
    };
    return visit(player);
  }

  findBandage() {
    return this.findPlayerItem((item) => item.graphic === 0x0e21);
  }

  findPotion(potionKey) {
    const potion = MACRO_POTIONS.find((entry) => entry.value === potionKey) || MACRO_POTIONS[0];
    return this.findPlayerItem((item) => item.graphic === potion.graphic);
  }

  findSkill(query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return null;
    const skills = this.skillInfo?.length ? this.skillInfo : this.world.skillList || [];
    if (Number.isFinite(Number(needle))) {
      const byIndex = skills.find((skill) => Number(skill.index) === Number(needle));
      if (byIndex) return byIndex;
    }
    return (
      skills.find((skill) => String(skill.name || '').toLowerCase() === needle) ||
      skills.find((skill) => String(skill.name || '').toLowerCase().includes(needle)) ||
      null
    );
  }

  findNextMobile() {
    const player = this.world.player;
    if (!player) return null;
    const mobiles = [...this.world.entities.values()]
      .filter((entity) => entity.isMobile && entity !== player && !entity.isDead)
      .sort((a, b) => a.serial - b.serial);
    if (!mobiles.length) return null;
    const index = this.lastTarget?.serial
      ? mobiles.findIndex((mobile) => mobile.serial === this.lastTarget.serial)
      : -1;
    return mobiles[(index + 1) % mobiles.length];
  }

  macroCommand(args) {
    const sub = String(args[0] || '').toLowerCase();
    const name = args.slice(1).join(' ').trim();
    const macros = this.getMacros();
    if (!sub) {
      this.showMacros();
      return;
    }
    if (sub === 'help') {
      this.addJournal(
        'Macros: -macro [edit] | list | play <name> | stop | delete <name>',
        '#b8a06a',
        true
      );
      return;
    }
    if (sub === 'edit' || sub === 'ui' || sub === 'window') {
      this.showMacros();
      return;
    }
    if (sub === 'stop') {
      if (!this.macroPlayback) {
        this.addJournal('No macro is playing.', '#c56a4a', true);
        return;
      }
      this.cancelMacroPlayback('Macro stopped.');
      return;
    }
    if (sub === 'list') {
      const names = Object.keys(macros);
      this.addJournal(
        names.length
          ? `Macros: ${names.map((macroName) => `${macroName} (${macros[macroName].actions.length})`).join(', ')}`
          : 'No macros saved.',
        '#b8a06a',
        true
      );
      return;
    }
    if (sub === 'play') {
      this.playMacro(name);
      return;
    }
    if (sub === 'delete' || sub === 'remove') {
      if (!macros[name]) {
        this.addJournal(`Unknown macro: ${name || '(none)'}`, '#c56a4a', true);
        return;
      }
      delete macros[name];
      saveMacros(this.world, macros);
      this.removeMacroButton(name);
      const window = this.getWindow('macros', 'player');
      if (window?.selected === name) window.select(null);
      this.addJournal(`Deleted macro ${name}.`, '#b8a06a', true);
      return;
    }
    this.addJournal(`Unknown macro command: ${sub}`, '#c56a4a', true);
  }

  chatCommand(args) {
    const sub = String(args[0] || '').toLowerCase();
    const text = args.slice(1).join(' ').trim();
    const out = this.world.socket.out;
    if (!sub || sub === 'help') {
      this.addJournal('Chat: -chat join <channel> | create <channel> | leave | msg <text> | open [name]', '#b8a06a', true);
      return;
    }
    if (sub === 'open') {
      out.openChat(text);
      return;
    }
    if (sub === 'list') {
      const channels = this.world.chat?.channels || [];
      const current = this.world.chat?.current ? ` (current: ${this.world.chat.current})` : '';
      this.addJournal(channels.length ? `Channels: ${channels.map((c) => c.name).join(', ')}${current}` : 'No chat channels.', '#b8a06a', true);
      return;
    }
    if (sub === 'join') {
      if (!text) {
        this.addJournal('Usage: -chat join <channel>', '#c56a4a', true);
        return;
      }
      out.chatJoin(text);
      this.journal.show();
      $('chatInput')?.focus();
      return;
    }
    if (sub === 'create') {
      if (!text) {
        this.addJournal('Usage: -chat create <channel> <password>', '#c56a4a', true);
        return;
      }
      const [name, ...rest] = text.split(/\s+/);
      out.chatCreate(name, rest.join(' '));
      return;
    }
    if (sub === 'leave') {
      out.chatLeave();
      return;
    }
    if (sub === 'msg' || sub === 'say') {
      if (!text) {
        this.addJournal('Usage: -chat msg <text>', '#c56a4a', true);
        return;
      }
      out.chatSay(text);
      return;
    }
    this.addJournal(`Unknown chat command: ${sub}`, '#c56a4a', true);
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
    this.keepTopWindow();
    if (SERVER_WINDOW_KINDS.has(kind)) {
      const id = windowRestoreId(kind, key);
      this.pendingWindowRestores.delete(id);
      this.requestedWindowRestores.delete(id);
    }
    if (PERSISTED_WINDOW_KINDS.has(kind)) this.persistOpenWindows();
  }

  clearWindows() {
    this.windows = this.journalEntry ? [this.journalEntry] : [];
    this.windowPersistence = false;
    this.pendingWindowRestores.clear();
    this.requestedWindowRestores.clear();
    this._enteredWorld = false;
    if (this.serverWindowRetryTimer) {
      clearTimeout(this.serverWindowRetryTimer);
      this.serverWindowRetryTimer = null;
    }
  }

  persistOpenWindows() {
    if (!this.windowPersistence) return;
    const entries = [...this.windows];
    for (const id of this.pendingWindowRestores) {
      const separator = id.indexOf(':');
      if (separator < 0) continue;
      entries.push({ kind: id.slice(0, separator), key: id.slice(separator + 1) });
    }
    saveOpenWindows(this.world, entries);
  }

  restoreOpenWindows() {
    this.windowPersistence = false;
    this.pendingWindowRestores.clear();
    this.requestedWindowRestores.clear();
    if (this.serverWindowRetryTimer) {
      clearTimeout(this.serverWindowRetryTimer);
      this.serverWindowRetryTimer = null;
    }
    const saved = loadOpenWindows(this.world);
    const serverEntries = [];
    if (!saved) {
      this.showStatus();
    } else {
      for (const entry of saved) {
        if (SERVER_WINDOW_KINDS.has(entry.kind)) {
          this.pendingWindowRestores.add(windowRestoreId(entry.kind, entry.key));
          serverEntries.push(entry);
          continue;
        }
        this.restoreClientWindow(entry.kind);
      }
    }
    this.windowPersistence = true;
    this.persistOpenWindows();
    if (serverEntries.length) this.restoreServerWindows(serverEntries, 0);
  }

  restoreClientWindow(kind) {
    switch (kind) {
      case 'status':
        this.showStatus();
        break;
      case 'skills':
        this.showSkills();
        break;
      case 'hotbar':
        this.showHotbar();
        break;
      case 'party':
        this.showParty();
        break;
      case 'radar':
        this.showRadar();
        break;
      case 'worldmap':
        this.showWorldMap();
        break;
      case 'waypoints':
        this.showWaypoints();
        break;
      case 'buffs':
        this.showBuffs();
        break;
      case 'friends':
        this.showFriends();
        break;
      default:
        break;
    }
  }

  restoreServerWindows(entries, attempt) {
    this.serverWindowRetryTimer = null;
    const waiting = [];
    let changed = false;
    for (const entry of entries) {
      const id = windowRestoreId(entry.kind, entry.key);
      if (!this.pendingWindowRestores.has(id)) {
        this.requestedWindowRestores.delete(id);
        continue;
      }
      if (this.getWindow(entry.kind, entry.key)) {
        this.pendingWindowRestores.delete(id);
        this.requestedWindowRestores.delete(id);
        changed = true;
        continue;
      }
      const serial = Number(entry.key);
      if (!Number.isFinite(serial) || serial <= 0) {
        this.pendingWindowRestores.delete(id);
        this.requestedWindowRestores.delete(id);
        changed = true;
        continue;
      }
      const target = entry.kind === 'container' ? this.world.getItem(serial) : this.world.getMobile(serial);
      if (!target) {
        waiting.push(entry);
        continue;
      }
      if (!this.requestedWindowRestores.has(id)) {
        this.world.socket.out.doubleClick(serial);
        this.requestedWindowRestores.add(id);
      }
      waiting.push(entry);
    }
    if (changed) this.persistOpenWindows();
    if (!waiting.length) return;
    if (attempt >= SERVER_WINDOW_RETRIES) {
      for (const entry of waiting) {
        const id = windowRestoreId(entry.kind, entry.key);
        this.pendingWindowRestores.delete(id);
        this.requestedWindowRestores.delete(id);
      }
      this.persistOpenWindows();
      return;
    }
    this.serverWindowRetryTimer = setTimeout(
      () => this.restoreServerWindows(waiting, attempt + 1),
      SERVER_WINDOW_RETRY_MS
    );
  }

  get topWindow() {
    const status = this.windows.find((w) => w.kind === 'status')?.obj;
    return status?.alwaysOnTop ? status : null;
  }

  keepTopWindow() {
    const status = this.topWindow;
    if (!status) return;
    const index = this.windows.findIndex((w) => w.obj === status);
    if (index >= 0 && index !== this.windows.length - 1) {
      const [entry] = this.windows.splice(index, 1);
      this.windows.push(entry);
    }
  }

  removeWindow(kind, key) {
    const removed = this.windows.filter((w) => w.kind === kind && String(w.key) === String(key));
    this.windows = this.windows.filter((w) => !(w.kind === kind && String(w.key) === String(key)));
    if (this.focusedGumpEntry && removed.some((w) => w.obj === this.focusedGumpEntry.gump)) {
      this.clearGumpFocus();
    }
    if (PERSISTED_WINDOW_KINDS.has(kind)) this.persistOpenWindows();
  }

  raiseWindow(obj) {
    const index = this.windows.findIndex((w) => w.obj === obj);
    if (index >= 0 && index !== this.windows.length - 1) {
      const [entry] = this.windows.splice(index, 1);
      this.windows.push(entry);
    }
    this.keepTopWindow();
    this.updateJournalPointerEvents();
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
    const top = this.topWindow;
    if (top && top.contains(mx, my)) return this.windows.find((w) => w.obj === top) || null;
    for (let i = this.windows.length - 1; i >= 0; i--) {
      if (this.windows[i].obj === top) continue;
      if (this.windows[i].obj.contains(mx, my)) return this.windows[i];
    }
    return null;
  }

  updateJournalPointerEvents() {
    const root = this.journal?.root;
    if (!root) return;
    if (!this.journal.isOpen()) {
      root.style.pointerEvents = '';
      return;
    }
    const index = this.windows.indexOf(this.journalEntry);
    let covered = false;
    if (index >= 0) {
      const { x, y } = this.mouse;
      for (let i = this.windows.length - 1; i > index; i--) {
        const obj = this.windows[i].obj;
        if (obj === this.journal) continue;
        if (obj.contains?.(x, y)) {
          covered = true;
          break;
        }
      }
    }
    root.style.pointerEvents = covered ? 'none' : 'auto';
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
    const low = r.readU32LE();
    const high = r.readU32LE();
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

  requestContextMenu(serial, x, y) {
    this.cancelContextMenuRequest();
    this.contextMenuTimer = setTimeout(() => {
      this.contextMenuTimer = null;
      if (!this.world.inGame || this.world.held) return;
      this.openContextMenu(serial, x, y);
    }, 300);
  }

  cancelContextMenuRequest() {
    if (!this.contextMenuTimer) return;
    clearTimeout(this.contextMenuTimer);
    this.contextMenuTimer = null;
  }

  showContextMenu(serial, items, onSelect = null) {
    const request = this.contextMenuRequest;
    const at = request && request.serial === (serial >>> 0) ? request : this.mouse;
    this.closeContextMenu();
    if (!items.length) return;
    this.hideTooltip();
    const menu = new ContextMenuWindow(this.world, serial, items, at.x, at.y, (s, index) => {
      if (onSelect) onSelect(s, index);
      else this.world.socket.out.popupMenuSelection(s, index);
    });
    this.contextMenu = menu;
    this.addWindow('contextmenu', 'menu', menu);
    this.raiseWindow(menu);
  }

  openGroundMenu(mx, my) {
    const tile = this.game.renderer.screenToTile(mx, my);
    const items = [
      { index: 0, cliloc: 0, text: 'Walk here', flags: 0 },
      { index: 1, cliloc: 0, text: 'Add waypoint here', flags: 0 },
      { index: 2, cliloc: 0, text: 'Copy coordinates', flags: 0 },
    ];
    this.showContextMenu(0, items, (serial, index) => {
      if (index === 0) this.game.walkTo(tile.x, tile.y);
      else if (index === 1) {
        const waypoint = addLocalWaypoint(this.world, `Tile ${tile.x},${tile.y}`, tile.x, tile.y);
        if (waypoint) this.addJournal(`Added waypoint at ${tile.x}, ${tile.y}.`, '#b8a06a', true);
      } else if (index === 2) {
        const text = `${tile.x}, ${tile.y}`;
        navigator.clipboard?.writeText(text).catch(() => {});
        this.addJournal(`Coordinates: ${text}`, '#b8a06a', true);
      }
    });
  }

  closeContextMenu() {
    this.cancelContextMenuRequest();
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
      preview.src = this.game.assets.url(`/api/art/static/${graphic}.png?hue=${hue}`);
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
      image.src = this.game.assets.url(`/api/art/static/${entry.graphic}.png?hue=${entry.hue}`);
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
    this.pendingResource = null;
    this.world.socket.out.targetCancel(t.type, t.cursorId, t.cursorType);
    this.world.clearTarget();
    this.onTargetChanged();
  }

  useLastTarget() {
    const t = this.world.target;
    const last = this.lastTarget;
    if (!t.active) {
      this.addJournal('No target cursor is active.', '#c56a4a', true);
      return false;
    }
    if (!last) {
      this.addJournal('No previous target.', '#c56a4a', true);
      return false;
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
    return true;
  }

  onEquipmentChanged(serial) {
    const pd = this.getWindow('paperdoll', serial);
    if (pd) pd.mobile = this.world.get(serial);
    const equipment = this.getWindow('equipment', `equipment:${serial}`);
    if (equipment) equipment.mobile = this.world.get(serial);
  }

  onEntityRemoved(entity) {
    this.removeWindow('container', entity.serial);
    this.removeWindow('healthbar', entity.serial);
    this.removeWindow('paperdoll', entity.serial);
    this.removeWindow('spellbook', entity.serial);
    this.removeWindow('map', entity.serial);
    this.removeWindow('equipment', `equipment:${entity.serial}`);
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

  onChatMessage(r) {
    try {
      const cmd = r.readU16BE();
      const chat = this.world.chat;
      const add = (text, name = '') => {
        if (!text) return;
        this.world.addMessage(text, 0x3b2, 0xb2, name, 3, { textType: 'chat', chatType: cmd, overhead: false });
      };
      if (cmd === 0x03e8) {
        r.skip(4);
        const channel = r.readUnicodeBE();
        const hasPassword = r.remaining() >= 2 && r.readU16BE() === 0x31;
        if (channel && !chat.channels.some((entry) => entry.name === channel)) chat.channels.push({ name: channel, hasPassword });
        add(`Created chat channel ${channel}${hasPassword ? ' (password protected)' : ''}.`);
        return;
      }
      if (cmd === 0x03e9) {
        r.skip(4);
        const channel = r.readUnicodeBE();
        chat.channels = chat.channels.filter((entry) => entry.name !== channel);
        add(`Chat channel ${channel} was destroyed.`);
        return;
      }
      if (cmd === 0x03eb) {
        this.showModalInput(
          'Chat username',
          chat.username || '',
          30,
          (value) => {
            const name = value.trim();
            if (!name) return;
            chat.username = name;
            this.world.socket.out.openChat(name);
          },
          true,
          () => this.world.socket.out.openChat('')
        );
        return;
      }
      if (cmd === 0x03ec) {
        chat.channels = [];
        chat.current = '';
        chat.username = '';
        add('Chat disabled.');
        return;
      }
      if (cmd === 0x03ed) {
        r.skip(4);
        chat.username = r.readUnicodeBE();
        add(`Chat connected as ${chat.username}.`);
        this.world.socket.out.chatJoin('General');
        return;
      }
      if (cmd === 0x03ee) {
        r.skip(4);
        const userType = r.readU16BE();
        const username = r.readUnicodeBE();
        add(`${username} joined the channel${userType ? ' as a moderator' : ''}.`);
        return;
      }
      if (cmd === 0x03ef) {
        r.skip(4);
        const username = r.readUnicodeBE();
        add(`${username} left the channel.`);
        return;
      }
      if (cmd === 0x03f1 || cmd === 0x03f4) {
        r.skip(4);
        const channel = r.readUnicodeBE();
        if (cmd === 0x03f1) chat.current = channel;
        else if (chat.current === channel) chat.current = '';
        add(cmd === 0x03f1 ? `You have joined ${channel}.` : `You have left ${channel}.`);
        return;
      }
      if (cmd === 0x0025 || cmd === 0x0026 || cmd === 0x0027) {
        r.skip(4);
        r.readU16BE();
        const username = r.readUnicodeBE();
        const text = r.readUnicodeBE();
        add(text, username);
        return;
      }
      if ((cmd >= 0x0001 && cmd <= 0x0024) || (cmd >= 0x0028 && cmd <= 0x002c)) {
        r.skip(4);
        const text = r.readUnicodeBE();
        add(text);
      }
    } catch {
      /* ignore malformed chat packet */
    }
  }
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
      } else if (sub === 0x08) {
        this.world.setMapIndex(r.readU8());
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
      } else if (sub === 0x1d) {
        // House revision state. Foundations are sent for every custom house
        // in range; request the full 0xD8 design when we do not have this
        // revision yet, otherwise the client only ever sees the base multi.
        const serial = r.readU32BE();
        const revision = r.readU32BE();
        this.world.requestCustomHouseDesign(serial, revision);
      } else if (sub === 0x20) {
        const serial = r.readU32BE();
        const type = r.readU8();
        r.readU16BE();
        r.readU16BE();
        r.readU16BE();
        r.readI8();
        if (type === 4) this.showHouse(serial);
        else if (type === 5) this.removeWindow('house', serial);
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
  onCustomHouse(r) {
    try {
      const packet = parseCustomHousePacket(r);
      if (!packet.serial) return;
      const existing = this.world.customHouses.get(packet.serial);
      this.world.customHouse = {
        serial: packet.serial,
        revision: packet.revision,
        planes: packet.planeCount,
        components: existing?.parts?.length || 0,
      };
      const window = this.getWindow('house', packet.serial);
      if (window) window.serial = packet.serial;
      if (packet.responds) this.world.socket.out.houseResponse();
      if (packet.blocks.length) {
        this.world.setCustomHouseDesign(packet).catch((err) => {
          console.warn('[housing] failed to decode custom house design', err);
        });
      }
    } catch (err) {
      console.warn('[housing] malformed custom house packet', err);
    }
  }

  showHouse(serial) {
    if (!serial) return;
    const existing = this.getWindow('house', serial);
    if (existing) {
      this.raiseWindow(existing);
      return;
    }
    this.addWindow('house', serial, new HouseWindow(this.world, serial));
    this.world.socket.out.customHouseRequest(serial);
  }
  onBuffDebuff(r) {
    try {
      const serial = r.readU32BE();
      const icon = r.readU16BE();
      const count = r.readU16BE();
      if (!count) {
        this.world.buffs = this.world.buffs.filter((b) => b.icon !== icon);
        return;
      }
      const grouped = new Map();
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
        const key = `${iconId}|${queue}|${titleId}|${descId}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.count++;
          continue;
        }
        grouped.set(key, {
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
          count: 1,
          endsAt: timer > 0 ? Date.now() + timer * 1000 : 0,
          time: Date.now(),
        });
      }
      this.world.buffs = this.world.buffs.filter((b) => b.icon !== icon);
      this.world.buffs.push(...grouped.values());
      this.showBuffs();
    } catch {
      /* ignore */
    }
  }

  onLoginState() {}

  /* ----------------------------- mouse ----------------------------- */

  uiPos(e) {
    return { x: e.clientX, y: e.clientY };
  }

  canvasPos(e) {
    const rect = this.game.renderer.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  isDomUiTarget(target) {
    return !!target?.closest?.('#hud, #journalPanel, #gameTitleBar, #gameResize, #loginScreen, #modalBackdrop, #macroWindow');
  }

  onMouseMove(e) {
    const ui = this.uiPos(e);
    const game = this.canvasPos(e);
    this.mouse = ui;
    this.gameMouse = game;
    this.pointerOverDomUi = this.isDomUiTarget(e.target);
    this.updateJournalPointerEvents();
    this.game.renderer.mouse.x = game.x;
    this.game.renderer.mouse.y = game.y;
    this.game.renderer.mouse.world = this.game.renderer.screenToTile(game.x, game.y);
    if (this.selection) {
      this.selection.x = ui.x;
      this.selection.y = ui.y;
      if (Math.abs(ui.x - this.selection.startX) > 4 || Math.abs(ui.y - this.selection.startY) > 4) {
        this.selection.moved = true;
      }
      return;
    }
    if (this.worldItemPress) {
      const dx = game.x - this.worldItemPress.x;
      const dy = game.y - this.worldItemPress.y;
      if (dx * dx + dy * dy >= 64) {
        const item = this.worldItemPress.item;
        this.worldItemPress = null;
        if (!this.world.held) {
          this.world.held = item;
          this.world.socket.out.pickup(item.serial, item.amount || 1);
          this.game.renderer.mouse.world = this.game.renderer.screenToTile(game.x, game.y);
        }
        return;
      }
    }
    if (this.dragTarget) {
      this.dragTarget.obj.onMouseMove?.(ui.x, ui.y, e);
      return;
    }
    if (this.isDomUiTarget(e.target)) {
      this.refreshTooltip();
      return;
    }
    const hit = this.hitTest(ui.x, ui.y);
    if (hit) {
      hit.obj.onMouseMove?.(ui.x, ui.y, e);
      this.refreshTooltip();
      return;
    }
    if (e.target === this.game.renderer.canvas) this.updateTargetInfo(game.x, game.y);
    this.refreshTooltip();
  }

  onMouseDown(e) {
    this.cancelContextMenuRequest();
    if (this.isDomUiTarget(e.target)) return;
    this.hideTooltip();
    if (!$('loginScreen').classList.contains('hidden') || !$('modalBackdrop').classList.contains('hidden')) return;
    const ui = this.uiPos(e);
    const game = this.canvasPos(e);
    const isCanvas = e.target === this.game.renderer.canvas;
    const button = e.button;
    const hit = this.hitTest(ui.x, ui.y);
    if (this.contextMenu && hit?.obj !== this.contextMenu) this.closeContextMenu();
    if (this.focusedGumpEntry && (!hit || hit.obj !== this.focusedGumpEntry.gump)) this.clearGumpFocus();
    if (hit) {
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      e.preventDefault();
      e.stopPropagation();
      if (button === 0 && this.world.target.active && !this.world.held) {
        const target = hit.obj.targetAt?.(ui.x, ui.y);
        if (target) {
          this.sendTargetEntity(target);
          return;
        }
      }
      this.raiseWindow(hit.obj);
      hit.obj.onMouseDown?.(ui.x, ui.y, button, e);
      if (hit.obj.dragging || hit.obj.onMouseMove) this.dragTarget = hit;
      return;
    }
    if (!isCanvas) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const arrow = this.game.renderer.questArrowScreen?.();
    if (arrow && !this.world.target.active && !this.world.held && Math.hypot(game.x - arrow.x, game.y - arrow.y) <= 12) {
      this.world.socket.out.clickQuestArrow(button === 2);
      if (button === 0) {
        const target = this.world.questArrow;
        if (target) this.game.walkTo(target.x, target.y);
      }
      return;
    }
    if (button === 0) {
      if (this.world.target.active) {
        this.sendTarget(game.x, game.y);
        return;
      }
      const tile = this.game.renderer.screenToTile(game.x, game.y);
      const entity = this.game.renderer.entityAt?.(game.x, game.y) || this.findEntityAt(tile.x, tile.y);
      if (!entity) {
        if (settings.get('dragSelectHealthBars') && !this.world.held) this.startDragSelect(ui.x, ui.y);
        return;
      }
      if (entity.isItem && entity.container === 0 && !this.world.held) {
        if (e.shiftKey) {
          this.world.held = entity;
          this.world.socket.out.pickup(entity.serial, entity.amount || 1);
        } else if (e.detail < 2) {
          this.worldItemPress = { item: entity, x: game.x, y: game.y };
        }
        return;
      }
      this.world.socket.out.singleClick(entity.serial);
      if (e.detail < 2) this.requestContextMenu(entity.serial, ui.x, ui.y);
      return;
    }
    if (button === 2) {
      if (this.world.target.active) {
        this.cancelTarget();
        return;
      }
      if (this.world.held) return;
      if (e.ctrlKey) {
        this.openGroundMenu(game.x, game.y);
        return;
      }
      this.startMouseWalk();
    }
  }

  startDragSelect(x, y) {
    this.selection = { startX: x, startY: y, x, y, moved: false };
  }

  finishDragSelect(x, y) {
    const selection = this.selection;
    this.selection = null;
    if (!selection?.moved) return;
    const rect = {
      x: Math.min(selection.startX, x),
      y: Math.min(selection.startY, y),
      w: Math.abs(x - selection.startX),
      h: Math.abs(y - selection.startY),
    };
    const canvasRect = this.game.renderer.canvas.getBoundingClientRect();
    const gameRect = {
      x: rect.x - canvasRect.left,
      y: rect.y - canvasRect.top,
      w: rect.w,
      h: rect.h,
    };
    const mobiles = this.game.renderer.mobilesInRect(gameRect);
    if (!mobiles.length) return;
    let barX = Math.max(8, Math.min(rect.x, window.innerWidth - 158));
    let barY = Math.max(8, Math.min(rect.y, window.innerHeight - 46));
    for (const mobile of mobiles) {
      if (barY + 42 > window.innerHeight - 8) {
        barY = 8;
        barX += 154;
      }
      if (barX + 150 > window.innerWidth - 8) {
        barX = 8;
        barY = 8;
      }
      this.openHealthBar(mobile, barX, barY);
      barY += 42;
    }
  }

  openHealthBar(mobile, x, y) {
    if (!mobile?.isMobile || mobile === this.world.player) return;
    const existing = this.getWindow('healthbar', mobile.serial);
    if (existing) {
      this.raiseWindow(existing);
      return;
    }
    this.world.socket.out.statusRequest(mobile.serial);
    this.addWindow('healthbar', mobile.serial, new HealthBarWindow(this.world, mobile, x, y));
    this.raiseWindow(this.getWindow('healthbar', mobile.serial));
  }

  closeHealthBar(serial) {
    this.removeWindow('healthbar', serial);
  }

  drawSelection(ctx) {
    if (!this.selection?.moved) return;
    const x = Math.min(this.selection.startX, this.selection.x);
    const y = Math.min(this.selection.startY, this.selection.y);
    const w = Math.abs(this.selection.x - this.selection.startX);
    const h = Math.abs(this.selection.y - this.selection.startY);
    ctx.save();
    ctx.fillStyle = 'rgba(201,176,108,0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#c9b06c';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  startMouseWalk() {
    this.cancelMacroPlayback('Macro stopped.');
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
    const sx = this.gameMouse.x - (ps.x - renderer.camera.x);
    const sy = this.gameMouse.y - (ps.y - renderer.camera.y);
    if (sx * sx + sy * sy < 64) return null;
    const angle = Math.atan2(sy, sx);
    const index = Math.round((angle + Math.PI / 4) / (Math.PI / 4));
    return ((index % 8) + 8) % 8;
  }

  onMouseUp(e) {
    if (e.button === 2) this.stopMouseWalk();
    const ui = this.uiPos(e);
    if (this.selection) {
      this.finishDragSelect(ui.x, ui.y);
      return;
    }
    if (this.dragTarget) {
      this.dragTarget.obj.onMouseUp?.(ui.x, ui.y);
      this.dragTarget = null;
      return;
    }
    if (this.worldItemPress) {
      const item = this.worldItemPress.item;
      this.worldItemPress = null;
      this.world.socket.out.singleClick(item.serial);
      this.requestContextMenu(item.serial, ui.x, ui.y);
    }
    if (this.isDomUiTarget(e.target) || !this.world.held) return;
    const hit = this.hitTest(ui.x, ui.y);
    if (hit) {
      hit.obj.onItemDrop?.(ui.x, ui.y);
      return;
    }
    if (e.target !== this.game.renderer.canvas) return;
    const game = this.canvasPos(e);
    const tile = this.game.renderer.screenToTile(game.x, game.y);
    let entity = this.game.renderer.entityAt?.(game.x, game.y);
    if (!entity?.isMobile) {
      const tileEntity = this.findEntityAt(tile.x, tile.y);
      if (tileEntity?.isMobile) entity = tileEntity;
    }
    const held = this.world.held;
    this.world.held = null;
    if (entity?.isMobile) {
      this.world.socket.out.drop(held.serial, entity.x, entity.y, entity.z || 0, 0, entity.serial);
    } else {
      const block = this.world.getBlock(tile.x >> 3, tile.y >> 3);
      let z = 0;
      if (block) z = block.cells[((tile.y & 7) << 3) | (tile.x & 7)].z;
      this.world.socket.out.drop(held.serial, tile.x, tile.y, z, 0, 0);
    }
  }

  onDoubleClick(e) {
    this.cancelContextMenuRequest();
    if (this.isDomUiTarget(e.target)) return;
    if (!$('modalBackdrop').classList.contains('hidden')) return;
    this.worldItemPress = null;
    const ui = this.uiPos(e);
    const game = this.canvasPos(e);
    const hit = this.hitTest(ui.x, ui.y);
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      this.raiseWindow(hit.obj);
      if (this.focusedGumpEntry && hit.obj !== this.focusedGumpEntry.gump) this.clearGumpFocus();
      hit.obj.onDoubleClick?.(ui.x, ui.y);
      return;
    }
    if (e.target !== this.game.renderer.canvas) return;
    const tile = this.game.renderer.screenToTile(game.x, game.y);
    const entity = this.game.renderer.entityAt?.(game.x, game.y) || this.findEntityAt(tile.x, tile.y);
    if (!entity) return;
    const attack =
      this.world.player?.inWarMode &&
      entity.isMobile &&
      entity !== this.world.player &&
      entity.notoriety !== 7;
    if (attack) this.world.socket.out.attack(entity.serial);
    else this.world.socket.out.doubleClick(entity.serial);
  }

  onWheel(e) {
    if (this.isDomUiTarget(e.target)) return;
    const ui = this.uiPos(e);
    const hit = this.hitTest(ui.x, ui.y);
    if (hit?.obj.onWheel?.(ui.x, ui.y, e.deltaY, e)) {
      e.preventDefault();
      e.stopPropagation();
    } else if (hit?.obj.scroll !== undefined) {
      hit.obj.scroll = Math.max(0, hit.obj.scroll + (e.deltaY > 0 ? 46 : -46));
      e.preventDefault();
      e.stopPropagation();
    }
  }

  onContextMenu(e) {
    e.preventDefault();
    if (this.hitTest(e.clientX, e.clientY)) return;
    if (e.target === this.game.renderer.canvas && this.world.target.active) this.cancelTarget();
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
      this.world.held ||
      this.pointerOverDomUi
    ) {
      this.hideTooltip();
      return;
    }
    const { x, y } = this.mouse;
    let target = null;
    const hit = this.hitTest(x, y);
    if (hit) {
      target = hit.obj.tooltipAt?.(x, y) || null;
    } else {
      if (document.elementFromPoint(x, y) !== this.game.renderer.canvas) {
        this.hideTooltip();
        return;
      }
      const game = this.gameMouse;
      const entity = this.game.renderer.entityAt?.(game.x, game.y);
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
    if (this.pendingResource != null) {
      this.world.socket.out.targetByResource(entity.serial, this.pendingResource);
      this.pendingResource = null;
    } else {
      this.world.socket.out.targetObject(entity.serial, entity.graphic, entity.x, entity.y, entity.z, t.cursorId, t.cursorType);
    }
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
      } else {
        const top = [...this.windows].reverse().find((w) => w.kind !== 'journal')?.obj;
        if (top && top.canCloseWithEsc !== false) top.close?.();
      }
      return;
    }
    if (keyMatches(e, settings.get('keyHelp'))) {
      this.command('-help');
      e.preventDefault();
      return;
    }
    if (keyMatches(e, settings.get('keyJournal'))) {
      this.journal.toggle();
      e.preventDefault();
      return;
    }
    if (keyMatches(e, settings.get('keyWar'))) {
      this.toggleWarMode();
      e.preventDefault();
      return;
    }
    if (keyMatches(e, settings.get('keyLastTarget'))) {
      this.useLastTarget();
      e.preventDefault();
      return;
    }
    if (keyMatches(e, settings.get('keyAllNames'))) {
      settings.toggle('showNames');
      e.preventDefault();
      return;
    }
    if (e.key.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      e.preventDefault();
      this.cancelMacroPlayback('Macro stopped.');
      this.keyDir = this.keyDir || {};
      this.keyDir[e.code] = true;
      this.game.cancelWalkPath();
      const direction = this.computeDirection();
      if (direction != null) this.world.walk(direction, !!this.shiftDown || !!this.world.alwaysRun);
      return;
    }
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      const slot = hotbarSlotForKey(e.code);
      if (slot >= 0) {
        const window = this.getWindow('hotbar', 'player');
        if (window?.use(slot)) e.preventDefault();
      }
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

  draw(ctx, now, topCtx = null) {
    this.drawSelection(ctx);
    const top = this.topWindow;
    const journalIndex = this.journal?.isOpen?.() ? this.windows.indexOf(this.journalEntry) : -1;
    const topIndex = top ? this.windows.findIndex((w) => w.obj === top) : -1;
    const targetFor = (index) => (topCtx && journalIndex >= 0 && index > journalIndex ? topCtx : ctx);
    for (let i = 0; i < this.windows.length; i++) {
      const w = this.windows[i];
      if (w.obj === top) continue;
      w.obj.draw?.(targetFor(i), now);
    }
    top?.draw?.(targetFor(topIndex), now);
  }

  requestMissingNames(now) {
    const player = this.world.player;
    if (!player) return;
    let sent = 0;
    for (const entity of this.world.entities.values()) {
      if (sent >= 8) break;
      if (!entity.isMobile || entity === player || entity.name) continue;
      if (Math.max(Math.abs(entity.x - player.x), Math.abs(entity.y - player.y)) > 18) continue;
      const last = this.nameRequestAt.get(entity.serial) || 0;
      if (now - last < 10000) continue;
      this.nameRequestAt.set(entity.serial, now);
      this.world.socket.out.nameRequest(entity.serial);
      sent++;
    }
  }

  update(now) {
    if (!this.world.inGame) return;
    this.updateJournalPointerEvents();
    if (now - this.lastStatusRefresh > 150) {
      this.lastStatusRefresh = now;
      this.refreshStatus();
      this.updateTargetInfo(this.game.renderer.mouse.x || 0, this.game.renderer.mouse.y || 0);
      this.refreshTooltip();
    }
    if (now - this.lastNameSweep > 1000) {
      this.lastNameSweep = now;
      this.requestMissingNames(now);
    }
  }
}

function keyMatches(event, binding) {
  if (!binding) return false;
  const parts = String(binding).split('+').filter(Boolean);
  const code = parts.pop();
  const needsCtrl = parts.some((p) => p.toLowerCase() === 'ctrl');
  const needsAlt = parts.some((p) => p.toLowerCase() === 'alt');
  const needsShift = parts.some((p) => p.toLowerCase() === 'shift');
  return event.code === code && !!event.ctrlKey === needsCtrl && !!event.altKey === needsAlt && !!event.shiftKey === needsShift;
}

function readBuffArgs(r) {
  const length = r.readU16BE();
  if (length > 2) return r.readUnicodeLE(length);
  return r.readUnicodeLE();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
