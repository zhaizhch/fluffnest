use crate::state::{
    prepare_daily_login, reward_for_streak, save_state, sync_daily_care, take_bond_budget,
    today_string, AppState, DailyLogin, OwnedAction, PetInstance, ReminderRule, Settings, Wallet,
};
use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

pub struct SharedState(pub std::sync::Mutex<AppState>);

fn with_state<F, T>(app: &AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&mut AppState) -> Result<T, String>,
{
    let shared = app.state::<SharedState>();
    let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
    let result = f(&mut guard)?;
    save_state(app, &guard)?;
    Ok(result)
}

fn unlock_action(state: &mut AppState, action_id: &str) {
    if !state.owned_actions.iter().any(|a| a.action_id == action_id) {
        state.owned_actions.push(OwnedAction {
            action_id: action_id.into(),
            obtained_at: Utc::now().to_rfc3339(),
        });
    }
}

fn unlock_pet(state: &mut AppState, species_id: &str) {
    if let Some(p) = state.pets.iter_mut().find(|p| p.species_id == species_id) {
        p.unlocked = true;
    }
}

#[tauri::command]
pub fn get_state(app: AppHandle) -> Result<AppState, String> {
    let shared = app.state::<SharedState>();
    let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
    prepare_daily_login(&mut guard);
    sync_daily_care(&mut guard);
    Ok(guard.clone())
}

#[tauri::command]
pub fn get_active_pet(app: AppHandle) -> Result<PetInstance, String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    guard
        .pets
        .iter()
        .find(|p| p.is_active && p.unlocked)
        .cloned()
        .ok_or_else(|| "no active pet".into())
}

#[tauri::command]
pub fn interact(app: AppHandle, action: String) -> Result<PetInstance, String> {
    with_state(&app, |state| {
        sync_daily_care(state);
        let idx = state
            .pets
            .iter()
            .position(|p| p.is_active && p.unlocked)
            .ok_or_else(|| "no active pet".to_string())?;

        let (bond_want, mood_delta): (i32, i32) = match action.as_str() {
            "pet" | "pat" => (1, 8),
            "poke" => (1, 4),
            "hug" => (3, 10),
            "tickle" => (2, 9),
            "play" => (2, 12),
            "feed" => (2, 5),
            _ => (0, 0),
        };

        {
            let pet = &mut state.pets[idx];
            pet.mood = (pet.mood + mood_delta).clamp(0, 100);
            pet.last_interact_at = Utc::now().to_rfc3339();
        }

        let bond_before = state.pets[idx].bond;
        let gained = take_bond_budget(state, bond_want);
        state.pets[idx].bond += gained;

        let mut gift = 0i32;
        let thresholds: &[(i32, i32)] = &[(20, 8), (60, 12), (120, 20), (220, 35)];
        for &(min_bond, coins) in thresholds {
            if bond_before < min_bond && state.pets[idx].bond >= min_bond {
                gift = coins;
            }
        }
        if gift > 0 {
            state.wallet.coin += gift;
            let _ = app.emit("wallet-updated", state.wallet.clone());
        }

        let snapshot = state.pets[idx].clone();
        let _ = app.emit("pet-updated", snapshot.clone());
        let _ = app.emit(
            "pet-action",
            serde_json::json!({
                "action": action,
                "speciesId": snapshot.species_id,
                "bondGift": gift,
                "bond": snapshot.bond,
                "bondGained": gained,
                "bondCapped": bond_want > 0 && gained < bond_want,
            }),
        );
        Ok(snapshot)
    })
}

#[tauri::command]
pub fn switch_pet(app: AppHandle, pet_id: String) -> Result<PetInstance, String> {
    with_state(&app, |state| {
        let target = state
            .pets
            .iter()
            .find(|p| p.id == pet_id)
            .ok_or_else(|| "pet not found".to_string())?;
        if !target.unlocked {
            return Err("pet locked — claim daily login or buy in shop".into());
        }
        for p in state.pets.iter_mut() {
            p.is_active = p.id == pet_id;
        }
        let pet = state
            .pets
            .iter()
            .find(|p| p.is_active)
            .cloned()
            .ok_or_else(|| "no active pet".to_string())?;
        let _ = app.emit("pet-updated", pet.clone());
        let _ = app.emit(
            "pet-action",
            serde_json::json!({ "action": "switch", "speciesId": pet.species_id }),
        );
        Ok(pet)
    })
}

#[tauri::command]
pub fn update_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    with_state(&app, |state| {
        let was_proactive = state.settings.llm.proactive_enabled;
        state.settings = settings.clone();
        // Seed timers so first auto push waits a full interval after enabling
        if state.settings.llm.proactive_enabled && !was_proactive {
            let now = Utc::now().to_rfc3339();
            if state.settings.llm.last_joke_at.is_none() {
                state.settings.llm.last_joke_at = Some(now.clone());
            }
            if state.settings.llm.last_news_at.is_none() {
                state.settings.llm.last_news_at = Some(now);
            }
        }
        if state.settings.is_admin {
            crate::state::grant_admin_unlocks(state);
        }
        if let Some(win) = app.get_webview_window("pet") {
            let _ = win.set_always_on_top(state.settings.always_on_top);
        }
        let _ = app.emit("settings-updated", state.settings.clone());
        Ok(state.settings.clone())
    })
}

#[tauri::command]
pub fn upsert_reminder(app: AppHandle, reminder: ReminderRule) -> Result<Vec<ReminderRule>, String> {
    with_state(&app, |state| {
        if let Some(existing) = state.reminders.iter_mut().find(|r| r.id == reminder.id) {
            *existing = reminder;
        } else {
            state.reminders.push(reminder);
        }
        Ok(state.reminders.clone())
    })
}

#[tauri::command]
pub fn add_meeting_reminder(
    app: AppHandle,
    title: String,
    at: String,
) -> Result<ReminderRule, String> {
    with_state(&app, |state| {
        let rule = ReminderRule {
            id: format!("rem-{}", Uuid::new_v4()),
            r#type: "meeting".into(),
            title: Some(title),
            interval_minutes: None,
            at: Some(at),
            enabled: true,
            snooze_minutes: 5,
            last_fired_at: None,
        };
        state.reminders.push(rule.clone());
        Ok(rule)
    })
}

/// Quick create / enable water · stretch · meeting reminders from the pet menu.
#[tauri::command]
pub fn quick_set_reminder(
    app: AppHandle,
    kind: String,
    title: Option<String>,
    at: Option<String>,
    interval_minutes: Option<i32>,
) -> Result<ReminderRule, String> {
    with_state(&app, |state| {
        match kind.as_str() {
            "water" | "stretch" => {
                let (id, default_title, default_interval) = if kind == "water" {
                    ("rem-water", "喝水", 60)
                } else {
                    ("rem-stretch", "久坐起身", 45)
                };
                let interval = interval_minutes
                    .unwrap_or(default_interval)
                    .clamp(5, 24 * 60);
                if let Some(existing) = state.reminders.iter_mut().find(|r| r.id == id) {
                    existing.enabled = true;
                    existing.interval_minutes = Some(interval);
                    existing.title = Some(default_title.into());
                    existing.last_fired_at = None;
                    return Ok(existing.clone());
                }
                let rule = ReminderRule {
                    id: id.into(),
                    r#type: kind.clone(),
                    title: Some(default_title.into()),
                    interval_minutes: Some(interval),
                    at: None,
                    enabled: true,
                    snooze_minutes: 5,
                    last_fired_at: None,
                };
                state.reminders.push(rule.clone());
                Ok(rule)
            }
            "meeting" => {
                let when = at.ok_or_else(|| "请选择会议时间".to_string())?;
                let name = title
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "会议".into());
                let rule = ReminderRule {
                    id: format!("rem-{}", Uuid::new_v4()),
                    r#type: "meeting".into(),
                    title: Some(name),
                    interval_minutes: None,
                    at: Some(when),
                    enabled: true,
                    snooze_minutes: 5,
                    last_fired_at: None,
                };
                state.reminders.push(rule.clone());
                Ok(rule)
            }
            _ => Err(format!("未知提醒类型: {kind}")),
        }
    })
}

#[tauri::command]
pub fn delete_reminder(app: AppHandle, id: String) -> Result<Vec<ReminderRule>, String> {
    with_state(&app, |state| {
        state.reminders.retain(|r| r.id != id);
        Ok(state.reminders.clone())
    })
}

#[tauri::command]
pub fn complete_reminder(app: AppHandle, id: String) -> Result<Wallet, String> {
    with_state(&app, |state| {
        sync_daily_care(state);
        let idx = state
            .pets
            .iter()
            .position(|p| p.is_active && p.unlocked)
            .ok_or_else(|| "no active pet".to_string())?;

        if let Some(rule) = state.reminders.iter_mut().find(|r| r.id == id) {
            rule.last_fired_at = Some(Utc::now().to_rfc3339());
        }

        let gained = take_bond_budget(state, 3);
        state.pets[idx].bond += gained;
        state.pets[idx].mood = (state.pets[idx].mood + 5).min(100);

        state.wallet.coin += 5;
        let snapshot = state.pets[idx].clone();
        let _ = app.emit("pet-updated", snapshot);
        let _ = app.emit("wallet-updated", state.wallet.clone());
        Ok(state.wallet.clone())
    })
}

#[tauri::command]
pub fn purchase_product(app: AppHandle, product_id: String) -> Result<AppState, String> {
    with_state(&app, |state| {
        let product = state
            .shop_catalog
            .iter()
            .find(|p| p.id == product_id)
            .cloned()
            .ok_or_else(|| "product not found".to_string())?;

        if !product.available {
            return Err("product unavailable (coming soon)".into());
        }
        if product.currency == "real" {
            return Err("real IAP not enabled in v1".into());
        }

        let already = match product.r#type.as_str() {
            "action" => state
                .owned_actions
                .iter()
                .any(|a| a.action_id == product.target_id),
            "pet_unlock" => state
                .pets
                .iter()
                .any(|p| p.species_id == product.target_id && p.unlocked),
            _ => false,
        };
        if already {
            return Err("already owned".into());
        }

        match product.currency.as_str() {
            "coin" => {
                if state.wallet.coin < product.amount {
                    return Err("insufficient coin".into());
                }
                state.wallet.coin -= product.amount;
            }
            "gem" => {
                if state.wallet.gem < product.amount {
                    return Err("insufficient gem".into());
                }
                state.wallet.gem -= product.amount;
            }
            _ => return Err("unsupported currency".into()),
        }

        match product.r#type.as_str() {
            "action" => unlock_action(state, &product.target_id),
            "pet_unlock" => unlock_pet(state, &product.target_id),
            _ => return Err("unsupported product type".into()),
        }

        Ok(state.clone())
    })
}

#[tauri::command]
pub fn claim_daily_login(app: AppHandle) -> Result<AppState, String> {
    with_state(&app, |state| {
        prepare_daily_login(state);
        if state.daily_login.claimed_today {
            return Err("already claimed today".into());
        }

        let today = today_string();
        let yesterday = (chrono::Local::now().date_naive() - chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();
        let next_streak = match &state.daily_login.last_claim_date {
            Some(prev) if prev == &yesterday => state.daily_login.streak + 1,
            Some(prev) if prev == &today => state.daily_login.streak,
            _ => 1,
        };

        let reward = reward_for_streak(next_streak);
        let mut applied = reward.clone();
        match reward.kind.as_str() {
            "coin" => state.wallet.coin += reward.amount,
            "action" => unlock_action(state, &reward.target_id),
            "pet" => {
                let already = state
                    .pets
                    .iter()
                    .any(|p| p.species_id == reward.target_id && p.unlocked);
                if already {
                    const FALLBACK: i32 = 80;
                    state.wallet.coin += FALLBACK;
                    applied.kind = "coin".into();
                    applied.target_id = "coin".into();
                    applied.amount = FALLBACK;
                    applied.label = format!(
                        "已拥有该宠物，折合金币 ×{}",
                        FALLBACK
                    );
                } else {
                    unlock_pet(state, &reward.target_id);
                }
            }
            _ => {}
        }

        state.daily_login = DailyLogin {
            last_claim_date: Some(today),
            streak: next_streak,
            total_days: state.daily_login.total_days + 1,
            pending_rewards: vec![],
            claimed_today: true,
        };

        let _ = app.emit("daily-claimed", applied);
        let _ = app.emit("wallet-updated", state.wallet.clone());
        Ok(state.clone())
    })
}

#[tauri::command]
pub fn tick_idle(app: AppHandle) -> Result<PetInstance, String> {
    with_state(&app, |state| {
        let pet = state
            .pets
            .iter_mut()
            .find(|p| p.is_active && p.unlocked)
            .ok_or_else(|| "no active pet".to_string())?;
        // Gentle mood recovery while hanging out
        if pet.mood < 100 {
            let gain = if state.settings.focus_mode { 1 } else { 2 };
            pet.mood = (pet.mood + gain).min(100);
        }
        let snapshot = pet.clone();
        let _ = app.emit("pet-updated", snapshot.clone());
        Ok(snapshot)
    })
}

#[tauri::command]
pub fn get_owned_actions(app: AppHandle) -> Result<Vec<String>, String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    Ok(guard
        .owned_actions
        .iter()
        .map(|a| a.action_id.clone())
        .collect())
}

fn active_pet_snapshot(state: &AppState) -> Result<PetInstance, String> {
    state
        .pets
        .iter()
        .find(|p| p.is_active && p.unlocked)
        .cloned()
        .ok_or_else(|| "no active pet".into())
}

/// Generate a short in-character bubble line (click / interact / reminder / …).
/// Runs on a blocking pool so the UI stays responsive.
#[tauri::command]
pub async fn generate_pet_line(
    app: AppHandle,
    kind: String,
    action: String,
    extra: Option<String>,
) -> Result<String, String> {
    let (llm, pet) = {
        let shared = app.state::<SharedState>();
        let guard = shared.0.lock().map_err(|e| e.to_string())?;
        if !guard.settings.llm.enabled || !guard.settings.llm.dialogue_enabled {
            return Err("AI 台词未开启".into());
        }
        (guard.settings.llm.clone(), active_pet_snapshot(&guard)?)
    };

    tauri::async_runtime::spawn_blocking(move || {
        crate::llm::generate_bubble_line(&llm, &pet, &kind, &action, extra.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Chat with the active pet; persists history and emits `pet-says`.
#[tauri::command]
pub async fn chat_with_pet(
    app: AppHandle,
    message: String,
) -> Result<crate::llm::ChatMessage, String> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("消息不能为空".into());
    }
    if message.chars().count() > 200 {
        return Err("消息太长啦".into());
    }

    let (llm, pet, history) = {
        let shared = app.state::<SharedState>();
        let guard = shared.0.lock().map_err(|e| e.to_string())?;
        if !guard.settings.llm.enabled || !guard.settings.llm.chat_enabled {
            return Err("请先开启 AI 对话".into());
        }
        let pet = active_pet_snapshot(&guard)?;
        (
            guard.settings.llm.clone(),
            pet,
            guard.chat_history.clone(),
        )
    };

    let reply = {
        let llm = llm.clone();
        let pet = pet.clone();
        let history = history.clone();
        let message = message.clone();
        tauri::async_runtime::spawn_blocking(move || {
            crate::llm::generate_chat_reply(&llm, &pet, &history, &message)
        })
        .await
        .map_err(|e| e.to_string())??
    };

    let now = Utc::now().to_rfc3339();
    let user_msg = crate::llm::ChatMessage {
        role: "user".into(),
        content: message,
        at: now.clone(),
    };
    let assistant_msg = crate::llm::ChatMessage {
        role: "assistant".into(),
        content: reply.clone(),
        at: now,
    };

    {
        let shared = app.state::<SharedState>();
        let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
        if let Some(p) = guard.pets.iter_mut().find(|p| p.is_active && p.unlocked) {
            p.mood = (p.mood + 2).min(100);
            let _ = app.emit("pet-updated", p.clone());
        }
        guard.chat_history.push(user_msg);
        guard.chat_history.push(assistant_msg.clone());
        if guard.chat_history.len() > 40 {
            let drain = guard.chat_history.len() - 40;
            guard.chat_history.drain(0..drain);
        }
        save_state(&app, &guard)?;
    }

    let _ = app.emit(
        "pet-says",
        crate::llm::PetSaysPayload {
            text: reply,
            kind: "chat".into(),
            behavior: Some("wave".into()),
        },
    );

    Ok(assistant_msg)
}

#[tauri::command]
pub fn get_chat_history(app: AppHandle) -> Result<Vec<crate::llm::ChatMessage>, String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.chat_history.clone())
}

#[tauri::command]
pub fn clear_chat_history(app: AppHandle) -> Result<(), String> {
    with_state(&app, |state| {
        state.chat_history.clear();
        Ok(())
    })
}

/// Quick connectivity check from settings.
#[tauri::command]
pub async fn test_llm(app: AppHandle) -> Result<String, String> {
    let (llm, pet) = {
        let shared = app.state::<SharedState>();
        let guard = shared.0.lock().map_err(|e| e.to_string())?;
        (guard.settings.llm.clone(), active_pet_snapshot(&guard)?)
    };
    tauri::async_runtime::spawn_blocking(move || {
        crate::llm::generate_bubble_line(&llm, &pet, "click", "打招呼", None)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Manually trigger weather / joke / news (also used by poller).
#[tauri::command]
pub async fn trigger_proactive(
    app: AppHandle,
    kind: String,
) -> Result<crate::llm::PetSaysPayload, String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || run_proactive(&app2, &kind))
        .await
        .map_err(|e| e.to_string())?
}

pub fn run_proactive(app: &AppHandle, kind: &str) -> Result<crate::llm::PetSaysPayload, String> {
    let (llm, pet, focus, muted) = {
        let shared = app.state::<SharedState>();
        let guard = shared.0.lock().map_err(|e| e.to_string())?;
        if !guard.settings.llm.enabled {
            return Err("AI 未开启".into());
        }
        (
            guard.settings.llm.clone(),
            active_pet_snapshot(&guard)?,
            guard.settings.focus_mode,
            guard.settings.muted,
        )
    };

    if focus {
        return Err("专注模式中，宠物先安静一下".into());
    }

    let (text, behavior) = match kind {
        "weather" => {
            let summary = crate::llm::fetch_weather_summary(&llm.weather_city)?;
            let line =
                crate::llm::generate_bubble_line(&llm, &pet, "weather", "天气", Some(&summary))
                    .unwrap_or(summary);
            (line, crate::llm::proactive_kind_behavior("weather"))
        }
        "joke" => {
            let line = crate::llm::generate_bubble_line(&llm, &pet, "joke", "冷笑话", None)?;
            (line, crate::llm::proactive_kind_behavior("joke"))
        }
        "news" => {
            let headline = crate::llm::fetch_hot_headline()?;
            let line =
                crate::llm::generate_bubble_line(&llm, &pet, "news", "科技娱乐", Some(&headline))?;
            (line, crate::llm::proactive_kind_behavior("news"))
        }
        _ => return Err(format!("未知推送类型: {kind}")),
    };

    {
        let shared = app.state::<SharedState>();
        let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
        let today = today_string();
        match kind {
            "weather" => guard.settings.llm.last_weather_date = Some(today),
            "joke" => guard.settings.llm.last_joke_at = Some(Utc::now().to_rfc3339()),
            "news" => guard.settings.llm.last_news_at = Some(Utc::now().to_rfc3339()),
            _ => {}
        }
        let _ = save_state(app, &guard);
    }

    let payload = crate::llm::PetSaysPayload {
        text: text.clone(),
        kind: kind.into(),
        behavior: Some(behavior.into()),
    };
    let _ = app.emit("pet-says", payload.clone());
    let _ = app.emit("proactive-message", payload.clone());

    if !muted {
        let _ = app
            .notification()
            .builder()
            .title(&pet.name)
            .body(&text)
            .show();
    }

    Ok(payload)
}

/// Synthesize one line with Microsoft Edge neural TTS (natural Mandarin).
#[tauri::command]
pub async fn synthesize_speech(
    app: AppHandle,
    text: String,
    personality: Option<String>,
) -> Result<crate::tts::TtsAudio, String> {
    let personality = {
        if let Some(p) = personality.filter(|s| !s.trim().is_empty()) {
            p
        } else {
            let shared = app.state::<SharedState>();
            let guard = shared.0.lock().map_err(|e| e.to_string())?;
            active_pet_snapshot(&guard)?.personality
        }
    };
    let text = text.trim().to_string();
    tauri::async_runtime::spawn_blocking(move || crate::tts::synthesize(&text, &personality))
        .await
        .map_err(|e| e.to_string())?
}

/// Synthesize + play via macOS afplay (reminder-safe; not blocked by webview autoplay).
#[tauri::command]
pub async fn speak_speech(
    app: AppHandle,
    text: String,
    personality: Option<String>,
) -> Result<(), String> {
    let personality = {
        if let Some(p) = personality.filter(|s| !s.trim().is_empty()) {
            p
        } else {
            let shared = app.state::<SharedState>();
            let guard = shared.0.lock().map_err(|e| e.to_string())?;
            active_pet_snapshot(&guard)?.personality
        }
    };
    let text = text.trim().to_string();
    tauri::async_runtime::spawn_blocking(move || crate::tts::speak(&text, &personality))
        .await
        .map_err(|e| e.to_string())?
}

/// LLM batch of personality-matched spoken lines for care-alert dance.
#[tauri::command]
pub async fn generate_care_voice_lines(
    app: AppHandle,
    kind: String,
    count: Option<u32>,
    avoid: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let (llm, pet) = {
        let shared = app.state::<SharedState>();
        let guard = shared.0.lock().map_err(|e| e.to_string())?;
        if !guard.settings.llm.enabled || !guard.settings.llm.dialogue_enabled {
            return Err("AI 台词未开启".into());
        }
        (guard.settings.llm.clone(), active_pet_snapshot(&guard)?)
    };
    let n = count.unwrap_or(8) as usize;
    let kind = kind.clone();
    let avoid = avoid.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        crate::llm::generate_care_voice_lines(&llm, &pet, &kind, n, &avoid)
    })
    .await
    .map_err(|e| e.to_string())?
}

