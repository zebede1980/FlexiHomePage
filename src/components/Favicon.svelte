<script lang="ts">
  import { faviconUrl, tileColor } from '../lib/links';
  import { hostOf } from '../lib/tree';

  let { url, title = '', size = 16 }: { url: string; title?: string; size?: number } = $props();

  let failed = $state(false);
  const host = $derived(hostOf(url));
  const letter = $derived((title.trim()[0] ?? host[0] ?? '?').toUpperCase());
  // Ask for 2x so icons stay crisp on high-DPI screens.
  const src = $derived(faviconUrl(url, Math.min(64, size * 2)));
</script>

{#if failed || !host}
  <span class="tile" style:width="{size}px" style:height="{size}px" style:background={tileColor(host || title)} style:font-size="{size * 0.6}px">
    {letter}
  </span>
{:else}
  <img {src} alt="" width={size} height={size} loading="lazy" decoding="async" draggable="false" onerror={() => (failed = true)} />
{/if}

<style>
  img,
  .tile {
    flex: none;
    border-radius: 4px;
  }
  .tile {
    display: inline-grid;
    place-items: center;
    color: #fff;
    font-weight: 700;
    line-height: 1;
  }
</style>
