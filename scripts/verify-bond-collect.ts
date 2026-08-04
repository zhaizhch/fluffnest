/**
 * Verify bond tiers + daily reward mirror stay aligned with product rules.
 * Run: npx --yes tsx scripts/verify-bond-collect.ts
 */
import {
  BOND_TIERS,
  TIER_COIN_GIFTS,
  crossedTier,
  nextTierProgress,
  softBubbleChance,
  tierFromBond,
} from "../src/lib/bondTiers";
import {
  DAILY_PET_ALREADY_OWNED_COIN,
  rewardForStreak,
  weekRewardPreview,
} from "../src/lib/dailyRewards";
import { badgeForRatio, badgeLabel } from "../src/lib/dexProgress";
import {
  CHECKIN_ENERGY_COST,
  DAILY_BOND_CAP,
  INTERACT_ENERGY_COST,
} from "../src/lib/careRules";

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
  check(cur.coinGift === TIER_COIN_GIFTS[cur.id], `coin gift tier ${cur.id}`);
}
check(tierFromBond(0).label === "初识", "bond 0 → 初识");
check(tierFromBond(20).label === "熟悉", "bond 20 → 熟悉");
check(tierFromBond(60).label === "好友", "bond 60 → 好友");
check(tierFromBond(120).label === "挚友", "bond 120 → 挚友");
check(tierFromBond(220).label === "心灵相通", "bond 220 → 心灵相通");
check(crossedTier(19, 20)?.id === 1, "cross into 熟悉");
check(crossedTier(59, 62)?.id === 2, "cross into 好友");
check(crossedTier(20, 21) === null, "no cross within tier");
check(nextTierProgress(220).ratio === 1, "max tier progress full");
check(softBubbleChance(0) < softBubbleChance(220), "bubble chance scales");

// Dex badges
check(badgeForRatio(0, 10) === "none", "0/10 none");
check(badgeForRatio(5, 10) === "half", "5/10 half");
check(badgeForRatio(10, 10) === "complete", "10/10 complete");
check(badgeLabel("complete") === "集齐", "complete label");
check(badgeLabel("half") === "半收录", "half label");

// Daily rewards mirror Rust (day cycle + pet ids)
const expectedPets: Record<number, string> = {
  2: "cheese",
  4: "pinky",
  5: "veemon",
  6: "puppyhat",
  7: "chibi",
};
for (const day of [1, 2, 3, 4, 5, 6, 7] as const) {
  const r = rewardForStreak(day);
  check(r.day === day, `streak day ${day} → day ${r.day}`);
  if (expectedPets[day]) {
    check(
      r.kind === "pet" && r.targetId === expectedPets[day],
      `day ${day} pet ${expectedPets[day]}`,
    );
  } else {
    check(r.kind === "coin", `day ${day} coin`);
  }
}
check(rewardForStreak(4).label.includes("粉珍珠"), "pinky label 粉珍珠");
check(rewardForStreak(9).day === 2, "streak 9 wraps to day 2");
check(weekRewardPreview().length === 7, "week preview length 7");
check(DAILY_PET_ALREADY_OWNED_COIN === 80, "owned-pet fallback coin 80");

check(DAILY_BOND_CAP === 30, "daily bond cap 30");
check(CHECKIN_ENERGY_COST === 0, "energy system removed (check-in cost 0)");
check(INTERACT_ENERGY_COST.play === 0, "energy system removed (play cost 0)");
check(INTERACT_ENERGY_COST.feed === 0, "energy system removed (feed cost 0)");

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll bond/collect verifications passed.");
