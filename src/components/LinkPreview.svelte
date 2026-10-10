<script lang="ts">
  import { brandColor } from '../lib/brand-color.svelte';
  import { faviconUrl } from '../lib/links';
  import { preview } from '../lib/preview.svelte';
  import { settings } from '../lib/settings-store.svelte';
  import { hostOf } from '../lib/tree';

  const WIDTH = 300;
  const GAP = 16;

  let box: HTMLDivElement;
  let pos = $state({ left: 0, top: 0, origin: 'left center' });
  let typed = $state('');
  /** Set for the frame the preview opens in, so it appears in place rather than gliding in from its last spot. */
  let jump = $state(false);
  let wasOpen = false;

  const t = $derived(preview.target);
  const hud = $derived(settings.value.style === 'constellation');
  const dot = $derived(settings.value.style === 'dotfield');
  const url = $derived(t?.node.url ?? '');
  const host = $derived(hostOf(url));
  const added = $derived(
    t?.node.dateAdded ? new Date(t.node.dateAdded).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '',
  );

  // Beside the card the link is in (so the card stays readable), or under a pinned tile.
  $effect(() => {
    if (!t || !preview.open) {
      wasOpen = false;
      return;
    }
    if (!wasOpen) {
      wasOpen = true;
      jump = true;
      requestAnimationFrame(() => requestAnimationFrame(() => (jump = false)));
    }
    const row = t.el.getBoundingClientRect();
    const card = t.el.closest('[data-card-id]')?.getBoundingClientRect();
    const h = box.offsetHeight;
    if (!card) {
      pos = {
        left: Math.max(12, Math.min(innerWidth - WIDTH - 12, row.left + row.width / 2 - WIDTH / 2)),
        top: Math.min(innerHeight - h - 12, row.bottom + 8),
        origin: 'top center',
      };
      return;
    }
    const right = card.right + GAP + WIDTH < innerWidth - 8;
    pos = {
      left: right ? card.right + GAP : Math.max(8, card.left - GAP - WIDTH),
      top: Math.max(12, Math.min(innerHeight - h - 12, row.top + row.height / 2 - h / 2)),
      origin: right ? 'left center' : 'right center',
    };
  });

  // HUD style types the address out.
  $effect(() => {
    const full = url;
    if (!hud || !preview.open) {
      typed = full;
      return;
    }
    let n = 0;
    typed = '';
    const timer = setInterval(() => {
      typed = full.slice(0, (n += 3));
      if (n >= full.length) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  });
</script>

<!-- Capture: the page's own drags are stopped at <body> (keepDragPrivate), so they never bubble this far. -->
<svelte:window onscroll={() => preview.close()} ondragstartcapture={() => preview.close()} onpointerdown={() => preview.close()} onkeydown={() => preview.close()} />

<div
  bind:this={box}
  class="preview"
  class:show={preview.open && !!t}
  class:jump
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  style:transform-origin={pos.origin}
  style:--c={url ? brandColor(url) : 'var(--accent)'}
  style:width="{WIDTH}px"
  aria-hidden="true"
>
  {#if t}
    {#if hud}<div class="scan"></div>{/if}
    {#if dot}<i class="tape"></i>{/if}
    <div class="head"><span>{hud ? '◉ LINK' : ''}</span><span>{host}</span></div>
    <div class="art">
      <div class="art-bar"><i></i><i></i><i></i><span></span></div>
      <div class="art-body">
        <img src={faviconUrl(url, 64)} alt="" width="40" height="40" />
        <div class="art-lines"><b></b><b style:width="70%"></b><b style:width="85%"></b></div>
      </div>
      <div class="art-tiles"><u></u><u></u><u></u></div>
    </div>
    <h3>{t.node.title || host}</h3>
    <p class="url">{typed}{#if hud && typed.length < url.length}<span class="caret"></span>{/if}</p>
    <dl>
      <dt>{hud ? 'PATH' : 'In'}</dt>
      <dd>{t.path.join(hud ? ' / ' : ' › ') || '—'}</dd>
      {#if added}
        <dt>{hud ? 'ADDED' : 'Added'}</dt>
        <dd>{added}</dd>
      {/if}
    </dl>
  {/if}
</div>

<style>
  .preview {
    position: fixed;
    z-index: 40;
    padding: 10px;
    border-radius: var(--radius-lg);
    background: var(--surface-strong);
    backdrop-filter: blur(24px) saturate(1.5);
    -webkit-backdrop-filter: blur(24px) saturate(1.5);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-pop);
    pointer-events: none;
    overflow: hidden;
    opacity: 0;
    scale: 0.95;
    transition:
      opacity 0.2s,
      scale 0.3s var(--ease),
      top 0.3s var(--ease),
      left 0.3s var(--ease);
  }
  .preview.show {
    opacity: 1;
    scale: 1;
  }
  .preview.jump {
    transition-property: opacity, scale, clip-path;
  }
  .head {
    display: none;
  }
  .art {
    height: 124px;
    border-radius: calc(var(--radius-lg) - 6px);
    overflow: hidden;
    position: relative;
    background: radial-gradient(120% 120% at 0% 0%, color-mix(in oklab, var(--c) 75%, white 10%), color-mix(in oklab, var(--c) 40%, var(--bg)));
  }
  .art-bar {
    display: flex;
    gap: 5px;
    align-items: center;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.18);
  }
  .art-bar i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.45);
  }
  .art-bar span {
    flex: 1;
    height: 8px;
    margin-left: 10px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.2);
  }
  .art-body {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px 14px 8px;
  }
  .art-body img {
    padding: 6px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  }
  .art-lines {
    flex: 1;
    display: grid;
    gap: 6px;
  }
  .art-lines b {
    display: block;
    height: 7px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.45);
  }
  .art-tiles {
    display: flex;
    gap: 6px;
    padding: 4px 14px;
  }
  .art-tiles u {
    flex: 1;
    height: 24px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.16);
  }
  h3 {
    margin: 12px 4px 2px;
    font: 600 15px/1.25 var(--font-display);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .url {
    margin: 0 4px 8px;
    font-size: 12px;
    color: var(--text-muted);
    word-break: break-all;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    margin: 0 4px 2px;
    font-size: 12px;
  }
  dt {
    color: var(--text-faint);
  }
  dd {
    margin: 0;
    color: var(--text-muted);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* ---- Constellation: HUD readout ---- */
  :global([data-style='constellation']) .preview {
    padding: 12px;
    background: rgba(6, 11, 24, 0.92);
    border-color: color-mix(in oklab, var(--c) 50%, transparent);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.5),
      0 0 50px color-mix(in oklab, var(--c) 25%, transparent),
      0 30px 70px rgba(0, 0, 0, 0.6);
    scale: 1;
    clip-path: inset(0 0 100% 0);
    transition:
      clip-path 0.35s var(--ease),
      opacity 0.2s,
      top 0.3s var(--ease),
      left 0.3s var(--ease);
  }
  :global([data-style='constellation']) .preview.show {
    clip-path: inset(-100px);
  }
  .scan {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 40%;
    pointer-events: none;
    background: linear-gradient(180deg, transparent, color-mix(in oklab, var(--c) 16%, transparent), transparent);
    animation: scan 2.5s linear infinite;
  }
  @keyframes scan {
    from {
      translate: 0 -100%;
    }
    to {
      translate: 0 260%;
    }
  }
  :global([data-style='constellation']) .head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    font: 600 10px var(--font-mono);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--c);
  }
  :global([data-style='constellation']) .art {
    height: 116px;
    border-radius: 4px;
    border: 1px solid color-mix(in oklab, var(--c) 30%, transparent);
    background: linear-gradient(135deg, color-mix(in oklab, var(--c) 45%, #050a18), #050a18 90%);
  }
  /* CRT scanlines */
  :global([data-style='constellation']) .art::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.25) 0 1px, transparent 1px 3px);
  }
  :global([data-style='constellation']) .art-body img {
    border-radius: 8px;
    box-shadow: 0 0 20px var(--c);
  }
  :global([data-style='constellation']) .url {
    font: 11.5px/1.45 var(--font-mono);
    min-height: 2.9em;
  }
  .caret {
    display: inline-block;
    width: 7px;
    height: 12px;
    margin-left: 1px;
    vertical-align: -2px;
    background: var(--c);
  }
  :global([data-style='constellation']) dl {
    padding-top: 8px;
    border-top: 1px dashed var(--border);
    font: 11px var(--font-mono);
  }
  :global([data-style='constellation']) dt {
    letter-spacing: 0.12em;
  }
  :global([data-style='constellation']) dd {
    color: var(--text);
  }

  /* ---- Aurora: glass that springs in out of a blur ---- */
  :global([data-style='aurora']) .preview {
    background: rgba(22, 20, 46, 0.94);
    backdrop-filter: none;
    filter: blur(6px);
    scale: 0.94;
    transition:
      opacity 0.25s,
      scale 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
      filter 0.25s,
      top 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
      left 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  :global([data-style='aurora']) .preview.show {
    filter: none;
    scale: 1;
  }
  :global([data-style='aurora']) .preview.jump {
    transition-property: opacity, scale, filter;
  }
  :global([data-style='aurora']) .art {
    background: radial-gradient(120% 120% at 0% 0%, color-mix(in oklab, var(--c) 70%, white 10%), color-mix(in oklab, var(--c) 35%, #0b0a1e));
  }
  :global([data-style='aurora']) dd:first-of-type {
    color: color-mix(in oklab, var(--c) 55%, white);
    font-weight: 600;
  }

  /* ---- Dot Field: a taped-on polaroid that straightens as it lands ---- */
  :global([data-style='dotfield']) .preview {
    overflow: visible;
    padding: 10px 10px 14px;
    border-radius: 18px;
    background: var(--surface-solid);
    backdrop-filter: none;
    border: 0;
    box-shadow:
      var(--shadow-pop),
      0 0 0 1px var(--border);
    rotate: -6deg;
    scale: 0.85;
    translate: 0 10px;
    transition:
      opacity 0.2s,
      rotate 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
      scale 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
      translate 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
      top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
      left 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  :global([data-style='dotfield']) .preview.show {
    rotate: -1.5deg;
    scale: 1;
    translate: 0 0;
  }
  :global([data-style='dotfield']) .preview.jump {
    transition-property: opacity, rotate, scale, translate;
  }
  .tape {
    position: absolute;
    top: -10px;
    left: 50%;
    width: 70px;
    height: 20px;
    translate: -50% 0;
    rotate: 3deg;
    background: rgba(255, 214, 120, 0.6);
  }
  :global([data-style='dotfield']) .art {
    height: 136px;
    border-radius: 10px;
    background: color-mix(in oklab, var(--c) 22%, var(--surface-solid));
  }
  :global([data-style='dotfield']) .art-bar {
    background: color-mix(in oklab, var(--c) 85%, black);
  }
  :global([data-style='dotfield']) .art-tiles u {
    background: color-mix(in oklab, var(--surface-solid) 70%, transparent);
  }
  :global([data-style='dotfield']) .art-lines b {
    background: color-mix(in oklab, var(--text) 25%, transparent);
  }
  :global([data-style='dotfield']) h3 {
    margin-top: 12px;
    font: 600 19px/1.15 var(--font-serif);
  }
  /* Facts as chips rather than a table. */
  :global([data-style='dotfield']) dl {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 10px;
  }
  :global([data-style='dotfield']) dt {
    display: none;
  }
  :global([data-style='dotfield']) dd {
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--hover);
    font-size: 11px;
    font-weight: 600;
  }
  :global([data-style='dotfield']) dd:first-of-type {
    background: color-mix(in oklab, var(--c) 16%, var(--surface-solid));
    color: color-mix(in oklab, var(--c) 70%, var(--text));
  }
</style>
