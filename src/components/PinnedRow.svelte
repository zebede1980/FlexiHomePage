<script lang="ts">
  import Favicon from './Favicon.svelte';
  import Icon from './Icon.svelte';
  import { dropInto, isInternalUrl, navigate, requestDelete } from '../lib/actions';
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
        title={`${label}\n${node.url}`}
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
</style>
