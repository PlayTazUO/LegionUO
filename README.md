# LegionUO

A browser Ultima Online client, recreated from the TazUO / ClassicUO client, with a
separate Node.js asset server that decodes the original UO data files on demand.

The browser cannot open a raw TCP socket to a shard or read local `.mul`/`.uop`
files, so the server does both jobs:

- **Asset server** - reads `art.mul`/`artLegacyMUL.uop`, gumps, maps, animations,
  `tiledata.mul`, `hues.mul`, clilocs, skills and multis, and serves the decoded
  pieces as PNG/JSON. Nothing is unpacked ahead of time; every entry is decoded
  the first time it is requested and cached in memory.
- **TCP relay** - a minimal WebSocket server (`/proxy`) that opens the real TCP
  connection to the login/game server and relays bytes. Encryption and Huffman
  compression are implemented in the browser, so the proxy is transport-only.

No npm dependencies are required.

## Requirements

- Node.js 18 or newer
- A local Ultima Online data directory (MUL or UOP installation)
- A shard to connect to (RunUO/ServUO/ModernUO/OSI, etc.)

## Run

```bash
npm start
# or
node server/index.js --uo-dir "/path/to/Ultima Online" --port 8080
```

Then open <http://127.0.0.1:8080>.

`config.json` holds the defaults:

```json
{
  "uoDir": "",
  "httpPort": 8080,
  "host": "127.0.0.1",
  "clientVersion": "7.0.104.0",
  "mapCount": 6,
  "cacheMb": 256,
  "allowProxyHosts": [],
  "defaultLoginHost": "",
  "loginEncryption": true,
  "gameEncryption": true
}
```

- `uoDir` - UO data directory. Can also be set with `UO_DIR` or `--uo-dir`.
- `clientVersion` - version sent to the shard and used for packet lengths and
  encryption keys.
- `allowProxyHosts` - optional host allow-list for the relay. Empty means any
  host is allowed; set this if the server is exposed beyond localhost.
- `defaultLoginHost` - prefilled login host in the client.
- `loginEncryption` / `gameEncryption` - set to `false` for shards that accept
  unencrypted login or game traffic. Some shards disable one or both; if the
  shard closes the connection silently right after a login packet, try turning
  the matching option off. Server-to-client Huffman compression still works when
  game encryption is off.

## What is implemented

### Network

- Login handshake: seed, account login, server list, relay, character list,
  character selection, game login.
- Login encryption (`LoginCrypt`) and game encryption (Twofish-ECB + MD5 key
  stream), ported and byte-for-byte checked against TazUO's implementation.
- Client packet table with version-specific length overrides.
- Huffman decompression for game traffic.
- Incoming handlers registered for every packet ID in TazUO's `HandlerRegistry`
  (119 IDs), including world objects, movement, speech/cliloc, corpses,
  containers, equipment, stats, skills, targets, gumps (plain and compressed),
  menus, shops, books, profiles, prompts, party, buffs, weather, light, season,
  effects, waypoints and login.
- Outgoing builders for movement, combat, use/double-click, speech, skills,
  spells, item pickup/drop/equip, gump/menu responses, prompts, targets, trade,
  party, chat, books, bulletin boards, shops, custom house commands and more.

### Assets

- `art.mul` + `artidx.mul` and `artLegacyMUL.uop`
- `gumpart.mul` + `gumpidx.mul` and `gumpartLegacyMUL.uop` (including BWT gumps),
  plus shard-local `Gumps/*.gump`
- `map*.mul` / `map*LegacyMUL.uop`, statics and staidx
- `anim*.mul/_idx` and `AnimationFrame*.uop`, with body/mobtype/bodyconv.def
  resolution and hue application
- `tiledata.mul` (old and modern layouts)
- `texmaps.mul` + `texidx.mul` (plus `TexTerr.def` remaps) for stretched terrain
- `hues.mul`, `Cliloc.*` (including BWT-compressed clilocs), `skills.mul`,
  `multi.mul`/`MultiCollection.uop`, `fonts.mul`, `sound.mul`/`soundidx.mul`
- Digital music (`Music/Digital/Config.txt` plus the referenced MP3 files)
- Shard-local `Art/Statics`, `Art/Land`, `Gumps`, `Clilocs.txt`

### Rendering

- Canvas 2D isometric terrain with z-stretched land textures for slopes, hills and cliffs,
  statics, ground items, mobiles and equipment.
- Animation frames, mirroring, hueing, health bars, names, speech and damage text.
- Moving/fixed effects, lighting, weather, target cursor and held item.
- Server gumps parsed from layout strings (`resizepic`, `gumppic`, `picinpic`,
  `tilepic`, `maparea`, `text`, `croppedtext`, `htmlgump`, `button`, `checkbox`,
  `radio`, `textentry`, `page`, `group`), with tooltip/item-property commands,
  bitmap `fonts.mul` text, inline text editing with IME composition, scrolling HTML
  panels, persistent switch/entry state, per-gump scale (Ctrl+wheel), server
  update/close semantics and gump reuse.
- Containers with server item positions, scrolling, stacked item art, shift-click/drag
  splitting, a collapsible item list view and saved positions; paperdolls
  with real gump art, equipped layers on the doll, equipment slots, drag/drop equip,
  action buttons and saved position; editable books, editable own profiles,
  spellbooks, prompts and modals, plus shop buy/sell windows with quantities,
  totals, gold checks and confirmation. Item and gray menus show numbered art or
  radio choices, and `0x95` dye requests open a hue grid with a live preview.
- Ghost body/state on death, ghost movement and rendering, and resurrection cleanup.
- Draggable buff/debuff icon bar with countdown timers, stacking counts, expiry
  warnings, row/column and size options, tooltips and saved position.
- Hotbar/desktop with 12 key-bound slots (`1`-`0`, `-`, `=`), three pages,
  drag-to-bind items, spell/skill/command/macro bindings, drag-from-spellbook,
  tooltips, and per-account persistence. Chat commands can record and play macros.
- Chat channel support (`0xB2`/`0xB3`), language selection and journal export.
- Movable party manifest with live HP bars, invite/accept/decline, tell/kick,
  leave/disband, loot toggle, party chat and saved position; a local friend list
  tracks online status by name.
- Radar/minimap with `radarcol.mul` terrain colours, mobile/waypoint dots and a
  saved position; map item gumps (`0x90`/`0xF5`) render facet crops with numbered
  `0x56` pins, plot mode and saved position.
- Full-screen world map (`WM` / `-worldmap`) with facet tabs, smooth wheel zoom,
  drag panning, center/fit, saved window state, player/party/waypoint/quest markers,
  hover coordinates and double-click click-to-walk.
- Movable/resizable journal with per-account message history, tabs/filters,
  timestamps, opacity/font/line settings, ignore list and chat speech modes.
- Login/server/character selection, character creation, optional remembered
  account/password, a movable status window (saved position, live stats, and
  paperdoll/skills/journal/war/refresh/logout actions), skills list and chat
  commands.
- Options window (`OPT` / `-options`) with General, Display, Audio, and Keys tabs for
  always-run, journal timestamps, names, health bars, speech, lighting, weather,
  quest arrow, waypoints, audio, volume, footsteps, and rebindable shortcuts;
  settings apply live and persist per account in `localStorage`.
- Custom-house design window with floor/category controls, add/delete prompts,
  backup/restore/commit/revert/clear/exit commands, and `0xD8` design updates.
- Audio decodes real `sound.mul` effects and digital MP3 music, falling back to
  synthesis when the local data files are absent.
- One-second client ping drives the HUD FPS/ping readout and keeps the connection alive during idle periods.

## Asset endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/config` | Detected files, map sizes, client defaults |
| `GET /api/hues` | Text colour table (32-colour hue entries) |
| `GET /api/tiledata` | Land/static flags, height, layer, anim id (`?names=1` for names) |
| `GET /api/skills` | Skill names |
| `GET /api/cliloc/:id`, `/api/cliloc?ids=1,2`, `/api/cliloc/all` | Cliloc strings |
| `GET /api/multi/:id` | Multi components |
| `GET /api/art/land/:id.png?hue=` | Land tile |
| `GET /api/art/static/:id.png?hue=` | Static/item art |
| `GET /api/texmap/:id.png?hue=` | Land terrain texture (stretched slopes) |
| `GET /api/gump/:id.png?hue=` | Gump art |
| `GET /api/font/:id` | Bitmap font glyph metadata |
| `GET /api/font/:id.png?hue=` | Bitmap font atlas |
| `GET /api/sound/:id.wav` | Decoded `sound.mul` effect |
| `GET /api/music/:id.mp3` | Digital music track |
| `GET /api/anim/:body/:action/:dir` | Animation sheet metadata |
| `GET /api/anim/:body/:action/:dir.png?hue=` | Animation sheet PNG |
| `GET /api/map/:map/:blockX/:blockY` | Map block cells and statics |
| `GET /api/radarcol` | Raw `radarcol.mul` palette (16-bit colours) |
| `GET /api/mapimage?facet=&x0=&y0=&x1=&y1=&w=&h=` | Cropped facet map PNG |
| `WS /proxy` | UO TCP relay (JSON `connect` control frame, binary thereafter) |

## Local test shard

`tools/make-test-data.mjs` generates a tiny synthetic UO data directory, and
`tools/mock-uo.mjs` is a mock login/game shard that exercises the handshake,
Huffman/Twofish traffic, world objects, containers, spellbooks, party packets,
map gumps and both gump formats:

```bash
node tools/make-test-data.mjs
node server/index.js --uo-dir ./tools/test-data --port 8081
node tools/mock-uo.mjs
# open http://127.0.0.1:8081 and connect to 127.0.0.1:2593
```

The generated data is only for smoke testing: it is a few coloured shapes, not
real UO art.

## Security note

If "Remember account/password" is checked, the account name and password are
stored in the browser's `localStorage` in plain text. Use it only on a machine
you trust. The asset server itself never stores credentials.

## Known limitations / next steps

- Server-side pathfinding is not reproduced; click-to-walk uses the client A* and
  right-click mouse-walk sends direct steps.
- Paperdolls show durability, virtue and equipment-book controls; equipment from
  other mobiles can be lifted within range. Some enhanced-client-only paperdoll
  extras are still simplified.
- Tooltips/OPL are rendered for world objects, containers, shops, paperdolls,
  equipment lists, and gump controls.
- UOLive map definitions, terrain/static patches and CRC hash queries are handled
  client-side; the custom-house window exposes the standard design commands but the
  full ground-plan preview is still simplified.
- Audio uses local `sound.mul` and digital MP3 files when present. Missing files
  fall back to synthesized effects.
- BWT/UOP paths are implemented from the TazUO formats but have not been tested
  against every UO installation variant.
- Radar colours require `radarcol.mul`; map item gumps require `facetXX.mul` (or
  `facetX.mul`). Multi footprints are drawn from `/api/multi` when loaded.

## Roadmap

See [`docs/REMAINING_SYSTEMS.md`](docs/REMAINING_SYSTEMS.md) for the basic client
systems checklist and the remaining polish items.

## Credits

This is a JavaScript recreation of [TazUO](https://github.com/PlayTazUO/TazUO),
which is itself based on ClassicUO. UO file formats, packet structures and
cryptography follow those projects. See `LICENSE.md`.
