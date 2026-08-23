export type Mode = "draw" | "rig";
export type Tool = "brush" | "eraser" | "fill";
export type BrushType = "smooth" | "ink" | "pencil";

export const ui = $state({
  mode: "draw" as Mode,
  selectedLayerId: null as number | null,
  selectedBone: null as string | null,
  tool: "brush" as Tool,
  brushType: "smooth" as BrushType,
  brushSize: 12,
  brushOpacity: 100,
  brushValue: "#000000",
});
