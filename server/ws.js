import crypto from 'node:crypto';
import net from 'node:net';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

class WebSocketConnection {
  constructor(socket, req) {
    this.socket = socket;
    this.req = req;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.tcp = null;
    this.closed = false;
    this.onMessage = null;
    this.onClose = null;

    socket.on('data', (chunk) => this.feed(chunk));
    socket.on('close', () => this.cleanup());
    socket.on('error', () => this.cleanup());
  }

  send(value) {
    if (this.closed || this.socket.destroyed) return;
    if (typeof value === 'string') this.socket.write(encodeFrame(0x1, Buffer.from(value, 'utf8')));
    else this.socket.write(encodeFrame(0x2, Buffer.from(value)));
  }

  sendJSON(obj) {
    this.send(JSON.stringify(obj));
  }

  close(code = 1000) {
    if (this.closed) return;
    try {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code, 0);
      this.socket.write(encodeFrame(0x8, payload));
    } catch {
      /* ignore */
    }
    this.cleanup();
    try {
      this.socket.destroy();
    } catch {
      /* ignore */
    }
  }

  cleanup() {
    if (this.closed) return;
    this.closed = true;
    if (this.tcp) {
      try {
        this.tcp.destroy();
      } catch {
        /* ignore */
      }
      this.tcp = null;
    }
    this.onClose?.();
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        len = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLen + len) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      offset += maskLen;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + len));
      this.buffer = this.buffer.subarray(offset + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        this.socket.write(encodeFrame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) continue;

      if (opcode === 0x0) {
        this.fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this.fragments);
          this.fragments = [];
          this.deliver(this.fragmentOpcode, full);
        }
      } else if (!fin) {
        this.fragmentOpcode = opcode;
        this.fragments = [payload];
      } else {
        this.deliver(opcode, payload);
      }
    }
  }

  deliver(opcode, payload) {
    if (opcode === 0x1) {
      try {
        this.onMessage?.(JSON.parse(payload.toString('utf8')));
      } catch {
        this.sendJSON({ type: 'error', message: 'Bad JSON control message' });
      }
    } else if (opcode === 0x2) {
      if (this.tcp && !this.tcp.destroyed) this.tcp.write(payload);
    }
  }
}

export function attachWebSocketServer(httpServer, options = {}) {
  httpServer.on('upgrade', (req, socket) => {
    if (!req.url || !req.url.startsWith('/proxy')) {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const ws = new WebSocketConnection(socket, req);

    const denyHost = (host) => {
      if (options.defaultLoginHost) {
        const allowed = new Set([String(options.defaultLoginHost).toLowerCase()]);
        for (const extra of options.allowProxyHosts || []) allowed.add(String(extra).toLowerCase());
        return !allowed.has(String(host).toLowerCase());
      }
      const allow = options.allowProxyHosts || [];
      if (!allow.length) return false;
      return !allow.map((x) => String(x).toLowerCase()).includes(String(host).toLowerCase());
    };

    ws.onMessage = (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'connect') {
        const host = String(msg.host || options.defaultLoginHost || '');
        const port = Number(msg.port || 2593);
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
          ws.sendJSON({ type: 'error', message: 'Invalid host or port' });
          return;
        }
        if (denyHost(host)) {
          ws.sendJSON({ type: 'error', message: `Host not allowed: ${host}` });
          return;
        }
        if (ws.tcp) {
          try {
            ws.tcp.destroy();
          } catch {
            /* ignore */
          }
          ws.tcp = null;
        }
        const tcp = net.connect({ host, port });
        ws.tcp = tcp;
        tcp.setNoDelay(true);
        const connectTimer = setTimeout(() => {
          if (tcp.connecting) {
            console.log(`[proxy] tcp connect timeout ${host}:${port}`);
            tcp.destroy(new Error('Connection timed out'));
          }
        }, 10000);
        tcp.on('connect', () => {
          clearTimeout(connectTimer);
          ws.sendJSON({ type: 'open', host, port });
        });
        tcp.on('data', (data) => ws.send(data));
        tcp.on('error', (err) => {
          console.log(`[proxy] tcp error ${host}:${port}: ${err.message}`);
          ws.sendJSON({ type: 'error', message: err.message });
        });
        tcp.on('close', (hadError) => {
          clearTimeout(connectTimer);
          ws.tcp = null;
          console.log(`[proxy] tcp closed ${host}:${port}${hadError ? ' (error)' : ''}`);
          ws.sendJSON({ type: 'close', hadError: !!hadError });
        });
      } else if (msg.type === 'disconnect') {
        if (ws.tcp) {
          try {
            ws.tcp.destroy();
          } catch {
            /* ignore */
          }
          ws.tcp = null;
        }
      } else if (msg.type === 'ping') {
        ws.sendJSON({ type: 'pong', time: Date.now() });
      }
    };
  });
}
