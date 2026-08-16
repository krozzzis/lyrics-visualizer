// Builds the text layout the camera pans/jumps across. Two modes:
//   'flow'    — every word from every cue, laid out left-to-right on one
//               long line (the original/default behavior).
//   'stacked' — cues grouped into logical lines (src/lines.js); each line's
//               words flow left-to-right in their own row, rows stacked
//               vertically by lineHeight * font.size.
// Every word and outCue always carries lineIndex/y (0 in flow mode, since
// there's only one row) so downstream code (camera.js, scene.js) doesn't
// need to branch on mode.
//
// layout.mode/wordGap/cueGap/lineHeight/nextLineFrom are all config-marker
// overridable (see OVERRIDABLE_SECTIONS in src/configMarkers.js) — a run of
// cues resolves each of these at its own start time, the same per-cue
// resolution buildKeyframes already uses for camera.anchor. That's a
// straightforward per-cue/per-row lookup for the spacing fields, but mode
// is structural: flow and stacked build fundamentally different coordinate
// systems (one row vs many), so a mode change mid-timeline is handled by
// segmentByMode() below, splicing a flow run and a stacked run together
// rather than picking one algorithm for the whole cue list.
//
// Must be called with a 2D context whose ctx.font is already set to the exact
// same font string used at draw time (see fontString()) — layout and drawing
// share the same measurements by construction, in both browser and Node.

const { computeLines } = require('./lines');
const { resolveConfigAt } = require('./configMarkers');

function fontString(fontConfig) {
  const weight = fontConfig.weight || 'normal';
  const style = fontConfig.style || 'normal';
  return `${style} ${weight} ${fontConfig.size}px "${fontConfig.family}"`;
}

function resolveLayoutAt(config, sortedMarkers, t) {
  return resolveConfigAt(config, sortedMarkers, t).layout;
}

// Lays out one row's cues left-to-right starting at startX, appending to
// `words`/`outCues` (outCues indexed by original cue position, not row
// order, so downstream consumers can keep indexing it by cueIndex).
// resolveGapForCue(cueIndex) -> { wordGap, cueGap }, looked up per cue
// (rather than one scalar for the whole row) so a marker's wordGap/cueGap
// override only affects the cues at or after its own time.
function layoutRow(ctx, cues, cueIndices, lineIndex, y, startX, resolveGapForCue, words, outCues) {
  let x = startX;
  let lastCueGap = 0;
  for (const cueIndex of cueIndices) {
    const cue = cues[cueIndex];
    const { wordGap, cueGap } = resolveGapForCue(cueIndex);
    lastCueGap = cueGap;
    const cueStartX = x;
    const cueWords = [];

    cue.words.forEach((word, wordIndex) => {
      const width = ctx.measureText(word.text).width;
      const w = {
        text: word.text, x, y, width, cueIndex, wordIndex, lineIndex, start: word.start, end: word.end,
      };
      cueWords.push(w);
      words.push(w);
      x += width + wordGap;
    });

    if (cueWords.length > 0) x -= wordGap; // no trailing gap after the last word of a cue
    const cueEndX = x;
    outCues[cueIndex] = {
      cueIndex,
      start: cue.start,
      end: cue.end,
      text: cue.text,
      startX: cueStartX,
      endX: cueEndX,
      centerX: (cueStartX + cueEndX) / 2,
      lineIndex,
      y,
      words: cueWords,
    };
    x += cueGap;
  }
  return x - lastCueGap; // last cue's end, before its trailing cueGap
}

// Splits `cues` into contiguous runs sharing the same resolved layout.mode
// at each cue's own start time — a marker flipping flow<->stacked only
// affects cues from its own time onward, not the whole timeline.
function segmentByMode(cues, config, sortedMarkers) {
  const segments = [];
  let current = null;
  cues.forEach((cue, i) => {
    const mode = resolveLayoutAt(config, sortedMarkers, cue.start).mode === 'stacked' ? 'stacked' : 'flow';
    if (!current || current.mode !== mode) {
      current = { mode, indices: [] };
      segments.push(current);
    }
    current.indices.push(i);
  });
  return segments;
}

function computeLayout(ctx, cues, config, sortedMarkers, fontConfig) {
  const words = [];
  const outCues = new Array(cues.length);
  const resolveGapForCue = (cueIndex) => {
    const resolved = resolveLayoutAt(config, sortedMarkers, cues[cueIndex].start);
    return { wordGap: resolved.wordGap, cueGap: resolved.cueGap };
  };

  const segments = segmentByMode(cues, config, sortedMarkers);
  // Grouped once, globally, by lineId — a stacked run below only keeps the
  // cueIndices that actually fall inside it, so a lineId group straddling a
  // mode boundary is simply split there rather than preserved across it.
  const allLines = computeLines(cues);

  // Carried across segment boundaries so text keeps flowing left-to-right
  // (carryX) and a stacked run right after a flow run starts on a fresh row
  // (rowCursor/yCursor) instead of overlapping it.
  let carryX = 0;
  let rowCursor = 0;
  let yCursor = 0;
  let totalWidth = 0;

  segments.forEach((segment) => {
    if (segment.mode === 'stacked') {
      const segmentIndexSet = new Set(segment.indices);
      const segmentLines = allLines
        .map((line) => ({ ...line, cueIndices: line.cueIndices.filter((idx) => segmentIndexSet.has(idx)) }))
        .filter((line) => line.cueIndices.length > 0);

      let rowStartX = carryX;
      segmentLines.forEach((line, rowOffset) => {
        const firstCue = cues[line.cueIndices[0]];
        const resolved = resolveLayoutAt(config, sortedMarkers, firstCue.start);
        const rowSpacing = (fontConfig.size || 0) * (resolved.lineHeight || 1.6);
        const chainFromEnd = resolved.nextLineFrom === 'end';
        const lineIndex = rowCursor + rowOffset;
        const startX = chainFromEnd ? rowStartX : 0;
        const rowEnd = layoutRow(ctx, cues, line.cueIndices, lineIndex, yCursor, startX, resolveGapForCue, words, outCues);
        totalWidth = Math.max(totalWidth, rowEnd);
        rowStartX = rowEnd;
        yCursor += rowSpacing;
      });
      rowCursor += segmentLines.length;
      carryX = rowStartX;
    } else {
      // flow: this whole run is one row, sharing lineIndex/y — the one-
      // long-line case has no "rows" of its own, so lineHeight here only
      // matters for sizing the gap before a stacked run that might follow.
      const lineIndex = rowCursor;
      const rowEnd = layoutRow(ctx, cues, segment.indices, lineIndex, yCursor, carryX, resolveGapForCue, words, outCues);
      totalWidth = Math.max(totalWidth, rowEnd);
      carryX = rowEnd;
      rowCursor += 1;
      const resolved = resolveLayoutAt(config, sortedMarkers, cues[segment.indices[0]].start);
      yCursor += (fontConfig.size || 0) * (resolved.lineHeight || 1.6);
    }
  });

  return { words, cues: outCues, totalWidth: Math.max(0, totalWidth) };
}

module.exports = { fontString, computeLayout };
