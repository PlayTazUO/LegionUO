import { Reader } from '../util/binary.js';
import { versionValue } from './packet-length.js';
import { Layer, animDirection, isGhostGraphic } from '../game/entity.js';

const MessageType = {
  Regular: 0,
  System: 1,
  Emote: 2,
  Label: 6,
  Focus: 7,
  Whisper: 8,
  Yell: 9,
  Spell: 10,
  Guild: 13,
  Alliance: 14,
  Command: 15,
  Encoded: 0xc0,
};

function rejectionMessage(packetId, code) {
  if (packetId === 0x82) {
    const general = [
      'Incorrect name/password',
      'Someone is already using this account',
      'Your account has been blocked',
      'Your account credentials are invalid',
      'Communication problem',
      'IGR concurrency limit reached',
      'IGR time limit reached',
      'General IGR authentication failure',
      'Could not connect to Ultima Online',
    ];
    return general[code >= general.length ? general.length - 1 : code];
  }
  if (packetId === 0x85) {
    const chars = [
      'Character password invalid',
      'That character does not exist',
      'That character is being played',
      'Character is not old enough',
      'Character is queued for backup',
      'Could not carry out your request',
    ];
    return chars[code >= chars.length ? chars.length - 1 : code];
  }
  if (packetId === 0x53) {
    const login = [
      'Incorrect password',
      'Character does not exist',
      'Character already exists',
      'Client could not attach to server',
      'Client could not attach to server',
      'Another character is online',
      'Error in synchronization',
      'Idle too long',
      'Could not attach to server',
      'Character transfer in progress',
      'Name is invalid',
    ];
    return login[code >= login.length ? login.length - 1 : code];
  }
  return 'Unknown login error';
}

function readServerListEntry(r) {
  const index = r.readU16BE();
  const name = r.readASCII(32);
  const percentFull = r.readU8();
  const timezone = r.readU8();
  const address = r.readU32BE();
  return { index, name, percentFull, timezone, address };
}

function parseStatus(game, r) {
  const world = game.world;
  const serial = r.readU32BE();
  const entity = world.get(serial);
  if (!entity) return;
  entity.name = r.readASCII(30);
  entity.hits = r.readU16BE();
  entity.hitsMax = r.readU16BE();
  if (!entity.isMobile) return;
  entity.isRenamable = r.readBool();
  const type = r.readU8();
  if (type <= 0) return;
  entity.isFemale = r.readBool();
  if (entity !== world.player) return;

  entity.strength = r.readU16BE();
  entity.dexterity = r.readU16BE();
  entity.intelligence = r.readU16BE();
  entity.stamina = r.readU16BE();
  entity.staminaMax = r.readU16BE();
  entity.mana = r.readU16BE();
  entity.manaMax = r.readU16BE();
  entity.gold = r.readU32BE();
  world.resist.physical = r.readI16BE();
  entity.weight = r.readU16BE();
  if (type >= 5) {
    entity.weightMax = r.readU16BE();
    entity.race = r.readU8();
  } else {
    entity.weightMax = 7 * (entity.strength >> 1) + 40;
  }
  if (type >= 3) {
    world.statsCap = r.readI16BE();
    world.followers = r.readU8();
    world.followersMax = r.readU8();
  }
  if (type >= 4) {
    world.resist.fire = r.readI16BE();
    world.resist.cold = r.readI16BE();
    world.resist.poison = r.readI16BE();
    world.resist.energy = r.readI16BE();
    world.luck = r.readU16BE();
    world.damageMin = r.readI16BE();
    world.damageMax = r.readI16BE();
    world.tithing = r.readU32BE();
  }
  if (type >= 6) {
    world.maxResist = {};
    for (const key of ['physical', 'fire', 'cold', 'poison', 'energy']) world.maxResist[key] = r.readI16BE();
    world.dci = r.readI16BE();
    world.maxDci = r.readI16BE();
    world.hci = r.readI16BE();
    world.ssi = r.readI16BE();
    world.di = r.readI16BE();
    world.lrc = r.readI16BE();
    world.sdi = r.readI16BE();
    world.fcr = r.readI16BE();
    world.fc = r.readI16BE();
    world.lmc = r.readI16BE();
  }
  game.ui?.refreshStatus();
}

export class Handlers {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.map = new Map();
    this.install();
  }

  set(id, fn) {
    this.map.set(id, fn);
  }

  handle(id, packet, header = 1) {
    const fn = this.map.get(id);
    if (!fn) {
      if (this.game.debug) console.debug(`[packet] unhandled 0x${id.toString(16)}`, packet);
      return;
    }
    try {
      const reader = new Reader(packet);
      reader.seek(header);
      fn(reader);
    } catch (err) {
      console.error(`[packet] handler 0x${id.toString(16)} failed`, err, packet);
    }
  }

  install() {
    const game = this.game;
    const world = this.world;
    const socket = game.socket;

    /* ---------------- login ---------------- */

    this.set(0x8c, (r) => {
      const ip = r.readU32LE();
      const port = r.readU16BE();
      const seed = r.readU32BE();
      const host = `${ip & 0xff}.${(ip >>> 8) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 24) & 0xff}`;
      game.relay(host, port, seed);
    });

    this.set(0xa8, (r) => {
      game.clearLoginWatchdog();
      r.readU8();
      const count = r.readU16BE();
      const servers = [];
      for (let i = 0; i < count; i++) servers.push(readServerListEntry(r));
      world.login.servers = servers;
      world.login.step = 'servers';
      game.ui?.showServers(servers);
    });

    this.set(0xa9, (r) => {
      game.clearLoginWatchdog();
      const count = r.readU8();
      const chars = [];
      for (let i = 0; i < count; i++) {
        chars.push(r.readASCII(30));
        r.skip(30);
      }
      const cityCount = r.readU8();
      const cities = [];
      const modernCities = versionValue(game.config.clientVersion) >= 0x07000d00;
      for (let i = 0; i < cityCount; i++) {
        const index = r.readU8();
        let name;
        let building;
        let x = 0;
        let y = 0;
        let z = 0;
        let map = 0;
        if (modernCities) {
          name = r.readASCII(32);
          building = r.readASCII(32);
          x = r.readU32BE();
          y = r.readU32BE();
          z = (r.readU32BE() << 24) >> 24;
          map = r.readU32BE();
          r.readU32BE();
          r.skip(4);
        } else {
          name = r.readASCII(31);
          building = r.readASCII(31);
        }
        cities.push({ index, name, building, x, y, z, map });
      }
      const flags = r.readU32BE();
      world.login.characters = chars;
      world.login.cities = cities;
      world.login.characterListFlags = flags;
      world.useXMapFiles = (flags & 0x8000) !== 0;
      world.login.step = 'characters';
      game.ui?.showCharacters(chars, cities);
    });

    this.set(0x86, (r) => {
      game.clearLoginWatchdog();
      const count = r.readU8();
      const chars = [];
      for (let i = 0; i < count; i++) {
        chars.push(r.readASCII(30));
        r.skip(30);
      }
      world.login.characters = chars;
      world.login.step = 'characters';
      game.ui?.showCharacters(chars, world.login.cities);
    });

    for (const id of [0x82, 0x85, 0x53]) {
      this.set(id, (r) => {
        if (world.inGame) return;
        game.clearLoginWatchdog();
        const code = r.readU8();
        world.login.error = `${rejectionMessage(id, code)} [0x${id.toString(16)} code ${code}]`;
        world.login.step = 'error';
        console.warn('[login]', world.login.error);
        game.ui?.showLoginError(world.login.error);
        socket.close();
      });
    }

    this.set(0xfd, (r) => {
      world.login.delay = r.readU8();
    });

    /* ---------------- world ---------------- */

    this.set(0x1b, (r) => {
      game.clearLoginWatchdog();
      const serial = r.readU32BE();
      r.skip(4);
      const graphic = r.readU16BE();
      const x = r.readU16BE();
      const y = r.readU16BE();
      const z = r.readI16BE();
      const player = world.createPlayer(serial);
      player.graphic = graphic;
      world.setEntityPosition(player, x, y, z);
      player.direction = r.readU8() & 7;
      world.range = 24;
      world.ensureMapAround(x, y, 4);
      game.enterWorld();
    });

    this.set(0x55, () => {
      world.inGame = true;
      game.ui?.enterWorld();
      socket.out.openChat('');
      socket.out.clientType(7);
      socket.out.clientViewRange(24);
    });

    this.set(0xbd, () => socket.out.clientVersion(game.config.clientVersion));

    this.set(0x03, (r) => {
      // Client talk / notification. Nothing to do here.
      r.readU8();
    });

    this.set(0x0b, (r) => {
      const entity = world.get(r.readU32BE());
      const damage = r.readU16BE();
      if (entity && damage > 0) game.effects.addDamage(entity, damage);
    });

    this.set(0x11, (r) => parseStatus(game, r));

    this.set(0x15, (r) => {
      const toFollow = r.readU32BE();
      const following = r.readU32BE();
      world.following = following;
    });

    for (const id of [0x16, 0x17]) {
      this.set(id, (r) => {
        const mobile = world.getMobile(r.readU32BE());
        if (!mobile) return;
        const count = r.readU16BE();
        for (let i = 0; i < count; i++) {
          const type = r.readU16BE();
          const enabled = r.readBool();
          if (type === 1) mobile.poisoned = enabled;
          if (type === 2) mobile.yellowBar = enabled;
        }
      });
    }

    this.set(0x1a, (r) => {
      let serial = r.readU32BE();
      let count = 0;
      let graphicInc = 0;
      let direction = 0;
      let hue = 0;
      let flags = 0;
      if (serial & 0x80000000) {
        serial &= 0x7fffffff;
        count = 1;
      }
      let graphic = r.readU16BE();
      if (graphic & 0x8000) {
        graphic &= 0x7fff;
        graphicInc = r.readU8();
      }
      count = count > 0 ? r.readU16BE() : count + 1;
      let x = r.readU16BE();
      if (x & 0x8000) {
        x &= 0x7fff;
        direction = 1;
      }
      let y = r.readU16BE();
      if (y & 0x8000) {
        y &= 0x7fff;
        hue = 1;
      }
      if (y & 0x4000) {
        y &= 0x3fff;
        flags = 1;
      }
      if (direction) direction = r.readU8();
      const z = r.readI8();
      if (hue) hue = r.readU16BE();
      if (flags) flags = r.readU8();
      world.updateObject({ serial, graphic, graphicInc, amount: count, x, y, z, direction, hue, flags });
    });

    this.set(0x1c, (r) => {
      const serial = r.readU32BE();
      const entity = world.get(serial);
      const graphic = r.readU16BE();
      const type = r.readU8();
      const hue = r.readU16BE();
      const font = r.readU16BE();
      const name = r.readASCII(30);
      let text = '';
      if (r.length > 44) {
        r.seek(44);
        text = r.readASCII();
      }
      this.onTalk(serial, entity, name, text, hue, type, font);
    });

    this.set(0xae, (r) => {
      const serial = r.readU32BE();
      const entity = world.get(serial);
      const graphic = r.readU16BE();
      const type = r.readU8();
      const hue = r.readU16BE();
      const font = r.readU16BE();
      const lang = r.readASCII(4);
      const name = r.readASCII();
      let text = '';
      if (r.length > 48) {
        r.seek(48);
        text = r.readUnicodeBE();
      }
      this.onTalk(serial, entity, name, text, hue, type, 0);
    });

    this.set(0xc1, (r) => this.onCliloc(r, false));
    this.set(0xcc, (r) => this.onCliloc(r, true));

    this.set(0x1d, (r) => {
      const serial = r.readU32BE();
      const entity = world.get(serial);
      if (!entity) return;
      world.remove(serial);
      game.ui?.onEntityRemoved?.(entity);
    });

    this.set(0x20, (r) => {
      const serial = r.readU32BE();
      const graphic = r.readU16BE();
      const graphicInc = r.readU8();
      const hue = r.readU16BE();
      const flags = r.readU8();
      const x = r.readU16BE();
      const y = r.readU16BE();
      r.readU16BE();
      const direction = r.readU8();
      const z = r.readI8();
      const entity = world.get(serial);
      if (entity) {
        entity.graphic = graphic;
        entity.hue = hue;
        entity.flags = flags;
        entity.isFrozen = (flags & 0x01) !== 0;
        entity.isHidden = (flags & 0x80) !== 0;
        if (entity === world.player) entity.isStunned = false;
        world.refreshGhostState(entity);
        if (entity === world.player) {
          world.reconcilePlayerPosition(x, y, z, direction, { force: true });
        } else {
          world.moveMobile(entity, x, y, z, direction);
        }
      } else if (serial === world.playerSerial) {
        const p = world.createPlayer(serial);
        p.graphic = graphic;
        world.refreshGhostState(p);
        world.setEntityPosition(p, x, y, z);
      }
      world.ensureMapAround(x, y, 3);
    });

    this.set(0x21, (r) => {
      const seq = r.readU8();
      const x = r.readU16BE();
      const y = r.readU16BE();
      const direction = r.readU8() & 7;
      const z = r.readI8();
      world.denyWalk(seq, x, y, z, direction);
    });

    this.set(0x22, (r) => {
      const seq = r.readU8();
      let noto = r.readU8() & ~0x40;
      if (noto === 0 || noto >= 8) noto = 1;
      world.confirmWalk(seq, noto);
    });

    this.set(0x23, (r) => {
      let graphic = r.readU16BE() + r.readU8();
      const hue = r.readU16BE();
      r.readU16BE();
      const source = r.readU32BE();
      const sx = r.readU16BE();
      const sy = r.readU16BE();
      const sz = r.readI8();
      const dest = r.readU32BE();
      const dx = r.readU16BE();
      const dy = r.readU16BE();
      const dz = r.readI8();
      if (graphic === 0x0eed) graphic = 0x0eef;
      else if (graphic === 0x0eea) graphic = 0x0eec;
      else if (graphic === 0x0ef0) graphic = 0x0ef2;
      const src = world.getMobile(source);
      const dst = world.getMobile(dest);
      game.effects.addMoving({
        graphic,
        hue,
        sx: src?.x ?? sx,
        sy: src?.y ?? sy,
        sz: src?.z ?? sz,
        dx: dst?.x ?? dx,
        dy: dst?.y ?? dy,
        dz: dst?.z ?? dz,
        speed: 5,
        duration: 5000,
      });
    });

    this.set(0x24, (r) => {
      const serial = r.readU32BE();
      const graphic = r.readU16BE();
      game.ui?.openContainer(serial, graphic);
    });

    this.set(0x25, (r) => {
      const serial = r.readU32BE();
      const graphic = r.readU16BE() + r.readU8();
      const amount = Math.max(1, r.readU16BE());
      const x = r.readU16BE();
      const y = r.readU16BE();
      r.skip(1);
      const container = r.readU32BE();
      const hue = r.readU16BE();
      world.addItemToContainer({ serial, graphic, amount, x, y, hue, container });
      game.ui?.onContainerItem?.(container);
    });

    this.set(0x3c, (r) => {
      const count = r.readU16BE();
      let cleared = new Set();
      for (let i = 0; i < count; i++) {
        const serial = r.readU32BE();
        const graphic = r.readU16BE() + r.readU8();
        const amount = Math.max(1, r.readU16BE());
        const x = r.readU16BE();
        const y = r.readU16BE();
        r.skip(1);
        const container = r.readU32BE();
        const hue = r.readU16BE();
        if (!cleared.has(container)) {
          cleared.add(container);
          const parent = world.get(container);
          if (parent) {
            for (const item of [...parent.items.values()]) world.entities.delete(item.serial);
            parent.items.clear();
            parent.equipment.clear();
          }
        }
        world.addItemToContainer({ serial, graphic, amount, x, y, hue, container });
      }
      for (const id of cleared) game.ui?.onContainerItem?.(id);
    });

    this.set(0x27, (r) => {
      const reason = r.readU8();
      game.held = null;
      game.ui?.onHeldChanged?.();
      if (reason < 5) world.addMessage(['You cannot lift that.', 'That is too far away.', 'You cannot see that.', 'That belongs to someone else.', 'You are already holding something.'][reason] || 'Item move denied.', 0x22, 1);
    });

    this.set(0x28, () => {
      game.held = null;
      game.ui?.onHeldChanged?.();
    });
    this.set(0x29, () => {
      game.held = null;
      game.ui?.onHeldChanged?.();
    });

    this.set(0x2c, (r) => {
      const state = r.remaining() ? r.readU8() : 0;
      if (!world.player) return;
      if (state === 0) {
        world.setPlayerGhost();
        world.addMessage('You are dead. Walk to a healer or shrine to be resurrected.', 0x22, 1, 'System');
      } else {
        world.clearPlayerGhost();
        world.addMessage('You have been resurrected.', 0x35, 1, 'System');
        world.socket.out.statusRequest(world.playerSerial);
      }
      game.ui?.refreshStatus?.();
    });

    this.set(0xaf, (r) => {
      const serial = r.readU32BE();
      const corpseSerial = r.readU32BE();
      const running = r.readU32BE();
      const mobile = world.getMobile(serial);
      if (mobile) {
        mobile.isDead = true;
        mobile.isGhost = isGhostGraphic(mobile.graphic);
        world.corpses.set(corpseSerial || serial, {
          graphic: mobile.graphic,
          direction: mobile.direction,
          hue: mobile.hue,
          running: running !== 0,
        });
      }
    });

    this.set(0x2d, (r) => {
      const entity = world.get(r.readU32BE());
      if (!entity) return;
      entity.hitsMax = r.readU16BE();
      entity.hits = r.readU16BE();
      if (!entity.isMobile) return;
      entity.manaMax = r.readU16BE();
      entity.mana = r.readU16BE();
      entity.staminaMax = r.readU16BE();
      entity.stamina = r.readU16BE();
      game.ui?.refreshStatus();
    });

    this.set(0x2e, (r) => {
      const serial = r.readU32BE();
      const graphic = r.readU16BE() + r.readI8();
      const layer = r.readU8();
      const container = r.readU32BE();
      const hue = r.readU16BE();
      const item = world.getOrCreateItem(serial);
      world.removeFromContainer(item);
      item.graphic = graphic;
      item.layer = layer;
      item.container = container;
      item.hue = hue;
      item.amount = 1;
      const parent = world.get(container);
      if (parent) parent.addItem(item);
      if (parent?.isMobile && layer === Layer.Mount) parent.mount = item;
      game.ui?.onEquipmentChanged?.(container);
    });

    this.set(0x2f, (r) => {
      r.skip(1);
      const attacker = r.readU32BE();
      const defender = r.readU32BE();
      if (attacker === world.playerSerial) {
        world.lastAttack = defender;
        world.animateMobile(attacker, 9);
      }
    });

    this.set(0x32, () => {});

    this.set(0x38, (r) => {
      const x = r.readU16BE();
      const y = r.readU16BE();
      const z = r.readU16BE();
      game.walkTo(x, y, (z << 16) >> 16);
    });

    this.set(0x3a, (r) => {
      const type = r.readU8();
      if (type === 0xfe) {
        const count = r.readU16BE();
        world.skillList = [];
        for (let i = 0; i < count; i++) {
          const hasAction = r.readBool();
          const len = r.readU8();
          world.skillList.push({ index: i, name: r.readASCII(len), hasAction, value: 0, base: 0, lock: 0, cap: 1000 });
        }
        game.ui?.refreshSkills();
        return;
      }
      const haveCap = (type !== 0 && type <= 3) || type === 0xdf;
      const single = type === 0xff || type === 0xdf;
      while (r.remaining() > 0) {
        let id = r.readU16BE();
        if (r.remaining() <= 0) break;
        if (id === 0 && type === 0) break;
        if (type === 0 || type === 2) id--;
        const value = r.readU16BE();
        const base = r.readU16BE();
        const lock = r.readU8();
        let cap = 1000;
        if (haveCap && r.remaining() >= 2) cap = r.readU16BE();
        world.skills.set(id, { id, value, base, lock, cap });
      }
      game.ui?.refreshSkills();
    });

    this.set(0x3b, (r) => {
      const serial = r.readU32BE();
      game.ui?.closeShop(serial);
    });

    this.set(0x4e, (r) => {
      const serial = r.readU32BE();
      const level = r.readU8();
      if (serial === world.playerSerial) world.setLight(world.light.overall, Math.min(30, level));
    });

    this.set(0x4f, (r) => {
      const level = r.readU8();
      world.setLight(Math.min(30, level), world.light.personal);
    });

    this.set(0x54, (r) => {
      r.skip(1);
      const index = r.readU16BE();
      r.readU16BE();
      r.readU16BE();
      r.readU16BE();
      r.readI16BE();
      game.audio?.play(index);
    });

    this.set(0x56, (r) => game.ui?.onMapData?.(r));

    this.set(0x5b, () => {});

    this.set(0x65, (r) => {
      const type = r.readU8();
      const count = r.readU8();
      const temp = r.readU8();
      world.weather.type = type;
      world.weather.count = count;
      world.weather.temp = temp;
      game.createWeather(type, count, temp);
    });

    this.set(0x66, (r) => game.ui?.onBookData?.(r));

    this.set(0x6c, (r) => {
      const type = r.readU8();
      const cursorId = r.readU32BE();
      const cursorType = r.readU8();
      if (cursorType >= 3) {
        if (world.target.active) world.socket.out.targetCancel(type, cursorId, cursorType);
        world.clearTarget();
      } else {
        world.setTarget(type, cursorId, cursorType);
      }
      game.ui?.onTargetChanged?.();
    });

    this.set(0x6d, (r) => {
      if (r.length === 3) {
        const cmd = r.readU8();
        const index = r.readU8();
        if (cmd === 0x1f && index === 0xff) game.audio?.stopMusic();
        else game.audio?.playMusic(index);
      } else {
        game.audio?.playMusic(r.readU16BE());
      }
    });

    this.set(0x6e, (r) => {
      const serial = r.readU32BE();
      let action = r.readU16BE();
      const frameCount = r.readU16BE();
      const repeatCount = r.readU16BE();
      const forward = !r.readBool();
      const repeat = r.readBool();
      const delay = r.readU8();
      const mobile = world.getMobile(serial);
      if (!mobile) return;
      const info = game.getAnimType(mobile.graphic);
      const count = info === 'people' ? 35 : info === 'low' ? 13 : 23;
      action = action % count;
      world.animateMobile(serial, action, { frameCount, repeatCount, forward, repeat, delay, fromServer: true });
    });

    this.set(0xe2, (r) => {
      const serial = r.readU32BE();
      const type = r.readU16BE();
      const action = r.readU16BE();
      const mode = r.readU8();
      const mobile = world.getMobile(serial);
      if (!mobile) return;
      let group = action;
      if (type === 1 || type === 2) group = 9;
      else if (type === 3) group = 20;
      else if (type === 4) group = 21;
      else if (type === 5) group = 22;
      else if (type === 6 || type === 14) group = 4;
      else if (type === 7) group = 0;
      else if (type === 8) group = 13;
      else if (type === 9) group = 7;
      else if (type === 11) group = 15;
      world.animateMobile(serial, group, { repeat: type === 1 || type === 2, forward: true, fromServer: true });
    });

    const effect = (r) => {
      const type = r.readU8();
      if (type > 4) {
        if (type === 4) {
          r.skip(8);
          r.readU16BE();
        }
        return;
      }
      const source = r.readU32BE();
      const target = r.readU32BE();
      const graphic = r.readU16BE();
      const sx = r.readU16BE();
      const sy = r.readU16BE();
      const sz = r.readI8();
      const dx = r.readU16BE();
      const dy = r.readU16BE();
      const dz = r.readI8();
      const speed = r.readU8();
      const duration = r.readU8();
      r.readU16BE();
      const fixedDirection = r.readBool();
      const explode = r.readBool();
      let hue = 0;
      let blend = 0;
      const afterHeader = r.position;
      if (afterHeader < r.length) {
        hue = r.readU32BE();
        blend = r.readU32BE() % 7;
      }
      game.effects.add({
        type,
        source,
        target,
        graphic,
        hue: hue & 0xffff,
        sx,
        sy,
        sz,
        dx,
        dy,
        dz,
        speed,
        duration,
        fixedDirection,
        explode,
        blend,
      });
    };
    this.set(0x6f, (r) => {
      const type = r.readU8();
      const serial = r.readU32BE();
      const clearTradeItems = (trade) => {
        if (!trade) return;
        for (const [itemSerial, entity] of world.entities) {
          if (
            entity.isItem &&
            (entity.container === trade.myContainer || entity.container === trade.hisContainer)
          ) {
            world.entities.delete(itemSerial);
          }
        }
      };
      if (type === 0) {
        clearTradeItems(world.trade);
        const myContainer = r.readU32BE();
        const hisContainer = r.readU32BE();
        const hasName = r.readBool();
        const name = hasName ? r.readASCII() : '';
        world.trade = {
          serial: serial >>> 0,
          myContainer: myContainer >>> 0,
          hisContainer: hisContainer >>> 0,
          id1: myContainer >>> 0,
          id2: hisContainer >>> 0,
          name,
          myAccepted: false,
          hisAccepted: false,
          myGold: 0,
          myPlatinum: 0,
          hisGold: 0,
          hisPlatinum: 0,
        };
        game.ui?.onTradeChanged?.();
      } else if (type === 1) {
        clearTradeItems(world.trade);
        world.trade = null;
        game.ui?.onTradeChanged?.();
      } else if (type === 2) {
        if (world.trade && world.trade.serial === serial >>> 0) {
          world.trade.myAccepted = r.readU32BE() !== 0;
          world.trade.hisAccepted = r.readU32BE() !== 0;
          game.ui?.onTradeChanged?.();
        }
      } else if (type === 3 || type === 4) {
        const gold = r.readU32BE();
        const platinum = r.readU32BE();
        if (world.trade && world.trade.serial === serial >>> 0) {
          if (type === 3) {
            world.trade.hisGold = gold;
            world.trade.hisPlatinum = platinum;
          } else {
            world.trade.myGold = gold;
            world.trade.myPlatinum = platinum;
          }
          game.ui?.onTradeChanged?.();
        }
      }
    });

    this.set(0x70, effect);
    this.set(0xc0, effect);
    this.set(0xc7, effect);

    this.set(0x71, (r) => game.ui?.onBulletinBoard?.(r));

    this.set(0x72, (r) => {
      if (world.player) world.player.inWarMode = r.readBool();
    });

    this.set(0x73, (r) => {
      const seq = r.readU8();
      world.lastPing = seq;
      game.onPingResponse(seq);
    });

    this.set(0x74, (r) => game.ui?.onBuyList?.(r));
    this.set(0x9e, (r) => game.ui?.onSellList?.(r));

    const updateCharacter = (r) => {
      const serial = r.readU32BE();
      const mobile = world.getMobile(serial);
      if (!mobile) return;
      const graphic = r.readU16BE();
      const x = r.readU16BE();
      const y = r.readU16BE();
      const z = r.readI8();
      const direction = r.readU8();
      const hue = r.readU16BE();
      const flags = r.readU8();
      const notoriety = r.readU8();
      mobile.notoriety = notoriety;
      if (serial === world.playerSerial) {
        mobile.graphic = graphic;
        mobile.hue = hue;
        mobile.flags = flags;
        if (x || y) world.reconcilePlayerPosition(x, y, z, direction);
      } else {
        mobile.graphic = graphic;
        mobile.hue = hue;
        mobile.flags = flags;
        world.moveMobile(mobile, x, y, z, direction);
      }
    };
    this.set(0x77, updateCharacter);
    this.set(0xd2, updateCharacter);

    const updateObject = (r, is078) => {
      const serial = r.readU32BE();
      const graphic = r.readU16BE();
      const x = r.readU16BE();
      const y = r.readU16BE();
      const z = r.readI8();
      const direction = r.readU8();
      const hue = r.readU16BE();
      const flags = r.readU8();
      const notoriety = r.readU8();
      if (serial === world.playerSerial && world.player) {
        world.player.graphic = graphic;
        world.player.hue = hue;
        world.player.flags = flags;
        if (x || y) world.reconcilePlayerPosition(x, y, z, direction);
      } else {
        world.updateObject({ serial, graphic, x, y, z, direction, hue, flags, isMobile: true });
        const obj = world.get(serial);
        if (obj && obj.isMobile) obj.notoriety = notoriety;
      }
      if (!is078) r.skip(6);
      const equipStart = r.position;
      const parseEquipment = (legacyHue) => {
        r.seek(equipStart);
        const list = [];
        let valid = true;
        let itemSerial = r.readU32BE();
        while (itemSerial !== 0 && r.remaining() > 0) {
          if (r.remaining() < 5) {
            valid = false;
            break;
          }
          let graphic = r.readU16BE();
          const layer = r.readU8();
          let hue = 0;
          if (!legacyHue) {
            if (r.remaining() < 2) {
              valid = false;
              break;
            }
            hue = r.readU16BE();
          } else if (graphic & 0x8000) {
            if (r.remaining() < 2) {
              valid = false;
              break;
            }
            graphic &= 0x7fff;
            hue = r.readU16BE();
          }
          if (layer > 0x3f) valid = false;
          list.push({ serial: itemSerial, graphic, layer, hue });
          if (r.remaining() < 4) {
            valid = false;
            break;
          }
          itemSerial = r.readU32BE();
        }
        if (itemSerial !== 0) valid = false;
        if (valid && is078) {
          for (let i = r.position; i < r.length; i++) {
            const byte = r.data[i];
            if (byte === 0) break;
            if (byte < 0x20) {
              valid = false;
              break;
            }
          }
        } else if (valid && !is078 && r.remaining() > 0) {
          valid = false;
        }
        return { list, valid, end: r.position };
      };
      // Old clients encode the hue flag in the graphic's high bit and may
      // omit the hue word. Try the modern form first, but fall back when the
      // bytes do not form a clean item list.
      let parsedEquipment = parseEquipment(false);
      if (!parsedEquipment.valid) {
        const legacy = parseEquipment(true);
        if (legacy.valid) parsedEquipment = legacy;
      }
      r.seek(parsedEquipment.end);
      for (const entry of parsedEquipment.list) {
        const item = world.getOrCreateItem(entry.serial);
        item.graphic = entry.graphic;
        item.hue = entry.hue;
        item.amount = 1;
        world.removeFromContainer(item);
        item.container = serial;
        item.layer = entry.layer;
        item.isCorpse = entry.graphic === 0x2006;
        const parent = world.get(serial);
        if (parent) parent.addItem(item);
        if (entry.layer === Layer.Mount && parent?.isMobile) parent.mount = item;
      }
      const mobile = world.get(serial);
      if (is078 && mobile?.isMobile && r.remaining() > 0) {
        const name = r.readASCII();
        if (name) mobile.name = name;
      }
      game.ui?.onEquipmentChanged?.(serial);
    };
    this.set(0x78, (r) => updateObject(r, true));
    this.set(0xd3, (r) => updateObject(r, false));

    this.set(0x7c, (r) => game.ui?.onMenu?.(r));

    this.set(0x88, (r) => game.ui?.onPaperdoll?.(r));
    this.set(0x89, (r) => {
      const serial = r.readU32BE();
      const corpse = world.getItem(serial);
      if (!corpse || corpse.graphic !== 0x2006) return;
      let layer = r.readU8();
      while (layer !== 0 && r.remaining() > 0) {
        const itemSerial = r.readU32BE();
        if (layer - 1 !== Layer.Backpack) {
          const item = world.getOrCreateItem(itemSerial);
          world.removeFromContainer(item);
          item.container = serial;
          item.layer = layer - 1;
          corpse.addItem(item);
        }
        if (!r.remaining()) break;
        layer = r.readU8();
      }
    });

    this.set(0x90, (r) => game.ui?.onMapGump?.(r, 0x90));
    this.set(0xf5, (r) => game.ui?.onMapGump?.(r, 0xf5));
    this.set(0x93, (r) => game.ui?.onBook?.(r));
    this.set(0xd4, (r) => game.ui?.onBook?.(r));

    this.set(0x95, (r) => {
      const serial = r.readU32BE();
      r.skip(2);
      const graphic = r.readU16BE();
      game.ui?.onDye?.(serial, graphic);
    });

    this.set(0x97, (r) => {
      const direction = r.readU8();
      world.cancelPendingSteps();
      world.serverWalk(direction & 7, (direction & 0x80) !== 0);
    });

    this.set(0x98, (r) => {
      const serial = r.readU32BE();
      const entity = world.get(serial);
      if (entity) entity.name = r.readASCII();
    });

    this.set(0x99, (r) => {
      const allowGround = r.readBool();
      const targId = r.readU32BE();
      r.readU8();
      r.seek(18);
      const multiId = r.readU16BE();
      const xOff = r.readU16BE();
      const yOff = r.readU16BE();
      const zOff = r.readU16BE();
      const hue = r.readU16BE();
      world.setTarget(2, targId, 0, { multiId, xOff, yOff, zOff, hue, allowGround });
      game.ui?.onTargetChanged?.();
    });

    this.set(0x9a, (r) => {
      world.prompt = { type: 'ascii', data: r.readU64BE() };
      game.ui?.showPrompt?.(world.prompt);
    });

    this.set(0xa1, (r) => {
      const entity = world.get(r.readU32BE());
      if (!entity) return;
      entity.hitsMax = r.readU16BE();
      entity.hits = r.readU16BE();
      game.ui?.refreshStatus();
    });

    this.set(0xa2, (r) => {
      const mobile = world.getMobile(r.readU32BE());
      if (!mobile) return;
      mobile.manaMax = r.readU16BE();
      mobile.mana = r.readU16BE();
      game.ui?.refreshStatus();
    });

    this.set(0xa3, (r) => {
      const mobile = world.getMobile(r.readU32BE());
      if (!mobile) return;
      mobile.staminaMax = r.readU16BE();
      mobile.stamina = r.readU16BE();
      game.ui?.refreshStatus();
    });

    this.set(0xa5, (r) => {
      const url = r.readASCII();
      if (url) window.open(url, '_blank', 'noopener');
    });

    this.set(0xa6, (r) => {
      const flag = r.readU8();
      if (flag === 1) return;
      const tip = r.readU32BE();
      const text = r.readASCII(r.readU16BE());
      world.addMessage(text.replace(/\r/g, '\n'), 0x35, 1);
    });

    this.set(0xaa, (r) => {
      world.lastAttack = r.readU32BE();
      socket.out.statusRequest(world.lastAttack);
    });

    this.set(0xab, (r) => game.ui?.onTextEntry?.(r));

    this.set(0xb0, (r) => {
      const sender = r.readU32BE();
      const gumpId = r.readU32BE();
      const x = r.readI32BE();
      const y = r.readI32BE();
      const cmdLen = r.readU16BE();
      const cmd = r.readASCII(cmdLen);
      const lineCount = r.readU16BE();
      const lines = [];
      for (let i = 0; i < lineCount; i++) {
        const len = r.readU16BE();
        lines.push(len > 0 ? r.readUnicodeBE(len * 2) : '');
      }
      game.openGump(sender, gumpId, x, y, cmd, lines);
    });

    this.set(0xdd, (r) => game.openCompressedGump(r));

    this.set(0xb2, (r) => game.ui?.onChatMessage?.(r));

    this.set(0xb7, () => {});

    this.set(0xb8, (r) => game.ui?.onProfile?.(r));

    this.set(0xb9, (r) => {
      world.lockedFeatures = r.readU32BE();
    });

    this.set(0xba, (r) => {
      const display = r.readBool();
      const x = r.readU16BE();
      const y = r.readU16BE();
      let serial = 0;
      if (r.remaining() >= 4) serial = r.readU32BE();
      world.questArrow = display ? { x, y, serial } : null;
    });

    this.set(0xbb, () => {});

    this.set(0xbc, (r) => {
      const season = r.readU8();
      const music = r.readU8();
      world.realSeason = season > 4 ? 0 : season;
      world.season = world.realSeason;
      game.audio?.playMusic(music);
    });

    this.set(0xbe, () => {});
    this.set(0xbf, (r) => game.ui?.onExtendedCommand?.(r));
    this.set(0xc2, (r) => {
      world.prompt = { type: 'unicode', data: r.readU64BE() };
      game.ui?.showPrompt?.(world.prompt);
    });

    this.set(0xc4, () => {});
    this.set(0xc6, () => {});
    this.set(0xc8, (r) => {
      world.viewRange = r.readU8();
    });
    this.set(0xca, () => {});
    this.set(0xcb, () => {});

    this.set(0xd0, () => {});
    this.set(0xd1, () => {
      game.disconnect('Logged out');
    });

    this.set(0xd6, (r) => this.onMegaCliloc(r));

    this.set(0xd7, (r) => game.ui?.onGenericCommand?.(r));
    this.set(0xd8, (r) => game.ui?.onCustomHouse?.(r));
    this.set(0xdb, () => {});

    this.set(0xdc, (r) => {
      const serial = r.readU32BE();
      const revision = r.readU32BE();
      world.opl.setRevision(serial, revision);
      game.ui?.onOPLUpdated?.(serial);
    });

    this.set(0xde, (r) => {
      r.readU32BE();
      r.readU8();
    });

    this.set(0xdf, (r) => game.ui?.onBuffDebuff?.(r));

    this.set(0xe3, () => {});
    this.set(0xe5, (r) => {
      const serial = r.readU32BE();
      const x = r.readU16BE();
      const y = r.readU16BE();
      const map = r.readU8();
      const type = r.readU16BE();
      world.waypoints.push({ serial, x, y, map, type });
    });
    this.set(0xe6, (r) => {
      const serial = r.readU32BE();
      world.waypoints = world.waypoints.filter((w) => w.serial !== serial);
    });

    this.set(0xf0, (r) => {
      const type = r.readU8();
      if (type === 0xfe) socket.out.razorAck();
    });

    this.set(0xf1, () => {});

    this.set(0xf3, (r) => {
      r.skip(2);
      const type = r.readU8();
      const serial = r.readU32BE();
      const graphic = r.readU16BE();
      const graphicInc = r.readU8();
      const amount = r.readU16BE();
      r.readU16BE();
      const x = r.readU16BE();
      const y = r.readU16BE();
      const z = r.readI8();
      const direction = r.readU8();
      const hue = r.readU16BE();
      const flags = r.readU8();
      r.readU16BE();
      const isMobile = serial < 0x40000000;
      if (serial === world.playerSerial) {
        if (world.player) {
          world.player.graphic = graphic;
          world.player.hue = hue;
          world.player.flags = flags;
          if (x || y) world.reconcilePlayerPosition(x, y, z, direction);
        }
      } else {
        world.updateObject({ serial, graphic, graphicInc, amount, x, y, z, direction, hue, flags, isMobile, type });
      }
    });

    this.set(0xf6, (r) => {
      const serial = r.readU32BE();
      r.readU8();
      r.readU8();
      const x = r.readU16BE();
      const y = r.readU16BE();
      const z = r.readI16BE();
      const multi = world.getItem(serial);
      if (multi) {
        multi.x = x;
        multi.y = y;
        multi.z = z;
      }
    });

    this.set(0x3f, (r) => world.uolive.onPacket(r));
    this.set(0x40, (r) => world.uolive.onTerrain(r));

    this.set(0xf7, (r) => {
      const count = r.readU16BE();
      for (let i = 0; i < count && r.remaining(); i++) {
        const id = r.readU8();
        if (id === 0xf3) this.handle(0xf3, r.data.subarray(r.position - 1));
        else break;
      }
    });
  }

  onTalk(serial, entity, name, text, hue, type, font) {
    const world = this.world;
    if (serial === 0 && (name || '').toLowerCase() === 'system') {
      this.game.socket.out.ackTalk();
    }
    let textType = 'system';
    if (type === MessageType.Guild || type === MessageType.Alliance) textType = 'guild';
    else if (entity && serial !== 0 && serial !== 0xffffffff) textType = 'speech';
    world.addMessage(text, hue, type, name || entity?.name || '', font, {
      serial,
      textType,
      overhead: true,
    });
    if (entity && entity.isMobile) {
      entity.lastSpeech = { text, hue, time: Date.now() };
      entity.name = entity.name || name;
    }
  }

  onMegaCliloc(r) {
    const world = this.world;
    const game = this.game;
    const start = r.position;
    const marker = r.readU16BE();
    let serial;
    let revision = 0;
    if (marker <= 1) {
      serial = r.readU32BE();
      if (r.remaining() < 6) return;
      r.skip(2);
      revision = r.readU32BE();
    } else {
      r.seek(start);
      serial = r.readU32BE();
      revision = world.opl.revisions.get(serial >>> 0) ?? 0;
    }
    if (!serial) return;
    const entries = [];
    while (r.remaining() >= 4) {
      const cliloc = r.readU32BE();
      if (!cliloc) break;
      if (r.remaining() < 2) break;
      const length = r.readU16BE();
      const args = length > 0 ? r.readUnicodeLE(length) : '';
      entries.push({ cliloc, args, text: game.cliloc(cliloc, args) });
    }
    world.opl.set(serial, revision, entries);
    game.ui?.onOPLUpdated?.(serial);
  }

  onCliloc(r, hasAffix) {
    const world = this.world;
    const serial = r.readU32BE();
    const entity = world.get(serial);
    r.readU16BE();
    const type = r.readU8();
    const hue = r.readU16BE();
    const font = r.readU16BE();
    const cliloc = r.readU32BE();
    let flags = 0;
    if (hasAffix) flags = r.readU8();
    const name = r.readASCII(30);
    let affix = '';
    if (hasAffix) affix = r.readASCII();
    let args = '';
    if (r.remaining() > 0) {
      if (hasAffix) args = r.readUnicodeBE(r.remaining());
      else args = r.readUnicodeLE(Math.floor(r.remaining() / 2));
    }
    let text = this.game.cliloc(cliloc, args);
    if (text == null) return;
    if (affix) text = flags & 1 ? affix + text : text + affix;
    if (flags & 2) type = MessageType.System;
    let textType = 'system';
    if (type === MessageType.Guild || type === MessageType.Alliance) textType = 'guild';
    else if (serial !== 0 && serial !== 0xffffffff && entity) textType = 'speech';
    world.addMessage(text, hue, type, name || entity?.name || '', font, {
      serial,
      textType,
      cliloc,
      affix,
      overhead: true,
      translated: true,
    });
    if (entity && entity.isMobile) {
      entity.name = entity.name || name;
      if (type !== MessageType.System) entity.lastSpeech = { text, hue, time: Date.now() };
    }
  }
}
