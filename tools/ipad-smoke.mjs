// iPad smoke check (`npm run test:ipad`): the app in WebKit — Safari's engine — at iPad Pro 11
// size with touch, in a fresh temp profile (its own IndexedDB and localStorage: never your
// documents). Persistent, not Playwright's default ephemeral context: ephemeral WebKit refuses
// Blobs in IndexedDB, so every autosave failed there (as slop-animator found).
// Ported from slop-paint's tools/ipad-smoke.mjs (2026-10-01) and cut down to slop-spine's job:
// draw a silhouette, rig two bones, pose, export, save/open, autosave, and the layer panel
// (including the pointer-event row drag that replaced SortableJS).
//
//   npm run test:ipad                     starts its own dev server on a free port
//   npm run test:ipad -- <url>            checks that URL instead (e.g. the deployed site)
//
// Screenshots go to test-results/ipad/ (one per step, `-FAIL` on a failed one; cleared each run).
// Exits 1 when a check fails or the page reports an error. Each step runs on its own: a failure is
// reported and the next step still runs.
//
// Two kinds of input, and they are not equally strong evidence:
//   - REAL taps (`tap`, `locator.tap()`): Playwright's touchscreen, which WebKit turns into a
//     genuine touch — the browser makes the pointer, touch and click events itself.
//   - SIMULATED gestures (`gesture`, checks marked [sim]): the Pencil, drags and multi-finger
//     gestures are pointer events this script dispatches (over, enter, down, moves, up, out,
//     leave). They test the app's routing and tools, not what iPadOS delivers.
// Pixels are read back from the on-screen document canvas; the export is unzipped and read.
// Not covered — test on the iPad itself: the real Pencil (pressure, palm), how gestures feel, the
// real share sheet (stubbed here: `navigator.share` records the file), the system clipboard, the
// on-screen keyboard, iPadOS memory limits.
// First run on a machine: `npx playwright install webkit` (~100 MB).
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { unzipSync, strFromU8 } from "fflate";
import { devices, webkit } from "playwright";
import { createServer } from "vite";

const OUT = "test-results/ipad";
rmSync(OUT, { recursive: true, force: true }); // no stale FAIL shots from an earlier run
mkdirSync(OUT, { recursive: true });

let server = null;
let url = process.argv[2];
if (!url) {
  server = await createServer({ server: { port: 0 }, logLevel: "error" });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `fn` until it returns truthy or `ms` pass; returns the last value. */
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  let v = await fn();
  while (!v && Date.now() < end) {
    await sleep(100);
    v = await fn();
  }
  return v;
}

/** Runs in the page before the app. */
function pageSetup() {
  // Simulated pointers aren't live, so WebKit refuses to capture them ("The object can not be
  // found here"); a real Pencil or finger is one. Let capture fail quietly for the simulation.
  const capture = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function (id) {
    try {
      capture.call(this, id);
    } catch {
      /* simulated pointer */
    }
  };

  // The share sheet, stubbed: Export reaches `navigator.share` exactly as on the iPad (WebKit with
  // an iPad user agent counts as an Apple touch device). It records each file, with its bytes as
  // base64 so the script can unzip the export.
  window.__shared = [];
  Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async ({ files }) => {
      for (const f of files) {
        const b64 = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
          r.readAsDataURL(f);
        });
        window.__shared.push({ name: f.name, type: f.type, size: f.size, b64 });
      }
    },
  });

  /** Plays simulated pointer steps: `{ type: "down" | "move" | "up" | "cancel", id, kind, x, y,
   *  p?, wait? }`. A pointer's target is the element under its `down`, and it is kept across calls,
   *  so a drag can be split to look at the page mid-gesture. */
  const targets = new Map();
  window.__gesture = async (steps) => {
    const fire = (el, type, s, extra) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: type !== "pointerenter" && type !== "pointerleave",
          cancelable: true,
          composed: true,
          pointerId: s.id,
          pointerType: s.kind,
          isPrimary: targets.size === 1,
          clientX: s.x,
          clientY: s.y,
          width: s.kind === "touch" ? 20 : 1,
          height: s.kind === "touch" ? 20 : 1,
          pressure: s.p ?? 0.5,
          ...extra,
        }),
      );
    for (const s of steps) {
      if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
      if (s.type === "down") {
        const el = document.elementFromPoint(s.x, s.y);
        targets.set(s.id, el);
        fire(el, "pointerover", s, { buttons: 1 });
        fire(el, "pointerenter", s, { buttons: 1 });
        fire(el, "pointerdown", s, { button: 0, buttons: 1 });
      } else if (s.type === "move") {
        fire(targets.get(s.id), "pointermove", s, { button: -1, buttons: 1 });
      } else {
        const el = targets.get(s.id);
        const end = s.type === "up" ? "pointerup" : "pointercancel";
        fire(el, end, s, { button: 0, buttons: 0, pressure: 0 });
        fire(el, "pointerout", s, { buttons: 0, pressure: 0, relatedTarget: null });
        fire(el, "pointerleave", s, { buttons: 0, pressure: 0, relatedTarget: null });
        targets.delete(s.id);
      }
    }
  };

  /** How many painted (opaque) pixels the document canvas has inside a client rect: the canvas is
   *  transparent over the paper, and the bucket's default colour is white, so darkness can't tell. */
  window.__ink = ({ x, y, w, h }) => {
    const c = document.querySelector('[class*="paper-"] + canvas');
    const r = c.getBoundingClientRect();
    const sx = c.width / r.width;
    const sy = c.height / r.height;
    const px = Math.max(0, Math.round((x - r.left) * sx));
    const py = Math.max(0, Math.round((y - r.top) * sy));
    const pw = Math.max(1, Math.min(c.width - px, Math.round(w * sx)));
    const ph = Math.max(1, Math.min(c.height - py, Math.round(h * sy)));
    const d = c.getContext("2d").getImageData(px, py, pw, ph).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 128) dark++;
    }
    return dark;
  };
}

/** Steps for one pointer dragged along `path` (a function of t in 0..1). */
function pathSteps(
  kind,
  id,
  path,
  { n = 30, wait = 8, p = (t) => 0.3 + 0.6 * Math.sin(t * Math.PI) } = {},
) {
  const a = path(0);
  const steps = [{ type: "down", id, kind, x: a.x, y: a.y, p: p(0) }];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const q = path(t);
    steps.push({ type: "move", id, kind, x: q.x, y: q.y, p: p(t), wait });
  }
  const b = path(1);
  steps.push({ type: "up", id, kind, x: b.x, y: b.y, wait });
  return steps;
}
const line = (a, b) => (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Every step of the walk-through for one page; `step` isolates failures. */
async function main(page) {
  const gesture = (steps) => page.evaluate((s) => window.__gesture(s), steps);
  const ink = (r) => page.evaluate((r) => window.__ink(r), r);
  const tap = (p) => page.touchscreen.tap(p.x, p.y);
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
  const status = () => page.locator("div.h-7.border-t").innerText();
  const button = (title) => page.locator(`button[title^="${title}"]`).first();
  const tapButton = async (title) => {
    await button(title).tap();
    await page.waitForTimeout(150);
  };
  const undoTitle = () => button("Undo").getAttribute("title");
  const canUndo = async () => !/nothing to undo/.test((await undoTitle()) ?? "");
  const zoom = () => page.getByTitle("Zoom", { exact: true }).innerText();
  const shared = () => page.evaluate(() => window.__shared);
  const rows = () => page.locator("[data-layer-id]");
  const rowNames = () =>
    page.$$eval("[data-layer-id] span.truncate", (els) => els.map((e) => e.textContent.trim()));
  /** Opens a toolbar menu and taps one of its items. */
  async function menu(name, item) {
    await page
      .getByRole("button", { name: new RegExp(`^${name}`) })
      .first()
      .tap();
    await page.getByRole("menuitem", { name: item }).first().tap();
    await page.waitForTimeout(250);
  }

  let n = 0;
  /** One step: runs `fn`, which returns [ok, message, name]; a throw is a failure too. */
  async function step(fn) {
    n++;
    try {
      const [ok, what, name] = await fn();
      check(ok, what);
      await shot(`${String(n).padStart(2, "0")}-${name ?? "step"}${ok ? "" : "-FAIL"}`);
    } catch (e) {
      check(false, `step ${n} threw: ${e.message.split("\n")[0]}`);
      await shot(`${String(n).padStart(2, "0")}-FAIL`).catch(() => {});
      // Leave no menu or dialog open for the next step.
      await page.keyboard.press("Escape").catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------- load and layout
  await page.goto(url);
  await page.waitForSelector('button[title="Add layer"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  const docCanvas = page.locator('[class*="paper-"] + canvas');
  const area = await page.locator("div.bg-canvas-bg.touch-none").boundingBox();
  let pb = await docCanvas.boundingBox();
  /** A point on the page (the document), as fractions of it. */
  const at = (fx, fy) => ({ x: pb.x + pb.width * fx, y: pb.y + pb.height * fy });
  /** A client rect on the page, as fractions. */
  const rect = (fx, fy, fw, fh) => ({
    x: pb.x + pb.width * fx,
    y: pb.y + pb.height * fy,
    w: pb.width * fw,
    h: pb.height * fh,
  });
  const whole = () => rect(0, 0, 1, 1);
  /** A spot on the canvas area off the page, for taps that must hit nothing. */
  const offPage = { x: area.x + 12, y: area.y + area.height - 12 };
  const pen = (path, opts) => gesture(pathSteps("pen", 2, path, opts));
  const penTap = (p) =>
    gesture([
      { type: "down", id: 2, kind: "pen", x: p.x, y: p.y, p: 0.6 },
      { type: "up", id: 2, kind: "pen", x: p.x, y: p.y, wait: 40 },
    ]);
  /** The character's silhouette: an upright ellipse in the middle of the page. */
  const ellipse = (t) => {
    const a = t * Math.PI * 2;
    return at(0.5 + 0.12 * Math.sin(a), 0.5 - 0.3 * Math.cos(a));
  };

  await step(async () => {
    const bar = await page.evaluate(() => {
      const r1 = [...document.querySelectorAll("div")].find(
        (e) => getComputedStyle(e).gridRowStart === "row1",
      );
      return { fits: r1.scrollWidth <= r1.clientWidth, w: r1.clientWidth };
    });
    return [
      bar.fits && pb.width > 100,
      `loads (${url}); toolbar row 1 fits (${bar.w}px), page ${Math.round(pb.width)}×${Math.round(pb.height)} on screen`,
      "loaded",
    ];
  });

  await step(async () => {
    await page.getByRole("button", { name: /^File/ }).first().tap();
    await page.waitForTimeout(300);
    const opened = (await page.locator('[role="menu"]').count()) > 0;
    await tap(offPage);
    await page.waitForTimeout(400);
    const closed = (await page.locator('[role="menu"]').count()) === 0;
    return [opened && closed, "a finger tap opens the File menu, a tap outside closes it", "menu"];
  });

  // ------------------------------------------------------------------------------------ drawing
  await step(async () => {
    // A new document has no layers: the tools wait for one.
    const dimmed = await button("Brush (B)").getAttribute("title");
    await tapButton("Add layer");
    const rowsNow = await rows().count();
    return [
      /Select a layer/.test(dimmed) && rowsNow === 1,
      `a new document has no layer and says so ("${dimmed}"); Add layer makes one`,
      "first-layer",
    ];
  });

  await step(async () => {
    await tapButton("Brush (B)");
    const before = await ink(whole());
    await pen(ellipse, { n: 80, p: () => 0.8 });
    await page.waitForTimeout(300);
    const after = await ink(whole());
    return [
      before === 0 && after > 200 && (await canUndo()),
      `[sim] a pen stroke draws the outline (${before} → ${after} painted px) and adds an undo step`,
      "pen-stroke",
    ];
  });

  await step(async () => {
    const drawn = await ink(whole());
    await tapButton("Undo");
    const undone = await ink(whole());
    await tapButton("Redo");
    const redone = await ink(whole());
    return [
      undone < drawn / 10 && redone === drawn,
      `Undo removes the stroke and Redo puts it back (${drawn} → ${undone} → ${redone} painted px)`,
      "undo-redo",
    ];
  });

  await step(async () => {
    const drawn = await ink(whole());
    // Two fingers down and up together, not moving: undo, as slop-paint.
    await gesture([
      { type: "down", id: 11, kind: "touch", ...at(0.3, 0.3) },
      { type: "down", id: 12, kind: "touch", ...at(0.7, 0.3) },
      { type: "up", id: 11, kind: "touch", ...at(0.3, 0.3), wait: 60 },
      { type: "up", id: 12, kind: "touch", ...at(0.7, 0.3) },
    ]);
    await page.waitForTimeout(300);
    const undone = await ink(whole());
    await tapButton("Redo");
    return [
      undone < drawn / 10,
      `[sim] a two-finger tap undoes (${drawn} → ${undone} painted px)`,
      "two-finger-undo",
    ];
  });

  /** A pen stroke along the page's foot with `during` run while it is open; then Undo takes the
   *  stroke back, and the outline must still be undoable under it (a lost step says otherwise). */
  async function strokeWith(during) {
    const path = line(at(0.15, 0.92), at(0.85, 0.92));
    const move = (t) => ({ type: "move", id: 2, kind: "pen", ...path(t), p: 0.6, wait: 8 });
    const ts = (from, to) => Array.from({ length: 10 }, (_, i) => from + ((to - from) * i) / 9);
    await gesture([
      { type: "down", id: 2, kind: "pen", ...path(0), p: 0.6 },
      ...ts(0, 0.4).map(move),
    ]);
    await during();
    await gesture([
      ...ts(0.4, 1).map(move),
      { type: "up", id: 2, kind: "pen", ...path(1), wait: 8 },
    ]);
    await page.waitForTimeout(300);
    await tapButton("Undo");
    return canUndo();
  }

  await step(async () => {
    // A hand landing while the Pencil draws is resting, not gesturing: no undo, no pan.
    const before = await docCanvas.boundingBox();
    const kept = await strokeWith(async () => {
      await gesture([
        { type: "down", id: 11, kind: "touch", ...at(0.3, 0.3) },
        { type: "down", id: 12, kind: "touch", ...at(0.7, 0.3) },
        { type: "up", id: 11, kind: "touch", ...at(0.3, 0.3), wait: 60 },
        { type: "up", id: 12, kind: "touch", ...at(0.7, 0.3) },
      ]);
      await gesture(pathSteps("touch", 13, line(at(0.4, 0.4), at(0.6, 0.6))));
    });
    const after = await docCanvas.boundingBox();
    const still = Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1;
    return [
      kept && still,
      `[sim] fingers during a pen stroke neither undo nor pan (outline still undoable ${kept}, page moved ${Math.round(after.x - before.x)},${Math.round(after.y - before.y)} px)`,
      "fingers-mid-stroke",
    ];
  });

  await step(async () => {
    const kept = await strokeWith(() => page.keyboard.press("ControlOrMeta+z"));
    return [
      kept,
      `[sim] Ctrl+Z during a pen stroke waits for it to end (outline still undoable ${kept})`,
      "undo-mid-stroke",
    ];
  });

  await step(async () => {
    // A long opaque Ink or Calligraphy stroke freezes its settled part (draw-dispatch `frozenTo`):
    // it must draw the same pixels as a full redraw (dev-only `slopNoFreeze`), and one Undo must
    // take ALL of it back (undo reads its "before" from the copy freezing must not bake into).
    const spiral = (t) => {
      const a = t * Math.PI * 12;
      const r = 0.04 + 0.36 * t;
      return at(0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a));
    };
    const pixels = (keep) =>
      page.evaluate((keep) => {
        const c = document.querySelector('[class*="paper-"] + canvas');
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        if (keep) return void (window.__snap = d);
        let n = 0;
        for (let i = 0; i < d.length; i++) if (Math.abs(d[i] - window.__snap[i]) > 8) n++;
        return n;
      }, keep);
    const results = [];
    for (const type of ["ink", "calligraphy"]) {
      await page.locator('select[title="Brush"]').selectOption(type);
      const base = await ink(whole());
      await page.evaluate(() => (window.slopNoFreeze = true));
      await pen(spiral, { n: 150, p: () => 0.7 });
      await page.waitForTimeout(400);
      await pixels(true);
      await tapButton("Undo");
      await page.evaluate(() => (window.slopNoFreeze = false));
      await pen(spiral, { n: 150, p: () => 0.7 });
      await page.waitForTimeout(400);
      const differ = await pixels(false);
      await shot(`frozen-${type}`);
      await tapButton("Undo");
      const after = await ink(whole());
      results.push({ type, differ, undone: after === base });
    }
    await page.locator('select[title="Brush"]').selectOption("smooth");
    return [
      results.every((r) => r.differ < 2000 && r.undone),
      `[sim] a long frozen stroke matches a full redraw and undoes whole (${results.map((r) => `${r.type}: ${r.differ} channel values differ, undone ${r.undone}`).join("; ")})`,
      "frozen-stroke",
    ];
  });

  await step(async () => {
    // The Dry brush: hair stripes broken where they run dry, so fewer px than Smooth on one path.
    const band = rect(0.05, 0.03, 0.9, 0.14);
    const stroke = line(at(0.1, 0.1), at(0.9, 0.1));
    const brushType = page.locator('select[title="Brush"]');
    const paints = async (type) => {
      await brushType.selectOption(type);
      const before = await ink(band);
      await pen(stroke, { n: 60 });
      await page.waitForTimeout(300);
      const drawn = (await ink(band)) - before;
      await shot(`dry-vs-${type}`);
      await tapButton("Undo");
      return [drawn, (await ink(band)) === before];
    };
    const [dry, dryUndone] = await paints("dry");
    const [smooth, smoothUndone] = await paints("smooth");
    return [
      dry > 50 && dry < smooth * 0.9 && dryUndone && smoothUndone,
      `[sim] the Dry brush paints a broken stroke (${dry} px against Smooth's ${smooth}) and undoes`,
      "dry-brush",
    ];
  });

  await step(async () => {
    // The stamp tips: from the tip image at size 12, as soft discs at size 2 (8 device px or less).
    const band = rect(0.05, 0.03, 0.9, 0.14);
    const stroke = line(at(0.1, 0.1), at(0.9, 0.1));
    const size = page.locator('input[type="range"][step="0.5"]').first();
    const counts = [];
    for (const [type, px] of [
      ["pencil", "12"],
      ["pencil", "2"],
      ["charcoal", "12"],
    ]) {
      await page.locator('select[title="Brush"]').selectOption(type);
      await size.fill(px);
      const before = await ink(band);
      await pen(stroke, { n: 60, p: () => 1 });
      await page.waitForTimeout(300);
      counts.push((await ink(band)) - before);
      await shot(`stamp-${type}-${px}`);
      await tapButton("Undo");
    }
    await page.locator('select[title="Brush"]').selectOption("smooth");
    await size.fill("12");
    const [pencil, tiny, charcoal] = counts;
    return [
      pencil > 500 && tiny > 50 && tiny < pencil && charcoal > 500 && (await ink(band)) === 0,
      `[sim] Pencil at 12 and 2 and Charcoal at 12 paint (${pencil}, ${tiny}, ${charcoal} px) and undo`,
      "stamp-tips",
    ];
  });

  await step(async () => {
    await tapButton("Fill (G)");
    const before = await ink(whole());
    await penTap(at(0.5, 0.5));
    await page.waitForTimeout(400);
    const after = await ink(whole());
    return [
      after > before * 4,
      `[sim] the bucket fills inside the outline (${before} → ${after} painted px)`,
      "fill",
    ];
  });

  await step(async () => {
    // The eraser's own Opacity: at 40% it fades the ink (alpha stays above half), not removes it.
    await tapButton("Eraser (E)");
    const opacity = page
      .locator("label", { hasText: /^\s*Opacity/ })
      .locator("input")
      .first();
    await opacity.fill("40");
    const band = rect(0.3, 0.45, 0.4, 0.1);
    const before = await ink(band);
    await pen(line(at(0.3, 0.5), at(0.7, 0.5)), { p: () => 0.9 });
    await page.waitForTimeout(300);
    const after = await ink(band);
    await tapButton("Undo");
    await opacity.fill("100");
    return [
      after > before * 0.98,
      `[sim] the eraser at Opacity 40 fades ink rather than removing it (${before} → ${after} painted px in the band)`,
      "eraser-opacity",
    ];
  });

  await step(async () => {
    await tapButton("Eraser (E)");
    const band = rect(0.3, 0.45, 0.4, 0.1);
    const before = await ink(band);
    await pen(line(at(0.3, 0.5), at(0.7, 0.5)), { p: () => 0.9 });
    await page.waitForTimeout(300);
    const after = await ink(band);
    // Put the silhouette back whole for the rig.
    await tapButton("Undo");
    return [
      after < before * 0.9,
      `[sim] the eraser removes ink across the body (${before} → ${after} painted px in the band)`,
      "eraser",
    ];
  });

  await step(async () => {
    const z0 = await zoom();
    await gesture([
      { type: "down", id: 11, kind: "touch", ...at(0.45, 0.5) },
      { type: "down", id: 12, kind: "touch", ...at(0.55, 0.5) },
      ...Array.from({ length: 10 }, (_, i) => [
        { type: "move", id: 11, kind: "touch", ...at(0.45 - 0.02 * (i + 1), 0.5), wait: 16 },
        { type: "move", id: 12, kind: "touch", ...at(0.55 + 0.02 * (i + 1), 0.5) },
      ]).flat(),
      { type: "up", id: 11, kind: "touch", ...at(0.25, 0.5), wait: 16 },
      { type: "up", id: 12, kind: "touch", ...at(0.75, 0.5) },
    ]);
    await page.waitForTimeout(300);
    const z1 = await zoom();
    // Back to fit, so the page fractions below still hold.
    await menu("View", /^Fit/);
    await page.waitForTimeout(300);
    pb = await docCanvas.boundingBox();
    return [z1 !== z0, `[sim] a two-finger pinch zooms (${z0} → ${z1})`, "pinch"];
  });

  // ---------------------------------------------------------------------------------------- rig
  await step(async () => {
    await menu("File", /^Export Spine/);
    const s = await until(async () => /bone/i.test(await status()) && status(), 3000);
    return [
      /Add a bone/.test(s) && (await shared()).length === 0,
      `Export with no bones refuses and says why ("${s}")`,
      "export-refused",
    ];
  });

  await step(async () => {
    await tapButton("Rig (R)");
    await tapButton("Create bone");
    // A spine up the body, then a neck from its tip: the second press lands on the first bone's
    // tip, so the new bone hangs from it.
    await pen(line(at(0.5, 0.75), at(0.5, 0.45)));
    await page.waitForTimeout(200);
    await pen(line(at(0.5, 0.45), at(0.5, 0.25)));
    await page.waitForTimeout(300);
    // Counted in the export below; here, that the rig took an undo step and drew something.
    const rig = await page.evaluate(() => {
      const c = document.querySelector("canvas.z-5");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
    return [
      (await canUndo()) && rig > 100,
      `[sim] two pen drags in Create mode draw bones (${rig} px on the rig overlay)`,
      "bones",
    ];
  });

  await step(async () => {
    await tapButton("Pose (or Alt-drag)");
    const clip = { x: pb.x, y: pb.y, width: pb.width, height: pb.height };
    const before = await page.screenshot({ clip });
    // Swing the neck's tip to the right, and look while it is held: the pose springs back on
    // release.
    const steps = pathSteps("pen", 2, line(at(0.5, 0.25), at(0.65, 0.3)));
    await gesture(steps.slice(0, -1));
    await page.waitForTimeout(300);
    const after = await page.screenshot({ clip });
    await gesture(steps.slice(-1));
    await page.waitForTimeout(300);
    return [
      !before.equals(after),
      "[sim] dragging a bone tip in Pose mode bends the drawing",
      "pose",
    ];
  });

  await step(async () => {
    await page.evaluate(() => (window.__shared = []));
    await menu("File", /^Export Spine/);
    const files = await until(async () => {
      const s = await shared();
      return s.length ? s : null;
    }, 8000);
    const zip = files?.[0];
    if (!zip) return [false, "Export Spine… reaches the share sheet", "export"];
    const entries = unzipSync(Buffer.from(zip.b64, "base64"));
    const names = Object.keys(entries);
    const jsonName = names.find((f) => f.endsWith(".json") || f.endsWith(".spinejson"));
    const json = jsonName ? JSON.parse(strFromU8(entries[jsonName])) : null;
    const bones = json?.bones?.length ?? 0;
    const meshes = JSON.stringify(json?.skins ?? []).match(/"type":"mesh"/g)?.length ?? 0;
    const hasAtlas = names.some((f) => f.endsWith(".atlas") || f.endsWith(".atlas.txt"));
    const hasPng = names.some((f) => f.endsWith(".png"));
    return [
      zip.name === "character.zip" && bones >= 3 && meshes >= 1 && hasAtlas && hasPng,
      `Export Spine… shares ${zip.name} (${names.join(", ")}): ${bones} bones, ${meshes} mesh attachment(s), atlas ${hasAtlas}, png ${hasPng}`,
      "export",
    ];
  });

  // -------------------------------------------------------------------------------- layer panel
  await step(async () => {
    await tapButton("Brush (B)");
    const before = await rows().count();
    await tapButton("Add layer");
    const after = await rows().count();
    const selectedIsTop = (
      await page.locator("[data-layer-id]").first().getAttribute("class")
    ).includes("ui-selected");
    return [
      after === before + 1 && selectedIsTop,
      `Add layer adds a row on top and selects it (${before} → ${after})`,
      "add-layer",
    ];
  });

  await step(async () => {
    const name = rows().nth(1).locator("span.truncate");
    await name.tap();
    await page.waitForTimeout(80);
    await name.tap();
    const input = page.locator("input.layer-rename-input");
    await input.waitFor({ timeout: 2000 });
    await input.fill("Body");
    await input.press("Enter");
    await page.waitForTimeout(150);
    const names = await rowNames();
    return [names[1] === "Body", `double-tap renames a layer (${names.join(", ")})`, "rename"];
  });

  await step(async () => {
    // Hide the selected layer (the double-tap above selected "Body"), and the pen refuses it.
    // Counted with the layer shown: while hidden it isn't in the composite at all.
    const selected = page.locator("[data-layer-id].ui-selected");
    const before = await ink(whole());
    await selected.locator('button[title^="Visible"]').tap();
    await pen(line(at(0.1, 0.1), at(0.3, 0.1)));
    await page.waitForTimeout(200);
    const caption = await page
      .locator("div.text-warn.absolute")
      .innerText()
      .catch(() => "");
    await selected.locator('button[title^="Hidden"]').tap();
    await page.waitForTimeout(200);
    const after = await ink(whole());
    return [
      before === after && /hidden/i.test(caption),
      `[sim] a hidden layer refuses the pen (${before} → ${after} painted px; "${caption}")`,
      "hidden-refuses",
    ];
  });

  await step(async () => {
    // Clear layer refuses a hidden layer too (slop-paint e745612): it used to wipe pixels you
    // couldn't see. Counted with the layer shown, as above.
    const selected = page.locator("[data-layer-id].ui-selected");
    const before = await ink(whole());
    await selected.locator('button[title^="Visible"]').tap();
    await tapButton("Clear layer");
    const s = await status();
    await selected.locator('button[title^="Hidden"]').tap();
    await page.waitForTimeout(200);
    const after = await ink(whole());
    return [
      before === after && /hidden/i.test(s),
      `Clear layer refuses a hidden layer (${before} → ${after} painted px; "${s}")`,
      "clear-hidden",
    ];
  });

  await step(async () => {
    // Duplicate with a lifted selection: the copy must carry the moved pixels, not the hole they
    // left (slop-paint e745612). The top of the body is lifted and moved off it, to the right.
    await tapButton("Rect select");
    await pen(line(at(0.35, 0.15), at(0.65, 0.35)), { n: 10 });
    await page.waitForTimeout(150);
    await pen(line(at(0.5, 0.3), at(0.8, 0.3)), { n: 15 });
    await page.waitForTimeout(200);
    // Apply's title says "nothing lifted yet" until a float exists.
    const lifted = (await page.locator('button[title="Apply (Enter)"]').count()) > 0;
    await tapButton("Duplicate layer");
    await page.waitForTimeout(200);
    const names = await rowNames();
    // Hide the original: what's left on the right is the copy's alone.
    const original = rows().filter({ hasText: /^\s*Body\s*$/ });
    await original.locator('button[title^="Visible"]').tap();
    await page.waitForTimeout(200);
    const copyRight = await ink(rect(0.67, 0.16, 0.26, 0.18));
    await original.locator('button[title^="Hidden"]').tap();
    return [
      lifted && names.includes("Body copy") && copyRight > 1000,
      `[sim] Duplicate with a lifted selection copies the moved pixels (lifted ${lifted}; ${names.join(", ")}; ${copyRight} painted px of the copy where they moved)`,
      "duplicate-float",
    ];
  });

  await step(async () => {
    // At least three rows, so a drop one slot down moves only the top two (the rest stay put).
    await tapButton("Add layer");
    const before = await rowNames();
    const grip = await rows().first().locator('[title="Drag to reorder"]').boundingBox();
    const rowH = (await rows().first().boundingBox()).height;
    const g = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    await gesture([
      { type: "down", id: 21, kind: "touch", ...g },
      ...Array.from({ length: 8 }, (_, i) => ({
        type: "move",
        id: 21,
        kind: "touch",
        x: g.x,
        y: g.y + (1.2 * rowH * (i + 1)) / 8,
        wait: 16,
      })),
    ]);
    await page.waitForTimeout(250);
    const mid = await page.evaluate(() => ({
      ghost: !!document.querySelector("[data-drag-ghost]"),
      // Each row's slide in px: the grabbed top row down one row, the second up one, the rest 0.
      dy: [...document.querySelectorAll("[data-layer-id]")].map((e) =>
        Math.round(Number(e.style.transform.match(/-?[\d.]+/)?.[0] ?? 0)),
      ),
    }));
    await shot(`${String(n + 1).padStart(2, "0")}-layer-drag-mid`);
    await gesture([{ type: "up", id: 21, kind: "touch", x: g.x, y: g.y + 1.2 * rowH }]);
    await page.waitForTimeout(250);
    const after = await rowNames();
    return [
      mid.ghost &&
        mid.dy[0] > 0 &&
        mid.dy[1] === -mid.dy[0] &&
        mid.dy.slice(2).every((d) => d === 0) &&
        after.join() === [before[1], before[0], ...before.slice(2)].join(),
      `[sim] a finger drag on a grip lifts the row, moves its place one slot down (slides ${mid.dy.join(", ")}) and reorders (${before.join(", ")} → ${after.join(", ")})`,
      "layer-drag",
    ];
  });

  // ---------------------------------------------------------------------- save, open, autosave
  /** The saved project, reused by Open below. */
  let saved = null;
  await step(async () => {
    const download = page.waitForEvent("download", { timeout: 8000 });
    await menu("File", /^Save/);
    const d = await download;
    saved = `${OUT}/${d.suggestedFilename()}`;
    await d.saveAs(saved);
    return [
      d.suggestedFilename() === "project.zip",
      `Save downloads ${d.suggestedFilename()}`,
      "save",
    ];
  });

  await step(async () => {
    const names = await rowNames();
    await tapButton("Add layer");
    const added = await rows().count();
    await page.locator('input[type="file"][accept=".zip"]').setInputFiles(saved);
    await until(async () => (await rows().count()) === names.length, 5000);
    const back = await rowNames();
    return [
      added === names.length + 1 && back.join() === names.join(),
      `Open restores the saved project (${added} rows → ${back.join(", ")})`,
      "open",
    ];
  });

  await step(async () => {
    const names = await rowNames();
    const drawn = await ink(whole());
    // The autosave waits a moment after the last change.
    await page.waitForTimeout(4000);
    await page.reload();
    await page.waitForSelector('button[title="Add layer"]', { timeout: 20000 });
    await page.waitForSelector("[data-layer-id]", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
    pb = await docCanvas.boundingBox();
    const back = await rowNames();
    const after = await ink(whole());
    return [
      back.join() === names.join() && drawn > 0 && after > drawn / 2,
      `autosave survives a reload (${back.join(", ")}; ${drawn} → ${after} painted px)`,
      "autosave",
    ];
  });
}

const profiles = [];
/** A WebKit context in a fresh, persistent temp profile, removed at the end. */
async function profileContext(device) {
  const dir = mkdtempSync(join(tmpdir(), "slop-spine-ipad-"));
  profiles.push(dir);
  // launchPersistentContext takes the device's options but not which browser it belongs to.
  const options = { ...device };
  delete options.defaultBrowserType;
  const context = await webkit.launchPersistentContext(dir, { ...options, acceptDownloads: true });
  await context.addInitScript(pageSetup);
  return context;
}

try {
  const errors = [];
  const watch = (page, tag = "") => {
    page.on("pageerror", (e) => errors.push(`${tag}${e.message}`));
    page.on("console", (m) => {
      // The no-bones Export refusal is a step above, and the app logs it.
      if (m.type() === "error" && !/export failed ExportError: Add a bone/.test(m.text()))
        errors.push(`${tag}${m.text()}`);
    });
  };

  // ---------------------------------------------------------------- landscape, the main pass
  const context = await profileContext(devices["iPad Pro 11 landscape"]);
  const page = context.pages()[0] ?? (await context.newPage());
  watch(page);
  await main(page);
  await context.close();

  // ---------------------------------------------------------------------------------- portrait
  // iPad portrait (834 px): row 1 fits, and the tool-options row keeps one height for every tool,
  // so switching tools doesn't move the canvas (slop-paint's brush row wrapped there).
  const portrait = await profileContext(devices["iPad Pro 11"]);
  const pp = portrait.pages()[0] ?? (await portrait.newPage());
  watch(pp, "portrait: ");
  try {
    await pp.goto(url);
    await pp.waitForSelector('button[title="Add layer"]', { timeout: 20000 });
    await pp.waitForTimeout(800);
    const fits = await pp.evaluate(() => {
      const r1 = [...document.querySelectorAll("div")].find(
        (e) => getComputedStyle(e).gridRowStart === "row1",
      );
      return r1.scrollWidth <= r1.clientWidth;
    });
    const heights = [];
    for (const t of ["Brush (B)", "Eraser (E)", "Fill (G)", "Rect select", "Lasso", "Rig (R)"]) {
      await pp.locator(`button[title^="${t}"]`).first().tap();
      await pp.waitForTimeout(200);
      const h = await pp.evaluate(
        () =>
          [...document.querySelectorAll("div")]
            .find((e) => getComputedStyle(e).gridRowStart === "row2")
            .getBoundingClientRect().height,
      );
      heights.push(`${t.split(" (")[0]} ${Math.round(h)}`);
      if (t === "Brush (B)") await pp.screenshot({ path: `${OUT}/90-portrait-brush.png` });
    }
    const hs = heights.map((h) => Number(h.split(" ").at(-1)));
    check(
      fits && hs.every((h) => h === hs[0]),
      `portrait: row 1 fits (${fits}); the tool-options row keeps one height (${heights.join(", ")} px)`,
    );
  } catch (e) {
    check(false, `portrait threw: ${e.message.split("\n")[0]}`);
  }
  await portrait.close();

  check(
    errors.length === 0,
    `no page errors anywhere${errors.length ? `: ${[...new Set(errors)].join(" | ")}` : ""}`,
  );
} finally {
  await server?.close();
  for (const dir of profiles) rmSync(dir, { recursive: true, force: true });
}
console.log(
  failures.length ? `\n${failures.length} failed` : `\nall passed — screenshots in ${OUT}/`,
);
process.exit(failures.length ? 1 : 0);
