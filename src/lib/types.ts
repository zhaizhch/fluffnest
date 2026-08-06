export type Personality =
  | "calm"
  | "lively"
  | "clingy"
  | "tsundere"
  | "clever";

export type PetBehavior =
  | "idle"
  | "walk"
  | "sleep"
  | "stretch"
  | "wave"
  | "nod"
  | "soccer"
  | "jump_rope"
  | "tea"
  | "drink"
  | "swing"
  | "look"
  | "nuzzle"
  | "cheer"
  | "read"
  | "hum"
  | "paint"
  | "dance"
  | "bow"
  | "sit"
  | "yawn"
  | "phone"
  | "magic"
  | "spin"
  | "react"
  | "pat"
  | "feed"
  | "play"
  | "poke"
  | "hug"
  | "tickle"
  | "switch"
  /** 吐泡泡 */
  | "bubble"
  /** 空间跳跃 */
  | "warp"
  /** 放大招 */
  | "ultimate"
  /** 分类专属 */
  | "roll"
  | "wiggle"
  | "encore"
  | "beam"
  | "slash"
  | "hex"
  | "sparkle"
  | "float";

export type PetInstance = {
  id: string;
  speciesId: string;
  name: string;
  mood: number;
  energy: number;
  bond: number;
  personality: Personality | string;
  /** Free-text blurb for LLM; overrides preset description when set. */
  personalityNote?: string | null;
  isActive: boolean;
  unlocked: boolean;
  lastInteractAt: string;
};

export type ReminderRule = {
  id: string;
  type: string;
  title?: string | null;
  intervalMinutes?: number | null;
  at?: string | null;
  enabled: boolean;
  snoozeMinutes: number;
  lastFiredAt?: string | null;
};

export type ScheduleJob = {
  id: string;
  title: string;
  /** weather_forecast | news_brief | custom_prompt */
  kind: string;
  /** wechat | pet */
  channel: string;
  enabled: boolean;
  hour: number;
  minute: number;
  daysOfWeek?: number[];
  params?: Record<string, unknown>;
  lastFiredDate?: string | null;
};

export type ReminderStatus = {
  water?: {
    id: string;
    type: string;
    title?: string | null;
    enabled: boolean;
    intervalMinutes?: number | null;
    at?: string | null;
  } | null;
  stretch?: {
    id: string;
    type: string;
    title?: string | null;
    enabled: boolean;
    intervalMinutes?: number | null;
    at?: string | null;
  } | null;
  meetings: Array<{
    id: string;
    type: string;
    title?: string | null;
    enabled: boolean;
    intervalMinutes?: number | null;
    at?: string | null;
  }>;
  summary: string;
};

export type ShopProduct = {
  id: string;
  sku: string;
  type: string;
  targetId: string;
  currency: string;
  amount: number;
  rarity: string;
  available: boolean;
  name: string;
  iapProductId?: string | null;
};

export type Wallet = { coin: number; gem: number };
export type OwnedAction = { actionId: string; obtainedAt: string };

export type DailyReward = {
  kind: string;
  targetId: string;
  amount: number;
  label: string;
};

export type DailyLogin = {
  lastClaimDate?: string | null;
  streak: number;
  totalDays: number;
  pendingRewards: DailyReward[];
  claimedToday: boolean;
};

/** Daily bond gain counter (resets each local calendar day). */
export type DailyCare = {
  date: string;
  bondGained: number;
};

export type Settings = {
  muted: boolean;
  focusMode: boolean;
  alwaysOnTop: boolean;
  isAdmin?: boolean;
  llm?: LlmSettings;
  wechat?: WechatSettings;
};

export type WechatSettings = {
  clawbotEnabled: boolean;
  notifEnabled: boolean;
  autoReplyFromWechat: boolean;
  confirmBeforeSend: boolean;
  ttsOnIncoming: boolean;
  urgentBreaksFocus: boolean;
  nudgeMinutes: number;
  allowlist: string[];
};

export type WechatAuth = {
  botToken?: string;
  baseUrl?: string;
  getUpdatesBuf?: string;
  accountLabel?: string | null;
  ownerPeerId?: string | null;
  ownerContextToken?: string | null;
};

export type ImMessage = {
  id: string;
  source: string;
  sender: string;
  text: string;
  summary?: string | null;
  urgency?: string | null;
  contextToken?: string | null;
  peerUserId?: string | null;
  receivedAt: string;
  acknowledged: boolean;
  lastNudgedAt?: string | null;
};

export type ImDraftResult = {
  messageId: string;
  sender: string;
  incoming: string;
  summary: string;
  draft: string;
  suggestions: string[];
  canSend: boolean;
  channel: string;
};

export type WechatStatus = {
  loggedIn: boolean;
  clawbotEnabled: boolean;
  polling: boolean;
  accountLabel?: string | null;
};

export type WechatNotifStatus = {
  trusted: boolean;
  watching: boolean;
  notifEnabled: boolean;
};

export type WechatLoginStart = {
  qrcode: string;
  qrImage: string;
};

export type LlmSettings = {
  enabled: boolean;
  apiBase: string;
  apiKey: string;
  model: string;
  chatEnabled: boolean;
  dialogueEnabled: boolean;
  proactiveEnabled: boolean;
  weatherEnabled: boolean;
  jokeEnabled: boolean;
  newsEnabled: boolean;
  fortuneEnabled: boolean;
  weatherCity: string;
  weatherHour: number;
  fortuneHour: number;
  jokeIntervalMinutes: number;
  newsIntervalMinutes: number;
  lastWeatherDate?: string | null;
  lastJokeAt?: string | null;
  lastNewsAt?: string | null;
  lastFortuneDate?: string | null;
  cachedFortune?: string | null;
};

export type ChatMessage = {
  role: "user" | "assistant" | string;
  content: string;
  at?: string;
};

export type PetSaysPayload = {
  text: string;
  kind: string;
  behavior?: string | null;
  /** Weather number card etc. */
  detail?: string | null;
  /** IM inbox id for wechat cards */
  messageId?: string | null;
  /** ClawBot will auto-send; skip parallel draft */
  autoReplying?: boolean | null;
};

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  enabled: false,
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  chatEnabled: true,
  dialogueEnabled: true,
  proactiveEnabled: false,
  weatherEnabled: true,
  jokeEnabled: true,
  newsEnabled: true,
  fortuneEnabled: true,
  weatherCity: "北京",
  weatherHour: 9,
  fortuneHour: 8,
  jokeIntervalMinutes: 90,
  newsIntervalMinutes: 180,
};

export const DEFAULT_WECHAT_SETTINGS: WechatSettings = {
  clawbotEnabled: false,
  notifEnabled: false,
  autoReplyFromWechat: true,
  confirmBeforeSend: true,
  ttsOnIncoming: false,
  urgentBreaksFocus: true,
  nudgeMinutes: 15,
  allowlist: [],
};

export type AppState = {
  pets: PetInstance[];
  reminders: ReminderRule[];
  schedules?: ScheduleJob[];
  /** @deprecated economy removed; kept for old save files */
  wallet?: Wallet;
  ownedActions: OwnedAction[];
  /** @deprecated daily login removed */
  dailyLogin?: DailyLogin;
  dailyCare?: DailyCare;
  careRevision?: number;
  settings: Settings;
  /** @deprecated shop removed */
  shopCatalog?: ShopProduct[];
  chatHistory?: ChatMessage[];
  wechatAuth?: WechatAuth;
  imInbox?: ImMessage[];
};

export type SkinPalette = {
  body: string;
  blush: string;
  ear: string;
  accent: string;
  ink: string;
};

export const DEFAULT_PALETTE: SkinPalette = {
  body: "#F3E6D8",
  blush: "#E8A090",
  ear: "#E8D5C4",
  accent: "#C4A484",
  ink: "#3D3229",
};

export type ActionDef = {
  id: PetBehavior;
  label: string;
  kind: "idle" | "interact" | "react";
  durationMs: number;
};

export const ACTION_DEFS: Record<string, ActionDef> = {
  idle: { id: "idle", label: "静静待着", kind: "idle", durationMs: 4000 },
  walk: { id: "walk", label: "踱步", kind: "idle", durationMs: 4500 },
  sleep: { id: "sleep", label: "小憩", kind: "idle", durationMs: 5000 },
  stretch: { id: "stretch", label: "伸懒腰", kind: "idle", durationMs: 3200 },
  yawn: { id: "yawn", label: "打哈欠", kind: "idle", durationMs: 2800 },
  wave: { id: "wave", label: "招手", kind: "idle", durationMs: 2800 },
  nod: { id: "nod", label: "点头", kind: "idle", durationMs: 2200 },
  bow: { id: "bow", label: "鞠躬", kind: "idle", durationMs: 2800 },
  sit: { id: "sit", label: "坐下", kind: "idle", durationMs: 4500 },
  soccer: { id: "soccer", label: "踢足球", kind: "idle", durationMs: 4200 },
  jump_rope: { id: "jump_rope", label: "跳绳", kind: "idle", durationMs: 4200 },
  tea: { id: "tea", label: "品茶", kind: "idle", durationMs: 4500 },
  drink: { id: "drink", label: "喝水", kind: "idle", durationMs: 4200 },
  swing: { id: "swing", label: "荡秋千", kind: "idle", durationMs: 5200 },
  look: { id: "look", label: "偷看你", kind: "idle", durationMs: 2800 },
  nuzzle: { id: "nuzzle", label: "蹭蹭", kind: "interact", durationMs: 2000 },
  cheer: { id: "cheer", label: "欢呼", kind: "idle", durationMs: 2200 },
  read: { id: "read", label: "静读", kind: "idle", durationMs: 5000 },
  hum: { id: "hum", label: "哼歌", kind: "idle", durationMs: 3600 },
  dance: { id: "dance", label: "小舞蹈", kind: "idle", durationMs: 4000 },
  paint: { id: "paint", label: "涂鸦", kind: "idle", durationMs: 4200 },
  phone: { id: "phone", label: "看手机", kind: "idle", durationMs: 4000 },
  magic: { id: "magic", label: "施法", kind: "idle", durationMs: 3800 },
  spin: { id: "spin", label: "转身", kind: "idle", durationMs: 1400 },
  bubble: { id: "bubble", label: "吐泡泡", kind: "idle", durationMs: 4200 },
  warp: { id: "warp", label: "空间跳跃", kind: "idle", durationMs: 2800 },
  ultimate: { id: "ultimate", label: "放大招", kind: "idle", durationMs: 5200 },
  roll: { id: "roll", label: "打滚", kind: "idle", durationMs: 3800 },
  wiggle: { id: "wiggle", label: "扭扭腰", kind: "idle", durationMs: 3400 },
  encore: { id: "encore", label: "安可闪光", kind: "idle", durationMs: 4400 },
  beam: { id: "beam", label: "必杀光线", kind: "idle", durationMs: 4800 },
  slash: { id: "slash", label: "英雄一击", kind: "idle", durationMs: 4200 },
  hex: { id: "hex", label: "吟唱咒文", kind: "idle", durationMs: 4600 },
  sparkle: { id: "sparkle", label: "撒星光", kind: "idle", durationMs: 4000 },
  float: { id: "float", label: "悬浮", kind: "idle", durationMs: 5000 },
  react: { id: "react", label: "提醒", kind: "react", durationMs: 4000 },
  pat: { id: "pat", label: "轻拍", kind: "interact", durationMs: 1800 },
  feed: { id: "feed", label: "投喂", kind: "interact", durationMs: 2200 },
  play: { id: "play", label: "逗玩", kind: "interact", durationMs: 2400 },
  poke: { id: "poke", label: "戳戳", kind: "interact", durationMs: 1600 },
  hug: { id: "hug", label: "抱抱", kind: "interact", durationMs: 2200 },
  tickle: { id: "tickle", label: "挠痒", kind: "interact", durationMs: 2000 },
};

export const SPECIES_IDLE_POOL: PetBehavior[] = [
  "idle",
  "walk",
  "stretch",
  "yawn",
  "wave",
  "drink",
  "look",
  "cheer",
  "sit",
  "sleep",
  "dance",
  "swing",
  "jump_rope",
  "hum",
];

export const BUBBLES: Partial<Record<PetBehavior, string[]>> = {
  idle: ["在呢。", "陪着你。", "嗯…", "看你工作。"],
  walk: ["换个地方。", "透透气。"],
  pat: ["舒服。", "再摸一下？"],
  poke: ["诶！", "坏心眼。"],
  feed: ["谢啦。", "正好饿了。"],
  hug: ["靠一会。", "暖的。"],
  tickle: ["哈哈哈！", "好痒！"],
  play: ["再玩会！", "抓住我呀。"],
  sleep: ["眯一会…", "Zzz"],
  react: ["记得一下。", "该处理了。"],
  wave: ["嗨。", "看见你啦。"],
  cheer: ["耶！", "好厉害！"],
  drink: ["咕咚。", "你也喝一口？"],
  bubble: ["咕嘟…", "泡泡～", "吹一个给你。"],
  warp: ["咻！", "换个坐标。", "这边！"],
  ultimate: ["看招！", "全力一击！", "必杀——！"],
  roll: ["咕噜噜～", "软软的地板！"],
  wiggle: ["陪你晃晃。", "嗯哼～"],
  encore: ["Encore！", "闪闪的！"],
  beam: ["biu——！", "能量充填…"],
  slash: ["看剑！", "喝！"],
  hex: ["魔力汇聚。", "小咒术。"],
  sparkle: ["✨", "星星打卡！"],
  float: ["轻飘飘。", "在云上。"],
};

export { PET_CATALOG, petDef, spriteFor } from "./petCatalog";
