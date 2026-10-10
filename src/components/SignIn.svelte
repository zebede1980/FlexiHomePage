<script lang="ts">
  import Backdrop from './Backdrop.svelte';
  import Icon from './Icon.svelte';
  import { ApiError, api, refreshSession, session } from '../lib/backend.svelte';
  import { settings } from '../lib/settings-store.svelte';
  import { styleDef } from '../lib/styles';

  // A set-up link ends in #setup=<code>; the code is single-use, so it comes out of the address bar straight away.
  const setupCode = /^#setup=([\w-]+)$/.exec(location.hash)?.[1] ?? '';
  if (setupCode) history.replaceState(null, '', location.pathname);

  const choosing = setupCode !== '';
  const look = styleDef(settings.value.style);
  const theme: 'light' | 'dark' =
    look.themes.length === 1
      ? look.themes[0]
      : settings.value.theme === 'auto'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : settings.value.theme;
  const accent = look.accent ?? settings.value.accent;
  document.documentElement.style.setProperty('--accent', accent);

  let password = $state('');
  let again = $state('');
  let error = $state('');
  let busy = $state(false);
  let waitUntil = $state(0);
  let now = $state(Date.now());
  const waiting = $derived(Math.max(0, Math.ceil((waitUntil - now) / 1000)));

  $effect(() => {
    if (waitUntil <= Date.now()) return;
    const t = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(t);
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy || waiting) return;
    error = '';
    if (choosing && password !== again) {
      error = "Those two don't match.";
      return;
    }
    busy = true;
    try {
      if (choosing) await api('/api/auth/setup', { method: 'POST', body: { code: setupCode, password } });
      else await api('/api/auth/login', { method: 'POST', body: { password } });
      await refreshSession();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && err.wait) {
        now = Date.now();
        waitUntil = now + err.wait * 1000;
      }
    } finally {
      busy = false;
    }
  }
</script>

<Backdrop style={look.id} {theme} {accent} css="" animate={settings.value.effects} />

<main>
  <form class="door glass" onsubmit={submit}>
    <span class="mark"><Icon name="home" size={22} /></span>
    {#if choosing}
      <h1>Choose a password</h1>
      <p>This is the only password for your FlexiHome. Pick something long; you'll rarely need to type it.</p>
    {:else if session.needsSetup}
      <h1>Not set up yet</h1>
      <p>This FlexiHome has no password. Open the one-time set-up link from the server's log to choose one.</p>
    {:else}
      <h1>FlexiHome</h1>
      <p>Sign in once and this browser stays signed in.</p>
    {/if}

    {#if choosing || !session.needsSetup}
      <!-- A username field (hidden) so password managers file this under one account. -->
      <input class="sr-only" type="text" name="username" autocomplete="username" value="flexihome" readonly tabindex="-1" aria-hidden="true" />
      <label>
        <span class="sr-only">Password</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="input"
          type="password"
          name="password"
          bind:value={password}
          placeholder={choosing ? 'New password (10 characters or more)' : 'Password'}
          autocomplete={choosing ? 'new-password' : 'current-password'}
          minlength={choosing ? 10 : undefined}
          required
          autofocus
        />
      </label>
      {#if choosing}
        <label>
          <span class="sr-only">The same password again</span>
          <input class="input" type="password" bind:value={again} placeholder="And once more" autocomplete="new-password" required />
        </label>
      {/if}
      <button class="btn primary" disabled={busy || waiting > 0}>
        {#if waiting}Try again in {waiting}s{:else if busy}One moment…{:else if choosing}Save and sign in{:else}Sign in{/if}
      </button>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if session.offline}<p class="error" role="alert">Can't reach the server just now.</p>{/if}
  </form>
</main>

<style>
  main {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px 16px;
  }
  .door {
    width: min(360px, 100%);
    display: grid;
    gap: 12px;
    padding: 28px 24px 24px;
    border-radius: var(--radius-lg);
    text-align: center;
  }
  .mark {
    justify-self: center;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  h1 {
    margin: 4px 0 0;
    font: 600 20px/1.2 var(--font-display);
  }
  p {
    margin: 0 0 4px;
    color: var(--text-muted);
    text-wrap: balance;
  }
  /* 16px stops iOS zooming the page when the field is focused. */
  .input {
    width: 100%;
    font-size: 16px;
  }
  .btn {
    justify-content: center;
    height: 40px;
  }
  .error {
    margin: 0;
    color: var(--danger);
  }
</style>
