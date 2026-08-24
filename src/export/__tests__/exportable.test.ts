import { describe, it, expect } from "vitest";
import { assertExportable, ExportError } from "../bundle";
import type { RigDocument } from "../../rig/document";

function doc(bones: RigDocument["bones"]): RigDocument {
  return { canvas: { width: 8, height: 8 }, layers: [], slots: [], bones, binds: [], density: 24 };
}

const root = { name: "root", parent: null, x: 4, y: 4, rotation: 0, length: 0, wobble: 0 };

describe("assertExportable", () => {
  it("refuses a document with only root", () => {
    expect(() => assertExportable(doc([root]))).toThrow(ExportError);
  });

  it("allows a document with a real bone", () => {
    expect(() =>
      assertExportable(
        doc([
          root,
          { name: "arm", parent: "root", x: 4, y: 0, rotation: -90, length: 10, wobble: 0 },
        ]),
      ),
    ).not.toThrow();
  });
});
