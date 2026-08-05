use crate::state::{
    save_state, sync_daily_care, take_bond_budget, today_string, AppState, PetInstance,
    ReminderRule, ScheduleJob, Settings,
};
use chrono::{Datelike, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};
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

#[tauri::command]
pub fn get_state(app: AppHandle) -> Result<AppState, String> {
    let shared = app.state::<SharedState>();
    let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
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

        let snapshot = state.pets[idx].clone();
        let _ = app.emit("pet-updated", snapshot.clone());
        let _ = app.emit(
            "pet-action",
            serde_json::json!({
                "action": action,
                "speciesId": snapshot.species_id,
                "bond": snapshot.bond,
                "bondGained": gained,
                "bondCapped": bond_want > 0 && gained < bond_want,
                "tierCrossed": bond_before < snapshot.bond
                    && [(20, "熟悉"), (60, "好友"), (120, "挚友"), (220, "心灵相通")]
                        .iter()
                        .any(|&(min, _)| bond_before < min && snapshot.bond >= min),
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
            return Err("宠物未解锁".into());
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

fn normalize_personality(raw: &str) -> Result<&'static str, String> {
    match raw.trim() {
        "calm" => Ok("calm"),
        "lively" => Ok("lively"),
        "clingy" => Ok("clingy"),
        "tsundere" => Ok("tsundere"),
        "clever" => Ok("clever"),
        other => Err(format!("未知性格类型: {other}")),
    }
}

/// Change the active (or specified) pet's personality. Every unlocked pet can switch.
#[tauri::command]
pub fn set_pet_personality(
    app: AppHandle,
    personality: String,
    pet_id: Option<String>,
) -> Result<PetInstance, String> {
    let personality = normalize_personality(&personality)?.to_string();
    with_state(&app, |state| {
        let target_id = if let Some(id) = pet_id.filter(|s| !s.trim().is_empty()) {
            id
        } else {
            state
                .pets
                .iter()
                .find(|p| p.is_active)
                .map(|p| p.id.clone())
                .ok_or_else(|| "没有当前宠物".to_string())?
        };
        let pet = state
            .pets
            .iter_mut()
            .find(|p| p.id == target_id)
            .ok_or_else(|| "pet not found".to_string())?;
        if !pet.unlocked {
            return Err("宠物尚未解锁".into());
        }
        pet.personality = personality;
        let snapshot = pet.clone();
        let _ = app.emit("pet-updated", snapshot.clone());
        Ok(snapshot)
    })
}

#[tauri::command]
pub fn update_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    with_state(&app, |state| {
        let was_proactive = state.settings.llm.proactive_enabled;
        let wechat_before = state.settings.wechat.clone();
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
        let wechat_changed = wechat_before.clawbot_enabled != state.settings.wechat.clawbot_enabled
            || wechat_before.notif_enabled != state.settings.wechat.notif_enabled;
        let _ = app.emit("settings-updated", state.settings.clone());
        if wechat_changed {
            let app2 = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(80));
                crate::im::sync_bridges(&app2);
            });
        }
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

/// Disable water / stretch (or a meeting by id) without deleting the rule.
#[tauri::command]
pub fn quick_disable_reminder(
    app: AppHandle,
    kind: String,
    id: Option<String>,
) -> Result<ReminderRule, String> {
    with_state(&app, |state| {
        let target_id = id.unwrap_or_else(|| match kind.as_str() {
            "water" => "rem-water".into(),
            "stretch" => "rem-stretch".into(),
            other => other.to_string(),
        });
        if let Some(rule) = state
            .reminders
            .iter_mut()
            .find(|r| r.id == target_id || r.r#type == kind)
        {
            rule.enabled = false;
            return Ok(rule.clone());
        }
        Err(format!("未找到提醒: {kind}"))
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderStatusItem {
    pub id: String,
    pub r#type: String,
    pub title: Option<String>,
    pub enabled: bool,
    pub interval_minutes: Option<i32>,
    pub at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderStatus {
    pub water: Option<ReminderStatusItem>,
    pub stretch: Option<ReminderStatusItem>,
    pub meetings: Vec<ReminderStatusItem>,
    pub summary: String,
}

#[tauri::command]
pub fn reminder_status(app: AppHandle) -> Result<ReminderStatus, String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    Ok(build_reminder_status(&guard.reminders))
}

pub fn build_reminder_status(reminders: &[ReminderRule]) -> ReminderStatus {
    let to_item = |r: &ReminderRule| ReminderStatusItem {
        id: r.id.clone(),
        r#type: r.r#type.clone(),
        title: r.title.clone(),
        enabled: r.enabled,
        interval_minutes: r.interval_minutes,
        at: r.at.clone(),
    };
    let water = reminders.iter().find(|r| r.id == "rem-water" || r.r#type == "water").map(to_item);
    let stretch = reminders
        .iter()
        .find(|r| r.id == "rem-stretch" || r.r#type == "stretch")
        .map(to_item);
    let meetings: Vec<_> = reminders
        .iter()
        .filter(|r| r.r#type == "meeting" && r.enabled)
        .map(to_item)
        .collect();
    let fmt = |item: &Option<ReminderStatusItem>, label: &str| match item {
        Some(r) if r.enabled => format!(
            "{label}：开着（每 {} 分）",
            r.interval_minutes.unwrap_or(0)
        ),
        Some(_) => format!("{label}：关着"),
        None => format!("{label}：未设置"),
    };
    let mut parts = vec![fmt(&water, "喝水"), fmt(&stretch, "久坐")];
    if !meetings.is_empty() {
        parts.push(format!("会议：{} 条进行中", meetings.len()));
    }
    ReminderStatus {
        water,
        stretch,
        meetings,
        summary: parts.join(" · "),
    }
}

#[tauri::command]
pub fn upsert_schedule(app: AppHandle, job: ScheduleJob) -> Result<Vec<ScheduleJob>, String> {
    with_state(&app, |state| {
        crate::schedules::upsert_job(state, job);
        Ok(state.schedules.clone())
    })
}

#[tauri::command]
pub fn delete_schedule(app: AppHandle, id: String) -> Result<Vec<ScheduleJob>, String> {
    with_state(&app, |state| {
        crate::schedules::delete_job(state, &id);
        Ok(state.schedules.clone())
    })
}

#[tauri::command]
pub fn list_schedules(app: AppHandle) -> Result<Vec<ScheduleJob>, String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.schedules.clone())
}

/// Build host snapshot JSON for the WeChat agent.
pub fn host_snapshot_json(state: &AppState) -> Value {
    let reminders: Vec<Value> = state
        .reminders
        .iter()
        .map(|r| {
            json!({
                "id": r.id,
                "type": r.r#type,
                "title": r.title,
                "enabled": r.enabled,
                "intervalMinutes": r.interval_minutes,
                "at": r.at,
            })
        })
        .collect();
    let schedules: Vec<Value> = state
        .schedules
        .iter()
        .map(|j| {
            json!({
                "id": j.id,
                "title": j.title,
                "kind": j.kind,
                "channel": j.channel,
                "enabled": j.enabled,
                "hour": j.hour,
                "minute": j.minute,
                "daysOfWeek": j.days_of_week,
                "params": j.params,
            })
        })
        .collect();
    let owner_ready = state
        .wechat_auth
        .owner_peer_id
        .as_ref()
        .map(|s| !s.is_empty())
        .unwrap_or(false)
        && state
            .wechat_auth
            .owner_context_token
            .as_ref()
            .map(|s| !s.is_empty())
            .unwrap_or(false);
    json!({
        "reminders": reminders,
        "schedules": schedules,
        "ownerReady": owner_ready,
        "reminderSummary": build_reminder_status(&state.reminders).summary,
    })
}

pub fn apply_host_actions(app: &AppHandle, actions: &[Value]) -> Vec<String> {
    if actions.is_empty() {
        return Vec::new();
    }
    let shared = app.state::<SharedState>();
    let mut guard = match shared.0.lock() {
        Ok(g) => g,
        Err(e) => return vec![format!("lock error: {e}")],
    };
    let mut notes = Vec::new();
    for action in actions {
        let op = action
            .get("op")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let args = action
            .get("args")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_else(Map::new);
        let note = crate::schedules::apply_host_action(&mut guard, &op, &args);
        notes.push(note);
    }
    let _ = save_state(app, &guard);
    notes
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
            detail: None,
            message_id: None,
            auto_replying: None,
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

/// Manually trigger weather / joke / news / fortune (also used by poller).
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

fn weekday_zh(weekday: chrono::Weekday) -> &'static str {
    match weekday {
        chrono::Weekday::Mon => "周一",
        chrono::Weekday::Tue => "周二",
        chrono::Weekday::Wed => "周三",
        chrono::Weekday::Thu => "周四",
        chrono::Weekday::Fri => "周五",
        chrono::Weekday::Sat => "周六",
        chrono::Weekday::Sun => "周日",
    }
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

    let today = today_string();
    let mut detail: Option<String> = None;
    let (text, behavior) = match kind {
        "weather" => {
            let (line, summary) = crate::llm::generate_weather_bubble(&llm, &pet)?;
            detail = Some(summary);
            (line, crate::llm::proactive_kind_behavior("weather"))
        }
        "joke" => {
            let line = crate::llm::generate_bubble_line(&llm, &pet, "joke", "冷笑话", None)?;
            (line, crate::llm::proactive_kind_behavior("joke"))
        }
        "news" => {
            let (line, summary) = crate::llm::generate_news_bubble(&llm, &pet)?;
            detail = Some(summary);
            (line, crate::llm::proactive_kind_behavior("news"))
        }
        "fortune" => {
            // Same-day cache: return instantly without another LLM call.
            if llm.last_fortune_date.as_deref() == Some(today.as_str()) {
                if let Some(cached) = llm.cached_fortune.clone().filter(|s| !s.trim().is_empty()) {
                    let payload = crate::llm::PetSaysPayload {
                        text: cached,
                        kind: "fortune".into(),
                        behavior: Some(crate::llm::proactive_kind_behavior("fortune").into()),
                        detail: None,
                        message_id: None,
                        auto_replying: None,
                    };
                    let _ = app.emit("pet-says", payload.clone());
                    let _ = app.emit("proactive-message", payload.clone());
                    return Ok(payload);
                }
            }

            let weather = crate::llm::fetch_weather_summary(&llm.weather_city).ok();
            let now = chrono::Local::now();
            let date_label = now.format("%Y年%m月%d日").to_string();
            let weekday = weekday_zh(now.weekday());
            let fortune = crate::llm::generate_daily_fortune(
                &llm,
                &pet,
                &date_label,
                weekday,
                &llm.weather_city,
                weather.as_deref(),
            )?;
            (fortune, crate::llm::proactive_kind_behavior("fortune"))
        }
        _ => return Err(format!("未知推送类型: {kind}")),
    };

    {
        let shared = app.state::<SharedState>();
        let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
        match kind {
            "weather" => guard.settings.llm.last_weather_date = Some(today.clone()),
            "joke" => guard.settings.llm.last_joke_at = Some(Utc::now().to_rfc3339()),
            "news" => guard.settings.llm.last_news_at = Some(Utc::now().to_rfc3339()),
            "fortune" => {
                guard.settings.llm.last_fortune_date = Some(today);
                guard.settings.llm.cached_fortune = Some(text.clone());
            }
            _ => {}
        }
        let _ = save_state(app, &guard);
    }

    let payload = crate::llm::PetSaysPayload {
        text: text.clone(),
        kind: kind.into(),
        behavior: Some(behavior.into()),
        detail,
        message_id: None,
        auto_replying: None,
    };
    let _ = app.emit("pet-says", payload.clone());
    let _ = app.emit("proactive-message", payload.clone());

    // Weather/news: polish tip with LLM in the background (card already shown).
    if matches!(kind, "weather" | "news") && llm.enabled && !llm.api_key.trim().is_empty() {
        let app_bg = app.clone();
        let llm_bg = llm.clone();
        let pet_bg = pet.clone();
        let kind_bg = kind.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let tip = match kind_bg.as_str() {
                "weather" => crate::llm::refine_weather_tip(&llm_bg, &pet_bg),
                "news" => crate::llm::refine_news_tip(&llm_bg, &pet_bg),
                _ => return,
            };
            if let Ok(tip) = tip {
                if tip.trim().is_empty() {
                    return;
                }
                let _ = app_bg.emit(
                    "info-card-tip",
                    serde_json::json!({ "kind": kind_bg, "tip": tip }),
                );
            }
        });
    }

    if !muted {
        let notif_body = if kind == "fortune" {
            // Notification preview: first non-empty line.
            text.lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .unwrap_or("今日运势已就绪")
                .chars()
                .take(48)
                .collect::<String>()
        } else {
            text.clone()
        };
        let _ = app
            .notification()
            .builder()
            .title(&pet.name)
            .body(&notif_body)
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

// ── WeChat IM bridge ──────────────────────────────────────────────

#[tauri::command]
pub fn simulate_im_message(
    app: AppHandle,
    sender: Option<String>,
    text: Option<String>,
) -> Result<Option<crate::state::ImMessage>, String> {
    crate::im::ingest_message(
        &app,
        crate::im::ImIngestRequest {
            source: "simulate".into(),
            sender: sender.unwrap_or_else(|| "测试好友".into()),
            text: text.unwrap_or_else(|| "明天下午三点开会，别忘了".into()),
            context_token: None,
            peer_user_id: None,
        },
    )
}

#[tauri::command]
pub fn get_im_inbox(app: AppHandle) -> Result<Vec<crate::state::ImMessage>, String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.im_inbox.clone())
}

#[tauri::command]
pub fn acknowledge_im_message(app: AppHandle, message_id: String) -> Result<(), String> {
    crate::im::acknowledge(&app, &message_id)
}

#[tauri::command]
pub fn acknowledge_all_im_messages(app: AppHandle) -> Result<usize, String> {
    crate::im::acknowledge_all(&app)
}

#[tauri::command]
pub fn prune_im_noise(app: AppHandle) -> Result<usize, String> {
    crate::im::prune_noise_inbox(&app)
}

#[tauri::command]
pub async fn draft_im_reply(
    app: AppHandle,
    message_id: String,
    refresh: Option<bool>,
) -> Result<crate::im::ImDraftResult, String> {
    let refresh = refresh.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        crate::im::draft_reply(&app, &message_id, refresh)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn send_im_reply(
    app: AppHandle,
    message_id: String,
    text: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::im::send_reply(&app, &message_id, &text))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn wechat_login_start(app: AppHandle) -> Result<crate::wechat_ilink::WechatLoginStart, String> {
    crate::wechat_ilink::start_login(&app)
}

#[tauri::command]
pub fn wechat_login_poll(app: AppHandle) -> Result<crate::wechat_ilink::WechatStatus, String> {
    crate::wechat_ilink::poll_login_status(&app)
}

#[tauri::command]
pub fn wechat_logout(app: AppHandle) -> Result<crate::wechat_ilink::WechatStatus, String> {
    crate::wechat_ilink::logout(&app)
}

#[tauri::command]
pub fn wechat_status(app: AppHandle) -> Result<crate::wechat_ilink::WechatStatus, String> {
    crate::wechat_ilink::status(&app)
}

#[tauri::command]
pub fn wechat_notif_status(
    app: AppHandle,
) -> Result<crate::wechat_notif::NotifPermissionStatus, String> {
    crate::wechat_notif::permission_status(&app)
}

#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    crate::im::open_accessibility_settings()
}

#[tauri::command]
pub fn open_wechat_app() -> Result<(), String> {
    crate::im::open_wechat()
}

#[tauri::command]
pub fn copy_text_clipboard(text: String) -> Result<(), String> {
    crate::im::copy_clipboard(&text)
}

