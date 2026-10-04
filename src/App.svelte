<script lang="ts">
  import Backdrop from './components/Backdrop.svelte';
  import Clock from './components/Clock.svelte';
  import Dialogs from './components/Dialogs.svelte';
  import FolderCard from './components/FolderCard.svelte';
  import Icon from './components/Icon.svelte';
  import LinkPreview from './components/LinkPreview.svelte';
  import PinnedRow from './components/PinnedRow.svelte';
  import SearchBar from './components/SearchBar.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import Toasts from './components/Toasts.svelte';
  import { IMAGE_BACKGROUND, backgroundCss } from './lib/backgrounds';
  import { bookmarks } from './lib/bookmarks.svelte';
  import { settings } from './lib/settings-store.svelte';
  import { styleDef } from './lib/styles';
  import { arrangeColumns, moveBetweenColumns } from './lib/layout';
  import { collectLinks, depthOf, isFolder, pathKey, pathTo, resolveHome, visibleChildren, type BNode } from './lib/tree';
  import { clearHint, drag, endDrag, hint, openDialog, panel, setHint } from './lib/ui.svelte';

  const s = $derived(settings.value);
  const look = $derived(styleDef(s.style));

  // ---- theme ----
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let systemDark = $state(media.matches);
  media.addEventListener('change', (e) => (systemDark = e.matches));
  const theme = $derived.by<'light' | 'dark'>(() => {
    if (look.themes.length === 1) return look.themes[0];
    return s.theme === 'auto' ? (systemDark ? 'dark' : 'light') : s.theme;
  });
  const accent = $derived(look.accent ?? s.accent);

  /** Pick black or white text for the accent so buttons stay readable with pale accents. */
  function inkFor(hex: string): string {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111827' : '#ffffff';
  }

  $effect(() => {
    const root = document.documentElement;
    root.style.background = ''; // boot.js's pre-paint colour; the stylesheet takes over now
    root.dataset.theme = theme;
    root.dataset.style = look.id;
    root.dataset.ink = look.customBackground && s.background === IMAGE_BACKGROUND && s.backgroundImage ? 'light' : '';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-ink', inkFor(accent));
    root.style.setProperty('--card-w', `${s.cardWidth}px`);
    root.style.setProperty('--row-h', s.density === 'compact' ? '28px' : '32px');
  });

  $effect(() => {
    document.body.classList.toggle('is-dragging', drag.active);
  });

  const background = $derived(backgroundCss(s.background, theme, s.backgroundImage, s.dim));

  // ---- bookmarks ----
  $effect(() => {
    void bookmarks.load();
    bookmarks.listen();
  });

  const home = $derived(bookmarks.tree ? resolveHome(bookmarks.tree, s.rootPath) : null);
  const homeDepth = $derived(home && bookmarks.tree ? depthOf(bookmarks.tree, home.node.id) : 0);
  const homePath = $derived(home && bookmarks.tree ? (pathTo(bookmarks.tree, home.node.id) ?? []) : []);
  const children = $derived(home ? visibleChildren(home.node, homeDepth) : []);
  const pinned = $derived(children.filter((c) => !isFolder(c)));
  const cards = $derived(children.filter(isFolder));
  const allLinks = $derived(bookmarks.tree ? collectLinks(bookmarks.tree) : []);

  // ---- masonry ----
  // Cards sit in the columns the user arranged them into (see lib/layout.ts);
  // until they've moved one, they're dealt round-robin.
  const GAP = 16;
  let gridWidth = $state(0);
  const columnCount = $derived(Math.max(1, Math.floor((gridWidth + GAP) / (s.cardWidth + GAP))));
  const cardKey = (card: BNode) => pathKey([...homePath, card.title]);
  const columns = $derived(arrangeColumns(cards, cardKey, s.cardLayout, columnCount));

  // ---- moving cards ----
  // The whole grid is one drop target, so there are no dead zones: the nearest
  // column wins, and the slot is how many of its other cards' midpoints are above
  // the pointer. That includes the empty space under a short column.
  const columnEls: HTMLElement[] = [];

  function slotAt(e: DragEvent) {
    let col = 0;
    let best = Infinity;
    columnEls.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dist = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      if (dist < best) [best, col] = [dist, i];
    });
    const others = [...columnEls[col].querySelectorAll<HTMLElement>(':scope > [data-card-id]')].filter(
      (el) => el.dataset.cardId !== drag.item?.id,
    );
    const index = others.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2 < e.clientY;
    }).length;
    return { col, index, others };
  }

  function onGridOver(e: DragEvent) {
    if (!drag.item?.isCard) return;
    e.preventDefault();
    const { col, index, others } = slotAt(e);
    if (index < others.length) setHint(others[index].dataset.cardId!, 'before');
    else if (others.length) setHint(others[others.length - 1].dataset.cardId!, 'after');
    else setHint(`column:${col}`, 'inside');
  }

  function onGridDrop(e: DragEvent) {
    if (!drag.item?.isCard) return;
    e.preventDefault();
    const id = drag.item.id;
    const to = slotAt(e);
    endDrag();
    const fromCol = columns.findIndex((c) => c.some((n) => n.id === id));
    if (fromCol < 0) return;
    const from = { col: fromCol, index: columns[fromCol].findIndex((n) => n.id === id) };
    if (from.col === to.col && from.index === to.index) return;
    const next = moveBetweenColumns(columns, from, to);
    settings.update({ cardLayout: next.map((c) => c.map(cardKey)) });
  }

  function onGridLeave(e: DragEvent) {
    if (drag.item?.isCard && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) clearHint();
  }
</script>

<!-- Shown in place of any section that throws, so one bad bookmark can't blank the page. -->
{#snippet crashed(what: string, error: unknown, reset: () => void)}
  <div class="notice crash" role="alert">
    Couldn't show {what}: <code>{error instanceof Error ? error.message : String(error)}</code>
    <button class="link-btn" onclick={reset}>Retry</button>
  </div>
{/snippet}

<Backdrop style={look.id} css={background} animate={s.effects} />

<div class="toolbar">
  {#if home}
    <button class="tb-btn glass" onclick={() => openDialog({ kind: 'folder', mode: 'create', parentId: home.node.id })} title="New folder">
      <Icon name="folder-plus" size={16} />
      <span>New folder</span>
    </button>
  {/if}
  <button class="tb-btn glass icon-only" onclick={() => (panel.settingsOpen = true)} title="Settings" aria-label="Settings">
    <Icon name="sliders" size={17} />
  </button>
</div>

<main>
  <header class="hero">
    <svelte:boundary onerror={(e) => console.error('[FlexiHome] clock', e)}>
      <Clock />
      {#snippet failed(error, reset)}{@render crashed('the clock', error, reset)}{/snippet}
    </svelte:boundary>
    <svelte:boundary onerror={(e) => console.error('[FlexiHome] search', e)}>
      <SearchBar links={allLinks} />
      {#snippet failed(error, reset)}{@render crashed('search', error, reset)}{/snippet}
    </svelte:boundary>
  </header>

  {#if bookmarks.error}
    <p class="notice">Couldn't read bookmarks: {bookmarks.error}</p>
  {:else if home}
    {#if home.missing}
      <p class="notice">
        Your home folder <strong>{s.rootPath?.join(' › ')}</strong> wasn't found, so the bookmark bar is shown instead.
        <button class="link-btn" onclick={() => (panel.settingsOpen = true)}>Choose another</button>
      </p>
    {/if}

    <svelte:boundary onerror={(e) => console.error('[FlexiHome] pinned', e)}>
      <PinnedRow home={home.node} links={pinned} />
      {#snippet failed(error, reset)}{@render crashed('the pinned bookmarks', error, reset)}{/snippet}
    </svelte:boundary>

    {#if cards.length}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="grid"
        bind:clientWidth={gridWidth}
        style:--gap="{GAP}px"
        ondragover={onGridOver}
        ondrop={onGridDrop}
        ondragleave={onGridLeave}
      >
        {#each columns as column, ci (ci)}
          <div class="column" bind:this={columnEls[ci]} class:drop-empty={hint.id === `column:${ci}`}>
            {#each column as card (card.id)}
              <svelte:boundary onerror={(e) => console.error('[FlexiHome] card', card.title, e)}>
                <FolderCard node={card} depth={homeDepth + 1} path={[...homePath, card.title]} index={cards.indexOf(card)} />
                {#snippet failed(error, reset)}
                  {@render crashed(`“${card.title}”`, error, reset)}
                {/snippet}
              </svelte:boundary>
            {/each}
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty glass">
        <Icon name="folder" size={28} />
        <h2>No folders in “{home.node.title || 'this folder'}” yet</h2>
        <p>Create a folder to start grouping your bookmarks, or pick a different home folder in settings.</p>
        <div class="empty-actions">
          <button class="btn primary" onclick={() => openDialog({ kind: 'folder', mode: 'create', parentId: home.node.id })}>
            <Icon name="folder-plus" size={15} /> New folder
          </button>
          <button class="btn" onclick={() => (panel.settingsOpen = true)}>Choose home folder</button>
        </div>
      </div>
    {/if}
  {/if}
</main>

<SettingsPanel resolvedTheme={theme} />
{#if s.previews}<LinkPreview />{/if}
<Dialogs />
<Toasts />

<style>
  main {
    width: min(1440px, 100%);
    margin: 0 auto;
    padding: clamp(48px, 9vh, 110px) clamp(16px, 4vw, 48px) 80px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 28px;
  }
  .hero {
    display: grid;
    gap: 26px;
    margin-bottom: 4px;
  }
  /* Columns stretch to the tallest one so the space under a short column is still a drop target. */
  .grid {
    display: flex;
    gap: var(--gap);
  }
  /* minmax(0, 1fr) rather than the implicit `auto` column: an auto track grows to
     the widest unbreakable title, pushing cards over their neighbours. */
  .column {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: var(--gap);
    border-radius: var(--radius-lg);
  }
  .column.drop-empty {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
    background: var(--accent-soft);
  }
  .toolbar {
    position: fixed;
    top: 14px;
    right: 16px;
    z-index: 20;
    display: flex;
    gap: 8px;
  }
  .tb-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px;
    border-radius: 999px;
    color: var(--text);
    font-weight: 500;
    background: var(--surface);
    transition: background 0.15s, transform 0.15s;
  }
  .tb-btn:hover {
    background: var(--surface-strong);
  }
  .tb-btn.icon-only {
    width: 36px;
    padding: 0;
    justify-content: center;
  }
  :global([data-style='constellation']) .tb-btn {
    height: 34px;
    border-radius: 8px;
    color: var(--text-muted);
    font: 500 11px var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    transition: color 0.2s, border-color 0.2s, box-shadow 0.2s;
  }
  :global([data-style='constellation']) .tb-btn:hover {
    color: var(--accent);
    border-color: color-mix(in oklab, var(--accent) 50%, transparent);
    box-shadow: 0 0 18px color-mix(in oklab, var(--accent) 20%, transparent);
  }
  :global([data-style='constellation']) .tb-btn.icon-only {
    width: 34px;
  }
  .notice {
    justify-self: center;
    margin: 0;
    padding: 10px 16px;
    border-radius: var(--radius);
    background: var(--surface-strong);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .crash {
    justify-self: stretch;
    font-size: 13px;
  }
  .crash code {
    color: var(--danger);
    word-break: break-word;
  }
  .link-btn {
    border: 0;
    padding: 0;
    margin-left: 6px;
    background: none;
    color: var(--accent);
    font-weight: 600;
  }
  .empty {
    justify-self: center;
    display: grid;
    justify-items: center;
    gap: 8px;
    max-width: 460px;
    padding: 32px;
    border-radius: var(--radius-lg);
    text-align: center;
  }
  .empty :global(svg) {
    color: var(--accent);
  }
  .empty h2 {
    margin: 6px 0 0;
    font: 600 17px/1.3 var(--font-display);
  }
  .empty p {
    margin: 0;
    color: var(--text-muted);
  }
  .empty-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  @media (max-width: 640px) {
    .tb-btn span {
      display: none;
    }
    .tb-btn:not(.icon-only) {
      width: 36px;
      padding: 0;
      justify-content: center;
    }
  }
</style>
