import {
  createSignal, createMemo, createEffect, onMount, onCleanup, Show,
} from 'solid-js';
import { decodeAudio, computePeaks, peakAt } from '../lib/waveform.js';
import { beatsInRange } from '../lib/beatGrid.js';
import { snapToGrid } from '../lib/snap.js';
import { formatClock } from '../lib/format.js';
import PlayPauseButton from './PlayPauseButton.jsx';

const COLORS = {
  waveformPlayed: '#9781ff',
  waveformUnplayed: '#454857',
  barLine: 'rgba(255,255,255,0.24)',
  beatLine: 'rgba(255,255,255,0.09)',
  blockFill: '#23252e',
  blockBorder: '#33353f',
  blockFillActive: '#7c5cff',
  blockText: '#9297a3',
  blockTextActive: '#ffffff',
  playhead: '#ffffff',
  playheadHandle: '#7c5cff',
  rulerBg: 'rgba(255,255,255,0.03)',
  rulerTick: 'rgba(255,255,255,0.28)',
  rulerText: '#8b8fa0',
  rulerBarText: '#b9aeff',
};

const RULER_H = 30;
const WAVE_FRACTION = 0.58; // portion of the non-ruler height given to the waveform
const MIN_PX_PER_SECOND = 4;
const MAX_PX_PER_SECOND = 900;
const DRAG_THRESHOLD = 4;
const AUTO_FOLLOW_MARGIN = 0.15; // re-center once playhead leaves [margin, 1-margin] of width
const AUTO_FOLLOW_TARGET = 0.3; // where the playhead lands after re-centering
const MIN_THUMB_PX = 24;

const TIME_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
const BAR_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

function pickStep(candidates, valuePx, minPx) {
  for (const c of candidates) {
    if (c * valuePx >= minPx) return c;
  }
  return candidates[candidates.length - 1];
}

export default function Timeline(props) {
  let viewportEl;
  let canvasEl;
  let scrollbarTrackEl;
  let scrollbarThumbEl;

  const [containerSize, setContainerSize] = createSignal({ width: 0, height: 0 });
  const [pxPerSecond, setPxPerSecond] = createSignal(50);
  const [scrollOffset, setScrollOffset] = createSignal(0);
  const [peakData, setPeakData] = createSignal(null);
  const [userInteracting, setUserInteracting] = createSignal(false);
  const [fitted, setFitted] = createSignal(false);
  const [editingIndex, setEditingIndex] = createSignal(-1);

  let interactingTimer;
  function markInteracting() {
    setUserInteracting(true);
    clearTimeout(interactingTimer);
    interactingTimer = setTimeout(() => setUserInteracting(false), 1500);
  }

  function clampScroll(offset, px = pxPerSecond(), width = containerSize().width) {
    const maxOffset = Math.max(0, props.duration() - width / px);
    return Math.min(Math.max(0, offset), maxOffset);
  }

  function fitToWidth() {
    const width = containerSize().width;
    const d = props.duration();
    if (width <= 0 || d <= 0) return;
    setPxPerSecond(Math.max(MIN_PX_PER_SECOND, width / d));
    setScrollOffset(0);
  }

  function zoomBy(factor) {
    const width = containerSize().width;
    const centerTime = scrollOffset() + (width / 2) / pxPerSecond();
    const next = Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond() * factor));
    setPxPerSecond(next);
    setScrollOffset(clampScroll(centerTime - (width / 2) / next, next, width));
  }

  // --- size tracking ---
  onMount(() => {
    const ro = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      setContainerSize({ width: box.width, height: box.height });
    });
    ro.observe(viewportEl);
    onCleanup(() => ro.disconnect());
  });

  // Fit the whole song on first real measurement / once duration is known.
  createEffect(() => {
    const { width } = containerSize();
    const d = props.duration();
    if (!fitted() && width > 0 && d > 0) {
      fitToWidth();
      setFitted(true);
    }
  });

  // --- waveform peaks ---
  onMount(async () => {
    if (!props.config.audio) return;
    try {
      const buffer = await decodeAudio(props.config.audio);
      setPeakData(computePeaks(buffer));
    } catch (err) {
      // Non-fatal: timeline still shows grid + cue blocks without a waveform.
      // eslint-disable-next-line no-console
      console.warn('waveform decode failed:', err);
    }
  });

  // --- pointer interaction: click to seek, drag to pan ---
  onMount(() => {
    let dragging = false;
    let dragged = false;
    let startX = 0;
    let startOffset = 0;

    function onPointerDown(e) {
      dragging = true;
      dragged = false;
      startX = e.clientX;
      startOffset = scrollOffset();
      viewportEl.setPointerCapture(e.pointerId);
      viewportEl.classList.add('dragging');
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > DRAG_THRESHOLD) dragged = true;
      if (dragged) {
        markInteracting();
        setScrollOffset(clampScroll(startOffset - dx / pxPerSecond()));
      }
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      viewportEl.classList.remove('dragging');
      if (!dragged) {
        const rect = viewportEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const t = scrollOffset() + x / pxPerSecond();
        const tl = props.config.timeline || {};
        props.onSeek(props.snapEnabled() ? snapToGrid(t, props.bpm(), tl.gridOffset || 0) : t);
      } else {
        markInteracting();
      }
    }

    function onWheel(e) {
      if (!e.ctrlKey && !e.metaKey) {
        // Plain wheel/trackpad: pan horizontally.
        markInteracting();
        setScrollOffset(clampScroll(scrollOffset() + e.deltaX / pxPerSecond() + e.deltaY / pxPerSecond()));
        e.preventDefault();
        return;
      }
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }

    function onDblClick(e) {
      const rect = viewportEl.getBoundingClientRect();
      const i = cueIndexAt(e.clientX - rect.left, e.clientY - rect.top);
      if (i >= 0) setEditingIndex(i);
    }

    viewportEl.addEventListener('pointerdown', onPointerDown);
    viewportEl.addEventListener('pointermove', onPointerMove);
    viewportEl.addEventListener('pointerup', onPointerUp);
    viewportEl.addEventListener('wheel', onWheel, { passive: false });
    viewportEl.addEventListener('dblclick', onDblClick);
    onCleanup(() => {
      viewportEl.removeEventListener('pointerdown', onPointerDown);
      viewportEl.removeEventListener('pointermove', onPointerMove);
      viewportEl.removeEventListener('pointerup', onPointerUp);
      viewportEl.removeEventListener('wheel', onWheel);
      viewportEl.removeEventListener('dblclick', onDblClick);
    });
  });

  // --- horizontal scrollbar: thumb geometry + drag/track interaction ---
  const thumbMetrics = createMemo(() => {
    const width = containerSize().width;
    const d = props.duration();
    const px = pxPerSecond();
    if (width <= 0 || d <= 0) return { thumbWidth: width, thumbLeft: 0, scrollable: false };
    const visibleSeconds = width / px;
    const maxOffset = Math.max(0, d - visibleSeconds);
    if (maxOffset <= 0) return { thumbWidth: width, thumbLeft: 0, scrollable: false };
    const thumbWidth = Math.min(width, Math.max(MIN_THUMB_PX, (visibleSeconds / d) * width));
    const availableRange = width - thumbWidth;
    const thumbLeft = (scrollOffset() / maxOffset) * availableRange;
    return {
      thumbWidth, thumbLeft, scrollable: true, maxOffset, availableRange,
    };
  });

  // Dragging the thumb itself pans proportionally to how far the pointer moved.
  onMount(() => {
    let dragging = false;
    let dragStartX = 0;
    let dragStartOffset = 0;

    function onPointerDown(e) {
      const m = thumbMetrics();
      if (!m.scrollable) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartOffset = scrollOffset();
      scrollbarThumbEl.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const { maxOffset, availableRange } = thumbMetrics();
      if (!availableRange) return;
      const dx = e.clientX - dragStartX;
      markInteracting();
      setScrollOffset(clampScroll(dragStartOffset + (dx / availableRange) * maxOffset));
    }

    function onPointerUp() {
      dragging = false;
    }

    scrollbarThumbEl.addEventListener('pointerdown', onPointerDown);
    scrollbarThumbEl.addEventListener('pointermove', onPointerMove);
    scrollbarThumbEl.addEventListener('pointerup', onPointerUp);
    onCleanup(() => {
      scrollbarThumbEl.removeEventListener('pointerdown', onPointerDown);
      scrollbarThumbEl.removeEventListener('pointermove', onPointerMove);
      scrollbarThumbEl.removeEventListener('pointerup', onPointerUp);
    });
  });

  // Clicking the track itself (not the thumb) pages one screenful toward the click.
  onMount(() => {
    function onPointerDown(e) {
      if (e.target !== scrollbarTrackEl) return;
      const m = thumbMetrics();
      if (!m.scrollable) return;
      const width = containerSize().width;
      const visibleSeconds = width / pxPerSecond();
      const rect = scrollbarTrackEl.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      markInteracting();
      const dir = clickX < m.thumbLeft ? -1 : 1;
      setScrollOffset(clampScroll(scrollOffset() + dir * visibleSeconds * 0.9));
    }

    scrollbarTrackEl.addEventListener('pointerdown', onPointerDown);
    onCleanup(() => scrollbarTrackEl.removeEventListener('pointerdown', onPointerDown));
  });

  // --- keep the playhead in view ---
  // While playing: DAW-style scroll-follow, re-centering once the playhead
  // nears the edge. While paused: don't fight a manual pan/click, but if an
  // external seek (sidebar, controls bar) lands outside the visible window
  // entirely, snap it into view rather than leaving the timeline pointed
  // somewhere stale.
  createEffect(() => {
    const t = props.currentTime();
    if (userInteracting()) return;
    const width = containerSize().width;
    if (width <= 0) return;
    const x = (t - scrollOffset()) * pxPerSecond();

    if (props.playing()) {
      if (x < width * AUTO_FOLLOW_MARGIN || x > width * (1 - AUTO_FOLLOW_MARGIN)) {
        setScrollOffset(clampScroll(t - (width * AUTO_FOLLOW_TARGET) / pxPerSecond()));
      }
    } else if (x < 0 || x > width) {
      setScrollOffset(clampScroll(t - (width * AUTO_FOLLOW_TARGET) / pxPerSecond()));
    }
  });

  // --- drawing ---
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // Cue block row geometry — shared between draw() and hit-testing (used by
  // double-click-to-edit and the text-edit input overlay), so they can never
  // silently drift apart.
  function blockGeometry() {
    const { height } = containerSize();
    const contentH = height - RULER_H;
    const waveH = contentH * WAVE_FRACTION;
    const blockY = RULER_H + waveH + 6;
    const blockH = height - blockY - 6;
    return {
      waveH, blockY, blockH,
    };
  }

  function cueScreenX(cue) {
    const px = pxPerSecond();
    const start = scrollOffset();
    const x1 = (cue.start - start) * px;
    const x2 = (cue.end - start) * px;
    return { x1, x2, w: Math.max(2, x2 - x1) };
  }

  // Index of the cue block under viewport-relative (x, y), or -1.
  function cueIndexAt(x, y) {
    const { blockY, blockH } = blockGeometry();
    if (y < blockY || y > blockY + blockH) return -1;
    for (let i = 0; i < props.cues.length; i += 1) {
      const { x1, x2 } = cueScreenX(props.cues[i]);
      if (x >= x1 && x <= x2) return i;
    }
    return -1;
  }

  function draw() {
    if (!canvasEl) return;
    const { width, height } = containerSize();
    if (width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvasEl.width !== Math.round(width * dpr) || canvasEl.height !== Math.round(height * dpr)) {
      canvasEl.width = Math.round(width * dpr);
      canvasEl.height = Math.round(height * dpr);
    }
    const ctx = canvasEl.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const px = pxPerSecond();
    const start = scrollOffset();
    const end = start + width / px;
    const t = props.currentTime();
    const bpm = props.bpm();
    const tl = props.config.timeline || {};
    const beatsPerBar = tl.beatsPerBar || 4;
    const gridOffset = tl.gridOffset || 0;

    const { waveH, blockY, blockH } = blockGeometry();

    // Beat grid (drawn first, under everything else in the content area)
    const beats = beatsInRange(bpm, beatsPerBar, gridOffset, start, end);
    for (const beat of beats) {
      const x = (beat.time - start) * px;
      ctx.strokeStyle = beat.isBar ? COLORS.barLine : COLORS.beatLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, RULER_H + (beat.isBar ? 0 : waveH * 0.15));
      ctx.lineTo(x + 0.5, RULER_H + waveH);
      ctx.stroke();
    }

    // Waveform
    const peaks = peakData();
    const waveCenterY = RULER_H + waveH / 2;
    if (peaks) {
      for (let x = 0; x < width; x += 1) {
        const time = start + x / px;
        const amp = peakAt(peaks, time);
        const barH = Math.max(1, amp * (waveH / 2 - 4));
        ctx.fillStyle = time <= t ? COLORS.waveformPlayed : COLORS.waveformUnplayed;
        ctx.fillRect(x, waveCenterY - barH, 1, barH * 2);
      }
    } else {
      ctx.strokeStyle = COLORS.waveformUnplayed;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, waveCenterY);
      ctx.lineTo(width, waveCenterY);
      ctx.stroke();
    }

    // Cue blocks
    const activeIdx = props.activeIndex();
    props.cues.forEach((cue, i) => {
      if (cue.end < start || cue.start > end) return;
      const x1 = (cue.start - start) * px;
      const x2 = (cue.end - start) * px;
      const w = Math.max(2, x2 - x1);
      const active = i === activeIdx;
      ctx.fillStyle = active ? COLORS.blockFillActive : COLORS.blockFill;
      roundRect(ctx, x1, blockY, w, blockH, 5);
      ctx.fill();
      if (!active) {
        ctx.strokeStyle = COLORS.blockBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (w > 14) {
        ctx.save();
        roundRect(ctx, x1, blockY, w, blockH, 5);
        ctx.clip();
        ctx.fillStyle = active ? COLORS.blockTextActive : COLORS.blockText;
        ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(cue.text, x1 + 6, blockY + blockH / 2 + 1);
        ctx.restore();
      }
    });

    // Ruler: bar numbers when BPM is set (DAW convention — the grid is the
    // primary reference once there's tempo info), otherwise plain timecodes.
    ctx.fillStyle = COLORS.rulerBg;
    ctx.fillRect(0, 0, width, RULER_H);
    ctx.font = '10px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 1;

    if (bpm > 0) {
      const barDuration = (60 / bpm) * beatsPerBar;
      const barStride = pickStep(BAR_STEPS, barDuration * px, 50);
      ctx.textAlign = 'left';
      for (const beat of beats) {
        if (!beat.isBar) continue;
        const barIndex = Math.round((beat.time - gridOffset) / barDuration);
        if (((barIndex % barStride) + barStride) % barStride !== 0) continue;
        const x = (beat.time - start) * px;
        ctx.strokeStyle = COLORS.rulerTick;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, RULER_H - 6);
        ctx.lineTo(x + 0.5, RULER_H);
        ctx.stroke();
        ctx.fillStyle = COLORS.rulerBarText;
        ctx.fillText(String(barIndex + 1), x + 3, 2);
        ctx.fillStyle = COLORS.rulerText;
        ctx.fillText(formatClock(beat.time), x + 3, 13);
      }
    } else {
      const timeStep = pickStep(TIME_STEPS, px, 64);
      const firstTick = Math.ceil(start / timeStep) * timeStep;
      ctx.textAlign = 'left';
      for (let time = firstTick; time <= end; time += timeStep) {
        const x = (time - start) * px;
        ctx.strokeStyle = COLORS.rulerTick;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, RULER_H - 6);
        ctx.lineTo(x + 0.5, RULER_H);
        ctx.stroke();
        ctx.fillStyle = COLORS.rulerText;
        ctx.fillText(formatClock(time), x + 3, 8);
      }
    }

    // Playhead
    const playheadX = (t - start) * px;
    if (playheadX >= -2 && playheadX <= width + 2) {
      ctx.strokeStyle = COLORS.playhead;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      ctx.fillStyle = COLORS.playheadHandle;
      ctx.beginPath();
      ctx.moveTo(playheadX - 5, 0);
      ctx.lineTo(playheadX + 5, 0);
      ctx.lineTo(playheadX, 7);
      ctx.closePath();
      ctx.fill();
    }
  }

  createEffect(() => {
    // Re-run on every input that changes what's drawn. cues is a reactive
    // store now (editable via resize/text-edit/slice) — draw() reads it
    // imperatively inside a plain function, not JSX, so each cue's tracked
    // fields must be read here explicitly or an edit wouldn't repaint.
    props.currentTime();
    props.activeIndex();
    props.bpm();
    containerSize();
    pxPerSecond();
    scrollOffset();
    peakData();
    props.cues.forEach((cue) => { void cue.start; void cue.end; void cue.text; });
    draw();
  });

  function onBpmInput(e) {
    const v = parseFloat(e.currentTarget.value);
    props.onBpmChange(Number.isFinite(v) && v > 0 ? v : null);
  }

  // Screen-space rect for the text-edit <input> overlaid on the block being
  // edited — tracks the same reactive inputs draw() does so it stays glued
  // to the block through pan/zoom while open.
  const editingRect = createMemo(() => {
    const i = editingIndex();
    if (i < 0 || !props.cues[i]) return null;
    const { blockY, blockH } = blockGeometry();
    const { x1, w } = cueScreenX(props.cues[i]);
    return {
      left: x1, top: blockY, width: w, height: blockH,
    };
  });

  function commitEdit(el) {
    const i = editingIndex();
    setEditingIndex(-1);
    if (i < 0) return;
    const text = el.value.trim();
    if (text && text !== props.cues[i].text) props.onEditText(i, text);
  }

  // Same step the global ArrowLeft/ArrowRight shortcuts use: one beat when
  // there's a tempo, else a flat 5s — so the buttons and keyboard agree.
  function skipStep() {
    const bpm = props.bpm();
    return bpm ? 60 / bpm : 5;
  }

  function skipBy(seconds) {
    props.onSeek(props.currentTime() + seconds);
  }

  // "Previous" mirrors typical media-player transport semantics: jump to
  // the start of the current line if we're already a moment into it,
  // otherwise to the previous line — so repeated presses step backward
  // through lines instead of always snapping back to the same one.
  const PREV_RESTART_THRESHOLD = 0.5;

  function seekPrevCue() {
    const idx = props.activeIndex();
    if (idx < 0) { props.onSeek(0); return; }
    const atCue = props.cues[idx];
    if (props.currentTime() - atCue.start > PREV_RESTART_THRESHOLD) {
      props.onSeek(atCue.start);
    } else if (idx > 0) {
      props.onSeek(props.cues[idx - 1].start);
    } else {
      props.onSeek(0);
    }
  }

  function seekNextCue() {
    const idx = props.activeIndex();
    const next = props.cues[idx + 1];
    if (next) props.onSeek(next.start);
  }

  return (
    <div id="timeline" style={{ height: `${props.height()}px` }}>
      <div id="timelineHeader">
        <div class="headerLeft">
          <div class="bpmControl">
            <span>BPM</span>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="—"
              value={props.bpm() ?? ''}
              onInput={onBpmInput}
            />
          </div>
          <div class="editControls">
            <button
              type="button"
              class="transportBtn"
              classList={{ active: props.snapEnabled() }}
              onClick={props.onToggleSnap}
              title="Snap to grid (cursor clicks and block resizing)"
            >
              ⌗
            </button>
            <button
              type="button"
              class="transportBtn"
              onClick={props.onSlice}
              title="Slice the block under the cursor in two (S)"
            >
              ✂
            </button>
          </div>
        </div>
        <div class="transportControls">
          <button type="button" class="transportBtn" onClick={seekPrevCue} title="Previous line">⏮</button>
          <button type="button" class="transportBtn" onClick={() => skipBy(-skipStep())} title="Skip back">◀◀</button>
          <PlayPauseButton playing={props.playing} onToggle={props.onToggle} />
          <button type="button" class="transportBtn" onClick={() => skipBy(skipStep())} title="Skip forward">▶▶</button>
          <button type="button" class="transportBtn" onClick={seekNextCue} title="Next line">⏭</button>
        </div>
        <div class="headerRight">
          <div class="zoomControls">
            <button type="button" onClick={() => zoomBy(1 / 1.4)} title="Zoom out">−</button>
            <button type="button" onClick={fitToWidth} title="Fit whole track">Fit</button>
            <button type="button" onClick={() => zoomBy(1.4)} title="Zoom in">+</button>
          </div>
        </div>
      </div>
      <div id="timelineBody">
        <Show when={props.usingAudio}>
          <div class="faderColumn">
            <div class="faderTrackWrap">
              <div class="faderGroove" />
              <div class="faderCap" style={{ top: `${(1 - props.volume()) * 100}%` }} />
              <input
                type="range"
                class="verticalFader"
                min="0"
                max="1"
                step="0.01"
                value={props.volume()}
                onInput={(e) => props.onVolumeChange(parseFloat(e.currentTarget.value))}
                title={`Volume ${Math.round(props.volume() * 100)}%`}
              />
            </div>
            <button
              type="button"
              class="muteBtn"
              classList={{ active: props.muted() }}
              onClick={props.onToggleMute}
              title={props.muted() ? 'Unmute' : 'Mute'}
            >
              M
            </button>
          </div>
        </Show>
        <div id="timelineMain">
          <div id="timelineViewport" ref={viewportEl}>
            <canvas id="timelineCanvas" ref={canvasEl} />
            <Show when={editingRect()}>
              {(rect) => (
                <input
                  class="blockTextEdit"
                  style={{
                    left: `${rect().left}px`,
                    top: `${rect().top}px`,
                    width: `${rect().width}px`,
                    height: `${rect().height}px`,
                  }}
                  value={props.cues[editingIndex()].text}
                  autofocus
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    else if (e.key === 'Escape') setEditingIndex(-1);
                  }}
                  onBlur={(e) => commitEdit(e.currentTarget)}
                />
              )}
            </Show>
          </div>
          <div id="timelineScrollbar" ref={scrollbarTrackEl}>
            <div
              id="timelineScrollbarThumb"
              ref={scrollbarThumbEl}
              classList={{ disabled: !thumbMetrics().scrollable }}
              style={{
                width: `${thumbMetrics().thumbWidth}px`,
                transform: `translateX(${thumbMetrics().thumbLeft}px)`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
