import { invoke } from "@tauri-apps/api/core";
import type {
  AppState,
  ChatMessage,
  PetInstance,
  PetSaysPayload,
  ReminderRule,
  Settings,
  Wallet,
} from "./types";

export type InteractAction =
  | "pet"
  | "pat"
  | "feed"
  | "play"
  | "poke"
  | "hug"
  | "tickle";

export const api = {
  getState: () => invoke<AppState>("get_state"),
  getActivePet: () => invoke<PetInstance>("get_active_pet"),
  interact: (action: InteractAction) =>
    invoke<PetInstance>("interact", { action }),
  switchPet: (petId: string) => invoke<PetInstance>("switch_pet", { petId }),
  setPetPersonality: (personality: string, petId?: string | null) =>
    invoke<PetInstance>("set_pet_personality", {
      personality,
      petId: petId ?? null,
    }),
  updateSettings: (settings: Settings) =>
    invoke<Settings>("update_settings", { settings }),
  upsertReminder: (reminder: ReminderRule) =>
    invoke<ReminderRule[]>("upsert_reminder", { reminder }),
  addMeetingReminder: (title: string, at: string) =>
    invoke<ReminderRule>("add_meeting_reminder", { title, at }),
  quickSetReminder: (args: {
    kind: "water" | "stretch" | "meeting" | string;
    title?: string | null;
    at?: string | null;
    intervalMinutes?: number | null;
  }) =>
    invoke<ReminderRule>("quick_set_reminder", {
      kind: args.kind,
      title: args.title ?? null,
      at: args.at ?? null,
      intervalMinutes: args.intervalMinutes ?? null,
    }),
  deleteReminder: (id: string) =>
    invoke<ReminderRule[]>("delete_reminder", { id }),
  completeReminder: (id: string) =>
    invoke<Wallet>("complete_reminder", { id }),
  purchaseProduct: (productId: string) =>
    invoke<AppState>("purchase_product", { productId }),
  claimDailyLogin: () => invoke<AppState>("claim_daily_login"),
  tickIdle: () => invoke<PetInstance>("tick_idle"),
  getOwnedActions: () => invoke<string[]>("get_owned_actions"),
  generatePetLine: (kind: string, action: string, extra?: string) =>
    invoke<string>("generate_pet_line", { kind, action, extra: extra ?? null }),
  generateCareVoiceLines: (kind: string, count?: number, avoid?: string[]) =>
    invoke<string[]>("generate_care_voice_lines", {
      kind,
      count: count ?? null,
      avoid: avoid ?? null,
    }),
  synthesizeSpeech: (text: string, personality?: string) =>
    invoke<{ mime: string; base64: string; voice: string }>("synthesize_speech", {
      text,
      personality: personality ?? null,
    }),
  speakSpeech: (text: string, personality?: string) =>
    invoke<void>("speak_speech", {
      text,
      personality: personality ?? null,
    }),
  chatWithPet: (message: string) =>
    invoke<ChatMessage>("chat_with_pet", { message }),
  getChatHistory: () => invoke<ChatMessage[]>("get_chat_history"),
  clearChatHistory: () => invoke<void>("clear_chat_history"),
  testLlm: () => invoke<string>("test_llm"),
  triggerProactive: (kind: "weather" | "joke" | "news" | "fortune" | string) =>
    invoke<PetSaysPayload>("trigger_proactive", { kind }),
};
