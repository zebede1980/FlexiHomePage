<script lang="ts">
  import Favicon from './Favicon.svelte';
  import Icon from './Icon.svelte';
  import { dropInto, isInternalUrl, navigate, requestDelete } from '../lib/actions';
  import { brandColor } from '../lib/brand-color.svelte';
  import { magnet, magnify } from '../lib/fx/pointer';
  import { preview } from '../lib/preview.svelte';
  import { settings } from '../lib/settings-store.svelte';
  import { hostOf, type BNode } from '../lib/tree';
  import { DRAG_MIME, acceptsDrag, clearHint, drag, dropEdge, endDrag, hint, isDragging, openDialog, setHint, startDrag } from '../lib/ui.svelte';

  /** Links sitting directly in the home folder, shown as large speed-dial tiles. */
  let { home, links }: { home: BNode; links: BNode[] } = $props();

  const newTab = $derived(settings.value.openInNewTab);
  const ROW_ID = 'pinned-row';

  function ondragstart(e: DragEvent, node: BNode) {
    startDrag({ id: node.id, parentId: node.parentId!, index: node.index!, isFolder: false, isCard: false });
    e.dataTransfer!.effectAllowed = 'copyMove';
    e.dataTransfer!.setData(DRAG_MIME, node.id);
    e.dataTransfer!.setData('text/uri-list', node.url!);
    e.dataTransfer!.setData('text/plain', node.url!);
  }

  function onTileOver(e: DragEvent, node: BNode) {
    if (drag.item?.isCard || !acceptsDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setHint(node.id, dropEdge(e, e.currentTarget as HTMLElement, 'x'));
  }

  function onTileDrop(e: DragEvent, node: BNode) {
    if (drag.item?.isCard) return;
    e.preventDefault();
    e.stopPropagation();
    const edge = dropEdge(e, e.currentTarget as HTMLElement, 'x');
    clearHint();
    void dropInto(e, home.id, node.index! + (edge === 'after' ? 1 : 0));
  }

  function onRowOver(e: DragEvent) {
    if (drag.item?.isCard || !acceptsDrag(e)) return;
    e.preventDefault();
    setHint(ROW_ID, 'inside');
  }

  function onRowDrop(e: DragEvent) {
    if (drag.item?.isCard) return;
    e.preventDefault();
    clearHint();
    void dropInto(e, home.id);
  }

  function onclick(e: MouseEvent, url: string) {
    if (isInternalUrl(url)) {
      e.preventDefault();
      navigate(url, newTab || e.ctrlKey || e.metaKey);
    }
  }
</script>

<div
  class="pinned"
  use:magnify={settings.value.style === 'dotfield' && settings.value.effects}
  use:magnet={settings.value.style === 'aurora' && settings.value.effects}
  class:drop-inside={hint.id === ROW_ID}
  class:empty={links.length === 0}
  role="list"
  aria-label="Pinned bookmarks"
  ondragover={onRowOver}
  ondragleave={(e) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && clearHint(ROW_ID)}
  ondrop={onRowDrop}
>
  {#each links as node (node.id)}
    {@const label = node.title || hostOf(node.url)}
    <div
      class="tile-wrap"
      style:--c={brandColor(node.url!)}
      class:dragging={isDragging(node.id)}
      class:drop-before={hint.id === node.id && hint.edge === 'before'}
      class:drop-after={hint.id === node.id && hint.edge === 'after'}
      role="listitem"
      ondragover={(e) => onTileOver(e, node)}
      ondrop={(e) => onTileDrop(e, node)}
    >
      <a
        class="tile"
        href={node.url}
        target={newTab ? '_blank' : undefined}
        rel="noopener"
        title={settings.value.previews ? undefined : `${label}\n${node.url}`}
        onpointerenter={(e) => settings.value.previews && preview.enter({ node, path: [home.title], el: e.currentTarget })}
        onpointerleave={() => preview.leave()}
        onclick={(e) => onclick(e, node.url!)}
        ondragstart={(e) => ondragstart(e, node)}
        ondragend={endDrag}
      >
        <span class="icon glass"><Favicon url={node.url!} title={node.title} size={28} /></span>
        <span class="label">{label}</span>
      </a>
      <div class="tile-actions">
        <button class="icon-btn" title="Edit" aria-label="Edit {label}" onclick={() => openDialog({ kind: 'link', mode: 'edit', node })}>
          <Icon name="pencil" size={12} />
        </button>
        <button class="icon-btn danger" title="Delete" aria-label="Delete {label}" onclick={() => requestDelete(node)}>
          <Icon name="x" size={12} />
        </button>
      </div>
    </div>
  {/each}
  {#if links.length === 0}
    <p class="hint">Drop bookmarks here to pin them</p>
  {/if}
</div>

<style>
  .pinned {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    padding: 6px;
    border-radius: var(--radius-lg);
    transition: background 0.15s, box-shadow 0.15s;
  }
  .pinned.empty {
    display: none;
  }
  /* With nothing pinned, the drop zone floats at the top only while dragging.
     Fixed positioning keeps it out of the flow so the cards don't jump. */
  :global(body.is-dragging) .pinned.empty {
    display: flex;
    position: fixed;
    top: 14px;
    left: 50%;
    translate: -50% 0;
    z-index: 25;
    padding: 0 8px;
    border: 1.5px dashed var(--border-strong);
    border-radius: 999px;
    background: var(--surface-strong);
    box-shadow: var(--shadow-pop);
    animation: drop-in 0.15s var(--ease);
  }
  :global(body.is-dragging) .pinned.empty .hint {
    padding: 10px 14px;
    color: var(--text-muted);
  }
  :global(body.is-dragging) .pinned.empty.drop-inside {
    border-color: var(--accent);
    background: color-mix(in oklab, var(--accent) 14%, var(--surface-strong));
  }
  @keyframes drop-in {
    from {
      opacity: 0;
      translate: -50% -6px;
    }
  }
  .pinned.drop-inside {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .hint {
    margin: 0;
    padding: 14px;
    color: var(--ink-muted);
    font-size: 13px;
  }
  .tile-wrap {
    position: relative;
  }
  .tile-wrap.dragging {
    opacity: 0.4;
  }
  .tile {
    display: grid;
    justify-items: center;
    gap: 8px;
    width: 92px;
    padding: 10px 4px 8px;
    border-radius: var(--radius);
    transition: background 0.15s, transform 0.15s var(--ease);
  }
  .tile:hover {
    background: color-mix(in oklab, var(--surface) 70%, transparent);
  }
  .tile:hover .icon {
    transform: translateY(-2px);
    box-shadow: var(--shadow-pop);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: var(--surface-strong);
    transition: transform 0.2s var(--ease), box-shadow 0.2s;
  }
  .label {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 12.5px;
    color: var(--ink);
    text-shadow: 0 1px 2px color-mix(in oklab, var(--bg) 40%, transparent);
  }
  .tile-actions {
    position: absolute;
    top: 2px;
    right: 6px;
    display: flex;
    gap: 1px;
    border-radius: 7px;
    background: var(--surface-solid);
    box-shadow: 0 0 0 1px var(--border), var(--shadow);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
  }
  .tile-actions .icon-btn {
    width: 20px;
    height: 20px;
  }
  .tile-wrap:hover .tile-actions,
  .tile-wrap:focus-within .tile-actions {
    opacity: 1;
    pointer-events: auto;
  }
  :global(body.is-dragging) .tile-actions {
    visibility: hidden; /* not display:none: no layout change mid-drag */
  }
  .tile-wrap.drop-before::before,
  .tile-wrap.drop-after::after {
    content: '';
    position: absolute;
    top: 12px;
    height: 56px;
    width: 3px;
    border-radius: 3px;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .tile-wrap.drop-before::before {
    left: -4px;
  }
  .tile-wrap.drop-after::after {
    right: -4px;
  }

  /* ---- Constellation: orbs with an orbit ring and a satellite on hover ---- */
  :global([data-style='constellation']) .pinned {
    gap: 14px;
  }
  :global([data-style='constellation']) .tile:hover {
    background: none;
  }
  :global([data-style='constellation']) .icon {
    position: relative;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.12), rgba(8, 13, 28, 0.9) 70%);
    transition:
      border-color 0.3s,
      box-shadow 0.3s,
      scale 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  :global([data-style='constellation']) .icon::before {
    content: '';
    position: absolute;
    inset: -7px;
    border-radius: 50%;
    border: 1px dashed var(--c);
    opacity: 0;
    scale: 0.8;
    transition:
      opacity 0.3s,
      scale 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    animation: orbit 6s linear infinite paused;
  }
  :global([data-style='constellation']) .icon::after {
    content: '';
    position: absolute;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 10px var(--c);
    offset-path: circle(37px at 50% 50%);
    opacity: 0;
    transition: opacity 0.3s;
    animation: satellite 2.4s linear infinite paused;
  }
  @keyframes orbit {
    to {
      rotate: 360deg;
    }
  }
  @keyframes satellite {
    to {
      offset-distance: 100%;
    }
  }
  :global([data-style='constellation']) .tile:hover .icon {
    translate: none;
    transform: none;
    scale: 1.06;
    border-color: var(--c);
    box-shadow:
      0 0 24px color-mix(in oklab, var(--c) 50%, transparent),
      inset 0 0 18px color-mix(in oklab, var(--c) 30%, transparent);
  }
  /* Only spin while visible: six idle infinite animations would keep the compositor busy. */
  :global([data-style='constellation']) .tile:hover .icon::before {
    opacity: 0.7;
    scale: 1;
    animation-play-state: running;
  }
  :global([data-style='constellation']) .tile:hover .icon::after {
    opacity: 1;
    animation-play-state: running;
  }
  :global([data-style='constellation']) .label {
    font: 500 11px var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-shadow: none;
    transition: color 0.2s;
  }
  :global([data-style='constellation']) .tile:hover .label {
    color: var(--text);
  }
  :global([data-style='constellation']) .tile-wrap.drop-before::before,
  :global([data-style='constellation']) .tile-wrap.drop-after::after {
    height: 60px;
  }

  /* ---- Aurora: glass squircles pulled toward the pointer (--tx/--ty from use:magnet), with a brand glow ---- */
  :global([data-style='aurora']) .pinned {
    gap: 10px;
  }
  :global([data-style='aurora']) .tile:hover {
    background: none;
  }
  :global([data-style='aurora']) .icon {
    position: relative;
    width: 62px;
    height: 62px;
    border-radius: 20px;
    background: linear-gradient(160deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03));
    border-color: rgba(255, 255, 255, 0.12);
    translate: var(--tx, 0) var(--ty, 0);
    transition:
      translate 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.3s,
      border-color 0.3s;
  }
  /* Brand-coloured bloom behind the icon */
  :global([data-style='aurora']) .icon::after {
    content: '';
    position: absolute;
    inset: 8px;
    z-index: -1;
    border-radius: inherit;
    background: var(--c);
    filter: blur(18px);
    opacity: 0;
    transition:
      opacity 0.35s,
      inset 0.35s;
  }
  :global([data-style='aurora']) .tile:hover .icon {
    transform: none;
    border-color: color-mix(in oklab, var(--c) 60%, white 10%);
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
    transition:
      translate 0.12s linear,
      box-shadow 0.3s,
      border-color 0.3s;
  }
  :global([data-style='aurora']) .tile:hover .icon::after {
    opacity: 0.85;
    inset: -4px;
  }
  :global([data-style='aurora']) .icon > :global(*) {
    transition: scale 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  :global([data-style='aurora']) .tile:hover .icon > :global(*) {
    scale: 1.12;
  }
  :global([data-style='aurora']) .label {
    color: var(--ink-muted);
    transition: color 0.2s;
  }
  :global([data-style='aurora']) .tile:hover .label {
    color: var(--ink);
  }

  /* ---- Dot Field: a dock that magnifies under the pointer (--s comes from use:magnify) ---- */
  :global([data-style='dotfield']) .pinned:not(.empty) {
    justify-self: center;
    align-items: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 26px;
    background: color-mix(in oklab, var(--surface) 82%, transparent);
    backdrop-filter: blur(12px);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--border);
    animation: dock-in 0.7s 0.15s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  }
  @keyframes dock-in {
    from {
      opacity: 0;
      translate: 0 20px;
    }
  }
  :global([data-style='dotfield']) .pinned.drop-inside {
    box-shadow:
      var(--shadow),
      inset 0 0 0 2px var(--accent);
  }
  :global([data-style='dotfield']) .tile {
    position: relative;
    width: auto;
    padding: 0;
    gap: 0;
  }
  :global([data-style='dotfield']) .tile:hover {
    background: none;
  }
  /* Grows with scale (no vertical reflow) and spreads its neighbours with margin. */
  :global([data-style='dotfield']) .icon {
    width: 52px;
    height: 52px;
    border-radius: 30%;
    background: var(--surface-solid);
    box-shadow:
      0 2px 6px rgba(60, 40, 10, 0.12),
      0 0 0 1px var(--border);
    scale: var(--s, 1);
    transform-origin: 50% 100%;
    margin: 0 calc((var(--s, 1) - 1) * 26px);
    transition:
      scale 0.18s var(--ease),
      margin 0.18s var(--ease),
      box-shadow 0.2s;
  }
  :global([data-style='dotfield']) .pinned:global(.settling) .icon {
    transition-duration: 0.45s;
    transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  :global([data-style='dotfield']) .tile:hover .icon {
    transform: none;
    box-shadow:
      0 6px 16px rgba(60, 40, 10, 0.18),
      0 0 0 1px var(--border);
  }
  /* The name becomes a tooltip above the (possibly magnified) icon. */
  :global([data-style='dotfield']) .label {
    position: absolute;
    z-index: 2;
    left: 50%;
    bottom: calc(52px * var(--s, 1) + 12px);
    max-width: none;
    padding: 4px 10px;
    border-radius: 8px;
    background: var(--text);
    color: var(--bg);
    font-size: 12px;
    font-weight: 600;
    text-shadow: none;
    opacity: 0;
    translate: -50% 4px;
    pointer-events: none;
    transition:
      opacity 0.15s,
      translate 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
      bottom 0.18s var(--ease);
  }
  :global([data-style='dotfield']) .tile:hover .label,
  :global([data-style='dotfield']) .tile:focus-visible .label {
    opacity: 1;
    translate: -50% 0;
  }
  :global([data-style='dotfield']) .tile-actions {
    top: -10px;
    right: -10px;
  }
  :global([data-style='dotfield']) .tile-wrap.drop-before::before,
  :global([data-style='dotfield']) .tile-wrap.drop-after::after {
    top: 0;
    height: 52px;
  }
</style>
