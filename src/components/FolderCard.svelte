<script lang="ts">
  import Card from './Card.svelte';
  import FolderList from './FolderList.svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import { dropInto, requestDelete } from '../lib/actions';
  import { openInBackgroundTabs } from '../lib/links';
  import { settings } from '../lib/settings-store.svelte';
  import { collectLinks, countLinks, pathKey, type BNode } from '../lib/tree';
  import { DRAG_MIME, acceptsDrag, clearHint, drag, openDialog, setHint, startDrag } from '../lib/ui.svelte';

  let { node, depth, path, index = 0 }: { node: BNode; depth: number; path: string[]; index?: number } = $props();

  let el = $state<HTMLElement>();
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

  // Dragging the header moves the whole card. Where it lands is worked out by the
  // grid in App.svelte, so card drags are left to bubble up to it.
  function ondragstart(e: DragEvent) {
    startDrag({ id: node.id, parentId: node.parentId!, index: node.index!, isFolder: true, isCard: true });
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData(DRAG_MIME, node.id);
    e.dataTransfer!.setDragImage(el!, 24, 20);
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

  function ondragleave(e: DragEvent) {
    if (!drag.item?.isCard && !el!.contains(e.relatedTarget as Node | null)) clearHint(node.id);
  }
</script>

<Card
  bind:el
  id={node.id}
  title={node.title || 'Untitled folder'}
  count={total}
  unit={total === 1 ? 'link' : 'links'}
  {index}
  {collapsed}
  ontoggle={toggle}
  {ondragstart}
  {ondragover}
  {ondragleave}
  {ondrop}
>
  {#snippet tools()}
    <button class="icon-btn" title="Add bookmark" aria-label="Add bookmark to {node.title}" onclick={() => openDialog({ kind: 'link', mode: 'create', parentId: node.id })}>
      <Icon name="plus" size={16} />
    </button>
    <Menu items={menu} label="Folder actions" />
  {/snippet}
  <FolderList folder={node} {depth} {path} limit={settings.value.previewLimit} />
</Card>
