import type { PetCategoryId } from "./petCatalog";
import { petDef } from "./petCatalog";
import type { PetBehavior } from "./types";

export type ActionScope = "base" | "interact" | "special" | "exclusive";

export type CatalogAction = {
  id: PetBehavior;
  label: string;
  scope: ActionScope;
  durationMs: number;
  /** atlas / motion fallback */
  visual?: PetBehavior;
  bubbles?: string[];
  /** categories that prefer this action (weight boost) */
  favor?: PetCategoryId[];
};

export const BASE_ACTIONS: CatalogAction[] = [
  { id: "idle", label: "静静待着", scope: "base", durationMs: 4000 },
  { id: "walk", label: "踱步", scope: "base", durationMs: 4500 },
  { id: "sleep", label: "小憩", scope: "base", durationMs: 5000 },
  { id: "stretch", label: "伸懒腰", scope: "base", durationMs: 3200 },
  { id: "yawn", label: "打哈欠", scope: "base", durationMs: 2800 },
  { id: "wave", label: "招手", scope: "base", durationMs: 2800 },
  { id: "nod", label: "点头", scope: "base", durationMs: 2200 },
  { id: "sit", label: "坐下", scope: "base", durationMs: 4500 },
  { id: "drink", label: "喝水", scope: "base", durationMs: 4200 },
  { id: "look", label: "偷看你", scope: "base", durationMs: 2800 },
  { id: "cheer", label: "欢呼", scope: "base", durationMs: 2200 },
  { id: "spin", label: "转身", scope: "base", durationMs: 1400 },
  { id: "swing", label: "荡秋千", scope: "base", durationMs: 5200 },
  { id: "jump_rope", label: "跳绳", scope: "base", durationMs: 4200 },
  { id: "bow", label: "鞠躬", scope: "base", durationMs: 2800 },
  { id: "hum", label: "哼歌", scope: "base", durationMs: 3600 },
  { id: "dance", label: "小舞蹈", scope: "base", durationMs: 4000 },
  { id: "paint", label: "涂鸦", scope: "base", durationMs: 4200 },
  { id: "read", label: "静读", scope: "base", durationMs: 5000 },
  { id: "magic", label: "施法", scope: "base", durationMs: 3800 },
  { id: "tea", label: "品茶", scope: "base", durationMs: 4500 },
  { id: "soccer", label: "踢足球", scope: "base", durationMs: 4200 },
  { id: "phone", label: "看手机", scope: "base", durationMs: 4000 },
];

/** 全宠可做，但不同分类偏好不同 */
export const SPECIAL_ACTIONS: CatalogAction[] = [
  {
    id: "bubble",
    label: "吐泡泡",
    scope: "special",
    durationMs: 4200,
    favor: ["fluff", "companion", "idol"],
    bubbles: ["咕嘟…", "泡泡～", "吹一个给你。", "噗——"],
  },
  {
    id: "warp",
    label: "空间跳跃",
    scope: "special",
    durationMs: 2800,
    favor: ["digi", "fantasy", "star"],
    bubbles: ["咻！", "换个坐标。", "空间折叠～", "这边！"],
  },
  {
    id: "ultimate",
    label: "放大招",
    scope: "special",
    durationMs: 5200,
    favor: ["digi", "fantasy", "star", "companion"],
    bubbles: ["看招！", "全力一击！", "必杀——！", "轰！"],
  },
];

/** 分类专属动作：只有该分类宠物会自主使用 */
export const CATEGORY_EXCLUSIVES: Record<PetCategoryId, CatalogAction[]> = {
  fluff: [
    {
      id: "roll",
      label: "打滚",
      scope: "exclusive",
      durationMs: 3800,
      bubbles: ["咕噜噜～", "软软的地板！", "再滚一下。"],
    },
    {
      id: "bubble",
      label: "吐泡泡",
      scope: "exclusive",
      durationMs: 4200,
      bubbles: ["毛绒泡泡～", "呼——", "黏黏的。"],
    },
  ],
  companion: [
    {
      id: "wiggle",
      label: "扭扭腰",
      scope: "exclusive",
      durationMs: 3400,
      bubbles: ["陪你晃晃。", "嗯哼～", "要不要一起？"],
    },
    {
      id: "hex",
      label: "轻吟法术",
      scope: "exclusive",
      durationMs: 4200,
      bubbles: ["治愈一下。", "小法术。", "魔力汇聚。"],
    },
    {
      id: "bubble",
      label: "吐珍珠泡",
      scope: "exclusive",
      durationMs: 4000,
      bubbles: ["啵啵！", "奶茶味的泡。", "喝一口？"],
    },
  ],
  idol: [
    {
      id: "encore",
      label: "安可闪光",
      scope: "exclusive",
      durationMs: 4400,
      bubbles: ["Encore！", "看这边～", "谢幕一曲。", "闪闪的！"],
    },
    {
      id: "sparkle",
      label: "撒星光",
      scope: "exclusive",
      durationMs: 4000,
      bubbles: ["☆彡", "偶像光！", "为你打 call。"],
    },
  ],
  digi: [
    {
      id: "beam",
      label: "必杀光线",
      scope: "exclusive",
      durationMs: 4800,
      bubbles: ["Pepper Breath！", "能量充填…", "biu——！", "数码暴龙剑！"],
    },
    {
      id: "slash",
      label: "数码斩击",
      scope: "exclusive",
      durationMs: 4000,
      bubbles: ["看招！", "斩！", "喝！"],
    },
    {
      id: "warp",
      label: "数码传送",
      scope: "exclusive",
      durationMs: 2600,
      bubbles: ["传送门开！", "跳转坐标。", "滴嘟——"],
    },
    {
      id: "ultimate",
      label: "进化爆发",
      scope: "exclusive",
      durationMs: 5600,
      bubbles: ["进化——！", "完全体！", "超必杀！"],
    },
  ],
  fantasy: [
    {
      id: "hex",
      label: "吟唱咒文",
      scope: "exclusive",
      durationMs: 4600,
      bubbles: ["阿……拉……", "魔力汇聚。", "小咒术。", "Zoltraak…"],
    },
    {
      id: "float",
      label: "悬浮",
      scope: "exclusive",
      durationMs: 5000,
      bubbles: ["轻飘飘。", "重力？不熟。", "在云上。"],
    },
    {
      id: "warp",
      label: "法阵瞬移",
      scope: "exclusive",
      durationMs: 3000,
      bubbles: ["阵开。", "折跃。", "到了。"],
    },
  ],
  star: [
    {
      id: "sparkle",
      label: "撒星光",
      scope: "exclusive",
      durationMs: 4000,
      bubbles: ["星星打卡！", "✨", "卡卡能量～", "今日顺利。"],
    },
    {
      id: "ultimate",
      label: "星光爆发",
      scope: "exclusive",
      durationMs: 5200,
      bubbles: ["全员打卡！", "星光冲刺！", "卡卡必杀！"],
    },
    {
      id: "wiggle",
      label: "星星摇摆",
      scope: "exclusive",
      durationMs: 3200,
      bubbles: ["晃一晃。", "摸鱼中…", "嘿嘿。"],
    },
  ],
};

export const INTERACT_ACTIONS: CatalogAction[] = [
  { id: "pat", label: "轻拍", scope: "interact", durationMs: 1800 },
  { id: "poke", label: "戳戳", scope: "interact", durationMs: 1600 },
  { id: "hug", label: "抱抱", scope: "interact", durationMs: 2200 },
  { id: "tickle", label: "挠痒", scope: "interact", durationMs: 2000 },
  { id: "feed", label: "投喂", scope: "interact", durationMs: 2200 },
  { id: "play", label: "逗玩", scope: "interact", durationMs: 2400 },
  { id: "nuzzle", label: "蹭蹭", scope: "interact", durationMs: 2000 },
];

export const ALL_CATALOG_ACTIONS: CatalogAction[] = [
  ...BASE_ACTIONS,
  ...SPECIAL_ACTIONS,
  ...INTERACT_ACTIONS,
  // exclusives may duplicate special ids — dedupe by first wins in map build
  ...Object.values(CATEGORY_EXCLUSIVES).flat(),
];

const byId = new Map<string, CatalogAction>();
for (const a of ALL_CATALOG_ACTIONS) {
  if (!byId.has(a.id)) byId.set(a.id, a);
}
// Prefer exclusive bubble lines when looking up by id for a known category
export function getCatalogAction(
  id: string,
  category?: PetCategoryId,
): CatalogAction | undefined {
  if (category) {
    const ex = CATEGORY_EXCLUSIVES[category]?.find((a) => a.id === id);
    if (ex) return ex;
  }
  return byId.get(id);
}

const PERSONALITY_BIAS: Record<string, PetBehavior[]> = {
  calm: ["sit", "read", "tea", "phone", "yawn", "hex", "float", "look"],
  lively: [
    "dance",
    "soccer",
    "jump_rope",
    "cheer",
    "warp",
    "ultimate",
    "beam",
    "slash",
    "encore",
  ],
  clingy: ["look", "wave", "nuzzle", "bubble", "wiggle", "hum", "nod"],
};

const CATEGORY_BASE_BIAS: Record<PetCategoryId, PetBehavior[]> = {
  fluff: ["bubble", "roll", "sleep", "nuzzle", "swing"],
  companion: ["tea", "drink", "wiggle", "hex", "bubble", "magic"],
  idol: ["dance", "encore", "sparkle", "hum", "cheer", "bow"],
  digi: ["beam", "slash", "warp", "ultimate", "stretch", "cheer"],
  fantasy: ["hex", "float", "magic", "warp", "read"],
  star: ["sparkle", "ultimate", "wiggle", "phone", "cheer"],
};

/** Weighted idle pool for a specific pet (includes exclusives). */
export function idlePoolForPet(speciesId: string): PetBehavior[] {
  const def = petDef(speciesId);
  const category = def?.category ?? "fluff";
  const personality = def?.personality ?? "calm";

  const pool: PetBehavior[] = BASE_ACTIONS.filter(
    (a) => a.id !== "react",
  ).map((a) => a.id);

  // Always include specials
  for (const s of SPECIAL_ACTIONS) pool.push(s.id);

  // Category exclusives
  for (const ex of CATEGORY_EXCLUSIVES[category] ?? []) {
    if (!pool.includes(ex.id)) pool.push(ex.id);
  }

  // Weight: duplicate favored actions so pick() hits them more
  const weighted: PetBehavior[] = [...pool];
  for (const id of CATEGORY_BASE_BIAS[category] ?? []) {
    if (pool.includes(id)) weighted.push(id, id);
  }
  for (const id of PERSONALITY_BIAS[personality] ?? []) {
    if (pool.includes(id)) weighted.push(id);
  }
  for (const s of SPECIAL_ACTIONS) {
    if (s.favor?.includes(category)) weighted.push(s.id, s.id);
  }

  return weighted;
}

/** Exclusive-only actions for flourish / click inject */
export function exclusiveIdlePool(speciesId: string): PetBehavior[] {
  const def = petDef(speciesId);
  const category = def?.category ?? "fluff";
  const ids = (CATEGORY_EXCLUSIVES[category] ?? []).map((a) => a.id);
  // Also surface category-favored specials as "signature"
  const favored = SPECIAL_ACTIONS.filter((s) =>
    s.favor?.includes(category),
  ).map((s) => s.id);
  return [...new Set([...ids, ...favored])];
}

export function scopeLabel(scope: ActionScope): string {
  switch (scope) {
    case "base":
      return "基础";
    case "interact":
      return "互动";
    case "special":
      return "特技";
    case "exclusive":
      return "专属";
  }
}

export function allActionIds(): string[] {
  return [
    ...BASE_ACTIONS.map((a) => a.id),
    ...SPECIAL_ACTIONS.map((a) => a.id),
    ...INTERACT_ACTIONS.map((a) => a.id),
    "roll",
    "wiggle",
    "encore",
    "beam",
    "slash",
    "hex",
    "sparkle",
    "float",
    "react",
  ];
}

export function resolveVisualBehavior(behavior: string): PetBehavior {
  const cat = getCatalogAction(behavior);
  if (cat?.visual) return cat.visual;
  return behavior as PetBehavior;
}

/** @deprecated empty — kept for import compat */
export const SPECIES_ACTIONS: CatalogAction[] = [];
export const SKIN_ACTIONS: CatalogAction[] = [];
export function actionsForPet(speciesId?: string) {
  if (!speciesId) return ALL_CATALOG_ACTIONS;
  const def = petDef(speciesId);
  const category = def?.category ?? "fluff";
  return [
    ...BASE_ACTIONS,
    ...SPECIAL_ACTIONS,
    ...INTERACT_ACTIONS,
    ...(CATEGORY_EXCLUSIVES[category] ?? []),
  ];
}
