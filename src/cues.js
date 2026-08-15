const { loadSubtitles } = require('./subtitles');
const { applyCharWeightedTiming } = require('./word-timing');

// Shared by the CLI renderer and the dev server so both draw from the exact
// same cue data (parsing + optional char-weighted synthesis).
function loadCues(config) {
  let cues = loadSubtitles(config.subtitle);
  if (config.word.splitMode === 'char-weighted') cues = applyCharWeightedTiming(cues);
  return cues;
}

module.exports = { loadCues };
