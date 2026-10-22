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
- Journal is now a movable/resizable window with a per-account message model, timestamp
  toggle, tabs/filters, opacity/font/line settings, ignore list, scroll lock, and
  speak/whisper/yell/emote/party/guild/alliance chat modes.
- Server gump parser (`client/js/game/gump.js`) with pages, hued/tiled/pic-in-pic
  art, HTML text, buttons, checkboxes/radios, inline text entries, scrolling,
  tooltip/item-property commands, server gump reuse/close semantics, and position
  persistence. Several simplified windows live in `client/js/game/windows.js`:
  containers, paperdoll, skills, shop, book, profile, status, and spellbook.
- Spellbooks open from `0x24` (`0xFFFF`), consume `0xBF 0x1B` content masks, show
  circle/page tabs with icons and tooltips, page with the wheel or buttons, and cast
  on double-click (`0xBF 0x1C`).
- The status window is a draggable canvas window; the journal is a draggable,
  resizable DOM window (`client/js/ui/journal.js`) with per-account settings.
  All windows raise on click and observe right-click/Esc close rules.
- Movement uses a paced step queue with render interpolation, confirm/deny reconciliation,
  hold-to-walk keyboard input, right-click mouse-walk, and A* click-to-walk. Other mobiles
  walk tile-by-tile to position updates via a chained motion queue.
- Death shifts the player to a ghost body and allows ghost movement; resurrection
  restores the living body from `0x2C` or the next mobile update.
- Left-click requests world object context menus (and sends a single click); double-click
  uses them. Dragging a ground item picks it up, and releasing drops it at the cursor or
  into a container. Shift-click picks up immediately.
- Buff/debuff bar (`client/js/game/buffs.js`) shows active effects as draggable icons
  with duration countdowns, hover tooltips, expiry filtering, and saved position.
- Containers support wheel/scrollbar paging, server and grid item layouts, stacked
  item art (a second icon offset right/down), and a shift-click/shift-drag split
  prompt with a clamped amount; dropping a stack onto another stack is sent to the
  server for merging. A collapsible list view under each container shows item art,
  name, and count with the same click/double-click/drag/context-menu interactions.
- Secure trade (`client/js/game/windows.js`) has both offer lists, gold/platinum entry,
  accept/cancel state, live updates, item drag/drop, tooltips, and saved position.
- Party (`0xBF 0x06`) has a manifest window with leader/member slots, HP bars, invite,
  accept/decline, tell/kick, leave/disband, loot toggle, party chat, and saved position.
- Hotbar/desktop (`client/js/game/hotbar.js`, `HB` button or `-hotbar`) has 12 slots
  bound to keys `1`-`0`, `-`, and `=`, drag-to-bind items, `-hotbar set` bindings for
  items, spells, skills, and commands, right-click clearing, tooltips, and per-account
  position and slot persistence.
- Context menus (`0xBF 0x14`) open on single-click over world and container items, show
  cliloc entries with hue/arrow flags, and reply with `0xBF 0x15`. Right-clicking ground
  still starts mouse-walk.
- Shops (`0x74`/`0x9E`) have per-item quantity controls, per-unit and line totals, a
  gold check, Clear/All helpers, confirm buy/sell, item tooltips and context menus,
  scrolling, and a saved window position.
- Books support page editing with title/author save (`0x66`/`0xD4`/`0x93`), and
  profiles support own-body editing (`0xB8`); both open from their server packets.
- Bulletin boards (`0x71`) open from board items with a scrollable message list,
  full-message read view, post form, remove confirmation, and saved position.
- Radar/minimap (`-radar`, `MAP`) renders terrain and statics with `radarcol.mul`
  colours, mobile/waypoint dots, a small/large toggle, and saved position.
- Map item gumps (`0x90`/`0xF5`) render `facetXX.mul` crops, accept `0x56` pins and
  clear commands, support plot mode, draw numbered routes, and save their position.
- Full-screen world map (`WorldMapWindow`, `WM` button or `-worldmap`) loads whole
  facets through `/api/mapimage`, with facet tabs, wheel zoom around the cursor, drag
  panning, center/fit controls, window drag/resize, saved state, player/party/
  waypoint/quest markers, hover coordinates, and double-click click-to-walk.
- UOLive/UltimaLive map updates (`client/js/game/uolive.js`) handle server map
  definitions, block CRC/hash queries, and terrain/static patches, applying them to
  map blocks before rendering; custom-house design commands and updates are handled.
- Paperdolls use the real gump art (`0x07D0`/`0x07D1`), draw equipped layers on the
  animated doll, show per-layer equipment slots with tooltips, support drag/drop
  pickup and equip, provide help/journal/skills/war/status/profile/party/logout
  buttons, and save their position per character.
- Item menus (`0x7C`) show numbered item art with hues and hover names and reply with
  `0x7D`; gray menus render radio choices with OK/Cancel and cancel with code 0.
- Dye requests (`0x95`) open a 20x10 hue grid with five shade graduations, a live hue
  swatch/item preview, and an OK response.
- Options/settings window (`client/js/game/settings.js`, `OptionsWindow`) provides
  General, Display, and Audio tabs for always-run, journal timestamps, mobile names,
  health bars, speech, lighting, weather, quest arrow, waypoints, audio enable,
  volume, and footsteps. Toggles apply live, and all values plus window position/tab
  persist in `localStorage`; it opens from the `OPT` button or `-options`.
- Waypoint/quest window (`client/js/game/waypoints.js`, `WaypointWindow`) opens from
  the `WP` button or `-waypoints`, lists the server quest arrow, `0xE5` server
  waypoints, and local waypoints with facet/distance. Local waypoints are added at
  the player's position or given coordinates (`-waypoint add [x y] [name]`), can be
  removed individually or cleared, persist per account, and render in the world,
  radar, and world map.
  Double-clicking a row walks there; clicking the on-screen quest arrow sends
  `0xBF 0x07` and walks toward it.
- Chat channels (`0xB2`/`0xB3`), Unicode language selection, journal text export,
  per-account options/keybinds, and a macro editor are implemented.
- Gump bitmap fonts (`fonts.mul`), map areas, gump scaling, and persistent gump
  switch/entry state are implemented.
- Status always-on-top/lock/scale, extended combat properties, and a buff summary are
  implemented; party friend lists, paperdoll durability/virtue/book controls, other
  mobile equipment lifting, and skill/stat lock controls are implemented.
- Buff stacking/expiry warnings, hotbar pages/macros/spell dragging, ground context
  actions, custom-house design commands, radar multis, real `sound.mul`/digital music
  playback, and target-resource/near-self macros are implemented.

The remaining items are mostly polish or shard-dependent features.

---

## 1. Smooth walking and movement — P0 (implemented)

### Current state

- `World.walk()` in `client/js/game/world.js` builds a timed `Step` queue (walk/run/mount
  timings from config), keeps at most 5 unacknowledged steps, and predicts the player tile.
- Render positions are interpolated from step progress; the renderer draws mobiles and the
  camera from `renderX/Y/Z`, and walk/run animation frames follow step progress.
- Other mobiles walk tile-by-tile to nearby position updates; jumps over 4 tiles teleport.
- Confirm (`0x22`) removes a pending step without snapping. Deny (`0x21`) clears the queue,
  resets the sequence, snaps to server coordinates, and cancels click paths. Server
  corrections (`0x20/0x77/0x78/0x97/0xF3`) cancel or reconcile pending prediction.
- Click-to-walk uses A* over map blocks with land/static blocking, Z checks, diagonal
  corner rules, and nearest-walkable target validation (`client/js/game/pathfinding.js`).
- Keyboard movement repeats while keys are held, supports diagonals and Shift-run, turns
  in place on locally blocked steps, and is suppressed while dead/frozen or typing.
- Footstep sounds fire at step completion (mounted/run/terrain variants) and use
  decoded `sound.mul` samples when available, falling back to synthesis.
- Stun/freeze flags gate movement, and A* respects loaded multi components in addition
  to land/static blocking. Running out of stamina falls back to walk timing.

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
- Hold the right mouse button to walk toward the cursor; left-click requests object
  context menus and selects (single click), and double-click uses them.
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
- Other mobiles walk tile-by-tile to nearby position updates; jumps over 4 tiles and large resyncs snap.

### Acceptance

- Walking/running looks continuous; no visible tile snapping on a normal connection.
- Denied steps do not leave the player visually ahead of the server.
- Click-to-walk navigates around walls/objects and stops at the target.
- Holding a movement key walks continuously at the correct cadence.

---

## 2. Journal and chat — P0/P1 (implemented)

### Current state

- `client/js/ui/journal.js` holds a 500-entry message model and renders the movable,
  resizable journal window in `client/index.html` / `client/css/style.css`.
- Entries keep timestamp, text, name, serial, hue, font, message type, text type,
  cliloc id, affix, overhead and translated flags; cliloc text is resolved when the
  packet is handled.
- Tabs filter All/System/Speech/Party/Guild/Spells/Damage; timestamps, font size,
  opacity, max lines, ignore list, filter and window position/size persist per account.
- New messages auto-scroll only when the log is already at the bottom.
- Chat input supports history, prompt responses, and say/whisper/yell/emote/party/
  guild/alliance modes; `-ignore`, `-journal`, `-clear`, `-timestamps` and the mode
  commands are handled in `ui.js`.
- Journal and chat are complete for normal play. Chat channels (`0xB2`/`0xB3`) are
  handled through `-chat join/create/leave/msg/list/open`, a language code is used for
  Unicode speech, cliloc affixes/replacements are merged, and the journal can be
  exported to a text file with `-export`.

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

## 3. Movable character status window — P0 (implemented)

### Current state

- `StatusWindow` in `client/js/game/windows.js` is a canvas window like the
  paperdoll: drag with the left mouse button, right-click or Esc to close, and it
  participates in the normal window z-order (clicking any window raises it).
- `UI.showStatus()` opens or raises the window; it also opens on entering the
  world and can be reached from the `ST` button and the `-status` command.
- The old fixed `#statusPanel` HUD has been removed.
- Displayed today: name/title, ghost/notoriety/stat-cap, HP/SP/MP bars,
  STR/DEX/INT, weight/gold/followers/luck/tithing, physical/fire/cold/poison/energy
  resists, damage range, DCI/HCI/SSI, and position. Live values already come from the
  status/attribute/update packets.
- Position is saved per account and restored/clamped on open; opening or raising the
  window sends a throttled `0x34` status request.
- Action buttons open the paperdoll, skills list, and journal, toggle war/peace,
  refresh status, and log out. Right-click, the title-bar X, or Esc close the window.
- Always-on-top, lock, and 75-150% scale are saved per account; Ctrl+wheel changes
  scale. Extended DI/LRC/SDI/FCR/FC/LMC fields and a live buff/debuff icon summary are
  displayed.

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

- Layout tokenizer, pages/groups, resize-pic, gump-pic (including hued variants),
  pic-in-pic, tiled pic, tile pic, text, cropped text, HTML-gump, button,
  button-tile-art, checkbox, radio, text entry, checker-trans, and gump response.
- `nomove`, `noclose`, `nodispose`, `noresize`, `mastergump`, `tooltip`, and
  `itemproperty` commands; tooltip clilocs/arguments and OPL serials attach to the
  preceding control.
- HTML gumps support clipped scrolling with mouse wheel/scrollbar interaction, and
  links open in a new browser tab.
- Text entries use inline focus with caret blinking, selection, clipboard
  copy/cut/paste, Home/End/arrows, Backspace/Delete, max length, and Tab/Shift-Tab
  focus order. Focused entries suppress movement input.
- Server gumps are reused and updated in place when the same gump id is resent;
  positions persist per gump id. Server close (`0xBF 0x04`) and close-UI-window
  (`0xBF 0x16`) commands are handled, and closing a master gump cascades to gumps
  that reference it.
- Windows raise on click and respect right-click/Esc/no-close rules.

Framework pieces added in this revision:

- Bitmap text decoded from `fonts.mul`, served as atlas PNGs, with `-gumpfont 0-9`
  selection and canvas fallback when a font is unavailable.
- `maparea` renders facet crops through `/api/mapimage`.
- IME composition is inserted into focused text entries; switch/checkbox/radio and
  text-entry values survive server gump updates.
- Per-gump scaling with Ctrl+wheel, persisted with gump positions per account.
- Basic table/row/cell and horizontal-rule handling in the HTML parser.

Remaining framework polish: native browser text selection, multi-line text entries,
and richer embedded-image/background HTML.

`windows.js` has container, paperdoll, book, profile, status, spellbook, and shop
windows (containers, paperdolls, books, and profiles are still simplified).

### Required basic gumps

Current status at a glance:

| Gump | Status | Notes |
| --- | --- | --- |
| Paperdoll | Implemented | Real gump art, animated doll with equipment layers, per-layer sidebar slots, tooltips, durability bars, drag/drop equip, lifting other mobiles' equipment, virtue and equipment-book buttons, action buttons, title/name, and saved position. |
| Container | Implemented | Gump background, server `item.x/y` layout with grid fallback, stacked item art, wheel/scrollbar scrolling, use, drag/drop with container-local coordinates, shift-click/drag stack splitting, stack merging on drop, a collapsible item list view under the container, tooltips/single-click context menu, right-click close, and saved position. |
| Skills | Implemented | Canvas window with value/base/cap, skill and STR/DEX/INT lock cycling, sort/filter, use button, wheel scrolling, and saved position. |
| Spellbook | Implemented | Canvas spellbook with circle/page tabs, icons, mana/power-word tooltips, wheel paging, saved position, and double-click casting. Supports magery, necromancy, chivalry, bushido, ninjitsu, spellweaving, mysticism, and mastery books. |
| Shop | Implemented | Buy/sell lists with per-item quantities, unit/line totals, gold check, Clear/All, confirm, tooltips, context menus, scrolling, and saved position. |
| Secure trade | Implemented | Canvas trade window with both offer lists, gold/platinum entry, accept state, item drag/drop, tooltips, cancel/close, and saved position. |
| Book | Implemented | Pages, title/author, navigation, and editable pages with title/author save. |
| Bulletin board | Implemented | `BoardWindow` opens from the board header, lists summaries, reads full messages, posts new messages with a subject/body form, removes messages after confirmation, and persists its position; `0x71` null-terminated strings are handled. |
| Profile | Implemented | Header/footer/body rendering; own profile body editing and save (`0xB8`). |
| Menu / gray menu | Implemented | Item menus show numbered item art with hues, hover names and `0x7D` replies; gray menus use radio choices with OK/Cancel and a code-0 cancel response. |
| Text entry / prompts / dye | Implemented | Modal text entry, ASCII/Unicode prompts, and a hue-grid dye picker with five shade graduations and a live item/swatch preview. |
| Party | Implemented | Movable manifest with leader/member slots, HP bars, invite/accept/decline, tell/kick, leave/disband, loot toggle, party chat, a friend list, and saved position. |
| Buff/debuff | Implemented | Draggable icon bar with duration countdowns, stacking counts, shrinking progress bars, audible expiry warnings, row/column and size options, tooltips, expiry filtering, and saved position; packets are parsed from `0xDF`. |
| Tooltips / OPL | Implemented | World, container, shop, paperdoll and gump controls; `0xD6`/`0xDC` caching and throttled requests. |
| Context menu | Implemented | Single-click world/container items requests `0xBF 0x13`; display (`0xBF 0x14`) and selection (`0xBF 0x15`) support old and new cliloc modes. |

#### P0

**Paperdoll (full)** *(implemented)*

- Real paperdoll gump background (`0x07D0`/`0x07D1`) with the animated doll and
  equipped layers drawn over the body using their anim IDs and hues.
- Buttons: war/peace, status, skills, journal, help, party, profile, logout.
- Equipment sidebar slots with item icons, tooltips, drag-out pickup, and drop-to-
  equip (including dropping a wearable on the doll to use its layer).
- Can-lift behavior, title display, update on `0x88`/equipment packets, saved position.
- Double-clicking a mobile opens its paperdoll (0x88 from server).
- Durability bars, virtue and equipment-book windows, and lifting equipment from
  other mobiles within range are implemented.

**Container** *(implemented)*

- Correct container gump art and size; item positions using `item.x/y`.
- Stacked items draw a second icon offset right/down; scroll when items overflow.
- Double-click use, drag pickup/drop, drop into container/world.
- Close, context menu, corpse loot behavior.
- Grid/legacy layout options (at least one usable layout).
- Shift-click or shift-drag a stack to open the split prompt; the amount is clamped
  to the stack size and the held-item overlay shows the selected count.
- Dropping a stack onto a matching stack lets the server merge them.
- The list view below the container shows a scaled item icon, name, and count; rows
  support single-click context menus, double-click use, drag pickup, shift-split,
  OPL tooltips, and wheel/scrollbar scrolling. Its minimize button collapses the list
  and the state persists per container.

**Skills** *(implemented)*

- `SkillsWindow` in `client/js/game/windows.js` shows the full skill list with
  value/base/cap and lock state, and requests a fresh list on open (`0x34` type 5).
- Sort by name/value, filter to usable skills, use a skill with its button or a
  double-click, and cycle lock state with `0x3A`; wheel scrolling and position
  persistence are supported.
- Updates from `0x3A` (including `0xFE` name list and `0xFF/0xDF` single updates).
- Stat locks are sent with `0xBF 0x1A`; per-skill caps use the server values.

**Spellbook** *(implemented)*

- `SpellbookWindow` in `client/js/game/windows.js` opens from `0x24` open-container with
  graphic `0xFFFF`; `0xBF 0x1B` spellbook-content masks are stored on the item.
- Circle/page tabs, spell icons, mana and power-word tooltip lines, wheel paging,
  saved position, and double-click casting via `0xBF 0x1C`.
- Spell data and school metadata live in `client/js/game/spells.js` (magery,
  necromancy, chivalry, bushido, ninjitsu, spellweaving, mysticism, and mastery).
- Local mana check prevents casting a spell the player cannot afford; the server
  still performs the authoritative cooldown/reagent checks.
- Spells can be dragged from the book onto a hotbar slot.

**Shop buy/sell** *(implemented)*

- `ShopWindow` in `client/js/game/windows.js` handles both `0x74` buy lists and `0x9E`
  sell lists with per-item quantity steppers, click-to-edit quantities, unit and line
  totals, available stock, item tooltips, and right-click context menus.
- Buy totals are checked against the player's current gold before `0x3B` is sent; sell
  replies use `0x9F`. Clear and All helpers reset or fill the selection, confirmed
  purchases reset the selection and request a fresh `0x34` status update.
- The list scrolls with the wheel/scrollbar, responds to drag-to-move, and persists its
  position per account.

**Secure trade** *(implemented)*

- `TradeWindow` in `client/js/game/windows.js` opens from `0x6F` and shows both
  players' offer lists, gold and platinum amounts, and each side's accept state.
- Dropping a held item on your panel sends a drop to your trade container; dragging
  an offered item picks it up again, and both lists update live from `0x25`/`0x3C`.
- Clicking a gold or platinum amount opens a numeric prompt and sends `0x6F` type 3;
  accept/cancel reply with `0x6F` type 2/1. Server type 2/3/4 updates are applied
  live, and closing the window sends a cancel.
- Item icons, stack amounts, OPL tooltips, wheel scrolling, right-click/Esc close,
  and per-account position persistence are supported.

#### P1

**Book** *(implemented)*

- `BookWindow` reads pages and title/author and pages with the wheel/buttons.
- The Edit button opens a title/author/page editor; saving sends `0xD4` (or the old
  `0x93` header for legacy books) and the page body with `0x66`. Local state updates
  immediately, and editable starts from the server's writable flag.
- Packets: `0x66`, `0x93`, `0xD4`.

**Bulletin board** *(implemented)*

- `BoardWindow` in `client/js/game/windows.js` opens from the board header
  (`0x71` type 0) and keeps a scrollable summary list populated by type 1 packets.
- Double-clicking a summary requests the full message (type 3) and shows the
  poster, date, subject, and wrapped body; the read view scrolls long messages.
- The Post button opens a subject/body form and sends type 5. Remove asks for
  confirmation, sends type 6, and updates the local list. Position is saved per
  account and board serial.
- Packet `0x71` parsing and posting use the standard null-terminated string form.

**Profile** *(implemented)*

- Header/body/footer rendering (`0xB8`) and own-profile body editing with save.
- The paperdoll's Profile button (or `-profile`) requests the profile; the Edit button
  appears only for the local player's profile.

**Menu / gray menu** *(implemented)*

- Item menus (`0x7C` with a non-zero first graphic) show numbered item art using the
  packet graphic/hue, a hover label, and reply through `0x7D` with the selected
  graphic/hue when an item is chosen.
- Gray menus (`0x7C` with zero graphics) render radio-style choices with OK and
  Cancel; OK sends the selected index, Cancel/right-click/Esc send code 0.
- The OK button is hidden for item menus so the art grid is the only selector;
  Cancel still closes the menu and sends code 0.

**Text entry, prompts, dye** *(implemented)*

- Text entry dialog (`0xAB` with `0xAC` response), ASCII/Unicode prompts
  (`0x9A`/`0xC2`), and the chat prompt response path are present.
- Dye/color picker (`0x95`) shows a 20x10 hue grid, five shade graduations, a live
  item preview and colour swatch, and sends `0x95` with the selected hue.

**Party** *(implemented)*

- `PartyWindow` in `client/js/game/windows.js` shows the manifest with up to ten
  member slots, leader marker, live HP bars, and saved position; it opens from the
  Party HUD button or the `-partywindow` command.
- `0xBF 0x06` manifests (add/remove) update the member list and leader; invite
  (`0x07`) opens a movable accept/decline prompt, and party messages (`0x03/0x04`)
  are added to the journal's party tab.
- Invite, tell one member, kick, leave/disband, and loot-type packets use the
  corrected `0xBF 0x06` sub-types; party chat focuses the shared chat input in
  party mode.
- Live HP bars are shown in the manifest, and a local friend list tracks online names.

**Buff/debuff bar** *(implemented)*

- `BuffBarWindow` in `client/js/game/buffs.js` opens when buff packets arrive or via
  `-buffs`; it is draggable, right-click/Esc closable, and remembers its position.
- Icons use the buff graphic table, with a title fallback when the artwork is missing.
- Active effects show a countdown and a progress bar that drains as the timer runs out;
  timed-out effects stop rendering automatically.
- Hovering an icon shows the resolved cliloc title, description, and remaining time.
- Stacking counts, audible expiry warnings, and row/column plus small/large icon
  options are available (`-buffs row|column|small|large|normal`).

**Tooltips / OPL** *(implemented)*

- Item property list (OPL revision/MegaCliloc), cliloc name/description,
  tooltip on hover for items, mobiles, and gumps.
- `0xD6` property bodies and `0xDC` revisions are cached per serial; requests are
  throttled and retried when a revision changes.
- World entities, container/shop/paperdoll items, and gump controls with tooltip clilocs
  show a clamped hover tooltip.

**Context menu** *(implemented)*

- `ContextMenuWindow` in `client/js/game/windows.js` renders the server popup menu
  with cliloc text, hover highlighting, hue/arrow flags, and viewport clamping.
- Single-clicking a world mobile/item or a container item, or right-clicking paperdoll
  equipment, sends `0xBF 0x13`; the display response (`0xBF 0x14`) is parsed in both
  old (`+3000000`) and new cliloc modes, and selection sends `0xBF 0x15`.
- Right-clicking ground still starts mouse-walk, and the menu closes on outside
  click, right-click, or Esc.
- Shop item menus are available, Ctrl+right-click on empty ground opens local walk,
  waypoint, and coordinate actions, and server submenu arrows request their child menu.

#### P2

- Full-screen world map browser *(implemented)*; map-gump pins and the radar are implemented.
- Options/settings window *(implemented)*.
- Hotbar/desktop *(implemented)* with three pages, drag-from-spellbook binding, and
  a macro editor/playback (`-macro [edit]|list|play|stop|delete`) with draggable
  macro buttons. Macros cover the commonly used TazUO actions (speech, movement,
  waits, targets, item/potion use, skills, spells, abilities, virtues, hands,
  mount, war/peace, commands) and support nested loop sections with per-loop
  repeat counts and delays; a running loop macro toggles off when triggered again.
- Quest arrow and waypoint list UI *(implemented)*.
- House/custom-house editing UI *(implemented: standard design commands, floor and
  category controls, add/delete prompts, and `0xD8` updates)*.
- Vendor search, runebook, bulk order, and quest log are server-gump driven and open
  through the normal gump parser; `-questlog`, `-guildmenu`, and `-house` provide
  direct entry points where the shard supports them.
- Chat channel UI *(implemented through `-chat` and the journal Chat tab)*.

### Gump acceptance

- Every server gump used by normal gameplay opens, draws correctly, and can be
  closed/responded to.
- Controls hit-test and respond at the correct coordinates under scaling.
- Text entries accept keyboard input without moving the character.
- Gump positions survive reconnect if the client persists them.
- Paperdoll/container/skills/spellbook/shop/trade cover the normal play loop.

---

## 5. Supporting basics (brief)

- **Targeting:** target cursor, object/mobile/ground/static/multi targets, container,
  paperdoll, shop, and trade item targets, server-side cancel packets, cursor
  cancellation, `-lasttarget`, `-target itself/nearest`, `-target resource`, and target
  info tooltip are present.
- **Health/name overhead:** names and health bars render with hide/show settings;
  ghosts use grey names and no living health bar, and notoriety colours are applied
  consistently.
- **Death/ghost:** `0x2C` switches the player to the ghost body (human/elf and
  gargoyle, male/female), ghosts move and render, equipment layers are hidden, and
  resurrection restores the living body via the status byte or the next body update.
  Resurrection gumps supplied by the shard open through the normal gump parser.
- **Lighting/time/weather:** lighting levels are smoothly interpolated between server
  updates, and weather, personal light, and season changes are present.
- **Audio:** decoded `sound.mul` effects and digital MP3 music are served; missing
  files fall back to synthesized effects. The options window enables audio, sets
  volume, and toggles footsteps.
- **Options:** the `OPT` window (`-options`) persists display, movement, audio, and
  keybind settings per account; macros are stored per account.
- **Persistence:** journal/filter settings, status/shop/trade/party/paperdoll/container
  positions, server-gump positions/scales, hotbar pages, macros, friends, and options
  persist per account.

---

## 6. Suggested implementation order

1. Movement model + render interpolation + deny reconciliation. *(done)*
2. Movable status window using the existing entity/status packets. *(done)*
3. Journal model + filters + chat input polish. *(done)*
4. Gump framework hardening (text/fonts/tooltips/scroll/focus/persistence). *(done; native selection and multi-line entries remain)*
5. Paperdoll, container, skills, spellbook. *(paperdoll, container split/stack UI, skills, and spellbook done)*
6. Shop, trade, book, profile, menus, prompts, dye. *(shop, trade, book, profile,
   bulletin board, menus/gray menus, prompts, and the dye hue picker are done)*
7. Party, buffs, tooltips/OPL, context menu. *(party, tooltips/OPL, buff bar, and context menu done)*
8. Map/radar, options, hotbar, audio. *(radar, map item gumps, the full-screen world
   map, the options window, and the hotbar are done; real audio and music samples are
   decoded when present)*

## 7. Current file map

| Area | File |
| --- | --- |
| Movement / world state | `client/js/game/world.js` |
| Click-to-walk pathfinding | `client/js/game/pathfinding.js` |
| Rendering / camera | `client/js/game/renderer.js` |
| Entities / layers | `client/js/game/entity.js` |
| Effects / audio | `client/js/game/effects.js`, `client/js/game/audio.js` |
| Buff bar / buff graphics | `client/js/game/buffs.js` |
| Hotbar / shortcuts | `client/js/game/hotbar.js` |
| Radar / map gumps / world map | `client/js/game/maps.js` |
| UOLive map patches | `client/js/game/uolive.js` |
| Quest arrow / waypoint list | `client/js/game/waypoints.js` |
| Server gump parser | `client/js/game/gump.js` |
| Spell data / schools | `client/js/game/spells.js` |
| HTML/gump text rendering | `client/js/game/html.js` |
| OPL cache / tooltip data | `client/js/game/opl.js` |
| Simplified windows | `client/js/game/windows.js` |
| HUD, modals, input | `client/js/ui/ui.js`, `client/index.html`, `client/css/style.css` |
| Journal model/window | `client/js/ui/journal.js` |
| Client options/settings | `client/js/game/settings.js`, `client/js/game/windows.js` |
| Incoming packets | `client/js/net/handlers.js` |
| Outgoing packets | `client/js/net/outgoing.js` |
| Socket/crypto/compression | `client/js/net/socket.js`, `client/js/crypto/*` |
| Asset endpoints | `server/assets.js`, `server/uo/*` |
| Bitmap fonts / sound / music | `server/uo/fonts.js`, `server/uo/sound.js`, `server/uo/music.js` |
| Chat / friends / house / virtue | `client/js/ui/ui.js`, `client/js/game/windows.js` |
| Facet map crop renderer | `server/uo/multimap.js` |

## 8. Basic-play test checklist

- Walk/run with keyboard, diagonals, right-click mouse-walk, and click-to-walk around obstacles.
- Idle for 2+ minutes without disconnect.
- Open/close/move status, journal, paperdoll, container, skills, spellbook.
- Equip and unequip an item by dragging between the paperdoll and backpack, and use
  the paperdoll action buttons.
- Buy/sell an item, trade with a player, read/post a book, and read/post on a bulletin board.
- Receive a party invite, accept, view the manifest, chat, kick, and leave.
- Receive speech, cliloc, system, party, and damage messages.
- Hover an item and see name/properties.
- Single-click an item/mobile, open the context menu, and choose an action; confirm
  double-click still uses the object.
- Open the radar and a map item; add a pin, plot/clear the route, and move the window.
- Open waypoints, add/remove/clear a local waypoint, and double-click a row to walk.
- Open the world map, switch facets, zoom/pan, and double-click a reachable tile to walk.
- Open options, toggle display/audio settings, rebind a key, and confirm they persist
  after reload for that account.
- Open the hotbar, drag an item onto a slot, bind a spell/skill/command, use the slot
  with its key, and confirm the layout persists after reload.
- Use a skill and cast a spell; cycle STR/DEX/INT and skill locks; drag a spell to the
  hotbar and use it from a hotbar page.
- Open the virtue and equipment-book windows from a paperdoll, lift equipment from
  another mobile, and open the custom-house window with `-house <serial>`.
- Join a chat channel with `-chat join <name>`, send a message, and export the journal.
- Die and resurrect.
- Close every gump with its intended close method.
