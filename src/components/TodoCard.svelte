<script lang="ts">
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';
  import Menu, { type MenuItem } from './Menu.svelte';
  import { bookmarks } from '../lib/bookmarks.svelte';
  import { TODO_CARD_KEY } from '../lib/layout';
  import { settings } from '../lib/settings-store.svelte';
  import { addTodo, listTodos, removeTodo, setTodoDone, type Todo } from '../lib/todos';
  import { DRAG_MIME, startDrag, toast } from '../lib/ui.svelte';

  let { index = 0 }: { index?: number } = $props();

  let el = $state<HTMLElement>();
  let draft = $state('');
  const todos = $derived(bookmarks.tree ? listTodos(bookmarks.tree) : []);
  const open = $derived(todos.filter((t) => !t.done));
  const done = $derived(todos.filter((t) => t.done));
  const collapsed = $derived(settings.value.collapsed.includes(TODO_CARD_KEY));

  function toggle() {
    const list = settings.value.collapsed.filter((k) => k !== TODO_CARD_KEY);
    settings.update({ collapsed: collapsed ? list : [...list, TODO_CARD_KEY] });
  }

  async function attempt(what: string, run: () => Promise<unknown>) {
    try {
      await run();
    } catch (err) {
      toast(`Couldn't ${what}: ${err instanceof Error ? err.message : err}`);
    }
  }

  function add(e: SubmitEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    draft = '';
    void attempt('add that', () => addTodo(text));
  }

  /** Deletes straight away with an undo, like bookmarks. Undone items come back at the end of the list. */
  async function remove(items: Todo[], message: string) {
    await attempt('delete', async () => {
      for (const t of items) await removeTodo(t.id);
      toast(message, {
        label: 'Undo',
        run: async () => {
          for (const t of items) await addTodo(t.text, t.done);
        },
      }, 10_000);
    });
  }

  const menu = $derived<MenuItem[]>([
    ...(done.length
      ? [{ label: `Clear ${done.length} done`, icon: 'check' as const, run: () => remove(done, `Cleared ${done.length} done`) }]
      : []),
    { label: 'Hide to-do list', icon: 'x', run: () => settings.update({ showTodos: false }) },
  ]);

  // Moves among the bookmark cards; App's grid handles where it lands.
  function ondragstart(e: DragEvent) {
    startDrag({ id: TODO_CARD_KEY, parentId: '', index: 0, isFolder: false, isCard: true });
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData(DRAG_MIME, TODO_CARD_KEY);
    e.dataTransfer!.setDragImage(el!, 24, 20);
  }
</script>

{#snippet item(t: Todo)}
  <li class="item" class:done={t.done}>
    <label>
      <input type="checkbox" checked={t.done} onchange={(e) => attempt('update that', () => setTodoDone(t.id, e.currentTarget.checked))} />
      <span class="text">{t.text}</span>
    </label>
    <button class="icon-btn danger" title="Delete" aria-label="Delete {t.text}" onclick={() => remove([t], `Deleted "${t.text}"`)}>
      <Icon name="x" size={14} />
    </button>
  </li>
{/snippet}

<Card bind:el id={TODO_CARD_KEY} title="To do" count={open.length} unit="to do" {index} {collapsed} ontoggle={toggle} {ondragstart}>
  {#snippet tools()}
    <Menu items={menu} label="To-do actions" />
  {/snippet}
  <form class="add" onsubmit={add}>
    <Icon name="plus" size={16} />
    <input
      bind:value={draft}
      placeholder="Add a task"
      aria-label="New task"
      maxlength="500"
      onkeydown={(e) => e.key === 'Escape' && ((draft = ''), e.currentTarget.blur())}
    />
  </form>
  {#if todos.length}
    <ul>
      {#each open as t (t.id)}{@render item(t)}{/each}
      {#each done as t (t.id)}{@render item(t)}{/each}
    </ul>
  {:else}
    <p class="empty">Nothing to do. Enjoy it.</p>
  {/if}
</Card>

<style>
  .add {
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--row-h);
    padding: 0 8px;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
    transition: background 0.12s, box-shadow 0.12s;
  }
  .add:hover {
    background: var(--hover);
  }
  .add:focus-within {
    background: var(--surface-solid);
    box-shadow: 0 0 0 1px var(--accent);
    color: var(--accent);
  }
  .add input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    color: var(--text);
  }
  .add input::placeholder {
    color: var(--text-faint);
  }
  ul {
    margin: 2px 0 0;
    padding: 0;
    list-style: none;
  }
  .item {
    position: relative;
    display: flex;
    align-items: flex-start;
    border-radius: var(--radius-sm);
    transition: background 0.12s;
  }
  .item:hover {
    background: var(--hover);
  }
  label {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: calc((var(--row-h) - 20px) / 2) 8px;
    cursor: pointer;
  }
  input[type='checkbox'] {
    flex: none;
    width: 16px;
    height: 16px;
    margin: 2px 0 0;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .text {
    line-height: 20px;
    overflow-wrap: anywhere;
  }
  .done .text {
    color: var(--text-faint);
    text-decoration: line-through;
  }
  /* Overlaid like the bookmark rows' actions, so it doesn't narrow the text. */
  .item .icon-btn {
    position: absolute;
    right: 4px;
    top: calc((var(--row-h) - 24px) / 2);
    width: 24px;
    height: 24px;
    background: var(--surface-solid);
    box-shadow: 0 0 0 1px var(--border);
    opacity: 0;
    transition: opacity 0.12s;
  }
  .item:hover .icon-btn,
  .item:focus-within .icon-btn {
    opacity: 1;
  }
  .empty {
    margin: 4px 8px 6px;
    color: var(--text-faint);
    font-size: 13px;
  }
</style>
