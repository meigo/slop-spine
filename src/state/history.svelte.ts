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
