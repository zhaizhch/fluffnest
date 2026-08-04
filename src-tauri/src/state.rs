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
    /// Weather / joke / news proactive pushes.
    #[serde(default)]
    pub proactive_enabled: bool,
    #[serde(default = "default_true")]
    pub weather_enabled: bool,
    #[serde(default = "default_true")]
    pub joke_enabled: bool,
    #[serde(default = "default_true")]
    pub news_enabled: bool,
    #[serde(default = "default_city")]
    pub weather_city: String,
    /// Local hour (0–23) to greet with weather once per day.
    #[serde(default = "default_weather_hour")]
    pub weather_hour: u32,
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
            weather_city: default_city(),
            weather_hour: default_weather_hour(),
            joke_interval_minutes: default_joke_interval(),
            news_interval_minutes: default_news_interval(),
            last_weather_date: None,
            last_joke_at: None,
            last_news_at: None,
        }
    }
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub pets: Vec<PetInstance>,
    pub reminders: Vec<ReminderRule>,
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

/// Mirrors frontend petCatalog.ts (category is frontend-only for UI grouping)
fn catalog() -> Vec<PetSeed> {
    vec![
        // fluff
        PetSeed { id: "pet-mochi", species: "mochi", name: "糯糯", personality: "clingy", unlock: "default", rarity: "N", price: 0 },
        PetSeed { id: "pet-milky", species: "milky", name: "咪可", personality: "calm", unlock: "default", rarity: "N", price: 0 },
        PetSeed { id: "pet-cheese", species: "cheese", name: "芝芝", personality: "lively", unlock: "login", rarity: "R", price: 0 },
        PetSeed { id: "pet-axo", species: "axo", name: "波波", personality: "clingy", unlock: "shop", rarity: "R", price: 80 },
        PetSeed { id: "pet-cha", species: "cha", name: "茶茶", personality: "calm", unlock: "shop", rarity: "R", price: 90 },
        PetSeed { id: "pet-leo", species: "leo", name: "软狮", personality: "lively", unlock: "shop", rarity: "SR", price: 120 },
        PetSeed { id: "pet-rising", species: "rising", name: "瑞星小狮子", personality: "lively", unlock: "shop", rarity: "SR", price: 128 },
        PetSeed { id: "pet-otta", species: "otta", name: "獭獭", personality: "clingy", unlock: "shop", rarity: "R", price: 95 },
        PetSeed { id: "pet-kebo", species: "kebo", name: "柯宝", personality: "lively", unlock: "shop", rarity: "SR", price: 130 },
        // companion (humanoid)
        PetSeed { id: "pet-bean", species: "bean", name: "子平波波", personality: "lively", unlock: "default", rarity: "N", price: 0 },
        PetSeed { id: "pet-boba", species: "boba", name: "波波", personality: "calm", unlock: "shop", rarity: "R", price: 110 },
        PetSeed { id: "pet-pearlcup", species: "pearlcup", name: "珍珍", personality: "lively", unlock: "shop", rarity: "R", price: 85 },
        PetSeed { id: "pet-whitemage", species: "whitemage", name: "白魔法师", personality: "calm", unlock: "default", rarity: "R", price: 0 },
        PetSeed { id: "pet-violetmage", species: "violetmage", name: "紫发法师", personality: "calm", unlock: "shop", rarity: "SR", price: 140 },
        PetSeed { id: "pet-crystmage", species: "crystmage", name: "晶角法师", personality: "calm", unlock: "shop", rarity: "SR", price: 160 },
        PetSeed { id: "pet-broomwitch", species: "broomwitch", name: "扫帚魔女", personality: "lively", unlock: "shop", rarity: "SR", price: 140 },
        PetSeed { id: "pet-fiufiu", species: "fiufiu", name: "菲菲", personality: "clingy", unlock: "shop", rarity: "SR", price: 130 },
        PetSeed { id: "pet-fiufiu2", species: "fiufiu2", name: "菲菲·咒", personality: "clingy", unlock: "shop", rarity: "SR", price: 135 },
        PetSeed { id: "pet-luna", species: "luna", name: "露娜", personality: "clingy", unlock: "default", rarity: "N", price: 0 },
        PetSeed { id: "pet-amy", species: "amy", name: "艾米", personality: "lively", unlock: "shop", rarity: "R", price: 95 },
        PetSeed { id: "pet-dreamgirl", species: "dreamgirl", name: "梦女孩", personality: "calm", unlock: "shop", rarity: "R", price: 100 },
        PetSeed { id: "pet-nous", species: "nous", name: "诺斯", personality: "calm", unlock: "shop", rarity: "R", price: 105 },
        PetSeed { id: "pet-mint", species: "mint", name: "薄荷丝", personality: "calm", unlock: "shop", rarity: "SR", price: 150 },
        PetSeed { id: "pet-qgirl", species: "qgirl", name: "可爱女孩", personality: "clingy", unlock: "shop", rarity: "R", price: 90 },
        PetSeed { id: "pet-puppyhat", species: "puppyhat", name: "小狗帽", personality: "clingy", unlock: "login", rarity: "R", price: 0 },
        PetSeed { id: "pet-chibigirl", species: "chibigirl", name: "小可", personality: "lively", unlock: "shop", rarity: "R", price: 100 },
        PetSeed { id: "pet-hirose", species: "hirose", name: "广濑", personality: "lively", unlock: "shop", rarity: "R", price: 110 },
        PetSeed { id: "pet-pinkribbon", species: "pinkribbon", name: "粉缎带", personality: "clingy", unlock: "shop", rarity: "R", price: 105 },
        PetSeed { id: "pet-redcostume", species: "redcostume", name: "红装姑娘", personality: "calm", unlock: "shop", rarity: "SR", price: 145 },
        PetSeed { id: "pet-girlcat", species: "girlcat", name: "小女孩与猫", personality: "clingy", unlock: "shop", rarity: "SR", price: 140 },
        PetSeed { id: "pet-moonbun", species: "moonbun", name: "月兔双髻", personality: "lively", unlock: "shop", rarity: "R", price: 115 },
        PetSeed { id: "pet-liney", species: "liney", name: "线线", personality: "calm", unlock: "shop", rarity: "R", price: 88 },
        PetSeed { id: "pet-turtleneck", species: "turtleneck", name: "灰高领", personality: "calm", unlock: "shop", rarity: "SR", price: 155 },
        PetSeed { id: "pet-kongirl", species: "kongirl", name: "轻音少女", personality: "lively", unlock: "shop", rarity: "SR", price: 130 },
        PetSeed { id: "pet-rima", species: "rima", name: "莉摩", personality: "lively", unlock: "shop", rarity: "R", price: 120 },
        // idol
        PetSeed { id: "pet-cloud", species: "cloud", name: "珍珠偶像", personality: "calm", unlock: "default", rarity: "N", price: 0 },
        PetSeed { id: "pet-rose", species: "rose", name: "玫瑰偶像", personality: "clingy", unlock: "shop", rarity: "R", price: 100 },
        PetSeed { id: "pet-pinky", species: "pinky", name: "粉珍珠", personality: "clingy", unlock: "login", rarity: "R", price: 0 },
        PetSeed { id: "pet-miku", species: "miku", name: "初音", personality: "lively", unlock: "shop", rarity: "SR", price: 140 },
        PetSeed { id: "pet-scallion", species: "scallion", name: "葱葱初音", personality: "lively", unlock: "shop", rarity: "SR", price: 160 },
        PetSeed { id: "pet-codey", species: "codey", name: "码音", personality: "calm", unlock: "shop", rarity: "R", price: 120 },
        PetSeed { id: "pet-rosycoder", species: "rosycoder", name: "玫音", personality: "clingy", unlock: "shop", rarity: "SR", price: 145 },
        PetSeed { id: "pet-nako", species: "nako", name: "中野", personality: "calm", unlock: "shop", rarity: "R", price: 115 },
        // digi
        PetSeed { id: "pet-digibaby", species: "digibaby", name: "滚球兽", personality: "clingy", unlock: "default", rarity: "N", price: 0 },
        PetSeed { id: "pet-agumon", species: "agumon", name: "亚古兽", personality: "lively", unlock: "default", rarity: "R", price: 0 },
        PetSeed { id: "pet-agumon2", species: "agumon2", name: "战斗亚古兽", personality: "lively", unlock: "shop", rarity: "R", price: 100 },
        PetSeed { id: "pet-gabumon", species: "gabumon", name: "加布兽", personality: "calm", unlock: "shop", rarity: "R", price: 100 },
        PetSeed { id: "pet-guilmon", species: "guilmon", name: "古拉兽", personality: "lively", unlock: "shop", rarity: "SR", price: 130 },
        PetSeed { id: "pet-veemon", species: "veemon", name: "Ｖ仔兽", personality: "lively", unlock: "login", rarity: "R", price: 0 },
        PetSeed { id: "pet-angemon", species: "angemon", name: "天女兽", personality: "calm", unlock: "shop", rarity: "SR", price: 150 },
        PetSeed { id: "pet-kaizer", species: "kaizer", name: "帝皇龙甲兽", personality: "lively", unlock: "shop", rarity: "SSR", price: 220 },
        // fantasy
        PetSeed { id: "pet-yinyue", species: "yinyue", name: "银月狐", personality: "calm", unlock: "default", rarity: "R", price: 0 },
        PetSeed { id: "pet-nightly", species: "nightly", name: "夜行狐", personality: "calm", unlock: "shop", rarity: "R", price: 110 },
        PetSeed { id: "pet-frieren", species: "frieren", name: "芙莉莲", personality: "calm", unlock: "shop", rarity: "SR", price: 150 },
        PetSeed { id: "pet-chibi", species: "chibi", name: "小芙莉莲", personality: "clingy", unlock: "login", rarity: "R", price: 0 },
        PetSeed { id: "pet-silvertrail", species: "silvertrail", name: "芙莉莲·杖", personality: "calm", unlock: "shop", rarity: "SR", price: 155 },
        PetSeed { id: "pet-sleepmage", species: "sleepmage", name: "芙莉莲·眠", personality: "calm", unlock: "shop", rarity: "R", price: 125 },
        // star
        PetSeed { id: "pet-kaka", species: "kaka", name: "卡卡", personality: "lively", unlock: "default", rarity: "N", price: 0 },
        PetSeed { id: "pet-kaka5", species: "kaka5", name: "暖卡卡", personality: "clingy", unlock: "shop", rarity: "R", price: 90 },
        PetSeed { id: "pet-kakastar", species: "kakastar", name: "咖咖星", personality: "lively", unlock: "shop", rarity: "SR", price: 135 },
        PetSeed { id: "pet-kakadawang", species: "kakadawang", name: "卡卡大王", personality: "lively", unlock: "shop", rarity: "SSR", price: 210 },
        PetSeed { id: "pet-kakaqueen", species: "kakaqueen", name: "卡卡女王", personality: "calm", unlock: "shop", rarity: "SSR", price: 200 },
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
            },
            shop_catalog: default_shop_catalog(),
            chat_history: Vec::new(),
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
    state.wallet.coin = state.wallet.coin.max(9999);
    state.wallet.gem = state.wallet.gem.max(999);
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
    catalog()
        .into_iter()
        .filter(|s| s.unlock == "shop" && s.price > 0)
        .map(|s| ShopProduct {
            id: format!("shop-{}", s.species),
            sku: format!("pet.{}.unlock", s.species),
            r#type: "pet_unlock".into(),
            target_id: s.species.into(),
            currency: "coin".into(),
            amount: s.price,
            rarity: s.rarity.into(),
            available: true,
            name: format!("解锁·{}", s.name),
            iap_product_id: None,
        })
        .chain(std::iter::once(ShopProduct {
            id: "shop-iap-preview".into(),
            sku: "pet.kaizer.iap".into(),
            r#type: "pet_unlock".into(),
            target_id: "kaizer".into(),
            currency: "real".into(),
            amount: 12,
            rarity: "SSR".into(),
            available: false,
            name: "帝皇龙甲兽（即将开放）".into(),
            iap_product_id: Some("com.fluffnest.pet.kaizer".into()),
        }))
        .collect()
}

pub fn reward_for_streak(streak: i32) -> DailyReward {
    let day = ((streak - 1).rem_euclid(7)) + 1;
    match day {
        1 => DailyReward {
            kind: "coin".into(),
            target_id: "coin".into(),
            amount: 40,
            label: "每日金币 ×40".into(),
        },
        2 => DailyReward {
            kind: "pet".into(),
            target_id: "cheese".into(),
            amount: 1,
            label: "解锁宠物·芝芝".into(),
        },
        3 => DailyReward {
            kind: "coin".into(),
            target_id: "coin".into(),
            amount: 60,
            label: "每日金币 ×60".into(),
        },
        4 => DailyReward {
            kind: "pet".into(),
            target_id: "pinky".into(),
            amount: 1,
            label: "解锁宠物·粉珍珠".into(),
        },
        5 => DailyReward {
            kind: "pet".into(),
            target_id: "veemon".into(),
            amount: 1,
            label: "解锁宠物·Ｖ仔兽".into(),
        },
        6 => DailyReward {
            kind: "pet".into(),
            target_id: "puppyhat".into(),
            amount: 1,
            label: "解锁宠物·小狗帽".into(),
        },
        _ => DailyReward {
            kind: "pet".into(),
            target_id: "chibi".into(),
            amount: 1,
            label: "解锁宠物·小芙莉莲".into(),
        },
    }
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

pub fn prepare_daily_login(state: &mut AppState) {
    let today = today_local();
    let claimed = state
        .daily_login
        .last_claim_date
        .as_ref()
        .map(|d| d == &today)
        .unwrap_or(false);
    state.daily_login.claimed_today = claimed;
    if !claimed {
        let next_streak = match &state.daily_login.last_claim_date {
            Some(prev) => {
                let yesterday = (chrono::Local::now().date_naive() - chrono::Duration::days(1))
                    .format("%Y-%m-%d")
                    .to_string();
                if prev == &yesterday {
                    state.daily_login.streak + 1
                } else {
                    1
                }
            }
            None => 1,
        };
        state.daily_login.pending_rewards = vec![reward_for_streak(next_streak.max(1))];
    } else {
        state.daily_login.pending_rewards.clear();
    }
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
    prepare_daily_login(&mut state);
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
