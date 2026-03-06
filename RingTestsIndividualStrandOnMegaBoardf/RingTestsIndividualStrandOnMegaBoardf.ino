#include <FastLED.h>
//pin 2 done
//pin 4 done
//pin 0 done
//pin 1 done
//pin 3 done
//pin 5 done
//pin 6 done
//pin 7 done
//pin 8 done

#define DATA_PIN 10
#define CLK_PIN  9
#define NUM_NODES 10
#define LEDS_PER_NODE 30
#define NUM_LEDS (NUM_NODES * LEDS_PER_NODE)

#define BRIGHTNESS 15
#define COLOR_ORDER BGR   // change to RGB if colors are swapped

// Node layout (your physical order)
#define OUTER_COUNT  15
#define MIDDLE_COUNT 10
#define INNER_COUNT  5

CRGB leds[NUM_LEDS];

static inline uint16_t baseOfNode(uint8_t node) {
  return (uint16_t)node * (uint16_t)LEDS_PER_NODE;
}

void setNodeRings(uint8_t node, const CRGB& outer, const CRGB& middle, const CRGB& inner) {
  uint16_t base = baseOfNode(node);

  // Outer ring: first 15 LEDs [0..14]
  for (uint8_t i = 0; i < OUTER_COUNT; i++) {
    leds[base + i] = outer;
  }

  // Middle ring: next 10 LEDs [15..24]
  for (uint8_t i = 0; i < MIDDLE_COUNT; i++) {
    leds[base + OUTER_COUNT + i] = middle;
  }

  // Inner ring: last 5 LEDs [25..29]
  for (uint8_t i = 0; i < INNER_COUNT; i++) {
    leds[base + OUTER_COUNT + MIDDLE_COUNT + i] = inner;
  }
}

void setup() {
  FastLED.addLeds<SK9822, DATA_PIN, CLK_PIN, COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(BRIGHTNESS);
  FastLED.clear(true);

  // Set all nodes: Outer=B, Middle=G, Inner=R
  for (uint8_t n = 0; n < NUM_NODES; n++) {
    setNodeRings(n,
                CRGB(0, 0, 255),   // outer = blue
                CRGB(0, 255, 0),   // middle = green
                CRGB(255, 0, 0));  // inner = red
  }

  FastLED.show();
}

void loop() {
  // Static test (no animation)
}