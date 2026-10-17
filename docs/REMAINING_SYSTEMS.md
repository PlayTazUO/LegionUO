# LegionUO — Remaining Basic Systems

This document lists the client systems still needed for basic, comfortable UO play.
It is a working checklist, not a final design. Priorities are P0 (blocks normal play),
P1 (needed for daily use), P2 (quality of life / later polish).

## Current baseline

Implemented today:

- Login, server list, relay, character list, character selection, basic character creation.
- Packet framing, login/Twofish encryption, Huffman, keep-alive pings.
- Isometric terrain, statics, items, mobiles, basic equipment animation, corpses, multis.
- Basic effects, names, speech, damage text, lighting, weather, target cursor.
- Server gump layout parser (`client/js/game/gump.js`) and several simplified windows:
  containers, paperdoll, shop, book, profile (`client/js/game/windows.js`).
- Journal is a fixed DOM panel; status is a fixed HUD panel plus a modal popup.
- Movement uses a paced step queue with render interpolation, confirm/deny reconciliation,
  hold-to-walk keyboard input, and A* click-to-walk. Other mobiles walk tile-by-tile to
  position updates via a chained motion queue.

The systems below are the main gaps.

---

## 1. Smooth walking and movement — P0 (implemented)

### Current state

- `World.walk()` in `client/js/game/world.js` builds a timed `Step` queue (walk/run/mount
  timings from config), keeps at most 5 unacknowledged steps, and predicts the player tile.
- Render positions are interpolated from step progress; the renderer draws mobiles and the
  camera from `renderX/Y/Z`, and walk/run animation frames follow step progress.
- Other mobiles walk tile-by-tile to each position update instead of teleporting.
- Confirm (`0x22`) removes a pending step without snapping. Deny (`0x21`) clears the queue,
  resets the sequence, snaps to server coordinates, and cancels click paths. Server
  corrections (`0x20/0x77/0x78/0x97/0xF3`) cancel or reconcile pending prediction.
- Click-to-walk uses A* over map blocks with land/static blocking, Z checks, diagonal
  corner rules, and nearest-walkable target validation (`client/js/game/pathfinding.js`).
- Keyboard movement repeats while keys are held, supports diagonals and Shift-run, turns
  in place on locally blocked steps, and is suppressed while dead/frozen or typing.
- Footstep sounds fire at step completion (mounted/run/terrain variants).
- Remaining polish: explicit stunned-state gating, multi blocking in pathfinding, and
  real UO footstep audio samples (current footsteps are synthesized).

### Requirements (implemented)

**Step queue and timing**

- One `Step` per requested move: `sequence`, `direction`, `run`, `fromX/Y/Z`,
  `toX/Y/Z`, `startTime`, `duration`, `serverConfirmed`.
- Client walk times: walk ≈ 400 ms, run ≈ 200 ms (server-configured; mount and
  stamina modifiers must be adjustable).
- At most 5 unacknowledged steps, matching the server limit. Stop queuing when full.
- First walk sequence must be `0`, then `1..255`, then `1` (already fixed in world.js).
- On deny (`0x21`): snap to server coordinates, clear the queue, reset sequence to 0.
- On confirm (`0x22`): remove the matching step; do not snap the player if the local
  prediction still matches.
- On `0x20 / 0x77 / 0x78 / 0x97 / 0xF3` server corrections: cancel pending steps,
  clear interpolation, and blend or snap to the authoritative position.

**Interpolation**

- Keep integer tile positions for game logic and a render-only offset
  `(renderX, renderY, renderZ)` updated by step progress.
- `Renderer.screenFor()` should use the interpolated position, not `entity.x/y`.
- Animate mobiles using the same step timing; walk/run animation frame rate must
  match step duration, not wall-clock independently.
- Interpolate Z; avoid popping on stairs/slopes.
- Handle teleports/resyncs by snapping (no interpolation over large distances).

**Input**

- Hold WASD/arrow keys to continue walking; support diagonals.
- Running: Shift or the client's run toggle (match UO behavior).
- Turn-in-place when the direction changes but movement is blocked.
- Do not move while dead, frozen, stunned, or while a blocking gump/modal is open.
- War mode affects animation group, not speed.
- Distinguish keyboard focus: ignore movement while chat, text entry, or a modal
  input is focused.

**Click-to-walk / pathfinding**

- A* over map tiles with statics/multis blocking and Z checks.
- Line-of-sight and “reachable” validation before queuing.
- Re-path when the target changes; cancel on manual input.
- Server denial should stop the path and resync, not loop.

**Presentation**

- Footstep sounds at step completion (mounted, running, and terrain variants).
- Smooth camera follow; camera should use interpolated player position.
- Other mobiles walk tile-by-tile to position updates; large teleports/resyncs snap.

### Acceptance

- Walking/running looks continuous; no visible tile snapping on a normal connection.
- Denied steps do not leave the player visually ahead of the server.
- Click-to-walk navigates around walls/objects and stops at the target.
- Holding a movement key walks continuously at the correct cadence.

---

## 2. Journal and chat — P0/P1

### Current state

- `client/index.html` / `client/css/style.css` contain a fixed bottom-left journal.
- `UI.onMessage()` appends DOM rows; max 500 rows; color derived from hue.
- `UI.sendChat()` sends Unicode speech; `-commands` are handled in `ui.js`.
- No filters, timestamps, tabs, chat channels, ignore list, or persistence.

### Required

**Message model**

- Fields: timestamp, text, name, serial, hue, font, message type, text type
  (system/object/guild/alliance/party/spell/damage), cliloc id, affix, whether the
  message was overhead, and whether it was translated from cliloc.
- Preserve message order; support message replacement/append for cliloc affixes.
- Resolve cliloc arguments (`~1_val~`, `#number`) using the loaded cliloc table.

**Display**

- Movable and resizable journal window; saved position/size per account.
- Scrollback with scroll lock (auto-scroll only when already at bottom).
- Timestamps toggle, per-type colors, font size, opacity, and max-line setting.
- Optional tabs/filters: All, System, Speech, Party, Guild/Alliance, Spells, Damage.
- System messages and command output styled distinctly.
- Selectable/copyable text.
- Overhead speech must respect whisper/yell/emote types, hue, font, and language.
- Damage numbers and system messages remain overhead where appropriate.

**Chat input**

- Enter opens chat; send on Enter; Esc closes; history with Up/Down.
- Commands: at minimum `-help`, `-skills`, `-status`, `-where`, `-war`, `-peace`,
  `-resync`, `-logout`, `-open`, and the shard's common chat/party/guild commands.
- Speech modes: say, whisper, yell, emote, party, guild, alliance (where supported).
- Chat channels: join/create/leave/message (0xB3) if the shard enables chat.
- Ignore list and per-player filtering.
- Language field for Unicode speech.
- Prompt responses (0x9A/0xC2) must use the active prompt data, not the chat line.

**Persistence**

- Journal filters, position, size, and opacity.
- Optional per-account log file/export (P2).

### Acceptance

- Journal can be moved, resized, filtered, and scrolled without losing new messages.
- Speech, cliloc messages, system messages, and damage display correctly.
- Chat commands and prompt responses work without moving the character while typing.

---

## 3. Movable character status window — P0

### Current state

- `#statusPanel` is a fixed HTML panel in the top-left (`client/index.html`,
  `client/css/style.css`).
- `UI.showStatus()` opens a read-only modal; it cannot be moved and is not the
  classic status gump.
- HP/MP/SP bars and weight/gold exist; many player stats are parsed but not shown.

### Required

**Window behavior**

- A real draggable window (canvas or DOM overlay) with:
  - move by dragging the title/body;
  - close button and keyboard shortcut;
  - reopen via the `ST` button, paperdoll status button, or server status request;
  - saved position, size (if resizable), scale, and always-on-top setting;
  - correct z-order with gumps, containers, and journal;
  - does not steal WASD input when not focused.

**Content**

- Name, title, notoriety/ghost state.
- Bars and numbers: Hits, Stamina, Mana (current/max).
- Strength, Dexterity, Intelligence; stat cap.
- Weight / weight max; gold; followers / followers max; luck; tithing.
- Resistances: physical, fire, cold, poison, energy (and max values where sent).
- Damage min/max; DCI/HCI/SSI/DI/LRC/SDI/FCR/FC/LMC if available.
- Buff/debuff summary (icon row or count) with tooltips.
- Skill summary intentionally lives in the skills gump, not here.

**Live updates**

- `0x11` status, `0x2D` mobile attributes, `0xA1/A2/A3` hit/mana/stamina updates.
- `0x20/0x77/0xD2` flags (dead, war mode, etc.).
- Death/resurrection (`0x2C`, `0xAF`) updates the window state.
- Opening the window sends a throttled status request (`0x34`).

**Actions**

- Open paperdoll, skills, journal/quests, options, party, help, logout.
- War/peace toggle; always-on-top; lock position.
- Self-target/status refresh.

### Acceptance

- The window can be dragged, closed, reopened, and retains its position.
- All displayed values update from server packets without opening the modal.
- Movement keys still work when the window is open but not focused.

---

## 4. Gump system and required gumps — P0/P1/P2

### Current gump framework

Implemented in `client/js/game/gump.js`:

- Layout tokenizer, pages/groups, resize-pic, gump-pic, tiled pic, tile pic,
  text, cropped text, HTML-gump (plain text), button, checkbox, radio,
  text entry, checker-trans, and gump response.
- `windows.js` has simplified container, paperdoll, shop, book, profile windows.

Missing framework pieces:

- Proper UO text fonts, hue application for text, rich HTML subset, link handling.
- Tooltips, item properties/OPL, `maparea`, `picinpic`, `itemproperty`,
  `gumppichued` variants, `mastergump`, `noresize`, `nodispose`, `noclose` semantics.
- Keyboard focus/caret/selection/IME, clipboard, tab order.
- Scrolling panels, clipping, scrollbars.
- Gump reuse/update by server gump id, position persistence, scaling.
- Server gump close/reply semantics and master-gump cascading.
- Z-order/drag/close rules consistent with UO (right-click, Esc, no-close gumps).

### Required basic gumps

#### P0

**Paperdoll (full)**

- Real paperdoll gump background (male/female/ghost) with equipment layers.
- Draw equipped items on the paperdoll using their gump/anim IDs and hues.
- Buttons: war/peace, status, skills, journal/quests, guild/chat, options, help,
  party, profile, virtue, mount/dismount, title.
- Equipment slots with double-click equip/unequip, drag/drop, tooltips.
- Can-lift behavior, title display, update on `0x88` and equipment packets.
- Double-clicking a mobile opens its paperdoll (0x88 from server).

**Container**

- Correct container gump art and size; item positions using `item.x/y`.
- Amount overlays and stacking; scroll when items overflow.
- Double-click use, drag pickup/drop, drop into container/world.
- Close, context menu, corpse loot behavior.
- Grid/legacy layout options (at least one usable layout).

**Skills**

- Full skill list with value/base/cap and lock state.
- Sort/filter, use skill button, skill lock toggles (`0x3A`), stat locks.
- Updates from `0x3A` (including `0xFE` name list and `0xFF/0xDF` single updates).

**Spellbook**

- Circles/pages, spell icons, cast on click/double-click.
- Cast from book (`0x12 0x27`) or `0xBF 0x1C`, mana check/cooldown feedback.
- Spell tooltips and scroll support.

**Shop buy/sell**

- Buy list with price, quantity controls, total, gold check, confirm.
- Sell list with quantity and total.
- Uses `0x74`/`0x9E` and replies with `0x3B`/`0x9F`.

**Secure trade**

- Both sides' items and gold/platinum, accept/cancel, live updates (`0x6F`).
- Item counts/totals and state indicators.

#### P1

**Book**

- Read pages, page navigation, title/author, edit mode and save.
- Packets: `0x66`, `0x93`, `0xD4`.

**Bulletin board**

- Board list, message summary, read message, post/remove (subject/body).
- Packet `0x71`.

**Profile**

- Header/body/footer rendering and edit/save (`0xB8`).

**Menu / gray menu**

- Item menu with graphics/hues and numbered choices.
- Gray menu with radio-style options and OK/Cancel.
- Replies via `0x7D`.

**Text entry, prompts, dye**

- Text entry dialog (`0xAB` / `0xAC`), ASCII/Unicode prompts (`0x9A`/`0xC2`).
- Dye/color picker (`0x95`) with hue grid and preview.

**Party**

- Party manifest: members, leader, HP bars, invite/accept/decline,
  leave/kick, loot type, party chat.
- Packets: `0xBF 0x06`, incoming party updates.

**Buff/debuff bar**

- Icons with timers, tooltips, add/remove (`0xDF`), saved position.

**Tooltips / OPL**

- Item property list (OPL revision/MegaCliloc), cliloc name/description,
  tooltip on hover for items, mobiles, and gumps.

**Context menu**

- Right-click mobiles/items/ground: use, look, attack, follow, open paperdoll,
  buy/sell, steal, etc., using `0xBF 0x13/0x15` when available.

#### P2

- Map gump / minimap / radar (`0x90`/`0xF5`), map pins and world map.
- Options/settings window (video, sound, input, gumps, journal, movement).
- Hotbar/desktop, spell/ability shortcuts.
- Quest arrow and waypoint list UI.
- Death/resurrection screen and ghost state.
- House/custom-house editing UI.
- Vendor search, runebook, bulk order, quest log.
- Chat channel UI (if enabled by the shard).

### Gump acceptance

- Every server gump used by normal gameplay opens, draws correctly, and can be
  closed/responded to.
- Controls hit-test and respond at the correct coordinates under scaling.
- Text entries accept keyboard input without moving the character.
- Gump positions survive reconnect if the client persists them.
- Paperdoll/container/skills/spellbook/shop/trade cover the normal play loop.

---

## 5. Supporting basics (brief)

- **Targeting:** last target, target cursor modes, target by resource, cancel,
  multi placement, target info tooltip (mostly present; needs polish).
- **Health/name overhead:** consistent name/health bars, hide/show settings.
- **Death/ghost:** death screen, ghost rendering, resurrection gump.
- **Lighting/time/weather:** day/night transitions, personal light, indoor light.
- **Audio:** footsteps, combat, UI gump sounds, music, volume settings.
- **Options:** persist client settings (not just login values).
- **Persistence:** window positions, journal/filter settings, hotbar, paperdoll.

---

## 6. Suggested implementation order

1. Movement model + render interpolation + deny reconciliation. *(done)*
2. Movable status window using the existing entity/status packets.
3. Journal model + filters + chat input polish.
4. Gump framework hardening (text/fonts/tooltips/scroll/focus/persistence).
5. Paperdoll, container, skills, spellbook.
6. Shop, trade, book, profile, menus, prompts, dye.
7. Party, buffs, tooltips/OPL, context menu.
8. Map/radar, options, hotbar, death screen, audio.

## 7. Current file map

| Area | File |
| --- | --- |
| Movement / world state | `client/js/game/world.js` |
| Click-to-walk pathfinding | `client/js/game/pathfinding.js` |
| Rendering / camera | `client/js/game/renderer.js` |
| Entities / layers | `client/js/game/entity.js` |
| Effects / audio | `client/js/game/effects.js`, `client/js/game/audio.js` |
| Server gump parser | `client/js/game/gump.js` |
| Simplified windows | `client/js/game/windows.js` |
| HUD, journal, modals, input | `client/js/ui/ui.js`, `client/index.html`, `client/css/style.css` |
| Incoming packets | `client/js/net/handlers.js` |
| Outgoing packets | `client/js/net/outgoing.js` |
| Socket/crypto/compression | `client/js/net/socket.js`, `client/js/crypto/*` |
| Asset endpoints | `server/assets.js`, `server/uo/*` |

## 8. Basic-play test checklist

- Walk/run with keyboard, diagonals, and click-to-walk around obstacles.
- Idle for 2+ minutes without disconnect.
- Open/close/move status, journal, paperdoll, container, skills, spellbook.
- Buy/sell an item, trade with a player, read/post a book.
- Receive speech, cliloc, system, party, and damage messages.
- Hover an item and see name/properties.
- Use a skill and cast a spell.
- Die and resurrect.
- Close every gump with its intended close method.
