//! User-defined timed automations (weather / news / custom → WeChat or pet).

use crate::commands::SharedState;
use crate::llm;
use crate::state::{save_state, ScheduleJob};
use crate::wechat_ilink;
use chrono::{Datelike, Local, Timelike};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

fn firing_set() -> &'static Mutex<HashSet<String>> {
    static CELL: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(HashSet::new()))
}

fn last_fail_map() -> &'static Mutex<HashMap<String, Instant>> {
    static CELL: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(HashMap::new()))
}

const FAIL_COOLDOWN: Duration = Duration::from_secs(5 * 60);

pub fn check_schedules(app: &AppHandle) {
    let due = {
        let shared = match app.try_state::<SharedState>() {
            Some(s) => s,
            None => return,
        };
        let guard = match shared.0.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if guard.settings.focus_mode {
            return;
        }
        let now = Local::now();
        let today = now.format("%Y-%m-%d").to_string();
        let hour = now.hour() as i32;
        let minute = now.minute() as i32;
        let weekday = now.weekday().num_days_from_sunday() as i32;

        guard
            .schedules
            .iter()
            .filter(|j| j.enabled)
            // Same-day catch-up: fire once after scheduled local time (not only the exact minute).
            .filter(|j| hour > j.hour || (hour == j.hour && minute >= j.minute))
            .filter(|j| j.last_fired_date.as_deref() != Some(today.as_str()))
            .filter(|j| j.days_of_week.is_empty() || j.days_of_week.contains(&weekday))
            .cloned()
            .collect::<Vec<_>>()
    };

    for job in due {
        if let Err(e) = fire_schedule(app, &job) {
            eprintln!("[schedules] fire {} failed: {e}", job.id);
        }
    }
}

fn try_begin_fire(id: &str) -> bool {
    if let Ok(fails) = last_fail_map().lock() {
        if let Some(at) = fails.get(id) {
            if at.elapsed() < FAIL_COOLDOWN {
                return false;
            }
        }
    }
    let Ok(mut set) = firing_set().lock() else {
        return false;
    };
    set.insert(id.to_string())
}

fn end_fire(id: &str) {
    if let Ok(mut set) = firing_set().lock() {
        set.remove(id);
    }
}

fn mark_fire_fail(id: &str) {
    if let Ok(mut fails) = last_fail_map().lock() {
        fails.insert(id.to_string(), Instant::now());
    }
}

fn clear_fire_fail(id: &str) {
    if let Ok(mut fails) = last_fail_map().lock() {
        fails.remove(id);
    }
}

fn fire_schedule(app: &AppHandle, job: &ScheduleJob) -> Result<(), String> {
    let today = Local::now().format("%Y-%m-%d").to_string();

    if !try_begin_fire(&job.id) {
        return Ok(());
    }
    let result = (|| -> Result<(), String> {
        {
            let shared = app.state::<SharedState>();
            let guard = shared.0.lock().map_err(|e| e.to_string())?;
            if let Some(j) = guard.schedules.iter().find(|j| j.id == job.id) {
                if j.last_fired_date.as_deref() == Some(today.as_str()) {
                    return Ok(());
                }
            } else {
                return Err("schedule missing".into());
            }
        }

        let text = build_content(app, job)?;
        if text.trim().is_empty() {
            return Err("empty schedule content".into());
        }

        match job.channel.as_str() {
            "wechat" => push_wechat(app, &text)?,
            _ => {
                let _ = app.emit(
                    "pet-says",
                    llm::PetSaysPayload {
                        text: text.clone(),
                        kind: format!("schedule-{}", job.kind),
                        behavior: Some(llm::proactive_kind_behavior("news").into()),
                        detail: Some(job.title.clone()),
                        message_id: None,
                        auto_replying: None,
                    },
                );
            }
        }

        // Mark fired only after successful delivery so catch-up can retry on failure.
        {
            let shared = app.state::<SharedState>();
            let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
            if let Some(j) = guard.schedules.iter_mut().find(|j| j.id == job.id) {
                j.last_fired_date = Some(today.clone());
            }
            save_state(app, &guard)?;
        }

        let _ = app.emit(
            "schedule-fired",
            json!({
                "id": job.id,
                "title": job.title,
                "kind": job.kind,
                "channel": job.channel,
                "text": text.chars().take(80).collect::<String>(),
            }),
        );
        Ok(())
    })();

    end_fire(&job.id);
    match &result {
        Ok(()) => clear_fire_fail(&job.id),
        Err(_) => mark_fire_fail(&job.id),
    }
    result
}

fn build_content(app: &AppHandle, job: &ScheduleJob) -> Result<String, String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    let llm = guard.settings.llm.clone();
    let pet = guard
        .pets
        .iter()
        .find(|p| p.is_active && p.unlocked)
        .cloned()
        .ok_or_else(|| "no active pet".to_string())?;
    drop(guard);

    if !llm.enabled {
        return Err("大模型未开启".into());
    }

    match job.kind.as_str() {
        "weather_forecast" => {
            let cities = weather_cities(&job.params, &llm.weather_city);
            let for_tomorrow = param_bool(&job.params, "forTomorrow").unwrap_or(true);
            let label = if for_tomorrow { "明日天气" } else { "天气" };
            let mut parts = vec![format!("【{} · {}】", job.title, label)];
            for city in &cities {
                let mut settings = llm.clone();
                settings.weather_city = city.clone();
                let (tip, summary) =
                    llm::generate_weather_bubble_ex(&settings, &pet, city, for_tomorrow)?;
                parts.push(format!("—— {city} ——\n{summary}\n{tip}"));
            }
            Ok(parts.join("\n\n"))
        }
        "news_brief" => {
            let lookback = param_i64(&job.params, "lookbackHours").unwrap_or(24);
            let (tip, summary) = llm::generate_news_bubble(&llm, &pet)?;
            Ok(format!(
                "【{} · 资讯简报】过去约 {lookback} 小时要闻\n{summary}\n{tip}",
                job.title
            ))
        }
        "custom_prompt" => {
            let prompt = param_str(&job.params, "prompt").unwrap_or_else(|| job.title.clone());
            let msg = format!(
                "这是一条定时推送任务「{}」。请根据以下说明生成一条简短中文推送（≤400字，适合微信）：\n{}",
                job.title, prompt
            );
            llm::generate_chat_reply(&llm, &pet, &[], &msg)
        }
        other => Err(format!("未知定时任务类型: {other}")),
    }
}

fn weather_cities(params: &Map<String, Value>, fallback: &str) -> Vec<String> {
    if let Some(Value::Array(arr)) = params.get("cities") {
        let list: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect();
        if !list.is_empty() {
            return list;
        }
    }
    let raw = param_str(params, "city")
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string());
    let list: Vec<String> = raw
        .split(|c: char| c == ',' || c == '，' || c == '/' || c == '、' || c == ';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if list.is_empty() {
        vec![fallback.to_string()]
    } else {
        list
    }
}

fn push_wechat(app: &AppHandle, text: &str) -> Result<(), String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    if guard.wechat_auth.bot_token.is_empty() {
        return Err("ClawBot 未登录".into());
    }
    let peer = guard
        .wechat_auth
        .owner_peer_id
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "尚未记录微信推送对象：请先用 ClawBot 给桌宠发一条消息，以便绑定推送会话".to_string()
        })?;
    let token = guard
        .wechat_auth
        .owner_context_token
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "缺少 context_token，请再给 ClawBot 发一条消息".to_string())?;
    drop(guard);

    let body = if text.chars().count() > 600 {
        text.chars().take(600).collect::<String>() + "…"
    } else {
        text.to_string()
    };
    wechat_ilink::send_text(app, &peer, &token, &body)
}

pub fn upsert_job(state: &mut crate::state::AppState, mut job: ScheduleJob) -> ScheduleJob {
    job.hour = job.hour.clamp(0, 23);
    job.minute = job.minute.clamp(0, 59);
    if job.channel != "wechat" && job.channel != "pet" {
        job.channel = "wechat".into();
    }
    if !matches!(
        job.kind.as_str(),
        "weather_forecast" | "news_brief" | "custom_prompt"
    ) {
        job.kind = "custom_prompt".into();
    }
    if job.id.trim().is_empty() {
        job.id = format!("sch-{}", Uuid::new_v4());
    }
    if job.title.trim().is_empty() {
        job.title = default_title(&job.kind);
    }
    if let Some(existing) = state.schedules.iter_mut().find(|j| j.id == job.id) {
        // Preserve last_fired_date unless explicitly cleared by client.
        if job.last_fired_date.is_none() {
            job.last_fired_date = existing.last_fired_date.clone();
        }
        *existing = job.clone();
    } else {
        state.schedules.push(job.clone());
    }
    job
}

pub fn delete_job(state: &mut crate::state::AppState, id: &str) -> bool {
    let before = state.schedules.len();
    state.schedules.retain(|j| j.id != id);
    state.schedules.len() != before
}

pub fn cancel_job_by_query(state: &mut crate::state::AppState, query: &str) -> Option<ScheduleJob> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return None;
    }
    let idx = state.schedules.iter().position(|j| {
        j.id == query
            || j.title.to_lowercase().contains(&q)
            || j.kind.to_lowercase().contains(&q)
    })?;
    let mut job = state.schedules[idx].clone();
    job.enabled = false;
    state.schedules[idx].enabled = false;
    Some(job)
}

fn default_title(kind: &str) -> String {
    match kind {
        "weather_forecast" => "晚间天气预报".into(),
        "news_brief" => "早间资讯简报".into(),
        _ => "自定义定时推送".into(),
    }
}

fn param_str(params: &Map<String, Value>, key: &str) -> Option<String> {
    params.get(key).and_then(|v| {
        v.as_str()
            .map(|s| s.to_string())
            .or_else(|| v.as_i64().map(|n| n.to_string()))
    })
}

fn param_bool(params: &Map<String, Value>, key: &str) -> Option<bool> {
    params.get(key).and_then(|v| v.as_bool())
}

fn param_i64(params: &Map<String, Value>, key: &str) -> Option<i64> {
    params.get(key).and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
}

/// Apply a host action produced by the WeChat agent.
pub fn apply_host_action(
    state: &mut crate::state::AppState,
    op: &str,
    args: &Map<String, Value>,
) -> String {
    match op {
        "reminder.set" => {
            let kind = args
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let interval = args
                .get("intervalMinutes")
                .and_then(|v| v.as_i64())
                .map(|n| n as i32);
            match kind.as_str() {
                "water" | "stretch" => {
                    let (id, title, default_iv) = if kind == "water" {
                        ("rem-water", "喝水", 60)
                    } else {
                        ("rem-stretch", "久坐起身", 45)
                    };
                    let iv = interval.unwrap_or(default_iv).clamp(5, 24 * 60);
                    if let Some(r) = state.reminders.iter_mut().find(|r| r.id == id) {
                        r.enabled = true;
                        r.interval_minutes = Some(iv);
                        r.title = Some(title.into());
                        r.last_fired_at = None;
                    } else {
                        state.reminders.push(crate::state::ReminderRule {
                            id: id.into(),
                            r#type: kind.clone(),
                            title: Some(title.into()),
                            interval_minutes: Some(iv),
                            at: None,
                            enabled: true,
                            snooze_minutes: 5,
                            last_fired_at: None,
                        });
                    }
                    format!("已开启{title}提醒（每 {iv} 分钟）")
                }
                "meeting" => {
                    let title = args
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("会议")
                        .to_string();
                    let at = args
                        .get("at")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if at.is_empty() {
                        return "会议提醒需要 at（RFC3339 时间）".into();
                    }
                    if chrono::DateTime::parse_from_rfc3339(&at).is_err() {
                        return format!(
                            "会议提醒 at 必须是 RFC3339（如 2026-08-06T20:00:00+08:00），收到的是「{at}」。每天定时推送请用 schedule.upsert"
                        );
                    }
                    let rule = crate::state::ReminderRule {
                        id: format!("rem-{}", Uuid::new_v4()),
                        r#type: "meeting".into(),
                        title: Some(title.clone()),
                        interval_minutes: None,
                        at: Some(at),
                        enabled: true,
                        snooze_minutes: 5,
                        last_fired_at: None,
                    };
                    state.reminders.push(rule);
                    format!("已添加会议提醒「{title}」")
                }
                _ => format!("未知提醒类型: {kind}"),
            }
        }
        "reminder.cancel" => {
            let kind = args
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let id_arg = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let target = if !id_arg.is_empty() {
                id_arg.to_string()
            } else {
                match kind.as_str() {
                    "water" => "rem-water".into(),
                    "stretch" => "rem-stretch".into(),
                    other if !other.is_empty() => other.to_string(),
                    _ => {
                        return "请指定 kind=water|stretch 或 id".into();
                    }
                }
            };
            if let Some(r) = state
                .reminders
                .iter_mut()
                .find(|r| r.id == target || (!kind.is_empty() && r.r#type == kind))
            {
                if !r.enabled {
                    return format!(
                        "{}提醒本来就是关的",
                        r.title.clone().unwrap_or_else(|| kind.clone())
                    );
                }
                r.enabled = false;
                format!(
                    "已关闭{}提醒",
                    r.title.clone().unwrap_or_else(|| kind.clone())
                )
            } else {
                format!("未找到提醒 {target}")
            }
        }
        "schedule.upsert" => {
            let kind = args
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("custom_prompt")
                .to_string();
            let channel = args
                .get("channel")
                .and_then(|v| v.as_str())
                .unwrap_or("wechat")
                .to_string();
            let hour = args
                .get("hour")
                .and_then(|v| v.as_i64())
                .unwrap_or(9) as i32;
            let minute = args
                .get("minute")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32;
            let title = args
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let mut params = Map::new();
            if let Some(Value::Object(p)) = args.get("params") {
                params = p.clone();
            } else {
                if let Some(v) = args.get("city") {
                    params.insert("city".into(), v.clone());
                }
                if let Some(v) = args.get("cities") {
                    params.insert("cities".into(), v.clone());
                }
                if let Some(v) = args.get("forTomorrow") {
                    params.insert("forTomorrow".into(), v.clone());
                }
                if let Some(v) = args.get("lookbackHours") {
                    params.insert("lookbackHours".into(), v.clone());
                }
                if let Some(v) = args.get("prompt") {
                    params.insert("prompt".into(), v.clone());
                }
            }
            // Sensible defaults for common recipes.
            if kind == "weather_forecast" && !params.contains_key("forTomorrow") {
                params.insert("forTomorrow".into(), Value::Bool(true));
            }
            if kind == "news_brief" && !params.contains_key("lookbackHours") {
                params.insert("lookbackHours".into(), Value::Number(24.into()));
            }
            let job = ScheduleJob {
                id,
                title,
                kind: kind.clone(),
                channel,
                enabled: true,
                hour,
                minute,
                days_of_week: args
                    .get("daysOfWeek")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_i64().map(|n| n as i32))
                            .collect()
                    })
                    .unwrap_or_default(),
                params,
                last_fired_date: None,
            };
            let saved = upsert_job(state, job);
            format!(
                "已设定时任务「{}」：每天 {:02}:{:02} 经 {} 推送（{})",
                saved.title, saved.hour, saved.minute, saved.channel, saved.kind
            )
        }
        "schedule.cancel" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or(id);
            if let Some(job) = cancel_job_by_query(state, query) {
                format!("已关闭定时任务「{}」", job.title)
            } else if !id.is_empty() {
                if delete_job(state, id) {
                    format!("已删除定时任务 {id}")
                } else {
                    format!("未找到定时任务 {id}")
                }
            } else {
                "请指定 id 或 query（标题/类型关键词）".into()
            }
        }
        other => format!("未知 host 操作: {other}"),
    }
}
