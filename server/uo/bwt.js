/**
 * Burrows-Wheeler transform decompressor used by modern UO cliloc files,
 * gump entries with compression flag 3, and animation UOP entries.
 * Ported from ClassicUO/TazUO's BwtDecompress.
 */
export function bwtDecompress(buffer) {
  if (buffer.length < 5) return Buffer.alloc(0);

  const table = new Uint16Array(256);
  for (let j = 0; j < 256; j++) table[j] = j;

  let firstChar = buffer[4];
  const list = new Uint8Array(buffer.length - 4);
  let i = 0;

  for (let pos = 5; pos < buffer.length; pos++) {
    const currentValue = firstChar;
    const value = table[currentValue];
    if (currentValue > 0) {
      for (let k = currentValue; k > 0; k--) table[k] = table[k - 1];
    }
    table[0] = value;
    list[i++] = value & 0xff;
    firstChar = buffer[pos];
  }

  return internalDecompress(list);
}

function internalDecompress(input) {
  const symbolTable = new Uint16Array(256);
  const frequency = new Uint16Array(256);
  const partialInput = new Int32Array(256 * 3);

  for (let i = 0; i < 256; i++) symbolTable[i] = i;

  const header = Buffer.from(input.buffer, input.byteOffset, Math.min(1024, input.length));
  for (let i = 0; i < 256; i++) partialInput[i] = i * 4 + 4 <= header.length ? header.readInt32LE(i * 4) : 0;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += partialInput[i];
  const len = sum;
  if (len < 0 || len > 64 * 1024 * 1024) return Buffer.alloc(0);
  if (sum !== len) return Buffer.alloc(0);

  const output = Buffer.allocUnsafe(len);
  let count = 0;
  let nonZeroCount = 0;
  for (let i = 0; i < 256; i++) if (partialInput[i] !== 0) nonZeroCount++;

  frequencyFill(partialInput, frequency);

  for (let i = 0, m = 0; i < nonZeroCount; ++i) {
    const freq = frequency[i] & 0xff;
    symbolTable[input[m + 1024]] = freq;
    partialInput[freq + 256] = m + 1;
    m += partialInput[freq];
    partialInput[freq + 512] = m;
  }

  if (len === 0) return output;

  let val = symbolTable[0] & 0xff;
  do {
    output[count] = val;
    const idx256 = val + 256;
    if (partialInput[idx256] >= partialInput[val + 512]) {
      if (nonZeroCount-- > 0) {
        shiftLeft(symbolTable, nonZeroCount);
        val = symbolTable[0] & 0xff;
      }
    } else {
      const idx = input[partialInput[idx256] + 1024];
      partialInput[idx256]++;
      if (idx !== 0) {
        shiftLeft(symbolTable, idx);
        symbolTable[idx] = val;
        val = symbolTable[0] & 0xff;
      }
    }
    count++;
  } while (count < len);

  return output;
}

function frequencyFill(input, output) {
  const tmp = new Int32Array(256);
  for (let i = 0; i < 256; i++) tmp[i] = input[i];

  for (let i = 0; i < 256; i++) {
    let value = 0;
    let index = 0;
    for (let j = 0; j < 256; j++) {
      if (tmp[j] > value) {
        index = j;
        value = tmp[j];
      }
    }
    if (value === 0) break;
    output[i] = index;
    tmp[index] = 0;
  }
}

function shiftLeft(input, max) {
  for (let i = 0; i < max; i++) input[i] = input[i + 1];
}
