import { invoke } from "@tauri-apps/api/core";
import type {
  AppState,
  ChatMessage,
  ImDraftResult,
  ImMessage,
  PetInstance,
  PetSaysPayload,
  ReminderRule,
  ReminderStatus,
  ScheduleJob,
  Settings,
  WechatLoginStart,
  WechatNotifStatus,
  WechatStatus,
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
  setPetPersonality: (
    personality: string,
    petId?: string | null,
    note?: string | null,
  ) =>
    invoke<PetInstance>("set_pet_personality", {
      personality,
      petId: petId ?? null,
      note: note ?? null,
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
  quickDisableReminder: (kind: "water" | "stretch" | string, id?: string | null) =>
    invoke<ReminderRule>("quick_disable_reminder", {
      kind,
      id: id ?? null,
    }),
  reminderStatus: () => invoke<ReminderStatus>("reminder_status"),
  deleteReminder: (id: string) =>
    invoke<ReminderRule[]>("delete_reminder", { id }),
  upsertSchedule: (job: ScheduleJob) =>
    invoke<ScheduleJob[]>("upsert_schedule", { job }),
  deleteSchedule: (id: string) =>
    invoke<ScheduleJob[]>("delete_schedule", { id }),
  listSchedules: () => invoke<ScheduleJob[]>("list_schedules"),
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
  simulateImMessage: (sender?: string, text?: string) =>
    invoke<ImMessage | null>("simulate_im_message", {
      sender: sender ?? null,
      text: text ?? null,
    }),
  getImInbox: () => invoke<ImMessage[]>("get_im_inbox"),
  acknowledgeImMessage: (messageId: string) =>
    invoke<void>("acknowledge_im_message", { messageId }),
  acknowledgeAllImMessages: () => invoke<number>("acknowledge_all_im_messages"),
  pruneImNoise: () => invoke<number>("prune_im_noise"),
  draftImReply: (messageId: string, refresh?: boolean) =>
    invoke<ImDraftResult>("draft_im_reply", { messageId, refresh: !!refresh }),
  sendImReply: (messageId: string, text: string) =>
    invoke<string>("send_im_reply", { messageId, text }),
  wechatLoginStart: () => invoke<WechatLoginStart>("wechat_login_start"),
  wechatLoginPoll: () => invoke<WechatStatus>("wechat_login_poll"),
  wechatLogout: () => invoke<WechatStatus>("wechat_logout"),
  wechatStatus: () => invoke<WechatStatus>("wechat_status"),
  wechatNotifStatus: () => invoke<WechatNotifStatus>("wechat_notif_status"),
  openAccessibilitySettings: () => invoke<void>("open_accessibility_settings"),
  openWechatApp: () => invoke<void>("open_wechat_app"),
  copyTextClipboard: (text: string) =>
    invoke<void>("copy_text_clipboard", { text }),
};
