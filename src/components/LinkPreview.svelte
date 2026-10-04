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

<svelte:window onscroll={() => preview.close()} ondragstart={() => preview.close()} onpointerdown={() => preview.close()} onkeydown={() => preview.close()} />

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
</style>
