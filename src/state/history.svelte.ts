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

/** Set while a brush or eraser stroke is open (draw-dispatch). Undo and redo wait for it to end:
 *  the stroke's pre-stroke copy still holds the step, so its next frame would put the undone pixels
 *  back and the step would be lost (Ctrl+Z, or a toolbar tap, while the Pencil draws). As
 *  slop-paint. */
let strokeOpen = false;
export function setStrokeOpen(open: boolean): void {
  strokeOpen = open;
}

export function undo(): void {
  if (!strokeOpen) history.undo();
}

export function redo(): void {
  if (!strokeOpen) history.redo();
}
