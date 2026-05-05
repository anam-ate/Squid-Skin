const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const WebSocket = require('ws');
const dgram = require('dgram');

const app = express();
const PORT = process.env.PORT || 3000;
/** Listen on all interfaces so phones and other PCs on the LAN can connect. */
const HOST = process.env.HOST || '0.0.0.0';
const TEENSY_IP = process.env.TEENSY_IP || '192.168.0.50';
const TEENSY_PORT = parseInt(process.env.TEENSY_PORT || '6000', 10);

// Serve static files from public/
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Simple endpoint to serve pin_nodes.json
app.get('/pin_nodes.json', (req, res) => {
  const jsonPath = path.join(__dirname, 'pin_nodes.json');
  fs.createReadStream(jsonPath).pipe(res);
});

function listLanIPv4() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const net of ifs[name] || []) {
      const v4 = net.family === 'IPv4' || net.family === 4;
      if (v4 && !net.internal) out.push(net.address);
    }
  }
  return out;
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Web server listening on http://${HOST}:${PORT}`);
  console.log(`Open from this Pi: http://localhost:${PORT}`);
  const addrs = listLanIPv4();
  if (addrs.length) {
    console.log('Open from phone / other device on same network:');
    for (const a of addrs) console.log(`  http://${a}:${PORT}`);
  }
});

// WebSocket server for frame data
const wss = new WebSocket.Server({ server, path: '/frames' });

// UDP socket to talk to Teensy over Ethernet
const udpClient = dgram.createSocket('udp4');

let frameCounter = 0;
let lastSerialSendMs = 0;

// Expect JSON messages with structure:
// {
//   frameId: number,
//   nodes: [
//     { pin: number, index: number, rings: [ { r,g,b }, { r,g,b }, { r,g,b } ] },
//     ...
//   ]
// }
//
// We pack this into a simple binary format:
// [ 'S'(1), frameLow(1), frameHigh(1), nodeCount(1),
//   then for each node:
//     pin(1), index(1),
//     ring0.r(1), ring0.g(1), ring0.b(1),
//     ring1.r(1), ring1.g(1), ring1.b(1),
//     ring2.r(1), ring2.g(1), ring2.b(1)
// ]

function clampByte(v) {
  return Math.max(0, Math.min(255, v | 0));
}

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      console.error('Invalid JSON from client');
      return;
    }

    const nodes = msg.nodes || [];

    const nodeCount = Math.min(nodes.length, 255);
    // Optional frame-rate limiter; Teensy 4.1 + Ethernet can happily
    // handle 60 FPS, so we keep this light (16 ms ≈ 60 FPS).
    const nowMs = Date.now();
    if (nowMs - lastSerialSendMs < 25) {
      return;
    }
    lastSerialSendMs = nowMs;
    // UI slider 0–60; send that value directly (0–60) in lower 7 bits.
    const raw = parseInt(msg.globalBrightness, 10);
    const globalBrightness = Number.isNaN(raw) ? 60 : Math.max(0, Math.min(60, raw));
    const spiralMode = !!msg.spiralMode;
    const spiralWidthRaw = parseInt(msg.spiralWidth, 10);
    const spiralWidth = Number.isNaN(spiralWidthRaw)
      ? 0
      : Math.max(0, Math.min(15, spiralWidthRaw));
    const spiralSpeedRaw = parseInt(msg.spiralSpeed, 10);
    const spiralSpeedVal = Number.isNaN(spiralSpeedRaw)
      ? 80
      : Math.max(10, Math.min(200, spiralSpeedRaw));
    const spiralDirMixRaw = parseInt(msg.spiralDirMix, 10);
    const spiralDirMixVal = Number.isNaN(spiralDirMixRaw)
      ? 50
      : Math.max(0, Math.min(100, spiralDirMixRaw));

    // Pack spiral speed (0–15) and direction mix (0–15) into one byte:
    // lower 4 bits = speed index, upper 4 bits = direction mix index.
    const speedIndex = Math.max(0, Math.min(15, Math.round(((spiralSpeedVal - 10) / (200 - 10)) * 15)));
    const dirIndex = Math.max(0, Math.min(15, Math.round((spiralDirMixVal / 100) * 15)));
    const spiralSpeedPacked = ((dirIndex & 0x0f) << 4) | (speedIndex & 0x0f);

    const BYTES_PER_NODE = 2 + 3 * 3;
    const buf = Buffer.alloc(5 + nodeCount * BYTES_PER_NODE);
    let offset = 0;
    buf.writeUInt8('S'.charCodeAt(0), offset++);
    // Byte 1: brightness flags (bit 7 = spiral mode, bits 0–6 = brightness 0–60)
    let brightnessFlags = globalBrightness & 0x7f;
    if (spiralMode) brightnessFlags |= 0x80;
    buf.writeUInt8(brightnessFlags, offset++);
    // Byte 2: spiral width (0–15; 0 = use default on Teensy)
    buf.writeUInt8(spiralWidth & 0x0f, offset++);
    // Byte 3: spiral speed + direction mix (packed: upper 4 bits dir, lower 4 bits speed)
    buf.writeUInt8(spiralSpeedPacked & 0xff, offset++);
    // Byte 4: node count
    buf.writeUInt8(nodeCount, offset++);

    for (let i = 0; i < nodeCount; i++) {
      const n = nodes[i];
      const pin = Number.isFinite(n.pin) ? n.pin : 0;
      const index = Number.isFinite(n.index) ? n.index : 0;
      const rings = n.rings || [];

      // No logical remapping here: pins from pin_nodes.json go straight through.
      buf.writeUInt8(pin & 0xff, offset++);
      buf.writeUInt8(index & 0xff, offset++);

      for (let r = 0; r < 3; r++) {
        const ring = rings[r] || { r: 0, g: 0, b: 0 };
        buf.writeUInt8(clampByte(ring.r), offset++);
        buf.writeUInt8(clampByte(ring.g), offset++);
        buf.writeUInt8(clampByte(ring.b), offset++);
      }
    }

    // console.log('Sending frame to Teensy:', frameId);
    // console.log('Frame length:', buf.length);
    // const hexStr = buf.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    // console.log('Frame content:', hexStr);

    udpClient.send(buf, TEENSY_PORT, TEENSY_IP, (err) => {
      if (err) {
        console.error('UDP send error:', err.message);
      }
    });
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

