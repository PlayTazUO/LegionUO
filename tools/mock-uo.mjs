import net from 'node:net';
import { DEC_TREE } from '../client/js/crypto/huffman-table.js';
import { Twofish } from '../client/js/crypto/twofish.js';
import zlib from 'node:zlib';

// Build a byte -> bit-string encoder by walking the decoder tree in reverse.
// Bit 1 takes the first child, bit 0 the second (matching Huffman.decompress).
const codes = new Map();
function walk(node, bits) {
  if (node <= 0) {
    codes.set(-node, bits);
    return;
  }
  walk(DEC_TREE[node * 2], bits + '1');
  walk(DEC_TREE[node * 2 + 1], bits + '0');
}
walk(DEC_TREE[0], '1');
walk(DEC_TREE[1], '0');

function huffmanCompress(data) {
  let bits = '';
  for (const byte of data) bits += codes.get(byte) ?? codes.get(0);
  bits += codes.get(256); // -256 is the end-of-stream marker
  const out = Buffer.alloc(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}

function packet(id, body, length) {
  const b = Buffer.from(body);
  if (length === -1) {
    const out = Buffer.alloc(3 + b.length);
    out[0] = id; out.writeUInt16BE(3 + b.length, 1); b.copy(out, 3);
    return out;
  }
  const out = Buffer.alloc(length);
  out[0] = id; b.copy(out, 1);
  return out;
}
function u8(v){return Buffer.from([v]);}
function u16(v){const b=Buffer.alloc(2);b.writeUInt16BE(v);return b;}
function u32(v){const b=Buffer.alloc(4);b.writeUInt32BE(v>>>0);return b;}
function u32le(v){const b=Buffer.alloc(4);b.writeUInt32LE(v>>>0);return b;}
function ascii(str,len){const b=Buffer.alloc(len||str.length);b.write(str,0,'latin1');return b;}
function unicodeBE(str){const b=Buffer.alloc(str.length*2+2);for(let i=0;i<str.length;i++)b.writeUInt16BE(str.charCodeAt(i),i*2);return b;}
function concat(...parts){return Buffer.concat(parts);}

const loginServer = net.createServer((socket) => {
  console.log('[mock] login connection');
  let sent = false;
  let waiting = false;
  socket.on('data', () => {
    if (waiting) {
      waiting = false;
      const relay = packet(0x8c, concat(u32le(0x0100007f), u16(2594), u32(0x11223344)), 11);
      socket.write(relay);
      console.log('[mock] sent relay');
      return;
    }
    if (sent) return;
    sent = true;
    setTimeout(() => {
      const entry = concat(u16(0), ascii('Legion Test Shard', 32), u8(0), u8(0), u32(0x0100007f));
      const pkt = packet(0xa8, concat(u8(0), u16(1), entry), -1);
      socket.write(pkt);
      waiting = true;
      console.log('[mock] sent server list');
    }, 300);
  });
  socket.on('error', () => {});
});
loginServer.listen(2593, '127.0.0.1', () => console.log('[mock] login on 2593'));

const seed = 0x11223344;
const gameServer = net.createServer((socket) => {
  console.log('[mock] game connection');
  const twofish = new Twofish();
  twofish.initialize(seed, true);
  const sendGame = (plain) => {
    const compressed = huffmanCompress(plain);
    const enc = Buffer.alloc(compressed.length);
    twofish.decrypt(compressed, enc, compressed.length);
    socket.write(enc);
  };
  let phase = 0;
  socket.on('data', () => {});
  setTimeout(() => {
    // Character list
    const chars = concat(u8(1), ascii('TestChar', 30), Buffer.alloc(30), u8(0), u32(0));
    sendGame(packet(0xa9, chars, -1));
    console.log('[mock] sent character list');
  }, 500);
  setTimeout(() => {
    const enter = Buffer.alloc(37);
    enter[0] = 0x1b;
    enter.writeUInt32BE(1, 1);
    enter.writeUInt32BE(0, 5);
    enter.writeUInt16BE(0x0190, 9);
    enter.writeUInt16BE(1000, 11);
    enter.writeUInt16BE(1000, 13);
    enter.writeUInt16BE(0, 15);
    enter.writeUInt8(0, 17);
    const status = packet(0x11, concat(u32(1), ascii('TestChar',30), u16(50), u16(50), u8(0), u8(0)), -1);
    const loginComplete = packet(0x55, Buffer.alloc(0), 1);
    sendGame(concat(enter, status, loginComplete));
    console.log('[mock] sent enter world');
  }, 6000);
  setTimeout(() => {
    // Another mobile, a ground item, speech, animation, light, season.
    const mob = concat(u32(2), u16(0x0190), u16(1004), u16(1000), Buffer.from([0]), u8(2), u16(0), u8(0), u8(1), u32(0));
    const updateMob = packet(0x78, mob, -1);
    const item = concat(u32(0x40000001), u16(0x0eed), u16(1002), u16(1002), Buffer.from([0]));
    const updateItem = packet(0x1a, item, -1);
    const speechBody = concat(u32(2), u16(0x0190), u8(0), u16(0x3b2), u16(3), ascii('Guard',30), ascii('Hail, traveler!'));
    const speech = packet(0x1c, speechBody, -1);
    const animBody = concat(u32(2), u16(4), u16(1), u16(1), u8(0), u8(0), u8(0));
    const anim = packet(0x6e, animBody, 14);
    const light = packet(0x4f, u8(10), 2);
    const season = packet(0xbc, concat(u8(0), u8(0)), 3);
    // Equip a backpack on the player and open a container with two items and a spellbook.
    const equip = packet(0x2e, concat(u32(0x40000002), u16(0x0e75), u8(0), u8(21), u32(1), u16(0)), 15);
    const open = packet(0x24, concat(u32(0x40000002), u16(0x0048)), 9);
    const contents = [];
    contents.push(u32(0x40000003), u16(0x0eed), u8(0), u16(10), u16(40), u16(44), u8(0), u32(0x40000002), u16(0));
    contents.push(u32(0x40000004), u16(0x0cd3), u8(0), u16(2), u16(96), u16(44), u8(0), u32(0x40000002), u16(0));
    contents.push(u32(0x40000006), u16(0x0efa), u8(0), u16(1), u16(40), u16(96), u8(0), u32(0x40000002), u16(0));
    const cont = packet(0x3c, concat(u16(3), ...contents), -1);
    const spellContent = packet(0xbf, concat(u16(0x1b), u8(0), u8(0), u32(0x40000006), u16(0x0efa), u16(1), Buffer.from([0xff, 0, 0, 0, 0, 0, 0, 0])), -1);
    const openBook = packet(0x24, concat(u32(0x40000006), u16(0xffff)), 9);
    const buff = packet(
      0xdf,
      concat(
        u32(1),
        u16(0x3ed),
        u16(1),
        u16(1),
        u16(0),
        u16(0x3ed),
        u16(0),
        u32(0),
        u16(120),
        u8(0),
        u8(0),
        u8(0),
        u32(1051000),
        u32(0),
        u32(0),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u16(0)
      ),
      -1
    );
    const partyManifest = packet(0xbf, concat(u16(0x06), u8(0x01), u8(2), u32(1), u32(2)), -1);
    const partyMessage = packet(0xbf, concat(u16(0x06), u8(0x04), u32(2), unicodeBE('Party chat works.')), -1);
    // A treasure-map style map gump (0x90) and its first pin (0x56 Add).
    const mapGump = packet(
      0x90,
      concat(u32(0x40000008), u16(0x139d), u16(960), u16(960), u16(1088), u16(1088), u16(300), u16(300)),
      19
    );
    const mapPin = packet(0x56, concat(u32(0x40000008), u8(1), u8(0), u16(150), u16(150)), 11);
    sendGame(concat(updateMob, updateItem, speech, anim, light, season, equip, open, cont, spellContent, openBook, buff, partyManifest, partyMessage, mapGump, mapPin));
    console.log('[mock] sent world objects, party manifest, and map gump');
  }, 8500);

  setTimeout(() => {
    // Regular server gump
    const layout = '{ resizepic 0 0 2620 300 170 }{ text 26 24 1153 0 }{ text 26 52 1153 1 }{ button 130 120 110 111 1 0 1 }';
    const lines = ['Hello from a server gump!', 'Click the button to reply.'];
    const body = [];
    body.push(u32(0), u32(0x1234), u32(500), u32(120));
    body.push(u16(layout.length), Buffer.from(layout, 'latin1'));
    body.push(u16(lines.length));
    for (const line of lines) {
      const b = Buffer.alloc(line.length * 2);
      for (let i = 0; i < line.length; i++) b.writeUInt16BE(line.charCodeAt(i), i * 2);
      body.push(u16(b.length), b);
    }
    sendGame(packet(0xb0, concat(...body), -1));

    // Compressed server gump (0xDD)
    const layout2 = '{ resizepic 0 0 2620 240 130 }{ htmlgump 20 20 200 60 0 0 0 }{ button 100 84 110 111 2 7 2 }';
    const line2 = 'Compressed gump layout works.';
    const lineBytes = Buffer.alloc(2 + line2.length * 2);
    lineBytes.writeUInt16BE(line2.length * 2, 0);
    for (let i = 0; i < line2.length; i++) lineBytes.writeUInt16BE(line2.charCodeAt(i), 2 + i * 2);
    const compLayout = zlib.deflateSync(Buffer.from(layout2, 'latin1'));
    const compLines = zlib.deflateSync(lineBytes);
    const b2 = [];
    b2.push(u32(0), u32(0x1235), u32(60), u32(300));
    b2.push(u32(compLayout.length + 4), u32(Buffer.byteLength(layout2)));
    b2.push(compLayout);
    b2.push(u32(1), u32(compLines.length + 4), u32(lineBytes.length), compLines);
    sendGame(packet(0xdd, concat(...b2), -1));
    console.log('[mock] sent gumps');
  }, 9500);
  socket.on('error', () => {});
});
gameServer.listen(2594, '127.0.0.1', () => console.log('[mock] game on 2594'));
