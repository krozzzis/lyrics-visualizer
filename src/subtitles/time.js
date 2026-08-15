// Time parsing helpers shared by subtitle format parsers.
// All parsers convert their native timestamp format to seconds (float).

function assTimeToSeconds(t) {
  // H:MM:SS.cc  (centiseconds)
  const m = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(t.trim());
  if (!m) throw new Error(`Invalid ASS timestamp: ${t}`);
  const [, h, mm, ss, cc] = m;
  return (+h) * 3600 + (+mm) * 60 + (+ss) + (+cc) / 100;
}

function srtTimeToSeconds(t) {
  // HH:MM:SS,mmm
  const m = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(t.trim());
  if (!m) throw new Error(`Invalid SRT timestamp: ${t}`);
  const [, h, mm, ss, ms] = m;
  return (+h) * 3600 + (+mm) * 60 + (+ss) + (+ms) / 1000;
}

function vttTimeToSeconds(t) {
  // [HH:]MM:SS.mmm
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(t.trim());
  if (!m) throw new Error(`Invalid VTT timestamp: ${t}`);
  const [, h, mm, ss, ms] = m;
  return (+(h || 0)) * 3600 + (+mm) * 60 + (+ss) + (+ms) / 1000;
}

module.exports = { assTimeToSeconds, srtTimeToSeconds, vttTimeToSeconds };
