import type { Personality } from "../lib/types";

export type DemoPet = {
  id: string;
  name: string;
  personality: Personality;
  pack: string;
  vibe: string;
};

/** Browser try-on — 暖卡卡 + Live2D cats. */
export const DEMO_PETS: DemoPet[] = [
  {
    id: "kaka5",
    name: "暖卡卡",
    personality: "clingy",
    pack: "kaka-5",
    vibe: "暖色卡卡 · 软萌跟班",
  },
  {
    id: "tororo",
    name: "とろろ",
    personality: "calm",
    pack: "tororo",
    vibe: "白猫 · Live2D",
  },
  {
    id: "hijiki",
    name: "ひじき",
    personality: "lively",
    pack: "hijiki",
    vibe: "黑猫 · Live2D",
  },
];

/** App features unlocked after download + your own LLM API key. */
export const DEMO_UNLOCK_FEATURES = [
  "AI 性格对话与闲聊",
  "天气卡片与防护建议",
  "科技 / 娱乐新闻速览",
  "今日运势",
  "喝水 / 久坐编舞提醒",
  "神经语音轮换播报",
  "多宠图鉴、小铺与养成",
  "桌面置顶、托盘与本地提醒",
] as const;

export function demoPetFromQuery(): DemoPet {
  const q = new URLSearchParams(window.location.search).get("pet");
  return DEMO_PETS.find((p) => p.id === q) ?? DEMO_PETS[0]!;
}
