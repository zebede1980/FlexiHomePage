<script lang="ts">
  import Favicon from './Favicon.svelte';
  import Icon from './Icon.svelte';
  import { navigate } from '../lib/actions';
  import { ASK_CLAUDE_URL, SEARCH_ENGINES, searchUrl } from '../lib/settings';
  import { settings } from '../lib/settings-store.svelte';
  import { hostOf, searchLinks, toUrl, type LinkEntry } from '../lib/tree';

  let { links }: { links: LinkEntry[] } = $props();

  let input: HTMLInputElement;
  let query = $state('');
  let active = $state(0);
  let focused = $state(false);

  type Result =
    | { kind: 'link'; entry: LinkEntry }
    | { kind: 'url'; url: string }
    | { kind: 'web'; query: string }
    | { kind: 'claude'; query: string };

  const engineName = $derived(SEARCH_ENGINES.find((e) => e.url === settings.value.searchEngine)?.label ?? 'the web');

  const results = $derived.by((): Result[] => {
    const q = query.trim();
    if (!q) return [];
    const out: Result[] = [];
    const direct = toUrl(q);
    if (direct) out.push({ kind: 'url', url: direct });
    for (const entry of searchLinks(links, q, 7)) out.push({ kind: 'link', entry });
    out.push({ kind: 'web', query: q });
    out.push({ kind: 'claude', query: q });
    return out;
  });

  $effect(() => {
    void results;
    active = 0;
  });

  function urlOf(r: Result): string {
    if (r.kind === 'link') return r.entry.node.url!;
    if (r.kind === 'url') return r.url;
    if (r.kind === 'claude') return searchUrl(ASK_CLAUDE_URL, r.query);
    return searchUrl(settings.value.searchEngine, r.query);
  }

  function go(r: Result, newTab = settings.value.openInNewTab) {
    navigate(urlOf(r), newTab);
    if (newTab) {
      query = '';
      input.blur();
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(results.length - 1, active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, active - 1);
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      // Shift+Enter asks Claude whatever row is highlighted.
      const target = e.shiftKey ? results.find((r) => r.kind === 'claude')! : results[active];
      go(target, settings.value.openInNewTab || e.ctrlKey || e.metaKey);
    } else if (e.key === 'Escape') {
      if (query) query = '';
      else input.blur();
    }
  }

  // Start typing anywhere on the page to search; "/" focuses explicitly.
  function onWindowKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable], dialog')) return;
    if (document.querySelector('dialog[open], .drawer.open')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      input.focus();
    } else if (e.key.length === 1 && e.key !== ' ') {
      input.focus(); // the keystroke lands in the input
    }
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="search" class:open={focused && results.length > 0}>
  <label class="bar glass">
    {#if settings.value.style === 'constellation'}
      <span class="prompt" aria-hidden="true">&gt;</span>
    {:else}
      <Icon name="search" size={18} />
    {/if}
    <span class="sr-only">Search bookmarks, the web, or ask Claude</span>
    <input
      bind:this={input}
      bind:value={query}
      type="text"
      placeholder="Search bookmarks, the web, or ask Claude"
      autocomplete="off"
      spellcheck="false"
      role="combobox"
      aria-expanded={focused && results.length > 0}
      aria-controls="search-results"
      aria-activedescendant={results.length ? `sr-${active}` : undefined}
      onfocus={() => (focused = true)}
      onblur={() => setTimeout(() => (focused = false), 120)}
      {onkeydown}
    />
    {#if query}
      <button class="icon-btn" aria-label="Clear search" onclick={() => ((query = ''), input.focus())}><Icon name="x" size={14} /></button>
    {:else}
      <kbd>/</kbd>
    {/if}
  </label>

  {#if focused && results.length > 0}
    <ul id="search-results" class="results" role="listbox">
      {#each results as r, i (i)}
        <li
          id="sr-{i}"
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onmousemove={() => (active = i)}
          onmousedown={(e) => {
            e.preventDefault();
            go(r, settings.value.openInNewTab || e.ctrlKey || e.metaKey || e.button === 1);
          }}
        >
          {#if r.kind === 'link'}
            <Favicon url={r.entry.node.url!} title={r.entry.node.title} size={18} />
            <span class="main">
              <span class="title">{r.entry.node.title || hostOf(r.entry.node.url)}</span>
              <span class="meta">{[...r.entry.path, hostOf(r.entry.node.url)].filter(Boolean).join(' › ')}</span>
            </span>
          {:else if r.kind === 'url'}
            <span class="glyph"><Icon name="link" size={16} /></span>
            <span class="main"><span class="title">Go to {r.url}</span></span>
          {:else if r.kind === 'web'}
            <span class="glyph"><Icon name="globe" size={16} /></span>
            <span class="main"><span class="title">Search {engineName} for “{r.query}”</span></span>
          {:else}
            <Favicon url="https://claude.ai/" title="Claude" size={18} />
            <span class="main"><span class="title">Ask Claude “{r.query}”</span></span>
          {/if}
          {#if i === active}<kbd class="enter">↵</kbd>{:else if r.kind === 'claude'}<kbd class="enter" title="Shift+Enter">⇧↵</kbd>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .search {
    position: relative;
    width: min(640px, 100%);
    margin: 0 auto;
    z-index: 5;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 52px;
    padding: 0 10px 0 18px;
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--surface-strong);
    transition: box-shadow 0.2s, border-color 0.2s, border-radius 0.15s;
  }
  .bar:focus-within {
    border-color: color-mix(in oklab, var(--accent) 50%, var(--border));
    box-shadow: var(--shadow), 0 0 0 4px var(--accent-soft);
  }
  .open .bar {
    border-radius: 26px 26px 0 0;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-size: 16px;
  }
  input::placeholder {
    color: var(--text-faint);
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    margin-right: 6px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    font: 600 12px/1 var(--font);
    color: var(--text-faint);
  }
  .results {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin: 0;
    padding: 6px;
    list-style: none;
    background: var(--surface-solid);
    border: 1px solid var(--border);
    border-top: 0;
    border-radius: 0 0 22px 22px;
    box-shadow: var(--shadow-pop);
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 6px 12px;
    border-radius: 14px;
    cursor: pointer;
  }
  li.active {
    background: var(--accent-soft);
  }
  .glyph {
    display: grid;
    place-items: center;
    width: 18px;
    color: var(--text-muted);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .title,
  .meta {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .meta {
    font-size: 12px;
    color: var(--text-faint);
  }
  .enter {
    margin: 0;
  }

  /* ---- Constellation: terminal prompt ---- */
  .prompt {
    font: 600 16px var(--font-mono);
    color: var(--accent);
  }
  :global([data-style='constellation']) .bar {
    border-radius: 12px;
    background: var(--surface);
  }
  :global([data-style='constellation']) .bar:focus-within {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
    box-shadow:
      0 0 0 4px color-mix(in oklab, var(--accent) 8%, transparent),
      0 0 40px color-mix(in oklab, var(--accent) 18%, transparent);
  }
  :global([data-style='constellation']) .open .bar {
    border-radius: 12px 12px 0 0;
  }
  :global([data-style='constellation']) input {
    font: 15px var(--font-mono);
    caret-color: var(--accent);
  }
  :global([data-style='constellation']) input::placeholder {
    text-transform: lowercase;
  }
  :global([data-style='constellation']) kbd {
    border-color: var(--border);
    font-family: var(--font-mono);
  }
  :global([data-style='constellation']) .results {
    border-radius: 0 0 12px 12px;
    background: var(--surface-strong);
    backdrop-filter: blur(14px);
  }
  :global([data-style='constellation']) li {
    border-radius: 4px;
  }
  :global([data-style='constellation']) li.active {
    background: linear-gradient(90deg, color-mix(in oklab, var(--accent) 16%, transparent), transparent);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  :global([data-style='constellation']) .meta {
    font-family: var(--font-mono);
    font-size: 11px;
  }
</style>
