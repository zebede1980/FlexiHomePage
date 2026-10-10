<script lang="ts">
  // The extension's own page: link this browser to a FlexiHome site, see how
  // the sync is doing, and choose what a new tab opens.
  import Icon from '../components/Icon.svelte';
  import { ago } from '../lib/format';
  import { DEFAULT_PREFS, DEFAULT_STATUS, send, type Link, type Prefs, type Status, type Stored } from './shared';
  import type { SyncSummary } from './sync';

  let link = $state<Link | undefined>();
  let prefs = $state<Prefs>(DEFAULT_PREFS);
  let status = $state<Status>(DEFAULT_STATUS);
  let loaded = $state(false);

  let url = $state('');
  let password = $state('');
  let name = $state(guessName());
  let busy = $state('');
  let error = $state('');
  let preview = $state<SyncSummary | null>(null);
  let now = $state(Date.now());

  function guessName(): string {
    const ua = navigator.userAgent;
    const browser = /Vivaldi/.test(ua) || 'vivaldi' in window ? 'Vivaldi' : /Edg\//.test(ua) ? 'Edge' : 'Chrome';
    const os = /Windows/.test(ua) ? 'Windows PC' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux PC' : 'computer';
    return `${browser} on my ${os}`;
  }

  // Everything the worker knows lives in extension storage; follow it live.
  const KEYS: (keyof Stored)[] = ['link', 'prefs', 'status'];
  function absorb(s: Partial<Stored>) {
    if ('link' in s) link = s.link;
    if ('prefs' in s) prefs = s.prefs ?? DEFAULT_PREFS;
    if ('status' in s) status = s.status ?? DEFAULT_STATUS;
  }
  $effect(() => {
    void chrome.storage.local.get(KEYS).then((got) => {
      const s = got as Partial<Stored>;
      absorb({ link: undefined, prefs: undefined, status: undefined, ...s });
      loaded = true;
      if (s.link && !s.link.ready) void loadPreview();
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) =>
      absorb(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])) as Partial<Stored>);
    chrome.storage.onChanged.addListener(onChange);
    const clock = setInterval(() => (now = Date.now()), 10_000);
    return () => {
      chrome.storage.onChanged.removeListener(onChange);
      clearInterval(clock);
    };
  });

  const host = $derived(link ? new URL(link.url).host : '');
  const sum = $derived(status.summary);

  async function act(label: string, fn: () => Promise<void>) {
    if (busy) return;
    busy = label;
    error = '';
    try {
      await fn();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = '';
    }
  }

  const must = async (p: ReturnType<typeof send>) => {
    const r = await p;
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  function connect(e: SubmitEvent) {
    e.preventDefault();
    void act('connect', async () => {
      const typed = url.trim();
      let origin: string;
      try {
        origin = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`).origin;
      } catch {
        throw new Error("That doesn't look like a web address.");
      }
      // The browser asks you to allow the extension to talk to this one site.
      if (!(await chrome.permissions.request({ origins: [`${origin}/*`] }))) {
        throw new Error('The extension needs your permission to talk to that site.');
      }
      await must(send({ type: 'link', url: origin, password, name: name.trim() || guessName() }));
      password = '';
      await loadPreview();
    });
  }

  async function loadPreview() {
    preview = null;
    const r = await send({ type: 'preview' });
    if (r.ok) preview = r.summary ?? null;
    else error = r.error;
  }

  const approve = () => act('approve', async () => void (await must(send({ type: 'approve' }))));
  const syncNow = (force = false) => act('sync', async () => void (await must(send({ type: 'sync', force }))));
  const unlink = () =>
    act('unlink', async () => {
      if (link?.ready && !confirm('Unlink this browser? Its bookmarks stay exactly as they are; they just stop following the site.')) return;
      await must(send({ type: 'unlink' }));
      preview = null;
    });
  const setPrefs = (patch: Partial<Prefs>) => act('prefs', async () => void (await must(send({ type: 'prefs', prefs: { ...prefs, ...patch } }))));

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
</script>

<main>
  <header>
    <span class="mark"><Icon name="home" size={22} /></span>
    <div>
      <h1>FlexiHome</h1>
      <p>Keep this browser's bookmarks in step with your FlexiHome site.</p>
    </div>
  </header>

  {#if !loaded}
    <p class="card glass muted">One moment…</p>
  {:else if !link}
    <!-- 1. Not linked -->
    <form class="card glass" onsubmit={connect}>
      <h2>Link this browser to your site</h2>
      <p class="muted">
        Bookmarks you add, change or remove here will show up on the site, and changes made on the site (from your phone, say) will
        show up here. You'll see exactly what would change before anything does.
      </p>
      <label class="field"><span>Site address</span><input class="input" bind:value={url} placeholder="home.example.com" spellcheck="false" autocomplete="url" required /></label>
      <label class="field"><span>Site password</span><input class="input" type="password" bind:value={password} autocomplete="current-password" required /></label>
      <label class="field">
        <span>What to call this browser</span>
        <input class="input" bind:value={name} maxlength="60" required />
      </label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <button class="btn primary" disabled={!!busy}>{busy === 'connect' ? 'Connecting…' : 'Connect'}</button>
      </div>
      <p class="muted small">The password is used once to get this browser its own key; it isn't stored here.</p>
    </form>
  {:else if !link.ready}
    <!-- 2. Linked, first sync not yet approved -->
    <section class="card glass">
      <h2>Connected to {host}</h2>
      {#if preview}
        <p>Here's what linking will do:</p>
        <ul class="plan">
          <li><Icon name="check" size={15} /><span><strong>{plural(preview.matched, 'bookmark or folder', 'bookmarks and folders')}</strong> already match and are left as they are.</span></li>
          <li><Icon name="cloud" size={15} /><span><strong>{preview.toSite.added}</strong> will be copied from this browser to the site.</span></li>
          <li>
            <Icon name="download" size={15} />
            <span>
              <strong>{preview.toBrowser.added}</strong> will be copied from the site to this browser{preview.waiting
                ? `, and ${preview.waiting} more will arrive through this browser's own sync`
                : ''}.
            </span>
          </li>
          <li><Icon name="trash" size={15} /><span><strong>Nothing</strong> is deleted on either side.</span></li>
        </ul>
        {#if preview.duplicates}
          <p class="muted small">{plural(preview.duplicates, 'exact duplicate')} (same name and address in the same folder) will be left where they are and not copied.</p>
        {/if}
      {:else if !error}
        <p class="muted">Comparing this browser's bookmarks with the site's…</p>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <button class="btn primary" disabled={!!busy || !preview} onclick={approve}>{busy === 'approve' ? 'Linking…' : 'Link bookmarks'}</button>
        <button class="btn" disabled={!!busy} onclick={unlink}>Cancel</button>
      </div>
    </section>
  {:else}
    <!-- 3. Linked and running -->
    <section class="card glass">
      <div class="state" data-phase={status.phase}>
        <Icon name={status.phase === 'error' ? 'cloud-off' : status.phase === 'confirm' ? 'alert' : 'circle-check'} size={22} />
        <div>
          <h2>
            {#if status.phase === 'syncing'}Syncing with {host}…
            {:else if status.phase === 'confirm'}Waiting for you
            {:else if status.phase === 'error'}Not in step with {host}
            {:else}In step with {host}{/if}
          </h2>
          {#key now}
            <p class="muted">
              {#if status.phase === 'error'}{status.message}
              {:else if status.at}Last synced {ago(status.at)}{status.seenAt > status.at ? `; checked ${ago(status.seenAt)}` : ''}.
              {:else}Not synced yet.{/if}
            </p>
          {/key}
        </div>
      </div>

      {#if status.phase === 'confirm' && sum}
        <div class="ask">
          <p>
            <strong>{plural(sum.toSite.removed + sum.toBrowser.removed, 'bookmark')}</strong> would be removed
            {sum.toSite.removed ? `from the site, because ${sum.toSite.removed === 1 ? "it's" : "they're"} gone from this browser` : 'from this browser, because they were deleted on the site'}.
            That's a lot at once, so nothing has been changed.
          </p>
          <p class="muted small">
            If you didn't mean to delete them, put them back (in Vivaldi, from the bookmarks Trash) and press “Check again”. The site also keeps
            backups under Settings.
          </p>
          <div class="row">
            <button class="btn danger" disabled={!!busy} onclick={() => syncNow(true)}>Yes, remove them</button>
            <button class="btn" disabled={!!busy} onclick={() => syncNow(false)}>Check again</button>
          </div>
        </div>
      {/if}

      {#if sum && status.phase !== 'confirm'}
        <dl>
          <div><dt>Linked</dt><dd>{plural(sum.linked, 'bookmark or folder', 'bookmarks and folders')}</dd></div>
          {#if sum.waiting}
            <div>
              <dt>Waiting</dt>
              <dd>{plural(sum.waiting, 'new item')} from the site will arrive through this browser's own sync{status.holder ? ` (from ${status.holder})` : ''}.</dd>
            </div>
          {/if}
          {#if sum.duplicates}
            <div><dt>Left alone</dt><dd>{plural(sum.duplicates, 'exact duplicate')} in this browser or on the site. Delete the spare copies to tidy up.</dd></div>
          {/if}
          <div>
            <dt>New bookmarks</dt>
            <dd>
              {#if prefs.solo}Ones made on the site are added here straight away.
              {:else if status.primary}This browser adds ones made on the site; your other linked browsers get them through the browser's own sync.
              {:else}{status.holder || 'Another linked browser'} adds ones made on the site; they reach this browser through its own sync.{/if}
            </dd>
          </div>
        </dl>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <button class="btn" disabled={!!busy || status.phase === 'syncing'} onclick={() => syncNow()}><Icon name="refresh" size={15} /> Sync now</button>
        <a class="btn" href={link.url} target="_blank" rel="noopener"><Icon name="external" size={15} /> Open the site</a>
      </div>
    </section>

    <section class="card glass">
      <h2>Options</h2>
      <label class="switch">
        <input type="checkbox" checked={prefs.newTabSite} onchange={(e) => setPrefs({ newTabSite: e.currentTarget.checked })} />
        <span>
          Open the site on new tabs
          <small>When the site can't be reached, the page built into this extension is shown instead.</small>
        </span>
      </label>
      <label class="switch">
        <input type="checkbox" checked={prefs.solo} onchange={(e) => setPrefs({ solo: e.currentTarget.checked })} />
        <span>
          This browser doesn't share bookmarks with my other linked browsers
          <small>Leave off if Vivaldi Sync (or the like) already keeps your browsers' bookmarks the same. Turning it on there would double up new bookmarks.</small>
        </span>
      </label>
      <div class="row">
        <button class="btn" disabled={!!busy} onclick={unlink}>Unlink this browser</button>
      </div>
      <p class="muted small">Linked as “{link.name}”.</p>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    background: var(--bg);
  }
  main {
    width: min(560px, 100%);
    margin: 0 auto;
    padding: 40px 16px 60px;
    display: grid;
    gap: 16px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 4px;
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  h1 {
    margin: 0;
    font: 600 20px/1.2 var(--font-display);
  }
  header p {
    margin: 2px 0 0;
    color: var(--text-muted);
  }
  .card {
    display: grid;
    gap: 14px;
    margin: 0;
    padding: 20px;
    border-radius: var(--radius-lg);
  }
  h2 {
    margin: 0;
    font: 600 16px/1.3 var(--font-display);
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--text-muted);
  }
  .small,
  small {
    font-size: 12.5px;
    line-height: 1.5;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .error {
    color: var(--danger);
  }
  .plan {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .plan li {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
  }
  .plan :global(svg) {
    margin-top: 2px;
    color: var(--accent);
  }
  .state {
    display: flex;
    gap: 12px;
    align-items: start;
  }
  .state :global(svg) {
    flex: none;
    margin-top: 1px;
    color: #0ca30c;
  }
  .state[data-phase='error'] :global(svg) {
    color: var(--danger);
  }
  .state[data-phase='confirm'] :global(svg) {
    color: #fab219;
  }
  .state p {
    margin-top: 2px;
  }
  .ask {
    display: grid;
    gap: 10px;
    padding: 14px;
    border-radius: var(--radius);
    background: var(--hover);
  }
  dl {
    display: grid;
    gap: 8px;
    margin: 0;
  }
  dl div {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 12px;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
  }
  .switch {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    align-items: start;
  }
  .switch input {
    margin-top: 3px;
    accent-color: var(--accent);
  }
  .switch small {
    display: block;
    color: var(--text-muted);
  }
</style>
