import { describe, it, expect } from "vitest";
import { clampZoom, wheelPx, wheelZoomFactor } from "../viewport";

describe("wheelZoomFactor", () => {
  it("follows a trackpad pinch's small deltas instead of 10% each", () => {
    // 30 Chrome pinch events of −2: e^0.6 ≈ 1.82 (a fixed 10% per event gave 17×)
    let z = 1;
    for (let i = 0; i < 30; i++) z *= wheelZoomFactor(-2);
    expect(z).toBeCloseTo(Math.exp(0.6), 5);
  });

  it("zooms a mouse notch about 10%, either way", () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.105, 3);
    expect(wheelZoomFactor(100)).toBeCloseTo(0.905, 3);
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(1.105, 3); // Firefox: 3 lines
  });

  it("zooms nothing for deltaY 0", () => {
    expect(wheelZoomFactor(0)).toBe(1);
  });
});

describe("clampZoom", () => {
  it("keeps a zoom inside 10%–2000%", () => {
    expect(clampZoom(1, 0.05)).toBe(0.1);
    expect(clampZoom(1, 30)).toBe(20);
    expect(clampZoom(1, 2)).toBe(2);
  });

  it("a fitted zoom below the floor: zooming out stays put, zooming in works", () => {
    // Fit put an 8192 px document at ~8%: Ctrl+- and the wheel jumped it IN to 10%.
    expect(clampZoom(0.08, 0.08 / 1.2)).toBe(0.08);
    expect(clampZoom(0.08, 0.09)).toBe(0.09);
    expect(clampZoom(0.08, 0.2)).toBe(0.2);
  });
});

describe("wheelPx", () => {
  it("converts lines and pages to pixels, leaves pixels alone", () => {
    expect(wheelPx(3, 1)).toBe(48); // one Firefox mouse-wheel notch
    expect(wheelPx(-1, 2)).toBe(-800);
    expect(wheelPx(100, 0)).toBe(100);
    expect(wheelPx(100)).toBe(100);
  });
});
