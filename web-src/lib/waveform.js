// Client-side waveform peak extraction. Computed once at a fixed resolution
// covering the whole track; the timeline component downsamples this array
// to whatever's on screen, so zooming/panning never re-touches raw samples.
const RESOLUTION = 20000;

export async function decodeAudio(url) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  // decodeAudioData doesn't require the context to be running (only actual
  // playback scheduling needs a user gesture), so this works even before
  // the user has interacted with the page.
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }
}

export function computePeaks(audioBuffer, resolution = RESOLUTION) {
  const duration = audioBuffer.duration;
  const peaks = new Float32Array(resolution);
  const samplesPerBucket = Math.max(1, Math.floor(audioBuffer.length / resolution));

  for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let b = 0; b < resolution; b += 1) {
      const start = b * samplesPerBucket;
      const end = Math.min(data.length, start + samplesPerBucket);
      let max = 0;
      for (let i = start; i < end; i += 1) {
        const v = data[i] < 0 ? -data[i] : data[i];
        if (v > max) max = v;
      }
      if (max > peaks[b]) peaks[b] = max;
    }
  }

  return { resolution, duration, peaks };
}

// Peak amplitude (0-1) at time t, via the nearest precomputed bucket.
export function peakAt(peakData, t) {
  if (!peakData) return 0;
  const idx = Math.floor((t / peakData.duration) * peakData.resolution);
  if (idx < 0 || idx >= peakData.resolution) return 0;
  return peakData.peaks[idx];
}
