<script lang="ts">
  import { ui, TOOL_LABELS } from "../state/ui.svelte";

  const kbd =
    "font-mono text-[10px] px-1 py-px rounded-sm border border-border bg-surface-hover text-text mx-px";
  const sep = "opacity-60";
</script>

<!-- As slop-paint's status bar: fixed height, px-5 so the text clears the rounded window corners on
     an iPad. Priority: an explicit message (why something did nothing) beats the hint for whatever
     the pointer is on, which beats the current context. -->
<div
  class="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-5 text-xs text-text-secondary select-none"
>
  <span class="truncate">
    {#if ui.statusMessage}
      <span class="text-text">{ui.statusMessage}</span>
    {:else if ui.statusHint}
      {ui.statusHint}
    {:else if ui.selectionState === "selected"}
      <span class="font-medium text-text">Selection</span>
      <span class={sep}>·</span>
      drag inside to free-transform
      <span class={sep}>·</span>
      <kbd class={kbd}>Esc</kbd> deselect
    {:else if ui.selectionState === "transforming"}
      <span class="font-medium text-text">Free transform</span>
      <span class={sep}>·</span>
      corners scale, sides skew, top handle rotates
      <span class={sep}>·</span>
      <kbd class={kbd}>Enter</kbd> apply
      <kbd class={kbd}>Esc</kbd> cancel
    {:else if ui.selectionState === "warping"}
      <span class="font-medium text-text"
        >{ui.warpRows === 2 && ui.warpCols === 2
          ? "4-corner distort"
          : `Mesh warp ${ui.warpRows}×${ui.warpCols}`}</span
      >
      <span class={sep}>·</span>
      drag any control point
      <span class={sep}>·</span>
      <kbd class={kbd}>Enter</kbd> apply
      <kbd class={kbd}>Esc</kbd> cancel
    {:else if ui.tool === "bone"}
      <kbd class={kbd}>Shift</kbd> drag to create
      <kbd class={kbd}>Alt</kbd> drag to pose
      <span class={sep}>·</span>
      <kbd class={kbd}>Del</kbd> delete bone
    {:else if ui.tool === "select" || ui.tool === "lasso"}
      Drag with the <kbd class={kbd}>S</kbd> or <kbd class={kbd}>L</kbd> tool to make a selection
    {/if}
  </span>
  <span class="shrink-0">{TOOL_LABELS[ui.tool]}</span>
</div>
