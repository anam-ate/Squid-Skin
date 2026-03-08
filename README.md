# Squid-Skin LED canvas

An LED canvas shaped like a squid, with 80 nodes in 9 strands (2624 LEDs). Teensy 4.1 + Ethernet; web app controls content and the 3 rings per node.

## Teensy 4.1 pin layout (9 strands, separate DATA + CLK per strand)

| Strand | DATA pin | CLK pin |
|--------|----------|---------|
| 0      | 0        | 9       |
| 1      | 1        | 23      |
| 2      | 2        | 22      |
| 3      | 3        | 21      |
| 4      | 4        | 20      |
| 5      | 5        | 19      |
| 6      | 6        | 18      |
| 7      | 7        | 17      |
| 8      | 8        | 16      |

Firmware: `TeensySquid/TeensySquid.ino`. Server + web UI in `server.js` and `public/`.

