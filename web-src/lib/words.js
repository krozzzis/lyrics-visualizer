// Mirrors src/subtitles/index.js's wordsFromText(): plain word split with no
// timing, used client-side so an edited cue's words[] stays consistent with
// its text before the round trip to the server confirms it.
export function wordsFromText(text) {
  return text.split(/\s+/).filter(Boolean).map((w) => ({ text: w }));
}
