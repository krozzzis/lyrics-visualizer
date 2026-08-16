const fs = require('fs');
const path = require('path');
const { deepMerge } = require('./config');

// Timeline markers let specific config sections (currently camera/colors/
// style — see resolveConfigAt) change value at a point in time instead of
// staying fixed for the whole video, without making every consumer of
// `config` carry its own time parameter. They live in their own JSON file
// next to config.yaml (like the native cue JSON lives next to the subtitle
// source) rather than inside config.yaml itself, so dragging a marker on the
// timeline doesn't rewrite/thrash the user's hand-edited config.yaml.

function markersPath(configPath) {
  return path.join(path.dirname(path.resolve(configPath)), 'config-markers.json');
}

function loadMarkers(configPath) {
  const p = markersPath(configPath);
  if (!fs.existsSync(p)) return [];
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error(`Invalid config markers file: expected an array in ${p}`);
  }
  return data;
}

function saveMarkers(configPath, markers) {
  fs.writeFileSync(markersPath(configPath), `${JSON.stringify(markers, null, 2)}\n`, 'utf8');
}

function sortMarkers(markers) {
  return [...markers].sort((a, b) => a.time - b.time);
}

// Only these top-level config sections can be locally overridden by a
// marker: they're the ones already read fresh per-frame (or per-cue, for
// camera.anchor) rather than baked once into the shared word layout — see
// buildKeyframes (src/camera.js) and drawFrame (src/scene.js). layout/font/
// output stay global: they feed the single computeLayout() pass that lays
// out every word once for the whole timeline, so a local override there
// would either be ignored or require relayout — out of scope here.
const OVERRIDABLE_SECTIONS = ['camera', 'colors', 'style'];

function sanitizeOverrides(overrides) {
  const out = {};
  if (!overrides || typeof overrides !== 'object') return out;
  for (const key of OVERRIDABLE_SECTIONS) {
    if (overrides[key] !== undefined) out[key] = overrides[key];
  }
  return out;
}

// Cumulative resolve: starting from baseConfig, apply every marker at or
// before t in time order, so a field a marker sets keeps that value until a
// later marker touches the same field again — not just for the instant
// between two markers. `sortedMarkersList` must already be time-sorted
// (see sortMarkers); this is called once or twice per frame, so the caller
// sorts once up front rather than paying for it here.
function resolveConfigAt(baseConfig, sortedMarkersList, t) {
  let resolved = baseConfig;
  for (const m of sortedMarkersList) {
    if (m.time > t) break;
    resolved = deepMerge(resolved, sanitizeOverrides(m.overrides));
  }
  return resolved;
}

// Whether any background color in play (base config or a marker override)
// carries alpha < 1 — the CLI/render side needs to know this up front to
// pick a container/codec that can carry transparency (see buildFfmpegArgs
// in src/render.js), before the frame loop resolves anything per-time.
function backgroundNeedsAlpha(config, markers, alphaOf) {
  const bgs = [config.colors.background];
  for (const m of markers) {
    const overrides = sanitizeOverrides(m.overrides);
    if (overrides.colors && overrides.colors.background !== undefined) {
      bgs.push(overrides.colors.background);
    }
  }
  return bgs.some((bg) => alphaOf(bg) < 1);
}

module.exports = {
  markersPath,
  loadMarkers,
  saveMarkers,
  sortMarkers,
  sanitizeOverrides,
  resolveConfigAt,
  backgroundNeedsAlpha,
  OVERRIDABLE_SECTIONS,
};
