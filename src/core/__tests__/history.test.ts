import { describe, it, expect } from "vitest";
import { History, samePixels, type Command } from "../history";

const cmd = (bytes?: number): Command => ({ undo() {}, redo() {}, bytes });

describe("History budget", () => {
  it("a step with no pixels doesn't evict a step that alone is over the budget", () => {
    const h = new History(50, 10);
    h.push(cmd(5));
    h.push(cmd(99)); // a big edit: evicts the step before it
    h.push(cmd()); // an eye toggle: no bytes
    let undone = 0;
    while (h.canUndo) {
      h.undo();
      undone++;
    }
    expect(undone).toBe(2); // the toggle and the big edit
  });
});

describe("samePixels", () => {
  const img = (...v: number[]) => ({ data: new Uint8ClampedArray(v) }) as ImageData;

  it("is true for identical pixels", () => {
    expect(samePixels(img(1, 2, 3, 4), img(1, 2, 3, 4))).toBe(true);
  });

  it("is false when any byte differs, or the sizes do", () => {
    expect(samePixels(img(1, 2, 3, 4), img(1, 2, 3, 5))).toBe(false);
    expect(samePixels(img(1, 2, 3, 4), img(1, 2, 3, 4, 5, 6, 7, 8))).toBe(false);
  });
});
