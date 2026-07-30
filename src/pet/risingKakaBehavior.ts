/**
 * Rising KaKa (瑞星小狮子) — original action timings & idle schedule.
 * Durations from rwv/Rising-KaKa metadata (frameCount / frameRate).
 * The only FluffNest-only addition is occasional 空间跳跃 (warp).
 */

export type RisingStep = {
  action: string;
  durationMs: number;
  /** Project-only: teleport window mid-step */
  warp?: boolean;
};

/** One full play-through of each APNG (ms). */
export const RISING_ACTION_MS: Record<string, number> = {
  smog: 750,
  StopDrag: 750,
  hidden: 2000,
  fallback: 667,
  StopScan: 833,
  showup: 1167,
  Sleeping: 1750,
  Ignorev: 2000,
  RbtnClk: 1417,
  Findv: 3250,
  Dragging: 667,
  StaFindv: 1250,
  Bye: 1333,
  Scanning: 1083,
  Deletef: 3333,
  StaSleep: 1500,
  dialog: 2083,
  hiding: 2167,
  StoSleep: 583,
  Gally: 1625,
  Stand: 3250,
  StoFindv: 1167,
  DblClk: 1000,
  Eatwm: 3333,
  hands: 1417,
  Killv: 1750,
  vanish: 833,
  Hello: 2000,
  StatDrag: 708,
  StarScan: 750,
};

export function risingDuration(action: string, fallback = 1500): number {
  return RISING_ACTION_MS[action] ?? fallback;
}

function pickWeighted(
  items: { action: string; weight: number }[],
  rand: () => number,
): string {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.action;
  }
  return items[items.length - 1]!.action;
}

/** Sleep cycle: 躺下 → 打呼噜循环 → 起来 → 站立 */
export function buildRisingSleepCycle(rand = Math.random): RisingStep[] {
  const loops = 4 + Math.floor(rand() * 5); // ~7–16s snoring
  return [
    { action: "StaSleep", durationMs: risingDuration("StaSleep") },
    {
      action: "Sleeping",
      durationMs: risingDuration("Sleeping") * loops,
    },
    { action: "StoSleep", durationMs: risingDuration("StoSleep") },
    { action: "Stand", durationMs: risingDuration("Stand") },
  ];
}

/** Project-only warp, using original showup/smog visuals. */
export function buildRisingWarp(rand = Math.random): RisingStep[] {
  void rand;
  return [
    { action: "showup", durationMs: risingDuration("showup") },
    { action: "smog", durationMs: risingDuration("smog"), warp: true },
    { action: "Stand", durationMs: risingDuration("Stand") },
  ];
}

/**
 * Autonomous beat — original KaKa repertoire only (+ rare warp).
 * No FluffNest walk/cheer/spin mapping.
 */
export function buildRisingIdleAction(rand = Math.random): RisingStep[] {
  const roll = rand();

  // ~8% — only FluffNest-exclusive: 空间跳跃
  if (roll < 0.08) return buildRisingWarp(rand);

  // ~18% — classic sleep + snore
  if (roll < 0.26) return buildRisingSleepCycle(rand);

  // ~12% — stand still one cycle (default breathing idle)
  if (roll < 0.38) {
    return [{ action: "Stand", durationMs: risingDuration("Stand") }];
  }

  const action = pickWeighted(
    [
      { action: "Gally", weight: 28 },
      { action: "Hello", weight: 16 },
      { action: "Eatwm", weight: 12 },
      { action: "hands", weight: 10 },
      { action: "dialog", weight: 8 },
      { action: "Scanning", weight: 6 },
      { action: "StarScan", weight: 5 },
      { action: "Findv", weight: 4 },
      { action: "Killv", weight: 3 },
      { action: "Ignorev", weight: 3 },
      { action: "Bye", weight: 3 },
      { action: "Deletef", weight: 2 },
    ],
    rand,
  );

  return [
    { action, durationMs: risingDuration(action) },
    { action: "Stand", durationMs: risingDuration("Stand") * (0.5 + rand() * 0.5) },
  ];
}

export function buildRisingClickAction(): RisingStep[] {
  return [
    { action: "DblClk", durationMs: risingDuration("DblClk") },
    { action: "Stand", durationMs: risingDuration("Stand") * 0.6 },
  ];
}

export function buildRisingFocusSleep(): RisingStep[] {
  return [
    { action: "StaSleep", durationMs: risingDuration("StaSleep") },
    { action: "Sleeping", durationMs: 15_000 },
  ];
}

/** Cadence between autonomous Rising actions (~5–10s). */
export function nextRisingActionDelayMs(rand = Math.random): number {
  return 5_000 + Math.floor(rand() * 5_000);
}
