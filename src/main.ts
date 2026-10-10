import './app.css';
import './styles/aurora.css';
import './styles/constellation.css';
import './styles/dotfield.css';
import { mount } from 'svelte';
import Root from './Root.svelte';
import { mode, refreshSession, session } from './lib/backend.svelte';

async function start() {
  // Nothing touches `chrome` at import time, so installing a stand-in before mount is enough.
  if (import.meta.env.MODE === 'web') {
    // The hosted site: bookmarks live on the FlexiHome server.
    const { installServerChrome } = await import('./lib/server-chrome');
    installServerChrome();
    await refreshSession();
  } else {
    if (mode === 'extension' && !new URLSearchParams(location.search).has('local')) {
      // Linked to a FlexiHome site and set to open it on new tabs: go there, as
      // long as the bridge last found it answering. `?local` asks for this page anyway.
      const { redirect } = ((await chrome.storage?.local.get('redirect')) ?? {}) as { redirect?: { url: string; up: boolean } | null };
      if (redirect?.up && typeof redirect.url === 'string') {
        location.replace(redirect.url);
        return;
      }
    }
    // Under `npm run dev` there are no extension APIs; swap in an in-memory fake.
    // The DEV check lets the bundler drop the fake from production builds.
    if (import.meta.env.DEV && mode === 'mock' && !globalThis.chrome?.bookmarks) {
      const { installMockChrome } = await import('./lib/mock-chrome');
      installMockChrome();
    }
    session.signedIn = true;
  }
  mount(Root, { target: document.getElementById('app')! });
}

void start();
