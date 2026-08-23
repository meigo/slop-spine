/** Same formula the Spine writer uses (`inertia: 0.5 * wobble`). */
export function inertiaFor(wobble: number): number {
  return 0.5 * wobble;
}

/** Spine export hardcodes this on every physics constraint. */
export const WOBBLE_DAMPING = 0.85;

export interface WobbleAxis {
  pos: number;
  vel: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** Spring `pos` toward `target`. wobble 0 snaps. */
export function stepWobble(
  state: WobbleAxis,
  target: number,
  wobble: number,
  dt: number,
  stiffness = 40,
  dampRatio = WOBBLE_DAMPING,
): WobbleAxis {
  if (wobble <= 0 || dt <= 0) return { pos: target, vel: 0 };
  const m = Math.max(inertiaFor(wobble), 1e-4);
  const k = stiffness;
  const c = dampRatio * 2 * Math.sqrt(k * m);
  const acc = (-k * (state.pos - target) - c * state.vel) / m;
  const vel = state.vel + acc * dt;
  return { pos: state.pos + vel * dt, vel };
}

/** Pixel-space tip spring. Softer than translation k=40 so a sideways pose still swings,
 *  but 14 was a full flop at wobble 1. */
export const TIP_STIFFNESS = 28;
export const TIP_DAMP_RATIO = 0.55;

export function wobbleSettled(state: WobbleAxis, target: number, eps = 0.15): boolean {
  return Math.abs(state.pos - target) < eps && Math.abs(state.vel) < eps;
}

export function boneRestTip(bone: { x: number; y: number; rotation: number; length: number }): Pt {
  const rad = (bone.rotation * Math.PI) / 180;
  return { x: bone.x + Math.cos(rad) * bone.length, y: bone.y + Math.sin(rad) * bone.length };
}

function wrapPi(a: number): number {
  let t = a % (Math.PI * 2);
  if (t > Math.PI) t -= Math.PI * 2;
  if (t < -Math.PI) t += Math.PI * 2;
  return t;
}

export function extraThetaFromTips(origin: Pt, rigidTip: Pt, simTip: Pt): number {
  return wrapPi(
    Math.atan2(simTip.y - origin.y, simTip.x - origin.x) -
      Math.atan2(rigidTip.y - origin.y, rigidTip.x - origin.x),
  );
}

function projectOnCircle(origin: Pt, p: Pt, radius: number): Pt {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-8) return { x: origin.x + radius, y: origin.y };
  const s = radius / d;
  return { x: origin.x + dx * s, y: origin.y + dy * s };
}

/** Drop the radial velocity so the tip stays a rotation around `origin`, not a sliding mass. */
function tangentialVel(origin: Pt, pos: Pt, vel: Pt): Pt {
  const rx = pos.x - origin.x;
  const ry = pos.y - origin.y;
  const r = Math.hypot(rx, ry);
  if (r < 1e-8) return vel;
  const nx = rx / r;
  const ny = ry / r;
  const radial = vel.x * nx + vel.y * ny;
  return { x: vel.x - radial * nx, y: vel.y - radial * ny };
}

/** Spring the bone tip toward the rigid posed tip, then project onto the circle around the
 *  posed origin. Translation across the bone becomes a pendulum; rotation lags on the arc.
 *  Springing shared `dtheta` cannot do this — a body-drag never changes dtheta, so extraTheta
 *  stayed 0 no matter how low stiffness went. */
export function stepTip(
  state: { x: WobbleAxis; y: WobbleAxis },
  target: Pt,
  origin: Pt,
  length: number,
  wobble: number,
  dt: number,
): { x: WobbleAxis; y: WobbleAxis; extraTheta: number } {
  if (wobble <= 0 || dt <= 0 || length < 1e-3) {
    return { x: { pos: target.x, vel: 0 }, y: { pos: target.y, vel: 0 }, extraTheta: 0 };
  }
  const x = stepWobble(state.x, target.x, wobble, dt, TIP_STIFFNESS, TIP_DAMP_RATIO);
  const y = stepWobble(state.y, target.y, wobble, dt, TIP_STIFFNESS, TIP_DAMP_RATIO);
  const pos = projectOnCircle(origin, { x: x.pos, y: y.pos }, length);
  const vel = tangentialVel(origin, pos, { x: x.vel, y: y.vel });
  return {
    x: { pos: pos.x, vel: vel.x },
    y: { pos: pos.y, vel: vel.y },
    extraTheta: extraThetaFromTips(origin, target, pos),
  };
}
