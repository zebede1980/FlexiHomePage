<script lang="ts">
  // Settings that only exist on the hosted site: which browsers are linked,
  // backups of the bookmarks, and the account itself.
  import Icon from './Icon.svelte';
  import { api, signOut } from '../lib/backend.svelte';
  import { ago } from '../lib/format';
  import { panel, toast } from '../lib/ui.svelte';

  interface Bridge {
    id: number;
    name: string;
    createdAt: number;
    seenAt: number | null;
    primary: boolean;
  }
  interface Snapshot {
    id: number;
    createdAt: number;
    reason: string;
  }

  let bridges = $state<Bridge[]>([]);
  let snapshots = $state<Snapshot[]>([]);
  let showAll = $state(false);
  let changing = $state(false);
  let current = $state('');
  let next = $state('');
  let error = $state('');

  const say = (e: unknown) => toast(e instanceof Error ? e.message : String(e));

  async function load() {
    try {
      [{ bridges }, { snapshots }] = await Promise.all([
        api<{ bridges: Bridge[] }>('/api/bridges'),
        api<{ snapshots: Snapshot[] }>('/api/snapshots'),
      ]);
    } catch (e) {
      say(e);
    }
  }

  // Fetched each time the drawer opens, so "last seen" is current.
  $effect(() => {
    if (panel.settingsOpen) void load();
  });

  async function unlink(b: Bridge) {
    if (!confirm(`Unlink “${b.name}”? Its bookmarks stay as they are, but stop following this site.`)) return;
    await api(`/api/bridges/${b.id}`, { method: 'DELETE', body: {} }).catch(say);
    await load();
  }

  async function saveNow() {
    try {
      ({ snapshots } = await api<{ snapshots: Snapshot[] }>('/api/snapshots', { method: 'POST', body: {} }));
      toast('Saved a copy of your bookmarks.');
    } catch (e) {
      say(e);
    }
  }

  async function restore(snap: Snapshot) {
    const when = new Date(snap.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    if (!confirm(`Put your bookmarks back to how they were on ${when}? Today's are saved first, so this can be undone.`)) return;
    try {
      await api(`/api/snapshots/${snap.id}/restore`, { method: 'POST', body: {} });
      toast('Bookmarks restored.');
      location.reload();
    } catch (e) {
      say(e);
    }
  }

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    try {
      await api('/api/auth/password', { method: 'POST', body: { current, next } });
      changing = false;
      current = next = '';
      toast('Password changed. Other browsers have been signed out.');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const stamp = (t: number) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>

<section>
  <h3>Linked browsers</h3>
  {#if bridges.length}
    <ul class="list">
      {#each bridges as b (b.id)}
        <li>
          <span class="grow">
            <strong>{b.name}</strong>
            <small>{b.seenAt ? `Last synced ${ago(b.seenAt)}` : 'Not synced yet'}{b.primary ? ' · adds new bookmarks to the browser' : ''}</small>
          </span>
          <button class="icon-btn danger" title="Unlink {b.name}" aria-label="Unlink {b.name}" onclick={() => unlink(b)}><Icon name="x" size={15} /></button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="note">
      None yet. Install the FlexiHome extension in a browser and link it to this site to keep that browser's bookmarks in step with
      the ones here, in both directions.
    </p>
  {/if}
</section>

<section>
  <h3>Backups</h3>
  <p class="note">A copy of your bookmarks is kept every day they change, and before any large edit.</p>
  {#if snapshots.length}
    <ul class="list">
      {#each showAll ? snapshots : snapshots.slice(0, 4) as snap (snap.id)}
        <li>
          <span class="grow">
            <strong>{stamp(snap.createdAt)}</strong>
            <small>{snap.reason}</small>
          </span>
          <button class="btn small" onclick={() => restore(snap)}>Restore</button>
        </li>
      {/each}
    </ul>
    {#if snapshots.length > 4}
      <button class="link-btn" onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${snapshots.length}`}</button>
    {/if}
  {/if}
  <div class="row">
    <button class="btn" onclick={saveNow}><Icon name="history" size={15} /> Save a copy now</button>
    <a class="btn" href="/api/export" download><Icon name="download" size={15} /> Download</a>
  </div>
</section>

<section>
  <h3>Account</h3>
  {#if changing}
    <form class="pw" onsubmit={changePassword}>
      <input class="sr-only" type="text" autocomplete="username" value="flexihome" readonly tabindex="-1" aria-hidden="true" />
      <label class="field"><span>Current password</span><input class="input" type="password" bind:value={current} autocomplete="current-password" required /></label>
      <label class="field"><span>New password (10 characters or more)</span><input class="input" type="password" bind:value={next} autocomplete="new-password" minlength="10" required /></label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <button class="btn primary">Change password</button>
        <button class="btn" type="button" onclick={() => (changing = false)}>Cancel</button>
      </div>
    </form>
  {:else}
    <div class="row">
      <button class="btn" onclick={() => (changing = true)}>Change password</button>
      <button class="btn" onclick={signOut}><Icon name="log-out" size={15} /> Sign out</button>
    </div>
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: 14px;
    padding: 18px 0;
    border-bottom: 1px solid var(--border);
  }
  h3 {
    margin: 0;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .note {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-muted);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
  }
  .grow {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .grow small {
    color: var(--text-muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .btn.small {
    height: 28px;
    padding: 0 11px;
    font-size: 13px;
  }
  .link-btn {
    justify-self: start;
    border: 0;
    padding: 0;
    background: none;
    color: var(--accent);
    font-weight: 600;
  }
  .pw {
    display: grid;
    gap: 10px;
  }
  .pw .input {
    font-size: 16px;
  }
  .error {
    margin: 0;
    color: var(--danger);
  }
</style>
