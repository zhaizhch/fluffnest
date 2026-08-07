use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetInstance {
    pub id: String,
    pub species_id: String,
    pub name: String,
    pub mood: i32,
    pub energy: i32,
    pub bond: i32,
    pub personality: String,
    /// Free-text personality description for LLM (optional; presets use built-in blurbs when empty).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub personality_note: Option<String>,
    pub is_active: bool,
    #[serde(default)]
    pub unlocked: bool,
    pub last_interact_at: String,
    // legacy fields ignored if present in old saves
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skin_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hatched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRule {
    pub id: String,
    pub r#type: String,
    pub title: Option<String>,
    pub interval_minutes: Option<i32>,
    pub at: Option<String>,
    pub enabled: bool,
    pub snooze_minutes: i32,
    pub last_fired_at: Option<String>,
}

/// User-defined recurring automation (e.g. evening weather → WeChat).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleJob {
    pub id: String,
    pub title: String,
    /// weather_forecast | news_brief | custom_prompt
    pub kind: String,
    /// wechat | pet
    pub channel: String,
    pub enabled: bool,
    /// Local hour 0–23
    pub hour: i32,
    /// Local minute 0–59
    pub minute: i32,
    /// Empty = every day; else 0=Sun … 6=Sat
    #[serde(default)]
    pub days_of_week: Vec<i32>,
    /// kind-specific: city, forTomorrow, lookbackHours, prompt, …
    #[serde(default)]
    pub params: serde_json::Map<String, serde_json::Value>,
    /// Last local calendar date this job fired (YYYY-MM-DD)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_fired_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopProduct {
    pub id: String,
    pub sku: String,
    pub r#type: String,
    pub target_id: String,
    pub currency: String,
    pub amount: i32,
    pub rarity: String,
    pub available: bool,
    pub name: String,
    pub iap_product_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wallet {
    pub coin: i32,
    pub gem: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedAction {
    pub action_id: String,
    pub obtained_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DailyLogin {
    pub last_claim_date: Option<String>,
    pub streak: i32,
    pub total_days: i32,
    #[serde(default)]
    pub pending_rewards: Vec<DailyReward>,
    pub claimed_today: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyReward {
    pub kind: String,
    pub target_id: String,
    pub amount: i32,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DailyCare {
    /// Local calendar day `YYYY-MM-DD` for bond daily counters.
    #[serde(default)]
    pub date: String,
    /// Bond gained today (capped by DAILY_BOND_CAP).
    #[serde(default)]
    pub bond_gained: i32,
}

fn default_api_base() -> String {
    "https://api.openai.com/v1".into()
}
fn default_model() -> String {
    "gpt-4o-mini".into()
}
fn default_city() -> String {
    "北京".into()
}
fn default_weather_hour() -> u32 {
    9
}
fn default_joke_interval() -> i32 {
    90
}
fn default_news_interval() -> i32 {
    180
}
fn default_true() -> bool {
    true
}
fn default_fortune_hour() -> u32 {
    8
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettings {
    /// Master switch — API calls only when true.
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_api_base")]
    pub api_base: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    /// Panel chat with the active pet.
    #[serde(default = "default_true")]
    pub chat_enabled: bool,
    /// Generate click / idle / reminder bubbles via LLM.
    #[serde(default = "default_true")]
    pub dialogue_enabled: bool,
    /// Weather / joke / news / fortune proactive pushes.
    #[serde(default)]
    pub proactive_enabled: bool,
    #[serde(default = "default_true")]
    pub weather_enabled: bool,
    #[serde(default = "default_true")]
    pub joke_enabled: bool,
    #[serde(default = "default_true")]
    pub news_enabled: bool,
    #[serde(default = "default_true")]
    pub fortune_enabled: bool,
    #[serde(default = "default_city")]
    pub weather_city: String,
    /// Local hour (0–23) to greet with weather once per day.
    #[serde(default = "default_weather_hour")]
    pub weather_hour: u32,
    /// Local hour (0–23) to push today's fortune once per day.
    #[serde(default = "default_fortune_hour")]
    pub fortune_hour: u32,
    #[serde(default = "default_joke_interval")]
    pub joke_interval_minutes: i32,
    #[serde(default = "default_news_interval")]
    pub news_interval_minutes: i32,
    #[serde(default)]
    pub last_weather_date: Option<String>,
    #[serde(default)]
    pub last_joke_at: Option<String>,
    #[serde(default)]
    pub last_news_at: Option<String>,
    #[serde(default)]
    pub last_fortune_date: Option<String>,
    /// Cached fortune text for `last_fortune_date` (same calendar day).
    #[serde(default)]
    pub cached_fortune: Option<String>,
}

impl Default for LlmSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            api_base: default_api_base(),
            api_key: String::new(),
            model: default_model(),
            chat_enabled: true,
            dialogue_enabled: true,
            proactive_enabled: false,
            weather_enabled: true,
            joke_enabled: true,
            news_enabled: true,
            fortune_enabled: true,
            weather_city: default_city(),
            weather_hour: default_weather_hour(),
            fortune_hour: default_fortune_hour(),
            joke_interval_minutes: default_joke_interval(),
            news_interval_minutes: default_news_interval(),
            last_weather_date: None,
            last_joke_at: None,
            last_news_at: None,
            last_fortune_date: None,
            cached_fortune: None,
        }
    }
}

fn default_nudge_minutes() -> i32 {
    15
}
fn default_confirm_before_send() -> bool {
    true
}

fn default_auto_reply_from_wechat() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatSettings {
    /// Channel A: official ClawBot / iLink long-poll.
    #[serde(default)]
    pub clawbot_enabled: bool,
    /// Channel C: macOS WeChat notification banners (Accessibility).
    #[serde(default)]
    pub notif_enabled: bool,
    /// When true, inbound ClawBot DMs are answered via pet chat + sendmessage.
    #[serde(default = "default_auto_reply_from_wechat")]
    pub auto_reply_from_wechat: bool,
    /// Panel / QuickMenu outbound always confirms when true (default).
    #[serde(default = "default_confirm_before_send")]
    pub confirm_before_send: bool,
    #[serde(default)]
    pub tts_on_incoming: bool,
    /// Allow urgent triage to surface even in focus mode.
    #[serde(default)]
    pub urgent_breaks_focus: bool,
    /// Re-nudge unacknowledged important messages after N minutes (0 = off).
    #[serde(default = "default_nudge_minutes")]
    pub nudge_minutes: i32,
    /// Optional sender substrings; empty = allow all.
    #[serde(default)]
    pub allowlist: Vec<String>,
}

impl Default for WechatSettings {
    fn default() -> Self {
        Self {
            clawbot_enabled: false,
            notif_enabled: false,
            auto_reply_from_wechat: true,
            confirm_before_send: true,
            tts_on_incoming: false,
            urgent_breaks_focus: true,
            nudge_minutes: default_nudge_minutes(),
            allowlist: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WechatAuth {
    #[serde(default)]
    pub bot_token: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub get_updates_buf: String,
    #[serde(default)]
    pub account_label: Option<String>,
    /// Latest ClawBot peer to receive proactive pushes (updated on inbound).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_peer_id: Option<String>,
    /// Latest context_token for owner_peer_id (required by iLink sendmessage).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_context_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImAttachment {
    pub path: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImMessage {
    pub id: String,
    /// clawbot | notif | simulate
    pub source: String,
    pub sender: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<ImAttachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// urgent | normal | noise
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub urgency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_token: Option<String>,
    /// Peer user id for ClawBot replies (inbound from_user_id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_user_id: Option<String>,
    pub received_at: String,
    #[serde(default)]
    pub acknowledged: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_nudged_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub muted: bool,
    pub focus_mode: bool,
    pub always_on_top: bool,
    /// Dev-only full unlock. Default false — never auto-claim login gifts.
    #[serde(default)]
    pub is_admin: bool,
    #[serde(default)]
    pub llm: LlmSettings,
    #[serde(default)]
    pub wechat: WechatSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub pets: Vec<PetInstance>,
    pub reminders: Vec<ReminderRule>,
    /// Custom timed automations (weather/news/custom → WeChat or pet).
    #[serde(default)]
    pub schedules: Vec<ScheduleJob>,
    pub wallet: Wallet,
    #[serde(default)]
    pub owned_actions: Vec<OwnedAction>,
    #[serde(default)]
    pub daily_login: DailyLogin,
    /// Daily bond cap tracking.
    #[serde(default)]
    pub daily_care: DailyCare,
    /// Bumped when one-shot migrations run (1 = retired forced admin unlock).
    #[serde(default)]
    pub care_revision: i32,
    pub settings: Settings,
    pub shop_catalog: Vec<ShopProduct>,
    /// Recent chat turns with the active pet (persisted).
    #[serde(default)]
    pub chat_history: Vec<crate::llm::ChatMessage>,
    /// WeChat ClawBot credentials + long-poll cursor (local only).
    #[serde(default)]
    pub wechat_auth: WechatAuth,
    /// Recent inbound IM messages (newest last; capped).
    #[serde(default)]
    pub im_inbox: Vec<ImMessage>,
}

fn today_local() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

struct PetSeed {
    id: &'static str,
    species: &'static str,
    name: &'static str,
    personality: &'static str,
    unlock: &'static str, // default | shop | login
    rarity: &'static str,
    price: i32,
}

/// Mirrors frontend petCatalog.ts — 暖卡卡 + とろろ/ひじき(Live2D)
fn catalog() -> Vec<PetSeed> {
    vec![
        PetSeed {
            id: "pet-kaka5",
            species: "kaka5",
            name: "暖卡卡",
            personality: "clingy",
            unlock: "default",
            rarity: "R",
            price: 0,
        },
        PetSeed {
            id: "pet-tororo",
            species: "tororo",
            name: "とろろ",
            personality: "calm",
            unlock: "default",
            rarity: "SR",
            price: 0,
        },
        PetSeed {
            id: "pet-hijiki",
            species: "hijiki",
            name: "ひじき",
            personality: "lively",
            unlock: "default",
            rarity: "SR",
            price: 0,
        },
    ]
}

fn make_pet(seed: &PetSeed, active: bool, now: &str) -> PetInstance {
    PetInstance {
        id: seed.id.into(),
        species_id: seed.species.into(),
        name: seed.name.into(),
        mood: 78,
        energy: 72,
        bond: if seed.unlock == "default" { 20 } else { 0 },
        personality: seed.personality.into(),
        personality_note: None,
        is_active: active,
        unlocked: seed.unlock == "default",
        last_interact_at: now.into(),
        skin_id: None,
        stage: None,
        hatched_at: None,
    }
}

impl Default for AppState {
    fn default() -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        let pets: Vec<PetInstance> = catalog()
            .iter()
            .enumerate()
            .map(|(i, s)| make_pet(s, i == 0, &now))
            .collect();

        Self {
            pets,
            reminders: vec![
                ReminderRule {
                    id: "rem-water".into(),
                    r#type: "water".into(),
                    title: Some("喝水".into()),
                    interval_minutes: Some(60),
                    at: None,
                    enabled: true,
                    snooze_minutes: 5,
                    last_fired_at: None,
                },
                ReminderRule {
                    id: "rem-stretch".into(),
                    r#type: "stretch".into(),
                    title: Some("久坐起身".into()),
                    interval_minutes: Some(45),
                    at: None,
                    enabled: true,
                    snooze_minutes: 5,
                    last_fired_at: None,
                },
            ],
            schedules: Vec::new(),
            wallet: Wallet { coin: 200, gem: 0 },
            owned_actions: default_owned_actions(&now),
            daily_login: DailyLogin::default(),
            daily_care: DailyCare::default(),
            care_revision: 1,
            settings: Settings {
                muted: false,
                focus_mode: false,
                always_on_top: true,
                is_admin: false,
                llm: LlmSettings::default(),
                wechat: WechatSettings::default(),
            },
            shop_catalog: default_shop_catalog(),
            chat_history: Vec::new(),
            wechat_auth: WechatAuth::default(),
            im_inbox: Vec::new(),
        }
    }
}

fn default_owned_actions(now: &str) -> Vec<OwnedAction> {
    all_action_ids()
        .into_iter()
        .map(|id| OwnedAction {
            action_id: id.into(),
            obtained_at: now.into(),
        })
        .collect()
}

fn all_action_ids() -> Vec<&'static str> {
    vec![
        "idle", "walk", "sleep", "stretch", "yawn", "wave", "nod", "bow", "sit",
        "soccer", "jump_rope", "tea", "drink", "swing", "look", "nuzzle", "cheer",
        "read", "hum", "dance", "paint", "phone", "magic", "spin", "react",
        "pat", "feed", "play", "poke", "hug", "tickle",
        "bubble", "warp", "ultimate",
        "roll", "wiggle", "encore", "beam", "slash", "hex", "sparkle", "float",
    ]
}

pub fn grant_admin_unlocks(state: &mut AppState) {
    let now = chrono::Utc::now().to_rfc3339();
    state.settings.is_admin = true;
    for p in state.pets.iter_mut() {
        p.unlocked = true;
        p.bond = p.bond.max(100);
        p.mood = 100;
        p.energy = 100;
    }
    for action in all_action_ids() {
        if !state.owned_actions.iter().any(|a| a.action_id == action) {
            state.owned_actions.push(OwnedAction {
                action_id: action.into(),
                obtained_at: now.clone(),
            });
        }
    }
}

/// Daily bond gain cap (interact + reminder check-in).
pub const DAILY_BOND_CAP: i32 = 30;

pub fn sync_daily_care(state: &mut AppState) {
    let today = today_local();
    if state.daily_care.date != today {
        state.daily_care.date = today;
        state.daily_care.bond_gained = 0;
    }
}

/// Reserve bond gain against the daily cap. Returns actual allowed gain.
pub fn take_bond_budget(state: &mut AppState, want: i32) -> i32 {
    if want <= 0 {
        return 0;
    }
    sync_daily_care(state);
    let room = (DAILY_BOND_CAP - state.daily_care.bond_gained).max(0);
    let gained = want.min(room);
    state.daily_care.bond_gained += gained;
    gained
}

fn default_shop_catalog() -> Vec<ShopProduct> {
    // Economy removed: no shop unlock SKUs.
    Vec::new()
}

pub fn ensure_migrated(state: &mut AppState) {
    let now = chrono::Utc::now().to_rfc3339();
    let seeds = catalog();

    // Legacy Water Margin / renamed species → current ids
    let alias: &[(&str, &str)] = &[
        ("linchong", "whitemage"),
        ("songjiang", "violetmage"),
        ("wuyong", "crystmage"),
        ("husanniang", "broomwitch"),
        ("wusong", "leo"),
        ("luzhishen", "kaizer"),
        ("likui", "guilmon"),
        ("yanqing", "rose"),
        ("nuotuan", "tororo"),
    ];

    // Rebuild / merge pets from catalog
    let prev_active_raw = state
        .pets
        .iter()
        .find(|p| p.is_active)
        .map(|p| p.species_id.clone());
    let prev_active = prev_active_raw.as_ref().map(|id| {
        alias
            .iter()
            .find(|(from, _)| *from == id)
            .map(|(_, to)| (*to).to_string())
            .unwrap_or_else(|| id.clone())
    });

    let mut unlocked: std::collections::HashSet<String> = state
        .pets
        .iter()
        .filter(|p| p.unlocked)
        .map(|p| p.species_id.clone())
        .collect();
    for (from, to) in alias {
        if unlocked.contains(*from) {
            unlocked.insert((*to).into());
        }
    }

    let mut next_pets = Vec::new();
    for (i, seed) in seeds.iter().enumerate() {
        let was = state.pets.iter().find(|p| {
            p.species_id == seed.species
                || alias.iter().any(|(from, to)| {
                    *to == seed.species && p.species_id == *from
                })
        });
        let mut pet = make_pet(seed, false, &now);
        if let Some(old) = was {
            pet.mood = old.mood;
            pet.energy = old.energy;
            pet.bond = old.bond.max(pet.bond);
            pet.unlocked = old.unlocked || pet.unlocked || unlocked.contains(seed.species);
            pet.last_interact_at = old.last_interact_at.clone();
            if !old.personality.trim().is_empty() {
                pet.personality = old.personality.clone();
            }
            pet.personality_note = old.personality_note.clone();
            // Always refresh display name from catalog
            pet.name = seed.name.into();
        } else if unlocked.contains(seed.species) || seed.unlock == "default" {
            pet.unlocked = true;
        }
        if prev_active.as_deref() == Some(seed.species) {
            pet.is_active = true;
        }
        if i == 0 && prev_active.is_none() {
            pet.is_active = true;
        }
        next_pets.push(pet);
    }
    // Ensure exactly one active unlocked pet
    if !next_pets.iter().any(|p| p.is_active && p.unlocked) {
        if let Some(p) = next_pets.iter_mut().find(|p| p.unlocked) {
            p.is_active = true;
        }
    }
    for p in next_pets.iter_mut() {
        if !p.unlocked {
            p.is_active = false;
        }
    }
    state.pets = next_pets;

    // Keep default pets unlocked; preserve whichever is active.
    for p in state.pets.iter_mut() {
        if p.species_id == "kaka5" || p.species_id == "tororo" || p.species_id == "hijiki" {
            p.unlocked = true;
        }
    }
    if !state.pets.iter().any(|p| p.is_active && p.unlocked) {
        if let Some(p) = state.pets.iter_mut().find(|p| p.species_id == "kaka5") {
            p.is_active = true;
        } else if let Some(p) = state.pets.iter_mut().find(|p| p.unlocked) {
            p.is_active = true;
        }
    }

    state.shop_catalog = default_shop_catalog();

    // One-shot: older builds forced admin unlock every launch (login gifts felt auto-claimed).
    if state.care_revision < 1 {
        state.settings.is_admin = false;
        for pet in state.pets.iter_mut() {
            if let Some(seed) = seeds.iter().find(|s| s.species == pet.species_id) {
                if seed.unlock == "login" {
                    pet.unlocked = false;
                    if pet.is_active {
                        pet.is_active = false;
                    }
                }
            }
        }
        if !state.pets.iter().any(|p| p.is_active && p.unlocked) {
            if let Some(p) = state.pets.iter_mut().find(|p| p.unlocked) {
                p.is_active = true;
            }
        }
        state.care_revision = 1;
    }

    // Admin full-unlock only when explicitly enabled — never on every migrate.
    if state.settings.is_admin {
        grant_admin_unlocks(state);
    }
    let _ = now;
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

pub fn load_state(app: &AppHandle) -> AppState {
    let path = match state_path(app) {
        Ok(p) => p,
        Err(_) => return AppState::default(),
    };
    let mut state = match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<AppState>(&raw).unwrap_or_default(),
        Err(_) => AppState::default(),
    };
    ensure_migrated(&mut state);
    let _ = save_state(app, &state);
    state
}

pub fn save_state(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let path = state_path(app)?;
    let raw = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn today_string() -> String {
    today_local()
}
