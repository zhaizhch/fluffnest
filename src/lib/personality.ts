import type { Personality } from "./types";

export type PersonalityOption = {
  id: Personality;
  label: string;
  hint: string;
};

/** Built-in switchable pet personalities. */
export const PERSONALITIES: PersonalityOption[] = [
  { id: "calm", label: "安静型", hint: "温柔克制，话不多" },
  { id: "lively", label: "活泼型", hint: "开朗俏皮，爱闹腾" },
  { id: "clingy", label: "黏人型", hint: "软软撒娇，求关注" },
  { id: "tsundere", label: "傲娇型", hint: "口是心非，嘴硬心软" },
  { id: "clever", label: "机灵型", hint: "机智吐槽，反应快" },
];

export function isPersonality(id: string): id is Personality {
  return PERSONALITIES.some((p) => p.id === id);
}

/** Display label for presets or a custom tag. */
export function personalityLabel(
  id: string | undefined | null,
  note?: string | null,
): string {
  if (!id) return "未知";
  const preset = PERSONALITIES.find((p) => p.id === id);
  if (preset) {
    return note?.trim() ? `${preset.label}·定制` : preset.label;
  }
  return id;
}

export function personalityHint(
  id: string | undefined | null,
  note?: string | null,
): string {
  const n = note?.trim();
  if (n) return n;
  return PERSONALITIES.find((p) => p.id === id)?.hint ?? "自定义性格";
}

export function isCustomPersonality(id: string | undefined | null): boolean {
  return !!id && !isPersonality(id);
}
