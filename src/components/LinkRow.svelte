<script lang="ts">
  import Favicon from './Favicon.svelte';
  import Icon from './Icon.svelte';
  import { dropInto, isInternalUrl, navigate, requestDelete } from '../lib/actions';
  import { brandColor } from '../lib/brand-color.svelte';
  import { preview } from '../lib/preview.svelte';
  import { settings } from '../lib/settings-store.svelte';
  import { hostOf, type BNode } from '../lib/tree';
  import { DRAG_MIME, acceptsDrag, clearHint, drag, dropEdge, endDrag, hint, isDragging, openDialog, setHint, startDrag } from '../lib/ui.svelte';

  /** `path` is the containing folders' titles, shown in the hover preview. */
  let { node, path = [] }: { node: BNode; path?: string[] } = $props();

  let el: HTMLDivElement;
  const url = $derived(node.url ?? '');
  const label = $derived(node.title || hostOf(url) || url);
  const newTab = $derived(settings.value.openInNewTab);
  const color = $derived(brandColor(url));

  function onclick(e: MouseEvent) {
    // Browser-internal pages (vivaldi://…) can't be opened from a plain link.
    if (isInternalUrl(url)) {
      e.preventDefault();
      navigate(url, newTab || e.ctrlKey || e.metaKey || e.button === 1);
    }
  }

  function ondragstart(e: DragEvent) {
    startDrag({ id: node.id, parentId: node.parentId!, index: node.index!, isFolder: false, isCard: false });
    e.dataTransfer!.effectAllowed = 'copyMove';
    e.dataTransfer!.setData(DRAG_MIME, node.id);
    e.dataTransfer!.setData('text/uri-list', url);
    e.dataTransfer!.setData('text/plain', url);
    e.dataTransfer!.setDragImage(el, 16, 16); // whole row as the ghost, even when dragged by the handle
  }

  function ondragover(e: DragEvent) {
    if (drag.item?.isCard || !acceptsDrag(e)) return; // cards reorder at card level
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = drag.item ? 'move' : 'copy';
    setHint(node.id, dropEdge(e, el));
  }

  function ondrop(e: DragEvent) {
    if (drag.item?.isCard) return;
    e.preventDefault();
    e.stopPropagation();
    const edge = dropEdge(e, el);
    clearHint();
    void dropInto(e, node.parentId!, node.index! + (edge === 'after' ? 1 : 0));
  }
</script>

<div
  bind:this={el}
  class="row"
  style:--c={color}
  class:dragging={isDragging(node.id)}
  class:drop-before={hint.id === node.id && hint.edge === 'before'}
  class:drop-after={hint.id === node.id && hint.edge === 'after'}
  role="listitem"
  {ondragover}
  ondragleave={() => clearHint(node.id)}
  {ondrop}
>
  <a
    class="link"
    href={url}
    target={newTab ? '_blank' : undefined}
    rel="noopener"
    title={settings.value.previews ? undefined : `${label}\n${url}`}
    onpointerenter={(e) => settings.value.previews && preview.enter({ node, path, el: e.currentTarget })}
    onpointerleave={() => preview.leave()}
    {onclick}
    {ondragstart}
    ondragend={endDrag}
  >
    <Favicon {url} title={node.title} size={16} />
    <span class="label">{label}</span>
  </a>
  <div class="actions">
    <span class="icon-btn grip" title="Drag to move" aria-hidden="true" draggable="true" {ondragstart} ondragend={endDrag}>
      <Icon name="grip" size={14} />
    </span>
    <button class="icon-btn" title="Edit" aria-label="Edit {label}" onclick={() => openDialog({ kind: 'link', mode: 'edit', node })}>
      <Icon name="pencil" size={14} />
    </button>
    <button class="icon-btn danger" title="Delete" aria-label="Delete {label}" onclick={() => requestDelete(node)}>
      <Icon name="trash" size={14} />
    </button>
  </div>
</div>

<style>
  .row {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    transition: background 0.12s;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.dragging {
    opacity: 0.4;
  }
  .row.drop-before::before,
  .row.drop-after::after {
    content: '';
    position: absolute;
    left: 6px;
    right: 6px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
    pointer-events: none;
  }
  .row.drop-before::before {
    top: -1px;
  }
  .row.drop-after::after {
    bottom: -1px;
  }
  .link {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--row-h);
    padding: 0 8px;
    border-radius: var(--radius-sm);
  }
  .label {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* Overlaid rather than inline so hidden buttons don't steal width from the title. */
  .actions {
    position: absolute;
    right: 4px;
    top: 50%;
    translate: 0 -50%;
    display: flex;
    gap: 2px;
    padding: 1px;
    border-radius: 7px;
    background: var(--surface-solid);
    box-shadow: 0 0 0 1px var(--border);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
  }
  .actions .icon-btn {
    width: 24px;
    height: 24px;
  }
  .row:hover .actions,
  .row:focus-within .actions {
    opacity: 1;
    pointer-events: auto;
  }
  :global(body.is-dragging) .actions {
    visibility: hidden; /* not display:none — the drag handle lives in here */
  }

  /* ---- Constellation: accent rail, scan sweep, favicon glow ---- */
  :global([data-style='constellation']) .row {
    border-radius: 0;
  }
  :global([data-style='constellation']) .row:hover {
    background: linear-gradient(90deg, color-mix(in oklab, var(--c) 13%, transparent), transparent 85%);
  }
  :global([data-style='constellation']) .link {
    position: relative;
    overflow: hidden;
    border-radius: 0;
    color: color-mix(in oklab, var(--text) 88%, transparent);
    transition: color 0.2s;
  }
  :global([data-style='constellation']) .link::before,
  :global([data-style='constellation']) .link::after {
    content: '';
    position: absolute;
    pointer-events: none;
  }
  :global([data-style='constellation']) .link::before {
    left: 0;
    top: 7px;
    bottom: 7px;
    width: 2px;
    background: var(--c);
    box-shadow: 0 0 10px var(--c);
    scale: 1 0;
    transition: scale 0.25s var(--ease);
  }
  :global([data-style='constellation']) .link::after {
    inset: 0;
    background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--c) 18%, transparent), transparent);
    translate: -100% 0;
  }
  :global([data-style='constellation']) .row:hover .link {
    color: var(--text);
  }
  :global([data-style='constellation']) .row:hover .link::before {
    scale: 1 1;
  }
  :global([data-style='constellation']) .row:hover .link::after {
    animation: sweep 0.6s var(--ease);
  }
  @keyframes sweep {
    to {
      translate: 100% 0;
    }
  }
  :global([data-style='constellation']) .link :global(img) {
    transition:
      filter 0.3s,
      scale 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  :global([data-style='constellation']) .row:hover .link :global(img) {
    scale: 1.15;
    filter: drop-shadow(0 0 6px var(--c));
  }
  :global([data-style='constellation']) .label {
    transition: translate 0.3s var(--ease);
  }
  :global([data-style='constellation']) .row:hover .label {
    translate: 4px 0;
  }
</style>
