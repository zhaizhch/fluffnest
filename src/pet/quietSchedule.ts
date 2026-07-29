/**
 * Quiet-idle schedule — pure timing helpers (easy to verify).
 *
 * Spec:
 * - Natural blinks ~1.5–2s (renderer)
 * - Soft little actions every ~15–22s (PetApp)
 * - No flashy specials while idle
 */

export const QUIET_BLINK_MIN_MS = 1_400;
export const QUIET_BLINK_SPAN_MS = 700; // ~1.4–2.1s between blinks

/** Soft bounce / stretch / nod cadence */
export const SOFT_ACTION_MIN_MS = 14_000;
export const SOFT_ACTION_SPAN_MS = 8_000; // 14–22s

/** @deprecated alias — soft action replaces old minute fidget */
export const QUIET_FIDGET_MIN_MS = SOFT_ACTION_MIN_MS;
export const QUIET_FIDGET_SPAN_MS = SOFT_ACTION_SPAN_MS;

export type QuietEvent = "blink" | "fidget" | "soft";

export function randomBetween(minMs: number, spanMs: number, rand = Math.random): number {
  return minMs + Math.floor(rand() * spanMs);
}

export function nextBlinkDelayMs(rand = Math.random): number {
  return randomBetween(QUIET_BLINK_MIN_MS, QUIET_BLINK_SPAN_MS, rand);
}

export function nextSoftActionDelayMs(rand = Math.random): number {
  return randomBetween(SOFT_ACTION_MIN_MS, SOFT_ACTION_SPAN_MS, rand);
}

/** @deprecated use nextSoftActionDelayMs */
export function nextFidgetDelayMs(rand = Math.random): number {
  return nextSoftActionDelayMs(rand);
}

export function pickQuietEvent(
  now: number,
  nextBlinkAt: number,
  nextFidgetAt: number,
): QuietEvent {
  if (nextFidgetAt <= now && nextFidgetAt <= nextBlinkAt) return "soft";
  if (nextBlinkAt <= now) return "blink";
  return nextFidgetAt <= nextBlinkAt ? "soft" : "blink";
}

export function msUntilNext(
  now: number,
  nextBlinkAt: number,
  nextFidgetAt: number,
): number {
  return Math.max(0, Math.min(nextBlinkAt, nextFidgetAt) - now);
}
