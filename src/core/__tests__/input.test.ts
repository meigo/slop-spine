import { describe, it, expect, vi } from "vitest";
import { isStageChromeTarget, setupInput, type InputPoint } from "../input";

// The rope's pause check runs once a frame; these tests drive events only.
vi.stubGlobal("requestAnimationFrame", () => 0);
vi.stubGlobal("cancelAnimationFrame", () => {});

function node(closest: (sel: string) => unknown) {
  return { closest } as unknown as EventTarget;
}

describe("isStageChromeTarget", () => {
  it("is false for null / a target with no closest()", () => {
    expect(isStageChromeTarget(null)).toBe(false);
    expect(isStageChromeTarget({} as EventTarget)).toBe(false);
  });

  it("is true for the selection action bar (and nodes inside it)", () => {
    expect(
      isStageChromeTarget(node((sel) => (sel === ".selection-actions-panel" ? {} : null))),
    ).toBe(true);
  });

  it("is false for a click on the drawing surface", () => {
    expect(isStageChromeTarget(node(() => null))).toBe(false);
  });
});

type Ptr = { pointerId: number; pointerType: string; x: number; y: number; pressure?: number };

/** setupInput on a bare EventTarget, recording every onStroke call. */
function stage(streamline = 0, minRopePx = 0) {
  const el = Object.assign(new EventTarget(), {
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  }) as unknown as HTMLElement;
  const calls: { points: InputPoint[]; done: boolean }[] = [];
  setupInput(el, (points, done) => calls.push({ points: [...points], done }), undefined, {
    streamline,
    minRopePx: () => minRopePx,
  });
  const fire = (type: string, p: Ptr) =>
    el.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        button: 0,
        pointerId: p.pointerId,
        pointerType: p.pointerType,
        clientX: p.x,
        clientY: p.y,
        pressure: p.pressure ?? 0.5,
      }),
    );
  return { calls, fire };
}

const pen = (x: number, y: number, pressure = 0.5): Ptr => ({
  pointerId: 1,
  pointerType: "pen",
  x,
  y,
  pressure,
});
const finger = (x: number, y: number): Ptr => ({ pointerId: 2, pointerType: "touch", x, y });

describe("setupInput", () => {
  it("ignores a finger's moves during a Pencil stroke", () => {
    const { calls, fire } = stage();
    fire("pointerdown", pen(0, 0));
    fire("pointermove", finger(100, 100));
    fire("pointermove", pen(2, 0));
    const last = calls[calls.length - 1].points;
    expect(last.every((p) => p.x <= 2 && p.y === 0)).toBe(true);
  });

  it("doesn't end a Pencil stroke when a finger lifts", () => {
    const { calls, fire } = stage();
    fire("pointerdown", pen(0, 0));
    fire("pointerup", finger(100, 100));
    expect(calls.some((c) => c.done)).toBe(false);
    fire("pointerup", pen(2, 0));
    expect(calls[calls.length - 1].done).toBe(true);
  });

  it("ends the stroke when pointer capture is lost without an up", () => {
    const { calls, fire } = stage();
    fire("pointerdown", pen(0, 0));
    fire("lostpointercapture", pen(0, 0));
    expect(calls[calls.length - 1].done).toBe(true);
    // and the next press starts a new stroke
    fire("pointerdown", pen(5, 5));
    expect(calls[calls.length - 1]).toMatchObject({ done: false, points: [{ x: 5, y: 5 }] });
  });

  it("keeps the last pressure on the lift point (a pen's pointerup reports 0)", () => {
    const { calls, fire } = stage();
    fire("pointerdown", pen(0, 0, 0.7));
    fire("pointermove", pen(2, 0, 0.7));
    fire("pointerup", pen(2, 0, 0));
    const points = calls[calls.length - 1].points;
    expect(points[points.length - 1].pressure).toBe(0.7);
  });

  it("a minimum string holds the line back even at Stream 0 (the stamp tips)", () => {
    const { calls, fire } = stage(0, 4);
    fire("pointerdown", pen(0, 0));
    for (let x = 1; x <= 20; x++) fire("pointermove", pen(x, 0));
    const held = calls[calls.length - 1].points;
    expect(held[held.length - 1].x).toBeCloseTo(16, 0);
    fire("pointerup", pen(20, 0));
    const done = calls[calls.length - 1].points;
    expect(done[done.length - 1]).toMatchObject({ x: 20, y: 0 });
  });

  it("Stream holds the line back on its string, and the lift still ends at the pen", () => {
    const { calls, fire } = stage(1); // a 40 px string
    fire("pointerdown", pen(0, 0));
    for (let x = 1; x <= 30; x++) fire("pointermove", pen(x, x % 2 ? 2 : -2)); // a wobbly 30 px
    // Never taut: the line hasn't left the start (a pen resting there still adds points there).
    expect(calls[calls.length - 1].points.every((p) => p.x === 0 && p.y === 0)).toBe(true);
    for (let x = 31; x <= 100; x++) fire("pointermove", pen(x, 0));
    const held = calls[calls.length - 1].points;
    expect(held[held.length - 1].x).toBeCloseTo(60, 0); // 40 px behind the pen at 100
    fire("pointerup", pen(100, 0));
    const done = calls[calls.length - 1];
    expect(done.done).toBe(true);
    expect(done.points[done.points.length - 1]).toMatchObject({ x: 100, y: 0 });
  });
});
