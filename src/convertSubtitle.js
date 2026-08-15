const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { loadSubtitles } = require('./subtitles');
const { serializeNative } = require('./subtitles/native');

// Converts config.yaml's subtitle field from a source format (.ass/.srt/.vtt)
// to this app's own JSON cue format, once. After conversion all further
// reads/edits go through the JSON file; the original source file is left on
// disk untouched, as a backup, and never read again.
//
// Runs on every startup but is a no-op once subtitle already points at a
// .json file — the common case after the first run.
function ensureNativeSubtitle(configPath) {
  const absConfigPath = path.resolve(configPath);
  const basedir = path.dirname(absConfigPath);
  const raw = fs.readFileSync(absConfigPath, 'utf8');
  const parsed = yaml.load(raw) || {};

  if (!parsed.subtitle) return; // loadConfig() will raise its own error for this

  const srcPath = path.isAbsolute(parsed.subtitle)
    ? parsed.subtitle
    : path.resolve(basedir, parsed.subtitle);
  if (path.extname(srcPath).toLowerCase() === '.json') return;

  const nativePath = path.join(
    path.dirname(srcPath),
    `${path.basename(srcPath, path.extname(srcPath))}.cues.json`,
  );

  if (!fs.existsSync(nativePath)) {
    const cues = loadSubtitles(srcPath);
    fs.writeFileSync(nativePath, serializeNative(cues), 'utf8');
  }

  // yaml.dump can't preserve comments in the source file, but this write
  // only happens once per project (the .json guard above short-circuits
  // every run after) so it's a one-time cost, unlike POST /api/config which
  // deliberately avoids this by re-reading fresh YAML on every save.
  const relNativePath = path.relative(basedir, nativePath).split(path.sep).join('/');
  parsed.subtitle = relNativePath;
  fs.writeFileSync(absConfigPath, yaml.dump(parsed, { lineWidth: 100 }), 'utf8');
}

module.exports = { ensureNativeSubtitle };
