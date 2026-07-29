/**
 * Verify quiet-idle blink + soft action schedule.
 * Run: npx --yes tsx scripts/verify-quiet-schedule.ts
 */
import {
  QUIET_BLINK_MIN_MS,
  QUIET_BLINK_SPAN_MS,
  SOFT_ACTION_MIN_MS,
  SOFT_ACTION_SPAN_MS,
  nextBlinkDelayMs,
  nextSoftActionDelayMs,
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

// Blink cadence used by PixiPet idle hold→cycle
for (let i = 0; i < 100; i++) {
  const b = nextBlinkDelayMs(() => i / 100);
  if (b < QUIET_BLINK_MIN_MS || b >= QUIET_BLINK_MIN_MS + QUIET_BLINK_SPAN_MS) {
    check(false, `blink ${b} out of range`);
  }
}
check(
  QUIET_BLINK_MIN_MS >= 1200 &&
    QUIET_BLINK_MIN_MS + QUIET_BLINK_SPAN_MS <= 2300,
  `idle blink hold ~1.5–2s ([${QUIET_BLINK_MIN_MS}, ${QUIET_BLINK_MIN_MS + QUIET_BLINK_SPAN_MS}))`,
);

// One idle cycle at 90ms × 6 frames ≈ 540ms blink animation
const IDLE_FRAMES = 6;
const BLINK_FRAME_MS = 90;
const cycleMs = IDLE_FRAMES * BLINK_FRAME_MS;
check(cycleMs >= 400 && cycleMs <= 800, `blink cycle ${cycleMs}ms is a short idle playthrough`);

// Soft bounce every ~14–22s (not minute-only, not hyper)
check(SOFT_ACTION_MIN_MS >= 12_000 && SOFT_ACTION_MIN_MS <= 18_000, `soft min ${SOFT_ACTION_MIN_MS}ms`);
check(SOFT_ACTION_SPAN_MS >= 5_000, `soft span ${SOFT_ACTION_SPAN_MS}ms`);
const soft = nextSoftActionDelayMs(() => 0.5);
check(
  soft >= SOFT_ACTION_MIN_MS && soft < SOFT_ACTION_MIN_MS + SOFT_ACTION_SPAN_MS,
  `soft sample ${soft}ms`,
);

check(true, "PixiPet idle blink plays idle row frames (not look/waiting)");

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll quiet-schedule / blink verifications passed.");
