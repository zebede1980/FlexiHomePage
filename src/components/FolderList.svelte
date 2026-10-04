<script lang="ts">
  import FolderList from './FolderList.svelte';
  import Icon from './Icon.svelte';
  import LinkRow from './LinkRow.svelte';
  import Menu from './Menu.svelte';
  import { dropInto, requestDelete } from '../lib/actions';
  import { openInBackgroundTabs } from '../lib/links';
  import { settings } from '../lib/settings-store.svelte';
  import { collectLinks, countLinks, isFolder, pathKey, visibleChildren, type BNode } from '../lib/tree';
  import { DRAG_MIME, acceptsDrag, clearHint, drag, dropEdge, endDrag, hint, isDragging, openDialog, setHint, startDrag } from '../lib/ui.svelte';

  let {
    folder,
    depth,
    path,
    limit,
  }: {
    folder: BNode;
    /** Tree depth of `folder` (needed to recognise hidden system folders). */
    depth: number;
    /** Absolute title path of `folder`, used as a sync-stable key. */
    path: string[];
    /** Max items before "Show more"; omit for no limit. */
    limit?: number;
  } = $props();

  let showAll = $state(false);
  const items = $derived(visibleChildren(folder, depth));
  const shown = $derived(limit && !showAll ? items.slice(0, limit) : items);
  const remaining = $derived(items.length - shown.length);

  const expanded = $derived(new Set(settings.value.expanded));

  function toggle(key: string) {
    const next = new Set(settings.value.expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    settings.update({ expanded: [...next] });
  }

  // ---- drag & drop for sub-folder rows ----

  function onFolderDragStart(e: DragEvent, node: BNode) {
    startDrag({ id: node.id, parentId: node.parentId!, index: node.index!, isFolder: true, isCard: false });
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData(DRAG_MIME, node.id);
  }

  function onFolderDragOver(e: DragEvent, node: BNode) {
    if (drag.item?.isCard || drag.item?.id === node.id || !acceptsDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setHint(node.id, dropEdge(e, e.currentTarget as HTMLElement, 'y', true));
  }

  function onFolderDrop(e: DragEvent, node: BNode) {
    if (drag.item?.isCard || drag.item?.id === node.id) return;
    e.preventDefault();
    e.stopPropagation();
    const edge = dropEdge(e, e.currentTarget as HTMLElement, 'y', true);
    clearHint();
    if (edge === 'inside') void dropInto(e, node.id);
    else void dropInto(e, node.parentId!, node.index! + (edge === 'after' ? 1 : 0));
  }

  function menuFor(node: BNode) {
    return [
      { label: 'Add bookmark', icon: 'plus' as const, run: () => openDialog({ kind: 'link', mode: 'create', parentId: node.id }) },
      { label: 'Add folder', icon: 'folder-plus' as const, run: () => openDialog({ kind: 'folder', mode: 'create', parentId: node.id }) },
      { label: 'Rename', icon: 'pencil' as const, run: () => openDialog({ kind: 'folder', mode: 'edit', node }) },
      {
        label: 'Open all in tabs',
        icon: 'external' as const,
        run: () => openInBackgroundTabs(collectLinks(node).map((l) => l.node.url!)),
      },
      { label: 'Delete folder', icon: 'trash' as const, danger: true, run: () => requestDelete(node) },
    ];
  }
</script>

<div class="list" role="list">
  {#each shown as child (child.id)}
    {#if isFolder(child)}
      {@const childPath = [...path, child.title]}
      {@const key = pathKey(childPath)}
      {@const open = expanded.has(key)}
      <div class="sub" class:dragging={isDragging(child.id)}>
        <div
          class="row folder-row"
          class:drop-before={hint.id === child.id && hint.edge === 'before'}
          class:drop-after={hint.id === child.id && hint.edge === 'after'}
          class:drop-inside={hint.id === child.id && hint.edge === 'inside'}
          role="listitem"
          draggable="true"
          ondragstart={(e) => onFolderDragStart(e, child)}
          ondragend={endDrag}
          ondragover={(e) => onFolderDragOver(e, child)}
          ondragleave={() => clearHint(child.id)}
          ondrop={(e) => onFolderDrop(e, child)}
        >
          <button class="toggle" aria-expanded={open} onclick={() => toggle(key)}>
            <span class="chev" class:open><Icon name="chevron-right" size={14} /></span>
            <Icon name="folder" size={16} />
            <span class="label">{child.title || 'Untitled folder'}</span>
            <span class="count">{countLinks(child)}</span>
          </button>
          <div class="actions">
            <!-- The whole row is draggable; the handle just makes that discoverable. -->
            <span class="icon-btn grip" title="Drag to move" aria-hidden="true"><Icon name="grip" size={14} /></span>
            <Menu items={menuFor(child)} label="Folder actions" />
          </div>
        </div>
        {#if open}
          <div class="nested">
            <FolderList folder={child} depth={depth + 1} path={childPath} />
          </div>
        {/if}
      </div>
    {:else}
      <LinkRow node={child} {path} />
    {/if}
  {/each}

  {#if items.length === 0}
    <p class="empty">Empty — drag bookmarks here</p>
  {/if}

  {#if remaining > 0}
    <button class="more" onclick={() => (showAll = true)}>Show {remaining} more</button>
  {:else if showAll && limit && items.length > limit}
    <button class="more" onclick={() => (showAll = false)}>Show less</button>
  {/if}
</div>

<style>
  .list {
    display: grid;
    grid-template-columns: minmax(0, 1fr); /* long titles ellipsize instead of widening the card */
    gap: 1px;
  }
  .row {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    transition: background 0.12s, box-shadow 0.12s;
  }
  .row:hover {
    background: var(--hover);
  }
  .sub.dragging {
    opacity: 0.4;
  }
  .toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--row-h);
    padding: 0 8px 0 4px;
    border: 0;
    background: transparent;
    text-align: left;
    border-radius: var(--radius-sm);
  }
  .toggle > :global(svg) {
    flex: none;
    color: var(--accent);
  }
  .chev {
    display: grid;
    place-items: center;
    width: 14px;
    color: var(--text-faint);
    transition: rotate 0.15s var(--ease);
  }
  .chev.open {
    rotate: 90deg;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .count {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
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
  .actions :global(.icon-btn) {
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
  .nested {
    margin-left: 11px;
    padding-left: 8px;
    border-left: 1px solid var(--border-strong);
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
  .row.drop-inside {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }

  .empty {
    margin: 0;
    padding: 10px 8px;
    font-size: 12px;
    color: var(--text-faint);
  }
  .more {
    justify-self: start;
    margin: 4px 0 0 6px;
    padding: 4px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
  }
  .more:hover {
    background: var(--accent-soft);
  }

  :global([data-style='constellation']) .chev {
    color: var(--accent);
  }
  :global([data-style='constellation']) .label {
    font-weight: 600;
  }
  :global([data-style='constellation']) .count,
  :global([data-style='constellation']) .empty,
  :global([data-style='constellation']) .more {
    font-family: var(--font-mono);
  }
  :global([data-style='constellation']) .nested {
    border-left-style: dashed;
    border-left-color: var(--border);
  }
</style>
