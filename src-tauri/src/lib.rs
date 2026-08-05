mod commands;
mod go_bridge;
mod im;
mod llm;
mod schedules;
mod state;
mod tts;
mod wechat_ilink;
mod wechat_notif;

use commands::SharedState;
use state::load_state;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WindowEvent,
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
            // Clear historical Dock-badge / window-title spam from the IM inbox.
            let _ = crate::im::prune_noise_inbox(&app.handle());

            // Edge TTS / rustls needs a process-level crypto provider.
            let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

            // Warm Go AI sidecar (LLM / weather / news) on a side thread.
            let warm_city = {
                let shared = app.state::<SharedState>();
                shared
                    .0
                    .lock()
                    .ok()
                    .map(|g| g.settings.llm.weather_city.clone())
                    .unwrap_or_else(|| "北京".into())
            };
            std::thread::spawn(move || {
                go_bridge::start();
                // Prefetch weather so the first click is usually cache-hit (<1s).
                let _ = crate::llm::fetch_weather_summary(&warm_city);
            });

            let show_pet = MenuItem::with_id(app, "show_pet", "显示宠物", true, None::<&str>)?;
            let hide_pet = MenuItem::with_id(app, "hide_pet", "隐藏宠物", true, None::<&str>)?;
            let open_panel = MenuItem::with_id(app, "open_panel", "打开绒窝面板", true, None::<&str>)?;
            let open_wechat = MenuItem::with_id(app, "open_wechat_tab", "微信联动…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出绒窝", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_pet, &hide_pet, &open_panel, &open_wechat, &quit])?;

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
                    "open_panel" | "open_wechat_tab" => {
                        if let Some(w) = app.get_webview_window("panel") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        if event.id.as_ref() == "open_wechat_tab" {
                            let _ = app.emit("open-panel-tab", "wechat");
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

            // Proactive LLM content poller (every 60s)
            let handle2 = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(60));
                check_proactive(&handle2);
            });

            // IM nudge poller (every 60s)
            let handle3 = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(60));
                crate::im::check_im_nudges(&handle3);
            });

            // Custom schedule poller (every 30s — minute-level jobs)
            let handle_sched = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                crate::schedules::check_schedules(&handle_sched);
            });

            // Resume WeChat bridges if previously enabled.
            let handle4 = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(2));
                crate::im::sync_bridges(&handle4);
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
            commands::set_pet_personality,
            commands::update_settings,
            commands::upsert_reminder,
            commands::add_meeting_reminder,
            commands::quick_set_reminder,
            commands::quick_disable_reminder,
            commands::reminder_status,
            commands::delete_reminder,
            commands::upsert_schedule,
            commands::delete_schedule,
            commands::list_schedules,
            commands::tick_idle,
            commands::get_owned_actions,
            commands::generate_pet_line,
            commands::chat_with_pet,
            commands::get_chat_history,
            commands::clear_chat_history,
            commands::test_llm,
            commands::trigger_proactive,
            commands::synthesize_speech,
            commands::speak_speech,
            commands::generate_care_voice_lines,
            commands::simulate_im_message,
            commands::get_im_inbox,
            commands::acknowledge_im_message,
            commands::acknowledge_all_im_messages,
            commands::prune_im_noise,
            commands::draft_im_reply,
            commands::send_im_reply,
            commands::wechat_login_start,
            commands::wechat_login_poll,
            commands::wechat_logout,
            commands::wechat_status,
            commands::wechat_notif_status,
            commands::open_accessibility_settings,
            commands::open_wechat_app,
            commands::copy_text_clipboard,
        ])
        .build(tauri::generate_context!())
        .expect("error while building fluffnest")
        .run(|_app, event| {
            if let RunEvent::Exit = event {
                crate::wechat_ilink::stop_poller();
                crate::wechat_notif::stop_watcher();
                go_bridge::shutdown();
            }
        });
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
    let mut fired: Vec<(String, String, String)> = Vec::new();

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
            fired.push((rule.id.clone(), rule.r#type.clone(), title));
        }
    }

    // Never block the poller on LLM — emit immediately with static text.
    if !fired.is_empty() {
        let _ = state::save_state(app, &guard);
        drop(guard);
        for (id, rtype, title) in fired {
            let _ = app.emit(
                "reminder-fired",
                serde_json::json!({
                    "id": id,
                    "type": rtype,
                    "title": title,
                    "bubble": format!("⏰ {title}"),
                }),
            );
        }
    }
}

fn check_proactive(app: &tauri::AppHandle) {
    use chrono::{DateTime, Local, Timelike, Utc};

    let (should_weather, should_fortune, should_joke, should_news) = {
        let shared = match app.try_state::<SharedState>() {
            Some(s) => s,
            None => return,
        };
        let guard = match shared.0.lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        let llm = &guard.settings.llm;
        if !llm.enabled || !llm.proactive_enabled || guard.settings.focus_mode {
            return;
        }

        let now_local = Local::now();
        let today = now_local.format("%Y-%m-%d").to_string();
        let hour = now_local.hour();

        let should_weather = llm.weather_enabled
            && hour >= llm.weather_hour
            && llm.last_weather_date.as_deref() != Some(today.as_str());

        let should_fortune = llm.fortune_enabled
            && hour >= llm.fortune_hour
            && llm.last_fortune_date.as_deref() != Some(today.as_str());

        let should_joke = if llm.joke_enabled {
            match &llm.last_joke_at {
                Some(t) => DateTime::parse_from_rfc3339(t)
                    .map(|last| {
                        Utc::now()
                            .signed_duration_since(last.with_timezone(&Utc))
                            .num_minutes()
                            >= llm.joke_interval_minutes as i64
                    })
                    .unwrap_or(false),
                // Wait until first manual trigger or next interval after enable
                None => false,
            }
        } else {
            false
        };

        let should_news = if llm.news_enabled {
            match &llm.last_news_at {
                Some(t) => DateTime::parse_from_rfc3339(t)
                    .map(|last| {
                        Utc::now()
                            .signed_duration_since(last.with_timezone(&Utc))
                            .num_minutes()
                            >= llm.news_interval_minutes as i64
                    })
                    .unwrap_or(false),
                None => false,
            }
        } else {
            false
        };

        (should_weather, should_fortune, should_joke, should_news)
    };

    // Run at most one proactive item per tick, on a side thread (never block poller).
    let kind = if should_weather {
        Some("weather")
    } else if should_fortune {
        Some("fortune")
    } else if should_joke {
        Some("joke")
    } else if should_news {
        Some("news")
    } else {
        None
    };
    if let Some(kind) = kind {
        let app = app.clone();
        std::thread::spawn(move || {
            let _ = commands::run_proactive(&app, kind);
        });
    }
}
