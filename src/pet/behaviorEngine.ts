import type { PetBehavior } from "../lib/types";
import { ACTION_DEFS } from "../lib/types";
import { petDef } from "../lib/petCatalog";
import {
  exclusiveIdlePool,
  getCatalogAction,
} from "../lib/actions";

export type BehaviorStep = {
  behavior: PetBehavior;
  durationMs?: number;
  bubbleChance?: number;
  bubble?: string;
  move?: boolean;
  /** tiny window nudge for soft idle walks */
  moveTiny?: boolean;
  /** large teleport for warp */
  warp?: boolean;
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Soft blink while otherwise still — no dialogue, no movement. */
export function buildBlinkStep(): BehaviorStep {
  return {
    behavior: "look",
    durationMs: 380 + Math.floor(Math.random() * 180),
    bubbleChance: 0,
  };
}

/**
 * Small lively fidget — restored soft "蹦蹦跳跳", low frequency, short.
 * No bubbles, no warp/ultimate; walks only nudge the window a little.
 */
export function buildSoftIdleAction(speciesId: string): BehaviorStep[] {
  const personality = petDef(speciesId)?.personality ?? "calm";

  const tiny: PetBehavior[] = ["nod", "look", "yawn", "stretch", "wave", "sit"];
  const bounce: PetBehavior[] = [
    "stretch",
    "wave",
    "cheer",
    "spin",
    "jump_rope",
    "walk",
    "dance",
  ];

  let pool: PetBehavior[];
  if (personality === "lively") {
    pool = [...bounce, ...bounce, ...tiny];
  } else if (personality === "clingy") {
    pool = [...tiny, "look", "wave", "nuzzle", "nod", "walk"];
  } else {
    pool = [...tiny, "sit", "yawn", "stretch", "nod", "walk"];
  }

  const b = pick(pool);
  const short = 1100 + Math.floor(Math.random() * 900);
  const steps: BehaviorStep[] = [
    {
      behavior: b,
      durationMs: short,
      bubbleChance: 0.08,
      move: b === "walk",
      moveTiny: b === "walk",
    },
  ];

  // Occasional tiny two-step: action → brief idle settle
  if (Math.random() < 0.35) {
    steps.push({
      behavior: pick(["idle", "nod", "look"] as PetBehavior[]),
      durationMs: 600 + Math.floor(Math.random() * 500),
      bubbleChance: 0,
    });
  }

  return steps;
}

/** @deprecated alias */
export function buildMinuteFidget(speciesId: string): BehaviorStep {
  return buildSoftIdleAction(speciesId)[0]!;
}

/**
 * Soft idle routine for autonomous life.
 */
export function buildIdleRoutine(
  speciesId: string,
  _owned: Set<string>,
  _personality: string,
): BehaviorStep[] {
  return buildSoftIdleAction(speciesId);
}

/** Each click rolls a different multi-step reaction + dialogue. */
export function buildClickReaction(speciesId: string): {
  steps: BehaviorStep[];
  apiAction: "pat" | "poke" | "hug" | "tickle" | "play" | "feed";
} {
  const def = petDef(speciesId);
  const category = def?.category;
  const exclusives = exclusiveIdlePool(speciesId);

  const withTalk = (
    steps: BehaviorStep[],
    fallbackLine?: string,
  ): BehaviorStep[] => {
    const line =
      fallbackLine ??
      pick([
        pickClingyLine(),
        ...(getCatalogAction(steps[0]?.behavior ?? "idle", category)?.bubbles ??
          []),
      ]);
    return steps.map((s, i) =>
      i === 0
        ? { ...s, bubbleChance: 1, bubble: s.bubble ?? line }
        : { ...s, bubbleChance: Math.max(s.bubbleChance ?? 0, 0.55) },
    );
  };

  const recipes: {
    apiAction: "pat" | "poke" | "hug" | "tickle" | "play" | "feed";
    steps: BehaviorStep[];
  }[] = [
    {
      apiAction: "hug",
      steps: withTalk([
        { behavior: "spin", durationMs: 900 },
        { behavior: "hug", durationMs: 2200 },
        { behavior: "nuzzle", durationMs: 1600 },
      ]),
    },
    {
      apiAction: "pat",
      steps: withTalk([
        { behavior: "look", durationMs: 700 },
        { behavior: "pat", durationMs: 1600 },
        { behavior: "wave", durationMs: 1500 },
      ]),
    },
    {
      apiAction: "tickle",
      steps: withTalk([
        { behavior: "react", durationMs: 800 },
        { behavior: "tickle", durationMs: 1800 },
        { behavior: "dance", durationMs: 2000 },
      ]),
    },
    {
      apiAction: "poke",
      steps: withTalk([
        { behavior: "poke", durationMs: 1200 },
        { behavior: "cheer", durationMs: 1500 },
        { behavior: "nuzzle", durationMs: 1500 },
      ]),
    },
    {
      apiAction: "play",
      steps: withTalk([
        { behavior: "jump_rope", durationMs: 2400 },
        { behavior: "play", durationMs: 1800 },
        { behavior: "wave", durationMs: 1200 },
      ]),
    },
    {
      apiAction: "feed",
      steps: withTalk([
        { behavior: "cheer", durationMs: 1100 },
        { behavior: "drink", durationMs: 2400 },
        { behavior: "nuzzle", durationMs: 1500 },
      ]),
    },
    {
      apiAction: "play",
      steps: withTalk([
        { behavior: "bubble", durationMs: 3000 },
        { behavior: "cheer", durationMs: 1300 },
      ]),
    },
    {
      apiAction: "play",
      steps: withTalk([
        { behavior: "warp", durationMs: 2200, warp: true },
        { behavior: "wave", durationMs: 1300 },
      ]),
    },
  ];

  if (exclusives.length) {
    const ex = pick(exclusives);
    const cat = getCatalogAction(ex, category);
    recipes.push({
      apiAction: "hug",
      steps: withTalk(
        [
          { behavior: "look", durationMs: 700 },
          {
            behavior: ex,
            durationMs: cat?.durationMs ?? 3600,
            warp: ex === "warp",
            bubble: cat?.bubbles?.length ? pick(cat.bubbles) : undefined,
          },
          { behavior: "nuzzle", durationMs: 1400 },
        ],
        cat?.bubbles?.length ? pick(cat.bubbles) : undefined,
      ),
    });
    recipes.push({
      apiAction: "play",
      steps: withTalk(
        [
          {
            behavior: ex,
            durationMs: cat?.durationMs ?? 3600,
            warp: ex === "warp",
            bubble: cat?.bubbles?.length ? pick(cat.bubbles) : undefined,
          },
          { behavior: "cheer", durationMs: 1300 },
        ],
        cat?.bubbles?.length ? pick(cat.bubbles) : undefined,
      ),
    });
    if (exclusives.includes("ultimate")) {
      const ult = getCatalogAction("ultimate", category);
      recipes.push({
        apiAction: "play",
        steps: withTalk(
          [
            { behavior: "stretch", durationMs: 800 },
            {
              behavior: "ultimate",
              durationMs: ult?.durationMs ?? 4800,
              bubble: ult?.bubbles?.length ? pick(ult.bubbles) : "看招！",
            },
            { behavior: "bow", durationMs: 1400 },
          ],
          ult?.bubbles?.length ? pick(ult.bubbles) : "看招！",
        ),
      });
    }
  }

  return pick(recipes);
}

export const CLINGY_LINES = [
  "终于点我了…",
  "我就在这儿哦。",
  "再理理我？",
  "想你啦。",
  "贴贴～",
  "不要只顾着工作嘛。",
  "哼，装作没看见？",
  "抱一下好不好。",
  "我等你好久了。",
  "嘿嘿，被抓到了。",
  "看我看我！",
  "再点一次嘛。",
  "陪你一会儿就好。",
  "你手好暖。",
  "今天也要黏着你。",
];

export function pickClingyLine(): string {
  return pick(CLINGY_LINES);
}

export function stepDuration(step: BehaviorStep): number {
  return (
    step.durationMs ??
    getCatalogAction(step.behavior)?.durationMs ??
    ACTION_DEFS[step.behavior]?.durationMs ??
    3000
  );
}
