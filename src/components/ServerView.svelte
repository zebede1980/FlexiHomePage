<script lang="ts">
  // The Server tab: how each machine is doing, and which apps on it are live.
  // The first machine is the one the site runs on; the others report in through the agent.
  import Icon, { type IconName } from './Icon.svelte';
  import Menu from './Menu.svelte';
  import Sparkline from './Sparkline.svelte';
  import UptimeStrip from './UptimeStrip.svelte';
  import { ago, bytes, duration, percent, uptimeShare } from '../lib/format';
  import { monitor, type AppState, type AppView, type HostInfo, type MachineView, type Range } from '../lib/monitor.svelte';
  import { toast } from '../lib/ui.svelte';

  $effect(() => monitor.watch());

  const view = $derived(monitor.view);
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
    off: { label: 'Offline', icon: 'moon' },
  };

  // ---- machines ----
  /** One machine as the page shows it, whether it is the site's own or one that reports in. */
  interface Shown {
    /** null for the machine the site runs on. */
    id: number | null;
    name: string;
    /** Its readings are current. */
    online: boolean;
    /** When it was last heard from; 0 if never. */
    ts: number;
    host: HostInfo | null;
    apps: AppView[];
    errors: string[];
    remote: MachineView | null;
  }

  const all = $derived.by((): Shown[] => {
    if (!view) return [];
    const own: Shown[] = view.probe
      ? [{ id: null, name: view.host?.hostname || 'This server', online: !view.stale, ts: view.ts, host: view.host, apps: view.apps, errors: view.errors, remote: null }]
      : [];
    return [...own, ...view.machines.map((m): Shown => ({ id: m.id, name: m.name, online: m.online, ts: m.ts, host: m.host, apps: m.apps, errors: m.errors, remote: m }))];
  });
  const current = $derived(all.find((m) => m.id === monitor.machine) ?? all[0] ?? null);
  // The charts follow whichever machine is on screen, including when the one picked has been removed.
  $effect(() => {
    if (current) monitor.setMachine(current.id);
  });

  const host = $derived(current?.host ?? null);
  const remote = $derived(current?.remote ?? null);
  const isTrouble = (a: AppView) => !a.hidden && (a.state === 'down' || a.state === 'degraded');
  /** A few words on a machine for its tab. */
  function tabNote(m: Shown): { text: string; state: AppState } {
    if (m.remote && !m.online) return { text: m.ts ? 'Offline' : 'Not reporting yet', state: 'off' };
    const bad = m.apps.filter(isTrouble);
    if (bad.length) return { text: `${bad.length} need${bad.length === 1 ? 's' : ''} attention`, state: bad.some((a) => a.state === 'down') ? 'down' : 'degraded' };
    return { text: 'All up', state: 'up' };
  }

  // ---- apps ----
  const order: Record<AppState, number> = { down: 0, degraded: 1, up: 2, off: 3 };
  // Trouble first; then the apps you open (they have an address) before the services behind them.
  const byState = (a: AppView, b: AppView) =>
    order[a.state] - order[b.state] || Number(!a.url) - Number(!b.url) || a.name.localeCompare(b.name);
  const shown = $derived((current?.apps ?? []).filter((a) => !a.hidden).sort(byState));
  const hidden = $derived((current?.apps ?? []).filter((a) => a.hidden).sort(byState));
  const troubled = $derived(shown.filter(isTrouble));
  const offline = $derived(!!remote && !current?.online);
  const headState = $derived<AppState>(offline ? 'off' : troubled.length ? (troubled.some((a) => a.state === 'down') ? 'down' : 'degraded') : 'up');

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
    if (app.state === 'off') return 'Not known while its machine is offline';
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
  const part = (used: number, total: number) => (total ? used / total : 0);
  const memShare = $derived(host ? part(host.mem.used, host.mem.total) : 0);
  // A machine with several drives is summed for the headline figure and listed drive by drive beneath it.
  const drives = $derived(host?.disks && host.disks.length > 1 ? host.disks : []);
  const disk = $derived(
    drives.length ? { used: drives.reduce((a, d) => a + d.used, 0), total: drives.reduce((a, d) => a + d.total, 0) } : (host?.disk ?? { used: 0, total: 0 }),
  );
  const diskShare = $derived(part(disk.used, disk.total));
  const fullest = $derived(drives.reduce((worst, d) => Math.max(worst, part(d.used, d.total)), diskShare));
  // Load is "how many cores' worth of work is queued"; more than there are cores means things are waiting.
  // Windows has no such figure, so there the line names the processor instead.
  const hasLoad = $derived(!!host && host.platform !== 'win32');
  const busy = $derived(host && hasLoad ? host.load[0] > host.cores : false);
  const cores = $derived(host?.perCore ?? []);
  const gpus = $derived(host?.gpus ?? []);
  const shortGpu = (name: string) => name.replace(/^(NVIDIA|AMD|Intel(\(R\))?)\s+/i, '').replace(/^GeForce\s+/i, '');

  /** When the machine last started, worked out from how long it has been up. */
  const bootedAt = (uptime: number, at: number) =>
    new Date(at - uptime * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const series = (i: 1 | 2 | 6 | 8) => samples.flatMap((s): [number, number][] => (typeof s[i] === 'number' ? [[s[0], s[i] as number]] : []));
  const traffic = $derived(samples.map((s): [number, number] => [s[0], s[3] + s[4]]));
</script>

<div class="server">
  {#if !view}
    <p class="glass note">{monitor.error || 'Reading the server…'}</p>
  {:else if !view.available || !current}
    <p class="glass note">
      Server monitoring isn't set up on this FlexiHome. It needs the probe container running alongside, or another machine added under
      Settings.
    </p>
  {:else}
    {#if all.length > 1}
      <nav class="machines" aria-label="Machines">
        {#each all as m (m.id)}
          {@const note = tabNote(m)}
          <button class="machine glass" class:on={m.id === current.id} aria-pressed={m.id === current.id} data-state={note.state} onclick={() => monitor.setMachine(m.id)}>
            <Icon name={m.remote ? 'monitor' : 'server'} size={18} />
            <span class="m-name">{m.name}</span>
            <span class="m-note"><Icon name={STATES[note.state].icon} size={13} />{note.text}</span>
          </button>
        {/each}
      </nav>
    {/if}

    <header class="head">
      <div class="headline" data-state={headState}>
        <Icon name={STATES[headState].icon} size={26} />
        <div>
          <h1>
            {#if offline}
              {current.name} {current.ts ? 'is switched off or out of reach' : "hasn't reported yet"}
            {:else if !shown.length}
              No apps found
            {:else if !troubled.length}
              All {shown.length} apps are up
            {:else}
              {troubled.length} of {shown.length} apps need{troubled.length === 1 ? 's' : ''} attention
            {/if}
          </h1>
          {#if offline}
            <p>
              {#if current.ts}Last heard from {ago(current.ts)}. What follows is the last it reported.{:else}Start the agent on it with the key
                from Settings, and it will appear here within a few seconds.{/if}
            </p>
          {:else if host}
            <p>{host.hostname || current.name} · {host.os} · running for {duration(host.uptime)}</p>
          {/if}
        </div>
      </div>
      <div class="segmented" role="group" aria-label="History shown in the charts">
        {#each RANGES as r (r.id)}
          <button class:on={monitor.range === r.id} aria-pressed={monitor.range === r.id} onclick={() => monitor.setRange(r.id)}>{r.label}</button>
        {/each}
      </div>
    </header>

    {#if monitor.error || (!remote && current.ts > 0 && !current.online) || (current.online && current.errors.length)}
      <p class="glass note warn" role="status">
        <Icon name="alert" size={16} />
        <span>
          {#if monitor.error}{monitor.error}{:else if !remote && !current.online}These numbers are from {ago(current.ts)}; the server's probe has stopped
            answering.{:else}Some readings are missing: {current.errors.join('; ')}{/if}
        </span>
      </p>
    {/if}
    {#if remote && current.online && !remote.docker.available && shown.some((a) => a.container)}
      <p class="glass note warn" role="status">
        <Icon name="alert" size={16} />
        <span>Docker isn't running on {current.name}, so none of its containers are.{remote.docker.error ? ` (${remote.docker.error})` : ''}</span>
      </p>
    {/if}
    {#if host?.rebootRequired && current.online}
      <p class="glass note warn" role="status">
        <Icon name="refresh" size={16} />
        <span>{remote ? current.name : 'The server'} needs a restart to finish installing updates.</span>
      </p>
    {/if}

    {#if host}
      <section class="tiles" class:six={gpus.length > 0} class:stale={offline} aria-label="{current.name}: resources">
        <article class="tile glass">
          <h2>{offline ? 'Was running for' : 'Uptime'}</h2>
          <p class="value words">{duration(host.uptime)}</p>
          <p class="sub">Since {bootedAt(host.uptime, offline ? current.ts : Date.now())}</p>
          {#if remote}
            <!-- A machine that gets switched off: when it was on matters as much as for how long. -->
            <UptimeStrip shares={remote.hours} unit="hour" label="{current.name}: switched on and reporting for {uptimeShare(remote.uptime24h)} of the last 24 hours, hour by hour" />
            <p class="sub free">On for {uptimeShare(remote.uptime24h)} of the last 24 hours · {uptimeShare(remote.uptime7d)} of 7 days</p>
          {:else}
            <p class="sub free">{host.kernel ? `Linux ${host.kernel}` : host.os}</p>
          {/if}
        </article>

        <article class="tile glass">
          <h2>Processor</h2>
          <p class="value">{percent(host.cpu)}</p>
          <p class="sub" class:flag={busy}>
            {#if busy}<Icon name="alert" size={13} />{/if}
            {#if hasLoad}
              Load {host.load[0].toFixed(2)} across {host.cores} cores{busy ? ': work is queuing' : ''}
            {:else}
              <span class="clip" title={host.cpuModel}>{host.cores} cores{host.cpuModel ? ` · ${host.cpuModel.replace(/\((R|TM)\)/g, '')}` : ''}</span>
            {/if}
          </p>
          <Sparkline points={series(1)} format={percent} label="Processor use" />
          {#if cores.length > 1}
            <div class="cores" role="img" aria-label="Each core's use right now; the busiest is at {percent(Math.max(...cores))}">
              {#each cores as c, i (i)}<i style:height="{Math.max(6, c * 100)}%" title="Core {i + 1}: {percent(c)}"></i>{/each}
            </div>
            <p class="sub free">Each of the {cores.length} cores{offline ? '' : ', right now'}</p>
          {/if}
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
          <h2>{drives.length ? `Disks (${drives.length})` : 'Disk'}</h2>
          <p class="value">{percent(diskShare)}</p>
          <p class="sub" class:flag={level(fullest) !== 'ok'}>
            {#if level(fullest) !== 'ok'}<Icon name="alert" size={13} />{/if}
            {bytes(disk.used)} of {bytes(disk.total)} used{level(fullest) !== 'ok' ? (drives.length ? ': one is running low' : ': running low') : ''}
          </p>
          {#if drives.length}
            <ul class="drives">
              {#each drives as d (d.name)}
                {@const s = part(d.used, d.total)}
                <li>
                  <span class="d-name">{d.name}</span>
                  <div class="meter" data-level={level(s)} role="meter" aria-label="{d.name} space used" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(s * 100)}>
                    <i style:width="{s * 100}%"></i>
                  </div>
                  <span class="d-free">{bytes(d.total - d.used)} free</span>
                </li>
              {/each}
            </ul>
          {:else}
            <div class="meter" data-level={level(diskShare)} role="meter" aria-label="Disk space used" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(diskShare * 100)}>
              <i style:width="{diskShare * 100}%"></i>
            </div>
            <p class="sub free">{bytes(disk.total - disk.used)} free</p>
          {/if}
        </article>

        <article class="tile glass">
          <h2>Network</h2>
          <p class="value">{bytes(host.net.rx + host.net.tx, true)}</p>
          <p class="sub">{bytes(host.net.rx, true)} in · {bytes(host.net.tx, true)} out</p>
          <Sparkline points={traffic} format={(v) => bytes(v, true)} label="Network traffic, in and out together" />
        </article>

        {#each gpus as g, i (i)}
          {@const vram = part(g.memUsed, g.memTotal)}
          <article class="tile glass">
            <h2>Graphics card{gpus.length > 1 ? ` ${i + 1}` : ''}</h2>
            <p class="value">{percent(g.util)}</p>
            <p class="sub"><span class="clip" title={g.name}>{shortGpu(g.name)}</span></p>
            {#if i === 0}<Sparkline points={series(6)} format={percent} max={1} label="Graphics card use" height={32} />{/if}
            <p class="sub free" class:flag={level(vram) !== 'ok'}>
              {#if level(vram) !== 'ok'}<Icon name="alert" size={13} />{/if}
              {bytes(g.memUsed)} of {bytes(g.memTotal)} of its memory in use
            </p>
            <div class="meter" data-level={level(vram)} role="meter" aria-label="Graphics memory in use" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(vram * 100)}>
              <i style:width="{vram * 100}%"></i>
            </div>
            <p class="sub">
              {[g.temp !== null ? `${Math.round(g.temp)} °C` : '', g.power !== null ? `${Math.round(g.power)} W` : '', g.fan !== null ? `fan ${percent(g.fan)}` : '']
                .filter(Boolean)
                .join(' · ')}
            </p>
            {#if i === 0 && g.temp !== null}<Sparkline points={series(8)} format={(v) => `${Math.round(v)} °C`} label="Graphics card temperature" height={28} />{/if}
          </article>
        {/each}
      </section>
    {/if}

    {#snippet row(app: AppView)}
      {@const st = STATES[app.state]}
      {@const c = app.container}
      {@const live = c?.state === 'running' && app.state !== 'off'}
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
            <span class="num"><em>CPU</em>{c && live ? percent(c.cpu) : '–'}</span>
            <span class="num"><em>Memory</em>{c && live ? bytes(c.mem) : '–'}</span>
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
                    {#if remote}<span class="aside">Counted only while {current.name} is on.</span>{/if}
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

    <section class="apps glass" class:stale={offline} aria-label="Apps on {current.name}">
      <header>
        <h2>Apps</h2>
        <span class="count">{shown.length}</span>
      </header>
      {#if shown.length}
        <ul>
          {#each shown as app (app.key)}{@render row(app)}{/each}
        </ul>
      {:else}
        <p class="none">{remote ? `Nothing found on ${current.name} yet. Its containers appear here once Docker is running there.` : 'Nothing to show yet.'}</p>
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

  /* ---- which machine ---- */
  .machines {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .machine {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 1px 10px;
    min-width: 170px;
    padding: 9px 14px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--text-muted);
    text-align: left;
  }
  .machine > :global(svg) {
    grid-row: 1 / 3;
  }
  .machine.on {
    border-color: var(--accent);
    color: var(--text);
  }
  .m-name {
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .m-note {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
  }
  .machine[data-state='up'] .m-note :global(svg) {
    color: var(--st-good);
  }
  .machine[data-state='degraded'] .m-note :global(svg) {
    color: var(--st-warn);
  }
  .machine[data-state='down'] .m-note :global(svg) {
    color: var(--st-critical);
  }
  /* Last-known readings from a machine that has gone quiet: still there to read, plainly not live. */
  .stale {
    opacity: 0.6;
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
  .headline[data-state='off'] :global(svg) {
    color: var(--ink-muted);
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
  /* A graphics card makes six tiles: three to a row sits better than five and one. */
  @media (min-width: 721px) {
    .tiles.six {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .tile {
    display: grid;
    /* Without this a long unbroken line (a processor's name) widens the tile's contents past the tile. */
    grid-template-columns: minmax(0, 1fr);
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
  /* Long names (a processor's, a graphics card's) are cut short; the full one is in the tooltip. */
  .clip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* One bar per core, all in the accent colour: the shape of the load, not a state. */
  .cores {
    display: flex;
    align-items: end;
    gap: 2px;
    height: 30px;
    margin-top: 8px;
  }
  .cores i {
    flex: 1;
    min-width: 2px;
    border-radius: 2px 2px 0 0;
    background: var(--accent);
    opacity: 0.75;
    transition: height 0.4s var(--ease);
  }
  .drives {
    display: grid;
    gap: 7px;
    margin-top: 2px;
  }
  .drives li {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
  }
  .drives .meter {
    margin: 0;
  }
  .d-name {
    font-weight: 600;
  }
  .d-free {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
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
  [data-state='off'] .state {
    color: var(--text-muted);
  }
  .aside {
    display: block;
    color: var(--text-muted);
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
