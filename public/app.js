const canvas = document.getElementById('squid-canvas');
const ctx = canvas.getContext('2d');
const audioViz = document.getElementById('audio-viz');
const audioVizCtx = audioViz ? audioViz.getContext('2d') : null;
const noiseViz = document.getElementById('noise-viz');
const noiseVizCtx = noiseViz ? noiseViz.getContext('2d') : null;

const controls = {
  maxBrightness: document.getElementById('max-brightness'),
  maxBrightnessValue: document.getElementById('max-brightness-value'),
  spiralMode: document.getElementById('spiral-mode'),
  spiralWidth: document.getElementById('spiral-width'),
  spiralWidthValue: document.getElementById('spiral-width-value'),
  spiralSpeed: document.getElementById('spiral-speed'),
  spiralSpeedValue: document.getElementById('spiral-speed-value'),
  spiralDirMix: document.getElementById('spiral-dir-mix'),
  spiralDirMixValue: document.getElementById('spiral-dir-mix-value'),
  screenBrightness: document.getElementById('screen-brightness'),
  screenBrightnessValue: document.getElementById('screen-brightness-value'),
  previewNodeScale: document.getElementById('preview-node-scale'),
  previewNodeScaleValue: document.getElementById('preview-node-scale-value'),
  noiseScale: document.getElementById('noise-scale'),
  noiseScaleValue: document.getElementById('noise-scale-value'),
  noiseType: document.getElementById('noise-type'),
  noiseType2: document.getElementById('noise-type2'),
  noiseSpeed: document.getElementById('noise-speed'),
  noiseSpeedValue: document.getElementById('noise-speed-value'),
  blackLevel: document.getElementById('black-level'),
  blackLevelValue: document.getElementById('black-level-value'),
  noiseCutoff: document.getElementById('noise-cutoff'),
  noiseCutoffValue: document.getElementById('noise-cutoff-value'),
  noiseSmooth: document.getElementById('noise-smooth'),
  noiseSmoothValue: document.getElementById('noise-smooth-value'),
  noiseContrast: document.getElementById('noise-contrast'),
  noiseContrastValue: document.getElementById('noise-contrast-value'),
  noiseGamma: document.getElementById('noise-gamma'),
  noiseGammaValue: document.getElementById('noise-gamma-value'),
  noiseBlend: document.getElementById('noise-blend'),
  noiseBlendValue: document.getElementById('noise-blend-value'),
  effRadius: document.getElementById('eff-radius'),
  effRadiusValue: document.getElementById('eff-radius-value'),
  effStrength: document.getElementById('eff-strength'),
  effStrengthValue: document.getElementById('eff-strength-value'),
  innerColor: document.getElementById('inner-color'),
  middleColor: document.getElementById('middle-color'),
  outerColor: document.getElementById('outer-color'),
  colorVariation: document.getElementById('color-variation'),
  colorVariationValue: document.getElementById('color-variation-value'),
  effModeMouse: document.getElementById('eff-mode-mouse'),
  effModeAuto: document.getElementById('eff-mode-auto'),
  wanderSpeed: document.getElementById('wander-speed'),
  wanderSpeedValue: document.getElementById('wander-speed-value'),
  wanderCount: document.getElementById('wander-count'),
  wanderCountValue: document.getElementById('wander-count-value'),
  audioFile: document.getElementById('audio-file'),
  audioEnable: document.getElementById('audio-enable'),
  audioBlend: document.getElementById('audio-blend'),
  audioBlendValue: document.getElementById('audio-blend-value'),
  audioAmp: document.getElementById('audio-amp'),
  audioAmpValue: document.getElementById('audio-amp-value'),
  audioNeighbor: document.getElementById('audio-neighbor'),
  audioNeighborValue: document.getElementById('audio-neighbor-value'),
  audioRegionCount: document.getElementById('audio-region-count'),
  audioRegionCountValue: document.getElementById('audio-region-count-value'),
  audioDebug: document.getElementById('audio-debug'),
  audioStop: document.getElementById('audio-stop'),
  testMode: document.getElementById('test-mode'),
  dualView: document.getElementById('dual-view'),
  strandDebug: document.getElementById('strand-debug'),
  strandTestEnable: document.getElementById('strand-test-enable'),
  strandTest0: document.getElementById('strand-test-0'),
  strandTest1: document.getElementById('strand-test-1'),
  strandTest2: document.getElementById('strand-test-2'),
  strandTest3: document.getElementById('strand-test-3'),
  strandTest4: document.getElementById('strand-test-4'),
  strandTest5: document.getElementById('strand-test-5'),
  strandTest6: document.getElementById('strand-test-6'),
  strandTest7: document.getElementById('strand-test-7'),
  strandTest8: document.getElementById('strand-test-8'),
};

let nodes = [];
/** Minimum centre-to-centre distance between any two nodes (model units); used to scale ring radii on small canvases. */
let cachedMinNodeDistModel = 1;
let ws = null;
let bounds = null;
let effPx = null;
let effPy = null;
let effDragging = false;
let autoEffectors = [];
let audioCtx = null;
let audioSource = null;
let audioAnalyser = null;
let audioData = null;
let audioLevel = 0;
let audioEnv = 0;
let audioTimeData = null;
let audioLowBand = 0;
let audioMidBand = 0;
let audioHighBand = 0;
const ringState = new Map(); // key: `${pin}:${index}` -> [inner, mid, outer] smoothed brightness
let noiseTmpCanvas = null;
let noiseTmpCtx = null;

// Spectrum selection for audio drive: user can drag over the spectrum bars
// in the audio viz to choose which frequency range and amplitude range
// should influence the LEDs.
const SPECTRUM_BARS = 64;
let audioBars = new Array(SPECTRUM_BARS).fill(0); // 0..1 per visual bar for spatial modulation
let audioRegionCount = 6; // user-controlled via slider (min 3)
let audioRegions = []; // [{startBar, endBar}]
let lastRegionShuffle = 0;
const AUDIO_FIELD_W = 40;
const AUDIO_FIELD_H = 24;
let audioField = new Float32Array(AUDIO_FIELD_W * AUDIO_FIELD_H); // for neighbour bursts
const spectrumSelection = {
  startBar: 0,
  endBar: SPECTRUM_BARS - 1,
  minV: 0,   // 0..1 amplitude range (vertical)
  maxV: 1,
  dragging: false,
  anchorBar: 0,
  anchorV: 0,
};

const STORAGE_PREFIX = 'squid-ui-';

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

function rebuildAudioRegions() {
  // Split the full SPECTRUM_BARS range into contiguous segments, then
  // randomly assign those segments so different horizontal bands of
  // the canvas "listen" to different bar clusters, and this mapping
  // can change over time.
  const count = Math.max(3, audioRegionCount | 0);
  const barsPerRegion = Math.max(1, Math.floor(SPECTRUM_BARS / count));
  const segments = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const end = (i === count - 1)
      ? (SPECTRUM_BARS - 1)
      : Math.min(SPECTRUM_BARS - 1, start + barsPerRegion - 1);
    segments.push({ startBar: start, endBar: end });
    start = end + 1;
    if (start >= SPECTRUM_BARS) break;
  }
  // If we have fewer segments than regions (e.g. low bar count), repeat some.
  while (segments.length < count) {
    segments.push(segments[segments.length - 1]);
  }

  shuffleInPlace(segments);
  audioRegions = segments;
}

function persistControl(el) {
  if (!el || !el.id) return;
  try {
    if (el.type === 'checkbox' || el.type === 'radio') {
      localStorage.setItem(STORAGE_PREFIX + el.id, el.checked ? '1' : '0');
    } else if (el.type === 'range' || el.type === 'color' || el.tagName === 'SELECT') {
      localStorage.setItem(STORAGE_PREFIX + el.id, String(el.value));
    }
  } catch (_) {
    // ignore storage errors
  }
}

function restoreControl(el) {
  if (!el || !el.id) return;
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + el.id);
    if (stored == null) return;
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = stored === '1';
    } else if (el.type === 'range' || el.type === 'color' || el.tagName === 'SELECT') {
      el.value = stored;
    }
  } catch (_) {
    // ignore
  }
}

function stopAudioPlayback() {
  if (audioSource) {
    try {
      audioSource.stop();
    } catch (_) {}
    try {
      audioSource.disconnect();
    } catch (_) {}
  }
  if (audioAnalyser) {
    try {
      audioAnalyser.disconnect();
    } catch (_) {}
  }
  audioSource = null;
  audioAnalyser = null;
  audioData = null;
  audioTimeData = null;
  audioLevel = 0;
  audioEnv = 0;
}

// Resize canvas to fit container
function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function resizeAudioViz() {
  if (!audioViz || !audioVizCtx) return;
  const rect = audioViz.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  audioViz.width = Math.max(1, Math.floor(rect.width * dpr));
  audioViz.height = Math.max(1, Math.floor(rect.height * dpr));
  audioVizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resizeAudioViz);
resizeAudioViz();

function resizeNoiseViz() {
  if (!noiseViz || !noiseVizCtx) return;
  const rect = noiseViz.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  noiseViz.width = Math.max(1, Math.floor(rect.width * dpr));
  noiseViz.height = Math.max(1, Math.floor(rect.height * dpr));
  noiseVizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resizeNoiseViz);
resizeNoiseViz();

function barIndexFromX(x, width) {
  if (width <= 0) return 0;
  const t = Math.max(0, Math.min(1, x / width));
  return Math.max(0, Math.min(SPECTRUM_BARS - 1, Math.floor(t * SPECTRUM_BARS)));
}

if (audioViz) {
  audioViz.addEventListener('pointerdown', (e) => {
    const rect = audioViz.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const bar = barIndexFromX(x, rect.width);
    const vNorm = 1 - Math.max(0, Math.min(1, y / rect.height)); // 0 bottom, 1 top
    spectrumSelection.dragging = true;
    spectrumSelection.anchorBar = bar;
    spectrumSelection.anchorV = vNorm;
    spectrumSelection.startBar = bar;
    spectrumSelection.endBar = bar;
    spectrumSelection.minV = vNorm;
    spectrumSelection.maxV = vNorm;
    audioViz.setPointerCapture(e.pointerId);
  });

  audioViz.addEventListener('pointermove', (e) => {
    if (!spectrumSelection.dragging) return;
    const rect = audioViz.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const bar = barIndexFromX(x, rect.width);
    const vNorm = 1 - Math.max(0, Math.min(1, y / rect.height));

    if (bar >= spectrumSelection.anchorBar) {
      spectrumSelection.startBar = spectrumSelection.anchorBar;
      spectrumSelection.endBar = bar;
    } else {
      spectrumSelection.startBar = bar;
      spectrumSelection.endBar = spectrumSelection.anchorBar;
    }

    spectrumSelection.minV = Math.min(spectrumSelection.anchorV, vNorm);
    spectrumSelection.maxV = Math.max(spectrumSelection.anchorV, vNorm);
  });

  const stopDrag = (e) => {
    if (!spectrumSelection.dragging) return;
    spectrumSelection.dragging = false;
    try {
      audioViz.releasePointerCapture(e.pointerId);
    } catch (_) {
      // ignore
    }
  };

  audioViz.addEventListener('pointerup', stopDrag);
  audioViz.addEventListener('pointerleave', stopDrag);
}

canvas.addEventListener('pointerdown', (e) => {
  if (!controls.effModeMouse.checked) return;
  const rect = canvas.getBoundingClientRect();
  effDragging = true;
  effPx = e.clientX - rect.left;
  effPy = e.clientY - rect.top;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!controls.effModeMouse.checked || !effDragging) return;
  const rect = canvas.getBoundingClientRect();
  effPx = e.clientX - rect.left;
  effPy = e.clientY - rect.top;
});

canvas.addEventListener('pointerup', (e) => {
  if (!controls.effModeMouse.checked) return;
  effDragging = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch (_) {
    // ignore
  }
});

// Simple 2D noise based on pseudo-random hashing
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function hashInt(x, y) {
  // Integer-style hash derived from the same continuous hash, 0..255
  const h = hash(x, y);
  return (h * 256) | 0;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function noise2D(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const h00 = hash(xi, yi);
  const h10 = hash(xi + 1, yi);
  const h01 = hash(xi, yi + 1);
  const h11 = hash(xi + 1, yi + 1);

  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const nx0 = lerp(h00, h10, u);
  const nx1 = lerp(h01, h11, u);

  return lerp(nx0, nx1, v) * 2 - 1; // -1..1
}

function fadePerlin(t) {
  // Classic Perlin quintic fade
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad2(hash, x, y) {
  // 8 directional gradients
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function perlin2D(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const aa = hashInt(xi, yi);
  const ab = hashInt(xi + 1, yi);
  const ba = hashInt(xi, yi + 1);
  const bb = hashInt(xi + 1, yi + 1);

  const u = fadePerlin(xf);
  const v = fadePerlin(yf);

  const x1 = lerp(grad2(aa, xf, yf), grad2(ab, xf - 1, yf), u);
  const x2 = lerp(grad2(ba, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);

  // Roughly -1..1
  return lerp(x1, x2, v);
}

function sineNoise2D(x, y, t) {
  // Soft, wavy "plasma" style sine noise; deliberately simple and periodic.
  const v1 = Math.sin(x * 2.1 + t * 0.7) * Math.cos(y * 1.9 - t * 0.5);
  const v2 = Math.sin((x + y * 0.3) * 3.7 - t * 0.9);
  const v3 = Math.cos((x * 0.7 - y) * 4.3 + t * 0.4);
  // Mix a few harmonics and normalise back to roughly -1..1.
  const v = (v1 * 0.6 + v2 * 0.3 + v3 * 0.1);
  return Math.max(-1, Math.min(1, v));
}

function fbm2D(x, y) {
  // Smooth multi-octave noise for less "steppy" motion
  let amp = 0.55;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * noise2D(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return sum / Math.max(1e-5, norm); // -1..1 (ish)
}

function ridged2D(x, y) {
  // Ridged multifractal-like: sharp creases
  let amp = 0.6;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    const n = noise2D(x * freq, y * freq);
    const r = 1 - Math.abs(n); // 0..1 ridge
    sum += amp * (r * r);
    norm += amp;
    amp *= 0.5;
    freq *= 2.01;
  }
  // map 0..1 to -1..1-ish for consistency
  const v = sum / Math.max(1e-5, norm);
  return v * 2 - 1;
}

function warp2D(x, y, t) {
  // Domain warp for organic motion
  const qx = fbm2D(x + 1.7 + t * 0.15, y + 9.2);
  const qy = fbm2D(x + 8.3, y + 2.8 + t * 0.15);
  const wx = x + 0.7 * qx;
  const wy = y + 0.7 * qy;
  return fbm2D(wx, wy);
}

function sampleNoise(kind, x, y, t) {
  switch (kind) {
    case 'sine':
      return sineNoise2D(x, y, t);
    case 'perlin':
      return perlin2D(x, y);
    case 'basic':
      return noise2D(x, y);
    case 'ridged':
      return ridged2D(x, y);
    case 'warp':
      return warp2D(x, y, t);
    case 'fbm':
    default:
      return fbm2D(x, y);
  }
}

function hsvToRgb(h, s, v) {
  let r, g, b;

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 255, g: 255, b: 255 };
  let h = hex.trim();
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  const int = parseInt(h, 16);
  if (Number.isNaN(int)) return { r: 255, g: 255, b: 255 };
  return {
    r: (int >> 16) & 0xff,
    g: (int >> 8) & 0xff,
    b: int & 0xff,
  };
}

function setupControls() {
  try {
    const newKey = STORAGE_PREFIX + 'screen-brightness';
    const oldKey = STORAGE_PREFIX + 'preview-brightness';
    if (localStorage.getItem(newKey) == null && localStorage.getItem(oldKey) != null) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey));
    }
  } catch (_) {
    // ignore
  }

  // Restore persisted values first
  [
    controls.maxBrightness,
    controls.screenBrightness,
    controls.previewNodeScale,
    controls.spiralMode,
    controls.spiralWidth,
    controls.spiralSpeed,
    controls.spiralDirMix,
    controls.noiseScale,
    controls.noiseSpeed,
    controls.blackLevel,
    controls.noiseCutoff,
    controls.noiseSmooth,
    controls.noiseContrast,
    controls.noiseGamma,
    controls.effRadius,
    controls.effStrength,
    controls.wanderSpeed,
    controls.wanderCount,
    controls.innerColor,
    controls.middleColor,
    controls.outerColor,
    controls.colorVariation,
    controls.effModeMouse,
    controls.effModeAuto,
    controls.audioEnable,
    controls.audioBlend,
    controls.audioAmp,
    controls.audioNeighbor,
    controls.audioRegionCount,
    controls.audioDebug,
    controls.noiseType,
    controls.noiseType2,
    controls.noiseBlend,
  ].forEach(restoreControl);

  controls.maxBrightness.addEventListener('input', () => {
    controls.maxBrightnessValue.textContent = controls.maxBrightness.value;
    persistControl(controls.maxBrightness);
  });
  controls.spiralMode.addEventListener('change', () => {
    persistControl(controls.spiralMode);
  });
  controls.spiralWidth.addEventListener('input', () => {
    controls.spiralWidthValue.textContent = controls.spiralWidth.value;
    persistControl(controls.spiralWidth);
  });
  controls.spiralSpeed.addEventListener('input', () => {
    controls.spiralSpeedValue.textContent = (controls.spiralSpeed.value / 100).toFixed(2);
    persistControl(controls.spiralSpeed);
  });
  controls.spiralDirMix.addEventListener('input', () => {
    controls.spiralDirMixValue.textContent = (controls.spiralDirMix.value / 100).toFixed(2);
    persistControl(controls.spiralDirMix);
  });
  controls.screenBrightness.addEventListener('input', () => {
    controls.screenBrightnessValue.textContent = (controls.screenBrightness.value / 100).toFixed(2);
    persistControl(controls.screenBrightness);
  });
  controls.previewNodeScale.addEventListener('input', () => {
    controls.previewNodeScaleValue.textContent = `${controls.previewNodeScale.value}%`;
    persistControl(controls.previewNodeScale);
  });
  controls.noiseScale.addEventListener('input', () => {
    controls.noiseScaleValue.textContent = (controls.noiseScale.value / 100).toFixed(2);
    persistControl(controls.noiseScale);
  });
  controls.noiseSpeed.addEventListener('input', () => {
    controls.noiseSpeedValue.textContent = (controls.noiseSpeed.value / 100).toFixed(2);
    persistControl(controls.noiseSpeed);
  });
  controls.blackLevel.addEventListener('input', () => {
    controls.blackLevelValue.textContent = (controls.blackLevel.value / 100).toFixed(2);
    persistControl(controls.blackLevel);
  });
  controls.noiseCutoff.addEventListener('input', () => {
    controls.noiseCutoffValue.textContent = (controls.noiseCutoff.value / 100).toFixed(2);
    persistControl(controls.noiseCutoff);
  });
  controls.noiseSmooth.addEventListener('input', () => {
    controls.noiseSmoothValue.textContent = (controls.noiseSmooth.value / 100).toFixed(2);
    persistControl(controls.noiseSmooth);
  });
  controls.noiseBlend.addEventListener('input', () => {
    controls.noiseBlendValue.textContent = (controls.noiseBlend.value / 100).toFixed(2);
    persistControl(controls.noiseBlend);
  });
  controls.noiseContrast.addEventListener('input', () => {
    controls.noiseContrastValue.textContent = (controls.noiseContrast.value / 100).toFixed(2);
    persistControl(controls.noiseContrast);
  });
  controls.noiseGamma.addEventListener('input', () => {
    controls.noiseGammaValue.textContent = (controls.noiseGamma.value / 100).toFixed(2);
    persistControl(controls.noiseGamma);
  });
  controls.effRadius.addEventListener('input', () => {
    controls.effRadiusValue.textContent = (controls.effRadius.value / 100).toFixed(2);
    persistControl(controls.effRadius);
  });
  controls.effStrength.addEventListener('input', () => {
    controls.effStrengthValue.textContent = (controls.effStrength.value / 100).toFixed(2);
    persistControl(controls.effStrength);
  });

  controls.wanderSpeed.addEventListener('input', () => {
    controls.wanderSpeedValue.textContent = (controls.wanderSpeed.value / 100).toFixed(2);
    persistControl(controls.wanderSpeed);
  });
  controls.wanderCount.addEventListener('input', () => {
    controls.wanderCountValue.textContent = controls.wanderCount.value;
    if (controls.effModeAuto.checked) {
      // recreate auto effectors with new count
      autoEffectors = [];
      const count = parseInt(controls.wanderCount.value, 10) || 1;
      for (let i = 0; i < count; i++) {
        autoEffectors.push({
          x: Math.random(),
          y: Math.random(),
          vx: (Math.random() - 0.5) * 0.1,
          vy: (Math.random() - 0.5) * 0.1,
        });
      }
    }
    persistControl(controls.wanderCount);
  });

  controls.audioBlend.addEventListener('input', () => {
    controls.audioBlendValue.textContent = (controls.audioBlend.value / 100).toFixed(2);
    persistControl(controls.audioBlend);
  });
  controls.audioAmp.addEventListener('input', () => {
    controls.audioAmpValue.textContent = (controls.audioAmp.value / 100).toFixed(2);
    persistControl(controls.audioAmp);
  });
  controls.audioNeighbor.addEventListener('input', () => {
    controls.audioNeighborValue.textContent = (controls.audioNeighbor.value / 100).toFixed(2);
    persistControl(controls.audioNeighbor);
  });
  controls.audioRegionCount.addEventListener('input', () => {
    const v = Math.max(3, Math.min(12, parseInt(controls.audioRegionCount.value, 10) || 6));
    controls.audioRegionCountValue.textContent = v.toString();
    audioRegionCount = v;
    rebuildAudioRegions();
    persistControl(controls.audioRegionCount);
  });
  controls.audioDebug.addEventListener('change', () => {
    persistControl(controls.audioDebug);
  });

  controls.audioFile.addEventListener('change', async () => {
    const file = controls.audioFile.files[0];
    if (!file) return;

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    stopAudioPlayback();

    const arrayBuffer = await file.arrayBuffer();
    const buffer = await audioCtx.decodeAudioData(arrayBuffer);

    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = buffer;
    audioSource.loop = true;

    audioAnalyser = audioCtx.createAnalyser();
    audioAnalyser.fftSize = 2048;
    const len = audioAnalyser.frequencyBinCount;
    audioData = new Uint8Array(len);
    audioTimeData = new Uint8Array(audioAnalyser.fftSize);

    audioSource.connect(audioAnalyser);
    audioAnalyser.connect(audioCtx.destination);

    audioSource.start();
  });

  controls.audioStop.addEventListener('click', () => {
    stopAudioPlayback();
    controls.audioEnable.checked = false;
    persistControl(controls.audioEnable);
    // Clear file input so user knows it's stopped
    try {
      controls.audioFile.value = '';
    } catch (_) {
      // ignore
    }
  });

  const updateEffMode = () => {
    if (controls.effModeMouse.checked) {
      autoEffectors = [];
    } else {
      // create a few random auto effectors
      autoEffectors = [];
      const count = 3;
      for (let i = 0; i < count; i++) {
        autoEffectors.push({
          x: Math.random(),
          y: Math.random(),
          vx: (Math.random() - 0.5) * 0.1,
          vy: (Math.random() - 0.5) * 0.1,
        });
      }
    }
    persistControl(controls.effModeMouse);
    persistControl(controls.effModeAuto);
  };

  controls.effModeMouse.addEventListener('change', updateEffMode);
  controls.effModeAuto.addEventListener('change', updateEffMode);

  controls.colorVariation.addEventListener('input', () => {
    controls.colorVariationValue.textContent = (controls.colorVariation.value / 100).toFixed(2);
    persistControl(controls.colorVariation);
  });

  // Initialize labels
  controls.maxBrightness.dispatchEvent(new Event('input'));
  controls.spiralWidth.dispatchEvent(new Event('input'));
  controls.spiralSpeed.dispatchEvent(new Event('input'));
  controls.spiralDirMix.dispatchEvent(new Event('input'));
  controls.screenBrightness.dispatchEvent(new Event('input'));
  controls.previewNodeScale.dispatchEvent(new Event('input'));
  controls.noiseScale.dispatchEvent(new Event('input'));
  controls.noiseSpeed.dispatchEvent(new Event('input'));
  controls.blackLevel.dispatchEvent(new Event('input'));
  controls.noiseCutoff.dispatchEvent(new Event('input'));
  controls.noiseSmooth.dispatchEvent(new Event('input'));
  controls.noiseBlend.dispatchEvent(new Event('input'));
  controls.noiseContrast.dispatchEvent(new Event('input'));
  controls.noiseGamma.dispatchEvent(new Event('input'));
  controls.effRadius.dispatchEvent(new Event('input'));
  controls.effStrength.dispatchEvent(new Event('input'));
  controls.effModeMouse.checked = true;
  controls.effModeAuto.checked = false;
  controls.effModeMouse.dispatchEvent(new Event('change'));
  controls.wanderSpeed.dispatchEvent(new Event('input'));
  controls.wanderCount.dispatchEvent(new Event('input'));
  controls.audioBlend.dispatchEvent(new Event('input'));
  controls.audioAmp.dispatchEvent(new Event('input'));
  controls.audioNeighbor.dispatchEvent(new Event('input'));
  controls.audioRegionCount.dispatchEvent(new Event('input'));
  controls.audioDebug.dispatchEvent(new Event('change'));
  controls.colorVariation.dispatchEvent(new Event('input'));
}

setupControls();

function recomputeMinNodeDistModel(nodeList) {
  const n = nodeList.length;
  if (n < 2) {
    cachedMinNodeDistModel = 1;
    return;
  }
  let m = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = nodeList[i].x - nodeList[j].x;
      const dy = nodeList[i].y - nodeList[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-8 && d < m) m = d;
    }
  }
  cachedMinNodeDistModel = m === Infinity ? 1 : m;
}

async function loadNodes() {
  const res = await fetch('/pin_nodes.json');
  const json = await res.json();

  const smallPins = json.pins.small || {};
  const largePins = json.pins.large || {};

  const all = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  function pushNodes(pinGroup, type) {
    for (const pinKey of Object.keys(pinGroup)) {
      const list = pinGroup[pinKey];
      const pinIndex = parseInt(pinKey.replace('PIN_', ''), 10);
      for (const node of list) {
        const pos = node.normalizedPositionUniform || node.normalizedPosition || node.centeredPosition;
        const x = pos[0];
        const y = pos[1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        all.push({
          pin: pinIndex,
          index: node.index,
          type,
          x,
          y,
          ringSizes: node.ringSizes,
          phaseSeed: Math.random() * Math.PI * 2,
          spiralDir: Math.random() < 0.5 ? 1 : -1,
        });
      }
    }
  }

  pushNodes(smallPins, 'small');
  pushNodes(largePins, 'large');

  bounds = { minX, maxX, minY, maxY };
  nodes = all;
  recomputeMinNodeDistModel(all);
}

/** Bumped on each new connection attempt so stale sockets do not double-reconnect. */
let wsSession = 0;

function setupWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${window.location.host}/frames`;
  const session = ++wsSession;

  const prev = ws;
  ws = null;
  if (prev) {
    prev.onopen = null;
    prev.onclose = null;
    prev.onerror = null;
    try {
      if (prev.readyState === WebSocket.OPEN || prev.readyState === WebSocket.CONNECTING) {
        prev.close();
      }
    } catch (_) {
      // ignore
    }
  }

  const socket = new WebSocket(url);
  ws = socket;

  socket.onopen = () => {
    if (session !== wsSession) return;
    console.log('WebSocket connected');
  };
  socket.onclose = () => {
    if (session !== wsSession) return;
    console.log('WebSocket disconnected');
    setTimeout(() => {
      if (session === wsSession) setupWebSocket();
    }, 1200);
  };
  socket.onerror = () => {
    // Reconnect via onclose
  };
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  setupWebSocket();
});

let lastTime = performance.now();
let timeAccum = 0;
let frameId = 0;

function renderFrame(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  timeAccum += dt;

  // Periodically reshuffle which canvas regions listen to which parts
  // of the spectrum so the music "moves" through the squid over time.
  if (now - lastRegionShuffle > 10000) { // ~every 10s
    rebuildAudioRegions();
    lastRegionShuffle = now;
  }

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  // Keep canvas drawing buffer in sync with display size so the grid is visible
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  ctx.clearRect(0, 0, w, h);

  if (!nodes.length || !bounds) {
    requestAnimationFrame(renderFrame);
    return;
  }

  if (w <= 0 || h <= 0) {
    requestAnimationFrame(renderFrame);
    return;
  }

  const globalBrightness = Math.max(0, Math.min(60, parseInt(controls.maxBrightness.value, 10) || 60));
  const speed = 0.6; // fixed global animation speed
  const noiseScale = controls.noiseScale.value / 100;
  const noiseSpeed = controls.noiseSpeed.value / 100;
  const noiseType = controls.noiseType.value;
  const noiseType2 = controls.noiseType2.value;
  const noiseBlend = controls.noiseBlend.value / 100;
  const blackLevel = controls.blackLevel.value / 100;
  const noiseCutoff = controls.noiseCutoff.value / 100;
  const noiseSmooth = controls.noiseSmooth.value / 100;
  const noiseContrast = controls.noiseContrast.value / 100;
  const noiseGamma = controls.noiseGamma.value / 100;
  const effRadius = controls.effRadius.value / 100;
  const effStrength = controls.effStrength.value / 100;

  const t = timeAccum * speed * 2 * Math.PI;
  const tNoise = timeAccum * noiseSpeed;

  const minX = bounds.minX;
  const maxX = bounds.maxX;
  const minY = bounds.minY;
  const maxY = bounds.maxY;
  const spanX = Math.max(1e-5, maxX - minX);
  const spanY = Math.max(1e-5, maxY - minY);
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;

  const dualViewEnabled = controls.dualView && controls.dualView.checked;
  const wView = dualViewEnabled ? w / 2 : w;
  const scale = Math.min(wView / spanX, h / spanY) * 0.9;
  const minSepPx = Math.max(4, cachedMinNodeDistModel * scale);
  const smallBaseRadiusRef = 9;
  const largeBaseRadiusRef = smallBaseRadiusRef * (60 / 42);
  const ringRadiusMul = 0.5 + 2 * 0.6;
  const maxOuterRingPxRef = largeBaseRadiusRef * ringRadiusMul;
  const autoNodeRadiusScale = Math.min(1.35, Math.max(0.22, (minSepPx * 0.36) / maxOuterRingPxRef));
  const previewNodeScalePct = controls.previewNodeScale
    ? Math.max(50, Math.min(300, parseInt(controls.previewNodeScale.value, 10) || 100))
    : 100;
  const nodeRadiusScale = autoNodeRadiusScale * (previewNodeScalePct / 100);

  if (effPx === null || effPy === null) {
    effPx = w * 0.5;
    effPy = h * 0.5;
  }

  const innerBaseColor = hexToRgb(controls.innerColor.value);
  const middleBaseColor = hexToRgb(controls.middleColor.value);
  const outerBaseColor = hexToRgb(controls.outerColor.value);
  const baseColors = [innerBaseColor, middleBaseColor, outerBaseColor];
  const colorVariation = controls.colorVariation.value / 100;
  const spiralEnabled = !!(controls.spiralMode && controls.spiralMode.checked);
  const spiralWidthIndices = Math.max(1, Math.min(10, parseInt(controls.spiralWidth?.value ?? '4', 10) || 4));
  const spiralSpeedNorm = controls.spiralSpeed
    ? Math.max(0.1, Math.min(2.0, (controls.spiralSpeed.value / 100)))
    : 0.8;
  const spiralDirMix = controls.spiralDirMix
    ? Math.max(0, Math.min(1, (controls.spiralDirMix.value / 100)))
    : 0.5;
  const screenBrightnessMul = controls.screenBrightness
    ? Math.max(0.25, Math.min(5.0, (controls.screenBrightness.value / 100)))
    : 1.0;

    const frameNodes = [];
  const strandDebug = new Map(); // pin -> [{ cx, cy, index }] for overlay
  const minDim = Math.min(wView, h);
  const effRadiusPx = effRadius * 0.5 * minDim;

  // Decay neighbour audio field for burst spreading between nodes
  const decay = Math.exp(-dt / 0.25); // ~250ms falloff
  for (let i = 0; i < audioField.length; i++) {
    audioField[i] *= decay;
  }
  // Noise preview (shader viz)
  if (noiseViz && noiseVizCtx) {
    const vw = noiseViz.clientWidth;
    const vh = noiseViz.clientHeight;
    noiseVizCtx.clearRect(0, 0, vw, vh);

    const gridX = 120;
    const gridY = 40;
    const img = noiseVizCtx.createImageData(gridX, gridY);
    for (let gy = 0; gy < gridY; gy++) {
      for (let gx = 0; gx < gridX; gx++) {
        const u = gx / (gridX - 1);
        const v0 = gy / (gridY - 1);

        const nPrimary = sampleNoise(
          noiseType,
          u * noiseScale * 6 + tNoise * 0.35,
          v0 * noiseScale * 6 + tNoise * 0.38,
          tNoise
        );
        let ns = nPrimary;
        if (noiseType2 !== 'none') {
          const nSecondary = sampleNoise(
            noiseType2,
            u * noiseScale * 6 + tNoise * 0.55,
            v0 * noiseScale * 6 + tNoise * 0.62,
            tNoise + 3.17
          );
          ns = lerp(nPrimary, nSecondary, noiseBlend);
        }
        let val = 0.5 + 0.5 * ns;
        val = Math.max(0, val - blackLevel);
        const gate = smoothstep(noiseCutoff, 1.0, val);
        val = gate;
        val = Math.max(0, Math.min(1, (val - 0.5) * noiseContrast + 0.5));
        val = Math.pow(val, Math.max(0.1, noiseGamma));

        const c = Math.round(val * 255);
        const idx = (gy * gridX + gx) * 4;
        img.data[idx + 0] = c;
        img.data[idx + 1] = c;
        img.data[idx + 2] = c;
        img.data[idx + 3] = 255;
      }
    }
    // Draw scaled up with smoothing
    if (!noiseTmpCanvas) {
      noiseTmpCanvas = document.createElement('canvas');
      noiseTmpCtx = noiseTmpCanvas.getContext('2d');
    }
    noiseTmpCanvas.width = gridX;
    noiseTmpCanvas.height = gridY;
    noiseTmpCtx.putImageData(img, 0, 0);
    noiseVizCtx.imageSmoothingEnabled = true;
    noiseVizCtx.drawImage(noiseTmpCanvas, 0, 0, vw, vh);

    // Overlay effector outline(s) in noise UV space
    noiseVizCtx.strokeStyle = 'rgba(244, 244, 245, 0.8)';
    noiseVizCtx.lineWidth = 1.5;
    const rUvX = (effRadiusPx / Math.max(1, minDim)) * 2; // approx radius in UV-ish
    const rPx = rUvX * vw * 0.5;
    if (controls.effModeMouse.checked) {
      // map mouse effector to viz space (approx)
      const ex = (effPx / Math.max(1, w)) * vw;
      const ey = (effPy / Math.max(1, h)) * vh;
      noiseVizCtx.beginPath();
      noiseVizCtx.arc(ex, ey, rPx, 0, Math.PI * 2);
      noiseVizCtx.stroke();
    } else {
      for (const e of autoEffectors) {
        const ex = e.x * vw;
        const ey = (1 - e.y) * vh;
        noiseVizCtx.beginPath();
        noiseVizCtx.arc(ex, ey, rPx, 0, Math.PI * 2);
        noiseVizCtx.stroke();
      }
    }
  }

  // Update audio level (0..1)
  if (controls.audioEnable.checked && audioAnalyser && audioData) {
    // Prefer frequency-domain energy; drive from user-selected spectrum region.
    audioAnalyser.getByteFrequencyData(audioData);
    if (audioTimeData) audioAnalyser.getByteTimeDomainData(audioTimeData);
    const len = audioData.length;

    // Map spectrum into a fixed number of bars and average only the
    // bars whose frequency AND height lie inside the current selection rectangle.
    let sumSel = 0;
    let countSel = 0;
    for (let b = 0; b < SPECTRUM_BARS; b++) {
      const i = Math.floor((b / SPECTRUM_BARS) * len);
      const v = audioData[i] / 255;
      if (
        b >= spectrumSelection.startBar &&
        b <= spectrumSelection.endBar &&
        v >= spectrumSelection.minV &&
        v <= spectrumSelection.maxV
      ) {
        sumSel += v;
        countSel++;
      }
    }

    let level = countSel > 0 ? (sumSel / countSel) : 0;
    level = Math.max(0, Math.min(1, level));
    // Make response a bit more "spiky" so peaks pop visually
    level = Math.pow(level, 0.6);
    audioLevel = level;

    // Split spectrum into three bands: low / mid / high.
    // Use a slightly "treble‑friendly" split so the high band
    // has a bit more energy in typical tracks:
    // - Low: ~0 .. 25%
    // - Mid: ~25% .. 60%
    // - High: ~60% .. 100%
    let lowSum = 0, midSum = 0, highSum = 0;
    let lowCount = 0, midCount = 0, highCount = 0;
    const lowEnd = Math.floor(len * 0.25);
    const midEnd = Math.floor(len * 0.60);
    for (let i = 0; i < len; i++) {
      const v = audioData[i] / 255;
      if (i < lowEnd) {
        lowSum += v;
        lowCount++;
      } else if (i < midEnd) {
        midSum += v;
        midCount++;
      } else {
        highSum += v;
        highCount++;
      }
    }
    let lowLevel = lowCount > 0 ? (lowSum / lowCount) : 0;
    let midLevel = midCount > 0 ? (midSum / midCount) : 0;
    let highLevel = highCount > 0 ? (highSum / highCount) : 0;
    // Gentle emphasis so peaks pop a little more; give high a bit
    // of extra lift so the treble bar is easier to see.
    lowLevel = Math.pow(Math.max(0, Math.min(1, lowLevel)), 0.7);
    midLevel = Math.pow(Math.max(0, Math.min(1, midLevel)), 0.7);
    highLevel = Math.pow(Math.max(0, Math.min(1, highLevel)), 0.55);

    // Smooth the band levels so each ring fades nicely
    const bandAttack = 1 - Math.exp(-dt / 0.03);
    const bandRelease = 1 - Math.exp(-dt / 0.12);
    const smoothBand = (current, target) => {
      if (target > current) {
        return current + (target - current) * bandAttack;
      }
      return current + (target - current) * bandRelease;
    };
    audioLowBand = smoothBand(audioLowBand, lowLevel);
    audioMidBand = smoothBand(audioMidBand, midLevel);
    audioHighBand = smoothBand(audioHighBand, highLevel);

    // Envelope follower: faster, more beat-synchronous response
    const attack = 1 - Math.exp(-dt / 0.015);  // ~15ms
    const release = 1 - Math.exp(-dt / 0.09);  // ~90ms
    if (audioLevel > audioEnv) {
      audioEnv = audioEnv + (audioLevel - audioEnv) * attack;
    } else {
      audioEnv = audioEnv + (audioLevel - audioEnv) * release;
    }
  } else {
    audioLevel *= 0.9;
    audioEnv *= 0.9;
    audioLowBand *= 0.9;
    audioMidBand *= 0.9;
    audioHighBand *= 0.9;
    for (let i = 0; i < SPECTRUM_BARS; i++) {
      audioBars[i] *= 0.9;
    }
  }

  // Ensure audio regions exist (in case audio just turned on)
  if (!audioRegions.length) {
    rebuildAudioRegions();
  }

  // Draw audio viz (spectrum + waveform + "curve")
  if (audioViz && audioVizCtx) {
    const vw = audioViz.clientWidth;
    const vh = audioViz.clientHeight;
    audioVizCtx.clearRect(0, 0, vw, vh);

    // waveform underlay
    if (controls.audioEnable.checked && audioTimeData) {
      audioVizCtx.beginPath();
      for (let i = 0; i < audioTimeData.length; i++) {
        const x = (i / (audioTimeData.length - 1)) * vw;
        const y = (audioTimeData[i] / 255) * vh;
        if (i === 0) audioVizCtx.moveTo(x, y);
        else audioVizCtx.lineTo(x, y);
      }
      audioVizCtx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      audioVizCtx.lineWidth = 1;
      audioVizCtx.stroke();
    }

    // spectrum
    if (controls.audioEnable.checked && audioData) {
      const bars = SPECTRUM_BARS;
      for (let b = 0; b < bars; b++) {
        const i = Math.floor((b / bars) * audioData.length);
        const v = audioData[i] / 255;
        audioBars[b] = v;
        const x = (b / bars) * vw;
        const bw = (vw / bars) * 0.9;
        const bh = v * vh;
        const inBarRange = (b >= spectrumSelection.startBar && b <= spectrumSelection.endBar);
        const inHeightRange = (v >= spectrumSelection.minV && v <= spectrumSelection.maxV);
        const selected = inBarRange && inHeightRange;
        audioVizCtx.fillStyle = selected
          ? 'rgba(129, 140, 248, 0.95)'
          : 'rgba(99, 102, 241, 0.25)';
        audioVizCtx.fillRect(x, vh - bh, bw, bh);
      }

      // Draw selection rectangle overlay
      const selStart = spectrumSelection.startBar / bars * vw;
      const selEnd = (spectrumSelection.endBar + 1) / bars * vw;
      const selWidth = Math.max(2, selEnd - selStart);
      const selTop = (1 - spectrumSelection.maxV) * vh;
      const selBottom = (1 - spectrumSelection.minV) * vh;
      const selHeight = Math.max(2, selBottom - selTop);
      audioVizCtx.strokeStyle = 'rgba(244, 244, 245, 0.85)';
      audioVizCtx.lineWidth = 1.5;
      audioVizCtx.strokeRect(selStart, selTop, selWidth, selHeight);
      audioVizCtx.fillStyle = 'rgba(59, 130, 246, 0.08)';
      audioVizCtx.fillRect(selStart, selTop, selWidth, selHeight);
    }

    // Current overall envelope level as a top bar
    audioVizCtx.fillStyle = 'rgba(34, 197, 94, 0.9)';
    audioVizCtx.fillRect(0, 0, vw * audioEnv, 3);
  }

  if (!controls.effModeMouse.checked) {
    // Update auto effectors in UV space
    const dtClamped = Math.min(dt, 0.05);
    const speedFactor = controls.wanderSpeed.value / 100;
    for (const e of autoEffectors) {
      e.x += e.vx * dtClamped * speedFactor;
      e.y += e.vy * dtClamped * speedFactor;
      if (e.x < 0 || e.x > 1) e.vx *= -1;
      if (e.y < 0 || e.y > 1) e.vy *= -1;
      e.x = Math.max(0, Math.min(1, e.x));
      e.y = Math.max(0, Math.min(1, e.y));
    }
  }

  const bandLevels = [audioLowBand, audioMidBand, audioHighBand];
  const audioAmp = controls.audioAmp.value / 100; // 0.5..3.0
  const audioDrive = controls.audioEnable.checked ? audioEnv : 0; // global envelope for feel
  const audioBlend = controls.audioBlend.value / 100; // 0..1 (fade out noise, more audio)

  // Approximate per-node LED counts for preview (matches Teensy-side layout):
  // small node = 30 LEDs: inner 5, middle 10, outer 15
  // large node = 44 LEDs: inner 8, middle 14, outer 22
  const RING_LED_COUNTS_SMALL = [5, 10, 15];   // [inner, middle, outer]
  const RING_LED_COUNTS_LARGE = [8, 14, 22];   // [inner, middle, outer]

  for (const n of nodes) {
    const nx = (n.x - minX) / spanX;
    const ny = (n.y - minY) / spanY;
    const key = `${n.pin}:${n.index}`;
    let smoothArr = ringState.get(key);
    if (!smoothArr) {
      smoothArr = [0, 0, 0, 0];
      ringState.set(key, smoothArr);
    }

    // Screen-space: back = unmirrored, front = mirrored. Effector uses back position.
    const cxBack = wView * 0.5 + (n.x - centerX) * scale;
    const cxFront = wView + (wView - cxBack);
    const cyScreen = h * 0.5 - (n.y - centerY) * scale;
    const cxScreen = cxBack; // for effector distance (back view)

    // Collect positions for strand overlay (same x as draw position so labels sit on nodes)
    const cxForOverlay = dualViewEnabled ? cxBack : (w - cxBack);
    let list = strandDebug.get(n.pin);
    if (!list) { list = []; strandDebug.set(n.pin, list); }
    list.push({ cx: cxForOverlay, cy: cyScreen, index: n.index });

    // Shared effector strength for this node (0..1), computed in screen space
    let effTotal = 0;
    if (controls.effModeMouse.checked) {
      const dx = cxScreen - effPx;
      const dy = cyScreen - effPy;
      const d = Math.sqrt(dx * dx + dy * dy);
      effTotal = 1 - smoothstep(0, effRadiusPx, d);
    } else {
      for (const e of autoEffectors) {
        const ex = e.x * w;
        const ey = (1 - e.y) * h;
        const dx = cxScreen - ex;
        const dy = cyScreen - ey;
        const d = Math.sqrt(dx * dx + dy * dy);
        const eff = 1 - smoothstep(0, effRadiusPx, d);
        effTotal = Math.max(effTotal, eff);
      }
    }

    // Map this node into an "audio region" so different parts of the canvas
    // listen to different bar clusters, and those assignments reshuffle over time.
    let barLevelNode = 0;
    if (controls.audioEnable.checked && audioRegions.length) {
      const idx = Math.max(0, Math.min(audioRegions.length - 1, Math.floor(nx * audioRegions.length)));
      const region = audioRegions[idx];
      if (region) {
        let sum = 0;
        let count = 0;
        for (let b = region.startBar; b <= region.endBar; b++) {
          const v = audioBars[b] || 0;
          sum += v;
          count++;
        }
        if (count > 0) {
          barLevelNode = Math.max(0, Math.min(1, sum / count));
        }
      }
    }

    // Sample neighbour burst field for this node and remember the index
    // so we can inject new bursts from loud peaks later in the loop.
    const fx = Math.max(0, Math.min(AUDIO_FIELD_W - 1, Math.floor(nx * AUDIO_FIELD_W)));
    const fy = Math.max(0, Math.min(AUDIO_FIELD_H - 1, Math.floor((1 - ny) * AUDIO_FIELD_H)));
    const fieldIdx = fy * AUDIO_FIELD_W + fx;
    const neighborSample = audioField[fieldIdx] || 0;
    // Smooth bar-driven level per node so region reshuffles don't cause
    // harsh jumps in brightness; this acts like a gentle low‑pass over
    // ~1 second.
    if (controls.audioEnable.checked) {
      const tauBar = 1.0; // seconds
      const aBar = 1 - Math.exp(-dt / Math.max(1e-5, tauBar));
      const prevBar = smoothArr[3] ?? barLevelNode;
      const smoothed = prevBar + (barLevelNode - prevBar) * aBar;
      smoothArr[3] = smoothed;
      barLevelNode = smoothed;
    } else {
      smoothArr[3] *= 0.9;
    }

    // Strand test: when enabled, only checked strands light using inner/middle/outer ring colours; others stay off.
    const rings = [];
    const strandTestActive = controls.strandTestEnable?.checked;
    if (strandTestActive) {
      const inner = innerBaseColor;
      const middle = middleBaseColor;
      const outer = outerBaseColor;
      const checked = controls[`strandTest${n.pin}`]?.checked;
      const scalePreview = (globalBrightness / 60) * screenBrightnessMul;
      const base = [inner, middle, outer];
      for (let k = 0; k < 3; k++) {
        const c = base[k];
        const r = checked ? Math.min(255, Math.round(c.r)) : 0;
        const g = checked ? Math.min(255, Math.round(c.g)) : 0;
        const b = checked ? Math.min(255, Math.round(c.b)) : 0;
        rings.push({
          r, g, b,
          pr: Math.round(Math.min(255, r * scalePreview)),
          pg: Math.round(Math.min(255, g * scalePreview)),
          pb: Math.round(Math.min(255, b * scalePreview)),
        });
      }
    } else if (controls.testMode && controls.testMode.checked) {
      const inner = innerBaseColor;
      const middle = middleBaseColor;
      const outer = outerBaseColor;
      const scalePreview = (globalBrightness / 60) * screenBrightnessMul;
      for (let k = 0; k < 3; k++) {
        const base = [inner, middle, outer][k];
        const sr = Math.min(255, Math.round(base.r));
        const sg = Math.min(255, Math.round(base.g));
        const sb = Math.min(255, Math.round(base.b));
        rings.push({
          r: sr, g: sg, b: sb,
          pr: Math.round(Math.min(255, sr * scalePreview)),
          pg: Math.round(Math.min(255, sg * scalePreview)),
          pb: Math.round(Math.min(255, sb * scalePreview)),
        });
      }
    } else {
    // Base chromatophore pulse per ring (inner leads outer) or spiral node mode.
    // Use per-node randomness (derived from phaseSeed) for palette choice and spiral phase.
    const nodeRand = (n.phaseSeed / (Math.PI * 2)) % 1;
    let nodePalette;
    if (spiralEnabled) {
      // In spiral mode, treat the node as a whole: pick a single colour
      // from the three ring colours and apply it to all rings.
      const poolIndex = Math.floor(nodeRand * 3) % 3;
      const chosen = baseColors[poolIndex];
      nodePalette = [chosen, chosen, chosen];
    } else {
      const useFlippedPalette = nodeRand < colorVariation;
      nodePalette = useFlippedPalette
        ? [outerBaseColor, middleBaseColor, innerBaseColor]  // flipped: inner<-outer, outer<-inner
        : baseColors;
    }

    // Precompute per-node spiral parameters when enabled
    let totalNodeLeds = 0;
    let ringOffsets = [0, 0, 0];
    if (spiralEnabled) {
      const fallbackSmall = [5, 10, 15];
      const fallbackLarge = [8, 14, 22];
      const rs = (n.ringSizes && n.ringSizes.length === 3)
        ? n.ringSizes
        : (n.type === 'small' ? fallbackSmall : fallbackLarge);
      const r0 = rs[0] || 0;
      const r1 = rs[1] || 0;
      const r2 = rs[2] || 0;
      ringOffsets = [0, r0, r0 + r1];
      totalNodeLeds = r0 + r1 + r2;
      if (totalNodeLeds <= 0) {
        totalNodeLeds = (n.type === 'small') ? 30 : 44;
      }
    }

    for (let k = 0; k < 3; k++) {
      const phaseOffset = k * 0.8;

    const nPrimary = sampleNoise(
      noiseType,
      nx * noiseScale * 6 + tNoise * 0.35 + k * 11.3,
      ny * noiseScale * 6 + tNoise * 0.38 + k * 7.9,
      tNoise + k * 0.07
    );
    let ns = nPrimary;
    if (noiseType2 !== 'none') {
      const nSecondary = sampleNoise(
        noiseType2,
        nx * noiseScale * 6 + tNoise * 0.55 + k * 5.1,
        ny * noiseScale * 6 + tNoise * 0.62 + k * 3.7,
        tNoise + k * 0.31
      );
      ns = lerp(nPrimary, nSecondary, noiseBlend);
    }
      let vRaw = 0.5 + 0.5 * ns; // 0..1
      vRaw = Math.max(0, vRaw - blackLevel);
      // Gate: allows true "off" (0) based on shader
      const vGate = smoothstep(noiseCutoff, 1.0, vRaw);
      let v = vGate;
      // Add contrast + gamma for punchier look without quantization
      v = Math.max(0, Math.min(1, (v - 0.5) * noiseContrast + 0.5));
      v = Math.pow(v, Math.max(0.1, noiseGamma));

      // Sequenced effector influence: inner ring lights first, then middle, then outer,
      // and fades back out in the reverse order as the effector moves away.
      const ringStart = 0.18 * k; // inner starts earliest, outer latest
      const ringGate = smoothstep(ringStart, 1.0, effTotal); // 0..1 for this ring
      const effRing = effTotal * ringGate;

      // Base "noise + effector" brightness for this ring, no audio yet.
      // This is the pure noise layer we always want available so the
      // Audio↔Noise blend slider can genuinely crossfade between them.
      const baseNoise = Math.max(0, Math.min(1, (v + effRing * effStrength))) * vGate;
      let brightnessNoise = baseNoise;

      // Use the height of the audio bars driving this node to decide
      // how many rings are "allowed" to light from the *audio* side:
      // low values favour only the inner ring, higher values progressively
      // enable middle and outer rings. This should *not* kill the noise
      // layer, only scale the audio contribution.
      let ringLayer = 1;
      if (controls.audioEnable.checked) {
        // Higher audioAmp makes it easier for outer rings to join in.
        const layerStep = 0.35 / Math.max(0.5, audioAmp); // how much extra bar height to include each outer ring
        ringLayer = Math.max(
          0,
          Math.min(1, (barLevelNode - layerStep * k) / Math.max(1e-5, layerStep))
        );
      }

      // Per-ring audio drive: inner = low, middle = mid, outer = high.
      let ringAudio = 0;
      if (controls.audioEnable.checked) {
        const bandLevel = bandLevels[k] || 0;
        // Simple global audioAmp so each band contributes proportionally
        // to its level, without extra per-band sliders.
        const bandGain = Math.pow(audioAmp, 1.1);
        const base = bandLevel * bandGain;
        // Modulate by the bar under this node so audio energy moves across
        // the canvas instead of all nodes pulsing identically.
        const spatial = 0.4 + 0.6 * barLevelNode; // keep some global + local variation
        ringAudio = Math.max(0, Math.min(1, base * spatial));
      }

      // Audio gain combines a per-ring band with the global envelope for feel.
      const audioGainInstant = ringAudio;
      const audioGainEnv = audioDrive;
      const audioGain = Math.max(audioGainInstant, audioGainEnv); // 0..1

      const noiseWeight = 1 - audioBlend;  // when 1: all noise, when 0: all audio
      const audioWeight = audioBlend;

      // Emphasize audio mostly where noise is already bright ("white" areas),
      // so you clearly see the music riding on top of the noise pattern.
      const hotspot = Math.pow(brightnessNoise, 0.7); // 0..1

      // Drive local pulse speed from audio * hotspot so bright noise regions
      // visibly speed up and slow down in time with the bar heights.
      const pulseSpeed = 0.7 + 2.0 * audioBlend * audioGain * hotspot; // base + audio-driven
      const basePulse = 0.5 + 0.5 * Math.sin(t * pulseSpeed + phaseOffset + n.phaseSeed);

      // At quiet moments, pixels dim; on strong beats, they swell more in those regions.
      const audioScale = 0.3 + 2.0 * audioGain * hotspot; // ~0.3..2.3
      const audioComponent = brightnessNoise * audioScale * ringLayer;
      // Neighbour boost: very loud nodes push an impulse into a coarse
      // field so nearby nodes in the same area also flare up briefly.
      const neighborStrength = controls.audioNeighbor.value / 100;
      const neighborBoost = neighborStrength * neighborSample * audioAmp;
      let brightnessMixed = baseNoise * noiseWeight + (audioComponent + neighborBoost) * audioWeight;
      brightnessMixed = Math.max(0, Math.min(1, brightnessMixed));

      // Temporal smoothing for nicer fades. Where audio & hotspot are strong and
      // blend is high, shorten tau so LEDs react more tightly to the bar changes.
      const tauBase = 0.02 + (noiseSmooth * 0.35); // seconds (lower=snappier, higher=smoother)
      const tauScale = 1 - 0.7 * audioBlend * hotspot; // 1..0.3-ish
      const tau = tauBase * Math.max(0.25, tauScale);
      const a = 1 - Math.exp(-dt / Math.max(1e-5, tau));
      smoothArr[k] = smoothArr[k] + (brightnessMixed - smoothArr[k]) * a;
      const brightnessSmooth = smoothArr[k];

      const base = nodePalette[k];
      // Colours for hardware: 0–255 exactly (no global brightness here; it goes in packet header).
      const r = Math.min(255, Math.round(base.r * brightnessSmooth));
      const g = Math.min(255, Math.round(base.g * brightnessSmooth));
      const b = Math.min(255, Math.round(base.b * brightnessSmooth));
      // Preview colours: match LED global cap, then apply screen-only boost (not sent to Teensy).
      const previewScale = (globalBrightness / 60) * screenBrightnessMul;
      rings.push({
        r, g, b,
        pr: Math.round(Math.min(255, base.r * brightnessSmooth * previewScale)),
        pg: Math.round(Math.min(255, base.g * brightnessSmooth * previewScale)),
        pb: Math.round(Math.min(255, base.b * brightnessSmooth * previewScale)),
      });

      // Inject bursts for neighbours only from the innermost ring (k === 0)
      // so strong peaks spread outward in that region but don't over‑flatten
      // the whole canvas.
      if (k === 0 && controls.audioEnable.checked) {
        const src = ringAudio * ringLayer * brightnessMixed;
        if (src > audioField[fieldIdx]) {
          audioField[fieldIdx] = src;
        }
      }
    }
    }

    // Draw to canvas: dual view = back (left) + front (right); single view = front (mirrored) only, in 0..w
    const cxFrontMirrored = w - cxBack; // front view mirrored in full canvas (0..w)
    const drawXs = dualViewEnabled ? [cxBack, cxFront] : [cxFrontMirrored];
    const isSmall = n.type === 'small';
    const baseRadius = (isSmall ? smallBaseRadiusRef : largeBaseRadiusRef) * nodeRadiusScale;

    for (const cxDraw of drawXs) {
      if (spiralEnabled) {
        // In spiral node mode, visualise individual LED indices as small dots
        // with a sequential spiral trail that matches the Teensy behaviour.
        const ringCounts = isSmall ? RING_LED_COUNTS_SMALL : RING_LED_COUNTS_LARGE;
        const perNodeLeds = isSmall ? 30 : 44;
        const ringOffsets = isSmall ? [0, 5, 15] : [0, 8, 22];
        // Deterministic per-node direction using a simple hash of strand+node index,
        // mixed with the spiralDirMix slider so you can choose how much of the
        // canvas runs reverse vs forward spirals.
        const strand = n.pin | 0;
        const nodeIdx = n.index | 0;
        let h = (((strand * 1103515245) >>> 0) + ((nodeIdx * 12345) >>> 0) + 1) >>> 0;
        h = (h >>> 8) & 0xffff;
        const rndDir = h / 65535;
        const dir = rndDir < spiralDirMix ? -1 : 1;
        const nodeRand = rndDir;
        const headFloat = (timeAccum * perNodeLeds * 0.6 * spiralSpeedNorm * dir) + nodeRand * perNodeLeds;
        let head = headFloat % perNodeLeds;
        if (head < 0) head += perNodeLeds;
        const width = spiralWidthIndices;
        const dotRadius = Math.max(1.2, baseRadius * 0.24);

        for (let k = 2; k >= 0; k--) {
          const ring = rings[k];
          const radius = baseRadius * (0.5 + k * 0.6);
          const ledCount = ringCounts[k] || 0;
          if (ledCount <= 0) continue;
          const ringBase = ringOffsets[k] || 0;

          for (let i = 0; i < ledCount; i++) {
            const localIndex = ringBase + i;
            let delta = localIndex - head;
            if (dir < 0) delta = -delta;
            if (delta < 0) continue;
            let d = delta;
            if (d >= perNodeLeds) d = d % perNodeLeds;
            if (d >= width) continue;

            const u = width <= 1 ? 0 : d / (width - 1);
            const falloff = 1 - u; // 1 at head, 0 at tail
            const pr = ring.pr * falloff;
            const pg = ring.pg * falloff;
            const pb = ring.pb * falloff;
            if (pr <= 0 && pg <= 0 && pb <= 0) continue;

            const angle = (i / ledCount) * Math.PI * 2 + n.phaseSeed;
            const px = cxDraw + Math.cos(angle) * radius;
            const py = cyScreen + Math.sin(angle) * radius;
            ctx.beginPath();
            ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fillStyle = `rgba(${pr.toFixed(1)}, ${pg.toFixed(1)}, ${pb.toFixed(1)}, 0.98)`;
            ctx.fill();
          }
        }
      } else {
        // Original ring-based preview
        for (let k = 2; k >= 0; k--) {
          const ring = rings[k];
          const radius = baseRadius * (0.5 + k * 0.6);

          ctx.beginPath();
          ctx.arc(cxDraw, cyScreen, radius, 0, Math.PI * 2);
          ctx.closePath();

          ctx.fillStyle = `rgba(${ring.pr}, ${ring.pg}, ${ring.pb}, 0.9)`;
          ctx.fill();
        }
      }
    }

    // Hardware expects ring order: outer, middle, inner (ring index 0 = outer on strip)
    const ringsForHW = [rings[2], rings[1], rings[0]];
    frameNodes.push({
      pin: n.pin,
      index: n.index,
      rings: ringsForHW,
    });
  }

  // Dual view: divider and labels
  if (dualViewEnabled) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Back', w / 4, 22);
    ctx.fillText('Front', (3 * w) / 4, 22);
  }

  // Draw effector outline(s)
  ctx.strokeStyle = 'rgba(244, 244, 245, 0.5)';
  ctx.lineWidth = 1.5;
  if (controls.effModeMouse && controls.effModeMouse.checked) {
    ctx.beginPath();
    ctx.arc(effPx, effPy, effRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    for (const e of autoEffectors) {
      const ex = e.x * w;
      const ey = (1 - e.y) * h;
      ctx.beginPath();
      ctx.arc(ex, ey, effRadiusPx, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Optional per-strand / per-node overlay: trajectories and labels (S0, S1… + lines)
  if (controls.strandDebug && controls.strandDebug.checked && strandDebug.size > 0) {
    ctx.save();
    ctx.lineWidth = 1.2;
    const baseFont = '10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.font = baseFont;
    ctx.textBaseline = 'top';

    for (const [pin, list] of strandDebug.entries()) {
      if (!list.length) continue;

      // Sort nodes along the strand by logical index
      const nodesSorted = list.slice().sort((a, b) => a.index - b.index);

      // Choose a distinct colour per strand
      const hue = (pin * 40) % 360;
      const stroke = `hsl(${hue}, 90%, 60%)`;
      const fill = `hsl(${hue}, 90%, 80%)`;

      // Draw trajectory line through nodes
      ctx.beginPath();
      ctx.strokeStyle = stroke;
      nodesSorted.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.cx, p.cy);
        else ctx.lineTo(p.cx, p.cy);
      });
      ctx.stroke();

      // Label nodes as 1A, 2A, ... where A/B/C... = strand letter
      const letter = String.fromCharCode('A'.charCodeAt(0) + (pin % 26));
      ctx.fillStyle = fill;
      nodesSorted.forEach((p) => {
        const label = `${p.index + 1}${letter}`;
        ctx.fillText(label, p.cx + 3, p.cy + 3);
      });

      // Strand number near first node: bold, larger (S0, S1, S2…)
      const first = nodesSorted[0];
      ctx.font = 'bold 24px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(`S${pin}`, first.cx - 10, first.cy - 18);
      ctx.font = baseFont;
    }

    ctx.restore();
  }

  // Optional debug overlay to visualise audio regions and band weights.
  if (controls.audioDebug.checked && controls.audioEnable.checked && audioRegions.length) {
    ctx.save();
    const overlayHeight = Math.max(16, h * 0.06);
    for (let i = 0; i < audioRegions.length; i++) {
      const region = audioRegions[i];
      if (!region) continue;
      let sum = 0;
      let count = 0;
      for (let b = region.startBar; b <= region.endBar; b++) {
        const v = audioBars[b] || 0;
        sum += v;
        count++;
      }
      const avg = count > 0 ? (sum / count) : 0;
      const x0 = (i / audioRegions.length) * w;
      const x1 = ((i + 1) / audioRegions.length) * w;
      const width = Math.max(1, x1 - x0);
      const alpha = 0.12 + 0.6 * avg;
      ctx.fillStyle = `rgba(59, 130, 246, ${alpha.toFixed(3)})`;
      ctx.fillRect(x0, 0, width, overlayHeight);
    }

    // Show low/mid/high band levels as three tiny bars
    const barW = Math.max(6, w * 0.02);
    const pad = 4;
    const baseY = overlayHeight + 8;
    const bands = [audioLowBand, audioMidBand, audioHighBand];
    for (let k = 0; k < 3; k++) {
      const level = bands[k] || 0;
      const height = Math.max(2, level * (20 + 60 * audioAmp));
      const x = pad + k * (barW + pad);
      const y = baseY + (30 - height);
      let color = 'rgba(34,197,94,0.85)'; // low
      if (k === 1) color = 'rgba(250,204,21,0.85)'; // mid
      if (k === 2) color = 'rgba(239,68,68,0.85)'; // high
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barW, height);
    }
    ctx.restore();
  }

  // Send frame to Teensy via WebSocket (globalBrightness in header; colours 0–255 as-is)
  if (ws && ws.readyState === WebSocket.OPEN) {
    const nodesToSend = globalBrightness === 0
      ? frameNodes.map((n) => ({ ...n, rings: [{ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }] }))
      : frameNodes;
    const spiralSpeedVal = controls.spiralSpeed
      ? Math.max(10, Math.min(200, parseInt(controls.spiralSpeed.value, 10) || 80))
      : 80;
    const spiralDirMixVal = controls.spiralDirMix
      ? Math.max(0, Math.min(100, parseInt(controls.spiralDirMix.value, 10) || 50))
      : 50;
    const speedIndex = Math.max(0, Math.min(15, Math.round(((spiralSpeedVal - 10) / (200 - 10)) * 15)));
    const dirIndex = Math.max(0, Math.min(15, Math.round((spiralDirMixVal / 100) * 15)));
    const spiralSpeedByte = ((dirIndex & 0x0f) << 4) | (speedIndex & 0x0f);
    ws.send(JSON.stringify({
      frameId: frameId++,
      globalBrightness,
      spiralMode: spiralEnabled,
      spiralWidth: spiralWidthIndices,
      spiralSpeed: spiralSpeedVal,
      spiralDirMix: spiralDirMixVal,
      nodes: nodesToSend,
    }));
  }

  requestAnimationFrame(renderFrame);
}

loadNodes().then(() => {
  setupWebSocket();
  requestAnimationFrame(renderFrame);
});

