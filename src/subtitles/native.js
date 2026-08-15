// The app's own subtitle format: a straight JSON serialization of the
// normalized cue shape every other parser in this directory produces —
// { start, end, text, words: [{ text, start?, end? }] }. Once a source
// .ass/.srt/.vtt file is converted (see ../convertSubtitle.js), all further
// editing reads and writes this format directly; the source file is never
// touched again.
function parseNative(content) {
  const data = JSON.parse(content);
  const cues = Array.isArray(data) ? data : data.cues;
  if (!Array.isArray(cues)) {
    throw new Error('Invalid native cue file: expected an array of cues (or {cues: [...]})');
  }
  return cues;
}

function serializeNative(cues) {
  return `${JSON.stringify(cues, null, 2)}\n`;
}

module.exports = { parseNative, serializeNative };
