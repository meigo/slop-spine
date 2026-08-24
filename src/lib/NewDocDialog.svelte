<script lang="ts">
  const PRESETS = [
    { label: "1024 × 1024", w: 1024, h: 1024 },
    { label: "2048 × 2048", w: 2048, h: 2048 },
    { label: "1080 × 1920", w: 1080, h: 1920 },
    { label: "1920 × 1080", w: 1920, h: 1080 },
  ];

  let {
    open = false,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: (width: number, height: number) => void;
    onCancel: () => void;
  } = $props();

  let width = $state(2048);
  let height = $state(2048);

  $effect(() => {
    if (open) {
      width = 2048;
      height = 2048;
    }
  });

  function confirm() {
    if (
      !window.confirm(
        "Start a new project?\n\nThe current project and its autosave are discarded. This can't be undone.",
      )
    )
      return;
    onConfirm(width, height);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    role="presentation"
    onkeydown={onKey}
    onpointerdown={(e) => {
      if (e.target === e.currentTarget) onCancel();
    }}
  >
    <div
      class="flex w-80 flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm text-text shadow-lg"
    >
      <h2 class="font-semibold">New document</h2>
      <div class="flex flex-col gap-1">
        {#each PRESETS as p (p.label)}
          <button
            class="rounded px-2 py-1 text-left hover:bg-surface-hover"
            class:bg-surface-active={width === p.w && height === p.h}
            onclick={() => {
              width = p.w;
              height = p.h;
            }}
          >
            {p.label}
          </button>
        {/each}
      </div>
      <div class="flex items-center gap-2 text-xs text-text-secondary">
        <label class="flex items-center gap-1">
          W
          <input
            class="w-16 bg-canvas-bg px-1 text-text"
            type="number"
            min="16"
            max="8192"
            bind:value={width}
          />
        </label>
        <label class="flex items-center gap-1">
          H
          <input
            class="w-16 bg-canvas-bg px-1 text-text"
            type="number"
            min="16"
            max="8192"
            bind:value={height}
          />
        </label>
      </div>
      <div class="flex justify-end gap-2">
        <button
          class="rounded px-2 py-1 text-text-secondary hover:bg-surface-hover"
          onclick={onCancel}
        >
          Cancel
        </button>
        <button
          class="rounded bg-accent px-2 py-1 text-accent-text hover:opacity-90"
          onclick={confirm}
        >
          Create
        </button>
      </div>
    </div>
  </div>
{/if}
