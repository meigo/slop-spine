/** slop-spine has no cell/group compose — every selection is document-space. */

export type ComposeStep = { t: { dx: number; dy: number; scale: number; rotation: number } };
export type Pt = { x: number; y: number };

export function needsMap(_steps: ComposeStep[]): boolean {
  return false;
}

export function mapDocRectToCell(
  _steps: ComposeStep[],
  r: { x: number; y: number; w: number; h: number },
): Pt[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

export function mapDocPolyToCell(_steps: ComposeStep[], pts: Pt[]): Pt[] {
  return pts.map((p) => ({ ...p }));
}
