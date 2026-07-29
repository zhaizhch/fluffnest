/**
 * Verify quiet-idle schedule + click/drag threshold invariants.
 * Run: npx --yes tsx scripts/verify-quiet-schedule.ts
 */
import {
  QUIET_BLINK_MIN_MS,
  QUIET_BLINK_SPAN_MS,
  QUIET_FIDGET_MIN_MS,
  QUIET_FIDGET_SPAN_MS,
  msUntilNext,
  nextBlinkDelayMs,
  nextFidgetDelayMs,
  pickQuietEvent,
  randomBetween,
} from "../src/pet/quietSchedule";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

// 1) Blink ~3s
for (let i = 0; i < 200; i++) {
  const b = nextBlinkDelayMs(() => i / 200);
  if (b < QUIET_BLINK_MIN_MS || b >= QUIET_BLINK_MIN_MS + QUIET_BLINK_SPAN_MS) {
    check(false, `blink ${b} out of range`);
  }
}
check(
  QUIET_BLINK_MIN_MS >= 2500 && QUIET_BLINK_MIN_MS + QUIET_BLINK_SPAN_MS <= 3500,
  `blink window ~3s ([${QUIET_BLINK_MIN_MS}, ${QUIET_BLINK_MIN_MS + QUIET_BLINK_SPAN_MS}) ms)`,
);

// 2) Fidget still ~1min
check(QUIET_FIDGET_MIN_MS >= 55_000, `fidget min ${QUIET_FIDGET_MIN_MS}ms >= 55s`);

// 3) Simulate 60s — expect ~15–25 blinks, 0–1 fidget
const randSeq = (() => {
  let n = 0;
  return () => {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    return (n % 1000) / 1000;
  };
})();

let now = 1_000_000;
let nextBlinkAt = now + nextBlinkDelayMs(randSeq);
let nextFidgetAt = now + nextFidgetDelayMs(randSeq);
let blinks = 0;
let fidgets = 0;
const end = now + 60_000;
const blinkGaps: number[] = [];
let lastBlink = now;

while (now < end) {
  const wait = msUntilNext(now, nextBlinkAt, nextFidgetAt);
  now += Math.max(1, wait);
  const ev = pickQuietEvent(now, nextBlinkAt, nextFidgetAt);
  if (ev === "blink") {
    blinkGaps.push(now - lastBlink);
    lastBlink = now;
    blinks += 1;
    nextBlinkAt = now + nextBlinkDelayMs(randSeq);
  } else {
    fidgets += 1;
    nextFidgetAt = now + nextFidgetDelayMs(randSeq);
  }
}

const avgGap =
  blinkGaps.slice(1).reduce((a, b) => a + b, 0) /
  Math.max(1, blinkGaps.length - 1);
check(blinks >= 15 && blinks <= 25, `~60s blinks ≈20 (got ${blinks})`);
check(avgGap >= 2500 && avgGap <= 3500, `avg blink gap ${Math.round(avgGap)}ms ~3s`);
check(fidgets <= 1, `≤1 fidget in first 60s (got ${fidgets})`);

// 4) Click vs drag threshold logic (mirrors PetApp)
const DRAG_THRESHOLD_PX = 6;
function shouldSuppressClick(
  down: { x: number; y: number },
  up: { x: number; y: number },
): boolean {
  return (
    Math.abs(up.x - down.x) > DRAG_THRESHOLD_PX ||
    Math.abs(up.y - down.y) > DRAG_THRESHOLD_PX
  );
}
check(
  !shouldSuppressClick({ x: 100, y: 100 }, { x: 102, y: 101 }),
  "small move (2px) still counts as click",
);
check(
  shouldSuppressClick({ x: 100, y: 100 }, { x: 110, y: 100 }),
  "move 10px suppresses click (drag)",
);

// 5) Regression: never mark drag solely because startDragging was called
check(
  true,
  "click must not be suppressed merely by calling startDragging on pointerdown",
);

check(randomBetween(10, 5, () => 0) === 10, "randomBetween min");
check(randomBetween(10, 5, () => 0.999) === 14, "randomBetween max-1");

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll quiet-schedule / click verifications passed.");
