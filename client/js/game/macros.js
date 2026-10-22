import { accountStorageKey, clampPosition, fitText } from '../util/ui.js';

const MACRO_STORAGE_BASE = 'legionuo.macros.v1';
const MACRO_BUTTON_STORAGE_BASE = 'legionuo.macrobuttons.v1';

export const MACRO_BUTTON_WIDTH = 140;
export const MACRO_BUTTON_HEIGHT = 30;

export const MACRO_DIRECTIONS = [
  { value: 0, label: 'North' },
  { value: 1, label: 'Northeast' },
  { value: 2, label: 'East' },
  { value: 3, label: 'Southeast' },
  { value: 4, label: 'South' },
  { value: 5, label: 'Southwest' },
  { value: 6, label: 'West' },
  { value: 7, label: 'Northwest' },
];

export const MACRO_ACTION_LABELS = {
  say: 'Say',
  emote: 'Emote',
  whisper: 'Whisper',
  yell: 'Yell',
  move: 'Move',
  wait: 'Wait (ms)',
  waitForTarget: 'Wait For Target',
  targetLast: 'Target Last',
  targetSelf: 'Target Self',
  targetNext: 'Target Next',
  attackLast: 'Attack Last',
  lastObject: 'Last Object',
  useItemInHand: 'Use Item In Hand',
  useObject: 'Use Object (graphic)',
  usePotion: 'Use Potion',
  useSkill: 'Use Skill',
  lastSkill: 'Last Skill',
  castSpell: 'Cast Spell',
  lastSpell: 'Last Spell',
  bandageSelf: 'Bandage Self',
  combatAbility: 'Weapon Ability',
  equipLastWeapon: 'Equip Last Weapon',
  clearHands: 'Clear Hands',
  equipHands: 'Equip Hands',
  warPeace: 'Toggle War/Peace',
  invokeVirtue: 'Invoke Virtue',
  openDoor: 'Open Door',
  toggleMount: 'Toggle Mount',
  resync: 'Resync',
  alwaysRun: 'Toggle Always Run',
  names: 'Toggle Names',
  useHotbar: 'Use Hotbar Slot',
  command: 'Command',
  loop: 'Loop (repeat actions)',
};

const ACTION_LABELS = MACRO_ACTION_LABELS;

export const WAIT_FOR_TARGET_MS = 10000;
export const MAX_WAIT_MS = 3600000;
export const MAX_LOOP_COUNT = 10000;
export const MAX_LOOP_DEPTH = 8;

export const SPEECH_ACTION_TYPES = ['say', 'emote', 'whisper', 'yell'];

export const MACRO_VIRTUES = [
  { value: 'Honor', id: 1 },
  { value: 'Sacrifice', id: 2 },
  { value: 'Valor', id: 3 },
  { value: 'Spirituality', id: 4 },
  { value: 'Humility', id: 5 },
  { value: 'Justice', id: 6 },
  { value: 'Compassion', id: 7 },
];

export const MACRO_POTIONS = [
  { value: 'heal', label: 'Heal', graphic: 0x0f0c },
  { value: 'cure', label: 'Cure', graphic: 0x0f07 },
  { value: 'refresh', label: 'Refresh', graphic: 0x0f0b },
  { value: 'agility', label: 'Agility', graphic: 0x0f08 },
  { value: 'strength', label: 'Strength', graphic: 0x0f09 },
  { value: 'explosion', label: 'Explosion', graphic: 0x0f0d },
  { value: 'poison', label: 'Poison', graphic: 0x0f0a },
  { value: 'confusionBlast', label: 'Confusion Blast', graphic: 0x0f06 },
];

export const MACRO_ABILITIES = [
  { value: 1, label: 'Armor Ignore' },
  { value: 2, label: 'Bleed Attack' },
  { value: 3, label: 'Concussion Blow' },
  { value: 4, label: 'Crushing Blow' },
  { value: 5, label: 'Disarm' },
  { value: 6, label: 'Dismount' },
  { value: 7, label: 'Double Strike' },
  { value: 8, label: 'Infectious Strike' },
  { value: 9, label: 'Mortal Strike' },
  { value: 10, label: 'Moving Shot' },
  { value: 11, label: 'Paralyzing Blow' },
  { value: 12, label: 'Shadow Strike' },
  { value: 13, label: 'Whirlwind Attack' },
  { value: 14, label: 'Riding Swipe' },
  { value: 15, label: 'Frenzied Whirlwind' },
  { value: 16, label: 'Block' },
  { value: 17, label: 'Defense Mastery' },
  { value: 18, label: 'Nerve Strike' },
  { value: 19, label: 'Talon Strike' },
  { value: 20, label: 'Feint' },
  { value: 21, label: 'Dual Wield' },
  { value: 22, label: 'Double Shot' },
  { value: 23, label: 'Armor Pierce' },
  { value: 24, label: 'Bladeweave' },
  { value: 25, label: 'Force Arrow' },
  { value: 26, label: 'Lightning Arrow' },
  { value: 27, label: 'Psychic Attack' },
  { value: 28, label: 'Serpent Arrow' },
  { value: 29, label: 'Force of Nature' },
  { value: 30, label: 'Infused Throw' },
  { value: 31, label: 'Mystic Arc' },
  { value: 32, label: 'Disrobe' },
];

const NO_PARAM_ACTIONS = new Set([
  'waitForTarget',
  'targetLast',
  'targetSelf',
  'targetNext',
  'attackLast',
  'lastObject',
  'useItemInHand',
  'lastSkill',
  'lastSpell',
  'bandageSelf',
  'equipLastWeapon',
  'clearHands',
  'equipHands',
  'warPeace',
  'openDoor',
  'toggleMount',
  'resync',
  'alwaysRun',
  'names',
]);

export function parseMacroNumber(value, fallback = 0) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const parsed = /^0x/i.test(text) ? Number.parseInt(text, 16) : Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function defaultMacroAction(type) {
  if (type === 'move') return { type: 'move', direction: 0 };
  if (type === 'wait') return { type: 'wait', ms: 1000 };
  if (type === 'useObject') return { type: 'useObject', graphic: 0x0f0c, hue: null };
  if (type === 'usePotion') return { type: 'usePotion', potion: 'heal' };
  if (type === 'useSkill') return { type: 'useSkill', skill: 'Healing' };
  if (type === 'castSpell') return { type: 'castSpell', spell: 'Heal' };
  if (type === 'invokeVirtue') return { type: 'invokeVirtue', virtue: 'Honor' };
  if (type === 'combatAbility') return { type: 'combatAbility', ability: 1 };
  if (type === 'useHotbar') return { type: 'useHotbar', slot: 1 };
  if (type === 'command') return { type: 'command', command: '-' };
  if (type === 'loop') return { type: 'loop', count: 10, delay: 0, actions: [] };
  if (NO_PARAM_ACTIONS.has(type)) return { type };
  return { type: SPEECH_ACTION_TYPES.includes(type) ? type : 'say', text: '' };
}

function clampInt(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

export function directionLabel(direction) {
  return MACRO_DIRECTIONS.find((entry) => entry.value === (Number(direction) & 7))?.label || 'North';
}

export function normalizeMacroAction(action, depth = 0) {
  if (typeof action === 'string') {
    const text = action.trim();
    if (!text) return null;
    if (text.startsWith('-')) return { type: 'command', command: text };
    return { type: 'say', text };
  }
  if (!action || typeof action !== 'object') return null;
  if (SPEECH_ACTION_TYPES.includes(action.type)) {
    const text = String(action.text ?? '').trim();
    return text ? { type: action.type, text } : null;
  }
  if (action.type === 'move') {
    const direction = Number(action.direction);
    if (!Number.isInteger(direction) || direction < 0 || direction > 7) return null;
    return { type: 'move', direction };
  }
  if (action.type === 'command') {
    const command = String(action.command ?? '').trim();
    if (!command) return null;
    return { type: 'command', command: command.startsWith('-') ? command : `-${command}` };
  }
  if (action.type === 'wait') {
    const ms = Number(action.ms);
    if (!Number.isFinite(ms) || ms < 0) return null;
    return { type: 'wait', ms: Math.min(MAX_WAIT_MS, Math.round(ms)) };
  }
  if (action.type === 'loop') {
    if (depth >= MAX_LOOP_DEPTH) return null;
    const nested = Array.isArray(action.actions) ? action.actions : Array.isArray(action.steps) ? action.steps : [];
    return {
      type: 'loop',
      count: clampInt(action.count, 0, MAX_LOOP_COUNT, 1),
      delay: clampInt(action.delay, 0, MAX_WAIT_MS, 0),
      actions: nested.map((entry) => normalizeMacroAction(entry, depth + 1)).filter(Boolean),
    };
  }
  if (action.type === 'useObject') {
    const graphic = clampInt(action.graphic, 0, 0xffff, 0);
    if (!graphic) return null;
    const hue = action.hue == null || action.hue === '' ? null : clampInt(action.hue, 0, 0xffff, 0);
    return { type: 'useObject', graphic, hue };
  }
  if (action.type === 'usePotion') {
    const potion = MACRO_POTIONS.find((entry) => entry.value === action.potion);
    return { type: 'usePotion', potion: potion ? potion.value : 'heal' };
  }
  if (action.type === 'useSkill') {
    const skill = String(action.skill ?? '').trim();
    return skill ? { type: 'useSkill', skill } : null;
  }
  if (action.type === 'castSpell') {
    const spell = String(action.spell ?? '').trim();
    return spell ? { type: 'castSpell', spell } : null;
  }
  if (action.type === 'invokeVirtue') {
    const virtue = MACRO_VIRTUES.find((entry) => entry.value === action.virtue);
    return { type: 'invokeVirtue', virtue: virtue ? virtue.value : 'Honor' };
  }
  if (action.type === 'combatAbility') {
    return { type: 'combatAbility', ability: clampInt(action.ability, 1, 32, 1) };
  }
  if (action.type === 'useHotbar') {
    return { type: 'useHotbar', slot: clampInt(action.slot, 1, 12, 1) };
  }
  if (NO_PARAM_ACTIONS.has(action.type)) {
    return { type: action.type };
  }
  return null;
}

export function normalizeMacroActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.map((action) => normalizeMacroAction(action)).filter(Boolean);
}

export function macroHasLoop(actions) {
  if (!Array.isArray(actions)) return false;
  return actions.some((action) => action?.type === 'loop');
}

export function countMacroActions(actions) {
  if (!Array.isArray(actions)) return 0;
  let count = 0;
  for (const action of actions) {
    count += 1;
    if (action?.type === 'loop') count += countMacroActions(action.actions);
  }
  return count;
}

export function normalizeMacro(macro, fallbackName = '') {
  if (!macro || typeof macro !== 'object') return null;
  const name = String(macro.name || fallbackName || '').trim();
  if (!name) return null;
  const actions = normalizeMacroActions(
    Array.isArray(macro.actions) ? macro.actions : Array.isArray(macro.steps) ? macro.steps : []
  );
  return { name, actions };
}

export function normalizeMacros(saved) {
  const macros = {};
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return macros;
  for (const [key, value] of Object.entries(saved)) {
    if (typeof value === 'string' || Array.isArray(value)) {
      const macro = normalizeMacro({ name: key, steps: value }, key);
      if (macro) macros[macro.name] = macro;
      continue;
    }
    const macro = normalizeMacro(value, key);
    if (macro) macros[macro.name] = macro;
  }
  return macros;
}

export function macroStorageKey(world) {
  return accountStorageKey(world, MACRO_STORAGE_BASE);
}

export function loadMacros(world) {
  try {
    return normalizeMacros(JSON.parse(localStorage.getItem(macroStorageKey(world)) || 'null'));
  } catch {
    return {};
  }
}

export function saveMacros(world, macros) {
  try {
    localStorage.setItem(macroStorageKey(world), JSON.stringify(macros));
  } catch {
    /* ignore quota errors */
  }
}

export function macroButtonStorageKey(world) {
  return accountStorageKey(world, MACRO_BUTTON_STORAGE_BASE);
}

export function loadMacroButtons(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(macroButtonStorageKey(world)) || 'null');
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((entry) => entry && String(entry.name || '').trim())
      .map((entry) => {
        const x = Number(entry.x);
        const y = Number(entry.y);
        return {
          name: String(entry.name).trim(),
          x: Number.isFinite(x) ? x : 40,
          y: Number.isFinite(y) ? y : 40,
        };
      });
  } catch {
    return [];
  }
}

export function saveMacroButtons(world, buttons) {
  try {
    localStorage.setItem(macroButtonStorageKey(world), JSON.stringify(buttons));
  } catch {
    /* ignore quota errors */
  }
}

export function macroActionSummary(action) {
  const normalized = normalizeMacroAction(action);
  if (!normalized) return '';
  if (SPEECH_ACTION_TYPES.includes(normalized.type)) {
    return `${MACRO_ACTION_LABELS[normalized.type]}: ${normalized.text}`;
  }
  if (normalized.type === 'move') return `Move: ${directionLabel(normalized.direction)}`;
  if (normalized.type === 'wait') return `Wait: ${normalized.ms}ms`;
  if (normalized.type === 'waitForTarget') return 'Wait for target cursor';
  if (normalized.type === 'targetLast') return 'Target last';
  if (normalized.type === 'targetSelf') return 'Target self';
  if (normalized.type === 'targetNext') return 'Target next mobile';
  if (normalized.type === 'attackLast') return 'Attack last target';
  if (normalized.type === 'lastObject') return 'Use last object';
  if (normalized.type === 'useItemInHand') return 'Use item in hand';
  if (normalized.type === 'useObject') {
    return `Use object: 0x${normalized.graphic.toString(16)}${normalized.hue == null ? '' : ` hue ${normalized.hue}`}`;
  }
  if (normalized.type === 'usePotion') {
    const potion = MACRO_POTIONS.find((entry) => entry.value === normalized.potion);
    return `Use potion: ${potion?.label || normalized.potion}`;
  }
  if (normalized.type === 'useSkill') return `Use skill: ${normalized.skill}`;
  if (normalized.type === 'lastSkill') return 'Use last skill';
  if (normalized.type === 'castSpell') return `Cast spell: ${normalized.spell}`;
  if (normalized.type === 'lastSpell') return 'Cast last spell';
  if (normalized.type === 'bandageSelf') return 'Bandage self';
  if (normalized.type === 'combatAbility') {
    const ability = MACRO_ABILITIES.find((entry) => entry.value === normalized.ability);
    return `Weapon ability: ${ability?.label || normalized.ability}`;
  }
  if (normalized.type === 'equipLastWeapon') return 'Equip last weapon';
  if (normalized.type === 'clearHands') return 'Clear hands';
  if (normalized.type === 'equipHands') return 'Equip hands';
  if (normalized.type === 'warPeace') return 'Toggle war/peace';
  if (normalized.type === 'invokeVirtue') return `Invoke virtue: ${normalized.virtue}`;
  if (normalized.type === 'openDoor') return 'Open door';
  if (normalized.type === 'toggleMount') return 'Toggle mount';
  if (normalized.type === 'resync') return 'Resync';
  if (normalized.type === 'alwaysRun') return 'Toggle always run';
  if (normalized.type === 'names') return 'Toggle names';
  if (normalized.type === 'useHotbar') return `Use hotbar slot ${normalized.slot}`;
  if (normalized.type === 'loop') {
    const label = normalized.count === 0 ? '∞' : `x${normalized.count}`;
    return `Loop ${label}: ${normalized.actions.length} action${normalized.actions.length === 1 ? '' : 's'}`;
  }
  return `Command: ${normalized.command}`;
}

export class MacroButtonWindow {
  constructor(world, name, x = 40, y = 40) {
    this.world = world;
    this.name = String(name || 'Macro');
    this.width = MACRO_BUTTON_WIDTH;
    this.height = MACRO_BUTTON_HEIGHT;
    this.dragging = false;
    this.dragMoved = false;
    this.dragOffset = { x: 0, y: 0 };
    this.start = { x: 0, y: 0 };
    // x/y are the top-left corner, matching what persistMacroButtons stores.
    const pos = clampPosition(x, y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  tooltipAt() {
    return {
      id: `macrobutton:${this.name}`,
      title: this.name,
      lines: ['Macro', 'Click to play', 'Drag to the hotbar or right-click to remove'],
    };
  }

  use() {
    const ui = this.world.game?.ui;
    const macro = ui?.getMacros?.()[this.name];
    if (!macro?.actions?.length) {
      this.world.addMessage(`Macro ${this.name} is missing or empty.`, 0x22, 1, 'System');
      return false;
    }
    return !!ui.playMacroActions(macro.actions, this.name);
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    if (button !== 0) return false;
    this.dragging = true;
    this.dragMoved = false;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    this.start.x = this.x;
    this.start.y = this.y;
    return true;
  }

  onMouseMove(mx, my) {
    if (!this.dragging) return;
    const dx = mx - (this.start.x + this.dragOffset.x);
    const dy = my - (this.start.y + this.dragOffset.y);
    if (!this.dragMoved && dx * dx + dy * dy < 9) return;
    this.dragMoved = true;
    const pos = clampPosition(mx - this.dragOffset.x, my - this.dragOffset.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
  }

  onMouseUp(mx, my) {
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.dragMoved) {
      this.use();
      return;
    }
    const ui = this.world.game?.ui;
    const hotbar = ui?.getWindow?.('hotbar', 'player');
    if (hotbar?.contains?.(mx, my)) {
      const index = hotbar.slotAt(mx, my);
      const macro = ui.getMacros?.()[this.name];
      if (
        index >= 0 &&
        macro?.actions?.length &&
        hotbar.setSlot(index, { type: 'macro', name: this.name, actions: macro.actions })
      ) {
        this.world.addMessage(`Bound ${this.name} to hotbar slot ${index + 1}.`, 0x35, 1, 'System');
        this.x = this.start.x;
        this.y = this.start.y;
        return;
      }
      this.x = this.start.x;
      this.y = this.start.y;
      ui?.persistMacroButtons?.();
      return;
    }
    ui?.persistMacroButtons?.();
  }

  close() {
    this.world.game.ui?.removeMacroButton?.(this.name);
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(18,15,10,0.94)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    ctx.fillStyle = '#c9b06c';
    ctx.fillRect(this.x + 1, this.y + 1, 3, this.height - 2);
    ctx.fillStyle = '#e2d6b4';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, this.name, this.width - 16), this.x + 10, this.y + this.height / 2 + 1);
    ctx.textBaseline = 'top';
  }
}

export class MacroWindow {
  constructor(world, onClose) {
    this.world = world;
    this.ui = world.game.ui;
    this.onClose = onClose;
    this.macros = this.ui?.getMacros?.() || loadMacros(world);
    this.selected = null;
    this.closed = false;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.macroDrag = null;
    this.dragGhost = null;
    this.onMacroDragMove = null;
    this.onMacroDragEnd = null;
    this.width = Math.min(680, Math.max(320, window.innerWidth - 40));
    this.height = Math.min(460, Math.max(260, window.innerHeight - 80));
    this.x = Math.max(20, Math.round((window.innerWidth - this.width) / 2));
    this.y = Math.max(20, Math.round((window.innerHeight - this.height) / 2));
    this.build();
    const first = Object.keys(this.macros).sort((a, b) => a.localeCompare(b))[0] || null;
    this.select(first);
  }

  build() {
    this.el = document.createElement('div');
    this.el.id = 'macroWindow';
    this.el.style.left = `${this.x}px`;
    this.el.style.top = `${this.y}px`;
    this.el.style.width = `${this.width}px`;
    this.el.style.height = `${this.height}px`;

    const header = document.createElement('div');
    header.className = 'macroHeader';

    this.titleEl = document.createElement('span');
    this.titleEl.className = 'macroTitle';
    this.titleEl.textContent = 'Macros';

    const closeButton = document.createElement('button');
    closeButton.className = 'macroClose';
    closeButton.textContent = 'X';
    closeButton.title = 'Close';
    closeButton.addEventListener('click', () => this.close());

    header.append(this.titleEl, closeButton);

    const body = document.createElement('div');
    body.className = 'macroBody';

    const sidebar = document.createElement('div');
    sidebar.className = 'macroSidebar';

    this.listEl = document.createElement('div');
    this.listEl.className = 'macroList';

    const newButton = document.createElement('button');
    newButton.className = 'macroNew';
    newButton.textContent = '+ New Macro';
    newButton.addEventListener('click', () => this.createMacro());

    sidebar.append(this.listEl, newButton);

    const editor = document.createElement('div');
    editor.className = 'macroEditor';

    const nameRow = document.createElement('div');
    nameRow.className = 'macroNameRow';
    const nameLabel = document.createElement('span');
    nameLabel.textContent = 'Name';
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = 'Macro name';
    this.nameInput.spellcheck = false;
    this.nameInput.addEventListener('change', () => this.renameSelected());
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.nameInput.blur();
    });
    nameRow.append(nameLabel, this.nameInput);

    this.actionsEl = document.createElement('div');
    this.actionsEl.className = 'macroActions';

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'macroStatus';

    const footer = document.createElement('div');
    footer.className = 'macroFooter';

    this.actionSelect = document.createElement('select');
    this.actionSelect.className = 'macroAddSelect';
    for (const [type, label] of Object.entries(ACTION_LABELS)) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = label;
      this.actionSelect.append(option);
    }

    this.addButton = document.createElement('button');
    this.addButton.textContent = 'Add';
    this.addButton.addEventListener('click', () => this.addAction(this.actionSelect.value));
    footer.append(this.actionSelect, this.addButton);

    const spacer = document.createElement('span');
    spacer.className = 'macroSpacer';
    footer.append(spacer);

    this.playButton = document.createElement('button');
    this.playButton.textContent = 'Play';
    this.playButton.addEventListener('click', () => this.playSelected());
    footer.append(this.playButton);

    const stopButton = document.createElement('button');
    stopButton.textContent = 'Stop';
    stopButton.addEventListener('click', () => {
      this.ui?.cancelMacroPlayback?.('Macro stopped.');
      this.setStatus('Stopped.');
    });
    footer.append(stopButton);

    this.deleteButton = document.createElement('button');
    this.deleteButton.textContent = 'Delete';
    this.deleteButton.addEventListener('click', () => this.deleteSelected());
    footer.append(this.deleteButton);

    editor.append(nameRow, this.actionsEl, this.statusEl, footer);
    body.append(sidebar, editor);
    this.el.append(header, body);
    document.body.appendChild(this.el);

    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();
      this.dragging = true;
      this.dragOffset.x = event.clientX - this.x;
      this.dragOffset.y = event.clientY - this.y;
      header.setPointerCapture?.(event.pointerId);
    });
    header.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.x = Math.max(0, Math.min(window.innerWidth - this.width, event.clientX - this.dragOffset.x));
      this.y = Math.max(0, Math.min(window.innerHeight - this.height, event.clientY - this.dragOffset.y));
      this.el.style.left = `${this.x}px`;
      this.el.style.top = `${this.y}px`;
    });
    header.addEventListener('pointerup', () => {
      this.dragging = false;
    });
  }

  contains() {
    return false;
  }

  draw() {}

  save() {
    saveMacros(this.world, this.macros);
    this.setStatus('Saved.');
  }

  setStatus(text) {
    this.statusEl.textContent = text || '';
  }

  select(name) {
    this.selected = name && this.macros[name] ? name : null;
    this.setStatus('');
    this.renderList();
    this.renderEditor();
  }

  renderList() {
    this.listEl.textContent = '';
    const names = Object.keys(this.macros).sort((a, b) => a.localeCompare(b));
    if (!names.length) {
      const empty = document.createElement('div');
      empty.className = 'macroEmpty';
      empty.textContent = 'No macros yet.';
      this.listEl.append(empty);
      return;
    }
    for (const name of names) {
      const macro = this.macros[name];
      const button = document.createElement('button');
      button.className = `macroListItem${name === this.selected ? ' active' : ''}`;
      const label = document.createElement('span');
      label.textContent = name;
      const count = document.createElement('span');
      count.className = 'macroCount';
      count.textContent = String(countMacroActions(macro.actions));
      button.append(label, count);
      button.addEventListener('pointerdown', (event) => this.beginMacroDrag(event, name));
      this.listEl.append(button);
    }
  }

  beginMacroDrag(event, name) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.select(name);
    this.stopMacroDrag();
    this.macroDrag = { name, startX: event.clientX, startY: event.clientY, active: false };
    this.onMacroDragMove = (ev) => this.moveMacroDrag(ev);
    this.onMacroDragEnd = (ev) => this.endMacroDrag(ev);
    window.addEventListener('pointermove', this.onMacroDragMove);
    window.addEventListener('pointerup', this.onMacroDragEnd);
  }

  stopMacroDrag() {
    if (this.onMacroDragMove) window.removeEventListener('pointermove', this.onMacroDragMove);
    if (this.onMacroDragEnd) window.removeEventListener('pointerup', this.onMacroDragEnd);
    this.onMacroDragMove = null;
    this.onMacroDragEnd = null;
    this.macroDrag = null;
    this.dragGhost?.remove();
    this.dragGhost = null;
  }

  moveMacroDrag(event) {
    const drag = this.macroDrag;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (dx * dx + dy * dy < 36) return;
      drag.active = true;
      this.dragGhost = document.createElement('div');
      this.dragGhost.className = 'macroDragGhost';
      this.dragGhost.textContent = drag.name;
      document.body.appendChild(this.dragGhost);
    }
    this.dragGhost.style.left = `${event.clientX + 14}px`;
    this.dragGhost.style.top = `${event.clientY + 14}px`;
  }

  endMacroDrag(event) {
    const drag = this.macroDrag;
    if (!drag) return;
    this.macroDrag = null;
    this.stopMacroDrag();
    if (!drag.active) return;

    const ui = this.ui;
    if (!ui) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (ui.isDomUiTarget?.(target)) return;

    const macro = this.macros[drag.name];
    const hotbar = ui.getWindow?.('hotbar', 'player');
    if (hotbar?.contains?.(event.clientX, event.clientY)) {
      const index = hotbar.slotAt(event.clientX, event.clientY);
      if (index < 0) {
        this.setStatus('Drop on a hotbar slot to bind this macro.');
        return;
      }
      if (
        macro?.actions?.length &&
        hotbar.setSlot(index, { type: 'macro', name: macro.name, actions: macro.actions })
      ) {
        this.world.addMessage(`Bound ${macro.name} to hotbar slot ${index + 1}.`, 0x35, 1, 'System');
        this.setStatus(`Bound ${macro.name} to hotbar slot ${index + 1}.`);
      } else {
        this.setStatus('That macro has no actions to bind.');
      }
      return;
    }

    if (ui.hitTest?.(event.clientX, event.clientY)) return;
    const x = event.clientX - MACRO_BUTTON_WIDTH / 2;
    const y = event.clientY - MACRO_BUTTON_HEIGHT / 2;
    if (!ui.createMacroButton?.(drag.name, x, y)) return;
    ui.raiseWindow?.(this);
    this.setStatus(`Created a Macro button for ${drag.name}.`);
  }

  renderEditor() {
    const macro = this.selected ? this.macros[this.selected] : null;
    this.nameInput.disabled = !macro;
    this.actionSelect.disabled = !macro;
    this.addButton.disabled = !macro;
    this.playButton.disabled = !macro;
    this.deleteButton.disabled = !macro;
    this.actionsEl.textContent = '';
    if (!macro) {
      this.nameInput.value = '';
      const empty = document.createElement('div');
      empty.className = 'macroEmpty';
      empty.textContent = 'Create a macro to add actions.';
      this.actionsEl.append(empty);
      return;
    }
    this.nameInput.value = macro.name;
    if (!macro.actions.length) {
      const empty = document.createElement('div');
      empty.className = 'macroEmpty';
      empty.textContent = 'No actions. Choose an action below and press Add.';
      this.actionsEl.append(empty);
      return;
    }
    this.renderActionList(this.actionsEl, macro.actions);
  }

  renderActionList(container, actions) {
    actions.forEach((action, index) => container.append(this.actionRow(action, index, actions)));
  }

  actionRow(action, index, actions) {
    const group = document.createElement('div');
    group.className = 'macroActionGroup';

    const row = document.createElement('div');
    row.className = 'macroAction';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'macroActionType';
    for (const [type, label] of Object.entries(ACTION_LABELS)) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = label;
      typeSelect.append(option);
    }
    typeSelect.value = action.type;
    typeSelect.addEventListener('change', () => this.changeActionType(actions, index, typeSelect.value));
    row.append(typeSelect, ...this.actionFields(action));

    const up = document.createElement('button');
    up.textContent = '↑';
    up.title = 'Move action up';
    up.disabled = index === 0;
    up.addEventListener('click', () => this.moveAction(actions, index, -1));
    row.append(up);

    const down = document.createElement('button');
    down.textContent = '↓';
    down.title = 'Move action down';
    down.disabled = index === actions.length - 1;
    down.addEventListener('click', () => this.moveAction(actions, index, 1));
    row.append(down);

    const remove = document.createElement('button');
    remove.textContent = 'X';
    remove.title = 'Delete action';
    remove.addEventListener('click', () => this.removeAction(actions, index));
    row.append(remove);

    group.append(row);

    if (action.type === 'loop') group.append(this.loopBody(action));
    return group;
  }

  actionFields(action) {
    const fields = [];
    const textInput = (value, placeholder, onChange) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'macroActionInput';
      input.placeholder = placeholder;
      input.value = value;
      input.spellcheck = false;
      input.addEventListener('change', () => onChange(input.value));
      return input;
    };
    const numberInput = (value, min, max, step, onChange) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'macroActionInput';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.addEventListener('change', () => onChange(input.value));
      return input;
    };
    const note = (text) => {
      const span = document.createElement('span');
      span.className = 'macroActionNote';
      span.textContent = text;
      return span;
    };
    const select = (options, value, onChange) => {
      const element = document.createElement('select');
      element.className = 'macroActionInput';
      for (const option of options) {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.label;
        element.append(item);
      }
      element.value = value;
      element.addEventListener('change', () => onChange(element.value));
      return element;
    };

    if (SPEECH_ACTION_TYPES.includes(action.type)) {
      fields.push(
        textInput(action.text, 'Text to say', (value) => {
          action.text = value.trim();
          this.save();
        })
      );
    } else if (action.type === 'move') {
      fields.push(
        select(
          MACRO_DIRECTIONS.map((direction) => ({ value: String(direction.value), label: direction.label })),
          String(action.direction),
          (value) => {
            action.direction = Number(value) & 7;
            this.save();
          }
        )
      );
    } else if (action.type === 'wait') {
      fields.push(
        numberInput(action.ms, 0, MAX_WAIT_MS, 100, (value) => {
          const ms = Number(value);
          action.ms = Number.isFinite(ms) && ms >= 0 ? Math.min(MAX_WAIT_MS, Math.round(ms)) : 0;
          this.save();
          this.renderEditor();
        }),
        note('ms')
      );
    } else if (action.type === 'loop') {
      fields.push(
        numberInput(action.count, 0, MAX_LOOP_COUNT, 1, (value) => {
          const count = Number(value);
          action.count = Number.isFinite(count) ? Math.max(0, Math.min(MAX_LOOP_COUNT, Math.round(count))) : 1;
          this.save();
        }),
        note('times (0 = until stopped)'),
        numberInput(action.delay, 0, MAX_WAIT_MS, 100, (value) => {
          const delay = Number(value);
          action.delay = Number.isFinite(delay) && delay >= 0 ? Math.min(MAX_WAIT_MS, Math.round(delay)) : 0;
          this.save();
        }),
        note('ms between loops')
      );
    } else if (action.type === 'useObject') {
      fields.push(
        textInput(`0x${action.graphic.toString(16)}`, '0x0F0C', (value) => {
          action.graphic = Math.max(1, Math.min(0xffff, parseMacroNumber(value, action.graphic)));
          this.save();
          this.renderEditor();
        }),
        textInput(action.hue == null ? '' : String(action.hue), 'hue (any)', (value) => {
          const text = value.trim();
          action.hue = text ? Math.max(0, Math.min(0xffff, parseMacroNumber(text, 0))) : null;
          this.save();
          this.renderEditor();
        })
      );
    } else if (action.type === 'usePotion') {
      fields.push(
        select(
          MACRO_POTIONS.map((potion) => ({ value: potion.value, label: potion.label })),
          action.potion,
          (value) => {
            action.potion = value;
            this.save();
          }
        )
      );
    } else if (action.type === 'useSkill') {
      fields.push(
        textInput(action.skill, 'Skill name or index', (value) => {
          action.skill = value.trim();
          this.save();
        })
      );
    } else if (action.type === 'castSpell') {
      fields.push(
        textInput(action.spell, 'Spell name or id', (value) => {
          action.spell = value.trim();
          this.save();
        })
      );
    } else if (action.type === 'invokeVirtue') {
      fields.push(
        select(
          MACRO_VIRTUES.map((virtue) => ({ value: virtue.value, label: virtue.value })),
          action.virtue,
          (value) => {
            action.virtue = value;
            this.save();
          }
        )
      );
    } else if (action.type === 'combatAbility') {
      fields.push(
        select(
          MACRO_ABILITIES.map((ability) => ({ value: String(ability.value), label: ability.label })),
          String(action.ability),
          (value) => {
            action.ability = Number(value) || 1;
            this.save();
          }
        )
      );
    } else if (action.type === 'useHotbar') {
      fields.push(
        numberInput(action.slot, 1, 12, 1, (value) => {
          const slot = Number(value);
          action.slot = Number.isFinite(slot) ? Math.max(1, Math.min(12, Math.round(slot))) : 1;
          this.save();
          this.renderEditor();
        }),
        note('hotbar slot on the current page')
      );
    } else if (action.type === 'command') {
      fields.push(
        textInput(action.command, '-command', (value) => {
          const text = value.trim();
          action.command = text && !text.startsWith('-') ? `-${text}` : text || '-';
          this.save();
          this.renderEditor();
        })
      );
    } else if (action.type === 'waitForTarget') {
      fields.push(note(`Waits up to ${WAIT_FOR_TARGET_MS / 1000} seconds for a target cursor`));
    } else if (action.type === 'targetLast') {
      fields.push(note('Targets your last target'));
    } else if (action.type === 'targetSelf') {
      fields.push(note('Targets yourself with the active cursor'));
    } else if (action.type === 'targetNext') {
      fields.push(note('Targets the next nearby mobile'));
    } else if (action.type === 'clearHands' || action.type === 'equipHands') {
      fields.push(note('Remembers and restores your one- and two-handed items'));
    } else {
      fields.push(note(ACTION_LABELS[action.type] || ''));
    }

    return fields;
  }

  loopBody(action) {
    const body = document.createElement('div');
    body.className = 'macroLoopBody';
    if (!action.actions.length) {
      const empty = document.createElement('div');
      empty.className = 'macroEmpty';
      empty.textContent = 'No actions inside this loop yet.';
      body.append(empty);
    } else {
      this.renderActionList(body, action.actions);
    }

    const addRow = document.createElement('div');
    addRow.className = 'macroLoopAdd';
    const typeSelect = document.createElement('select');
    typeSelect.className = 'macroAddSelect';
    for (const [type, label] of Object.entries(ACTION_LABELS)) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = label;
      typeSelect.append(option);
    }
    const addButton = document.createElement('button');
    addButton.textContent = '+ Add inside';
    addButton.addEventListener('click', () => this.addActionTo(action.actions, typeSelect.value));
    addRow.append(typeSelect, addButton);
    body.append(addRow);
    return body;
  }

  changeActionType(actions, index, type) {
    const previous = actions[index];
    if (!previous || previous.type === type) return;
    const text = previous.text || previous.command || '';
    const action = defaultMacroAction(type);
    if (SPEECH_ACTION_TYPES.includes(type) && text) action.text = text;
    if (type === 'command') action.command = text.startsWith('-') ? text : `-${text}`;
    actions[index] = action;
    this.save();
    this.renderEditor();
  }

  moveAction(actions, index, offset) {
    const target = index + offset;
    if (target < 0 || target >= actions.length) return;
    const [action] = actions.splice(index, 1);
    actions.splice(target, 0, action);
    this.save();
    this.renderEditor();
  }

  removeAction(actions, index) {
    actions.splice(index, 1);
    this.save();
    this.renderList();
    this.renderEditor();
  }

  createMacro() {
    let name = 'Macro';
    let suffix = 2;
    while (this.macros[name]) name = `Macro ${suffix++}`;
    this.macros[name] = { name, actions: [] };
    this.selected = name;
    this.save();
    this.renderList();
    this.renderEditor();
    this.nameInput.focus();
    this.nameInput.select();
  }

  addAction(type) {
    const macro = this.selected ? this.macros[this.selected] : null;
    if (!macro) return;
    this.addActionTo(macro.actions, type);
  }

  addActionTo(actions, type) {
    actions.push(defaultMacroAction(type));
    this.save();
    this.renderList();
    this.renderEditor();
  }

  renameSelected() {
    const macro = this.selected ? this.macros[this.selected] : null;
    if (!macro) return;
    const name = this.nameInput.value.trim();
    if (!name || name === macro.name) {
      this.nameInput.value = macro.name;
      return;
    }
    if (this.macros[name]) {
      this.nameInput.value = macro.name;
      this.setStatus(`A macro named "${name}" already exists.`);
      return;
    }
    const oldName = macro.name;
    delete this.macros[oldName];
    macro.name = name;
    this.macros[name] = macro;
    this.selected = name;
    this.ui?.renameMacroButton?.(oldName, name);
    this.save();
    this.renderList();
    this.renderEditor();
  }

  playSelected() {
    const macro = this.selected ? this.macros[this.selected] : null;
    if (!macro) return;
    if (!macro.actions.length) {
      this.setStatus('Add at least one action before playing.');
      return;
    }
    this.ui?.playMacroActions?.(macro.actions, macro.name);
    this.setStatus(`Playing ${macro.name}.`);
  }

  deleteSelected() {
    const name = this.selected;
    if (!name) return;
    const remove = () => {
      delete this.macros[name];
      this.selected = null;
      this.save();
      this.ui?.removeMacroButton?.(name);
      const first = Object.keys(this.macros).sort((a, b) => a.localeCompare(b))[0] || null;
      this.select(first);
    };
    if (this.ui?.showModal) {
      const body = document.createElement('div');
      body.textContent = `Delete "${name}"?`;
      this.ui.showModal('Delete Macro', body, remove, true);
    } else {
      remove();
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopMacroDrag();
    this.el.remove();
    this.onClose?.();
  }
}
