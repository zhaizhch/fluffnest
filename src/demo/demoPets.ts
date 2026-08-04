import type { Personality } from "../lib/types";

export type DemoPet = {
  id: string;
  name: string;
  personality: Personality;
  pack: string;
  vibe: string;
};

/** Lightweight roster for the static web try-on (no API / no Tauri). */
export const DEMO_PETS: DemoPet[] = [
  {
    id: "mochi",
    name: "糯糯",
    personality: "clingy",
    pack: "butter-bear",
    vibe: "黄油小熊 · 粘人",
  },
  {
    id: "milky",
    name: "咪可",
    personality: "calm",
    pack: "milk-tea-mouse",
    vibe: "奶茶小鼠 · 安静",
  },
  {
    id: "kebo",
    name: "柯宝",
    personality: "lively",
    pack: "kebo",
    vibe: "柯基宝宝 · 活泼",
  },
];

export function demoPetFromQuery(): DemoPet {
  const q = new URLSearchParams(window.location.search).get("pet");
  return DEMO_PETS.find((p) => p.id === q) ?? DEMO_PETS[0]!;
}
