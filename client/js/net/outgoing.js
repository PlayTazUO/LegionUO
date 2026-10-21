import { Writer } from '../util/binary.js';
import { getPacketLength, buildLengthTable } from './packet-length.js';

export class Outgoing {
  constructor(socket, clientVersion) {
    this.socket = socket;
    this.table = buildTable(clientVersion);
  }

  setVersion(clientVersion) {
    this.table = buildTable(clientVersion);
  }

  length(id) {
    return getPacketLength(this.table, id);
  }

  make(id, write, sizeHint = 256) {
    const length = this.length(id);
    const w = new Writer(length < 0 ? sizeHint : length);
    w.writeU8(id);
    if (length < 0) w.writeU16BE(0);
    write(w);
    if (length < 0) {
      w.patchU16BE(1, w.length);
      return w.buffer;
    }
    while (w.length < length) w.writeU8(0);
    return w.buffer;
  }

  send(packet, options) {
    this.socket.send(packet, options);
  }

  /* login --------------------------------------------------------------- */

  seed(seed, major, minor, build, extra) {
    const packet = this.make(0xef, (w) => {
      w.writeU32BE(seed >>> 0);
      w.writeU32BE(major >>> 0);
      w.writeU32BE(minor >>> 0);
      w.writeU32BE(build >>> 0);
      w.writeU32BE(extra >>> 0);
    }, 21);
    this.send(packet, { skipEncryption: true });
  }

  firstLogin(account, password) {
    this.send(this.make(0x80, (w) => {
      w.writeASCII(account, 30);
      w.writeASCII(password, 30);
      w.writeU8(0xff);
    }, 62));
  }

  selectServer(index) {
    this.send(this.make(0xa0, (w) => {
      w.writeU8(0);
      w.writeU8(index);
    }, 3));
  }

  secondLogin(account, password, seed) {
    this.send(this.make(0x91, (w) => {
      w.writeU32BE(seed >>> 0);
      w.writeASCII(account, 30);
      w.writeASCII(password, 30);
    }, 65));
  }

  selectCharacter(index, name, ip) {
    const packet = this.make(0x5d, (w) => {
      w.writeU32BE(0xedededed);
      w.writeASCII(name, 30);
      w.writeZero(2);
      w.writeU32BE(this.socket.clientVersionValue || 0x07006800);
      w.writeZero(24);
      w.writeU32BE(index >>> 0);
      w.writeU32BE(ip >>> 0);
    }, 73);
    this.send(packet);
  }

  deleteCharacter(index, ip) {
    this.send(this.make(0x83, (w) => {
      w.writeU32BE(0xedededed);
      w.writeU8(index);
      w.writeU32BE(ip >>> 0);
    }, 10));
  }

  /* world --------------------------------------------------------------- */

  walkRequest(direction, seq, run, fastWalk = 0) {
    this.send(this.make(0x02, (w) => {
      w.writeU8((direction & 7) | (run ? 0x80 : 0));
      w.writeU8(seq & 0xff);
      w.writeU32BE(fastWalk >>> 0);
    }, 7));
  }

  ackTalk() {
    this.send(
      Uint8Array.from([
        0x03, 0x00, 0x28, 0x20, 0x00, 0x34, 0x00, 0x03, 0xdb, 0x13, 0x14, 0x3f, 0x45, 0x2c, 0x58, 0x0f,
        0x5d, 0x44, 0x2e, 0x50, 0x11, 0xdf, 0x75, 0x5c, 0xe0, 0x3e, 0x71, 0x4f, 0x31, 0x34, 0x05, 0x4e,
        0x18, 0x1e, 0x72, 0x0f, 0x59, 0xad, 0xf5, 0x00,
      ])
    );
  }

  ping(seq) {
    this.send(this.make(0x73, (w) => w.writeU8(seq & 0xff), 2));
  }

  doubleClick(serial) {
    this.send(this.make(0x06, (w) => w.writeU32BE(serial), 5));
  }

  singleClick(serial) {
    this.send(this.make(0x09, (w) => w.writeU32BE(serial), 5));
  }

  attack(serial) {
    this.send(this.make(0x05, (w) => w.writeU32BE(serial), 5));
  }

  pickup(serial, count) {
    this.send(this.make(0x07, (w) => {
      w.writeU32BE(serial);
      w.writeU16BE(count);
    }, 7));
  }

  drop(serial, x, y, z, slot, container) {
    this.send(this.make(0x08, (w) => {
      w.writeU32BE(serial);
      w.writeU16BE(x);
      w.writeU16BE(y);
      w.writeI8(z);
      w.writeU8(slot);
      w.writeU32BE(container);
    }, 14));
  }

  equip(serial, layer, container) {
    this.send(this.make(0x13, (w) => {
      w.writeU32BE(serial);
      w.writeU8(layer);
      w.writeU32BE(container);
    }, 9));
  }

  warMode(state) {
    this.send(this.make(0x72, (w) => {
      w.writeU8(state ? 1 : 0);
      w.writeU8(0x32);
      w.writeU8(0);
    }, 5));
  }

  statusRequest(serial) {
    this.send(this.make(0x34, (w) => {
      w.writeU32BE(0xedededed);
      w.writeU8(0x04);
      w.writeU32BE(serial);
    }, 10));
  }

  skillsRequest(serial) {
    this.send(this.make(0x34, (w) => {
      w.writeU32BE(0xedededed);
      w.writeU8(0x05);
      w.writeU32BE(serial);
    }, 10));
  }

  skillLock(skillIndex, lockState) {
    this.send(this.make(0x3a, (w) => {
      w.writeU16BE(skillIndex);
      w.writeU8(lockState);
    }, 6));
  }

  statLock(stat, state) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x1a);
      w.writeU8(stat);
      w.writeU8(state);
    }));
  }

  clientVersion(version) {
    this.send(this.make(0xbd, (w) => w.writeASCII(version), 16));
  }

  asciiSpeech(text, type, font, hue) {
    this.send(this.make(0x03, (w) => {
      w.writeU8(type);
      w.writeU16BE(hue);
      w.writeU16BE(font);
      w.writeASCII(text);
    }, 128));
  }

  unicodeSpeech(text, type, font, hue, lang = 'ENU') {
    this.send(this.make(0xad, (w) => {
      w.writeU8(type);
      w.writeU16BE(hue);
      w.writeU16BE(font);
      w.writeASCII(lang, 4);
      w.writeUnicodeBENull(text);
    }, 256));
  }

  castSpell(index) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x1c);
      w.writeU16BE(0x02);
      w.writeU16BE(index);
    }, 32));
  }

  useSkill(index, serial = 0) {
    this.send(this.make(0x12, (w) => {
      if (serial) {
        w.writeU8(0x27);
        w.writeASCII(`${index} ${serial}`);
      } else {
        w.writeU8(0x24);
        w.writeASCII(`${index} 0`);
      }
    }, 32));
  }

  openDoor() {
    this.send(this.make(0x12, (w) => {
      w.writeU8(0x58);
      w.writeU8(0);
    }, 8));
  }

  openSpellbook(type) {
    this.send(this.make(0x12, (w) => {
      w.writeU8(0x43);
      w.writeU8(type);
    }, 8));
  }

  emote(action) {
    this.send(this.make(0x12, (w) => {
      w.writeU8(0xc7);
      w.writeASCII(action);
    }, 64));
  }

  invokeVirtue(id) {
    this.send(this.make(0x12, (w) => {
      w.writeU8(0xf4);
      w.writeASCII(String(id));
    }, 16));
  }

  gumpResponse(local, server, button, switches = [], entries = []) {
    this.send(this.make(0xb1, (w) => {
      w.writeU32BE(local);
      w.writeU32BE(server);
      w.writeU32BE(button >>> 0);
      w.writeU32BE(switches.length);
      for (const s of switches) w.writeU32BE(s);
      w.writeU32BE(entries.length);
      for (const [id, text] of entries) {
        const len = Math.min(239, text.length);
        w.writeU16BE(id);
        w.writeU16BE(len);
        for (let i = 0; i < len; i++) w.writeU16BE(text.charCodeAt(i));
      }
    }, 256));
  }

  menuResponse(serial, graphic, code, itemGraphic = 0, itemHue = 0) {
    this.send(this.make(0x7d, (w) => {
      w.writeU32BE(serial);
      w.writeU16BE(graphic);
      if (code !== 0) {
        w.writeU16BE(code);
        w.writeU16BE(itemGraphic);
        w.writeU16BE(itemHue);
      }
    }, 32));
  }

  tradeResponse(serial, code, state) {
    this.send(this.make(0x6f, (w) => {
      w.writeU8(code);
      w.writeU32BE(serial);
      w.writeU32BE(state ? 1 : 0);
    }, 32));
  }

  tradeGold(serial, gold, platinum) {
    this.send(this.make(0x6f, (w) => {
      w.writeU8(0x03);
      w.writeU32BE(serial);
      w.writeU32BE(gold);
      w.writeU32BE(platinum);
    }, 32));
  }

  textEntryResponse(serial, parentId, buttonId, text, cancel) {
    this.send(this.make(0xac, (w) => {
      w.writeU32BE(serial);
      w.writeU8(parentId);
      w.writeU8(buttonId);
      w.writeU8(cancel ? 0 : 1);
      w.writeU16BE(text.length + 1);
      w.writeASCII(text, text.length + 1);
    }, 128));
  }

  rename(serial, name) {
    this.send(this.make(0x75, (w) => {
      w.writeU32BE(serial);
      w.writeASCII(name, 30);
    }, 35));
  }

  nameRequest(serial) {
    this.send(this.make(0x98, (w) => w.writeU32BE(serial), 8));
  }

  tipRequest(id, flag) {
    this.send(this.make(0xa7, (w) => {
      w.writeU16BE(id);
      w.writeU8(flag);
    }, 4));
  }

  targetObject(entity, graphic, x, y, z, cursorId, cursorType) {
    this.send(this.make(0x6c, (w) => {
      w.writeU8(0);
      w.writeU32BE(cursorId);
      w.writeU8(cursorType);
      w.writeU32BE(entity);
      w.writeU16BE(x);
      w.writeU16BE(y);
      w.writeU16BE(z & 0xffff);
      w.writeU16BE(graphic);
    }, 20));
  }

  targetXYZ(graphic, x, y, z, cursorId, cursorType) {
    this.send(this.make(0x6c, (w) => {
      w.writeU8(1);
      w.writeU32BE(cursorId);
      w.writeU8(cursorType);
      w.writeU32BE(0);
      w.writeU16BE(x);
      w.writeU16BE(y);
      w.writeU16BE(z & 0xffff);
      w.writeU16BE(graphic);
    }, 20));
  }

  targetCancel(type, cursorId, cursorType) {
    this.send(this.make(0x6c, (w) => {
      w.writeU8(type);
      w.writeU32BE(cursorId);
      w.writeU8(cursorType);
      w.writeU32BE(0);
      w.writeU32BE(0xffffffff);
      w.writeU32BE(0);
    }, 20));
  }

  asciiPromptResponse(data, text, cancel) {
    this.send(this.make(0x9a, (w) => {
      w.writeU64BE(data);
      w.writeU32BE(cancel ? 0 : 1);
      w.writeASCII(text);
    }, 128));
  }

  unicodePromptResponse(data, text, lang, cancel) {
    this.send(this.make(0xc2, (w) => {
      w.writeU64BE(data);
      w.writeU32BE(cancel ? 0 : 1);
      w.writeASCII(lang || 'ENU', 3);
      w.writeU8(0);
      w.writeUnicodeBENull(text);
    }, 256));
  }

  dyeResponse(serial, graphic, hue) {
    this.send(this.make(0x95, (w) => {
      w.writeU32BE(serial);
      w.writeU16BE(graphic);
      w.writeU16BE(hue);
    }, 9));
  }

  profileRequest(serial) {
    this.send(this.make(0xb8, (w) => {
      w.writeU8(0);
      w.writeU32BE(serial);
    }, 8));
  }

  profileUpdate(serial, text) {
    this.send(this.make(0xb8, (w) => {
      w.writeU8(1);
      w.writeU32BE(serial);
      w.writeU16BE(1);
      w.writeU16BE(text.length);
      for (let i = 0; i < text.length; i++) w.writeU16BE(text.charCodeAt(i));
    }, 256));
  }

  clickQuestArrow(rightClick) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x07);
      w.writeU8(rightClick ? 1 : 0);
    }));
  }

  closeStatusBar(serial) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x0c);
      w.writeU32BE(serial);
    }));
  }

  partyInvite() {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x06);
      w.writeU8(0x01);
      w.writeU32BE(0);
    }));
  }

  partyRemove(serial) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x06);
      w.writeU8(0x02);
      w.writeU32BE(serial);
    }));
  }

  partyLootType(type) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x06);
      w.writeU8(0x06);
      w.writeU8(type ? 1 : 0);
    }));
  }

  partyAccept(serial) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x06);
      w.writeU8(0x08);
      w.writeU32BE(serial);
    }));
  }

  partyDecline(serial) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x06);
      w.writeU8(0x09);
      w.writeU32BE(serial);
    }));
  }

  partyMessage(text, serial = 0) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x06);
      if (serial) {
        w.writeU8(0x03);
        w.writeU32BE(serial >>> 0);
      } else {
        w.writeU8(0x04);
      }
      w.writeUnicodeBENull(text);
    }, 128));
  }

  gameWindowSize(w, h) {
    this.send(this.make(0xbf, (w2) => {
      w2.writeU16BE(0x05);
      w2.writeU32BE(w);
      w2.writeU32BE(h);
    }));
  }

  language(lang = 'ENU') {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x0b);
      w.writeASCII(lang, 3);
      w.writeU8(0);
    }));
  }

  clientType(protocol = 7) {
    let flag = 0;
    for (let i = 0; i < protocol; i++) flag |= 1 << i;
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x0f);
      w.writeU8(0x0a);
      w.writeU32BE(flag >>> 0);
    }));
  }

  requestPopupMenu(serial) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x13);
      w.writeU32BE(serial);
    }));
  }

  popupMenuSelection(serial, menuId) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x15);
      w.writeU32BE(serial);
      w.writeU16BE(menuId);
    }));
  }

  chatCommand(kind, lang, text, extra) {
    this.send(this.make(0xb3, (w) => {
      w.writeASCII(lang || 'ENU', 4);
      w.writeU16BE(kind);
      if (text) {
        for (let i = 0; i < text.length; i++) w.writeU16BE(text.charCodeAt(i));
      }
      if (extra) w.writeU16BE(extra);
    }, 256));
  }

  chatJoin(name, password = '') {
    this.send(this.make(0xb3, (w) => {
      w.writeASCII('ENU', 4);
      w.writeU16BE(0x62);
      w.writeU16BE(0x22);
      w.writeUnicodeBE(name || '');
      w.writeU16BE(0x22);
      w.writeU16BE(0x020);
      if (password) w.writeUnicodeBE(password);
    }, 128));
  }

  chatCreate(name, password = '') {
    this.send(this.make(0xb3, (w) => {
      w.writeASCII('ENU', 4);
      w.writeU16BE(0x63);
      w.writeUnicodeBE(name || '');
      if (password) {
        w.writeU16BE(0x7b);
        w.writeUnicodeBE(password);
        w.writeU16BE(0x7d);
      }
    }, 128));
  }

  chatLeave() {
    this.send(this.make(0xb3, (w) => {
      w.writeASCII('ENU', 4);
      w.writeU16BE(0x43);
    }, 16));
  }

  chatSay(text) {
    this.send(this.make(0xb3, (w) => {
      w.writeASCII('ENU', 4);
      w.writeU16BE(0x61);
      w.writeUnicodeBE(text || '');
    }, 256));
  }

  openChat(name = '') {
    this.send(this.make(0xb5, (w) => {
      w.writeU8(0);
      w.writeUnicodeBE(name.length > 30 ? name.slice(0, 30) : name);
    }, 64));
  }

  guildMenu() {
    this.send(this.make(0xd7, (w) => {
      if (this.playerSerial) w.writeU32BE(this.playerSerial);
      w.writeU16BE(0x28);
      w.writeU8(0x0a);
    }, 16));
  }

  questMenu() {
    this.send(this.make(0xd7, (w) => {
      if (this.playerSerial) w.writeU32BE(this.playerSerial);
      w.writeU16BE(0x32);
      w.writeU8(0);
    }, 16));
  }

  equipLastWeapon() {
    this.send(this.make(0xd7, (w) => {
      if (this.playerSerial) w.writeU32BE(this.playerSerial);
      w.writeU16BE(0x1e);
      w.writeU8(0x0a);
    }, 16));
  }

  megaClilocRequest(serials) {
    this.send(this.make(0xd6, (w) => {
      for (const serial of serials) w.writeU32BE(serial);
    }, 16 + serials.length * 4));
  }

  statLockState(stat, state) {
    this.statLock(stat, state);
  }

  bookHeader(serial, title, author) {
    this.send(this.make(0xd4, (w) => {
      w.writeU32BE(serial);
      w.writeU8(0);
      w.writeU8(0);
      w.writeU16BE(0);
      w.writeU16BE(title.length);
      w.writeUTF8(title);
      w.writeU16BE(author.length);
      w.writeUTF8(author);
    }, 128));
  }

  // Writer has no UTF8 helper; use bytes.
  bookPage(serial, lines, page) {
    this.send(this.make(0x66, (w) => {
      w.writeU32BE(serial);
      w.writeU16BE(1);
      w.writeU16BE(page);
      w.writeU16BE(lines.length);
      for (const line of lines) {
        const clean = String(line || '').replace(/\n/g, '');
        if (clean) {
          const bytes = new TextEncoder().encode(clean);
          w.writeBytes(bytes);
        }
        w.writeU8(0);
      }
      w.writeU8(0);
    }, 512));
  }

  bookPageRequest(serial, page) {
    this.send(this.make(0x66, (w) => {
      w.writeU32BE(serial);
      w.writeU16BE(1);
      w.writeU16BE(page);
      w.writeU16BE(0xffff);
    }, 16));
  }

  buy(serial, items) {
    this.send(this.make(0x3b, (w) => {
      w.writeU32BE(serial);
      if (items.length) {
        w.writeU8(0x02);
        for (const [itemSerial, amount] of items) {
          w.writeU8(0x1a);
          w.writeU32BE(itemSerial);
          w.writeU16BE(amount);
        }
      } else {
        w.writeU8(0);
      }
    }, 128));
  }

  sell(serial, items) {
    this.send(this.make(0x9f, (w) => {
      w.writeU32BE(serial);
      w.writeU16BE(items.length);
      for (const [itemSerial, amount] of items) {
        w.writeU32BE(itemSerial);
        w.writeU16BE(amount);
      }
    }, 128));
  }

  useCombatAbility(index) {
    this.send(this.make(0xd7, (w) => {
      if (this.playerSerial) w.writeU32BE(this.playerSerial);
      w.writeU16BE(0x19);
      w.writeU32BE(0);
      w.writeU8(index);
      w.writeU8(0x0a);
    }, 32));
  }

  targetSelectedObject(serial, targetSerial) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x2c);
      w.writeU32BE(serial);
      w.writeU32BE(targetSerial);
    }));
  }

  targetByResource(serial, resourceType) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x30);
      w.writeU32BE(serial);
      w.writeU32BE(resourceType);
    }));
  }

  toggleGargoyleFlying() {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x32);
      w.writeU16BE(1);
      w.writeU32BE(0);
    }));
  }

  customHouseRequest(serial) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x1e);
      w.writeU32BE(serial);
    }));
  }

  stun() {
    this.send(this.make(0xbf, (w) => w.writeU16BE(0x09)));
  }

  disarm() {
    this.send(this.make(0xbf, (w) => w.writeU16BE(0x0a)));
  }

  changeRace(skinHue, hairStyle, hairHue, beardStyle, beardHue) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x2a);
      w.writeU16BE(skinHue);
      w.writeU16BE(hairStyle);
      w.writeU16BE(hairHue);
      w.writeU16BE(beardStyle);
      w.writeU16BE(beardHue);
    }));
  }

  boatMove(serial, direction, speed) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x33);
      w.writeU32BE(serial);
      w.writeU8(direction);
      w.writeU8(direction);
      w.writeU8(speed);
    }));
  }

  resync() {
    this.send(this.make(0x22, () => {}, 3));
  }

  clientViewRange(range) {
    this.send(this.make(0xc8, (w) => w.writeU8(range), 2));
  }

  openUOStore() {
    this.send(this.make(0xfa, () => {}, 1));
  }

  showPublicHouseContent(show) {
    this.send(this.make(0xfb, (w) => w.writeU8(show ? 1 : 0), 2));
  }

  deathScreen() {
    this.send(this.make(0x2c, () => {}, 2));
  }

  logoutNotification() {
    this.send(this.make(0xd1, (w) => w.writeU8(0), 3));
  }

  mapMessage(serial, action, pin, x, y) {
    this.send(this.make(0x56, (w) => {
      w.writeU32BE(serial);
      w.writeU8(action);
      w.writeU8(pin);
      w.writeU16BE(x);
      w.writeU16BE(y);
    }, 11));
  }

  queryGuildPosition() {
    this.send(this.make(0xf0, (w) => {
      w.writeU8(1);
      w.writeU8(1);
    }, 4));
  }

  queryPartyPosition() {
    this.send(this.make(0xf0, (w) => w.writeU8(0), 3));
  }

  razorAck() {
    this.send(this.make(0xf0, (w) => w.writeU8(0xff), 3));
  }


  castSpellFromBook(index, serial) {
    this.send(this.make(0x12, (w) => {
      w.writeU8(0x27);
      w.writeASCII(`${index} ${serial}`);
    }, 32));
  }

  virtueGumpResponse(serial, code) {
    this.send(this.make(0xb1, (w) => {
      w.writeU32BE(serial);
      w.writeU32BE(0x000001cd);
      w.writeU32BE(code);
    }, 32));
  }

  megaClilocRequestOld(serial) {
    this.send(this.make(0xbf, (w) => {
      w.writeU16BE(0x10);
      w.writeU32BE(serial);
    }));
  }

  bulletinRequest(boardSerial, msgSerial) {
    this.send(this.make(0x71, (w) => {
      w.writeU8(0x03);
      w.writeU32BE(boardSerial);
      w.writeU32BE(msgSerial);
    }, 32));
  }

  bulletinRequestSummary(boardSerial, msgSerial) {
    this.send(this.make(0x71, (w) => {
      w.writeU8(0x04);
      w.writeU32BE(boardSerial);
      w.writeU32BE(msgSerial);
    }, 32));
  }

  bulletinPost(boardSerial, msgSerial, subject, lines) {
    this.send(this.make(0x71, (w) => {
      w.writeU8(0x05);
      w.writeU32BE(boardSerial);
      w.writeU32BE(msgSerial);
      w.writeASCII(String(subject || '').slice(0, 255));
      w.writeU8(lines.length);
      for (const line of lines) w.writeASCII(String(line || '').slice(0, 255));
    }, 1024));
  }

  bulletinRemove(boardSerial, msgSerial) {
    this.send(this.make(0x71, (w) => {
      w.writeU8(0x06);
      w.writeU32BE(boardSerial);
      w.writeU32BE(msgSerial);
    }, 32));
  }

  equipMacroKR(serials) {
    this.send(this.make(0xec, (w) => {
      w.writeU8(serials.length);
      for (const serial of serials) w.writeU32BE(serial);
    }, 256));
  }

  unequipMacroKR(layers) {
    this.send(this.make(0xed, (w) => {
      w.writeU8(layers.length);
      for (const layer of layers) w.writeU16BE(layer);
    }, 256));
  }

  uoLiveHash(block, mapIndex, checksums) {
    this.send(this.make(0x3f, (w) => {
      w.writeU32BE(block);
      w.writeZero(6);
      w.writeU8(0xff);
      w.writeU8(mapIndex);
      for (const sum of checksums) w.writeU16BE(sum);
    }, 256));
  }

  bookHeaderOld(serial, title, author) {
    this.send(this.make(0x93, (w) => {
      w.writeU32BE(serial);
      w.writeU8(0);
      w.writeU8(1);
      w.writeU16BE(0);
      w.writeUTF8(String(title || '').slice(0, 60));
      w.writeUTF8(String(author || '').slice(0, 30));
    }, 128));
  }

  createCharacter(options) {
    const {
      name = 'New Character',
      race = 1,
      female = false,
      strength = 10,
      dexterity = 10,
      intelligence = 10,
      skills = [[0, 50], [1, 50], [2, 50], [3, 50]],
      cityIndex = 0,
      slot = 0,
      profession = 0,
      hue = 0,
      hair = [0x203b, 0],
      beard = [0, 0],
      shirtHue = 0,
      pantsHue = 0,
    } = options;
    const id = 0xf8;
    this.send(this.make(id, (w) => {
      w.writeU32BE(0xedededed);
      w.writeU32BE(0xffffffff);
      w.writeU8(0);
      w.writeASCII(name, 30);
      w.writeZero(2);
      w.writeU32BE(this.socket.clientVersionValue || 0x07006800);
      w.writeU32BE(0x01);
      w.writeU32BE(0x00);
      w.writeU8(profession);
      w.writeZero(15);
      w.writeU8((female ? 2 : 1) | ((race & 3) << 2));
      w.writeU8(strength);
      w.writeU8(dexterity);
      w.writeU8(intelligence);
      for (const [index, value] of skills.slice(0, 4)) {
        w.writeU8(index);
        w.writeU8(value);
      }
      w.writeU16BE(hue);
      w.writeU16BE(hair[0]);
      w.writeU16BE(hair[1]);
      w.writeZero(4);
      w.writeU16BE(beard[0]);
      w.writeU16BE(beard[1]);
      w.writeZero(4);
      w.writeU16BE(cityIndex);
      w.writeZero(2);
      w.writeU16BE(slot);
      w.writeU32BE(0x0100007f);
      w.writeU16BE(shirtHue);
      w.writeZero(2);
      w.writeU16BE(pantsHue);
      w.writeZero(2);
    }, 106));
  }


  houseCommand(subcommand) {
    this.send(this.make(0xd7, (w) => {
      w.writeU32BE(this.playerSerial || 0);
      w.writeU16BE(subcommand);
      w.writeU8(0x0a);
    }, 16));
  }

  houseBackup() {
    this.houseCommand(0x02);
  }

  houseRestore() {
    this.houseCommand(0x03);
  }

  houseCommit() {
    this.houseCommand(0x04);
  }

  houseExit() {
    this.houseCommand(0x0c);
  }

  houseGoToFloor(floor) {
    this.send(this.make(0xd7, (w) => {
      w.writeU32BE(this.playerSerial || 0);
      w.writeU16BE(0x12);
      w.writeU32BE(0);
      w.writeU8(floor & 0xff);
      w.writeU8(0x0a);
    }, 20));
  }

  houseSync() {
    this.houseCommand(0x0e);
  }

  houseClear() {
    this.houseCommand(0x10);
  }

  houseRevert() {
    this.houseCommand(0x1a);
  }

  houseResponse() {
    this.houseCommand(0x0a);
  }

  houseAddItem(graphic, x, y) {
    this.send(this.make(0xd7, (w) => {
      w.writeU32BE(this.playerSerial || 0);
      w.writeU16BE(0x06);
      w.writeU8(0);
      w.writeU32BE(graphic);
      w.writeU8(0);
      w.writeU32BE(x >>> 0);
      w.writeU8(0);
      w.writeU32BE(y >>> 0);
      w.writeU8(0x0a);
    }, 32));
  }

  houseDeleteItem(graphic, x, y, z) {
    this.send(this.make(0xd7, (w) => {
      w.writeU32BE(this.playerSerial || 0);
      w.writeU16BE(0x05);
      w.writeU8(0);
      w.writeU32BE(graphic);
      w.writeU8(0);
      w.writeU32BE(x >>> 0);
      w.writeU8(0);
      w.writeU32BE(y >>> 0);
      w.writeU8(0);
      w.writeU32BE((z | 0) >>> 0);
      w.writeU8(0x0a);
    }, 36));
  }

  houseAddRoof(graphic, x, y, z) {
    this.send(this.make(0xd7, (w) => {
      w.writeU32BE(this.playerSerial || 0);
      w.writeU16BE(0x13);
      w.writeU8(0);
      w.writeU32BE(graphic);
      w.writeU8(0);
      w.writeU32BE(x >>> 0);
      w.writeU8(0);
      w.writeU32BE(y >>> 0);
      w.writeU8(0);
      w.writeU32BE((z | 0) >>> 0);
      w.writeU8(0x0a);
    }, 36));
  }

  houseDeleteRoof(graphic, x, y, z) {
    this.send(this.make(0xd7, (w) => {
      w.writeU32BE(this.playerSerial || 0);
      w.writeU16BE(0x14);
      w.writeU8(0);
      w.writeU32BE(graphic);
      w.writeU8(0);
      w.writeU32BE(x >>> 0);
      w.writeU8(0);
      w.writeU32BE(y >>> 0);
      w.writeU8(0);
      w.writeU32BE((z | 0) >>> 0);
      w.writeU8(0x0a);
    }, 36));
  }

  houseAddStair(graphic, x, y) {
    this.send(this.make(0xd7, (w) => {
      w.writeU32BE(this.playerSerial || 0);
      w.writeU16BE(0x0d);
      w.writeU8(0);
      w.writeU32BE(graphic);
      w.writeU8(0);
      w.writeU32BE(x >>> 0);
      w.writeU8(0);
      w.writeU32BE(y >>> 0);
      w.writeU8(0x0a);
    }, 32));
  }

  customHouseCommand(subcommand, serial, extra) {
    this.send(this.make(0xd7, (w) => {
      if (serial) w.writeU32BE(serial);
      w.writeU16BE(subcommand);
      if (extra) extra(w);
    }, 64));
  }
}

function buildTable(clientVersion) {
  return buildLengthTable(clientVersion);
}
