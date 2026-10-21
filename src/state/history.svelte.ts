import { History } from "../core/history";

/** The single undo/redo stack for the document's pixel edits. */
export const history = new History();

/** Mirrors `history.canUndo`/`canRedo` into `$state`. `History` is a plain class, so a button
 *  bound directly to `history.canUndo` would never re-render — see history.ts's own comment on
 *  `onChange`. One writer here beats notifying at every push/undo/redo call site. */
export const historyState = $state({
  canUndo: false,
  canRedo: false,
});

history.onChange = () => {
  historyState.canUndo = history.canUndo;
  historyState.canRedo = history.canRedo;
};

/**
 * The canvas press in progress — a brush or eraser stroke (draw-dispatch), a bone drag, a marquee
 * or float drag (Canvas) — as the function that finishes it now, the way its release would; null
 * between presses. Undo and redo wait for it: a stroke's pre-stroke copy still holds the step, so
 * its next frame put the undone pixels back and the step was lost (Ctrl+Z, or a toolbar tap, while
 * the Pencil draws); a bone drag's release pushed its press-time rig over the undo.
 */
let openPress: (() => void) | null = null;
export function setOpenPress(finish: (() => void) | null): void {
  openPress = finish;
}
export function pressOpen(): boolean {
  return openPress !== null;
}
/**
 * Finish the open press now, as its release would; the rest of the press is then ignored. Run
 * first by every edit that would otherwise race it (slop-paint ac2bd70, 8fdba64): Delete, Clear or
 * a lift mid-stroke had its pixels put back by the stroke's next frame from the pre-stroke copy,
 * and a Resize mid-stroke had the old-size copy drawn over every resized layer.
 */
export function endPress(): void {
  const finish = openPress;
  openPress = null;
  finish?.();
}

export function undo(): void {
  if (!openPress) history.undo();
}

export function redo(): void {
  if (!openPress) history.redo();
}
