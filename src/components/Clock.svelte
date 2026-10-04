<script lang="ts">
  import { settings } from '../lib/settings-store.svelte';

  let now = $state(new Date());

  $effect(() => {
    // Tick on the second boundary so the minute flips exactly on time.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      now = new Date();
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    tick();
    return () => clearTimeout(timer);
  });

  const s = $derived(settings.value);
  const hud = $derived(s.style === 'constellation');
  const time = $derived(
    now.toLocaleTimeString(undefined, { hour: s.clock24h ? '2-digit' : 'numeric', minute: '2-digit', hour12: !s.clock24h }),
  );
  /** Split at the first separator so the HUD style can blink it. */
  const timeParts = $derived(time.match(/^(\d+)([:.])(.*)$/));
  const date = $derived(
    now.toLocaleDateString(
      undefined,
      hud ? { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' } : { weekday: 'long', day: 'numeric', month: 'long' },
    ),
  );
  const greeting = $derived.by(() => {
    const h = now.getHours();
    const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return s.name.trim() ? `${part}, ${s.name.trim()}` : part;
  });
</script>

{#if s.showClock || s.showGreeting}
  <div class="clock">
    {#if s.showClock}
      <time class="time" datetime={now.toISOString()}>
        {#if hud && timeParts}{timeParts[1]}<span class="colon">{timeParts[2]}</span>{timeParts[3]}{:else}{time}{/if}
      </time>
    {/if}
    <p class="sub">
      {#if s.showGreeting}<span>{greeting}</span>{/if}
      {#if s.showGreeting && s.showClock}<span class="dot" aria-hidden="true">{hud ? '//' : '·'}</span>{/if}
      {#if s.showClock}<span>{date}</span>{/if}
    </p>
  </div>
{/if}

<style>
  .clock {
    display: grid;
    justify-items: center;
    gap: 4px;
    color: var(--ink);
    text-align: center;
    animation: fade 0.5s var(--ease) both;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .time {
    font: 300 clamp(56px, 8vw, 92px) / 1 var(--font-display);
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 2px 24px color-mix(in oklab, var(--bg) 35%, transparent);
  }
  .sub {
    margin: 0;
    display: flex;
    gap: 8px;
    font-size: 15px;
    color: var(--ink-muted);
  }
  .dot {
    opacity: 0.6;
  }

  /* ---- Constellation ---- */
  :global([data-style='constellation']) .clock {
    gap: 12px;
  }
  :global([data-style='constellation']) .time {
    font-weight: 250;
    letter-spacing: -0.02em;
    text-shadow:
      0 0 30px color-mix(in oklab, var(--accent) 45%, transparent),
      0 0 80px color-mix(in oklab, var(--accent) 18%, transparent);
    animation: boot 1s var(--ease) both;
  }
  @keyframes boot {
    from {
      opacity: 0;
      letter-spacing: 0.3em;
      filter: blur(8px);
    }
  }
  .colon {
    color: var(--accent);
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  /* Date first, then greeting: "SUN, 04 OCT 2026 // GOOD MORNING" */
  :global([data-style='constellation']) .sub {
    flex-direction: row-reverse;
    font: 500 12px/1 var(--font-mono);
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }
  :global([data-style='constellation']) .dot {
    color: var(--accent);
    opacity: 1;
  }
</style>
