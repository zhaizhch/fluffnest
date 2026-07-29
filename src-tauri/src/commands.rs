use crate::state::{
    prepare_daily_login, reward_for_streak, save_state, today_string, AppState, DailyLogin,
    OwnedAction, PetInstance, ReminderRule, Settings, Wallet,
};
use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};
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
        let pet = state
            .pets
            .iter_mut()
            .find(|p| p.is_active && p.unlocked)
            .ok_or_else(|| "no active pet".to_string())?;
        match action.as_str() {
            "pet" | "pat" => {
                pet.mood = (pet.mood + 8).min(100);
                pet.bond += 1;
            }
            "feed" => {
                pet.energy = (pet.energy + 15).min(100);
                pet.mood = (pet.mood + 5).min(100);
                pet.bond += 2;
            }
            "play" => {
                pet.energy = (pet.energy - 8).max(0);
                pet.mood = (pet.mood + 12).min(100);
                pet.bond += 2;
            }
            "poke" => {
                pet.mood = (pet.mood + 4).min(100);
                pet.bond += 1;
            }
            "hug" => {
                pet.mood = (pet.mood + 10).min(100);
                pet.energy = (pet.energy + 5).min(100);
                pet.bond += 3;
            }
            "tickle" => {
                pet.mood = (pet.mood + 9).min(100);
                pet.energy = (pet.energy - 3).max(0);
                pet.bond += 2;
            }
            _ => {}
        }
        pet.last_interact_at = Utc::now().to_rfc3339();
        let snapshot = pet.clone();
        let _ = app.emit("pet-updated", snapshot.clone());
        let _ = app.emit(
            "pet-action",
            serde_json::json!({ "action": action, "speciesId": snapshot.species_id }),
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
        let keep_admin = state.settings.is_admin || settings.is_admin;
        state.settings = settings.clone();
        state.settings.is_admin = keep_admin;
        if keep_admin {
            crate::state::grant_admin_unlocks(state);
        }
        if let Some(win) = app.get_webview_window("pet") {
            let _ = win.set_always_on_top(state.settings.always_on_top);
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
        if let Some(rule) = state.reminders.iter_mut().find(|r| r.id == id) {
            rule.last_fired_at = Some(Utc::now().to_rfc3339());
        }
        if let Some(pet) = state.pets.iter_mut().find(|p| p.is_active && p.unlocked) {
            pet.bond += 3;
            pet.mood = (pet.mood + 5).min(100);
        }
        state.wallet.coin += 5;
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
        match reward.kind.as_str() {
            "coin" => state.wallet.coin += reward.amount,
            "action" => unlock_action(state, &reward.target_id),
            "pet" => unlock_pet(state, &reward.target_id),
            _ => {}
        }

        state.daily_login = DailyLogin {
            last_claim_date: Some(today),
            streak: next_streak,
            total_days: state.daily_login.total_days + 1,
            pending_rewards: vec![],
            claimed_today: true,
        };

        let _ = app.emit("daily-claimed", reward);
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
        if !state.settings.focus_mode {
            pet.energy = (pet.energy - 1).max(0);
            if pet.energy < 20 {
                pet.mood = (pet.mood - 1).max(0);
            }
        }
        Ok(pet.clone())
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
