import './app.css';
import './styles/aurora.css';
import './styles/constellation.css';
import './styles/dotfield.css';
import { mount } from 'svelte';
import App from './App.svelte';

async function start() {
  // Under `npm run dev` there are no extension APIs; swap in an in-memory fake.
  // Nothing touches `chrome` at import time, so installing it before mount is enough.
  if (import.meta.env.DEV && !globalThis.chrome?.bookmarks) {
    const { installMockChrome } = await import('./lib/mock-chrome');
    installMockChrome();
  }
  mount(App, { target: document.getElementById('app')! });
}

void start();
