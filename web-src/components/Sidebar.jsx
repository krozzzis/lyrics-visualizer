import { For, createEffect, createSignal } from 'solid-js';
import { formatTime } from '../lib/format.js';

export default function Sidebar(props) {
  const itemRefs = [];
  const [editingIndex, setEditingIndex] = createSignal(null);

  createEffect(() => {
    const idx = props.activeIndex();
    const el = itemRefs[idx];
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  function startEdit(i) {
    setEditingIndex(i);
  }

  function commitEdit(i, el) {
    const text = el.value.trim();
    setEditingIndex(null);
    if (text && text !== props.cues[i].text) props.onEditText(i, text);
  }

  return (
    <aside id="sidebar" style={{ width: `${props.width()}px` }}>
      <div id="sidebarHeader">Lines</div>
      <ul id="cueList">
        <For each={props.cues}>
          {(cue, i) => (
            <li
              classList={{ active: props.activeIndex() === i() }}
              onClick={() => { if (editingIndex() !== i()) props.onSeek(cue.start); }}
              ref={(el) => { itemRefs[i()] = el; }}
            >
              <span class="cueTime">{formatTime(cue.start)}</span>
              {editingIndex() === i() ? (
                <input
                  class="cueTextEdit"
                  value={cue.text}
                  autofocus
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    else if (e.key === 'Escape') { setEditingIndex(null); }
                  }}
                  onBlur={(e) => commitEdit(i(), e.currentTarget)}
                />
              ) : (
                <span
                  class="cueText"
                  onDblClick={(e) => { e.stopPropagation(); startEdit(i()); }}
                >
                  {cue.text}
                </span>
              )}
            </li>
          )}
        </For>
      </ul>
    </aside>
  );
}
