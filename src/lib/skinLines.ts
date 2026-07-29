/**
 * Growth / skin visual packs — cute sprite lineages (PixiJS Codex atlas).
 * Growth = same lineage, different age packs. Skin = outfit/color variant pack + tint.
 */

import { normalizeGrowthStage, type GrowthStageId } from "./evolution";
import type { FacePack } from "./codexAtlas";

export type SkinAccessory =
  | "beret"
  | "strawberry_clip"
  | "hoodie"
  | "sunny_doll"
  | "dusk_feather"
  | "rain_umbrella"
  | "overalls"
  | "sport_band"
  | "apron"
  | "paintbrush"
  | "thick_glasses"
  | "book"
  | "sleep_cap"
  | "none";

export type SkinStyle = {
  skinId: string;
  speciesId: string;
  title: string;
  rarity: "N" | "R" | "SR" | "SSR";
  kinship: string;
  difference: string;
  accessories: SkinAccessory[];
  /** Optional same-lineage variant spritesheet */
  variant?: FacePack;
  tint?: { hue?: number; sat?: number; bright?: number };
};

export type StageVisual = {
  id: GrowthStageId;
  label: string;
  bodyScale: number;
  feature: number;
  upright: number;
};

export const STAGE_VISUAL: Record<GrowthStageId, StageVisual> = {
  egg: { id: "egg", label: "蛋", bodyScale: 0.72, feature: 0, upright: 0 },
  baby: { id: "baby", label: "幼体", bodyScale: 0.86, feature: 0.35, upright: 0.15 },
  teen: { id: "teen", label: "少年", bodyScale: 0.98, feature: 0.75, upright: 0.7 },
  adult: { id: "adult", label: "成年", bodyScale: 1.06, feature: 1, upright: 0.85 },
};

/**
 * Cute lineage packs (萌系精灵立绘).
 * mochi: 奶茶小动物线 · cloud: 偶像少女线 · bean: 毛绒狮子线 · ink: 狐巫精灵线
 */
export const AGE_FORMS: Record<string, Record<string, FacePack>> = {
  mochi: {
    egg: { src: "", label: "糯糯·蛋", isEgg: true },
    baby: { src: "/pets/butter-bear/spritesheet.webp", label: "糯糯·幼体" },
    teen: { src: "/pets/cheese-bear/spritesheet.webp", label: "糯糯·少年" },
    adult: { src: "/pets/milk-tea-mouse/spritesheet.webp", label: "糯糯·成年" },
  },
  cloud: {
    egg: { src: "", label: "朵朵·蛋", isEgg: true },
    baby: { src: "/pets/pearl-idol-pink/spritesheet.webp", label: "朵朵·幼体" },
    teen: { src: "/pets/pearl-idol/spritesheet.webp", label: "朵朵·少年" },
    adult: { src: "/pets/rose-idol/spritesheet.webp", label: "朵朵·成年" },
  },
  bean: {
    egg: { src: "", label: "豆豆·蛋", isEgg: true },
    baby: { src: "/pets/leo-fluffy-lion/spritesheet.webp", spriteVersionNumber: 2, label: "豆豆·幼体" },
    teen: { src: "/pets/kaka-2/spritesheet.webp", label: "豆豆·少年" },
    adult: { src: "/pets/kaka-star/spritesheet.webp", label: "豆豆·成年" },
  },
  ink: {
    egg: { src: "", label: "墨墨·蛋", isEgg: true },
    baby: { src: "/pets/yinyue-fox/spritesheet.webp", label: "墨墨·幼体" },
    teen: { src: "/pets/nightly-fox/spritesheet.webp", label: "墨墨·少年" },
    adult: { src: "/pets/fiufiu-witch/spritesheet.webp", label: "墨墨·成年" },
  },
};

export const SKIN_STYLES: Record<string, SkinStyle> = {
  "mochi-default": {
    skinId: "mochi-default",
    speciesId: "mochi",
    title: "糯糯·默认",
    rarity: "N",
    kinship: "还是糯糯",
    difference: "奶茶小熊日常立绘",
    accessories: ["none"],
  },
  "mochi-beret": {
    skinId: "mochi-beret",
    speciesId: "mochi",
    title: "糯糯·贝雷帽文艺",
    rarity: "R",
    kinship: "还是糯糯",
    difference: "芝士熊变体 + 暖调滤镜",
    variant: { src: "/pets/cheese-bear/spritesheet.webp", label: "糯糯·文艺" },
    accessories: ["beret"],
    tint: { hue: -8, sat: 1.05, bright: 1.04 },
  },
  "mochi-strawberry": {
    skinId: "mochi-strawberry",
    speciesId: "mochi",
    title: "糯糯·草莓发夹甜",
    rarity: "R",
    kinship: "还是糯糯",
    difference: "粉萌奶茶鼠 + 甜粉滤镜",
    variant: { src: "/pets/milk-tea-mouse/spritesheet.webp", label: "糯糯·甜" },
    accessories: ["strawberry_clip"],
    tint: { hue: 12, sat: 1.15, bright: 1.06 },
  },
  "mochi-hoodie": {
    skinId: "mochi-hoodie",
    speciesId: "mochi",
    title: "糯糯·卫衣街头",
    rarity: "SR",
    kinship: "还是糯糯",
    difference: "蓝波波蝾螈街头感 + 冷锐滤镜",
    variant: { src: "/pets/blue-boba-axolotl/spritesheet.webp", label: "糯糯·街头" },
    accessories: ["hoodie"],
    tint: { hue: -20, sat: 1.08, bright: 1.0 },
  },

  "cloud-default": {
    skinId: "cloud-default",
    speciesId: "cloud",
    title: "朵朵·默认",
    rarity: "N",
    kinship: "还是朵朵",
    difference: "珍珠偶像日常",
    accessories: ["none"],
  },
  "cloud-sunny": {
    skinId: "cloud-sunny",
    speciesId: "cloud",
    title: "朵朵·晴天娃娃",
    rarity: "R",
    kinship: "还是朵朵",
    difference: "粉珍珠偶像 + 晴空滤镜",
    variant: { src: "/pets/pearl-idol-pink/spritesheet.webp", label: "朵朵·晴天" },
    accessories: ["sunny_doll"],
    tint: { hue: 10, sat: 1.12, bright: 1.08 },
  },
  "cloud-dusk": {
    skinId: "cloud-dusk",
    speciesId: "cloud",
    title: "朵朵·黄昏橘羽",
    rarity: "SR",
    kinship: "还是朵朵",
    difference: "玫瑰偶像暮色造型",
    variant: { src: "/pets/rose-idol/spritesheet.webp", label: "朵朵·黄昏" },
    accessories: ["dusk_feather"],
    tint: { hue: -18, sat: 1.1, bright: 0.97 },
  },
  "cloud-rain": {
    skinId: "cloud-rain",
    speciesId: "cloud",
    title: "朵朵·雨天透明伞",
    rarity: "SR",
    kinship: "还是朵朵",
    difference: "中野系雨天安静造型",
    variant: { src: "/pets/nakano-miku/spritesheet.webp", label: "朵朵·雨天" },
    accessories: ["rain_umbrella"],
    tint: { hue: -6, sat: 0.88, bright: 1.02 },
  },

  "bean-default": {
    skinId: "bean-default",
    speciesId: "bean",
    title: "豆豆·默认",
    rarity: "N",
    kinship: "还是豆豆",
    difference: "毛绒小狮日常",
    accessories: ["none"],
  },
  "bean-gardener": {
    skinId: "bean-gardener",
    speciesId: "bean",
    title: "豆豆·背带裤园丁",
    rarity: "R",
    kinship: "还是豆豆",
    difference: "卡卡少年园丁绿调",
    variant: { src: "/pets/kaka-5/spritesheet.webp", label: "豆豆·园丁" },
    accessories: ["overalls"],
    tint: { hue: 32, sat: 1.1, bright: 1.03 },
  },
  "bean-sport": {
    skinId: "bean-sport",
    speciesId: "bean",
    title: "豆豆·运动发带",
    rarity: "R",
    kinship: "还是豆豆",
    difference: "运动活力滤镜",
    accessories: ["sport_band"],
    tint: { hue: 40, sat: 1.2, bright: 1.05 },
  },
  "bean-barista": {
    skinId: "bean-barista",
    speciesId: "bean",
    title: "豆豆·咖啡师围裙",
    rarity: "SR",
    kinship: "还是豆豆",
    difference: "星愿狮典礼造型",
    variant: { src: "/pets/kaka-star/spritesheet.webp", label: "豆豆·咖啡师" },
    accessories: ["apron"],
    tint: { hue: -8, sat: 0.95, bright: 1.0 },
  },

  "ink-default": {
    skinId: "ink-default",
    speciesId: "ink",
    title: "墨墨·默认",
    rarity: "N",
    kinship: "还是墨墨",
    difference: "银月狐日常",
    accessories: ["none"],
  },
  "ink-painter": {
    skinId: "ink-painter",
    speciesId: "ink",
    title: "墨墨·画家",
    rarity: "R",
    kinship: "还是墨墨",
    difference: "夜行狐画家气质",
    variant: { src: "/pets/nightly-fox/spritesheet.webp", label: "墨墨·画家" },
    accessories: ["paintbrush"],
    tint: { hue: 16, sat: 1.08, bright: 1.02 },
  },
  "ink-scholar": {
    skinId: "ink-scholar",
    speciesId: "ink",
    title: "墨墨·学者",
    rarity: "SR",
    kinship: "还是墨墨",
    difference: "紫罗兰法师学者造型",
    variant: { src: "/pets/violet-mage/spritesheet.webp", label: "墨墨·学者" },
    accessories: ["thick_glasses", "book"],
    tint: { hue: -10, sat: 0.92, bright: 1.0 },
  },
  "ink-pajamas": {
    skinId: "ink-pajamas",
    speciesId: "ink",
    title: "墨墨·睡衣",
    rarity: "R",
    kinship: "还是墨墨",
    difference: "白袍法师慵懒睡衣感",
    variant: { src: "/pets/white-mage/spritesheet.webp", label: "墨墨·睡衣" },
    accessories: ["sleep_cap"],
    tint: { hue: -22, sat: 0.82, bright: 0.96 },
  },
};

const LEGACY_SKIN: Record<string, string> = {
  "mochi-latte": "mochi-beret",
  "mochi-inkwash": "mochi-hoodie",
  "cloud-silk": "cloud-sunny",
  "bean-star": "bean-gardener",
  "ink-midnight": "ink-painter",
  "ink-sage": "ink-scholar",
  "bit-default": "ink-default",
  "bit-flame": "ink-painter",
};

export function migrateSkinId(skinId: string): string {
  return LEGACY_SKIN[skinId] ?? skinId;
}

export function getSkinStyle(skinId: string): SkinStyle | undefined {
  return SKIN_STYLES[migrateSkinId(skinId)];
}

export function getSkinIdentity(skinId: string) {
  const o = getSkinStyle(skinId);
  if (!o) return undefined;
  return {
    skinId: o.skinId,
    speciesId: o.speciesId,
    title: o.title,
    kinship: o.kinship,
    difference: o.difference,
  };
}

export function stageVisual(speciesId: string, stage: string): StageVisual {
  const id = normalizeGrowthStage(speciesId, stage);
  return STAGE_VISUAL[id];
}

export function skinsForSpecies(speciesId: string): SkinStyle[] {
  return Object.values(SKIN_STYLES).filter((s) => s.speciesId === speciesId);
}

export function resolveSkinFilter(skinId?: string): string | undefined {
  if (!skinId) return undefined;
  const tint = getSkinStyle(skinId)?.tint;
  if (!tint) return undefined;
  const parts: string[] = [];
  if (tint.hue != null) parts.push(`hue-rotate(${tint.hue}deg)`);
  if (tint.sat != null) parts.push(`saturate(${tint.sat})`);
  if (tint.bright != null) parts.push(`brightness(${tint.bright})`);
  return parts.length ? parts.join(" ") : undefined;
}

export function resolveFacePack(
  speciesId: string,
  stage: string,
  skinId?: string,
): FacePack {
  const forms = AGE_FORMS[speciesId];
  const id = normalizeGrowthStage(speciesId, stage);
  let base = forms?.[id];

  if (!base && forms) {
    base = forms.baby ?? forms.teen ?? Object.values(forms)[0];
  }

  if (!base) {
    return { src: "/pets/butter-bear/spritesheet.webp", label: "绒窝" };
  }

  if (base.isEgg) return base;

  const skin = skinId ? getSkinStyle(skinId) : undefined;
  // Growth pack wins for bean default; star/barista/gardener may override
  if (speciesId === "bean" && skin?.variant && skin.skinId !== "bean-sport") {
    return {
      ...skin.variant,
      label: `${base.label} · ${skin.title.replace(/^[^·]*·/, "").trim()}`,
    };
  }
  if (speciesId === "bean") return base;

  if (skin?.variant) {
    return {
      ...skin.variant,
      label: `${base.label} · ${skin.title.replace(/^[^·]*·/, "").trim()}`,
    };
  }
  return base;
}

/** @deprecated */
export const OUTFIT_STYLES = SKIN_STYLES;
export function getOutfitStyle(skinId: string) {
  return getSkinStyle(skinId);
}
