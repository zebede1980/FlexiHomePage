<script lang="ts">
  import App from './App.svelte';
  import SignIn from './components/SignIn.svelte';
  import { session } from './lib/backend.svelte';
</script>

<!-- The extension and the dev server are always "signed in"; only the hosted site has a door. -->
{#if session.signedIn}
  <App />
{:else}
  <SignIn />
{/if}
