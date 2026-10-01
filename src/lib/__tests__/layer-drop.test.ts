import { describe, expect, it } from "vitest";
import { dropTarget, type RowBox } from "../layer-drop";

// Display order, top first: layer 4 is the top of the stack (document index 3), 1 the bottom.
const rows: RowBox[] = [
  { id: 4, top: 0, bottom: 30 },
  { id: 3, top: 30, bottom: 60 },
  { id: 2, top: 60, bottom: 90 },
  { id: 1, top: 90, bottom: 120 },
];

describe("dropTarget", () => {
  it("moves a layer up the stack, the gap opening above the row it lands over", () => {
    // Layer 2 dragged above layer 4's midpoint: the top of the stack.
    expect(dropTarget(rows, 10, 2)).toEqual({ index: 3, line: 0 });
    // Between 4 and 3.
    expect(dropTarget(rows, 40, 2)).toEqual({ index: 2, line: 30 });
  });

  it("moves a layer down the stack, to the bottom past the last row", () => {
    expect(dropTarget(rows, 100, 4)).toEqual({ index: 1, line: 90 });
    expect(dropTarget(rows, 110, 4)).toEqual({ index: 0, line: 120 });
    expect(dropTarget(rows, 500, 4)).toEqual({ index: 0, line: 120 });
  });

  it("clamps a pointer above the list to the top", () => {
    expect(dropTarget(rows, -50, 1)).toEqual({ index: 3, line: 0 });
  });

  it("refuses a drop that changes nothing", () => {
    // Anywhere between the neighbours' midpoints leaves layer 3 where it is.
    expect(dropTarget(rows, 16, 3)).toBeNull();
    expect(dropTarget(rows, 45, 3)).toBeNull();
    expect(dropTarget(rows, 74, 3)).toBeNull();
    expect(dropTarget(rows, 500, 1)).toBeNull();
    expect(dropTarget(rows, -50, 4)).toBeNull();
  });

  it("refuses an unknown layer or an empty list", () => {
    expect(dropTarget(rows, 10, 99)).toBeNull();
    expect(dropTarget([], 10, 1)).toBeNull();
  });
});
