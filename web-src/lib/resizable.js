import { createSignal } from 'solid-js';

const STORAGE_PREFIX = 'lyricsVisualizer.panelSize.';

function loadSize(key, fallback) {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    const n = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function saveSize(key, value) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, String(value));
  } catch {
    // Private browsing / quota exceeded — resizing still works for this session.
  }
}

// A draggable panel dimension backed by a Solid signal, persisted to
// localStorage on release. `axis` picks clientX vs clientY; `invert` flips
// drag direction for handles on a panel's leading edge, where dragging
// toward the panel (a smaller/negative delta) should grow it.
export function createResizablePanel(key, {
  defaultSize, min, max, axis = 'x', invert = false,
}) {
  const [size, setSize] = createSignal(loadSize(key, defaultSize));

  function clamp(v) {
    return Math.min(max, Math.max(min, v));
  }

  function onHandlePointerDown(e) {
    e.preventDefault();
    const startPos = axis === 'x' ? e.clientX : e.clientY;
    const startSize = size();
    const handleEl = e.currentTarget;
    handleEl.setPointerCapture(e.pointerId);

    function onMove(ev) {
      const pos = axis === 'x' ? ev.clientX : ev.clientY;
      const delta = (pos - startPos) * (invert ? -1 : 1);
      setSize(clamp(startSize + delta));
    }

    function onUp() {
      handleEl.removeEventListener('pointermove', onMove);
      handleEl.removeEventListener('pointerup', onUp);
      saveSize(key, size());
    }

    handleEl.addEventListener('pointermove', onMove);
    handleEl.addEventListener('pointerup', onUp);
  }

  return { size, onHandlePointerDown };
}
