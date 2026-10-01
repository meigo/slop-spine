/** Where a layer row dragged in the layers panel lands (2026-10-01, SLOP-LAYER-DRAG.md). The list
 *  is flat, so a drop is just a stack index. Rows are in display order (top of the stack first)
 *  with their top/bottom in the list's content coordinates; `line` is where the gap opens. */
export type RowBox = { id: number; top: number; bottom: number };
/** `index` is the document array index `reorderLayer` takes (0 = bottom of the stack). */
export type Drop = { index: number; line: number };

const mid = (r: RowBox) => (r.top + r.bottom) / 2;

/** The drop for layer `id` with the pointer at content y `y`, or null when it would change
 *  nothing. The slot counts the other rows whose midpoint the pointer is below. */
export function dropTarget(rows: readonly RowBox[], y: number, id: number): Drop | null {
  const from = rows.findIndex((r) => r.id === id);
  if (from === -1) return null;
  const others = rows.filter((r) => r.id !== id);
  const slot = others.filter((r) => mid(r) < y).length;
  if (slot === from) return null;
  const line = slot < others.length ? others[slot].top : rows[rows.length - 1].bottom;
  return { index: rows.length - 1 - slot, line };
}
