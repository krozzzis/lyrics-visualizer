// Opt-in synthesis of word-level timing by distributing a cue's duration
// across its words proportionally to character count. This is an
// approximation, not real beat-accurate timing — off by default
// (config.word.splitMode: 'char-weighted') because it can jump off the beat.
function applyCharWeightedTiming(cues) {
  return cues.map((cue) => {
    const totalChars = cue.words.reduce((sum, w) => sum + w.text.length, 0) || cue.words.length;
    const duration = cue.end - cue.start;
    let cursor = cue.start;
    const words = cue.words.map((w) => {
      const share = (w.text.length || 1) / totalChars;
      const start = cursor;
      const end = start + duration * share;
      cursor = end;
      return { ...w, start, end };
    });
    return { ...cue, words };
  });
}

module.exports = { applyCharWeightedTiming };
