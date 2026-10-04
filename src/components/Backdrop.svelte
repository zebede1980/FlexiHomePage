<script lang="ts">
  import { aurora } from '../lib/fx/aurora';
  import { constellation } from '../lib/fx/constellation';
  import { dotfield } from '../lib/fx/dotfield';
  import type { FxEngine } from '../lib/fx/loop';
  import type { StyleId } from '../lib/settings';

  /** `css` is the classic background; styles with an engine draw their own. */
  let {
    style,
    theme,
    accent,
    css,
    animate,
  }: { style: StyleId; theme: 'light' | 'dark'; accent: string; css: string; animate: boolean } = $props();

  const ENGINES: Partial<Record<StyleId, FxEngine>> = { aurora, constellation, dotfield };
  const engine = $derived(ENGINES[style]);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = $state(reducedMotion.matches);
  reducedMotion.addEventListener('change', (e) => (reduced = e.matches));

  let canvas = $state<HTMLCanvasElement>();

  // Restarts whenever the style, theme, accent or motion preference changes; the cleanup stops the old loop.
  $effect(() => {
    if (engine && canvas) return engine(canvas, { animate: animate && !reduced, theme, accent });
  });
</script>

{#if engine}
  <!-- A fresh canvas per style, so no engine inherits another's drawing state. -->
  {#key style}
    <canvas bind:this={canvas} class="bg" aria-hidden="true"></canvas>
  {/key}
  {#if style === 'aurora'}
    <!-- Film grain hides gradient banding; the vignette keeps the edges calm. Both static:
         a moving or blended full-screen layer would be recomposited every frame. -->
    <div class="grain" aria-hidden="true"></div>
    <div class="vignette" aria-hidden="true"></div>
  {/if}
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
  .grain {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    opacity: 0.045;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .vignette {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(4, 3, 14, 0.7));
  }
</style>
