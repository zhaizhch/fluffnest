import type { Personality } from "./types";

/** Pet roster — each entry is a unique named pet, grouped by category. */

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
}[] = [
  { id: "fluff", label: "毛绒小窝", blurb: "软软动物系" },
  { id: "companion", label: "人型伙伴", blurb: "桌边人型 / 法师魔女" },
  { id: "idol", label: "偶像舞台", blurb: "歌姬与偶像" },
  { id: "digi", label: "数码伙伴", blurb: "数码兽风" },
  { id: "fantasy", label: "奇幻旅人", blurb: "狐灵与旅法" },
  { id: "star", label: "星光卡卡", blurb: "卡卡系列" },
];

export const PET_CATALOG: PetDef[] = [
  // ── 毛绒小窝 ──
  {
    id: "mochi",
    name: "糯糯",
    category: "fluff",
    personality: "clingy",
    sprite: "/pets/butter-bear/spritesheet.webp",
    vibe: "黄油小熊 · 粘人",
    unlock: "default",
    rarity: "N",
  },
  {
    id: "milky",
    name: "咪可",
    category: "fluff",
    personality: "calm",
    sprite: "/pets/milk-tea-mouse/spritesheet.webp",
    vibe: "奶茶小鼠 · 安静",
    unlock: "default",
    rarity: "N",
  },
  {
    id: "cheese",
    name: "芝芝",
    category: "fluff",
    personality: "lively",
    sprite: "/pets/cheese-bear/spritesheet.webp",
    vibe: "芝士小熊 · 活泼",
    unlock: "login",
    rarity: "R",
  },
  {
    id: "axo",
    name: "波波",
    category: "fluff",
    personality: "clingy",
    sprite: "/pets/blue-boba-axolotl/spritesheet.webp",
    vibe: "蓝波波蝾螈 · 软萌",
    unlock: "shop",
    rarity: "R",
    shopPrice: 80,
  },
  {
    id: "cha",
    name: "茶茶",
    category: "fluff",
    personality: "calm",
    sprite: "/pets/blue-tea-cha/spritesheet.webp",
    vibe: "蓝茶精灵 · 治愈",
    unlock: "shop",
    rarity: "R",
    shopPrice: 90,
  },
  {
    id: "leo",
    name: "软狮",
    category: "fluff",
    personality: "lively",
    sprite: "/pets/leo-fluffy-lion/spritesheet.webp",
    spriteVersion: 2,
    vibe: "毛绒小狮 · 元气",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 120,
  },
  {
    id: "rising",
    name: "瑞星小狮子",
    category: "fluff",
    personality: "lively",
    render: "apng",
    vibe: "瑞星卡卡 · 原版动作 + 空间跳跃",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 128,
  },
  {
    id: "otta",
    name: "獭獭",
    category: "fluff",
    personality: "clingy",
    sprite: "/pets/boba/spritesheet.webp",
    spriteVersion: 2,
    vibe: "奶茶小獭 · 陪喝",
    unlock: "shop",
    rarity: "R",
    shopPrice: 95,
  },
  {
    id: "kebo",
    name: "柯宝",
    category: "fluff",
    personality: "lively",
    sprite: "/pets/kebo/spritesheet.webp",
    spriteVersion: 2,
    vibe: "考拉小管家 · 记账能量",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 130,
  },

  // ── 人型伙伴 ──
  {
    id: "bean",
    name: "子平波波",
    category: "companion",
    personality: "lively",
    sprite: "/pets/ziping-boba/spritesheet.webp",
    vibe: "Ziping Boba · 元气陪伴",
    unlock: "default",
    rarity: "N",
  },
  {
    id: "boba",
    name: "波波",
    category: "companion",
    personality: "calm",
    sprite: "/pets/boba-6/spritesheet.webp",
    vibe: "Boba · 温柔桌宠",
    unlock: "shop",
    rarity: "R",
    shopPrice: 110,
  },
  {
    id: "pearlcup",
    name: "珍珍",
    category: "companion",
    personality: "lively",
    sprite: "/pets/boba-2/spritesheet.webp",
    vibe: "珍珠奶茶杯 · 咕咚",
    unlock: "shop",
    rarity: "R",
    shopPrice: 85,
  },
  {
    id: "whitemage",
    name: "白魔法师",
    category: "companion",
    personality: "calm",
    sprite: "/pets/white-mage/spritesheet.webp",
    vibe: "White Mage · 温柔治疗",
    unlock: "default",
    rarity: "R",
  },
  {
    id: "violetmage",
    name: "紫发法师",
    category: "companion",
    personality: "calm",
    sprite: "/pets/violet-mage/spritesheet.webp",
    vibe: "Violet Mage · 紫发持杖",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 140,
  },
  {
    id: "crystmage",
    name: "晶角法师",
    category: "companion",
    personality: "calm",
    sprite: "/pets/mage/spritesheet.webp",
    vibe: "Arcane Mage · 晶角法袍",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 160,
  },
  {
    id: "broomwitch",
    name: "扫帚魔女",
    category: "companion",
    personality: "lively",
    sprite: "/pets/broom-witch/spritesheet.webp",
    vibe: "Broom Witch · 骑帚送信",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 140,
  },
  {
    id: "fiufiu",
    name: "菲菲",
    category: "companion",
    personality: "clingy",
    sprite: "/pets/fiufiu-witch/spritesheet.webp",
    vibe: "Fiufiu Witch · 古灵精怪",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 130,
  },
  {
    id: "fiufiu2",
    name: "菲菲·咒",
    category: "companion",
    personality: "clingy",
    sprite: "/pets/fiufiu-witch-2/spritesheet.webp",
    vibe: "Fiufiu Witch · 紫帽施法",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 135,
  },
  {
    id: "luna",
    name: "露娜",
    category: "companion",
    personality: "clingy",
    sprite: "/pets/codex-chibi/spritesheet.webp",
    vibe: "小助理 Luna · 会害羞会扫地",
    unlock: "default",
    rarity: "N",
  },
  {
    id: "amy",
    name: "艾米",
    category: "companion",
    personality: "lively",
    sprite: "/pets/amy-chibi/spritesheet.webp",
    vibe: "Amy Chibi · 想和你一起工作",
    unlock: "shop",
    rarity: "R",
    shopPrice: 95,
  },
  {
    id: "dreamgirl",
    name: "梦女孩",
    category: "companion",
    personality: "calm",
    sprite: "/pets/dream-girl/spritesheet.webp",
    vibe: "Dream Girl · 徽章西装",
    unlock: "shop",
    rarity: "R",
    shopPrice: 100,
  },
  {
    id: "nous",
    name: "诺斯",
    category: "companion",
    personality: "calm",
    sprite: "/pets/nous-girl/spritesheet.webp",
    vibe: "Nous Girl · 黑短发耳机",
    unlock: "shop",
    rarity: "R",
    shopPrice: 105,
  },
  {
    id: "mint",
    name: "薄荷丝",
    category: "companion",
    personality: "calm",
    sprite: "/pets/mint-girl/spritesheet.webp",
    spriteVersion: 2,
    vibe: "Mint Silk Girl · 薄荷绿长裙",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 150,
  },
  {
    id: "qgirl",
    name: "可爱女孩",
    category: "companion",
    personality: "clingy",
    sprite: "/pets/qgirl/spritesheet.webp",
    vibe: "双麻花辫 · 太阳发饰",
    unlock: "shop",
    rarity: "R",
    shopPrice: 90,
  },
  {
    id: "puppyhat",
    name: "小狗帽",
    category: "companion",
    personality: "clingy",
    sprite: "/pets/puppy-girl/spritesheet.webp",
    vibe: "Puppy Hat Girl · 小狗帽女孩",
    unlock: "login",
    rarity: "R",
  },
  {
    id: "chibigirl",
    name: "小可",
    category: "companion",
    personality: "lively",
    sprite: "/pets/chibigirl/spritesheet.webp",
    vibe: "ChibiGirl · Q版写真风",
    unlock: "shop",
    rarity: "R",
    shopPrice: 100,
  },
  {
    id: "hirose",
    name: "广濑",
    category: "companion",
    personality: "lively",
    sprite: "/pets/hirose/spritesheet.webp",
    vibe: "Hirose · 校园元气少年",
    unlock: "shop",
    rarity: "R",
    shopPrice: 110,
  },
  {
    id: "pinkribbon",
    name: "粉缎带",
    category: "companion",
    personality: "clingy",
    sprite: "/pets/pinkribbonchibi/spritesheet.webp",
    vibe: "Pink Ribbon Chibi · 黑发粉缎",
    unlock: "shop",
    rarity: "R",
    shopPrice: 105,
  },
  {
    id: "redcostume",
    name: "红装姑娘",
    category: "companion",
    personality: "calm",
    sprite: "/pets/classical-costume-girl/spritesheet.webp",
    vibe: "Classical Costume · 红装古典",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 145,
  },
  {
    id: "girlcat",
    name: "小女孩与猫",
    category: "companion",
    personality: "clingy",
    sprite: "/pets/little-girl-and-black-cat/spritesheet.webp",
    vibe: "Little Girl & Black Cat · 黄发带蓝裙",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 140,
  },
  {
    id: "moonbun",
    name: "月兔双髻",
    category: "companion",
    personality: "lively",
    sprite: "/pets/moon-bun-chibi/spritesheet.webp",
    vibe: "Moon Bun Chibi · 扇子双髻",
    unlock: "shop",
    rarity: "R",
    shopPrice: 115,
  },
  {
    id: "liney",
    name: "线线",
    category: "companion",
    personality: "calm",
    sprite: "/pets/liney/spritesheet.webp",
    vibe: "Liney · 长发线稿微笑",
    unlock: "shop",
    rarity: "R",
    shopPrice: 88,
  },
  {
    id: "turtleneck",
    name: "灰高领",
    category: "companion",
    personality: "calm",
    sprite: "/pets/ribbed-turtleneck-girl/spritesheet.webp",
    spriteVersion: 2,
    vibe: "Ribbed Turtleneck · 眼镜时尚",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 155,
  },
  {
    id: "kongirl",
    name: "轻音少女",
    category: "companion",
    personality: "lively",
    sprite: "/pets/k-on-girl/spritesheet.webp",
    vibe: "轻音少女 · 社团超Q版",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 130,
  },
  {
    id: "rima",
    name: "莉摩",
    category: "companion",
    personality: "lively",
    sprite: "/pets/blonde-schoolgirl-5/spritesheet.webp",
    vibe: "Mashiro Rima · 金发校服",
    unlock: "shop",
    rarity: "R",
    shopPrice: 120,
  },

  // ── 偶像舞台 ──
  {
    id: "cloud",
    name: "珍珠偶像",
    category: "idol",
    personality: "calm",
    sprite: "/pets/pearl-idol/spritesheet.webp",
    vibe: "Pearl Idol · Q版珍珠",
    unlock: "default",
    rarity: "N",
  },
  {
    id: "rose",
    name: "玫瑰偶像",
    category: "idol",
    personality: "clingy",
    sprite: "/pets/rose-idol/spritesheet.webp",
    vibe: "Rose Idol · 舞台甜酷",
    unlock: "shop",
    rarity: "R",
    shopPrice: 100,
  },
  {
    id: "pinky",
    name: "粉珍珠",
    category: "idol",
    personality: "clingy",
    sprite: "/pets/pearl-idol-pink/spritesheet.webp",
    vibe: "Pearl Idol Pink · 粉色",
    unlock: "login",
    rarity: "R",
  },
  {
    id: "miku",
    name: "初音",
    category: "idol",
    personality: "lively",
    sprite: "/pets/miku/spritesheet.webp",
    vibe: "Miku · 双马尾歌姬",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 140,
  },
  {
    id: "scallion",
    name: "葱葱初音",
    category: "idol",
    personality: "lively",
    sprite: "/pets/hatsune-miku/spritesheet.webp",
    vibe: "Hatsune Miku · 贴纸葱葱",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 160,
  },
  {
    id: "codey",
    name: "码音",
    category: "idol",
    personality: "calm",
    sprite: "/pets/mikucode/spritesheet.webp",
    vibe: "MikuCode · 耳机代码灵",
    unlock: "shop",
    rarity: "R",
    shopPrice: 120,
  },
  {
    id: "rosycoder",
    name: "玫音",
    category: "idol",
    personality: "clingy",
    sprite: "/pets/mikurose/spritesheet.webp",
    vibe: "MikuRose · 衔玫编码娘",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 145,
  },
  {
    id: "nako",
    name: "中野",
    category: "idol",
    personality: "calm",
    sprite: "/pets/nakano-miku/spritesheet.webp",
    vibe: "Nakano Miku · 粉发耳机",
    unlock: "shop",
    rarity: "R",
    shopPrice: 115,
  },

  // ── 数码伙伴 ──
  {
    id: "digibaby",
    name: "滚球兽",
    category: "digi",
    personality: "clingy",
    sprite: "/pets/digimon-baby/spritesheet.webp",
    vibe: "幼年期 · 圆滚滚",
    unlock: "default",
    rarity: "N",
  },
  {
    id: "agumon",
    name: "亚古兽",
    category: "digi",
    personality: "lively",
    sprite: "/pets/agumon/spritesheet.webp",
    vibe: "成长斯 · 小型火焰",
    unlock: "default",
    rarity: "R",
  },
  {
    id: "agumon2",
    name: "战斗亚古兽",
    category: "digi",
    personality: "lively",
    sprite: "/pets/agumon-2/spritesheet.webp",
    vibe: "战斗姿态 · 热血",
    unlock: "shop",
    rarity: "R",
    shopPrice: 100,
  },
  {
    id: "gabumon",
    name: "加布兽",
    category: "digi",
    personality: "calm",
    sprite: "/pets/gabumon/spritesheet.webp",
    vibe: "披狼皮 · 可靠搭档",
    unlock: "shop",
    rarity: "R",
    shopPrice: 100,
  },
  {
    id: "guilmon",
    name: "古拉兽",
    category: "digi",
    personality: "lively",
    sprite: "/pets/guilmon/spritesheet.webp",
    vibe: "红龙幼崽 · 暴食可爱",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 130,
  },
  {
    id: "veemon",
    name: "Ｖ仔兽",
    category: "digi",
    personality: "lively",
    sprite: "/pets/veemon/spritesheet.webp",
    vibe: "蓝色小龙 · 勇敢",
    unlock: "login",
    rarity: "R",
  },
  {
    id: "angemon",
    name: "天女兽",
    category: "digi",
    personality: "calm",
    sprite: "/pets/angemon/spritesheet.webp",
    vibe: "天使型 · 圣光",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 150,
  },
  {
    id: "kaizer",
    name: "帝皇龙甲兽",
    category: "digi",
    personality: "lively",
    sprite: "/pets/kaizergreymon/spritesheet.webp",
    vibe: "完全体 · 威风",
    unlock: "shop",
    rarity: "SSR",
    shopPrice: 220,
  },

  // ── 奇幻旅人 ──
  {
    id: "yinyue",
    name: "银月狐",
    category: "fantasy",
    personality: "calm",
    sprite: "/pets/yinyue-fox/spritesheet.webp",
    vibe: "Yinyue Fox · 清冷",
    unlock: "default",
    rarity: "R",
  },
  {
    id: "nightly",
    name: "夜行狐",
    category: "fantasy",
    personality: "calm",
    sprite: "/pets/nightly-fox/spritesheet.webp",
    vibe: "Nightly Fox · 神秘",
    unlock: "shop",
    rarity: "R",
    shopPrice: 110,
  },
  {
    id: "frieren",
    name: "芙莉莲",
    category: "fantasy",
    personality: "calm",
    sprite: "/pets/frieren-5/spritesheet.webp",
    vibe: "Frieren · 淡然旅法",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 150,
  },
  {
    id: "chibi",
    name: "小芙莉莲",
    category: "fantasy",
    personality: "clingy",
    sprite: "/pets/frieren-chibi/spritesheet.webp",
    vibe: "芙莉莲 · Q版贴纸",
    unlock: "login",
    rarity: "R",
  },
  {
    id: "silvertrail",
    name: "芙莉莲·杖",
    category: "fantasy",
    personality: "calm",
    sprite: "/pets/frieren-3/spritesheet.webp",
    vibe: "Frieren · 持杖旅人",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 155,
  },
  {
    id: "sleepmage",
    name: "芙莉莲·眠",
    category: "fantasy",
    personality: "calm",
    sprite: "/pets/frieren-4/spritesheet.webp",
    vibe: "Frieren · 慢悠悠",
    unlock: "shop",
    rarity: "R",
    shopPrice: 125,
  },

  // ── 星光卡卡 ──
  {
    id: "kaka",
    name: "卡卡",
    category: "star",
    personality: "lively",
    sprite: "/pets/kaka-2/spritesheet.webp",
    vibe: "粉色星铃 · 元气开场",
    unlock: "default",
    rarity: "N",
  },
  {
    id: "kaka5",
    name: "暖卡卡",
    category: "star",
    personality: "clingy",
    sprite: "/pets/kaka-5/spritesheet.webp",
    vibe: "暖色卡卡 · 软萌跟班",
    unlock: "shop",
    rarity: "R",
    shopPrice: 90,
  },
  {
    id: "kakastar",
    name: "咖咖星",
    category: "star",
    personality: "lively",
    sprite: "/pets/kaka-star/spritesheet.webp",
    vibe: "爱喝咖啡的黄星伙伴",
    unlock: "shop",
    rarity: "SR",
    shopPrice: 135,
  },
  {
    id: "kakadawang",
    name: "卡卡大王",
    category: "star",
    personality: "lively",
    sprite: "/pets/kaka-dawang/spritesheet.webp",
    vibe: "剪贴板大王 · 霸气可爱",
    unlock: "shop",
    rarity: "SSR",
    shopPrice: 210,
  },
  {
    id: "kakaqueen",
    name: "卡卡女王",
    category: "star",
    personality: "calm",
    sprite: "/pets/kaka-queen/spritesheet.webp",
    vibe: "冰雪剪贴板女王",
    unlock: "shop",
    rarity: "SSR",
    shopPrice: 200,
  },
];

const byId = new Map(PET_CATALOG.map((p) => [p.id, p]));

export function petDef(id: string): PetDef | undefined {
  return byId.get(id);
}

export function categoryLabel(id: PetCategoryId | string | undefined): string {
  if (!id) return "未分类";
  return PET_CATEGORIES.find((c) => c.id === id)?.label ?? String(id);
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
  let src = def.sprite ?? "/pets/butter-bear/spritesheet.webp";
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
