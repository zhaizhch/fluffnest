/** Bond relationship tiers — dialogue / idle bias only (no currency gifts). */

export type BondTierId = 0 | 1 | 2 | 3 | 4;

export type BondTier = {
  id: BondTierId;
  minBond: number;
  label: string;
  lines: string[];
  /** Behaviors weighted into soft idle at this tier. */
  idleBias: string[];
};

export const BOND_TIERS: BondTier[] = [
  {
    id: 0,
    minBond: 0,
    label: "初识",
    lines: ["你好呀…", "第一次见面。", "我会乖乖待着。"],
    idleBias: ["look", "nod", "sit"],
  },
  {
    id: 1,
    minBond: 20,
    label: "熟悉",
    lines: ["又见面了。", "今天也在忙吗？", "记得歇一会儿。"],
    idleBias: ["wave", "look", "nod", "stretch"],
  },
  {
    id: 2,
    minBond: 60,
    label: "好友",
    lines: ["嘿嘿，是你。", "陪我玩一会儿？", "你来啦，好开心。"],
    idleBias: ["wave", "cheer", "look", "nuzzle"],
  },
  {
    id: 3,
    minBond: 120,
    label: "挚友",
    lines: ["就知道你会来。", "贴贴～", "只想待在你旁边。", "再理理我？"],
    idleBias: ["nuzzle", "wave", "look", "cheer"],
  },
  {
    id: 4,
    minBond: 220,
    label: "心灵相通",
    lines: [
      "你手好暖。",
      "今天也要黏着你。",
      "有你在就够了。",
      "别走太远哦。",
    ],
    idleBias: ["nuzzle", "wave", "look", "cheer"],
  },
];

export function tierFromBond(bond: number): BondTier {
  let current = BOND_TIERS[0]!;
  for (const t of BOND_TIERS) {
    if (bond >= t.minBond) current = t;
  }
  return current;
}

export function nextTier(bond: number): BondTier | null {
  const cur = tierFromBond(bond);
  return BOND_TIERS.find((t) => t.id === ((cur.id + 1) as BondTierId)) ?? null;
}

/** Progress 0–1 toward next tier (1 if maxed). */
export function nextTierProgress(bond: number): {
  current: BondTier;
  next: BondTier | null;
  ratio: number;
  label: string;
} {
  const current = tierFromBond(bond);
  const next = nextTier(bond);
  if (!next) {
    return {
      current,
      next: null,
      ratio: 1,
      label: `${current.label} · ${bond}`,
    };
  }
  const span = next.minBond - current.minBond;
  const into = bond - current.minBond;
  const ratio = span <= 0 ? 1 : Math.min(1, Math.max(0, into / span));
  return {
    current,
    next,
    ratio,
    label: `${current.label} · ${bond}/${next.minBond}`,
  };
}

/** Highest tier crossed when bond moves from `before` to `after` (or null). */
export function crossedTier(before: number, after: number): BondTier | null {
  if (after <= before) return null;
  let crossed: BondTier | null = null;
  for (const t of BOND_TIERS) {
    if (t.id === 0) continue;
    if (before < t.minBond && after >= t.minBond) crossed = t;
  }
  return crossed;
}

export function pickTierLine(bond: number, rand = Math.random): string {
  const tier = tierFromBond(bond);
  const i = Math.floor(rand() * tier.lines.length);
  return tier.lines[i] ?? tier.lines[0]!;
}

/** Soft-idle bubble chance scales mildly with bond. */
export function softBubbleChance(bond: number): number {
  const id = tierFromBond(bond).id;
  return 0.06 + id * 0.035;
}
