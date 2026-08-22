export type Mode = "draw" | "rig";

export const ui = $state({
  mode: "draw" as Mode,
  selectedLayerId: null as number | null,
  selectedBone: null as string | null,
});
