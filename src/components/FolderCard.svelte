<script lang="ts">
  import FolderList from './FolderList.svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import { dropInto, requestDelete } from '../lib/actions';
  import { decode, tilt } from '../lib/fx/pointer';
  import { openInBackgroundTabs } from '../lib/links';
  import { settings } from '../lib/settings-store.svelte';
  import { collectLinks, countLinks, pathKey, type BNode } from '../lib/tree';
  import { DRAG_MIME, acceptsDrag, clearHint, drag, endDrag, hint, isDragging, openDialog, setHint, startDrag } from '../lib/ui.svelte';

  let { node, depth, path, index = 0 }: { node: BNode; depth: number; path: string[]; index?: number } = $props();

  let el: HTMLElement;
  const key = $derived(pathKey(path));
  const collapsed = $derived(settings.value.collapsed.includes(key));
  const total = $derived(countLinks(node));
  const hud = $derived(settings.value.style === 'constellation');
  const fx = $derived(hud && settings.value.effects);
  const pad2 = (n: number) => String(n).padStart(2, '0');

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

  // Dragging the header moves the whole card. Where it lands is worked out by the
  // grid in App.svelte, so card drags are left to bubble up to it.
  function ondragstart(e: DragEvent) {
    startDrag({ id: node.id, parentId: node.parentId!, index: node.index!, isFolder: true, isCard: true });
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData(DRAG_MIME, node.id);
    e.dataTransfer!.setDragImage(el, 24, 20);
  }

  function ondragover(e: DragEvent) {
    if (drag.item?.isCard || !acceptsDrag(e)) return;
    e.preventDefault();
    setHint(node.id, 'inside'); // anywhere not over a row: append to this folder
  }

  function ondrop(e: DragEvent) {
    if (drag.item?.isCard) return;
    e.preventDefault();
    clearHint();
    void dropInto(e, node.id);
  }

  function onleave(e: DragEvent) {
    if (!drag.item?.isCard && !el.contains(e.relatedTarget as Node | null)) clearHint(node.id);
  }
</script>

<section
  bind:this={el}
  data-card-id={node.id}
  class="card glass"
  class:dragging={isDragging(node.id)}
  class:drop-inside={hint.id === node.id && hint.edge === 'inside'}
  class:drop-before={hint.id === node.id && hint.edge === 'before'}
  class:drop-after={hint.id === node.id && hint.edge === 'after'}
  aria-label={node.title}
  style:--i={index}
  use:tilt={fx}
  {ondragover}
  ondragleave={onleave}
  {ondrop}
>
  {#if hud}
    <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
    <div class="glare"></div>
  {/if}
  <!-- Dragging is a pointer shortcut; keyboard users move things via the Edit dialog's folder picker. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header draggable="true" {ondragstart} ondragend={endDrag}>
    <button class="title" aria-expanded={!collapsed} onclick={toggle} title={collapsed ? 'Expand' : 'Collapse'}>
      <span class="chev" class:open={!collapsed}><Icon name="chevron-right" size={14} /></span>
      {#if hud}<span class="idx">{pad2(index + 1)}</span>{/if}
      <h2>
        <span class="sr-only">{node.title || 'Untitled folder'}</span>
        <span aria-hidden="true" use:decode={{ text: node.title || 'Untitled folder', enabled: fx, trigger: '[data-card-id]' }}></span>
      </h2>
      <span class="count">{hud ? `[${pad2(total)}]` : total}</span>
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
  /* Drawn in the gap between cards (--gap is 16px) so showing it doesn't shift the layout. */
  .card.drop-before::before,
  .card.drop-after::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    height: 3px;
    border-radius: 3px;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
    pointer-events: none;
  }
  .card.drop-before::before {
    top: -10px;
  }
  .card.drop-after::after {
    bottom: -10px;
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

  /* ---- Constellation: HUD panel ---- */
  :global([data-style='constellation']) .card {
    padding: 6px 6px 8px;
    transform: perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
    transition:
      transform 0.6s var(--ease),
      border-color 0.3s,
      box-shadow 0.3s,
      background 0.15s,
      opacity 0.15s;
    animation: panel-in 0.7s var(--ease) backwards;
    animation-delay: calc(0.1s + var(--i, 0) * 0.07s);
  }
  :global([data-style='constellation']) .card:global(.tilting) {
    transition:
      transform 0.12s linear,
      border-color 0.3s,
      box-shadow 0.3s;
  }
  /* `backwards`, not `both`: a clip-path left behind would cut off the corners and glow. */
  @keyframes panel-in {
    from {
      opacity: 0;
      clip-path: inset(0 0 100% 0);
    }
    to {
      clip-path: inset(-12px);
    }
  }
  :global([data-style='constellation']) .card:hover {
    border-color: var(--border-strong);
    box-shadow:
      0 30px 60px rgba(0, 0, 0, 0.5),
      0 0 40px color-mix(in oklab, var(--accent) 7%, transparent);
  }
  .corner {
    position: absolute;
    width: 14px;
    height: 14px;
    border: 2px solid var(--accent);
    opacity: 0.55;
    pointer-events: none;
    transition:
      inset 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
      opacity 0.3s;
  }
  .tl {
    top: -1px;
    left: -1px;
    border-right: 0;
    border-bottom: 0;
  }
  .tr {
    top: -1px;
    right: -1px;
    border-left: 0;
    border-bottom: 0;
  }
  .bl {
    bottom: -1px;
    left: -1px;
    border-right: 0;
    border-top: 0;
  }
  .br {
    bottom: -1px;
    right: -1px;
    border-left: 0;
    border-top: 0;
  }
  .card:hover .corner,
  .card.drop-inside .corner {
    opacity: 1;
  }
  .card:hover .tl {
    top: -6px;
    left: -6px;
  }
  .card:hover .tr {
    top: -6px;
    right: -6px;
  }
  .card:hover .bl {
    bottom: -6px;
    left: -6px;
  }
  .card:hover .br {
    bottom: -6px;
    right: -6px;
  }
  .glare {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s;
    background: radial-gradient(400px circle at var(--gx, 50%) var(--gy, 0%), color-mix(in oklab, var(--accent) 10%, transparent), transparent 50%);
  }
  .card:hover .glare {
    opacity: 1;
  }
  :global([data-style='constellation']) header {
    margin-bottom: 4px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  :global([data-style='constellation']) .chev {
    color: var(--accent);
  }
  .idx {
    font: 500 10px var(--font-mono);
    color: var(--text-faint);
  }
  :global([data-style='constellation']) h2 {
    flex: 1;
    font: 600 12.5px/1 var(--font-mono);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--accent);
  }
  :global([data-style='constellation']) .count {
    padding: 0;
    background: none;
    color: var(--text-faint);
    font: 500 11px var(--font-mono);
  }
</style>
