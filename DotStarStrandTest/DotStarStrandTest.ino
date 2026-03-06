/*
 * Standard RGB strand test using Adafruit DotStar (SK9822/APA102).
 * Exercises every pixel along the strip (pixel-by-pixel walk), not node-by-node.
 *
 * Hardware: 1 chain of 300 LEDs. DATA = pin 0, CLOCK = pin 9.
 * Brightness cap: 60/255 to match main app.
 *
 * Sequence:
 *   1. Red fill (2s)
 *   2. Green fill (2s)
 *   3. Blue fill (2s)
 *   4. White fill (2s)
 *   5. Dark yellow fill (2s) – darker values so it looks dark, not pastel
 *   6. Pixel walk – one lit pixel steps through all 300 pixels (red, then green, then blue)
 *   7. Gradient along strip (2s)
 *   Then repeats.
 */

#include <Arduino.h>
#include <Adafruit_DotStar.h>

#define DATA_PIN   0
#define CLOCK_PIN  9
#define NUM_LEDS   300
#define TEST_BRIGHTNESS 60

Adafruit_DotStar strip(NUM_LEDS, DATA_PIN, CLOCK_PIN, DOTSTAR_BGR);

enum TestPhase {
  RED,
  GREEN,
  BLUE,
  WHITE,
  DARK_YELLOW,
  PIXEL_WALK,
  GRADIENT,
  _COUNT
};

TestPhase phase = RED;
unsigned long phaseStart = 0;
const unsigned long phaseDurationMs = 2000;

// Pixel walk: one pixel lit at a time, steps through 0..NUM_LEDS-1
uint16_t pixelWalkIndex = 0;
unsigned long lastPixelWalkMs = 0;
const unsigned long pixelWalkStepMs = 20;   // time per pixel
enum WalkColor { WALK_RED, WALK_GREEN, WALK_BLUE };
WalkColor walkColor = WALK_RED;

uint8_t scale(uint8_t v) {
  return (uint16_t)v * TEST_BRIGHTNESS / 255;
}

void setAll(uint8_t r, uint8_t g, uint8_t b) {
  r = scale(r);
  g = scale(g);
  b = scale(b);
  for (uint16_t i = 0; i < NUM_LEDS; i++)
    strip.setPixelColor(i, r, g, b);
}

void runPhase() {
  switch (phase) {
    case RED:
      setAll(255, 0, 0);
      break;
    case GREEN:
      setAll(0, 255, 0);
      break;
    case BLUE:
      setAll(0, 0, 255);
      break;
    case WHITE:
      setAll(255, 255, 255);
      break;
    case DARK_YELLOW:
      // Dark yellow: use low values so it looks dark, not pastel (was 130,106,33 -> looked light)
      setAll(50, 40, 12);
      break;
    case PIXEL_WALK:
      // Single pixel lit, colour depends on walkColor
      strip.clear();
      if (pixelWalkIndex < NUM_LEDS) {
        if (walkColor == WALK_RED)
          strip.setPixelColor(pixelWalkIndex, scale(255), 0, 0);
        else if (walkColor == WALK_GREEN)
          strip.setPixelColor(pixelWalkIndex, 0, scale(255), 0);
        else
          strip.setPixelColor(pixelWalkIndex, 0, 0, scale(255));
      }
      break;
    case GRADIENT: {
      for (uint16_t i = 0; i < NUM_LEDS; i++) {
        uint8_t h = (i * 256 / NUM_LEDS) & 0xFF;
        uint8_t r, g, b;
        if (h < 85) {
          r = h * 3;       g = 255 - h * 3;  b = 0;
        } else if (h < 170) {
          h -= 85;
          r = 255 - h * 3; g = 0;            b = h * 3;
        } else {
          h -= 170;
          r = 0;           g = h * 3;        b = 255 - h * 3;
        }
        strip.setPixelColor(i, scale(r), scale(g), scale(b));
      }
      break;
    }
    default:
      break;
  }
  strip.show();
}

void setup() {
  Serial.begin(115200);
  strip.begin();
  strip.setBrightness(255);
  phaseStart = millis();
  lastPixelWalkMs = millis();
  runPhase();
  Serial.println("DotStar test: Red -> Green -> Blue -> White -> Dark yellow -> Pixel walk (all pixels) -> Gradient");
}

void loop() {
  unsigned long now = millis();

  if (phase == PIXEL_WALK) {
    // Step through every pixel; advance every pixelWalkStepMs
    if (now - lastPixelWalkMs >= pixelWalkStepMs) {
      lastPixelWalkMs = now;
      pixelWalkIndex++;
      if (pixelWalkIndex >= NUM_LEDS) {
        pixelWalkIndex = 0;
        walkColor = (WalkColor)((walkColor + 1) % 3);
        if (walkColor == WALK_RED) {
          // Finished full pass (red, green, blue); go to next phase
          phase = (TestPhase)((phase + 1) % _COUNT);
          phaseStart = now;
        }
      }
      runPhase();
    }
    return;
  }

  if (now - phaseStart >= phaseDurationMs) {
    phase = (TestPhase)((phase + 1) % _COUNT);
    phaseStart = now;
    if (phase == PIXEL_WALK) {
      pixelWalkIndex = 0;
      walkColor = WALK_RED;
      lastPixelWalkMs = now;
    }
    runPhase();
  }
}
