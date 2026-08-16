const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULTS = {
  audio: null,
  font: {
    family: 'sans-serif',
    path: null,
    size: 64,
    weight: 'normal',
    style: 'normal',
  },
  colors: {
    text: '#000000',
    background: '#FFFFFF',
  },
  output: {
    width: 1920,
    height: 1080,
    fps: 30,
  },
  camera: {
    anchor: 'center', // 'center' | 'start'
    jumpDuration: 0.22,
    easing: 'easeOutBack', // 'easeOutBack' | 'spring' | 'linear'
    overshoot: 1.7,
    zoom: {
      enabled: true,
      amount: 0.88, // trough scale at the peak of the pull-back (1 = no zoom)
      outFraction: 0.35, // portion of jumpDuration spent zooming out before it eases back in
    },
  },
  word: {
    splitMode: 'line', // 'line' | 'karaoke' | 'char-weighted'
  },
  layout: {
    wordGap: 40,
    cueGap: 120,
    mode: 'flow', // 'flow' (single long line) | 'stacked' (logical lines stacked vertically)
    lineHeight: 1.6, // stacked mode: row spacing, as a multiple of font.size
    showPrevLine: true, // stacked mode: render the line above the active one
    showNextLine: true, // stacked mode: render the line below the active one
    nextLineFrom: 'start', // stacked mode: 'start' (rows share a left edge) | 'end' (next row's first word starts under the current row's last word)
  },
  style: {
    activeOpacity: 1,
    inactiveOpacity: 0.35,
    // Full disappearance of a cue's words after its own `end` timestamp —
    // independent of when the next cue's jump fires, so a cue doesn't just
    // sit at activeOpacity forever during a gap with nothing after it.
    cueExit: {
      type: 'none', // 'none' | 'opacity' | 'slide' | 'scale'
      delay: 0.3, // seconds after cue.end before the exit animation starts
      duration: 0.5, // seconds the exit animation takes to reach fully hidden
    },
    // Other cues in the active line, and previous lines, are already
    // dimmed to inactiveOpacity immediately (unanimated — the ternary
    // above). fadeOut is purely what removes them later: once a cue/line/
    // word has been superseded for a while, it fades from inactiveOpacity
    // down to fully hidden. 'word' granularity staggers each word's own
    // fade, giving a left-to-right dissolve as an old line is read past.
    fadeOut: {
      type: 'none', // 'none' | 'opacity' | 'slide' | 'scale'
      // 'cue': the whole superseded cue disappears together (works in flow
      // and stacked mode). 'line': the whole stacked row disappears
      // together once a *different row* becomes active — stacked mode
      // only, since every word shares lineIndex 0 in flow mode and this
      // would never fire. 'word': each word disappears individually,
      // staggered by wordStagger.
      granularity: 'cue',
      delay: 0, // seconds after being superseded before the fade starts
      duration: 0.4, // seconds the fade takes to reach fully hidden
      wordStagger: 0.04, // seconds between each word's fade start (granularity: word)
    },
  },
  timeline: {
    bpm: null, // null hides the beat grid in the browser preview
    beatsPerBar: 4,
    gridOffset: 0, // seconds — time of the first downbeat (bar line)
  },
};

function deepMerge(base, override) {
  if (override == null) return base;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    const bv = base ? base[key] : undefined;
    const ov = override[key];
    out[key] = (bv && typeof bv === 'object' && !Array.isArray(bv)
      && ov && typeof ov === 'object' && !Array.isArray(ov))
      ? deepMerge(bv, ov)
      : ov;
  }
  return out;
}

function resolvePath(basedir, p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.resolve(basedir, p);
}

function loadConfig(configPath) {
  const absConfigPath = path.resolve(configPath);
  const basedir = path.dirname(absConfigPath);
  const raw = fs.readFileSync(absConfigPath, 'utf8');
  const parsed = yaml.load(raw) || {};

  if (!parsed.subtitle) {
    throw new Error(`Config ${absConfigPath} is missing required field: subtitle`);
  }

  const merged = deepMerge(DEFAULTS, parsed);

  merged.subtitle = resolvePath(basedir, parsed.subtitle);
  merged.audio = parsed.audio ? resolvePath(basedir, parsed.audio) : null;
  merged.font.path = parsed.font && parsed.font.path ? resolvePath(basedir, parsed.font.path) : null;

  if (!fs.existsSync(merged.subtitle)) {
    throw new Error(`Subtitle file not found: ${merged.subtitle}`);
  }
  if (merged.audio && !fs.existsSync(merged.audio)) {
    throw new Error(`Audio file not found: ${merged.audio}`);
  }
  if (!merged.font.path) {
    // A bundled font file is required (not just a family name): a headless
    // Node render has no system font store to fall back to, and relying on
    // whatever fonts happen to be installed would make the browser preview
    // and the ffmpeg render measure text differently. See font.path in the
    // config schema.
    throw new Error('Config field font.path is required: point it at a .ttf/.otf file to bundle.');
  }
  if (!fs.existsSync(merged.font.path)) {
    throw new Error(`Font file not found: ${merged.font.path}`);
  }

  return merged;
}

module.exports = { loadConfig, DEFAULTS, deepMerge };
