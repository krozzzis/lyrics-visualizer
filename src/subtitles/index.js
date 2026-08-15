const fs = require('fs');
const path = require('path');
const { parseAss } = require('./ass');
const { parseSrt } = require('./srt');
const { parseVtt } = require('./vtt');

// Loads a subtitle file and returns a normalized, time-sorted list of cues:
//   { start, end, text, words: [{ text, start?, end? }] }
// `words[].start/end` are only present when the source format carries genuine
// word-level timing (ASS karaoke tags). Otherwise words carry text only.
function loadSubtitles(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, 'utf8');

  let cues;
  if (ext === '.ass' || ext === '.ssa') {
    cues = parseAss(content);
  } else if (ext === '.srt') {
    cues = parseSrt(content);
  } else if (ext === '.vtt') {
    cues = parseVtt(content);
  } else {
    throw new Error(`Unsupported subtitle format: ${ext} (expected .ass, .ssa, .srt or .vtt)`);
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

module.exports = { loadSubtitles };
