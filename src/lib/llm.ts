import type { LlmSettings, Settings, WechatSettings } from "./types";
import { DEFAULT_LLM_SETTINGS, DEFAULT_WECHAT_SETTINGS } from "./types";

export function llmFromSettings(settings: Settings | null | undefined): LlmSettings {
  return { ...DEFAULT_LLM_SETTINGS, ...(settings?.llm ?? {}) };
}

export function withLlm(
  settings: Settings,
  patch: Partial<LlmSettings>,
): Settings {
  return {
    ...settings,
    llm: { ...llmFromSettings(settings), ...patch },
  };
}

export function wechatFromSettings(
  settings: Settings | null | undefined,
): WechatSettings {
  return { ...DEFAULT_WECHAT_SETTINGS, ...(settings?.wechat ?? {}) };
}

export function withWechat(
  settings: Settings,
  patch: Partial<WechatSettings>,
): Settings {
  return {
    ...settings,
    wechat: { ...wechatFromSettings(settings), ...patch },
  };
}

/** Action / behavior labels for LLM prompts (Chinese). */
export const ACTION_LABELS: Record<string, string> = {
  pat: "轻拍",
  pet: "摸摸",
  poke: "戳戳",
  hug: "抱抱",
  tickle: "挠痒",
  feed: "投喂",
  play: "逗玩",
  click: "点击互动",
  idle: "发呆",
  walk: "踱步",
  sleep: "小憩",
  stretch: "伸懒腰",
  yawn: "打哈欠",
  wave: "招手",
  look: "偷看主人",
  cheer: "欢呼",
  drink: "喝水",
  bubble: "吐泡泡",
  warp: "空间跳跃",
  ultimate: "放大招",
  react: "提醒",
  nuzzle: "蹭蹭",
  dance: "跳舞",
  hum: "哼歌",
  sit: "坐下",
  nod: "点头",
  bow: "鞠躬",
  swing: "荡秋千",
  jump_rope: "跳绳",
  roll: "打滚",
  wiggle: "扭扭腰",
  encore: "安可",
  beam: "必杀光线",
  slash: "英雄一击",
  hex: "吟唱咒文",
  sparkle: "撒星光",
  float: "悬浮",
  read: "静读",
  paint: "涂鸦",
  phone: "看手机",
  magic: "施法",
  spin: "转身",
  soccer: "踢足球",
  tea: "品茶",
};

export function actionLabel(id: string): string {
  return ACTION_LABELS[id] ?? id;
}
