import type { Personality } from "./types";

export type PersonalityOption = {
  id: Personality;
  label: string;
  hint: string;
};

/** All switchable pet personalities. */
export const PERSONALITIES: PersonalityOption[] = [
  { id: "calm", label: "安静型", hint: "温柔克制，话不多" },
  { id: "lively", label: "活泼型", hint: "开朗俏皮，爱闹腾" },
  { id: "clingy", label: "黏人型", hint: "软软撒娇，求关注" },
  { id: "tsundere", label: "傲娇型", hint: "口是心非，嘴硬心软" },
  { id: "clever", label: "机灵型", hint: "机智吐槽，反应快" },
];

export function personalityLabel(id: string | undefined | null): string {
  return PERSONALITIES.find((p) => p.id === id)?.label ?? id ?? "未知";
}

export function isPersonality(id: string): id is Personality {
  return PERSONALITIES.some((p) => p.id === id);
}
