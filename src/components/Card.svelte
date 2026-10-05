<script lang="ts">
  // The frame shared by every top-level card: header, collapse, the per-style
  // flourishes and drop indicators. What goes in the header tools and the body
  // is up to the card using it.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { decode, tilt } from '../lib/fx/pointer';
  import { tileColor } from '../lib/links';
  import { settings } from '../lib/settings-store.svelte';
  import { endDrag, hint, isDragging } from '../lib/ui.svelte';

  let {
    id,
    title,
    count,
    unit,
    index = 0,
    collapsed,
    ontoggle,
    ondragstart,
    ondragover,
    ondragleave,
    ondrop,
    tools,
    children,
    el = $bindable(),
  }: {
    /** Matched against drag hints and read by App's grid as data-card-id. */
    id: string;
    title: string;
    count: number;
    /** What `count` counts, for styles that spell it out ("4 links"). */
    unit: string;
    index?: number;
    collapsed: boolean;
    ontoggle: () => void;
    ondragstart: (e: DragEvent) => void;
    ondragover?: (e: DragEvent) => void;
    ondragleave?: (e: DragEvent) => void;
    ondrop?: (e: DragEvent) => void;
    tools: Snippet;
    children: Snippet;
    el?: HTMLElement;
  } = $props();

  const hud = $derived(settings.value.style === 'constellation');
  const dot = $derived(settings.value.style === 'dotfield');
  const aurora = $derived(settings.value.style === 'aurora');
  const fx = $derived(hud && settings.value.effects);
  const pad2 = (n: number) => String(n).padStart(2, '0');
</script>

<section
  bind:this={el}
  data-card-id={id}
  class="card glass"
  class:dragging={isDragging(id)}
  class:drop-inside={hint.id === id && hint.edge === 'inside'}
  class:drop-before={hint.id === id && hint.edge === 'before'}
  class:drop-after={hint.id === id && hint.edge === 'after'}
  aria-label={title}
  style:--i={index}
  use:tilt={fx}
  {ondragover}
  {ondragleave}
  {ondrop}
>
  {#if aurora}
    <!-- Lit from --mx/--my, which App's use:spotlight keeps up to date. -->
    <i class="rim" data-spot aria-hidden="true"></i><i class="sheen" data-spot aria-hidden="true"></i>
  {/if}
  {#if hud}
    <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
    <div class="glare"></div>
  {/if}
  <!-- Dragging is a pointer shortcut; keyboard users move things via the Edit dialog's folder picker. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header draggable="true" {ondragstart} ondragend={endDrag}>
    <button class="title" aria-expanded={!collapsed} onclick={ontoggle} title={collapsed ? 'Expand' : 'Collapse'}>
      <span class="chev" class:open={!collapsed}><Icon name="chevron-right" size={14} /></span>
      {#if hud}<span class="idx">{pad2(index + 1)}</span>{/if}
      {#if aurora}<span class="orb" style:--fc={tileColor(title)} aria-hidden="true"></span>{/if}
      {#if dot}<span class="badge" style:background={tileColor(title)} aria-hidden="true">{(title.trim()[0] ?? '?').toUpperCase()}</span>{/if}
      <h2>
        <span class="sr-only">{title}</span>
        <span aria-hidden="true" use:decode={{ text: title, enabled: fx, trigger: '[data-card-id]' }}></span>
      </h2>
      <span class="count">{hud ? `[${pad2(count)}]` : dot ? `${count} ${unit}` : count}</span>
    </button>
    <div class="tools">
      <span class="icon-btn grip" title="Drag to move this group" aria-hidden="true"><Icon name="grip" size={16} /></span>
      {@render tools()}
    </div>
  </header>

  {#if !collapsed}
    <div class="body">
      {@render children()}
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

  /* ---- Aurora: glass whose border and sheen light up from the pointer ---- */
  :global([data-style='aurora']) .card {
    isolation: isolate;
    padding: 8px;
    animation: bloom 0.8s var(--ease) backwards;
    animation-delay: calc(0.15s + var(--i, 0) * 0.07s);
  }
  @keyframes bloom {
    from {
      opacity: 0;
      translate: 0 24px;
      filter: blur(10px);
    }
  }
  .rim,
  .sheen {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
  }
  /* A 1px ring: the gradient is masked down to the border box. */
  .rim {
    z-index: 1;
    padding: 1px;
    background:
      radial-gradient(
        340px circle at var(--mx, -999px) var(--my, -999px),
        color-mix(in oklab, var(--accent) 45%, white),
        color-mix(in oklab, var(--accent-2) 40%, transparent) 35%,
        transparent 60%
      ),
      linear-gradient(rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.07));
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    mask-composite: exclude;
  }
  .sheen {
    z-index: -1;
    background: radial-gradient(500px circle at var(--mx, -999px) var(--my, -999px), color-mix(in oklab, var(--accent) 13%, transparent), transparent 45%);
  }
  :global([data-style='aurora']) .card.drop-inside .rim {
    background: linear-gradient(var(--accent), var(--accent));
  }
  .orb {
    flex: none;
    width: 8px;
    height: 8px;
    margin-left: 2px;
    border-radius: 50%;
    background: var(--fc);
    box-shadow: 0 0 12px var(--fc);
  }
  :global([data-style='aurora']) .chev {
    display: none;
  }
  :global([data-style='aurora']) .title {
    gap: 10px;
  }
  :global([data-style='aurora']) h2 {
    flex: 1;
    font-size: 15px;
    letter-spacing: 0.01em;
  }
  :global([data-style='aurora']) .count {
    padding: 2px 8px;
    border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent);
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    color: color-mix(in oklab, var(--accent) 35%, white);
  }
  .title[aria-expanded='false'] .orb {
    opacity: 0.4;
    box-shadow: none;
  }

  /* ---- Dot Field: paper cards that lift, with a letter badge ---- */
  :global([data-style='dotfield']) .card {
    padding: 8px;
    transition:
      translate 0.45s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.35s,
      opacity 0.35s,
      filter 0.35s,
      background 0.15s;
    animation: lift-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
    animation-delay: calc(0.2s + var(--i, 0) * 0.06s);
  }
  @keyframes lift-in {
    from {
      opacity: 0;
      translate: 0 20px;
    }
  }
  :global([data-style='dotfield']) .card:hover {
    translate: 0 -4px;
    box-shadow:
      var(--shadow-lift),
      0 0 0 1px var(--border);
  }
  :global([data-style='dotfield']) header {
    padding: 4px 2px 8px 4px;
  }
  :global([data-style='dotfield']) .title {
    gap: 10px;
    height: 42px;
  }
  :global([data-style='dotfield']) .chev {
    display: none;
  }
  .badge {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 12px;
    color: #fff;
    font: 700 16px/1 var(--font-serif);
    transition:
      rotate 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
      scale 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
      opacity 0.2s;
  }
  .card:hover .badge {
    rotate: -10deg;
    scale: 1.08;
  }
  /* Collapsed: the badge dims, since there's no chevron to say so. */
  .title[aria-expanded='false'] .badge {
    opacity: 0.55;
  }
  :global([data-style='dotfield']) h2 {
    flex: 1;
    font: 600 21px/1.1 var(--font-serif);
    letter-spacing: -0.01em;
  }
  :global([data-style='dotfield']) .count {
    padding: 0;
    background: none;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
