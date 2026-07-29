mod commands;
mod state;

use commands::SharedState;
use state::load_state;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let initial = load_state(&app.handle());
            app.manage(SharedState(std::sync::Mutex::new(initial)));

            let show_pet = MenuItem::with_id(app, "show_pet", "显示宠物", true, None::<&str>)?;
            let hide_pet = MenuItem::with_id(app, "hide_pet", "隐藏宠物", true, None::<&str>)?;
            let open_panel = MenuItem::with_id(app, "open_panel", "打开绒窝面板", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出绒窝", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_pet, &hide_pet, &open_panel, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("绒窝 FluffNest")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_pet" => {
                        if let Some(w) = app.get_webview_window("pet") {
                            let _ = w.show();
                        }
                    }
                    "hide_pet" => {
                        if let Some(w) = app.get_webview_window("pet") {
                            let _ = w.hide();
                        }
                    }
                    "open_panel" => {
                        if let Some(w) = app.get_webview_window("panel") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("panel") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Reminder poller (every 30s)
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                let _ = check_reminders(&handle);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "panel" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::get_active_pet,
            commands::interact,
            commands::switch_pet,
            commands::update_settings,
            commands::upsert_reminder,
            commands::add_meeting_reminder,
            commands::delete_reminder,
            commands::complete_reminder,
            commands::purchase_product,
            commands::claim_daily_login,
            commands::tick_idle,
            commands::get_owned_actions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running fluffnest");
}

fn check_reminders(app: &tauri::AppHandle) {
    use chrono::{DateTime, Utc};
    use tauri::Emitter;

    let shared = match app.try_state::<SharedState>() {
        Some(s) => s,
        None => return,
    };
    let mut guard = match shared.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    let now = Utc::now();
    let mut fired: Vec<(String, String)> = Vec::new();

    for rule in guard.reminders.iter_mut() {
        if !rule.enabled {
            continue;
        }

        let should_fire = match rule.r#type.as_str() {
            "meeting" => {
                if let Some(at) = &rule.at {
                    if let Ok(when) = DateTime::parse_from_rfc3339(at) {
                        let due = when.with_timezone(&Utc) - chrono::Duration::minutes(5);
                        now >= due
                            && rule
                                .last_fired_at
                                .as_ref()
                                .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
                                .map(|t| t.with_timezone(&Utc) < due)
                                .unwrap_or(true)
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            _ => {
                let interval = rule.interval_minutes.unwrap_or(60) as i64;
                match &rule.last_fired_at {
                    Some(t) => {
                        if let Ok(last) = DateTime::parse_from_rfc3339(t) {
                            now.signed_duration_since(last.with_timezone(&Utc))
                                .num_minutes()
                                >= interval
                        } else {
                            true
                        }
                    }
                    None => true,
                }
            }
        };

        if should_fire {
            rule.last_fired_at = Some(now.to_rfc3339());
            let title = rule
                .title
                .clone()
                .unwrap_or_else(|| rule.r#type.clone());
            fired.push((rule.id.clone(), title));
        }
    }

    if !fired.is_empty() {
        let _ = state::save_state(app, &guard);
        drop(guard);
        for (id, title) in fired {
            let _ = app.emit(
                "reminder-fired",
                serde_json::json!({ "id": id, "title": title }),
            );
        }
    }
}
