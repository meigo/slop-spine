/** Canvas.svelte owns the marquee, the layer contexts and the undo bracket, so everything outside
 *  it (the toolbar's select-tool row) reaches these through this registry. The alternative — the
 *  `slop-spine:fit-view` window-event pattern used elsewhere in this app — would need five more
 *  event names for five commands. Mirrors slop-animator's `selectionActions`.
 *
 *  Null until Canvas mounts; every call site uses `?.()`. `paste` reports whether it consumed the
 *  gesture, so a Cmd+V with an empty pixel clipboard can fall through to importing an image from
 *  the system clipboard instead. */
export const selectionCommands: {
  copy: (() => void) | null;
  cut: (() => void) | null;
  paste: (() => boolean) | null;
  del: (() => void) | null;
  deselect: (() => void) | null;
  selectAll: (() => void) | null;
  /** Lift the marquee into a free-transform float. */
  transform: (() => void) | null;
  /** Lift (if needed) and warp on a rows×cols grid: 2×2 is Distort, 3×3 Mesh. */
  warp: ((rows: number, cols: number) => void) | null;
  /** Warp grid one step denser (+1) or coarser (−1). */
  densify: ((delta: number) => void) | null;
  setDeformMode: ((m: "ffd" | "rigid") => void) | null;
  resetPins: (() => void) | null;
  /** Bake the float into the layer (Enter). */
  apply: (() => void) | null;
  /** Drop the float, restoring the layer (Esc). */
  cancel: (() => void) | null;
} = {
  copy: null,
  cut: null,
  paste: null,
  del: null,
  deselect: null,
  selectAll: null,
  transform: null,
  warp: null,
  densify: null,
  setDeformMode: null,
  resetPins: null,
  apply: null,
  cancel: null,
};
