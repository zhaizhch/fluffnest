/**
 * Mirror of Rust `reward_for_streak` in state.rs — keep in sync.
 * Day = ((streak - 1) rem 7) + 1
 */

export type DailyRewardPreview = {
  day: number; // 1..7
  kind: "coin" | "pet";
  targetId: string;
  amount: number;
  label: string;
};

/** Coin fallback when daily pet reward is already unlocked (matches Rust). */
export const DAILY_PET_ALREADY_OWNED_COIN = 80;

export function rewardForStreak(streak: number): DailyRewardPreview {
  const day = ((((streak - 1) % 7) + 7) % 7) + 1;
  switch (day) {
    case 1:
      return {
        day,
        kind: "coin",
        targetId: "coin",
        amount: 40,
        label: "每日金币 ×40",
      };
    case 2:
      return {
        day,
        kind: "pet",
        targetId: "cheese",
        amount: 1,
        label: "解锁宠物·芝芝",
      };
    case 3:
      return {
        day,
        kind: "coin",
        targetId: "coin",
        amount: 60,
        label: "每日金币 ×60",
      };
    case 4:
      return {
        day,
        kind: "pet",
        targetId: "pinky",
        amount: 1,
        label: "解锁宠物·粉珍珠",
      };
    case 5:
      return {
        day,
        kind: "pet",
        targetId: "veemon",
        amount: 1,
        label: "解锁宠物·Ｖ仔兽",
      };
    case 6:
      return {
        day,
        kind: "pet",
        targetId: "puppyhat",
        amount: 1,
        label: "解锁宠物·小狗帽",
      };
    default:
      return {
        day: 7,
        kind: "pet",
        targetId: "chibi",
        amount: 1,
        label: "解锁宠物·小芙莉莲",
      };
  }
}

/** Preview for a fixed week cycle (days 1–7). */
export function weekRewardPreview(): DailyRewardPreview[] {
  return [1, 2, 3, 4, 5, 6, 7].map((d) => rewardForStreak(d));
}
