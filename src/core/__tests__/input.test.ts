import { describe, it, expect } from "vitest";
import { isStageChromeTarget, setupInput, type InputPoint } from "../input";

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
function stage() {
  const el = Object.assign(new EventTarget(), {
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  }) as unknown as HTMLElement;
  const calls: { points: InputPoint[]; done: boolean }[] = [];
  setupInput(el, (points, done) => calls.push({ points: [...points], done }));
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
});
