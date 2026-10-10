<script lang="ts">
  // A status-page strip: one bar per hour (or day), coloured by how many of
  // that period's checks passed. Colour is never the only cue: every bar says
  // its period and figure on hover or focus, and bars with failures are shorter.
  import { uptimeShare } from '../lib/format';

  let {
    shares,
    unit,
    label,
  }: {
    /** Oldest first; null where nothing was recorded. */
    shares: (number | null)[];
    unit: 'hour' | 'day';
    label: string;
  } = $props();

  let active = $state<number | null>(null);

  const level = (s: number | null) => (s === null ? 'none' : s >= 0.999 ? 'good' : s >= 0.5 ? 'warn' : 'bad');

  function period(i: number): string {
    const back = shares.length - 1 - i;
    if (unit === 'day') {
      if (back === 0) return 'Today';
      if (back === 1) return 'Yesterday';
      return new Date(Date.now() - back * 86_400_000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    }
    if (back === 0) return 'This hour';
    const start = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - back * 3_600_000);
    const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${fmt(start)}–${fmt(new Date(start.getTime() + 3_600_000))}`;
  }

  const words = (s: number | null) => (s === null ? 'No checks recorded' : s >= 1 ? 'Up the whole time' : s <= 0 ? 'Down the whole time' : `Up ${uptimeShare(s)} of the time`);
</script>

<span class="strip" role="img" aria-label={label} onpointerleave={() => (active = null)}>
  {#each shares as s, i (i)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="cell" onpointerenter={() => (active = i)}><i data-level={level(s)}></i></span>
  {/each}
  {#if active !== null}
    <span class="tip" class:flip={active > shares.length / 2} style:left="{((active + 0.5) / shares.length) * 100}%">
      <strong>{words(shares[active])}</strong>
      <span>{period(active)}</span>
    </span>
  {/if}
</span>

<style>
  .strip {
    position: relative;
    display: flex;
    align-items: end;
    height: 18px;
    width: 100%;
  }
  /* The cell is the hit target, wider than the bar it holds; the 2px gap is the page showing through. */
  .cell {
    flex: 1;
    display: flex;
    align-items: end;
    height: 100%;
    padding: 0 1px;
  }
  i {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 2px;
    background: var(--st-good);
  }
  i[data-level='none'] {
    background: var(--border-strong);
    height: 40%;
  }
  i[data-level='warn'] {
    background: var(--st-warn);
    height: 70%;
  }
  i[data-level='bad'] {
    background: var(--st-critical);
    height: 45%;
  }
  .cell:hover i {
    filter: brightness(1.2);
  }
  .tip {
    position: absolute;
    bottom: calc(100% + 6px);
    z-index: 5;
    display: grid;
    padding: 5px 9px;
    border-radius: var(--radius-sm);
    background: var(--surface-solid);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow);
    font-size: 13px;
    text-align: left;
    white-space: nowrap;
    pointer-events: none;
    translate: -12px 0;
  }
  .tip.flip {
    translate: calc(-100% + 12px) 0;
  }
  .tip strong {
    font-weight: 600;
  }
  .tip span {
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
