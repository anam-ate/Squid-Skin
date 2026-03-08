#include <Arduino.h>
#include <Adafruit_DotStar.h>
#include <NativeEthernet.h>
#include <NativeEthernetUdp.h>

// Set to 1 to run a built-in strand test pattern instead of listening to frames from the PC.
#define ENABLE_SELF_TEST 0
// Layout: 9 separate strands, each with its own DATA and CLK pair (SK9822 / APA102 style).
// DATA 0–8, CLK per strand: 9, 23, 22, 21, 20, 19, 18, 17, 16.

static const uint8_t DATA_PINS[9]  = { 0, 1, 2, 3, 4, 5, 6, 7, 8 };
static const uint8_t CLOCK_PINS[9] = { 9, 23, 22, 21, 20, 19, 18, 17, 16 };

enum StrandType : uint8_t {
  STRAND_SMALL = 0,
  STRAND_LARGE = 1
};

static const StrandType STRAND_TYPES[9] = {
  STRAND_SMALL, STRAND_SMALL, STRAND_LARGE, STRAND_SMALL, STRAND_LARGE,
  STRAND_SMALL, STRAND_SMALL, STRAND_SMALL, STRAND_SMALL
};

static const uint8_t NODES_PER_STRAND[9] = {
  10, 4, 8, 10, 8, 10, 10, 10, 10  // large strands (2, 4) have 8 nodes each
};

static const uint8_t SMALL_RING_LEDS[3] = {15, 10, 5};
static const uint8_t LARGE_RING_LEDS[3] = {22, 14, 8};

static const uint8_t SMALL_NODE_LEDS = 5 + 10 + 15;
static const uint8_t LARGE_NODE_LEDS = 8 + 14 + 22;

// LED count per strand: nodes * LEDs per node (small=30, large=44)
static const uint16_t STRAND_LEDS[9] = {
  10 * SMALL_NODE_LEDS,   // strand 0: 300
  4 * SMALL_NODE_LEDS,    // strand 1: 120
  8 * LARGE_NODE_LEDS,    // strand 2: 352 (8 large nodes)
  10 * SMALL_NODE_LEDS,   // strand 3: 300
  8 * LARGE_NODE_LEDS,    // strand 4: 352 (8 large nodes)
  10 * SMALL_NODE_LEDS,   // strand 5: 300
  10 * SMALL_NODE_LEDS,   // strand 6: 300
  10 * SMALL_NODE_LEDS,   // strand 7: 300
  10 * SMALL_NODE_LEDS    // strand 8: 300
};

// Start index within logical strip (used to convert global LED index to per-strand local index)
static const uint16_t STRAND_OFFSET[9] = {
  0,     // 0
  300,   // 1  (0+300)
  420,   // 2  (300+120)
  772,   // 3  (420+352)
  1072,  // 4  (772+300)
  1424,  // 5  (1072+352)
  1724,  // 6  (1424+300)
  2024,  // 7  (1724+300)
  2324   // 8  (2024+300)
};

static const uint16_t TOTAL_LEDS = 2624;

// One DotStar strip per strand (separate DATA/CLK pairs). BGR order (common for SK9822).
// DATA 0–8; CLK per strand: 9, 23, 22, 21, 20, 19, 18, 17, 16.
Adafruit_DotStar strip0(STRAND_LEDS[0], DATA_PINS[0], CLOCK_PINS[0], DOTSTAR_BGR);  // DATA 0, CLK 9
Adafruit_DotStar strip1(STRAND_LEDS[1], DATA_PINS[1], CLOCK_PINS[1], DOTSTAR_BGR);  // DATA 1, CLK 23
Adafruit_DotStar strip2(STRAND_LEDS[2], DATA_PINS[2], CLOCK_PINS[2], DOTSTAR_BGR);  // DATA 2, CLK 22
Adafruit_DotStar strip3(STRAND_LEDS[3], DATA_PINS[3], CLOCK_PINS[3], DOTSTAR_BGR);  // DATA 3, CLK 21
Adafruit_DotStar strip4(STRAND_LEDS[4], DATA_PINS[4], CLOCK_PINS[4], DOTSTAR_BGR);  // DATA 4, CLK 20
Adafruit_DotStar strip5(STRAND_LEDS[5], DATA_PINS[5], CLOCK_PINS[5], DOTSTAR_BGR);  // DATA 5, CLK 19
Adafruit_DotStar strip6(STRAND_LEDS[6], DATA_PINS[6], CLOCK_PINS[6], DOTSTAR_BGR);  // DATA 6, CLK 18
Adafruit_DotStar strip7(STRAND_LEDS[7], DATA_PINS[7], CLOCK_PINS[7], DOTSTAR_BGR);  // DATA 7, CLK 17
Adafruit_DotStar strip8(STRAND_LEDS[8], DATA_PINS[8], CLOCK_PINS[8], DOTSTAR_BGR);  // DATA 8, CLK 16
Adafruit_DotStar* const strips[9] = { &strip0, &strip1, &strip2, &strip3, &strip4, &strip5, &strip6, &strip7, &strip8 };

// ---------------------------------------------------------------------------
// Ethernet / UDP
byte mac[6] = {0x04, 0xE9, 0xE5, 0x12, 0x34, 0x56};
IPAddress ip(192, 168, 0, 50);
const uint16_t LOCAL_UDP_PORT = 6000;
EthernetUDP Udp;
static uint8_t frameBuf[4096];

void setupLeds() {
  for (uint8_t s = 0; s < 9; ++s) {
    strips[s]->begin();
    strips[s]->setBrightness(255);
  }
}

bool getRingRange(uint8_t strand, uint8_t nodeIndex, uint8_t ringIndex, uint32_t &start, uint32_t &end) {
  if (strand >= 9 || STRAND_LEDS[strand] == 0) return false;
  const uint8_t nodes = NODES_PER_STRAND[strand];
  if (nodeIndex >= nodes || ringIndex >= 3) return false;

  const StrandType type = STRAND_TYPES[strand];
  const uint8_t *ringLeds = (type == STRAND_SMALL) ? SMALL_RING_LEDS : LARGE_RING_LEDS;
  const uint8_t perNode = (type == STRAND_SMALL) ? SMALL_NODE_LEDS : LARGE_NODE_LEDS;

  uint32_t base = STRAND_OFFSET[strand] + (uint32_t)nodeIndex * perNode;
  uint32_t offset = 0;
  for (uint8_t r = 0; r < ringIndex; ++r) offset += ringLeds[r];
  start = base + offset;
  end = start + ringLeds[ringIndex];
  if (end > STRAND_OFFSET[strand] + (uint32_t)nodes * perNode) return false;
  return true;
}

// Global brightness from packet header (0–60). We keep strip at 255 and clamp pixel values to this cap.
static uint8_t globalBrightnessCap = 60;

static uint8_t testStrand = 0;
static uint16_t testOffsetInStrand = 0;
static unsigned long lastTestStepMs = 0;

void updateTestStrandFromSerial() {
  while (Serial.available() > 0) {
    int c = Serial.read();
    if (c >= '0' && c <= '8') {
      testStrand = (uint8_t)(c - '0');
      testOffsetInStrand = 0;
    }
  }
}

void stepSelfTest() {
  if (millis() - lastTestStepMs < 150) return;
  lastTestStepMs = millis();

  for (uint8_t s = 0; s < 9; ++s) strips[s]->clear();

  if (testStrand < 9 && STRAND_LEDS[testStrand] > 0) {
    uint16_t count = STRAND_LEDS[testStrand];
    if (testOffsetInStrand >= count) testOffsetInStrand = 0;
    strips[testStrand]->setPixelColor(testOffsetInStrand, 255, 0, 0);
    testOffsetInStrand++;
  }

  for (uint8_t s = 0; s < 9; ++s) strips[s]->show();
}

// UDP frame: 'S', globalBrightness(1), frameLow(1), frameHigh(1), nodeCount(1), then per node: pin, index, ring0..2 rgb (9 bytes each)
void applyFrameFromBuffer(const uint8_t *buf, uint16_t len) {
  if (len < 5) return;
  uint16_t offset = 0;
  if (buf[offset++] != 'S') return;
  uint8_t rawBrightness = buf[offset++];
  globalBrightnessCap = (rawBrightness <= 60) ? rawBrightness : (uint8_t)60;
  offset += 2; // frame id
  uint8_t nodeCount = buf[offset++];

  const uint16_t bytesPerNode = 2 + 3 * 3;
  if (len < 5 + (uint16_t)nodeCount * bytesPerNode) return;

  // Strip brightness stays at 255; we clamp pixel values to globalBrightnessCap instead.
  for (uint8_t s = 0; s < 9; ++s) strips[s]->clear();

  for (uint8_t i = 0; i < nodeCount; ++i) {
    uint8_t strandIn = buf[offset++];
    uint8_t nodeIndexIn = buf[offset++];
    if (strandIn >= 9) { offset += 9; continue; }

    for (uint8_t ring = 0; ring < 3; ++ring) {
      uint8_t r = buf[offset++];
      uint8_t g = buf[offset++];
      uint8_t b = buf[offset++];
      // Clamp each channel to global brightness: values above cap become cap; below stay as-is.
      if (r > globalBrightnessCap) r = globalBrightnessCap;
      if (g > globalBrightnessCap) g = globalBrightnessCap;
      if (b > globalBrightnessCap) b = globalBrightnessCap;

      uint32_t start, end;
      if (!getRingRange(strandIn, nodeIndexIn, ring, start, end)) continue;

      const uint16_t base = STRAND_OFFSET[strandIn];
      for (uint32_t ledIndex = start; ledIndex < end; ++ledIndex)
        strips[strandIn]->setPixelColor((uint16_t)(ledIndex - base), r, g, b);
    }
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 2000) {}

  setupLeds();

  Ethernet.begin(mac, ip);
  Udp.begin(LOCAL_UDP_PORT);
  Serial.print("Teensy IP: ");
  Serial.println(Ethernet.localIP());
  Serial.print("UDP port: ");
  Serial.println(LOCAL_UDP_PORT);
}

void loop() {
#if ENABLE_SELF_TEST
  updateTestStrandFromSerial();
  stepSelfTest();
  return;
#else
  int packetSize = Udp.parsePacket();
  if (packetSize <= 0) return;
  if (packetSize > (int)sizeof(frameBuf)) packetSize = sizeof(frameBuf);

  int len = Udp.read(frameBuf, packetSize);
  if (len <= 0) return;

  applyFrameFromBuffer(frameBuf, (uint16_t)len);
  for (uint8_t s = 0; s < 9; ++s) strips[s]->show();
#endif
}
