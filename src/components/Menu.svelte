<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface MenuItem {
    label: string;
    icon: IconName;
    run: () => void;
    danger?: boolean;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  let { items, label = 'More actions' }: { items: MenuItem[]; label?: string } = $props();

  // The popover API gives us top-layer rendering, light dismiss and Esc for free.
  let button: HTMLButtonElement;
  let pop: HTMLDivElement;
  const popId = `menu-${Math.random().toString(36).slice(2)}`;

  function place(e: ToggleEvent) {
    if (e.newState !== 'open') return;
    const r = button.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  }

  function choose(item: MenuItem) {
    pop.hidePopover();
    item.run();
  }
</script>

<button bind:this={button} class="icon-btn" popovertarget={popId} title={label} aria-label={label}>
  <Icon name="more" size={16} />
</button>

<div bind:this={pop} id={popId} popover="auto" class="menu" role="menu" ontoggle={place}>
  {#each items as item (item.label)}
    <button class="item" class:danger={item.danger} role="menuitem" onclick={() => choose(item)}>
      <Icon name={item.icon} size={15} />
      {item.label}
    </button>
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    inset: auto;
    margin: 0;
    min-width: 190px;
    padding: 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-solid);
    color: var(--text);
    box-shadow: var(--shadow-pop);
  }
  .menu:popover-open {
    display: grid;
    animation: pop 0.14s var(--ease);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    text-align: left;
    color: var(--text);
  }
  .item :global(svg) {
    color: var(--text-muted);
  }
  .item:hover,
  .item:focus-visible {
    background: var(--hover);
    outline: none;
  }
  .item.danger,
  .item.danger :global(svg) {
    color: var(--danger);
  }
</style>
