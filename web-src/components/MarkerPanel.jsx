import { createMemo, Show } from 'solid-js';
import { resolveConfigAt, sortMarkers } from '../../src/configMarkers.js';
import Icon from './Icon.jsx';

// Edits one config marker's local overrides — the "non-global" half of the
// settings system (see src/configMarkers.js): unlike SettingsPanel, every
// field here starts OFF (inherited from whatever's in effect just before
// this marker) and is only pinned to a specific value once its checkbox is
// turned on, so a marker only ever changes exactly the fields the user
// actually asked it to.
//
// camera/colors/style/layout are exposed — the sections drawFrame/
// buildKeyframes/computeLayout actually resolve per-time/per-cue/per-row
// (see OVERRIDABLE_SECTIONS in src/configMarkers.js). font/output stay
// global; showing them here would silently no-op.

function toNumber(raw, fallback = 0) {
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : fallback;
}

function getAtPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function Section(props) {
  return (
    <div class="settingsSection">
      <h3>{props.title}</h3>
      {props.children}
    </div>
  );
}

export default function MarkerPanel(props) {
  // What this field would resolve to if this marker didn't touch it: every
  // other marker at or before this one's time, cumulatively, on top of the
  // global config — same resolution rule drawFrame uses, just stopped one
  // marker short.
  const inherited = createMemo(() => {
    const others = props.markers.filter((m) => m.id !== props.marker.id && m.time <= props.marker.time);
    return resolveConfigAt(props.config, sortMarkers(others), props.marker.time);
  });

  function hasOverride(path) {
    return getAtPath(props.marker.overrides, path) !== undefined;
  }

  function effectiveValue(path) {
    const own = getAtPath(props.marker.overrides, path);
    return own !== undefined ? own : getAtPath(inherited(), path);
  }

  function OverrideRow(rowProps) {
    return (
      <div class="settingsRow markerOverrideRow">
        <label class="overrideToggle">
          <input
            type="checkbox"
            checked={hasOverride(rowProps.path)}
            onChange={(e) => props.onSetOverride(
              rowProps.path,
              e.currentTarget.checked ? effectiveValue(rowProps.path) : undefined,
            )}
          />
          <span>{rowProps.label}</span>
        </label>
        <Show when={hasOverride(rowProps.path)}>{rowProps.children}</Show>
      </div>
    );
  }

  return (
    <aside id="settingsPanel" style={{ width: `${props.width()}px` }}>
      <div id="settingsHeader">
        <span>Marker</span>
        <button type="button" class="smallBtn" onClick={props.onDelete}><Icon name="delete" />Delete</button>
      </div>

      <div id="settingsBody">
        <Section title="Position">
          <label class="settingsRow">
            <span>Time (s)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={props.marker.time}
              onInput={(e) => props.onSetTime(toNumber(e.currentTarget.value, props.marker.time))}
            />
          </label>
        </Section>

        <Section title="Camera">
          <OverrideRow label="Anchor" path={['camera', 'anchor']}>
            <select
              value={effectiveValue(['camera', 'anchor'])}
              onChange={(e) => props.onSetOverride(['camera', 'anchor'], e.currentTarget.value)}
            >
              <option value="center">center</option>
              <option value="start">start</option>
            </select>
          </OverrideRow>
          <OverrideRow label="Jump duration (s)" path={['camera', 'jumpDuration']}>
            <input type="number" step="0.01" min="0.01" value={effectiveValue(['camera', 'jumpDuration'])}
              onInput={(e) => props.onSetOverride(['camera', 'jumpDuration'], toNumber(e.currentTarget.value, effectiveValue(['camera', 'jumpDuration'])))} />
          </OverrideRow>
          <OverrideRow label="Easing" path={['camera', 'easing']}>
            <select
              value={effectiveValue(['camera', 'easing'])}
              onChange={(e) => props.onSetOverride(['camera', 'easing'], e.currentTarget.value)}
            >
              <option value="easeOutBack">easeOutBack</option>
              <option value="spring">spring</option>
              <option value="linear">linear</option>
            </select>
          </OverrideRow>
          <OverrideRow label="Overshoot" path={['camera', 'overshoot']}>
            <input type="number" step="0.1" value={effectiveValue(['camera', 'overshoot'])}
              onInput={(e) => props.onSetOverride(['camera', 'overshoot'], toNumber(e.currentTarget.value, effectiveValue(['camera', 'overshoot'])))} />
          </OverrideRow>
          <OverrideRow label="Zoom punch enabled" path={['camera', 'zoom', 'enabled']}>
            <input type="checkbox" checked={effectiveValue(['camera', 'zoom', 'enabled'])}
              onChange={(e) => props.onSetOverride(['camera', 'zoom', 'enabled'], e.currentTarget.checked)} />
          </OverrideRow>
          <OverrideRow label="Zoom amount (1 = none)" path={['camera', 'zoom', 'amount']}>
            <input type="number" step="0.01" min="0.1" max="1" value={effectiveValue(['camera', 'zoom', 'amount'])}
              onInput={(e) => props.onSetOverride(['camera', 'zoom', 'amount'], toNumber(e.currentTarget.value, effectiveValue(['camera', 'zoom', 'amount'])))} />
          </OverrideRow>
          <OverrideRow label="Zoom out fraction" path={['camera', 'zoom', 'outFraction']}>
            <input type="number" step="0.05" min="0.05" max="0.9" value={effectiveValue(['camera', 'zoom', 'outFraction'])}
              onInput={(e) => props.onSetOverride(['camera', 'zoom', 'outFraction'], toNumber(e.currentTarget.value, effectiveValue(['camera', 'zoom', 'outFraction'])))} />
          </OverrideRow>
        </Section>

        <Section title="Layout">
          <OverrideRow label="Mode" path={['layout', 'mode']}>
            <select
              value={effectiveValue(['layout', 'mode'])}
              onChange={(e) => props.onSetOverride(['layout', 'mode'], e.currentTarget.value)}
            >
              <option value="flow">flow (one long line)</option>
              <option value="stacked">stacked (logical lines)</option>
            </select>
          </OverrideRow>
          <OverrideRow label="Word gap (px)" path={['layout', 'wordGap']}>
            <input type="number" step="1" value={effectiveValue(['layout', 'wordGap'])}
              onInput={(e) => props.onSetOverride(['layout', 'wordGap'], toNumber(e.currentTarget.value, effectiveValue(['layout', 'wordGap'])))} />
          </OverrideRow>
          <OverrideRow label="Cue gap (px)" path={['layout', 'cueGap']}>
            <input type="number" step="1" value={effectiveValue(['layout', 'cueGap'])}
              onInput={(e) => props.onSetOverride(['layout', 'cueGap'], toNumber(e.currentTarget.value, effectiveValue(['layout', 'cueGap'])))} />
          </OverrideRow>
          <OverrideRow label="Row height (× font size)" path={['layout', 'lineHeight']}>
            <input type="number" step="0.1" min="0.5" value={effectiveValue(['layout', 'lineHeight'])}
              onInput={(e) => props.onSetOverride(['layout', 'lineHeight'], toNumber(e.currentTarget.value, effectiveValue(['layout', 'lineHeight'])))} />
          </OverrideRow>
          <OverrideRow label="Show previous line" path={['layout', 'showPrevLine']}>
            <input type="checkbox" checked={effectiveValue(['layout', 'showPrevLine'])}
              onChange={(e) => props.onSetOverride(['layout', 'showPrevLine'], e.currentTarget.checked)} />
          </OverrideRow>
          <OverrideRow label="Show next line" path={['layout', 'showNextLine']}>
            <input type="checkbox" checked={effectiveValue(['layout', 'showNextLine'])}
              onChange={(e) => props.onSetOverride(['layout', 'showNextLine'], e.currentTarget.checked)} />
          </OverrideRow>
          <OverrideRow label="Next line starts from" path={['layout', 'nextLineFrom']}>
            <select
              value={effectiveValue(['layout', 'nextLineFrom'])}
              onChange={(e) => props.onSetOverride(['layout', 'nextLineFrom'], e.currentTarget.value)}
            >
              <option value="start">start (shared left edge)</option>
              <option value="end">end (continues under current line)</option>
            </select>
          </OverrideRow>
        </Section>

        <Section title="Colors">
          <OverrideRow label="Text" path={['colors', 'text']}>
            <div class="colorRow">
              <span class="colorSwatch" style={{ background: effectiveValue(['colors', 'text']) }} />
              <input type="text" value={effectiveValue(['colors', 'text'])}
                onInput={(e) => props.onSetOverride(['colors', 'text'], e.currentTarget.value)} />
            </div>
          </OverrideRow>
          <OverrideRow label="Background" path={['colors', 'background']}>
            <div class="colorRow">
              <span class="colorSwatch" style={{ background: effectiveValue(['colors', 'background']) }} />
              <input type="text" value={effectiveValue(['colors', 'background'])}
                onInput={(e) => props.onSetOverride(['colors', 'background'], e.currentTarget.value)} />
            </div>
          </OverrideRow>
        </Section>

        <Section title="Line opacity">
          <OverrideRow label="Active" path={['style', 'activeOpacity']}>
            <input type="number" step="0.05" min="0" max="1" value={effectiveValue(['style', 'activeOpacity'])}
              onInput={(e) => props.onSetOverride(['style', 'activeOpacity'], toNumber(e.currentTarget.value, effectiveValue(['style', 'activeOpacity'])))} />
          </OverrideRow>
          <OverrideRow label="Inactive" path={['style', 'inactiveOpacity']}>
            <input type="number" step="0.05" min="0" max="1" value={effectiveValue(['style', 'inactiveOpacity'])}
              onInput={(e) => props.onSetOverride(['style', 'inactiveOpacity'], toNumber(e.currentTarget.value, effectiveValue(['style', 'inactiveOpacity'])))} />
          </OverrideRow>
        </Section>

        <Section title="Text exit (after cue ends)">
          <OverrideRow label="Type" path={['style', 'cueExit', 'type']}>
            <select
              value={effectiveValue(['style', 'cueExit', 'type'])}
              onChange={(e) => props.onSetOverride(['style', 'cueExit', 'type'], e.currentTarget.value)}
            >
              <option value="none">none</option>
              <option value="opacity">opacity</option>
              <option value="slide">slide</option>
              <option value="scale">scale</option>
            </select>
          </OverrideRow>
          <OverrideRow label="Delay (s)" path={['style', 'cueExit', 'delay']}>
            <input type="number" step="0.05" min="0" value={effectiveValue(['style', 'cueExit', 'delay'])}
              onInput={(e) => props.onSetOverride(['style', 'cueExit', 'delay'], toNumber(e.currentTarget.value, effectiveValue(['style', 'cueExit', 'delay'])))} />
          </OverrideRow>
          <OverrideRow label="Duration (s)" path={['style', 'cueExit', 'duration']}>
            <input type="number" step="0.05" min="0.01" value={effectiveValue(['style', 'cueExit', 'duration'])}
              onInput={(e) => props.onSetOverride(['style', 'cueExit', 'duration'], toNumber(e.currentTarget.value, effectiveValue(['style', 'cueExit', 'duration'])))} />
          </OverrideRow>
        </Section>

        <Section title="Fade out (superseded lines/words)">
          <OverrideRow label="Type" path={['style', 'fadeOut', 'type']}>
            <select
              value={effectiveValue(['style', 'fadeOut', 'type'])}
              onChange={(e) => props.onSetOverride(['style', 'fadeOut', 'type'], e.currentTarget.value)}
            >
              <option value="none">none</option>
              <option value="opacity">opacity</option>
              <option value="slide">slide</option>
              <option value="scale">scale</option>
            </select>
          </OverrideRow>
          <OverrideRow label="Granularity" path={['style', 'fadeOut', 'granularity']}>
            <select
              value={effectiveValue(['style', 'fadeOut', 'granularity'])}
              onChange={(e) => props.onSetOverride(['style', 'fadeOut', 'granularity'], e.currentTarget.value)}
            >
              <option value="cue">cue</option>
              <option value="line">line</option>
              <option value="word">word</option>
            </select>
          </OverrideRow>
          <OverrideRow label="Delay (s)" path={['style', 'fadeOut', 'delay']}>
            <input type="number" step="0.05" min="0" value={effectiveValue(['style', 'fadeOut', 'delay'])}
              onInput={(e) => props.onSetOverride(['style', 'fadeOut', 'delay'], toNumber(e.currentTarget.value, effectiveValue(['style', 'fadeOut', 'delay'])))} />
          </OverrideRow>
          <OverrideRow label="Duration (s)" path={['style', 'fadeOut', 'duration']}>
            <input type="number" step="0.05" min="0.01" value={effectiveValue(['style', 'fadeOut', 'duration'])}
              onInput={(e) => props.onSetOverride(['style', 'fadeOut', 'duration'], toNumber(e.currentTarget.value, effectiveValue(['style', 'fadeOut', 'duration'])))} />
          </OverrideRow>
          <OverrideRow label="Word stagger (s)" path={['style', 'fadeOut', 'wordStagger']}>
            <input type="number" step="0.01" min="0" value={effectiveValue(['style', 'fadeOut', 'wordStagger'])}
              onInput={(e) => props.onSetOverride(['style', 'fadeOut', 'wordStagger'], toNumber(e.currentTarget.value, effectiveValue(['style', 'fadeOut', 'wordStagger'])))} />
          </OverrideRow>
        </Section>

        <p class="settingsNote">
          Check a field to pin it from this point on the timeline; leave it
          unchecked to keep following the global config (or an earlier
          marker). Changes save immediately — no separate Save step.
        </p>
      </div>

      <button type="button" class="smallBtn closeMarkerPanel" onClick={props.onClose}><Icon name="close" />Close</button>
    </aside>
  );
}
