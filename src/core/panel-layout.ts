/** Layout geometry for the resizable right dock (pure; no DOM). Mirrors slop-animator's
 *  `panel-layout.ts` / `timeline-layout.ts`. */

/** Below this the layer name column stops being useful. 180 of content + 4px grip strip. */
export const MIN_DOCK_WIDTH = 184;
/** slop-paint's and slop-animator's default layer-panel width (was `w-56`, 224, before the family
 *  layout). A width saved in preferences still wins. */
export const DEFAULT_DOCK_WIDTH = 280;

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

/** Width (px) the widest tool-options row (toolbar row 2) needs to stay on one line: the brush row,
 *  which has the same controls as slop-paint's (measured there at 949). The rows wrap rather than
 *  clip, but a wrapped row is taller and moves the canvas, so re-measure this when a control is
 *  added to one. */
export const TOOL_OPTIONS_WIDTH = 960;

/** Whether the dock can start right under the top toolbar, beside the tool-options row (desktop),
 *  or must start below that row because the row would wrap next to it (iPad at the default width).
 *  As slop-paint's and slop-animator's. The widest row decides for every tool, so switching tools
 *  never moves the dock. */
export function panelBesideToolOptions(viewportW: number, dockW: number): boolean {
  return viewportW - dockW >= TOOL_OPTIONS_WIDTH;
}
