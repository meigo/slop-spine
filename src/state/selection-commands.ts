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
} = { copy: null, cut: null, paste: null, del: null, deselect: null };
