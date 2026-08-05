import type { Personality } from "./types";

/** Pet roster — currently only 暖卡卡. */

export type PetCategoryId =
  | "fluff"
  | "companion"
  | "idol"
  | "digi"
  | "fantasy"
  | "star";

export type PetDef = {
  id: string;
  name: string;
  category: PetCategoryId;
  personality: Personality;
  /** Codex atlas path; omit when render is apng/svg */
  sprite?: string;
  spriteVersion?: number;
  /** Default sprite atlas; apng = Rising KaKa original animations */
  render?: "sprite" | "svg" | "apng";
  vibe: string;
  /** default = unlocked at start */
  unlock: "default" | "shop" | "login";
  rarity: "N" | "R" | "SR" | "SSR";
  shopPrice?: number;
};

export const PET_CATEGORIES: {
  id: PetCategoryId;
  label: string;
  blurb: string;
}[] = [{ id: "star", label: "星光卡卡", blurb: "暖卡卡" }];

export const PET_CATALOG: PetDef[] = [
  {
    id: "kaka5",
    name: "暖卡卡",
    category: "star",
    personality: "clingy",
    sprite: "/pets/kaka-5/spritesheet.webp",
    vibe: "暖色卡卡 · 软萌跟班",
    unlock: "default",
    rarity: "R",
  },
];

export function petDef(id: string): PetDef | undefined {
  return PET_CATALOG.find((p) => p.id === id);
}

export function categoryLabel(id: PetCategoryId): string {
  return PET_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function petsInCategory(category: PetCategoryId): PetDef[] {
  return PET_CATALOG.filter((p) => p.category === category);
}

export function defaultUnlockedIds(): string[] {
  return PET_CATALOG.filter((p) => p.unlock === "default").map((p) => p.id);
}

export function spriteFor(speciesId: string): {
  src: string;
  spriteVersionNumber?: number;
  label: string;
} {
  const def = petDef(speciesId) ?? PET_CATALOG[0]!;
  let src = def.sprite ?? "/pets/kaka-5/spritesheet.webp";
  // Injected by vite.demo.config when building the portable / GitHub try-on.
  const injected =
    typeof __FN_ASSET_BASE__ !== "undefined" ? __FN_ASSET_BASE__ : "";
  const prefix = String(injected || import.meta.env.VITE_PUBLIC_BASE || "").replace(
    /\/$/,
    "",
  );
  if (prefix === "." && src.startsWith("/")) {
    src = `.${src}`;
  } else if (prefix && src.startsWith("/")) {
    src = `${prefix}${src}`;
  }
  return {
    src,
    spriteVersionNumber: def.spriteVersion,
    label: def.name,
  };
}

export function usesCustomFigure(speciesId: string): boolean {
  const render = petDef(speciesId)?.render;
  return render === "svg" || render === "apng";
}

/** @deprecated use usesCustomFigure */
export function usesSvgFigure(speciesId: string): boolean {
  return usesCustomFigure(speciesId);
}
