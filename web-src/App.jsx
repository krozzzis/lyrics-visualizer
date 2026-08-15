import { createSignal, onMount, Show } from 'solid-js';
import Player from './Player.jsx';

export default function App() {
  const [data, setData] = createSignal(null);
  const [error, setError] = createSignal(null);

  onMount(async () => {
    try {
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error(`GET /api/data → ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    }
  });

  return (
    <Show
      when={!error()}
      fallback={<div class="loadingScreen">Failed to load: {error()}</div>}
    >
      <Show when={data()} fallback={<div class="loadingScreen">Loading…</div>}>
        {(d) => <Player config={d().config} cues={d().cues} />}
      </Show>
    </Show>
  );
}
