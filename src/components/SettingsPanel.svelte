<script lang="ts">
  import HostedSettings from './HostedSettings.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import { hosted, mode } from '../lib/backend.svelte';
  import { BACKGROUNDS, IMAGE_BACKGROUND } from '../lib/backgrounds';
  import { bookmarks } from '../lib/bookmarks.svelte';
  import { ACCENTS, SEARCH_ENGINES, type Settings, type ThemeMode } from '../lib/settings';
  import { settings } from '../lib/settings-store.svelte';
  import { STYLES, styleDef } from '../lib/styles';
  import { listFolders, pathKey, SETTINGS_FOLDER_TITLE } from '../lib/tree';
  import { panel } from '../lib/ui.svelte';

  let { resolvedTheme }: { resolvedTheme: 'light' | 'dark' } = $props();

  const s = $derived(settings.value);
  const look = $derived(styleDef(s.style));
  const set = (patch: Partial<Settings>) => settings.update(patch);

  const folders = $derived(bookmarks.tree ? listFolders(bookmarks.tree) : []);
  const rootKey = $derived(s.rootPath ? pathKey(s.rootPath) : '');
  const customEngine = $derived(!SEARCH_ENGINES.some((e) => e.url === s.searchEngine));

  const themes: { id: ThemeMode; label: string; icon: IconName }[] = [
    { id: 'auto', label: 'Auto', icon: 'monitor' },
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];

  const syncLabel = $derived.by(() => {
    switch (settings.status) {
      case 'pending':
      case 'saving':
        return 'Saving…';
      case 'synced':
        return hosted ? 'Saved to your FlexiHome server' : 'Saved to your bookmarks';
      case 'error':
        return `Couldn't save: ${settings.error}`;
      default:
        return 'Using defaults — change anything to start syncing';
    }
  });

  function close() {
    panel.settingsOpen = false;
  }

  function onRoot(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    set({ rootPath: v ? (JSON.parse(v) as string[]) : null });
  }

  function onEngine(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    set({ searchEngine: v === 'custom' ? 'https://example.com/search?q=%s' : v });
  }
</script>

<svelte:window onkeydown={(e) => panel.settingsOpen && e.key === 'Escape' && close()} />

<div class="scrim" class:open={panel.settingsOpen} onclick={close} aria-hidden="true"></div>

<aside class="drawer" class:open={panel.settingsOpen} aria-label="Settings" inert={!panel.settingsOpen}>
  <header>
    <h2>Settings</h2>
    <button class="icon-btn" aria-label="Close settings" onclick={close}><Icon name="x" /></button>
  </header>

  <div class="scroll">
    <section>
      <h3>Home</h3>
      <label class="field">
        <span>Home folder</span>
        <select class="input" value={rootKey} onchange={onRoot}>
          <option value="">Automatic (first folder with bookmarks)</option>
          {#each folders as f (f.node.id)}
            <option value={pathKey(f.path)}>{' '.repeat(f.depth - 1)}{f.node.title || 'Untitled'}</option>
          {/each}
        </select>
        <small>Its folders become cards; loose bookmarks are pinned at the top.</small>
      </label>
      <label class="switch">
        <input type="checkbox" checked={s.openInNewTab} onchange={(e) => set({ openInNewTab: e.currentTarget.checked })} />
        <span>Open links in a new tab</span>
      </label>
    </section>

    <section>
      <h3>Appearance</h3>
      <div class="field">
        <span>Style</span>
        <div class="styles" role="radiogroup" aria-label="Style">
          {#each STYLES as st (st.id)}
            <button class="style" role="radio" aria-checked={s.style === st.id} class:on={s.style === st.id} onclick={() => set({ style: st.id })}>
              <span class="style-swatch" style:background={st.swatch}></span>
              <strong>{st.label}</strong>
              <small>{st.description}</small>
            </button>
          {/each}
        </div>
      </div>

      {#if look.animated}
        <label class="switch">
          <input type="checkbox" checked={s.effects} onchange={(e) => set({ effects: e.currentTarget.checked })} />
          <span>Animated effects <small>(background motion and hover effects)</small></span>
        </label>
      {/if}
      <label class="switch">
        <input type="checkbox" checked={s.previews} onchange={(e) => set({ previews: e.currentTarget.checked })} />
        <span>Preview links when you rest the pointer on them</span>
      </label>

      {#if look.themes.length > 1}
        <div class="field">
          <span>Theme</span>
          <div class="segmented" role="radiogroup" aria-label="Theme">
            {#each themes as t (t.id)}
              <button role="radio" aria-checked={s.theme === t.id} class:on={s.theme === t.id} onclick={() => set({ theme: t.id })}>
                <Icon name={t.icon} size={15} />
                {t.label}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if !look.accent}
        <div class="field">
          <span>Accent</span>
          <div class="swatches">
            {#each ACCENTS as c (c)}
              <button
                class="swatch"
                class:on={s.accent === c}
                style:background={c}
                aria-label="Accent {c}"
                aria-pressed={s.accent === c}
                onclick={() => set({ accent: c })}
              ></button>
            {/each}
            <label class="swatch custom" title="Custom colour" class:on={!ACCENTS.includes(s.accent)}>
              <input type="color" value={s.accent} onchange={(e) => set({ accent: e.currentTarget.value })} />
              <Icon name="plus" size={14} />
            </label>
          </div>
        </div>
      {/if}

      {#if look.customBackground}
        <div class="field">
          <span>Background</span>
          <div class="backgrounds">
            {#each BACKGROUNDS as b (b.id)}
              <button
                class="bg"
                class:on={s.background === b.id}
                style:background={b[resolvedTheme]}
                aria-pressed={s.background === b.id}
                onclick={() => set({ background: b.id })}
              >
                <span>{b.label}</span>
              </button>
            {/each}
            <button
              class="bg image"
              class:on={s.background === IMAGE_BACKGROUND}
              style:background-image={s.backgroundImage ? `url("${s.backgroundImage.replace(/"/g, '')}")` : undefined}
              aria-pressed={s.background === IMAGE_BACKGROUND}
              onclick={() => set({ background: IMAGE_BACKGROUND })}
            >
              <span>Image</span>
            </button>
          </div>
        </div>

        {#if s.background === IMAGE_BACKGROUND}
          <label class="field">
            <span>Image URL</span>
            <input
              class="input"
              type="url"
              placeholder="https://images.unsplash.com/…"
              value={s.backgroundImage}
              onchange={(e) => set({ backgroundImage: e.currentTarget.value.trim() })}
            />
          </label>
          <label class="field">
            <span>Dim image · {Math.round(s.dim * 100)}%</span>
            <input type="range" min="0" max="0.8" step="0.05" value={s.dim} oninput={(e) => set({ dim: +e.currentTarget.value })} />
          </label>
        {/if}
      {/if}

      <label class="field">
        <span>Card width · {s.cardWidth}px</span>
        <input type="range" min="220" max="440" step="10" value={s.cardWidth} oninput={(e) => set({ cardWidth: +e.currentTarget.value })} />
      </label>

      <div class="field">
        <span>Density</span>
        <div class="segmented" role="radiogroup" aria-label="Density">
          {#each ['comfortable', 'compact'] as const as dn (dn)}
            <button role="radio" aria-checked={s.density === dn} class:on={s.density === dn} onclick={() => set({ density: dn })}>
              {dn === 'comfortable' ? 'Comfortable' : 'Compact'}
            </button>
          {/each}
        </div>
      </div>

      <label class="field">
        <span>Bookmarks shown per card before “Show more” · {s.previewLimit}</span>
        <input type="range" min="3" max="40" step="1" value={s.previewLimit} oninput={(e) => set({ previewLimit: +e.currentTarget.value })} />
      </label>
    </section>

    <section>
      <h3>To-do list</h3>
      <label class="switch">
        <input type="checkbox" checked={s.showTodos} onchange={(e) => set({ showTodos: e.currentTarget.checked })} />
        <span>Show to-do list</span>
      </label>
    </section>

    <section>
      <h3>Header</h3>
      <label class="switch">
        <input type="checkbox" checked={s.showClock} onchange={(e) => set({ showClock: e.currentTarget.checked })} />
        <span>Show clock and date</span>
      </label>
      <label class="switch" class:disabled={!s.showClock}>
        <input type="checkbox" checked={s.clock24h} disabled={!s.showClock} onchange={(e) => set({ clock24h: e.currentTarget.checked })} />
        <span>24-hour clock</span>
      </label>
      <label class="switch">
        <input type="checkbox" checked={s.showGreeting} onchange={(e) => set({ showGreeting: e.currentTarget.checked })} />
        <span>Show greeting</span>
      </label>
      <label class="field">
        <span>Your name</span>
        <input class="input" value={s.name} placeholder="Optional" onchange={(e) => set({ name: e.currentTarget.value })} />
      </label>
    </section>

    <section>
      <h3>Search</h3>
      <label class="field">
        <span>Web search</span>
        <select class="input" value={customEngine ? 'custom' : s.searchEngine} onchange={onEngine}>
          {#each SEARCH_ENGINES as e (e.url)}
            <option value={e.url}>{e.label}</option>
          {/each}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {#if customEngine}
        <label class="field">
          <span>Search URL (use %s for the query)</span>
          <input
            class="input"
            value={s.searchEngine}
            spellcheck="false"
            onchange={(e) => e.currentTarget.value.includes('%s') && set({ searchEngine: e.currentTarget.value.trim() })}
          />
        </label>
      {/if}
    </section>

    <section>
      <h3>Sync</h3>
      <p class="sync" class:error={settings.status === 'error'}>
        <Icon name={settings.status === 'error' ? 'cloud-off' : 'cloud'} size={16} />
        <span>{syncLabel}</span>
      </p>
      <p class="note">
        {#if hosted}
          Settings are kept on your FlexiHome server, so every browser and device that signs in here shares them.
        {:else}
          Settings are stored in a bookmark folder called <em>{SETTINGS_FOLDER_TITLE}</em> under Other bookmarks, so Vivaldi Sync
          carries them to your other machines with your bookmarks.
        {/if}
      </p>
      <div class="row">
        <button class="btn" onclick={() => settings.push()}><Icon name="refresh" size={15} /> Save now</button>
        <button class="btn" onclick={() => settings.reset()}>Reset to defaults</button>
      </div>
    </section>

    {#if hosted}<HostedSettings />{/if}

    {#if mode === 'extension'}
      <section>
        <h3>Your own site</h3>
        <p class="note">
          If you host FlexiHome as a site, this browser can keep its bookmarks in step with it, so the same page works on your phone
          and in other browsers.
        </p>
        <div class="row">
          <button class="btn" onclick={() => chrome.runtime.openOptionsPage()}><Icon name="link" size={15} /> Link to a FlexiHome site</button>
        </div>
      </section>
    {/if}

    <section class="about">
      <p>Tip: start typing anywhere to search · drag cards and bookmarks to rearrange · drop a link from the address bar onto a card to save it.</p>
    </section>
  </div>
</aside>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
    background: rgba(8, 10, 16, 0.28);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
  }
  .scrim.open {
    opacity: 1;
    pointer-events: auto;
  }
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 31;
    width: min(400px, 100vw);
    display: flex;
    flex-direction: column;
    background: var(--surface-solid);
    border-left: 1px solid var(--border);
    box-shadow: var(--shadow-pop);
    translate: 100% 0;
    transition: translate 0.28s var(--ease);
  }
  .drawer.open {
    translate: 0 0;
  }
  /* Parked off-screen, its shadow would still fall across the page's right edge. */
  .drawer:not(.open) {
    box-shadow: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 18px 10px 22px;
  }
  h2 {
    margin: 0;
    font: 600 19px/1.2 var(--font-display);
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 22px 28px;
  }
  section {
    display: grid;
    gap: 14px;
    padding: 18px 0;
    border-bottom: 1px solid var(--border);
  }
  section:last-child {
    border-bottom: 0;
  }
  h3 {
    margin: 0;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  small,
  .note,
  .about p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-muted);
  }
  .segmented {
    display: flex;
    padding: 3px;
    gap: 3px;
    border-radius: 10px;
    background: var(--hover);
  }
  .segmented button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    font-weight: 500;
  }
  .segmented button.on {
    background: var(--surface-solid);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .swatch {
    position: relative;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
    transition: transform 0.12s;
  }
  .swatch:hover {
    transform: scale(1.1);
  }
  .swatch.on {
    box-shadow: 0 0 0 2px var(--surface-solid), 0 0 0 4px var(--text);
  }
  .swatch.custom {
    display: grid;
    place-items: center;
    background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
    color: #fff;
    cursor: pointer;
  }
  .swatch.custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .styles {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .style {
    display: grid;
    align-content: start;
    gap: 3px;
    padding: 6px 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: transparent;
    text-align: left;
    transition: border-color 0.15s;
  }
  .style:hover {
    border-color: color-mix(in oklab, var(--accent) 50%, var(--border-strong));
  }
  .style.on {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .style-swatch {
    height: 64px;
    margin-bottom: 5px;
    border-radius: 8px;
  }
  .style strong {
    padding: 0 4px;
    font-size: 13px;
  }
  .style small {
    padding: 0 4px;
    font-size: 11.5px;
  }
  .switch small {
    color: var(--text-faint);
  }
  .backgrounds {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .bg {
    position: relative;
    height: 58px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background-size: cover;
    background-position: center;
    overflow: hidden;
  }
  .bg span {
    position: absolute;
    left: 6px;
    bottom: 5px;
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--surface-solid);
    font-size: 11px;
    font-weight: 600;
  }
  .bg.image {
    background-color: var(--hover);
  }
  .bg.on {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  .switch.disabled {
    opacity: 0.5;
  }
  .switch input {
    appearance: none;
    flex: none;
    position: relative;
    width: 36px;
    height: 20px;
    margin: 0;
    border-radius: 999px;
    background: var(--active);
    transition: background 0.15s;
    cursor: inherit;
  }
  .switch input::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: translate 0.15s var(--ease);
  }
  .switch input:checked {
    background: var(--accent);
  }
  .switch input:checked::after {
    translate: 16px 0;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .sync {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-weight: 500;
  }
  .sync :global(svg) {
    color: var(--accent);
  }
  .sync.error,
  .sync.error :global(svg) {
    color: var(--danger);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
