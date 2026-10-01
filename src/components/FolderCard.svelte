<script lang="ts">
  import FolderList from './FolderList.svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import { dropInto, requestDelete } from '../lib/actions';
  import { openInBackgroundTabs } from '../lib/links';
  import { settings } from '../lib/settings-store.svelte';
  import { collectLinks, countLinks, pathKey, type BNode } from '../lib/tree';
  import { DRAG_MIME, acceptsDrag, clearHint, drag, dropEdge, endDrag, hint, isDragging, openDialog, setHint, startDrag } from '../lib/ui.svelte';

  let { node, depth, path }: { node: BNode; depth: number; path: string[] } = $props();

  let el: HTMLElement;
  const key = $derived(pathKey(path));
  const collapsed = $derived(settings.value.collapsed.includes(key));
  const total = $derived(countLinks(node));

  function toggle() {
    const list = settings.value.collapsed.filter((k) => k !== key);
    settings.update({ collapsed: collapsed ? list : [...list, key] });
  }

  const menu = $derived([
    { label: 'Add folder', icon: 'folder-plus' as const, run: () => openDialog({ kind: 'folder', mode: 'create', parentId: node.id }) },
    { label: 'Rename', icon: 'pencil' as const, run: () => openDialog({ kind: 'folder', mode: 'edit', node }) },
    {
      label: `Open all ${total} in tabs`,
      icon: 'external' as const,
      run: () => openInBackgroundTabs(collectLinks(node).map((l) => l.node.url!)),
    },
    { label: 'Delete folder', icon: 'trash' as const, danger: true, run: () => requestDelete(node) },
  ]);

  // Dragging the header moves the whole card; cards reorder left/right among themselves.
  function ondragstart(e: DragEvent) {
    startDrag({ id: node.id, parentId: node.parentId!, index: node.index!, isFolder: true, isCard: true });
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData(DRAG_MIME, node.id);
    e.dataTransfer!.setDragImage(el, 24, 20);
  }

  function ondragover(e: DragEvent) {
    if (!acceptsDrag(e) || drag.item?.id === node.id) return;
    e.preventDefault();
    if (drag.item?.isCard) setHint(node.id, dropEdge(e, el, 'x'));
    else setHint(node.id, 'inside'); // anywhere not over a row: append to this folder
  }

  function ondrop(e: DragEvent) {
    if (drag.item?.id === node.id) return;
    e.preventDefault();
    const card = drag.item?.isCard;
    const edge = dropEdge(e, el, 'x');
    clearHint();
    if (card) void dropInto(e, node.parentId!, node.index! + (edge === 'after' ? 1 : 0));
    else void dropInto(e, node.id);
  }

  function onleave(e: DragEvent) {
    if (!el.contains(e.relatedTarget as Node | null)) clearHint(node.id);
  }
</script>

<section
  bind:this={el}
  class="card glass"
  class:dragging={isDragging(node.id)}
  class:drop-inside={hint.id === node.id && hint.edge === 'inside'}
  class:drop-before={hint.id === node.id && hint.edge === 'before'}
  class:drop-after={hint.id === node.id && hint.edge === 'after'}
  aria-label={node.title}
  {ondragover}
  ondragleave={onleave}
  {ondrop}
>
  <!-- Dragging is a pointer shortcut; keyboard users move things via the Edit dialog's folder picker. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header draggable="true" {ondragstart} ondragend={endDrag}>
    <button class="title" aria-expanded={!collapsed} onclick={toggle} title={collapsed ? 'Expand' : 'Collapse'}>
      <span class="chev" class:open={!collapsed}><Icon name="chevron-right" size={14} /></span>
      <h2>{node.title || 'Untitled folder'}</h2>
      <span class="count">{total}</span>
    </button>
    <div class="tools">
      <span class="icon-btn grip" title="Drag to move this group" aria-hidden="true"><Icon name="grip" size={16} /></span>
      <button class="icon-btn" title="Add bookmark" aria-label="Add bookmark to {node.title}" onclick={() => openDialog({ kind: 'link', mode: 'create', parentId: node.id })}>
        <Icon name="plus" size={16} />
      </button>
      <Menu items={menu} label="Folder actions" />
    </div>
  </header>

  {#if !collapsed}
    <div class="body">
      <FolderList folder={node} {depth} {path} limit={settings.value.previewLimit} />
    </div>
  {/if}
</section>

<style>
  .card {
    position: relative;
    min-width: 0;
    border-radius: var(--radius-lg);
    padding: 6px;
    transition: box-shadow 0.15s, background 0.15s, opacity 0.15s, translate 0.2s var(--ease);
    animation: rise 0.35s var(--ease) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      translate: 0 6px;
    }
  }
  .card.dragging {
    opacity: 0.45;
  }
  .card.drop-inside {
    box-shadow: var(--shadow), inset 0 0 0 2px var(--accent);
    background: color-mix(in oklab, var(--accent) 10%, var(--surface));
  }
  .card.drop-before::before,
  .card.drop-after::after {
    content: '';
    position: absolute;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 3px;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .card.drop-before::before {
    left: -10px;
  }
  .card.drop-after::after {
    right: -10px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 2px 2px 0;
    cursor: grab;
  }
  header:active {
    cursor: grabbing;
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 6px 0 4px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    text-align: left;
    cursor: inherit;
  }
  h2 {
    margin: 0;
    font: 600 14.5px/1.2 var(--font-display);
    letter-spacing: 0.005em;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .chev {
    display: grid;
    place-items: center;
    width: 16px;
    color: var(--text-faint);
    transition: rotate 0.15s var(--ease);
  }
  .chev.open {
    rotate: 90deg;
  }
  .count {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: color-mix(in oklab, var(--accent) 70%, var(--text));
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .tools {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .card:hover .tools,
  .card:focus-within .tools {
    opacity: 1;
  }
  .body {
    padding: 2px 0 4px;
  }
</style>
