import { invoke } from "@tauri-apps/api/core";
import type {
  AppState,
  PetInstance,
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
  updateSettings: (settings: Settings) =>
    invoke<Settings>("update_settings", { settings }),
  upsertReminder: (reminder: ReminderRule) =>
    invoke<ReminderRule[]>("upsert_reminder", { reminder }),
  addMeetingReminder: (title: string, at: string) =>
    invoke<ReminderRule>("add_meeting_reminder", { title, at }),
  deleteReminder: (id: string) =>
    invoke<ReminderRule[]>("delete_reminder", { id }),
  completeReminder: (id: string) =>
    invoke<Wallet>("complete_reminder", { id }),
  purchaseProduct: (productId: string) =>
    invoke<AppState>("purchase_product", { productId }),
  claimDailyLogin: () => invoke<AppState>("claim_daily_login"),
  tickIdle: () => invoke<PetInstance>("tick_idle"),
  getOwnedActions: () => invoke<string[]>("get_owned_actions"),
};
