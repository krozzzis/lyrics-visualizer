import {
  createSignal, onCleanup, onMount, Show,
} from 'solid-js';
import { buildEditablePayload } from '../lib/editableConfig.js';

const POLL_MS = 400;

// Triggers a full-quality server-side render (the same drawFrame() path the
// CLI uses) and polls its progress. Sends the live config store, not just
// what's on disk, so an unsaved settings-panel tweak shows up in the video —
// same as it already shows up in the live preview.
export default function RenderControls(props) {
  const [status, setStatus] = createSignal('idle'); // idle | running | done | error
  const [progress, setProgress] = createSignal({ frame: 0, frameCount: 0 });
  const [error, setError] = createSignal('');
  let pollTimer;

  onCleanup(() => clearTimeout(pollTimer));

  // Pick up an in-flight or just-finished render started before this page
  // load (a reload mid-render, or a second tab) — otherwise a finished video
  // becomes unreachable until the next render overwrites it.
  onMount(poll);

  async function poll() {
    try {
      const res = await fetch('/api/render/status');
      const json = await res.json();
      if (json.status === 'idle') return;
      setStatus(json.status);
      setProgress({ frame: json.frame, frameCount: json.frameCount });
      if (json.status === 'error') {
        setError(json.error || 'Render failed');
        return;
      }
      if (json.status === 'running') pollTimer = setTimeout(poll, POLL_MS);
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  }

  async function startRender() {
    setError('');
    setProgress({ frame: 0, frameCount: 0 });
    setStatus('running');
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildEditablePayload(props.config)),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      poll();
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  }

  const pct = () => {
    const p = progress();
    return p.frameCount ? Math.round((p.frame / p.frameCount) * 100) : 0;
  };

  return (
    <div id="renderControls">
      <button
        type="button"
        class="smallBtn"
        disabled={status() === 'running'}
        onClick={startRender}
        title="Render the full video server-side, using what's on screen (saved or not)"
      >
        {status() === 'running' ? `Rendering… ${pct()}%` : 'Render video'}
      </button>
      <Show when={status() === 'done'}>
        <a class="smallBtn renderDownload" href="/api/render/download">Download</a>
      </Show>
      <Show when={status() === 'error'}>
        <span class="renderError" title={error()}>Render failed: {error()}</span>
      </Show>
    </div>
  );
}
