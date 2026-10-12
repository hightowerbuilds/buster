/**
 * Damped springs for text motion. Underdamped by default so moving words
 * overshoot a little before settling — then snap exactly to their target, so a
 * closing animation always lands on the real text's pixels.
 */

export interface Spring { value: number; velocity: number; target: number }
export interface SpringConfig { stiffness: number; damping: number }

export const LIVELY: SpringConfig = { stiffness: 260, damping: 17 };
export const SETTLE: SpringConfig = { stiffness: 340, damping: 30 };

const REST_DISTANCE = 0.08;
const REST_VELOCITY = 0.08;
const MAX_STEP = 1 / 30;

export const spring = (value: number, target = value): Spring => ({ value, velocity: 0, target });

export function isSettled(s: Spring): boolean {
  return s.value === s.target && s.velocity === 0;
}

/** Advance one spring by `dt` seconds (semi-implicit Euler, sub-stepped for long frames). */
export function stepSpring(s: Spring, dt: number, config: SpringConfig): void {
  let remaining = Math.max(0, dt);
  while (remaining > 0) {
    const h = Math.min(remaining, MAX_STEP);
    const force = -config.stiffness * (s.value - s.target) - config.damping * s.velocity;
    s.velocity += force * h;
    s.value += s.velocity * h;
    remaining -= h;
  }
  if (Math.abs(s.value - s.target) < REST_DISTANCE && Math.abs(s.velocity) < REST_VELOCITY) {
    s.value = s.target;
    s.velocity = 0;
  }
}
