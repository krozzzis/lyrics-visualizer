import { For, createEffect } from 'solid-js';
import { formatTime } from '../lib/format.js';

export default function Sidebar(props) {
  const itemRefs = [];

  createEffect(() => {
    const idx = props.activeIndex();
    const el = itemRefs[idx];
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  return (
    <aside id="sidebar" style={{ width: `${props.width()}px` }}>
      <div id="sidebarHeader">Lines</div>
      <ul id="cueList">
        <For each={props.cues}>
          {(cue, i) => (
            <li
              classList={{ active: props.activeIndex() === i() }}
              onClick={() => props.onSeek(cue.start)}
              ref={(el) => { itemRefs[i()] = el; }}
            >
              <span class="cueTime">{formatTime(cue.start)}</span>
              <span class="cueText">{cue.text}</span>
            </li>
          )}
        </For>
      </ul>
    </aside>
  );
}
