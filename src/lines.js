// Groups cues into logical lines by their lineId — cues that are fragments
// of the same subtitle line, set via the timeline's "group" action. A cue
// with no lineId is its own logical line: this makes every cue array valid
// input (nothing needs to be grouped first) and keeps row/layout math in
// scene.js/layout.js total rather than needing a special ungrouped case.
//
// Returns lines ordered by their earliest cue's start time: [{ lineId,
// cueIndices: [i, ...] }], cueIndices themselves in original (start-sorted)
// cue order.
function computeLines(cues) {
  const groups = new Map(); // lineId -> cue indices
  const lines = [];

  cues.forEach((cue, i) => {
    if (cue.lineId) {
      if (!groups.has(cue.lineId)) {
        const line = { lineId: cue.lineId, cueIndices: [] };
        groups.set(cue.lineId, line);
        lines.push(line);
      }
      groups.get(cue.lineId).cueIndices.push(i);
    } else {
      lines.push({ lineId: null, cueIndices: [i] });
    }
  });

  lines.sort((a, b) => cues[a.cueIndices[0]].start - cues[b.cueIndices[0]].start);
  return lines;
}

module.exports = { computeLines };
