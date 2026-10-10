<script lang="ts">
  // The Server tab: how the machine is doing, and which apps are live.
  import Icon, { type IconName } from './Icon.svelte';
  import Menu from './Menu.svelte';
  import Sparkline from './Sparkline.svelte';
  import UptimeStrip from './UptimeStrip.svelte';
  import { ago, bytes, duration, percent, uptimeShare } from '../lib/format';
  import { monitor, type AppState, type AppView, type Range } from '../lib/monitor.svelte';
  import { toast } from '../lib/ui.svelte';

  $effect(() => monitor.watch());

  const view = $derived(monitor.view);
  const host = $derived(view?.host ?? null);
  const samples = $derived(monitor.samples);

  const RANGES: { id: Range; label: string }[] = [
    { id: '1h', label: '1 hour' },
    { id: '24h', label: '24 hours' },
    { id: '7d', label: '7 days' },
  ];

  const STATES: Record<AppState, { label: string; icon: IconName }> = {
    up: { label: 'Up', icon: 'circle-check' },
    degraded: { label: 'Problem', icon: 'alert' },
    down: { label: 'Down', icon: 'circle-x' },
  };

  // ---- apps ----
  const order: Record<AppState, number> = { down: 0, degraded: 1, up: 2 };
  // Trouble first; then the apps you open (they have an address) before the services behind them.
  const byState = (a: AppView, b: AppView) =>
    order[a.state] - order[b.state] || Number(!a.url) - Number(!b.url) || a.name.localeCompare(b.name);
  const shown = $derived((view?.apps ?? []).filter((a) => !a.hidden).sort(byState));
  const hidden = $derived((view?.apps ?? []).filter((a) => a.hidden).sort(byState));
  const troubled = $derived(shown.filter((a) => a.state !== 'up'));

  let open = $state<string | null>(null);
  let editing = $state<string | null>(null);
  let showHidden = $state(false);
  let draft = $state({ label: '', url: '' });

  function startEdit(app: AppView) {
    open = app.key;
    editing = app.key;
    draft = { label: app.name, url: app.url };
  }

  async function save(app: AppView) {
    try {
      // An empty field goes back to what was worked out automatically.
      await monitor.setPrefs(app.key, { label: draft.label.trim() || null, url: draft.url.trim() || null });
      editing = null;
    } catch (e) {
      toast(`Couldn't save that: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function setHidden(app: AppView, value: boolean) {
    try {
      await monitor.setPrefs(app.key, { hidden: value });
      if (value) toast(`Hid ${app.name}`, { label: 'Undo', run: () => monitor.setPrefs(app.key, { hidden: false }) });
    } catch (e) {
      toast(`Couldn't change that: ${e instanceof Error ? e.message : e}`);
    }
  }

  const menuFor = (app: AppView) => [
    { label: 'Rename or change link', icon: 'pencil' as const, run: () => startEdit(app) },
    app.hidden
      ? { label: 'Show in the list again', icon: 'eye' as const, run: () => void setHidden(app, false) }
      : { label: 'Hide from this list', icon: 'eye-off' as const, run: () => void setHidden(app, true) },
  ];

  /** One line under the name: what's wrong, or how long it has been fine. */
  function summary(app: AppView): string {
    if (app.issues.length) {
      const since = app.downSince ? ` Since ${ago(app.downSince)}.` : '';
      return app.issues.join(' ') + (app.state === 'up' ? '' : since);
    }
    const c = app.container;
    if (c?.health === 'starting') return 'Starting up…';
    if (c?.startedAt) return `Running for ${duration((Date.now() - c.startedAt) / 1000)}`;
    return app.http ? 'Answering at its address' : 'Running';
  }

  // ---- machine ----
  type Level = 'ok' | 'warn' | 'critical';
  const level = (share: number): Level => (share >= 0.9 ? 'critical' : share >= 0.75 ? 'warn' : 'ok');
  const memShare = $derived(host && host.mem.total ? host.mem.used / host.mem.total : 0);
  const diskShare = $derived(host && host.disk.total ? host.disk.used / host.disk.total : 0);
  // Load is "how many cores' worth of work is queued"; more than there are cores means things are waiting.
  const busy = $derived(host ? host.load[0] > host.cores : false);

  /** When the machine last started, worked out from how long it has been up. */
  const bootedAt = (uptime: number) =>
    new Date(Date.now() - uptime * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const series = (i: 1 | 2) => samples.map((s): [number, number] => [s[0], s[i]]);
  const traffic = $derived(samples.map((s): [number, number] => [s[0], s[3] + s[4]]));
</script>

<div class="server">
  {#if !view}
    <p class="glass note">{monitor.error || 'Reading the server…'}</p>
  {:else if !view.available}
    <p class="glass note">Server monitoring isn't set up on this FlexiHome (it needs the probe container running alongside).</p>
  {:else}
    <header class="head">
      <div class="headline" data-state={troubled.length ? (troubled.some((a) => a.state === 'down') ? 'down' : 'degraded') : 'up'}>
        <Icon name={troubled.length ? (troubled.some((a) => a.state === 'down') ? 'circle-x' : 'alert') : 'circle-check'} size={26} />
        <div>
          <h1>
            {#if !shown.length}
              No apps found
            {:else if !troubled.length}
              All {shown.length} apps are up
            {:else}
              {troubled.length} of {shown.length} apps need{troubled.length === 1 ? 's' : ''} attention
            {/if}
          </h1>
          {#if host}
            <p>{host.hostname || 'This server'} · {host.os} · running for {duration(host.uptime)}</p>
          {/if}
        </div>
      </div>
      <div class="segmented" role="group" aria-label="History shown in the charts">
        {#each RANGES as r (r.id)}
          <button class:on={monitor.range === r.id} aria-pressed={monitor.range === r.id} onclick={() => monitor.setRange(r.id)}>{r.label}</button>
        {/each}
      </div>
    </header>

    {#if view.stale || monitor.error || view.errors.length}
      <p class="glass note warn" role="status">
        <Icon name="alert" size={16} />
        <span>
          {#if monitor.error}{monitor.error}{:else if view.stale}These numbers are from {ago(view.ts)}; the server's probe has stopped answering.{:else}Some
            readings are missing: {view.errors.join('; ')}{/if}
        </span>
      </p>
    {/if}
    {#if host?.rebootRequired}
      <p class="glass note warn" role="status">
        <Icon name="refresh" size={16} />
        <span>The server needs a restart to finish installing updates.</span>
      </p>
    {/if}

    {#if host}
      <section class="tiles" aria-label="Server resources">
        <article class="tile glass">
          <h2>Uptime</h2>
          <p class="value words">{duration(host.uptime)}</p>
          <p class="sub">Since {bootedAt(host.uptime)}</p>
          <p class="sub free">{host.kernel ? `Linux ${host.kernel}` : host.os}</p>
        </article>

        <article class="tile glass">
          <h2>Processor</h2>
          <p class="value">{percent(host.cpu)}</p>
          <p class="sub" class:flag={busy}>
            {#if busy}<Icon name="alert" size={13} />{/if}
            Load {host.load[0].toFixed(2)} across {host.cores} cores{busy ? ': work is queuing' : ''}
          </p>
          <Sparkline points={series(1)} format={percent} label="Processor use" />
        </article>

        <article class="tile glass">
          <h2>Memory</h2>
          <p class="value">{percent(memShare)}</p>
          <p class="sub" class:flag={level(memShare) !== 'ok'}>
            {#if level(memShare) !== 'ok'}<Icon name="alert" size={13} />{/if}
            {bytes(host.mem.used)} of {bytes(host.mem.total)} in use{level(memShare) === 'critical' ? ': nearly full' : ''}
          </p>
          <div class="meter" data-level={level(memShare)} role="meter" aria-label="Memory in use" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(memShare * 100)}>
            <i style:width="{memShare * 100}%"></i>
          </div>
          <Sparkline points={series(2)} format={percent} max={1} label="Memory use" height={32} />
        </article>

        <article class="tile glass">
          <h2>Disk</h2>
          <p class="value">{percent(diskShare)}</p>
          <p class="sub" class:flag={level(diskShare) !== 'ok'}>
            {#if level(diskShare) !== 'ok'}<Icon name="alert" size={13} />{/if}
            {bytes(host.disk.used)} of {bytes(host.disk.total)} used{level(diskShare) !== 'ok' ? ': running low' : ''}
          </p>
          <div class="meter" data-level={level(diskShare)} role="meter" aria-label="Disk space used" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(diskShare * 100)}>
            <i style:width="{diskShare * 100}%"></i>
          </div>
          <p class="sub free">{bytes(host.disk.total - host.disk.used)} free</p>
        </article>

        <article class="tile glass">
          <h2>Network</h2>
          <p class="value">{bytes(host.net.rx + host.net.tx, true)}</p>
          <p class="sub">{bytes(host.net.rx, true)} in · {bytes(host.net.tx, true)} out</p>
          <Sparkline points={traffic} format={(v) => bytes(v, true)} label="Network traffic, in and out together" />
        </article>
      </section>
    {/if}

    {#snippet row(app: AppView)}
      {@const st = STATES[app.state]}
      {@const c = app.container}
      <li class="app" class:open={open === app.key} data-state={app.state}>
        <div class="line">
          <button class="main" aria-expanded={open === app.key} onclick={() => ((open = open === app.key ? null : app.key), (editing = null))}>
            <span class="state"><Icon name={st.icon} size={17} /><span>{st.label}</span></span>
            <span class="who">
              <strong>{app.name}</strong>
              <span class="why">{summary(app)}</span>
            </span>
          </button>
          <span class="nums">
            <span class="num up">
              <em>Uptime, 24 h</em>
              <span class="up-row">
                <UptimeStrip shares={app.hours} unit="hour" label="{app.name}: up {uptimeShare(app.uptime24h)} over the last 24 hours, hour by hour" />
                <span>{uptimeShare(app.uptime24h)}</span>
              </span>
            </span>
            <span class="num"><em>CPU</em>{c && c.state === 'running' ? percent(c.cpu) : '–'}</span>
            <span class="num"><em>Memory</em>{c && c.state === 'running' ? bytes(c.mem) : '–'}</span>
          </span>
          <span class="acts">
            {#if app.url}
              <a class="icon-btn" href={app.url} target="_blank" rel="noopener" title="Open {app.name}" aria-label="Open {app.name}"><Icon name="external" size={15} /></a>
            {/if}
            <Menu items={menuFor(app)} label="Actions for {app.name}" />
          </span>
        </div>

        {#if open === app.key}
          <div class="more">
            {#if editing === app.key}
              <form
                class="edit"
                onsubmit={(e) => {
                  e.preventDefault();
                  void save(app);
                }}
              >
                <label class="field"><span>Name shown here</span><input class="input" bind:value={draft.label} placeholder={c?.name ?? app.key} /></label>
                <label class="field"><span>Link</span><input class="input" bind:value={draft.url} placeholder="https://…" spellcheck="false" /></label>
                <div class="edit-acts">
                  <button class="btn primary">Save</button>
                  <button class="btn" type="button" onclick={() => (editing = null)}>Cancel</button>
                </div>
              </form>
            {:else}
              <dl>
                {#if app.domains.length}
                  <div><dt>Address</dt><dd>{app.domains.join(', ')}</dd></div>
                {/if}
                {#if app.http}
                  <div>
                    <dt>Last check</dt>
                    <dd>
                      {app.http.ok ? `Answered in ${app.http.ms} ms` : `Failed: ${app.http.error}`}, {ago(app.http.checkedAt)}
                      {#if app.http.certDays !== null}· certificate good for {app.http.certDays} more days{/if}
                    </dd>
                  </div>
                {/if}
                <div>
                  <dt>Uptime</dt>
                  <dd>
                    {uptimeShare(app.uptime24h)} over 24 hours · {uptimeShare(app.uptime7d)} over 7 days · {uptimeShare(app.uptime30d)} over 30 days
                    <span class="month">
                      <UptimeStrip shares={app.days} unit="day" label="{app.name}: up {uptimeShare(app.uptime30d)} over the last 30 days, day by day" />
                      <span class="ends"><span>30 days ago</span><span>Today</span></span>
                    </span>
                  </dd>
                </div>
                {#if c}
                  <div><dt>Container</dt><dd>{c.name}{c.project ? ` (part of ${c.project})` : ''}</dd></div>
                  <div><dt>Image</dt><dd>{c.image}</dd></div>
                  <div><dt>Docker says</dt><dd>{c.status}{c.restarts ? ` · restarted ${c.restarts} time${c.restarts === 1 ? '' : 's'}` : ''}</dd></div>
                  {#if c.finishedAt && c.state !== 'running'}
                    <div><dt>Stopped</dt><dd>{ago(c.finishedAt)}</dd></div>
                  {/if}
                {/if}
              </dl>
            {/if}
          </div>
        {/if}
      </li>
    {/snippet}

    <section class="apps glass" aria-label="Apps">
      <header>
        <h2>Apps</h2>
        <span class="count">{shown.length}</span>
      </header>
      {#if shown.length}
        <ul>
          {#each shown as app (app.key)}{@render row(app)}{/each}
        </ul>
      {:else}
        <p class="none">Nothing to show yet.</p>
      {/if}
      {#if hidden.length}
        <button class="hidden-toggle" aria-expanded={showHidden} onclick={() => (showHidden = !showHidden)}>
          <span class="chev" class:open={showHidden}><Icon name="chevron-right" size={14} /></span>
          {hidden.length} hidden
        </button>
        {#if showHidden}
          <ul class="dim">
            {#each hidden as app (app.key)}{@render row(app)}{/each}
          </ul>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  .server {
    --st-good: #0ca30c;
    --st-warn: #fab219;
    --st-critical: #d03b3b;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
    color: var(--text);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 14px 24px;
    color: var(--ink);
  }
  .headline {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .headline :global(svg) {
    flex: none;
  }
  .headline[data-state='up'] :global(svg) {
    color: var(--st-good);
  }
  .headline[data-state='degraded'] :global(svg) {
    color: var(--st-warn);
  }
  .headline[data-state='down'] :global(svg) {
    color: var(--st-critical);
  }
  h1 {
    margin: 0;
    font: 600 24px/1.2 var(--font-display);
    letter-spacing: -0.01em;
  }
  .headline p {
    margin: 3px 0 0;
    color: var(--ink-muted);
  }

  .segmented {
    display: inline-flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .segmented button {
    height: 28px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
  }
  .segmented button.on {
    background: var(--surface-solid);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  .note {
    margin: 0;
    padding: 12px 16px;
    border-radius: var(--radius);
    color: var(--text-muted);
  }
  .note.warn {
    display: flex;
    gap: 10px;
    align-items: start;
    color: var(--text);
  }
  .note.warn :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--st-warn);
  }

  /* ---- tiles ---- */
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 16px;
  }
  .tile {
    display: grid;
    align-content: start;
    gap: 4px;
    min-width: 0;
    padding: 16px 18px 14px;
    border-radius: var(--radius-lg);
  }
  .tile h2 {
    margin: 0;
    font: 600 12px/1.3 var(--font);
    color: var(--text-muted);
  }
  .value {
    margin: 0;
    font: 600 28px/1.15 var(--font-display);
    letter-spacing: -0.01em;
  }
  /* A phrase rather than a figure: smaller, so it stays on one line in a narrow tile. */
  .value.words {
    font-size: 21px;
    line-height: 1.55;
    white-space: nowrap;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 0 0 8px;
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .sub.flag {
    color: var(--text);
  }
  .sub.flag :global(svg) {
    flex: none;
    color: var(--st-warn);
  }
  .sub.free {
    margin: 6px 0 0;
  }
  /* The track is a pale step of the fill's own colour, so the state reads along the whole bar. */
  .meter {
    --fill: var(--accent);
    height: 8px;
    margin-bottom: 8px;
    border-radius: 4px;
    background: color-mix(in oklab, var(--fill) 18%, transparent);
    overflow: hidden;
  }
  .meter[data-level='warn'] {
    --fill: var(--st-warn);
  }
  .meter[data-level='critical'] {
    --fill: var(--st-critical);
  }
  .meter i {
    display: block;
    height: 100%;
    min-width: 4px;
    border-radius: 4px;
    background: var(--fill);
    transition: width 0.4s var(--ease);
  }

  /* ---- apps ---- */
  .apps {
    border-radius: var(--radius-lg);
    padding: 6px;
  }
  .apps > header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 12px 8px;
  }
  .apps h2 {
    margin: 0;
    font: 600 15px/1.2 var(--font-display);
  }
  .count {
    font-size: 12px;
    color: var(--text-faint);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  ul.dim {
    opacity: 0.75;
  }
  .app {
    border-radius: var(--radius);
  }
  .app + .app {
    border-top: 1px solid var(--border);
  }
  .app.open {
    background: var(--hover);
  }
  .line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 200px 64px 78px auto;
    align-items: center;
    gap: 12px;
    padding: 0 6px 0 0;
  }
  .main {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 9px 0 9px 12px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    text-align: left;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
  }
  .state :global(svg) {
    flex: none;
  }
  [data-state='up'] .state :global(svg) {
    color: var(--st-good);
  }
  [data-state='degraded'] .state :global(svg) {
    color: var(--st-warn);
  }
  [data-state='down'] .state :global(svg) {
    color: var(--st-critical);
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .who strong {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .why {
    font-size: 12.5px;
    color: var(--text-muted);
  }
  [data-state='up'] .why {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* On a wide screen the three numbers are columns of the row's own grid. */
  .nums {
    display: contents;
  }
  .num {
    display: grid;
    justify-items: end;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .num em {
    font-style: normal;
    font-size: 11px;
    color: var(--text-faint);
  }
  .num.up {
    justify-items: stretch;
  }
  .num.up em {
    justify-self: end;
  }
  .up-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    align-items: center;
    gap: 8px;
    text-align: right;
  }
  .month {
    display: grid;
    gap: 3px;
    max-width: 420px;
    margin-top: 8px;
  }
  .ends {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-faint);
  }
  .acts {
    display: flex;
    align-items: center;
    justify-content: end;
    gap: 2px;
    min-width: 60px;
  }
  .more {
    padding: 2px 12px 14px 120px;
  }
  dl {
    display: grid;
    gap: 5px;
    margin: 0;
    font-size: 13px;
  }
  dl div {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 12px;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .edit {
    display: grid;
    gap: 10px;
    max-width: 420px;
  }
  .edit-acts {
    display: flex;
    gap: 8px;
  }
  .hidden-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-top: 1px solid var(--border);
    background: none;
    color: var(--text-muted);
    font-weight: 500;
    text-align: left;
  }
  .chev {
    display: inline-grid;
    transition: rotate 0.15s;
  }
  .chev.open {
    rotate: 90deg;
  }
  .none {
    margin: 0;
    padding: 4px 12px 12px;
    color: var(--text-muted);
  }

  /* Phones: the numbers drop under the name instead of squeezing it. */
  @media (max-width: 720px) {
    h1 {
      font-size: 20px;
    }
    /* Two to a row keeps the readings on one screen; uptime, being a phrase, gets a row of its own. */
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .tile {
      padding: 14px 14px 12px;
    }
    .tile:first-child {
      grid-column: 1 / -1;
    }
    .value {
      font-size: 24px;
    }
    .line {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0 8px;
    }
    .main {
      grid-area: 1 / 1;
      grid-template-columns: minmax(0, 1fr);
      gap: 3px;
      padding-bottom: 6px;
    }
    .acts {
      grid-area: 1 / 2;
      align-self: start;
      padding-top: 6px;
    }
    .nums {
      grid-area: 2 / 1 / 3 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: 2px 16px;
      padding: 0 12px 10px;
    }
    .num {
      display: inline-flex;
      gap: 5px;
      align-items: baseline;
      font-size: 12.5px;
    }
    .num.up {
      flex: 1 0 100%;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .num.up em {
      justify-self: start;
    }
    .more {
      padding-left: 12px;
    }
    dl div {
      grid-template-columns: 84px minmax(0, 1fr);
    }
  }
</style>
