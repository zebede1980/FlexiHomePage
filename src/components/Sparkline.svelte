<script lang="ts">
  // A single-series trend line with a crosshair readout. One series, so no
  // legend: the tile it sits in names it.
  import { clockTime } from '../lib/format';

  let {
    points,
    format,
    max,
    label,
    height = 44,
  }: {
    /** [time in ms, value], oldest first. */
    points: [number, number][];
    format: (v: number) => string;
    /** Fixed top of the scale (1 for a share); otherwise the data's own peak. */
    max?: number;
    /** What the line shows, for screen readers. */
    label: string;
    height?: number;
  } = $props();

  let width = $state(240);
  let hover = $state<number | null>(null);

  const PAD = 3;
  const top = $derived(max ?? Math.max(1e-9, ...points.map((p) => p[1])) * 1.15);
  const t0 = $derived(points[0]?.[0] ?? 0);
  const t1 = $derived(points[points.length - 1]?.[0] ?? 1);
  const x = (t: number) => (t1 === t0 ? width : ((t - t0) / (t1 - t0)) * width);
  const y = (v: number) => height - PAD - (Math.min(v, top) / top) * (height - PAD * 2);
  const line = $derived(points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(''));
  const area = $derived(points.length > 1 ? `${line}L${width} ${height}L0 ${height}Z` : '');
  const spansDays = $derived(t1 - t0 > 20 * 3600_000);
  const shown = $derived(hover !== null ? points[hover] : null);

  /** The crosshair snaps to the nearest sample, so the pointer aims at a time rather than at the line. */
  function onMove(e: PointerEvent) {
    if (points.length < 2) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i][0] - t) < Math.abs(points[best][0] - t)) best = i;
    hover = best;
  }
</script>

<div
  class="spark"
  style:height="{height}px"
  bind:clientWidth={width}
  role="img"
  aria-label="{label}: {points.length ? `latest ${format(points[points.length - 1][1])}` : 'no history yet'}"
  onpointermove={onMove}
  onpointerleave={() => (hover = null)}
>
  {#if points.length > 1}
    <svg {width} {height} aria-hidden="true">
      <path class="area" d={area} />
      <path class="line" d={line} />
      {#if shown}
        <line class="cross" x1={x(shown[0])} x2={x(shown[0])} y1="0" y2={height} />
        <circle class="dot" cx={x(shown[0])} cy={y(shown[1])} r="4" />
      {/if}
    </svg>
    {#if shown}
      <div class="tip" class:flip={x(shown[0]) > width / 2} style:left="{x(shown[0])}px">
        <strong>{format(shown[1])}</strong>
        <span>{clockTime(shown[0], spansDays)}</span>
      </div>
    {/if}
  {:else}
    <span class="empty">Collecting history…</span>
  {/if}
</div>

<style>
  .spark {
    position: relative;
    touch-action: pan-y;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .area {
    fill: color-mix(in oklab, var(--accent) 12%, transparent);
  }
  .cross {
    stroke: var(--border-strong);
    stroke-width: 1;
  }
  /* The ring is the surface colour, so the marker reads against the line it sits on. */
  .dot {
    fill: var(--accent);
    stroke: var(--surface-solid);
    stroke-width: 2;
  }
  .tip {
    position: absolute;
    bottom: calc(100% + 4px);
    z-index: 5;
    display: grid;
    padding: 5px 9px;
    border-radius: var(--radius-sm);
    background: var(--surface-solid);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow);
    white-space: nowrap;
    pointer-events: none;
    translate: 8px 0;
  }
  .tip.flip {
    translate: calc(-100% - 8px) 0;
  }
  .tip strong {
    font-weight: 600;
  }
  .tip span {
    font-size: 12px;
    color: var(--text-muted);
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 12px;
    color: var(--text-faint);
  }
</style>
