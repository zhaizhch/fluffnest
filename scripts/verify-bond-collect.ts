/**
 * Verify bond tiers stay aligned with product rules.
 * Run: npx --yes tsx scripts/verify-bond-collect.ts
 */
import {
  BOND_TIERS,
  crossedTier,
  nextTierProgress,
  softBubbleChance,
  tierFromBond,
} from "../src/lib/bondTiers";
import { badgeForRatio, badgeLabel } from "../src/lib/dexProgress";
import { DAILY_BOND_CAP } from "../src/lib/careRules";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

// Bond tiers monotonic
for (let i = 1; i < BOND_TIERS.length; i++) {
  const prev = BOND_TIERS[i - 1]!;
  const cur = BOND_TIERS[i]!;
  check(cur.minBond > prev.minBond, `tier ${cur.id} minBond > ${prev.id}`);
}

check(tierFromBond(0).id === 0, "bond 0 → 初识");
check(tierFromBond(20).id === 1, "bond 20 → 熟悉");
check(tierFromBond(220).id === 4, "bond 220 → 心灵相通");
check(crossedTier(19, 20)?.id === 1, "cross into 熟悉");
check(crossedTier(20, 25) === null, "no cross within tier");
check(nextTierProgress(20).next?.id === 2, "next after 熟悉 is 好友");
check(softBubbleChance(0) < softBubbleChance(220), "bubble chance rises with bond");
check(DAILY_BOND_CAP === 30, "daily bond cap 30");
check(badgeForRatio(1, 1) === "complete", "dex complete");
check(badgeLabel("half") === "半收录", "half badge label");

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall checks passed");
