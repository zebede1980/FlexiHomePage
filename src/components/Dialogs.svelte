<script lang="ts">
  import Icon from './Icon.svelte';
  import { bookmarks } from '../lib/bookmarks.svelte';
  import { hostOf, listFolders, toUrl } from '../lib/tree';
  import { closeDialog, dialog, toast } from '../lib/ui.svelte';

  let el: HTMLDialogElement;
  let firstField = $state<HTMLInputElement>();

  let title = $state('');
  let url = $state('');
  let parentId = $state('');
  let error = $state('');
  let busy = $state(false);

  const d = $derived(dialog.current);
  const folders = $derived(bookmarks.tree ? listFolders(bookmarks.tree) : []);

  // Open/close the native dialog and seed the form whenever the requested dialog changes.
  $effect(() => {
    const cur = dialog.current;
    error = '';
    busy = false;
    if (!cur) {
      if (el.open) el.close();
      return;
    }
    if (cur.kind === 'link') {
      title = cur.mode === 'edit' ? cur.node.title : '';
      url = cur.mode === 'edit' ? (cur.node.url ?? '') : '';
      parentId = cur.mode === 'edit' ? cur.node.parentId! : cur.parentId;
    } else if (cur.kind === 'folder') {
      title = cur.mode === 'edit' ? cur.node.title : '';
      parentId = cur.mode === 'edit' ? cur.node.parentId! : cur.parentId;
    }
    if (!el.open) el.showModal();
    queueMicrotask(() => firstField?.select());
  });

  function normalise(input: string): string | null {
    const s = input.trim();
    if (!s) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s; // already has a scheme
    return toUrl(s);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const cur = dialog.current;
    if (!cur || busy) return;
    busy = true;
    error = '';
    try {
      if (cur.kind === 'link') {
        const finalUrl = normalise(url);
        if (!finalUrl) {
          error = "That doesn't look like a web address.";
          return;
        }
        const finalTitle = title.trim() || hostOf(finalUrl) || finalUrl;
        if (cur.mode === 'create') {
          await bookmarks.createLink(parentId, finalTitle, finalUrl);
        } else {
          await bookmarks.update(cur.node.id, { title: finalTitle, url: finalUrl });
          if (parentId !== cur.node.parentId) await bookmarks.move(cur.node.id, parentId);
        }
      } else if (cur.kind === 'folder') {
        const name = title.trim();
        if (!name) {
          error = 'Give the folder a name.';
          return;
        }
        if (cur.mode === 'create') await bookmarks.createFolder(parentId, name);
        else {
          await bookmarks.update(cur.node.id, { title: name });
          if (parentId !== cur.node.parentId) await bookmarks.move(cur.node.id, parentId);
        }
      } else if (cur.kind === 'confirm-delete') {
        await bookmarks.remove(cur.node);
        toast(`Deleted folder "${cur.node.title}"`);
      }
      closeDialog();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  /** A folder can't be moved into itself, so hide it and its descendants from the picker. */
  const folderChoices = $derived.by(() => {
    if (d?.kind !== 'folder' || d.mode !== 'edit') return folders;
    const self = d.node.id;
    const banned = new Set<string>();
    for (const f of folders) {
      if (f.node.id === self || (f.node.parentId && banned.has(f.node.parentId))) banned.add(f.node.id);
    }
    return folders.filter((f) => !banned.has(f.node.id));
  });
</script>

<dialog
  bind:this={el}
  onclose={closeDialog}
  onclick={(e) => e.target === el && closeDialog()}
  aria-labelledby="dialog-title"
>
  {#if d}
    <form onsubmit={submit}>
      <header>
        <h2 id="dialog-title">
          {#if d.kind === 'link'}{d.mode === 'create' ? 'Add bookmark' : 'Edit bookmark'}
          {:else if d.kind === 'folder'}{d.mode === 'create' ? 'New folder' : 'Edit folder'}
          {:else}Delete folder?{/if}
        </h2>
        <button type="button" class="icon-btn" aria-label="Close" onclick={closeDialog}><Icon name="x" /></button>
      </header>

      {#if d.kind === 'confirm-delete'}
        <p class="body">
          <strong>{d.node.title}</strong> and the {d.linkCount}
          {d.linkCount === 1 ? 'bookmark' : 'bookmarks'} inside it will be deleted from Vivaldi, on every machine you sync with.
        </p>
      {:else}
        <div class="fields">
          {#if d.kind === 'link'}
            <label class="field">
              <span>URL</span>
              <input bind:this={firstField} class="input" bind:value={url} placeholder="https://…" required spellcheck="false" />
            </label>
            <label class="field">
              <span>Name</span>
              <input class="input" bind:value={title} placeholder="Defaults to the site name" />
            </label>
          {:else}
            <label class="field">
              <span>Name</span>
              <input bind:this={firstField} class="input" bind:value={title} placeholder="e.g. Work" required />
            </label>
          {/if}
          <label class="field">
            <span>Folder</span>
            <select class="input" bind:value={parentId}>
              {#each folderChoices as f (f.node.id)}
                <option value={f.node.id}>{' '.repeat(f.depth - 1)}{f.node.title || 'Untitled'}</option>
              {/each}
            </select>
          </label>
        </div>
      {/if}

      {#if error}<p class="error" role="alert">{error}</p>{/if}

      <footer>
        <button type="button" class="btn" onclick={closeDialog}>Cancel</button>
        {#if d.kind === 'confirm-delete'}
          <button type="submit" class="btn danger" disabled={busy}><Icon name="trash" size={15} /> Delete</button>
        {:else}
          <button type="submit" class="btn primary" disabled={busy}>
            <Icon name="check" size={15} />
            {d.mode === 'create' ? (d.kind === 'link' ? 'Add' : 'Create') : 'Save'}
          </button>
        {/if}
      </footer>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    width: min(440px, calc(100vw - 32px));
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--surface-solid);
    color: var(--text);
    box-shadow: var(--shadow-pop);
  }
  dialog[open] {
    animation: in 0.18s var(--ease);
  }
  dialog::backdrop {
    background: rgba(8, 10, 16, 0.4);
    backdrop-filter: blur(3px);
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }
  form {
    display: grid;
    gap: 16px;
    padding: 18px 20px 20px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font: 600 17px/1.2 var(--font-display);
  }
  .fields {
    display: grid;
    gap: 14px;
  }
  .body {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .body strong {
    color: var(--text);
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
