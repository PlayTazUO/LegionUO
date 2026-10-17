import { EncryptionHelper } from '../crypto/encryption.js';
import { Huffman } from '../crypto/huffman.js';
import { buildLengthTable } from './packet-length.js';
import { versionValue } from './packet-length.js';

export class UOSocket {
  constructor(options = {}) {
    this.url = options.url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/proxy`;
    this.clientVersion = options.clientVersion || '7.0.104.0';
    this.clientVersionValue = versionValue(this.clientVersion);
    this.lengthTable = buildLengthTable(this.clientVersion);
    this.ws = null;
    this.connected = false;
    this.tcpOpen = false;
    this.compressionEnabled = false;
    this.encryption = new EncryptionHelper(this.clientVersion);
    this.huffman = new Huffman();
    this.buffer = new Uint8Array(0);
    this.listeners = {
      open: [],
      close: [],
      error: [],
      packet: [],
      raw: [],
    };
    this.manualClose = false;
    this.pendingConnect = null;
    this.debugPackets = new URLSearchParams(location.search).has('debug');
  }

  on(event, cb) {
    this.listeners[event]?.push(cb);
    return this;
  }

  emit(event, value) {
    for (const cb of this.listeners[event] || []) {
      try {
        cb(value);
      } catch (err) {
        console.error(`[socket] ${event} handler`, err);
      }
    }
  }

  async openWebSocket() {
    if (this.ws && this.ws.readyState <= 1) return true;
    return new Promise((resolve) => {
      const ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let settled = false;
      ws.onopen = () => {
        settled = true;
        this.connected = true;
        resolve(true);
      };
      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            this.handleControl(JSON.parse(event.data));
          } catch {
            /* ignore malformed control frame */
          }
          return;
        }
        this.handleMessage(new Uint8Array(event.data));
      };
      ws.onerror = () => {
        this.emit('error', 'WebSocket connection failed');
        if (!settled) {
          settled = true;
          resolve(false);
        }
      };
      ws.onclose = () => {
        this.connected = false;
        this.tcpOpen = false;
        if (!settled) {
          settled = true;
          resolve(false);
        }
        if (!this.manualClose) this.emit('close', 'WebSocket closed');
      };
    });
  }

  async connect(host, port, options = {}) {
    this.manualClose = false;
    const opened = await this.openWebSocket();
    if (!opened) return false;
    this.pendingConnect = { host, port };
    this.ws.send(JSON.stringify({ type: 'connect', host, port }));
    if (options.encryption !== false) {
      this.encryption = new EncryptionHelper(options.clientVersion || this.clientVersion);
    }
    return true;
  }

  reconnectTCP(host, port) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.pendingConnect = { host, port };
    this.ignoreCloseUntil = Date.now() + 1500;
    this.tcpOpen = false;
    this.ws.send(JSON.stringify({ type: 'disconnect' }));
    setTimeout(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'connect', host, port }));
      }
    }, 30);
    return true;
  }

  handleControl(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'open') {
      this.tcpOpen = true;
      if (this.pendingConnect?.host === msg.host) this.pendingConnect = null;
      this.emit('open', msg);
    } else if (msg.type === 'close') {
      this.tcpOpen = false;
      if (!this.pendingConnect && Date.now() > (this.ignoreCloseUntil || 0)) this.emit('close', msg.hadError ? 'Server connection errored' : 'Server closed connection');
    } else if (msg.type === 'error') {
      this.emit('error', msg.message || 'Proxy error');
    }
  }

  handleMessage(data) {
    // The proxy text frames are control messages; binary frames are UO bytes.
    // Browsers deliver text as strings, so anything here is binary.
    if (this.compressionEnabled) {
      const decrypted = this.encryption.decryptGame(data);
      const decompressed = this.huffman.decompress(decrypted, 65536);
      if (this.debugPackets) console.log('RX', Array.from(decompressed).map(b=>b.toString(16).padStart(2,'0')).join(' '));
      if (decompressed.length) this.append(decompressed);
    } else {
      this.append(data);
    }
  }

  append(data) {
    if (!data.length) return;
    const next = new Uint8Array(this.buffer.length + data.length);
    next.set(this.buffer);
    next.set(data, this.buffer.length);
    this.buffer = next;
    this.parse();
  }

  parse() {
    while (this.buffer.length >= 1) {
      const id = this.buffer[0];
      let length = id >= 0xff ? -1 : this.lengthTable[id];
      let header = 1;
      if (length === -1) {
        if (this.buffer.length < 3) return;
        length = (this.buffer[1] << 8) | this.buffer[2];
        header = 3;
      }
      if (length <= 0 || length > 0x10000) {
        // Invalid framing. Drop a byte to resynchronise rather than wedging.
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      if (this.buffer.length < length) return;
      if (this.debugPackets) console.log('RX packet 0x' + id.toString(16) + ' len ' + length);
      const packet = this.buffer.subarray(0, length);
      this.buffer = this.buffer.subarray(length);
      this.emit('raw', packet);
      this.emit('packet', { data: packet, header });
    }
  }

  enableCompression() {
    this.compressionEnabled = true;
    this.huffman.reset();
    this.buffer = new Uint8Array(0);
  }

  initializeGameEncryption(seed) {
    this.encryption = new EncryptionHelper(this.clientVersion);
    this.encryption.initialize(false, seed >>> 0);
    this.initialized = true;
  }

  initializeLoginEncryption(seed = 0x0100007f) {
    this.encryption = new EncryptionHelper(this.clientVersion);
    this.encryption.initialize(true, seed >>> 0);
    this.initialized = true;
  }

  send(packet, options = {}) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    let data = new Uint8Array(packet);
    if (!options.skipEncryption) {
      if (this.compressionEnabled) {
        const out = new Uint8Array(data.length);
        this.encryption.encryptGame(data, out, data.length);
        data = out;
      } else if (this.initialized) {
        const out = new Uint8Array(data.length);
        this.encryption.encryptLogin(data, out, data.length);
        data = out;
      }
    }
    if (this.debugPackets) console.log('TX', Array.from(data.slice(0, 32)).map((b) => b.toString(16).padStart(2, '0')).join(' '));
    this.ws.send(data);
    return true;
  }

  close() {
    this.manualClose = true;
    this.connected = false;
    this.tcpOpen = false;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}
