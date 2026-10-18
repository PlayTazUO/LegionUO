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
  "defaultLoginHost": ""
}
```

- `uoDir` - UO data directory. Can also be set with `UO_DIR` or `--uo-dir`.
- `clientVersion` - version sent to the shard and used for packet lengths and
  encryption keys.
- `allowProxyHosts` - optional host allow-list for the relay. Empty means any
  host is allowed; set this if the server is exposed beyond localhost.
- `defaultLoginHost` - prefilled login host in the client.

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
- `hues.mul`, `Cliloc.*` (including BWT-compressed clilocs), `skills.mul`,
  `multi.mul`/`MultiCollection.uop`
- Shard-local `Art/Statics`, `Art/Land`, `Gumps`, `Clilocs.txt`

### Rendering

- Canvas 2D isometric terrain, statics, ground items, mobiles and equipment.
- Animation frames, mirroring, hueing, health bars, names, speech and damage text.
- Moving/fixed effects, lighting, weather, target cursor and held item.
- Server gumps parsed from layout strings (`resizepic`, `gumppic`, `tilepic`,
  `text`, `croppedtext`, `htmlgump`, `button`, `checkbox`, `radio`, `textentry`,
  `page`, `group`, `tooltip`-adjacent commands).
- Containers, simplified paperdolls, shops, books, profiles, prompts and modals.
- Login/server/character selection, character creation, optional remembered
  account/password, journal, status bars, skills list and chat commands.
- 10-second client ping keeps the connection alive during idle periods.

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
| `GET /api/gump/:id.png?hue=` | Gump art |
| `GET /api/anim/:body/:action/:dir` | Animation sheet metadata |
| `GET /api/anim/:body/:action/:dir.png?hue=` | Animation sheet PNG |
| `GET /api/map/:map/:blockX/:blockY` | Map block cells and statics |
| `WS /proxy` | UO TCP relay (JSON `connect` control frame, binary thereafter) |

## Local test shard

`tools/make-test-data.mjs` generates a tiny synthetic UO data directory, and
`tools/mock-uo.mjs` is a mock login/game shard that exercises the handshake,
Huffman/Twofish traffic, world objects, containers and both gump formats:

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

- Server-side pathfinding is not reproduced; right-click mouse-walk sends direct steps.
- Paperdolls, books, shops and trade windows are simplified compared to TazUO.
- Tooltips/OPL are rendered for world objects, containers, shops, paperdolls, and gump controls.
- Map patches, UOLive and custom house editing are received but mostly inert.
- No audio files are served yet (the audio manager is a stub).
- BWT/UOP paths are implemented from the TazUO formats but have not been tested
  against every UO installation variant.

## Roadmap

See [`docs/REMAINING_SYSTEMS.md`](docs/REMAINING_SYSTEMS.md) for the remaining
basic client systems: journal and the gumps needed for normal play.

## Credits

This is a JavaScript recreation of [TazUO](https://github.com/PlayTazUO/TazUO),
which is itself based on ClassicUO. UO file formats, packet structures and
cryptography follow those projects. See `LICENSE.md`.
