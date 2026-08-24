<script lang="ts">
  import type { Snippet } from "svelte";
  import { clickOutside } from "./click-outside";

  let { label, children }: { label: string; children: Snippet<[() => void]> } = $props();
  let open = $state(false);
  const close = () => (open = false);
</script>

<div class="relative shrink-0" use:clickOutside={close}>
  <button
    class="flex h-8 shrink-0 items-center gap-1 rounded px-2 text-sm text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={open}
    onclick={() => (open = !open)}
  >
    {label}<span class="text-[10px] opacity-70">▾</span>
  </button>
  {#if open}
    <div
      class="absolute right-0 top-full z-30 mt-1 min-w-44 rounded border border-border bg-surface py-1 shadow-lg"
      role="menu"
    >
      {@render children(close)}
    </div>
  {/if}
</div>
