<script lang="ts">
  import { constellation } from '../lib/fx/constellation';
  import { dotfield } from '../lib/fx/dotfield';
  import type { FxEngine } from '../lib/fx/loop';
  import type { StyleId } from '../lib/settings';

  /** `css` is the classic background; styles with an engine draw their own. */
  let { style, theme, css, animate }: { style: StyleId; theme: 'light' | 'dark'; css: string; animate: boolean } = $props();

  const ENGINES: Partial<Record<StyleId, FxEngine>> = { constellation, dotfield };
  const engine = $derived(ENGINES[style]);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = $state(reducedMotion.matches);
  reducedMotion.addEventListener('change', (e) => (reduced = e.matches));

  let canvas = $state<HTMLCanvasElement>();

  // Restarts whenever the style, theme or motion preference changes; the cleanup stops the old loop.
  $effect(() => {
    if (engine && canvas) return engine(canvas, { animate: animate && !reduced, theme });
  });
</script>

{#if engine}
  <canvas bind:this={canvas} class="bg" aria-hidden="true"></canvas>
{:else}
  <div class="bg" style:background={css} aria-hidden="true"></div>
{/if}

<style>
  .bg {
    position: fixed;
    inset: 0;
    z-index: -1;
    width: 100%;
    height: 100%;
    background-attachment: fixed;
    transition: background 0.4s;
  }
</style>
