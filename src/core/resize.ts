/** Document resize helpers (2026-10-02): the ratio lock and the steps of a large downscale. Pure. */

export const MAX_DOC_PX = 8192;

const clampDoc = (n: number) => Math.max(1, Math.min(MAX_DOC_PX, Math.round(n)));

/** The smallest side the New and Resize dialogs accept. */
export const MIN_DOC_SIDE = 16;

/** A side typed in the New / Resize dialog, rounded, or null when it isn't one: empty or
 *  unparsable (Svelte's number binding gives null for ''), or outside 16…8192 once rounded. The
 *  dialogs refuse it with a reason: New passed an emptied field on as null and Resize clamped it
 *  to 16 px, cropping every layer to it with the undo history gone (slop-paint 6f6dcbd). */
export function docSide(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= MIN_DOC_SIDE && n <= MAX_DOC_PX ? n : null;
}

/** The other side for `value` with the ratio locked: `value` × `to` / `from`, where `from` and
 *  `to` are the document's current sides (so the ratio never drifts as you type), clamped to
 *  1…8192 px. */
export function linkedSize(value: number, from: number, to: number): number {
  if (!(from > 0) || !Number.isFinite(value)) return clampDoc(to);
  return clampDoc((value * to) / from);
}

/**
 * The sizes to shrink through, ending at the target: halve while the next halving still stays at
 * or above it, then the target. One `drawImage` from far larger reads only a few source pixels per
 * destination pixel and aliases (the stamp brushes' tip had the same problem); halving averages
 * properly. Growing or a shrink under 2× is a single step; a side that shrinks less waits at its
 * size until the last step.
 */
export function halvingSteps(
  fromW: number,
  fromH: number,
  toW: number,
  toH: number,
): { w: number; h: number }[] {
  const steps: { w: number; h: number }[] = [];
  let w = fromW;
  let h = fromH;
  // Each side halves on its own while it still can: waiting for BOTH (as it did) drew a shrink of
  // 2× or more on one side only — Keep ratio off — in one step.
  for (;;) {
    const nw = w / 2 >= toW ? Math.max(toW, Math.round(w / 2)) : w;
    const nh = h / 2 >= toH ? Math.max(toH, Math.round(h / 2)) : h;
    if (nw === w && nh === h) break;
    w = nw;
    h = nh;
    steps.push({ w, h });
  }
  const last = steps[steps.length - 1];
  if (!last || last.w !== toW || last.h !== toH) steps.push({ w: toW, h: toH });
  return steps;
}
