/**
 * Growth (方案 v1 §3.1.5 / §3.2)
 * 同一个生命在成长：egg → baby → teen → adult
 * 允许：体型比例、姿态、特征按比例发育
 * 禁止：换物种、仅等比缩放、核心识别点消失
 */

export type GrowthStageId = "egg" | "baby" | "teen" | "adult";

export type GrowthStage = {
  id: GrowthStageId;
  label: string;
  /** 亲密度门槛 */
  bond: number;
  /** 陪伴天数门槛（与 bond 同时满足才解锁） */
  days: number;
  /** 相对体型（用于布局，非唯一视觉差异） */
  scale: number;
  /** 该阶段姿态简述 */
  pose: string;
};

export type GrowthPath = {
  title: string;
  blurb: string;
  /** 全程保持的核心识别点 */
  identity: string;
  stages: GrowthStage[];
};

/** 全宠统一四阶段；文案按物种区分（同一角色成长）。 */
const STAGES: GrowthStage[] = [
  {
    id: "egg",
    label: "蛋",
    bond: 0,
    days: 0,
    scale: 0.72,
    pose: "蛋壳孕育",
  },
  {
    id: "baby",
    label: "幼体",
    bond: 20,
    days: 0,
    scale: 0.86,
    pose: "趴坐 / 探头",
  },
  {
    id: "teen",
    label: "少年",
    bond: 100,
    days: 3,
    scale: 1,
    pose: "能站立 / 特征更分明",
  },
  {
    id: "adult",
    label: "成年",
    bond: 260,
    days: 7,
    scale: 1.08,
    pose: "成熟姿态 / 气质沉淀",
  },
];

export const GROWTH_PATHS: Record<string, GrowthPath> = {
  mochi: {
    title: "糯糯成长线",
    blurb: "奶茶小动物：毛绒蛋 → 黄油熊宝宝 → 芝士熊少年 → 奶茶鼠成年（同系更萌）",
    identity: "圆润体态 · 大眼 · 奶茶色暖调",
    stages: STAGES,
  },
  cloud: {
    title: "朵朵成长线",
    blurb: "珍珠偶像：云彩蛋 → 粉珍珠幼体 → 珍珠少年 → 玫瑰偶像成年",
    identity: "偶像发型 · 珍珠配饰 · 柔粉气质",
    stages: STAGES,
  },
  bean: {
    title: "豆豆成长线",
    blurb: "毛绒小狮：豆荚蛋 → 软狮幼崽 → 卡卡少年 → 星愿狮成年",
    identity: "狮耳狮尾 · 星铃 · 元气表情",
    stages: STAGES,
  },
  ink: {
    title: "墨墨成长线",
    blurb: "狐巫精灵：墨瓶蛋 → 银月狐宝宝 → 夜行狐少年 → 魔女成年",
    identity: "狐耳 · 柔软毛色 · 略呆眼神",
    stages: STAGES,
  },
};

/** 旧存档阶段 id → 方案标准 id */
const LEGACY_STAGE: Record<string, GrowthStageId> = {
  egg: "egg",
  infant: "egg",
  baby: "baby",
  pup: "baby",
  child: "teen",
  juvenile: "teen",
  rookie: "teen",
  teen: "teen",
  youth: "teen",
  mature: "adult",
  prime: "adult",
  champion: "adult",
  adult: "adult",
  apex: "adult",
  mega: "adult",
  ultimate: "adult",
};

export function growthPathFor(speciesId: string): GrowthPath {
  return GROWTH_PATHS[speciesId] ?? GROWTH_PATHS.mochi!;
}

export function normalizeGrowthStage(
  _speciesId: string,
  stage: string,
): GrowthStageId {
  return LEGACY_STAGE[stage] ?? "egg";
}

export function stageMeta(speciesId: string, stage: string): GrowthStage {
  const path = growthPathFor(speciesId);
  const id = normalizeGrowthStage(speciesId, stage);
  return path.stages.find((s) => s.id === id) ?? path.stages[0]!;
}

/** 亲密度 + 陪伴天数共同决定最高可解锁阶段 */
export function stageFromProgress(
  speciesId: string,
  bond: number,
  companionDays = 0,
): GrowthStageId {
  const path = growthPathFor(speciesId);
  let id: GrowthStageId = path.stages[0]!.id;
  for (const s of path.stages) {
    if (bond >= s.bond && companionDays >= s.days) id = s.id;
  }
  return id;
}

/** @deprecated 仅 bond；优先用 stageFromProgress */
export function stageFromBond(speciesId: string, bond: number): string {
  return stageFromProgress(speciesId, bond, 999);
}

export function stageRank(speciesId: string, stage: string): number {
  const path = growthPathFor(speciesId);
  const id = normalizeGrowthStage(speciesId, stage);
  const idx = path.stages.findIndex((s) => s.id === id);
  return idx < 0 ? 0 : idx;
}

export function stageUnlocked(
  speciesId: string,
  bond: number,
  stage: string,
  companionDays = 999,
): boolean {
  return (
    stageRank(speciesId, stage) <=
    stageRank(speciesId, stageFromProgress(speciesId, bond, companionDays))
  );
}

export function nextGrowthStage(
  speciesId: string,
  bond: number,
  companionDays = 0,
): { label: string; need: number; needDays?: number } | null {
  const path = growthPathFor(speciesId);
  for (const s of path.stages) {
    if (bond < s.bond || companionDays < s.days) {
      return {
        label: s.label,
        need: Math.max(0, s.bond - bond),
        needDays: Math.max(0, s.days - companionDays),
      };
    }
  }
  return null;
}

export function stageLabel(speciesId: string, stage: string): string {
  return stageMeta(speciesId, stage).label;
}

export function companionDaysFrom(hatchedAt?: string | null): number {
  if (!hatchedAt) return 0;
  const t = Date.parse(hatchedAt);
  if (Number.isNaN(t)) return 0;
  const ms = Date.now() - t;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** @deprecated */
export const EVOLUTION_THRESHOLDS = STAGES.map((s) => ({
  stage: s.id,
  bond: s.bond,
  label: s.label,
}));
