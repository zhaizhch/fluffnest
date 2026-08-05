import {
  PET_CATALOG,
  PET_CATEGORIES,
  type PetCategoryId,
  petDef,
} from "./petCatalog";
import type { PetInstance } from "./types";

export type DexBadge = "none" | "half" | "complete";

export type CategoryDexProgress = {
  categoryId: PetCategoryId;
  label: string;
  unlocked: number;
  total: number;
  badge: DexBadge;
  badgeLabel: string | null;
};

export function badgeForRatio(unlocked: number, total: number): DexBadge {
  if (total <= 0) return "none";
  if (unlocked >= total) return "complete";
  if (unlocked / total >= 0.5) return "half";
  return "none";
}

export function badgeLabel(badge: DexBadge): string | null {
  if (badge === "complete") return "集齐";
  if (badge === "half") return "半收录";
  return null;
}

export function categoryDexProgress(
  pets: PetInstance[],
): CategoryDexProgress[] {
  return PET_CATEGORIES.map((cat) => {
    const inCat = pets.filter(
      (p) => petDef(p.speciesId)?.category === cat.id,
    );
    const unlocked = inCat.filter((p) => p.unlocked).length;
    const total = inCat.length;
    const badge = badgeForRatio(unlocked, total);
    return {
      categoryId: cat.id,
      label: cat.label,
      unlocked,
      total,
      badge,
      badgeLabel: badgeLabel(badge),
    };
  });
}

export function overallDexProgress(pets: PetInstance[]): {
  unlocked: number;
  total: number;
} {
  const unlocked = pets.filter((p) => p.unlocked).length;
  return { unlocked, total: PET_CATALOG.length };
}

/** Human-readable unlock hint for locked pets. */
export function unlockSourceLabel(speciesId: string): string {
  const d = petDef(speciesId);
  if (!d) return "未解锁";
  if (d.unlock === "default") return "默认解锁";
  return "未解锁";
}
