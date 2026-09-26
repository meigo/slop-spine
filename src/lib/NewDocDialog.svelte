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

  // No second window.confirm: the warn line in the dialog says what Create discards, and Create is
  // the confirmation (as slop-paint's New dialog).
  function confirm() {
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
    <div class="flex w-80 flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-xl">
      <h2 class="text-sm font-semibold text-text">New Document</h2>
      <div class="flex flex-col gap-2">
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          Width
          <input
            class="h-7 flex-1 rounded border border-border bg-surface px-2 text-xs text-text"
            type="number"
            min="16"
            max="8192"
            bind:value={width}
          />
          <span class="text-text-muted">px</span>
        </label>
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          Height
          <input
            class="h-7 flex-1 rounded border border-border bg-surface px-2 text-xs text-text"
            type="number"
            min="16"
            max="8192"
            bind:value={height}
          />
          <span class="text-text-muted">px</span>
        </label>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[11px] text-text-muted">Presets</span>
        <div class="flex flex-wrap gap-1">
          {#each PRESETS as p (p.label)}
            <button
              class="rounded border border-border px-2 py-1 text-[10px] text-text-secondary transition-colors hover:bg-surface-hover {width ===
                p.w && height === p.h
                ? 'ui-on'
                : 'bg-surface'}"
              onclick={() => {
                width = p.w;
                height = p.h;
              }}>{p.label}</button
            >
          {/each}
        </div>
      </div>
      <p class="text-[11px] text-warn">
        Replaces the current drawing, rig, undo history and the autosaved copy. Save first (File ▸
        Save) to keep it.
      </p>
      <div class="flex justify-end gap-2 pt-1">
        <button
          class="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
          onclick={onCancel}>Cancel</button
        >
        <button
          class="rounded bg-accent px-3 py-1.5 text-xs text-accent-text hover:opacity-90"
          onclick={confirm}>Create</button
        >
      </div>
    </div>
  </div>
{/if}
