import { BASE_PACKET_LENGTHS } from './packet-table.js';

export function versionValue(v) {
  const p = String(v || '7.0.104.0')
    .replace(/,/g, '.')
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  return ((p[0] || 0) << 24) | ((p[1] || 0) << 16) | ((p[2] || 0) << 8) | (p[3] || 0);
}

const V = {
  CV_200: 0x02000000,
  CV_500A: (5 << 24) | (0 << 16) | (0 << 8) | 0x61,
  CV_5090: (5 << 24) | (0 << 16) | (9 << 8),
  CV_6013: (6 << 24) | (0 << 16) | (1 << 8) | 3,
  CV_6017: (6 << 24) | (0 << 16) | (1 << 8) | 8,
  CV_6060: (6 << 24) | (0 << 16) | (6 << 8),
  CV_60142: (6 << 24) | (0 << 16) | (14 << 8) | 2,
  CV_7000: (7 << 24) | (0 << 16) | (0 << 8),
  CV_7090: (7 << 24) | (0 << 16) | (9 << 8),
  CV_70180: (7 << 24) | (0 << 16) | (18 << 8),
  CV_706400: (7 << 24) | (0 << 16) | (64 << 8),
  CV_7010400: (7 << 24) | (0 << 16) | (104 << 8),
};

export function buildLengthTable(clientVersion) {
  const table = Int32Array.from(BASE_PACKET_LENGTHS);
  const version = versionValue(clientVersion);

  if (version >= V.CV_500A) {
    table[0x0b] = 0x07;
    table[0x16] = -1;
    table[0x31] = -1;
  } else {
    table[0x0b] = 0x10a;
    table[0x16] = 0x01;
    table[0x31] = 0x01;
  }
  table[0xe1] = version >= V.CV_5090 ? -1 : 0x09;
  if (version >= V.CV_6013) {
    table[0xe3] = -1;
    table[0xe6] = 0x05;
    table[0xe7] = 0x0c;
    table[0xe8] = 0x0d;
    table[0xe9] = 0x4b;
    table[0xea] = 0x03;
  } else {
    table[0xe3] = 0x4d;
    table[0xe6] = -1;
    table[0xe7] = -1;
    table[0xe8] = -1;
    table[0xe9] = -1;
    table[0xea] = -1;
  }
  if (version >= V.CV_6017) {
    table[0x08] = 0x0f;
    table[0x25] = 0x15;
  } else {
    table[0x08] = 0x0e;
    table[0x25] = 0x14;
  }
  if (version >= V.CV_6060) {
    table[0xee] = 0x2000;
    table[0xef] = 0x2000;
    table[0xf1] = 0x09;
  } else {
    table[0xee] = -1;
    table[0xef] = 0x15;
    table[0xf1] = -1;
  }
  table[0xb9] = version >= V.CV_60142 ? 0x05 : 0x03;
  if (version >= V.CV_7000) {
    table[0xee] = 0x0a;
    table[0xef] = 0x15;
  } else {
    table[0xee] = -1;
    table[0xef] = 0x15;
  }
  if (version >= V.CV_7090) {
    table[0x24] = 0x09;
    table[0x99] = 0x1e;
    table[0xba] = 0x0a;
    table[0xf3] = 0x1a;
    table[0xf1] = 0x09;
    table[0xf2] = 0x19;
  } else {
    table[0x24] = 0x07;
    table[0x99] = 0x1a;
    table[0xba] = 0x06;
    table[0xf3] = 0x18;
    table[0xf1] = -1;
    table[0xf2] = -1;
  }
  table[0x00] = version >= V.CV_70180 ? 0x6a : 0x68;
  if (version >= V.CV_706400) {
    table[0xfa] = 0x01;
    table[0xfb] = 0x02;
  }
  if (version >= V.CV_7010400) {
    table[0xd5] = 0x09;
    table[0xfd] = 2;
  }
  return table;
}

export function getPacketLength(table, id) {
  if (id >= 0xff) return -1;
  return table[id];
}
