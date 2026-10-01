<script lang="ts">
  import Icon from './Icon.svelte';
  import { dismissToast, toasts } from '../lib/ui.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class="toast">
      <span>{t.message}</span>
      {#if t.action}
        <button
          class="action"
          onclick={async () => {
            dismissToast(t.id);
            await t.action!.run();
          }}>{t.action.label}</button
        >
      {/if}
      <button class="icon-btn" aria-label="Dismiss" onclick={() => dismissToast(t.id)}><Icon name="x" size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 24px;
    translate: -50% 0;
    display: grid;
    gap: 8px;
    z-index: 50;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 8px 8px 16px;
    border-radius: 999px;
    background: var(--text);
    color: var(--surface-solid);
    box-shadow: var(--shadow-pop);
    font-size: 13.5px;
    animation: up 0.2s var(--ease);
  }
  @keyframes up {
    from {
      opacity: 0;
      translate: 0 8px;
    }
  }
  .action {
    padding: 4px 10px;
    border: 0;
    border-radius: 999px;
    background: color-mix(in oklab, var(--accent) 30%, transparent);
    color: inherit;
    font-weight: 600;
  }
  .toast .icon-btn {
    color: inherit;
    opacity: 0.7;
  }
  .toast .icon-btn:hover {
    background: rgba(127, 127, 127, 0.2);
    color: inherit;
  }
</style>
