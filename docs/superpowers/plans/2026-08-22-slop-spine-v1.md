# slop-spine v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app where you draw a character and rig it in the same document, exporting a Spine 4.2 skeleton that the existing sloppets runtime can drive without modification.

**Architecture:** Export chain first, UI second. Tasks 1–7 build and prove the whole
`RigDocument → .spinejson + .atlas + .png` pipeline against a hand-written fixture, so the
riskiest part (file formats) is verified before any drawing UI exists. Tasks 8–12 then build the
editor that produces `RigDocument`s. Mesh and weights are always **derived** from the drawing and
bone positions — never stored per-vertex — which is what lets art keep changing after rigging.

**Tech Stack:** Svelte 5 (runes) + TypeScript + Vite + Tailwind 4 + Vitest. `delaunator` for
triangulation, `perfect-freehand` for brushes, `fflate` for project files. No Spine libraries —
we write the format ourselves.

**Spec:** `docs/superpowers/specs/2026-08-22-slop-spine-design.md`

## Global Constraints

- **Ethos outranks engineering instinct.** Rough, indie, deliberately imperfect. Ship the dumb
  version that mostly works; upgrade only when a failure is visible on screen. If a task starts
  feeling thorough, that is a smell.
- **Test only what cannot be eyeballed** — pure math and file-format writers. No golden files. UI
  is verified by looking at it.
- **Nothing in the rig may be stored per-vertex.** No hand-dragged mesh vertices, no painted
  weights, no deform keys. Mesh and weights are pure functions, recomputed on change.
- **Spine format version 4.2** — matches the existing rig (`spine: 4.2.43`) and runtime
  (`spine-pixi-v8` 4.2.106).
- **Canvas is 2048×2048** by default, y-down. **Skeleton space is y-up with origin at canvas
  centre** (resolved open question #1 — see Task 6 for why).
- **Atlas exports at `scale:1` with `rotate:false`** — no scale factor, no rotated regions.
- Package versions matching slop-animator: svelte ^5.55.1, vite ^8.0.1, tailwindcss ^4.2.2,
  typescript ~5.9.3, vitest ^4.1.2, delaunator ^5.1.0, perfect-freehand ^1.2.3, fflate ^0.8.3.
- Source of copied modules: `/Users/meigo/Projects/slop/slop-animator/src/core/`.
- **Every task runs `npm test` AND `npm run check` before committing, and both must be clean.**
  `npm run check` is svelte-check; `npm run build` runs it before `tsc`, so a check failure is a
  broken build. Tasks 1-3 originally verified only `npm test`, and a svelte-check failure
  introduced in Task 1 survived two clean reviews as a result.

---

## File structure

```
src/
  rig/
    document.ts        RigDocument types + constructors. No logic.
    mesh.ts            meshFromMask() — silhouette → mesh. Derived.
    weights.ts         computeWeights() — mesh + bones → influences. Derived.
    derive.ts          Cache + invalidation. Ties mesh.ts and weights.ts to the document.
  export/
    trim.ts            trimLayer() — alpha bounding box.
    atlas.ts           packAtlas() — bin-pack + .atlas text.
    spine-json.ts      writeSkeleton() — RigDocument + atlas → .spinejson object.
    bundle.ts          exportBundle() — zip of spinejson + atlas + png + loose PNGs.
  core/                Copied verbatim from slop-animator. Do not edit beyond import paths.
    triangulate.ts  mls.ts  geodesic.ts  brush.ts  ink-brush.ts  stamp-brush.ts
    brush-textures.ts  input.ts  touch-gestures.ts  pressure-curve.ts
    viewport.ts  viewport-fit.ts  fill.ts  fill-holes.ts  selection.ts  mask-ops.ts
  persist/
    db.ts              IndexedDB open + kv. Copied from slop-animator.
    autosave.ts        Debounced save of the current document.
    project-file.ts    Zip in/out.
  lib/
    Canvas.svelte      The one canvas. Draw mode and rig mode render into it.
    LayerPanel.svelte  Layer list: reorder, rename, visibility.
    Toolbar.svelte     Mode switch, tool select, brush settings.
    RigPanel.svelte    Density slider, selected bone's wobble, bind list.
    RigOverlay.ts      Bone + mesh + weight-tint drawing over the canvas.
  state/
    doc.svelte.ts      The RigDocument rune store + mutations.
    ui.svelte.ts       Mode, selection, tool settings.
  App.svelte
  main.ts
```

Split by responsibility: `rig/` is pure derivation (testable, no DOM), `export/` is pure file
writing (testable, no DOM), `lib/` is UI. Nothing in `rig/` or `export/` imports Svelte.

---

## Task 1: Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `svelte.config.js`, `tsconfig.json`, `.gitignore`,
  `index.html`, `src/main.ts`, `src/App.svelte`, `src/app.css`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm run dev` and `npm test`

- [ ] **Step 1: Copy config from slop-animator**

```bash
A=/Users/meigo/Projects/slop/slop-animator
cp $A/svelte.config.js $A/tsconfig.json $A/.gitignore .
```

Do **not** copy `vite.config.ts` — slop-animator's imports `@vitejs/plugin-basic-ssl`, which this
project does not depend on. Write this instead:

```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  test: { passWithNoTests: true },
});
```

`passWithNoTests` is load-bearing for Step 4. The copied `.gitignore` already ignores
`.superpowers/`, `node_modules/` and `dist/` — leave it as is.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "slop-spine",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "svelte-check && tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "svelte-check"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^7.0.0",
    "@tailwindcss/vite": "^4.2.2",
    "svelte": "^5.55.1",
    "svelte-check": "^4.4.6",
    "tailwindcss": "^4.2.2",
    "typescript": "~5.9.3",
    "vite": "^8.0.1",
    "vitest": "^4.1.2"
  },
  "dependencies": {
    "@lucide/svelte": "^1.3.0",
    "delaunator": "^5.1.0",
    "fflate": "^0.8.3",
    "perfect-freehand": "^1.2.3"
  }
}
```

- [ ] **Step 3: Write `index.html`, `src/main.ts`, `src/App.svelte`, `src/app.css`**

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>slop-spine</title></head>
  <body><div id="app"></div><script type="module" src="/src/main.ts"></script></body>
</html>
```

`src/main.ts`:
```ts
import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

export default mount(App, { target: document.getElementById("app")! });
```

`src/App.svelte`:
```svelte
<script lang="ts"></script>

<main class="h-dvh w-dvw bg-neutral-900 text-neutral-200">
  <p class="p-4 font-mono text-sm">slop-spine</p>
</main>
```

The empty `<script lang="ts">` block is required, not decoration: without a script block svelte2tsx
emits no type declaration for the component, so `main.ts`'s default import resolves to implicit
`any` and the strict tsconfig rejects it — which breaks `svelte-check`, and therefore
`npm run build`.

`src/app.css`:
```css
@import "tailwindcss";
```

- [ ] **Step 4: Install and verify both commands run**

Run: `npm install && npm run dev`
Expected: dev server starts, page shows "slop-spine".

Run: `npm test`
Expected: vitest exits 0 with "No test files found" (or passes trivially).

Run: `npm run check`
Expected: `0 ERRORS 0 WARNINGS`. If it reports a missing declaration file for `./App.svelte`, the
`<script lang="ts">` block above is missing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite + svelte 5 + tailwind + vitest"
```

---

## Task 2: Copy the mesh modules

**Files:**
- Create: `src/core/triangulate.ts`, `src/core/mls.ts`, `src/core/geodesic.ts`
- Test: `src/core/__tests__/triangulate.test.ts`, `mls.test.ts`, `geodesic.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface Pt { x: number; y: number }`
  - `interface Mesh { vertices: Pt[]; triangles: [number, number, number][] }`
  - `boundaryPoints(inside, width, height, spacing): Pt[]`
  - `interiorPoints(inside, width, height, spacing): Pt[]`
  - `triangulateSilhouette(...): Mesh`
  - `geodesicDistances(mesh, sources): number[][]` (unused in v1; kept for the geodesic upgrade)

`geodesic.ts` and `mls.ts` are not used by v1's weighting — they come along because
`geodesic.ts` is the known upgrade path when Euclidean weights bleed, and it imports `mls.ts`.

- [ ] **Step 1: Copy the files and their tests**

```bash
A=/Users/meigo/Projects/slop/slop-animator/src
mkdir -p src/core/__tests__
cp $A/core/triangulate.ts $A/core/mls.ts $A/core/geodesic.ts src/core/
cp $A/__tests__/triangulate.test.ts $A/__tests__/mls.test.ts $A/__tests__/geodesic.test.ts src/core/__tests__/
```

- [ ] **Step 2: Fix import paths in the copied tests**

The tests were at `src/__tests__/` importing `../core/x`; they are now at `src/core/__tests__/`
importing `../x`. Update each test's import lines accordingly.

- [ ] **Step 3: Run the copied tests**

Run: `npm test`
Expected: PASS. If any fail, the copy is wrong — do not "fix" the copied module, re-copy it.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: copy triangulate/mls/geodesic from slop-animator"
```

---

## Task 3: Document types and mesh derivation

**Files:**
- Create: `src/rig/document.ts`, `src/rig/mesh.ts`
- Test: `src/rig/__tests__/mesh.test.ts`

**Interfaces:**
- Consumes: `Pt`, `Mesh`, `boundaryPoints`, `interiorPoints`, `triangulateSilhouette` from Task 2
- Produces:
  - `RigDocument`, `Layer`, `Slot`, `Bone`, `Bind` types (below — later tasks use these names)
  - `meshFromMask(mask: Mask, density: number): RigMesh`
  - `interface Mask { width: number; height: number; at(x: number, y: number): boolean }`
  - `interface RigMesh extends Mesh { hull: number }` — hull vertices come first

- [ ] **Step 1: Write `src/rig/document.ts`**

```ts
export interface Layer {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  /** Full-canvas RGBA. Trimmed only at export. */
  canvas: HTMLCanvasElement;
  /** Bumped on every stroke. Task 10's derivation cache keys on it. */
  revision: number;
}

export interface Slot {
  /** Spine slot name; also the attachment name. Unique. */
  name: string;
  layerId: number;
  /** Bone this slot hangs from. */
  bone: string;
  /** Draw order, ascending = drawn first (behind). */
  order: number;
}

export interface Bone {
  name: string;
  parent: string | null;
  /** Canvas pixels, y-down, relative to canvas top-left. Converted at export. */
  x: number;
  y: number;
  /** Degrees, screen-space CCW-positive. Converted at export. */
  rotation: number;
  length: number;
  /** 0 = rigid, 1 = full physics wobble. */
  wobble: number;
}

export interface Bind {
  slot: string;
  bones: string[];
}

export interface RigDocument {
  canvas: { width: number; height: number };
  layers: Layer[];
  slots: Slot[];
  bones: Bone[];
  binds: Bind[];
  /** Boundary point spacing in pixels. One global value. */
  density: number;
}

export function emptyDocument(width = 2048, height = 2048): RigDocument {
  return {
    canvas: { width, height },
    layers: [],
    slots: [],
    bones: [{ name: "root", parent: null, x: width / 2, y: height / 2, rotation: 0, length: 0, wobble: 0 }],
    binds: [],
    density: 48,
  };
}

/** Bones a slot is influenced by: its own bone, that bone's parent, and its children. */
export function defaultBind(doc: RigDocument, slot: Slot): string[] {
  const own = slot.bone;
  const bone = doc.bones.find((b) => b.name === own);
  const parent = bone?.parent ? [bone.parent] : [];
  const kids = doc.bones.filter((b) => b.parent === own).map((b) => b.name);
  return [own, ...parent, ...kids].filter((n) => n !== "root");
}
```

- [ ] **Step 2: Write the failing test**

`src/rig/__tests__/mesh.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { meshFromMask, type Mask } from "../mesh";

/** A 100x100 mask with a solid 60x60 square at (20,20). */
const square: Mask = {
  width: 100,
  height: 100,
  at: (x, y) => x >= 20 && x < 80 && y >= 20 && y < 80,
};

describe("meshFromMask", () => {
  it("puts every vertex inside the shape", () => {
    const m = meshFromMask(square, 12);
    expect(m.vertices.length).toBeGreaterThan(3);
    for (const v of m.vertices) expect(square.at(Math.round(v.x), Math.round(v.y))).toBe(true);
  });

  it("puts hull vertices first", () => {
    const m = meshFromMask(square, 12);
    expect(m.hull).toBeGreaterThan(3);
    expect(m.hull).toBeLessThanOrEqual(m.vertices.length);
    // Hull vertices sit on the boundary: at least one 4-neighbour is outside.
    for (let i = 0; i < m.hull; i++) {
      const { x, y } = m.vertices[i];
      const edge =
        !square.at(x + 1, y) || !square.at(x - 1, y) || !square.at(x, y + 1) || !square.at(x, y - 1);
      expect(edge).toBe(true);
    }
  });

  it("returns an empty mesh for an empty mask", () => {
    const m = meshFromMask({ width: 10, height: 10, at: () => false }, 4);
    expect(m.vertices).toEqual([]);
    expect(m.triangles).toEqual([]);
    expect(m.hull).toBe(0);
  });
});
```

- [ ] **Step 2b: Run it to verify it fails**

Run: `npx vitest run src/rig/__tests__/mesh.test.ts`
Expected: FAIL — cannot resolve `../mesh`.

- [ ] **Step 3: Write `src/rig/mesh.ts`**

```ts
import { boundaryPoints, interiorPoints, type Mesh, type Pt } from "../core/triangulate";
import Delaunator from "delaunator";

export interface Mask {
  width: number;
  height: number;
  at(x: number, y: number): boolean;
}

export interface RigMesh extends Mesh {
  /** Count of leading vertices that lie on the silhouette. */
  hull: number;
}

/** Silhouette → triangulated mesh. Hull (boundary) vertices first, as Spine requires.
 *  Pure: same mask + density always gives the same mesh.
 *
 *  This duplicates `triangulateSilhouette` from core/ on purpose: that one REINDEXES and compacts
 *  vertices at the end, which destroys the boundary-first ordering Spine's `hull` depends on. Do
 *  not "simplify" this back to a call into core/. Unreferenced vertices are kept rather than
 *  compacted, for the same reason; a few unused entries are harmless. */
export function meshFromMask(mask: Mask, density: number): RigMesh {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.at(x, y);

  const hullPts = boundaryPoints(inside, mask.width, mask.height, density);
  const innerPts = interiorPoints(inside, mask.width, mask.height, density, hullPts);
  const vertices: Pt[] = [...hullPts, ...innerPts];
  if (vertices.length < 3) return { vertices: [], triangles: [], hull: 0 };

  const d = Delaunator.from(vertices, (p) => p.x, (p) => p.y);
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < d.triangles.length; i += 3) {
    const [a, b, c] = [d.triangles[i], d.triangles[i + 1], d.triangles[i + 2]];
    // Drop triangles whose centroid falls outside — Delaunay fills concavities.
    const cx = (vertices[a].x + vertices[b].x + vertices[c].x) / 3;
    const cy = (vertices[a].y + vertices[b].y + vertices[c].y) / 3;
    if (inside(Math.round(cx), Math.round(cy))) triangles.push([a, b, c]);
  }
  return { vertices, triangles, hull: hullPts.length };
}

/** Build a Mask from a layer canvas: opaque enough counts as inside. */
export function maskFromCanvas(canvas: HTMLCanvasElement, alphaThreshold = 8): Mask {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  return {
    width,
    height,
    at: (x, y) => data[(y * width + x) * 4 + 3] > alphaThreshold,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/rig/__tests__/mesh.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: RigDocument types and silhouette mesh derivation"
```

---

## Task 4: Euclidean bone-segment weights

**Files:**
- Create: `src/rig/weights.ts`
- Test: `src/rig/__tests__/weights.test.ts`

**Interfaces:**
- Consumes: `RigMesh` (Task 3), `Bone` (Task 3)
- Produces:
  - `interface Influence { bone: string; weight: number }`
  - `computeWeights(mesh: RigMesh, bones: Bone[], maxInfluences?: number): Influence[][]`
    — one array per vertex, weights summing to 1, at most `maxInfluences` entries (default 4)

Deliberately dumb: Euclidean distance to the bone segment, inverse-square falloff. The known
failure is bleed across a spatial gap (an arm beside a hip picks up hip weight). Do **not**
build geodesic distance until a character visibly tears — see spec.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeWeights } from "../weights";
import type { Bone } from "../document";
import type { RigMesh } from "../mesh";

const bone = (name: string, x: number, y: number, length: number, rotation = 0): Bone =>
  ({ name, parent: null, x, y, rotation, length, wobble: 0 });

const mesh = (pts: [number, number][]): RigMesh => ({
  vertices: pts.map(([x, y]) => ({ x, y })),
  triangles: [],
  hull: 0,
});

describe("computeWeights", () => {
  it("gives every vertex weights summing to 1", () => {
    const w = computeWeights(mesh([[0, 0], [50, 0], [100, 0]]), [bone("a", 0, 0, 100), bone("b", 0, 80, 100)]);
    for (const v of w) expect(v.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(1, 5);
  });

  it("weights a vertex on a bone almost entirely to that bone", () => {
    const w = computeWeights(mesh([[10, 0]]), [bone("a", 0, 0, 100), bone("b", 0, 400, 100)]);
    const a = w[0].find((i) => i.bone === "a")!;
    expect(a.weight).toBeGreaterThan(0.95);
  });

  it("caps influences per vertex", () => {
    const bones = ["a", "b", "c", "d", "e", "f"].map((n, i) => bone(n, 0, i * 10, 100));
    const w = computeWeights(mesh([[50, 25]]), bones, 4);
    expect(w[0].length).toBeLessThanOrEqual(4);
  });

  it("returns a single full-weight influence when there is one bone", () => {
    const w = computeWeights(mesh([[500, 500]]), [bone("a", 0, 0, 10)]);
    expect(w[0]).toEqual([{ bone: "a", weight: 1 }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/rig/__tests__/weights.test.ts`
Expected: FAIL — cannot resolve `../weights`.

- [ ] **Step 3: Write `src/rig/weights.ts`**

```ts
import type { Bone } from "./document";
import type { RigMesh } from "./mesh";

export interface Influence {
  bone: string;
  weight: number;
}

/** Shortest distance from p to the segment from the bone's origin along its length. */
function distanceToBone(px: number, py: number, b: Bone): number {
  const rad = (b.rotation * Math.PI) / 180;
  const ex = b.x + Math.cos(rad) * b.length;
  const ey = b.y + Math.sin(rad) * b.length;
  const dx = ex - b.x;
  const dy = ey - b.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - b.x) * dx + (py - b.y) * dy) / len2));
  return Math.hypot(px - (b.x + t * dx), py - (b.y + t * dy));
}

/** Per-vertex bone influences. Inverse-square falloff on Euclidean distance to the bone segment,
 *  capped and normalised. Pure. */
export function computeWeights(mesh: RigMesh, bones: Bone[], maxInfluences = 4): Influence[][] {
  if (bones.length === 0) return mesh.vertices.map(() => []);
  return mesh.vertices.map((v) => {
    const raw = bones.map((b) => {
      const d = distanceToBone(v.x, v.y, b);
      return { bone: b.name, weight: 1 / Math.max(d, 1) ** 2 };
    });
    raw.sort((a, b) => b.weight - a.weight);
    const kept = raw.slice(0, maxInfluences);
    const total = kept.reduce((s, i) => s + i.weight, 0);
    return kept.map((i) => ({ bone: i.bone, weight: i.weight / total }));
  });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/rig/__tests__/weights.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: euclidean bone-segment weighting"
```

---

## Task 5: Trim and atlas packing

**Files:**
- Create: `src/export/trim.ts`, `src/export/atlas.ts`
- Test: `src/export/__tests__/atlas.test.ts`

**Interfaces:**
- Consumes: `Layer` (Task 3)
- Produces:
  - `interface Trim { x: number; y: number; width: number; height: number }` — the layer's opaque
    bounding box in canvas coordinates
  - `interface Region { name: string; trim: Trim; pageX: number; pageY: number }`
  - `packAtlas(items: { name: string; trim: Trim }[], canvasW: number, canvasH: number):
     { regions: Region[]; pageWidth: number; pageHeight: number; text: string }`

Trimming is mandatory — a 2048² layer that is mostly transparent would otherwise fill the atlas.
`offsets` in the `.atlas` text is the trim record, and it is what lets mesh vertices stay in
canvas coordinates while UVs address a trimmed region.

Packing is shelf-packing (sort by height, fill rows). One page, no rotation. If it does not fit,
double the page height and retry.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { packAtlas } from "../atlas";

const item = (name: string, w: number, h: number) => ({ name, trim: { x: 10, y: 20, width: w, height: h } });

describe("packAtlas", () => {
  it("places regions without overlapping", () => {
    const { regions } = packAtlas([item("a", 100, 50), item("b", 80, 70), item("c", 40, 40)], 2048, 2048);
    for (let i = 0; i < regions.length; i++)
      for (let j = i + 1; j < regions.length; j++) {
        const A = regions[i], B = regions[j];
        const disjoint =
          A.pageX + A.trim.width <= B.pageX || B.pageX + B.trim.width <= A.pageX ||
          A.pageY + A.trim.height <= B.pageY || B.pageY + B.trim.height <= A.pageY;
        expect(disjoint).toBe(true);
      }
  });

  it("writes offsets that reconstruct the original canvas placement", () => {
    const { text } = packAtlas([item("a", 100, 50)], 2048, 2048);
    // Spine offsets are: offsetX, offsetY (from bottom-left), originalWidth, originalHeight
    expect(text).toContain("offsets:10,1978,2048,2048");
    expect(text).toContain("rotate:false");
  });

  it("keeps every region inside the page", () => {
    const items = Array.from({ length: 30 }, (_, i) => item(`r${i}`, 200, 200));
    const { regions, pageWidth, pageHeight } = packAtlas(items, 2048, 2048);
    for (const r of regions) {
      expect(r.pageX + r.trim.width).toBeLessThanOrEqual(pageWidth);
      expect(r.pageY + r.trim.height).toBeLessThanOrEqual(pageHeight);
    }
  });
});
```

Note the expected offset: the layer's opaque box starts at canvas `(10, 20)` y-down and is 50
tall, so its bottom edge is at y-down 70; from the bottom of a 2048-tall canvas that is
`2048 - 70 = 1978`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/export/__tests__/atlas.test.ts`
Expected: FAIL — cannot resolve `../atlas`.

- [ ] **Step 3: Write `src/export/trim.ts`**

```ts
export interface Trim {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Opaque bounding box of a layer canvas, in canvas coordinates. Empty layers give a 1x1 box
 *  at the origin so packing and UV maths never divide by zero. */
export function trimLayer(canvas: HTMLCanvasElement, alphaThreshold = 8): Trim {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
```

- [ ] **Step 4: Write `src/export/atlas.ts`**

```ts
import type { Trim } from "./trim";

export interface Region {
  name: string;
  trim: Trim;
  pageX: number;
  pageY: number;
}

const PAD = 2;

/** Shelf-pack trimmed regions into one page and write the Spine 4.2 .atlas text.
 *  scale:1, rotate:false — deliberately the simplest thing that works. */
export function packAtlas(
  items: { name: string; trim: Trim }[],
  canvasW: number,
  canvasH: number,
  pageWidth = 2048,
): { regions: Region[]; pageWidth: number; pageHeight: number; text: string } {
  const sorted = [...items].sort((a, b) => b.trim.height - a.trim.height);
  const regions: Region[] = [];
  let x = PAD, y = PAD, rowHeight = 0;
  for (const it of sorted) {
    if (x + it.trim.width + PAD > pageWidth) {
      x = PAD;
      y += rowHeight + PAD;
      rowHeight = 0;
    }
    regions.push({ name: it.name, trim: it.trim, pageX: x, pageY: y });
    x += it.trim.width + PAD;
    rowHeight = Math.max(rowHeight, it.trim.height);
  }
  const used = y + rowHeight + PAD;
  const pageHeight = Math.max(16, 2 ** Math.ceil(Math.log2(used)));

  const lines = [
    "skeleton.png",
    `size:${pageWidth},${pageHeight}`,
    "filter:Linear,Linear",
    "pma:false",
    "scale:1",
  ];
  for (const r of regions) {
    // offsetY is measured from the BOTTOM of the original canvas.
    const offsetY = canvasH - (r.trim.y + r.trim.height);
    lines.push(
      r.name,
      `bounds:${r.pageX},${r.pageY},${r.trim.width},${r.trim.height}`,
      `offsets:${r.trim.x},${offsetY},${canvasW},${canvasH}`,
      "rotate:false",
    );
  }
  return { regions, pageWidth, pageHeight, text: lines.join("\n") + "\n" };
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/export/__tests__/atlas.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: layer trimming and atlas packing"
```

---

## Task 6: Spine 4.2 JSON writer

**Files:**
- Create: `src/export/spine-json.ts`
- Test: `src/export/__tests__/spine-json.test.ts`

**Interfaces:**
- Consumes: `RigDocument`, `Bone` (Task 3); `RigMesh` (Task 3); `Influence` (Task 4);
  `Region` (Task 5)
- Produces:
  - `toSkeletonSpace(doc, x, y): { x: number; y: number }`
  - `boneWorld(canvas, bone): { x: number; y: number; rotation: number }` — the bone's setup-pose
    transform in skeleton space
  - `toBoneLocal(world, p): { x: number; y: number }`
  - `writeSkeleton(input: SkeletonInput): object` — the `.spinejson` payload

**Origin convention (resolves spec open question #1).** The existing `test-char` places its root
at neither the feet nor the art centre: root is at `(0,0)`, the body's base at `y: -992.24`, and
the AABB spans `y: -1075.25 … +545.92` — so the origin sits about two-thirds up the art. That is
an artefact of where the Spine editor happened to put it, not a convention to reproduce. **We use
canvas centre**, which is predictable and lets sloppets keep positioning characters with an
explicit offset, as `spine-test.html` already does (`spineChar.y = 30`).

**Bones are stored ABSOLUTE.** `Bone.x/y/rotation` are canvas-absolute, not parent-relative.
Spine wants parent-relative, so the writer converts — but storing absolute means no parent chain
walk is needed anywhere, and no accumulated drift. (The editor still drags descendants when a
parent moves; that is a UI behaviour in Task 10, not a storage format.)

**Coordinate conversion.** Canvas is y-down from the top-left; skeleton space is y-up from the
canvas centre. Rotation likewise flips sign.

```
skeleton.x = canvas.x - width / 2
skeleton.y = height / 2 - canvas.y
skeleton.rotation = -canvas.rotation
```

**Hull ordering caveat, accepted as rough.** `boundaryPoints` returns silhouette points in raster
scan order, not perimeter order. `hull` is used by the Spine editor for outline display and edge
computation; the runtime renders from `triangles`, so the sloppets exit is unaffected. If the
editor handoff looks odd, that is the cause — do not fix it pre-emptively.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toSkeletonSpace, boneWorld, toBoneLocal, writeSkeleton } from "../spine-json";
import type { Bone } from "../../rig/document";

const bones: Bone[] = [
  { name: "root", parent: null, x: 1024, y: 1024, rotation: 0, length: 0, wobble: 0 },
  { name: "body", parent: "root", x: 1024, y: 1524, rotation: -90, length: 400, wobble: 0 },
];

describe("coordinate conversion", () => {
  it("maps canvas centre to the skeleton origin", () => {
    expect(toSkeletonSpace({ width: 2048, height: 2048 }, 1024, 1024)).toEqual({ x: 0, y: 0 });
  });

  it("flips y", () => {
    expect(toSkeletonSpace({ width: 2048, height: 2048 }, 1024, 1524)).toEqual({ x: 0, y: -500 });
  });

  it("round-trips a point through a rotated bone's local space", () => {
    const w = boneWorld({ width: 2048, height: 2048 }, bones[1]);
    const p = { x: 137, y: -412 };
    const local = toBoneLocal(w, p);
    const rad = (w.rotation * Math.PI) / 180;
    const back = {
      x: w.x + local.x * Math.cos(rad) - local.y * Math.sin(rad),
      y: w.y + local.x * Math.sin(rad) + local.y * Math.cos(rad),
    };
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });
});

describe("writeSkeleton", () => {
  const input = {
    doc: {
      canvas: { width: 2048, height: 2048 },
      layers: [],
      slots: [{ name: "body", layerId: 1, bone: "body", order: 0 }],
      bones,
      binds: [{ slot: "body", bones: ["body"] }],
      density: 48,
    },
    meshes: { body: { vertices: [{ x: 1000, y: 1400 }, { x: 1100, y: 1400 }, { x: 1050, y: 1300 }], triangles: [[0, 1, 2] as [number, number, number]], hull: 3 } },
    weights: { body: [[{ bone: "body", weight: 1 }], [{ bone: "body", weight: 1 }], [{ bone: "body", weight: 1 }]] },
    regions: [{ name: "body", trim: { x: 1000, y: 1300, width: 101, height: 101 }, pageX: 2, pageY: 2 }],
    page: { width: 2048, height: 256 },
  };

  it("emits 4.2 with the expected top-level shape", () => {
    const s = writeSkeleton(input) as any;
    expect(s.skeleton.spine).toBe("4.2");
    expect(s.bones.map((b: { name: string }) => b.name)).toEqual(["root", "body"]);
    // `as any` above is deliberate: the return value is a file format, not an API, so it has no
    // declared interface. Tests live under src/ and `npm run build` typechecks them.
    expect(s.slots[0]).toEqual({ name: "body", bone: "body", attachment: "body" });
  });

  it("emits a weighted mesh: boneCount then (index,x,y,weight) per influence", () => {
    const s = writeSkeleton(input) as any;
    const mesh = s.skins[0].attachments.body.body;
    expect(mesh.type).toBe("mesh");
    expect(mesh.hull).toBe(3);
    // 3 vertices, 1 influence each => 3 * (1 + 4) = 15 entries
    expect(mesh.vertices.length).toBe(15);
    expect(mesh.vertices[0]).toBe(1);
    expect(mesh.uvs.length).toBe(6);
    for (const uv of mesh.uvs) { expect(uv).toBeGreaterThanOrEqual(0); expect(uv).toBeLessThanOrEqual(1); }
  });

  it("emits physics only for bones with wobble", () => {
    const s = writeSkeleton(input) as any;
    expect(s.physics ?? []).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/export/__tests__/spine-json.test.ts`
Expected: FAIL — cannot resolve `../spine-json`.

- [ ] **Step 3: Write `src/export/spine-json.ts`**

```ts
import type { RigDocument, Bone } from "../rig/document";
import type { RigMesh } from "../rig/mesh";
import type { Influence } from "../rig/weights";
import type { Region } from "./atlas";

export interface SkeletonInput {
  doc: RigDocument;
  meshes: Record<string, RigMesh>;
  weights: Record<string, Influence[][]>;
  regions: Region[];
  page: { width: number; height: number };
}

const DEG = Math.PI / 180;

/** Canvas (y-down, top-left origin) → skeleton space (y-up, canvas-centre origin). */
export function toSkeletonSpace(canvas: { width: number; height: number }, x: number, y: number) {
  return { x: x - canvas.width / 2, y: canvas.height / 2 - y };
}

export interface World { x: number; y: number; rotation: number }

/** A bone's setup-pose transform in skeleton space. Because bones are stored with ABSOLUTE canvas
 *  position and rotation, this is a straight conversion — no parent chain walk. Scale is always 1. */
export function boneWorld(canvas: { width: number; height: number }, b: Bone): World {
  const p = toSkeletonSpace(canvas, b.x, b.y);
  return { x: p.x, y: p.y, rotation: -b.rotation };
}

/** World point → the bone's local space. Inverse of R(rotation) * local + (x,y). */
export function toBoneLocal(w: World, p: { x: number; y: number }) {
  const r = w.rotation * DEG;
  const dx = p.x - w.x;
  const dy = p.y - w.y;
  return { x: Math.cos(r) * dx + Math.sin(r) * dy, y: -Math.sin(r) * dx + Math.cos(r) * dy };
}

export function writeSkeleton(input: SkeletonInput) {
  const { doc, meshes, weights, regions, page } = input;
  const canvas = doc.canvas;
  const conv = (x: number, y: number) => toSkeletonSpace(canvas, x, y);

  // Bones, parents before children (document order is maintained by the editor).
  // Spine wants each bone's rotation relative to its parent, and its position in the parent's
  // rotated frame — which is exactly toBoneLocal of the child's world position.
  const byName = new Map(doc.bones.map((b) => [b.name, b]));
  const outBones = doc.bones.map((b) => {
    if (!b.parent) return { name: b.name };
    const wb = boneWorld(canvas, b);
    const wp = boneWorld(canvas, byName.get(b.parent)!);
    const local = toBoneLocal(wp, { x: wb.x, y: wb.y });
    return {
      name: b.name,
      parent: b.parent,
      length: b.length,
      rotation: wb.rotation - wp.rotation,
      x: local.x,
      y: local.y,
    };
  });

  const boneIndex = new Map(doc.bones.map((b, i) => [b.name, i]));
  const slots = [...doc.slots]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ name: s.name, bone: s.bone, attachment: s.name }));

  const attachments: Record<string, Record<string, unknown>> = {};
  for (const slot of doc.slots) {
    const mesh = meshes[slot.name];
    const w = weights[slot.name];
    const region = regions.find((r) => r.name === slot.name);
    if (!mesh || !w || !region || mesh.vertices.length === 0) continue;

    const uvs: number[] = [];
    const verts: number[] = [];
    mesh.vertices.forEach((v, i) => {
      const lx = v.x - region.trim.x;
      const ly = v.y - region.trim.y;
      uvs.push((region.pageX + lx) / page.width, (region.pageY + ly) / page.height);

      const world = conv(v.x, v.y);
      const infl = w[i];
      verts.push(infl.length);
      for (const inf of infl) {
        const local = toBoneLocal(boneWorld(canvas, byName.get(inf.bone)!), world);
        verts.push(boneIndex.get(inf.bone)!, local.x, local.y, inf.weight);
      }
    });

    attachments[slot.name] = {
      [slot.name]: {
        type: "mesh",
        uvs,
        triangles: mesh.triangles.flat(),
        vertices: verts,
        hull: mesh.hull,
      },
    };
  }

  const physics = doc.bones
    .filter((b) => b.wobble > 0)
    .map((b, i) => ({
      name: b.name,
      order: i,
      bone: b.name,
      rotate: 1,
      inertia: 0.5 * b.wobble,
      damping: 0.85,
    }));

  return {
    skeleton: { spine: "4.2", x: -canvas.width / 2, y: -canvas.height / 2, width: canvas.width, height: canvas.height },
    bones: outBones,
    slots,
    ...(physics.length ? { physics } : {}),
    skins: [{ name: "default", attachments }],
    animations: { setup: {} },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/export/__tests__/spine-json.test.ts`
Expected: PASS (6 tests). If the bone-local round-trip fails, the sign convention in
`toBoneLocal` is wrong — fix `toBoneLocal`, not the test.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: spine 4.2 skeleton json writer"
```

---

## Task 7: Export bundle and the round-trip milestone

**Files:**
- Create: `src/export/bundle.ts`, `src/export/__tests__/fixture.ts`,
  `scripts/export-fixture.ts`
- Test: manual — this is the milestone gate

**Interfaces:**
- Consumes: everything from Tasks 3–6
- Produces:
  - `exportBundle(doc: RigDocument): Promise<Blob>` — a zip containing `skeleton.spinejson`,
    `skeleton.atlas`, `skeleton.png`, and `layers/<name>.png` (loose PNGs for the Spine editor)
  - `buildFixture(): RigDocument` — a three-layer stick figure built in code, no drawing UI needed

This is the task that proves the whole format chain before any editor exists. If it fails, the
problem is in Tasks 5–6, not in something you have yet to build.

- [ ] **Step 1: Write the fixture**

`src/export/__tests__/fixture.ts` builds a `RigDocument` in code using
`OffscreenCanvas`-compatible 2D drawing: three layers on a 2048² canvas — `body` (a filled
rounded rect from (950,900) to (1100,1500)), `head` (a filled circle centred (1024,800) r 180),
`arm` (a filled rect from (1100,950) to (1400,1030)). Bones: `root` at canvas centre;
`body` at (1024,1500) rotation -90 length 600 wobble 0; `head` at (1024,900) rotation -90
length 300 wobble 0.3; `arm` at (1100,990) rotation 0 length 300 wobble 0.6. Slots map each
layer to the bone of the same name; binds come from `defaultBind`.

- [ ] **Step 2: Write `src/export/bundle.ts`**

```ts
import { zipSync, strToU8 } from "fflate";
import type { RigDocument } from "../rig/document";
import { maskFromCanvas, meshFromMask, type RigMesh } from "../rig/mesh";
import { computeWeights, type Influence } from "../rig/weights";
import { trimLayer } from "./trim";
import { packAtlas } from "./atlas";
import { writeSkeleton } from "./spine-json";

async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

export async function exportBundle(doc: RigDocument): Promise<Blob> {
  const meshes: Record<string, RigMesh> = {};
  const weights: Record<string, Influence[][]> = {};
  const items: { name: string; trim: ReturnType<typeof trimLayer> }[] = [];

  for (const slot of doc.slots) {
    const layer = doc.layers.find((l) => l.id === slot.layerId)!;
    const bindNames = doc.binds.find((b) => b.slot === slot.name)?.bones ?? [slot.bone];
    const bones = doc.bones.filter((b) => bindNames.includes(b.name));
    const mesh = meshFromMask(maskFromCanvas(layer.canvas), doc.density);
    meshes[slot.name] = mesh;
    weights[slot.name] = computeWeights(mesh, bones);
    items.push({ name: slot.name, trim: trimLayer(layer.canvas) });
  }

  const atlas = packAtlas(items, doc.canvas.width, doc.canvas.height);

  // Blit each trimmed layer onto the atlas page.
  const page = document.createElement("canvas");
  page.width = atlas.pageWidth;
  page.height = atlas.pageHeight;
  const pctx = page.getContext("2d")!;
  for (const r of atlas.regions) {
    const slot = doc.slots.find((s) => s.name === r.name)!;
    const layer = doc.layers.find((l) => l.id === slot.layerId)!;
    pctx.drawImage(layer.canvas, r.trim.x, r.trim.y, r.trim.width, r.trim.height,
                   r.pageX, r.pageY, r.trim.width, r.trim.height);
  }

  const skeleton = writeSkeleton({
    doc, meshes, weights,
    regions: atlas.regions,
    page: { width: atlas.pageWidth, height: atlas.pageHeight },
  });

  const files: Record<string, Uint8Array> = {
    "skeleton.spinejson": strToU8(JSON.stringify(skeleton)),
    "skeleton.atlas": strToU8(atlas.text),
    "skeleton.png": await blobBytes(await canvasBlob(page)),
  };
  for (const layer of doc.layers) {
    files[`layers/${layer.name}.png`] = await blobBytes(await canvasBlob(layer.canvas));
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}

function canvasBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}
```

- [ ] **Step 3: Wire a temporary "Export fixture" button into `App.svelte`**

A single button that calls `exportBundle(buildFixture())` and triggers a download. It is
scaffolding; Task 9 replaces it with the real export action.

- [ ] **Step 4: THE MILESTONE — verify in the sloppets test page**

```bash
unzip -o ~/Downloads/slop-spine-export.zip -d /Users/meigo/Projects/slop/sloppets/spine/fixture
cd /Users/meigo/Projects/slop/sloppets && node engine/server.mjs
```

Open `client/public/test/spine-test.html`, change the three asset paths to
`/spine/fixture/skeleton.*`, and load it.

Expected: the stick figure renders in the right place, at the right scale, right way up. Dragging
the body slider moves it. This is the pass/fail gate for the whole format chain.

Failure guide:
- Upside down → y-flip in `toSkeletonSpace`.
- Parts in the wrong places → `offsets` in `packAtlas`, or UV maths in `writeSkeleton`.
- Parts render but smear when bones move → bone-local transform in `toBoneLocal`.
- Nothing renders → check the browser console; a malformed `vertices` array throws in the parser.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: export bundle, verified round-trip into sloppets"
```

---

## Task 8: App shell — canvas, viewport, layers

**Files:**
- Create: `src/state/doc.svelte.ts`, `src/state/ui.svelte.ts`, `src/lib/Canvas.svelte`,
  `src/lib/LayerPanel.svelte`, `src/lib/Toolbar.svelte`
- Modify: `src/App.svelte`
- Copy: `src/core/viewport.ts`, `viewport-fit.ts`, `input.ts`, `touch-gestures.ts`

**Interfaces:**
- Consumes: `RigDocument`, `emptyDocument` (Task 3)
- Produces:
  - `doc` rune store with `addLayer(name)`, `removeLayer(id)`, `reorderLayer(id, index)`,
    `renameLayer(id, name)`, `toggleVisible(id)`
  - `ui` rune store with `mode: "draw" | "rig"`, `selectedLayerId`, `selectedBone`

- [ ] **Step 1: Copy the viewport and input modules**

```bash
A=/Users/meigo/Projects/slop/slop-animator/src
cp $A/core/viewport.ts $A/core/viewport-fit.ts $A/core/input.ts $A/core/touch-gestures.ts src/core/
```

Fix import paths as needed; delete any import that reaches into slop-animator's document model.

- [ ] **Step 2: Write the state stores**

`src/state/doc.svelte.ts` holds `let document = $state(emptyDocument())` and exports it plus the
mutations above. Each mutation creates layers with a full-canvas `HTMLCanvasElement` sized to
`document.canvas`.

- [ ] **Step 3: Write `Canvas.svelte`**

One `<canvas>` sized to its container. A `$effect` redraws on any document change: clear, apply
the viewport transform, then draw each visible layer bottom-up at its opacity. Pan and zoom come
from the copied `viewport.ts`; wire pointer events through `input.ts`.

- [ ] **Step 4: Write `LayerPanel.svelte` and `Toolbar.svelte`**

Layer list with drag-reorder, double-click rename, visibility toggle, and an add button.
Toolbar holds the draw/rig mode switch and, in Task 9, the tool buttons.

- [ ] **Step 5: Verify by looking at it**

Run: `npm run dev`
Expected: add three layers, reorder them, rename one, toggle visibility, pan and zoom the canvas.
Nothing draws yet — that is Task 9.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: app shell with canvas, viewport and layer panel"
```

---

## Task 9: Drawing

**Files:**
- Modify: `src/lib/Canvas.svelte`, `src/lib/Toolbar.svelte`
- Copy: `src/core/brush.ts`, `ink-brush.ts`, `stamp-brush.ts`, `brush-textures.ts`,
  `pressure-curve.ts`, `fill.ts`, `fill-holes.ts`, `mask-ops.ts`

**No lasso in v1.** slop-animator's `selection.ts` imports `ref-transform.ts`, `rigid-grid.ts` and
`selection-map.ts`; the last maps document coordinates onto per-frame cells, which is that app's
frame-centric model and meaningless here. Do not copy `selection.ts` and do not reimplement lasso.

**Interfaces:**
- Consumes: `ui.selectedLayerId` (Task 8)
- Produces: strokes land on the selected layer's canvas; `doc` marks that layer dirty so Task 10's
  derivation cache invalidates

- [ ] **Step 1: Copy the brush modules**

```bash
A=/Users/meigo/Projects/slop/slop-animator/src/core
cp $A/brush.ts $A/ink-brush.ts $A/stamp-brush.ts $A/brush-textures.ts $A/pressure-curve.ts \
   $A/fill.ts $A/fill-holes.ts $A/mask-ops.ts src/core/
```

- [ ] **Step 2: Wire brush, eraser and fill to the selected layer**

Pointer events → `input.ts` → brush engine → draw into `layer.canvas`. Tool selection and brush
size/opacity live in `ui.svelte.ts`; Toolbar renders them.

- [ ] **Step 3: Bump a per-layer `revision` counter on every stroke**

```ts
// in doc.svelte.ts
export function markLayerDirty(id: number) {
  const l = document.layers.find((x) => x.id === id);
  if (l) l.revision += 1;
}
```

`Layer.revision` is already declared in `src/rig/document.ts` (Task 3). Call this at the end of
every stroke and fill operation. Task 10 keys its derivation cache on it.

- [ ] **Step 4: Verify by looking at it**

Run: `npm run dev`
Expected: draw on a layer, erase, fill an enclosed area. Pressure works with a pointer that
reports it.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: drawing tools on layers"
```

---

## Task 10: Rig mode — bones, derivation, overlay

**Files:**
- Create: `src/rig/derive.ts`, `src/lib/RigOverlay.ts`, `src/lib/RigPanel.svelte`
- Modify: `src/lib/Canvas.svelte`, `src/state/doc.svelte.ts`
- Test: `src/rig/__tests__/derive.test.ts`

**Interfaces:**
- Consumes: `meshFromMask` (Task 3), `computeWeights` (Task 4), `Layer.revision` (Task 9)
- Produces:
  - `deriveSlot(doc, slotName): { mesh: RigMesh; weights: Influence[][] }` — memoised on
    `(layer.revision, density, bone signature)`
  - `invalidate(slotName?)`
  - `doc` mutations: `addBone(parent, x, y)`, `moveBone(name, x, y)`, `setBoneLength(name, len)`,
    `removeBone(name)`, `setWobble(name, v)`, `setBind(slot, bones)`

**No unit test for this task.** `deriveSlot` reaches a layer's `HTMLCanvasElement` through
`maskFromCanvas`, so testing it in node would mean adding jsdom or happy-dom. The cache is verified
by eye in Step 5 instead, which is the stronger check anyway: redraw a limb and watch the mesh and
weights regenerate on their own.

- [ ] **Step 1: Write `src/rig/derive.ts`**

A `Map<string, { key: string; mesh: RigMesh; weights: Influence[][] }>`. The key is
`` `${layer.revision}|${doc.density}|${boneSig}` `` where `boneSig` is the bound bones' names,
positions, rotations and lengths joined. On a miss, recompute mesh (only if the mesh part of the
key changed) and weights, then store.

- [ ] **Step 2: Write `RigOverlay.ts`**

Given a 2D context and the derived data, draw: mesh triangles as thin lines; bones as tapered
segments from origin to tip with a circle at the origin; the selected bone highlighted; and, when
a bone is selected, tint each vertex by its weight for that bone (0 → transparent, 1 → solid).

- [ ] **Step 3: Wire rig-mode interaction into `Canvas.svelte`**

- Drag from empty space → move the nearest bone origin, **dragging its descendants with it** by
  the same delta (bones are stored absolute, so children do not follow automatically).
- Drag from a bone's tip → set its length and rotation.
- Shift-drag from a bone → create a child bone.
- Click a bone → select it.
- Alt-drag a bone in "pose" state → temporarily offset it so deformation can be checked live,
  released on mouse-up. Pose is transient and never stored.

- [ ] **Step 4: Write `RigPanel.svelte`**

Density slider (global), wobble slider (selected bone), bind checkbox list (selected slot), and a
bone-name field.

- [ ] **Step 5: Verify by looking at it**

Run: `npm run dev`
Expected: draw a limb, place two bones down it, see the mesh appear, select a bone and see the
weight tint, alt-drag it and watch the drawing deform. **Then redraw part of the limb and confirm
the mesh and weights regenerate on their own** — this is the core principle, visible.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: rig mode with bones, derivation cache and overlay"
```

---

## Task 11: Persistence

**Files:**
- Create: `src/persist/db.ts`, `src/persist/autosave.ts`, `src/persist/project-file.ts`
- Modify: `src/App.svelte`

**Interfaces:**
- Consumes: `RigDocument` (Task 3)
- Produces:
  - `saveProject(doc): Promise<Blob>` — zip of `document.json` plus `layers/<id>.png`
  - `loadProject(file: File): Promise<RigDocument>`
  - `armAutosave(getDoc)` / `restore(): Promise<RigDocument | null>`

- [ ] **Step 1: Copy the IndexedDB helper**

```bash
cp /Users/meigo/Projects/slop/slop-animator/src/persist/db.ts src/persist/db.ts
```

Change `DB_NAME` to `"slop-spine"` and drop the `MEDIA_STORE` constant — we do not have reference
media.

- [ ] **Step 2: Write `project-file.ts`**

Serialise the document with layer canvases replaced by `layers/<id>.png` paths; zip with
`fflate`. Load reverses it, decoding each PNG back into a canvas.

- [ ] **Step 3: Write `autosave.ts`**

Debounce 2s after the last change; write the zip bytes into the `kv` store under `"autosave"`.
On startup, restore it if present.

- [ ] **Step 4: Verify by looking at it**

Run: `npm run dev`
Expected: draw something, reload the page, it comes back. Save a project file, clear storage,
load the file, it comes back.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: autosave and project files"
```

---

## Task 12: Real export, and the first real character

**Files:**
- Modify: `src/lib/Toolbar.svelte`, `src/App.svelte`
- Delete: the temporary fixture button from Task 7

**Interfaces:**
- Consumes: `exportBundle` (Task 7), `deriveSlot` (Task 10)
- Produces: an Export action on the real document

- [ ] **Step 1: Point `exportBundle` at the derivation cache**

Replace its inline mesh/weight computation with `deriveSlot(doc, slot.name)` so export and the
on-screen overlay can never disagree.

- [ ] **Step 2: Replace the fixture button with a real Export action**

Downloads `<projectName>.zip`.

- [ ] **Step 3: Draw a real sloppets character and export it**

Bones named to the sloppets contract: `root`, `body`, `head`, `mouth`, `arm-front1/2`,
`arm-back1/2`, `hair1/2`. Slots `body`, `head`, `mouth`, `eyes`, `arm-front`, `arm-back`.
Wobble on hair, arms and head.

- [ ] **Step 4: Load it in `spine-test.html` unmodified**

Expected: the existing viseme and bone-poking code drives it. The eyes slot will need `Eyes open`
/ `Eyes closed` attachments, which v1 does not produce — note what is missing rather than
building it now (this is spec open question #5, and the answer should come from seeing the gap).

- [ ] **Step 5: Redraw a layer, re-export, load again**

Expected: still works. This is the manual check that guards the core principle.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: export the real document"
```

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: derived rig → Tasks 3, 4, 10; document model
→ Task 3; invalidation → Task 10; persistence → Task 11; reuse table → Tasks 2, 8, 9; new work
items 1–4 → Tasks 4, 6, 5, 10; verification → Task 7 (milestone) and Task 12 (real character);
v1 scope in/out → the task list contains nothing from the "out" list.

**Deferred deliberately.** `Eyes open`/`Eyes closed` attachment swapping is surfaced in Task 12
Step 4 as a known gap rather than built — it is spec open question #5, and the spec says decide
after seeing it. Spec open questions #2 (bone gesture on iPad) and #3 (density default) resolve
by use in Tasks 10 and 12. Open question #1 (origin) is resolved in Task 6.

**Known rough edges, accepted per ethos.** Hull vertices are in scan order, not perimeter order
(Task 6). Weights are Euclidean and will bleed across gaps (Task 4). The atlas is one page with no
rotation (Task 5). All three are documented where they occur, with the upgrade path named.
