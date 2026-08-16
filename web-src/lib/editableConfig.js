// Shape sent to POST /api/config and POST /api/render — must match the
// server's EDITABLE_KEYS/EDITABLE_FONT_KEYS whitelist in bin/serve.js.
// Shared so the settings panel (persist to disk) and the render trigger
// (render what's on screen, saved or not) always send the same fields.
export function buildEditablePayload(config) {
  return {
    output: {
      width: config.output.width,
      height: config.output.height,
      fps: config.output.fps,
      duration: config.output.duration,
    },
    colors: { text: config.colors.text, background: config.colors.background },
    font: { size: config.font.size, weight: config.font.weight, style: config.font.style },
    camera: {
      anchor: config.camera.anchor,
      jumpDuration: config.camera.jumpDuration,
      easing: config.camera.easing,
      overshoot: config.camera.overshoot,
      zoom: {
        enabled: config.camera.zoom.enabled,
        amount: config.camera.zoom.amount,
        outFraction: config.camera.zoom.outFraction,
      },
    },
    word: { splitMode: config.word.splitMode },
    layout: {
      wordGap: config.layout.wordGap,
      cueGap: config.layout.cueGap,
      mode: config.layout.mode,
      lineHeight: config.layout.lineHeight,
      showPrevLine: config.layout.showPrevLine,
      showNextLine: config.layout.showNextLine,
      nextLineFrom: config.layout.nextLineFrom,
    },
    style: { activeOpacity: config.style.activeOpacity, inactiveOpacity: config.style.inactiveOpacity },
    timeline: {
      bpm: config.timeline.bpm,
      beatsPerBar: config.timeline.beatsPerBar,
      gridOffset: config.timeline.gridOffset,
    },
  };
}
