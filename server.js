const path = require('path');
const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');
const dgram = require('dgram');

const app = express();
const PORT = process.env.PORT || 3000;
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

const server = app.listen(PORT, () => {
  console.log(`Web server running on http://localhost:${PORT}`);
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
    const frameId = frameCounter++ & 0xffff;
    // UI slider 0–60; send that value directly so Teensy cap is 0–60 (0 = all off)
    const raw = parseInt(msg.globalBrightness, 10);
    const globalBrightness = Number.isNaN(raw) ? 60 : Math.max(0, Math.min(60, raw));

    const BYTES_PER_NODE = 2 + 3 * 3;
    const buf = Buffer.alloc(5 + nodeCount * BYTES_PER_NODE);
    let offset = 0;
    buf.writeUInt8('S'.charCodeAt(0), offset++);
    buf.writeUInt8(globalBrightness, offset++);
    buf.writeUInt8(frameId & 0xff, offset++);
    buf.writeUInt8((frameId >> 8) & 0xff, offset++);
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

