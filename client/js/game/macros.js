import { accountStorageKey, clampPosition, fitText } from '../util/ui.js';

const MACRO_STORAGE_BASE = 'legionuo.macros.v1';
const MACRO_BUTTON_STORAGE_BASE = 'legionuo.macrobuttons.v1';

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

const ACTION_LABELS = {
  say: 'Say',
  move: 'Move',
  wait: 'Wait (ms)',
  waitForTarget: 'Wait For Target',
  targetLast: 'Target Last',
  command: 'Command',
};

export const WAIT_FOR_TARGET_MS = 10000;
export const MAX_WAIT_MS = 3600000;

export function directionLabel(direction) {
  return MACRO_DIRECTIONS.find((entry) => entry.value === (Number(direction) & 7))?.label || 'North';
}

export function normalizeMacroAction(action) {
  if (typeof action === 'string') {
    const text = action.trim();
    if (!text) return null;
    if (text.startsWith('-')) return { type: 'command', command: text };
    return { type: 'say', text };
  }
  if (!action || typeof action !== 'object') return null;
  if (action.type === 'say') {
    const text = String(action.text ?? '').trim();
    return text ? { type: 'say', text } : null;
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
  if (action.type === 'waitForTarget') {
    return { type: 'waitForTarget' };
  }
  if (action.type === 'targetLast') {
    return { type: 'targetLast' };
  }
  return null;
}

export function normalizeMacroActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.map(normalizeMacroAction).filter(Boolean);
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
      .map((entry) => ({
        name: String(entry.name).trim(),
        x: Number(entry.x) || 40,
        y: Number(entry.y) || 40,
      }));
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
  if (normalized.type === 'say') return `Say: ${normalized.text}`;
  if (normalized.type === 'move') return `Move: ${directionLabel(normalized.direction)}`;
  if (normalized.type === 'wait') return `Wait: ${normalized.ms}ms`;
  if (normalized.type === 'waitForTarget') return 'Wait for target cursor';
  if (normalized.type === 'targetLast') return 'Target last';
  return `Command: ${normalized.command}`;
}

export class MacroButtonWindow {
  constructor(world, name, x = 40, y = 40) {
    this.world = world;
    this.name = String(name || 'Macro');
    this.width = 140;
    this.height = 30;
    this.dragging = false;
    this.dragMoved = false;
    this.dragOffset = { x: 0, y: 0 };
    this.start = { x: 0, y: 0 };
    const pos = clampPosition(x - this.width / 2, y - this.height / 2, this.width, this.height);
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
      count.textContent = String(macro.actions.length);
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
    if (!ui.createMacroButton?.(drag.name, event.clientX, event.clientY)) return;
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
    macro.actions.forEach((action, index) => this.actionsEl.append(this.actionRow(action, index, macro)));
  }

  actionRow(action, index, macro) {
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
    typeSelect.addEventListener('change', () => this.changeActionType(index, typeSelect.value));
    row.append(typeSelect);

    if (action.type === 'say') {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'macroActionInput';
      input.placeholder = 'Text to say';
      input.value = action.text;
      input.addEventListener('change', () => {
        action.text = input.value.trim();
        this.save();
      });
      row.append(input);
    } else if (action.type === 'move') {
      const select = document.createElement('select');
      select.className = 'macroActionInput';
      for (const direction of MACRO_DIRECTIONS) {
        const option = document.createElement('option');
        option.value = String(direction.value);
        option.textContent = direction.label;
        select.append(option);
      }
      select.value = String(action.direction);
      select.addEventListener('change', () => {
        action.direction = Number(select.value) & 7;
        this.save();
      });
      row.append(select);
    } else if (action.type === 'wait') {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'macroActionInput';
      input.min = '0';
      input.max = String(MAX_WAIT_MS);
      input.step = '100';
      input.value = String(action.ms);
      input.addEventListener('change', () => {
        const ms = Number(input.value);
        action.ms = Number.isFinite(ms) && ms >= 0 ? Math.min(MAX_WAIT_MS, Math.round(ms)) : 0;
        input.value = String(action.ms);
        this.save();
      });
      const unit = document.createElement('span');
      unit.className = 'macroActionNote';
      unit.textContent = 'ms';
      row.append(input, unit);
    } else if (action.type === 'waitForTarget') {
      const note = document.createElement('span');
      note.className = 'macroActionNote';
      note.textContent = `Waits up to ${WAIT_FOR_TARGET_MS / 1000} seconds for a target cursor`;
      row.append(note);
    } else if (action.type === 'targetLast') {
      const note = document.createElement('span');
      note.className = 'macroActionNote';
      note.textContent = 'Targets your last target';
      row.append(note);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'macroActionInput';
      input.placeholder = '-command';
      input.value = action.command;
      input.addEventListener('change', () => {
        const value = input.value.trim();
        if (value && !value.startsWith('-')) input.value = `-${value}`;
        action.command = input.value.trim();
        this.save();
      });
      row.append(input);
    }

    const up = document.createElement('button');
    up.textContent = '↑';
    up.title = 'Move action up';
    up.disabled = index === 0;
    up.addEventListener('click', () => this.moveAction(index, -1));
    row.append(up);

    const down = document.createElement('button');
    down.textContent = '↓';
    down.title = 'Move action down';
    down.disabled = index === macro.actions.length - 1;
    down.addEventListener('click', () => this.moveAction(index, 1));
    row.append(down);

    const remove = document.createElement('button');
    remove.textContent = 'X';
    remove.title = 'Delete action';
    remove.addEventListener('click', () => {
      macro.actions.splice(index, 1);
      this.save();
      this.renderList();
      this.renderEditor();
    });
    row.append(remove);

    return row;
  }

  changeActionType(index, type) {
    const macro = this.selected ? this.macros[this.selected] : null;
    if (!macro) return;
    const previous = macro.actions[index];
    if (!previous || previous.type === type) return;
    const text = previous.text || previous.command || '';
    let action;
    if (type === 'move') action = { type: 'move', direction: 0 };
    else if (type === 'wait') action = { type: 'wait', ms: Number(previous.ms) || 1000 };
    else if (type === 'waitForTarget') action = { type: 'waitForTarget' };
    else if (type === 'targetLast') action = { type: 'targetLast' };
    else if (type === 'command') action = { type: 'command', command: text.startsWith('-') ? text : `-${text}` };
    else action = { type: 'say', text };
    macro.actions[index] = action;
    this.save();
    this.renderEditor();
  }

  moveAction(index, offset) {
    const macro = this.selected ? this.macros[this.selected] : null;
    if (!macro) return;
    const target = index + offset;
    if (target < 0 || target >= macro.actions.length) return;
    const [action] = macro.actions.splice(index, 1);
    macro.actions.splice(target, 0, action);
    this.save();
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
    if (type === 'move') macro.actions.push({ type: 'move', direction: 0 });
    else if (type === 'wait') macro.actions.push({ type: 'wait', ms: 1000 });
    else if (type === 'waitForTarget') macro.actions.push({ type: 'waitForTarget' });
    else if (type === 'targetLast') macro.actions.push({ type: 'targetLast' });
    else if (type === 'command') macro.actions.push({ type: 'command', command: '-' });
    else macro.actions.push({ type: 'say', text: '' });
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
