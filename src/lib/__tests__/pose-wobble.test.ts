import { describe, it, expect } from "vitest";
import { stepWobble, stepTip, wobbleSettled, inertiaFor } from "../pose-wobble";

describe("inertiaFor", () => {
  it("matches the Spine writer: 0.5 * wobble", () => {
    expect(inertiaFor(0)).toBe(0);
    expect(inertiaFor(0.4)).toBeCloseTo(0.2);
    expect(inertiaFor(1)).toBeCloseTo(0.5);
  });
});

describe("stepWobble", () => {
  it("snaps to the target when wobble is 0", () => {
    const s = stepWobble({ pos: 0, vel: 0 }, 10, 0, 1 / 60);
    expect(s.pos).toBe(10);
    expect(s.vel).toBe(0);
  });

  it("does not reach a step target in one frame when wobble is high", () => {
    const s = stepWobble({ pos: 0, vel: 0 }, 10, 1, 1 / 60);
    expect(s.pos).toBeGreaterThan(0);
    expect(s.pos).toBeLessThan(10);
  });

  it("lags more at wobble 1 than at wobble 0.2 after the same time", () => {
    let floppy = { pos: 0, vel: 0 };
    let stiff = { pos: 0, vel: 0 };
    for (let i = 0; i < 12; i++) {
      floppy = stepWobble(floppy, 10, 1, 1 / 60);
      stiff = stepWobble(stiff, 10, 0.2, 1 / 60);
    }
    expect(Math.abs(10 - floppy.pos)).toBeGreaterThan(Math.abs(10 - stiff.pos));
  });

  it("settles near the target after enough steps", () => {
    let s = { pos: 0, vel: 0 };
    for (let i = 0; i < 240; i++) s = stepWobble(s, 10, 0.6, 1 / 60);
    expect(s.pos).toBeCloseTo(10, 1);
    expect(wobbleSettled(s, 10)).toBe(true);
  });
});

/** Rest bone along +x, length 100. Sim starts at the rest tip. */
function restTipState() {
  return { x: { pos: 100, vel: 0 }, y: { pos: 0, vel: 0 } };
}

function holdTip(
  origin: { x: number; y: number },
  target: { x: number; y: number },
  frames: number,
  wobble = 1,
) {
  let s = restTipState();
  let extra = 0;
  for (let i = 0; i < frames; i++) {
    const next = stepTip(s, target, origin, 100, wobble, 1 / 60);
    s = { x: next.x, y: next.y };
    extra = next.extraTheta;
  }
  return { s, extra };
}

describe("stepTip", () => {
  it("snaps to the rigid tip when wobble is 0", () => {
    const s = stepTip(restTipState(), { x: 100, y: 40 }, { x: 0, y: 40 }, 100, 0, 1 / 60);
    expect(s.extraTheta).toBe(0);
    expect(s.x.pos).toBe(100);
    expect(s.y.pos).toBe(40);
  });

  it("stays on the circle around the origin so lag is a rotation, not a slide", () => {
    const next = stepTip(restTipState(), { x: 100, y: 40 }, { x: 0, y: 40 }, 100, 1, 1 / 60);
    expect(Math.hypot(next.x.pos - 0, next.y.pos - 40)).toBeCloseTo(100, 5);
  });

  it("translation perpendicular to the bone produces rotation lag", () => {
    // Springing shared dtheta cannot do this: translation never changes dtheta, so extraTheta
    // stayed 0 no matter how low stiffness went.
    const { extra } = holdTip({ x: 0, y: 40 }, { x: 100, y: 40 }, 8);
    expect(Math.abs(extra)).toBeGreaterThan(0.1);
  });

  it("translation along the bone produces no rotation (pendulum has no lever)", () => {
    const { extra } = holdTip({ x: 40, y: 0 }, { x: 140, y: 0 }, 8);
    expect(Math.abs(extra)).toBeLessThan(0.02);
  });

  it("lags a rotation around the origin", () => {
    const ang = 0.5;
    const origin = { x: 0, y: 0 };
    const target = { x: 100 * Math.cos(ang), y: 100 * Math.sin(ang) };
    const { extra } = holdTip(origin, target, 8);
    expect(Math.abs(extra)).toBeGreaterThan(0.1);
    // Trailing the rigid angle, not overshooting past rest.
    expect(extra).toBeLessThan(0);
  });
});
