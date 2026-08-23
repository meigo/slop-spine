/** Layout geometry for the resizable right dock (pure; no DOM). Mirrors slop-animator's
 *  `panel-layout.ts` / `timeline-layout.ts`. */

/** Below this the layer name column stops being useful. 180 of content + 4px grip strip. */
export const MIN_DOCK_WIDTH = 184;
/** Tailwind `w-56`, the fixed width the dock had before it became resizable. */
export const DEFAULT_DOCK_WIDTH = 224;

export function clampDockWidth(px: number, viewportW: number): number {
  const max = Math.max(MIN_DOCK_WIDTH, Math.round(viewportW * 0.5));
  return Math.max(MIN_DOCK_WIDTH, Math.min(px, max));
}

/** Inspector header + a couple fields. */
export const MIN_INSPECTOR_HEIGHT = 96;
/** Tall enough for bone fields without eating the layer list. */
export const DEFAULT_INSPECTOR_HEIGHT = 200;

export function clampInspectorHeight(px: number, columnH: number): number {
  const max = Math.max(MIN_INSPECTOR_HEIGHT, Math.round(columnH * 0.6));
  return Math.max(MIN_INSPECTOR_HEIGHT, Math.min(px, max));
}
