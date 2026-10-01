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
  const time = $derived(
    now.toLocaleTimeString(undefined, { hour: s.clock24h ? '2-digit' : 'numeric', minute: '2-digit', hour12: !s.clock24h }),
  );
  const date = $derived(now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));
  const greeting = $derived.by(() => {
    const h = now.getHours();
    const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return s.name.trim() ? `${part}, ${s.name.trim()}` : part;
  });
</script>

{#if s.showClock || s.showGreeting}
  <div class="clock">
    {#if s.showClock}
      <time class="time" datetime={now.toISOString()}>{time}</time>
    {/if}
    <p class="sub">
      {#if s.showGreeting}<span>{greeting}</span>{/if}
      {#if s.showGreeting && s.showClock}<span class="dot" aria-hidden="true">·</span>{/if}
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
</style>
