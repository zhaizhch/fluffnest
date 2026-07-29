/**
 * Quiet-idle schedule — pure timing helpers (easy to verify).
 *
 * Spec:
 * - Stay mostly still (no chatter / no roam)
 * - Blink about every 3 seconds
 * - About once a minute: one small fidget
 */

export const QUIET_BLINK_MIN_MS = 2_800;
export const QUIET_BLINK_SPAN_MS = 500; // ~2.8–3.3s between blinks
export const QUIET_FIDGET_MIN_MS = 58_000;
export const QUIET_FIDGET_SPAN_MS = 10_000; // 58–68s per fidget cycle

export type QuietEvent = "blink" | "fidget";

export function randomBetween(minMs: number, spanMs: number, rand = Math.random): number {
  return minMs + Math.floor(rand() * spanMs);
}

export function nextBlinkDelayMs(rand = Math.random): number {
  return randomBetween(QUIET_BLINK_MIN_MS, QUIET_BLINK_SPAN_MS, rand);
}

export function nextFidgetDelayMs(rand = Math.random): number {
  return randomBetween(QUIET_FIDGET_MIN_MS, QUIET_FIDGET_SPAN_MS, rand);
}

/** Decide which quiet event is due next given deadlines. */
export function pickQuietEvent(
  now: number,
  nextBlinkAt: number,
  nextFidgetAt: number,
): QuietEvent {
  if (nextFidgetAt <= now && nextFidgetAt <= nextBlinkAt) return "fidget";
  if (nextBlinkAt <= now) return "blink";
  return nextFidgetAt <= nextBlinkAt ? "fidget" : "blink";
}

export function msUntilNext(
  now: number,
  nextBlinkAt: number,
  nextFidgetAt: number,
): number {
  return Math.max(0, Math.min(nextBlinkAt, nextFidgetAt) - now);
}
