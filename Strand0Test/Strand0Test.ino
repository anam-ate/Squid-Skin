/*
 * Single-strand test: strand 0 only (small nodes).
 * DATA = pin 0, CLK = pin 9.
 * Each node: inner ring (5 LEDs) = blue, middle (10) = green, outer (15) = red.
 * Overall brightness 30/255.
 */

#include <Arduino.h>
#include <FastLED.h>

#define DATA_PIN  0
#define CLOCK_PIN 9

// Small node: inner=5, middle=10, outer=15
#define INNER_LEDS  5
#define MIDDLE_LEDS 10
#define OUTER_LEDS  15
#define LEDS_PER_NODE (INNER_LEDS + MIDDLE_LEDS + OUTER_LEDS)  // 30

#define NODES_ON_STRAND  10
#define NUM_LEDS         (NODES_ON_STRAND * LEDS_PER_NODE)     // 300

#define MAX_BRIGHTNESS 30   // 30/255

CRGB leds[NUM_LEDS];

void setup() {
  FastLED.addLeds<SK9822, DATA_PIN, CLOCK_PIN, BGR>(leds, NUM_LEDS);
  FastLED.setBrightness(30);   // we scale colour in code to 30/255

  // Fill: each node → inner=blue, middle=green, outer=red
  for (uint16_t n = 0; n < NODES_ON_STRAND; n++) {
    uint16_t base = n * LEDS_PER_NODE;

    // Inner ring (first 5 LEDs) = blue
    for (uint8_t i = 0; i < INNER_LEDS; i++) {
      leds[base + i] = CRGB(0, 0, MAX_BRIGHTNESS);
    }
    base += INNER_LEDS;

    // Middle ring (next 10 LEDs) = green
    for (uint8_t i = 0; i < MIDDLE_LEDS; i++) {
      leds[base + i] = CRGB(0, MAX_BRIGHTNESS, 0);
    }
    base += MIDDLE_LEDS;

    // Outer ring (last 15 LEDs) = red
    for (uint8_t i = 0; i < OUTER_LEDS; i++) {
      leds[base + i] = CRGB(MAX_BRIGHTNESS, 0, 0);
    }
  }

  FastLED.show();
}

void loop() {
  // Static pattern; nothing to do.
  delay(100);
}
