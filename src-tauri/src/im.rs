//! Unified IM ingest bus for WeChat ClawBot + notification sources.

use crate::commands::SharedState;
use crate::llm;
use crate::state::{ImMessage, ReminderRule, WechatSettings};
use crate::wechat_ilink;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const INBOX_CAP_UNREAD: usize = 200;
/// Keep at most this many acknowledged (read) messages, newest last.
const INBOX_READ_KEEP: usize = 3;
const DEDUP_WINDOW: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
struct DedupKey {
    hash: String,
    at: Instant,
}

static DEDUP: Mutex<VecDeque<DedupKey>> = Mutex::new(VecDeque::new());

/// IM triage sometimes invents a "reminder" for daily weather/news pushes.
/// Those belong in `schedules`, and meeting `at` must be RFC3339 or the poller never fires.
fn reminder_hint_is_usable(r: &llm::ImReminderHint) -> bool {
    let title = r.title.to_lowercase();
    let schedule_like = ["天气", "预报", "简报", "资讯", "新闻", "weather", "forecast", "news"]
        .iter()
        .any(|k| title.contains(k));
    if schedule_like {
        return false;
    }
    match &r.at {
        None => true,
        Some(at) => DateTime::parse_from_rfc3339(at).is_ok(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImIngestRequest {
    pub source: String,
    pub sender: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer_user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImDraftResult {
    pub message_id: String,
    pub sender: String,
    pub incoming: String,
    pub summary: String,
    pub draft: String,
    pub suggestions: Vec<String>,
    pub can_send: bool,
    pub channel: String,
}

fn dedup_hash(source: &str, sender: &str, text: &str) -> String {
    let mut h = Sha256::new();
    h.update(source.as_bytes());
    h.update(b"|");
    h.update(sender.as_bytes());
    h.update(b"|");
    h.update(text.as_bytes());
    hex::encode(h.finalize())
}

fn seen_recently(hash: &str) -> bool {
    let mut q = match DEDUP.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let now = Instant::now();
    while let Some(front) = q.front() {
        if now.duration_since(front.at) > DEDUP_WINDOW {
            q.pop_front();
        } else {
            break;
        }
    }
    if q.iter().any(|e| e.hash == hash) {
        return true;
    }
    q.push_back(DedupKey {
        hash: hash.to_string(),
        at: now,
    });
    false
}

fn allowlisted(settings: &WechatSettings, sender: &str) -> bool {
    if settings.allowlist.is_empty() {
        return true;
    }
    let s = sender.to_lowercase();
    settings
        .allowlist
        .iter()
        .any(|a| !a.trim().is_empty() && s.contains(&a.trim().to_lowercase()))
}

fn fallback_react(sender: &str, text: &str) -> String {
    let preview: String = text.chars().take(18).collect();
    if preview.is_empty() {
        format!("微信来信：{sender}")
    } else {
        format!("微信 · {sender}：{preview}")
    }
}

/// Ingest an external IM message: dedupe, store, optional LLM triage, emit pet-says.
pub fn ingest_message(app: &AppHandle, req: ImIngestRequest) -> Result<Option<ImMessage>, String> {
    let text = req.text.trim().to_string();
    let sender = if req.sender.trim().is_empty() {
        "微信好友".into()
    } else {
        req.sender.trim().to_string()
    };
    if text.is_empty() && req.source != "notif" {
        return Ok(None);
    }
    let body = if text.is_empty() {
        "（有新消息）".into()
    } else {
        text
    };

    let hash = dedup_hash(&req.source, &sender, &body);
    if seen_recently(&hash) {
        return Ok(None);
    }
    if req.source == "notif" && is_noise_notif(&sender, &body) {
        return Ok(None);
    }

    let (wechat, muted, focus, llm_enabled, dialogue, pet, llm) = {
        let shared = app.state::<SharedState>();
        let guard = shared.0.lock().map_err(|e| e.to_string())?;
        let pet = guard
            .pets
            .iter()
            .find(|p| p.is_active && p.unlocked)
            .cloned()
            .ok_or_else(|| "no active pet".to_string())?;
        (
            guard.settings.wechat.clone(),
            guard.settings.muted,
            guard.settings.focus_mode,
            guard.settings.llm.enabled,
            guard.settings.llm.dialogue_enabled,
            pet,
            guard.settings.llm.clone(),
        )
    };

    if !allowlisted(&wechat, &sender) {
        return Ok(None);
    }

    let mut urgency = "normal".to_string();
    let mut summary = body.chars().take(48).collect::<String>();
    let mut react = fallback_react(&sender, &body);
    let mut reminder_hint: Option<(String, Option<String>, Option<i32>)> = None;

    if llm_enabled && dialogue {
        match llm::im_triage(&llm, &pet, &sender, &body) {
            Ok(t) => {
                if !t.urgency.is_empty() {
                    urgency = t.urgency;
                }
                if !t.summary.is_empty() {
                    summary = t.summary;
                }
                if !t.react.is_empty() {
                    react = t.react;
                }
                if let Some(r) = t.reminder {
                    if !r.title.is_empty() && reminder_hint_is_usable(&r) {
                        reminder_hint = Some((r.title, r.at, r.interval_minutes));
                    }
                }
            }
            Err(_) => {
                if let Ok(line) =
                    llm::generate_bubble_line(&llm, &pet, "im_react", "wechat", Some(&body))
                {
                    if !line.is_empty() {
                        react = line;
                    }
                }
            }
        }
    }

    let msg = ImMessage {
        id: Uuid::new_v4().to_string(),
        source: req.source.clone(),
        sender: sender.clone(),
        text: body.clone(),
        summary: Some(summary.clone()),
        urgency: Some(urgency.clone()),
        context_token: req.context_token.clone(),
        peer_user_id: req.peer_user_id.clone(),
        received_at: Utc::now().to_rfc3339(),
        acknowledged: false,
        last_nudged_at: None,
    };

    let is_urgent = urgency == "urgent";
    let is_noise = urgency == "noise";
    let suppress_ui = (focus && !(wechat.urgent_breaks_focus && is_urgent)) || muted || is_noise;

    {
        let shared = app.state::<SharedState>();
        let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
        guard.im_inbox.push(msg.clone());
        trim_im_inbox(&mut guard.im_inbox);
        // Bind proactive WeChat push target to latest ClawBot peer.
        if req.source == "clawbot" {
            if let (Some(peer), Some(token)) = (&req.peer_user_id, &req.context_token) {
                if !peer.trim().is_empty() && !token.trim().is_empty() {
                    guard.wechat_auth.owner_peer_id = Some(peer.trim().to_string());
                    guard.wechat_auth.owner_context_token = Some(token.trim().to_string());
                }
            }
        }
        if let Some((title, at, interval)) = reminder_hint {
            let rule = ReminderRule {
                id: format!("im-{}", &msg.id[..8.min(msg.id.len())]),
                r#type: if at.is_some() {
                    "meeting".into()
                } else {
                    "custom".into()
                },
                title: Some(title),
                interval_minutes: interval.or(Some(60)),
                at,
                enabled: true,
                snooze_minutes: 5,
                last_fired_at: None,
            };
            guard.reminders.push(rule);
        }
        crate::state::save_state(app, &guard)?;
    }

    let _ = app.emit("im-message", &msg);
    let _ = app.emit("im-inbox-updated", ());

    // Auto-reply via ClawBot: LLM generates pet reply and sends it back to WeChat.
    let can_auto_send = req.source == "clawbot"
        && wechat.auto_reply_from_wechat
        && llm_enabled
        && req
            .context_token
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        && req
            .peer_user_id
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);

    // ClawBot auto-reply: stay silent while working — remind only after the user opens the pet.
    if !suppress_ui && !can_auto_send {
        let payload = llm::PetSaysPayload {
            text: react.clone(),
            kind: "wechat".into(),
            behavior: Some("phone".into()),
            detail: Some(format!("{sender} · {summary}")),
            message_id: Some(msg.id.clone()),
            auto_replying: Some(false),
        };
        let _ = app.emit("pet-says", &payload);

        if wechat.tts_on_incoming && !muted {
            let speak = react.clone();
            let personality = pet.personality.clone();
            std::thread::spawn(move || {
                let _ = crate::tts::speak(&speak, &personality);
            });
        }

        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title(format!("微信 · {sender}"))
            .body(&summary)
            .show();
    }

    if can_auto_send {
        let token = req.context_token.clone().unwrap();
        let peer = req.peer_user_id.clone().unwrap();
        let user_text = body.clone();
        let msg_id = msg.id.clone();
        let sender_label = sender.clone();
        let app2 = app.clone();
        std::thread::spawn(move || {
            match auto_chat_reply(&app2, &user_text, &peer) {
                Ok(reply) => match wechat_ilink::send_text(&app2, &peer, &token, &reply) {
                    Ok(()) => {
                        let _ = acknowledge(&app2, &msg_id);
                        // No pet-says popup — frontend shows this only when the user opens the pet.
                        let _ = app2.emit(
                            "im-auto-replied",
                            serde_json::json!({
                                "messageId": msg_id,
                                "text": reply,
                                "incoming": user_text,
                                "sender": sender_label,
                                "channel": "clawbot",
                                "pending": true,
                            }),
                        );
                        let _ = app2.emit("im-inbox-updated", ());
                    }
                    Err(e) => {
                        eprintln!("[im] clawbot auto-reply send failed: {e}");
                        let _ = app2.emit(
                            "im-auto-replied",
                            serde_json::json!({
                                "messageId": msg_id,
                                "text": "",
                                "incoming": user_text,
                                "sender": sender_label,
                                "error": e,
                                "channel": "clawbot",
                                "pending": true,
                            }),
                        );
                    }
                },
                Err(e) => {
                    eprintln!("[im] clawbot auto-reply llm failed: {e}");
                    let _ = app2.emit(
                        "im-auto-replied",
                        serde_json::json!({
                            "messageId": msg_id,
                            "text": "",
                            "incoming": user_text,
                            "sender": sender_label,
                            "error": e,
                            "channel": "clawbot",
                            "pending": true,
                        }),
                    );
                }
            }
        });
    } else if req.source == "clawbot" && wechat.auto_reply_from_wechat && llm_enabled {
        eprintln!(
            "[im] clawbot auto-reply skipped: missing peer/context_token (cannot send to WeChat)"
        );
    }

    Ok(Some(msg))
}

fn auto_chat_reply(app: &AppHandle, user_message: &str, peer_user_id: &str) -> Result<String, String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    let pet = guard
        .pets
        .iter()
        .find(|p| p.is_active && p.unlocked)
        .cloned()
        .ok_or_else(|| "no active pet".to_string())?;
    let llm = guard.settings.llm.clone();
    if !llm.enabled {
        return Err("大模型未开启".into());
    }
    let history = guard.chat_history.clone();
    let host = crate::commands::host_snapshot_json(&guard);
    drop(guard);

    // Full agent: rules / skills / tools / memory / cycle + host actions.
    let (reply, host_actions) = llm::generate_wechat_agent_reply(
        &llm,
        &pet,
        &history,
        user_message,
        Some(peer_user_id),
        Some(host),
    )?;

    if !host_actions.is_empty() {
        let notes = crate::commands::apply_host_actions(app, &host_actions);
        eprintln!("[im] host actions applied: {notes:?}");
    }

    let shared = app.state::<SharedState>();
    let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
    guard.chat_history.push(llm::ChatMessage {
        role: "user".into(),
        content: format!("[微信] {user_message}"),
        at: Utc::now().to_rfc3339(),
    });
    guard.chat_history.push(llm::ChatMessage {
        role: "assistant".into(),
        content: reply.clone(),
        at: Utc::now().to_rfc3339(),
    });
    if guard.chat_history.len() > 40 {
        let drain = guard.chat_history.len() - 40;
        guard.chat_history.drain(0..drain);
    }
    crate::state::save_state(app, &guard)?;
    Ok(reply)
}

pub fn draft_reply(app: &AppHandle, message_id: &str, refresh: bool) -> Result<ImDraftResult, String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    let msg = guard
        .im_inbox
        .iter()
        .find(|m| m.id == message_id)
        .cloned()
        .ok_or_else(|| "消息不存在或已清理，请从收件箱再点「帮我回」".to_string())?;
    let pet = guard
        .pets
        .iter()
        .find(|p| p.is_active && p.unlocked)
        .cloned()
        .ok_or_else(|| "no active pet".to_string())?;
    let llm = guard.settings.llm.clone();
    let can_send = msg.source == "clawbot"
        && msg.context_token.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
        && msg.peer_user_id.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
        && !guard.wechat_auth.bot_token.is_empty();
    let channel = if can_send {
        "clawbot"
    } else {
        "clipboard"
    }
    .to_string();
    drop(guard);

    let (summary, draft, suggestions) = if llm.enabled {
        match llm::im_suggest(&llm, &pet, &msg.sender, &msg.text, refresh) {
            Ok(s) => {
                let draft = if !s.draft.is_empty() {
                    s.draft
                } else if let Some(first) = s.suggestions.first() {
                    first.clone()
                } else {
                    "收到，我稍后回复～".into()
                };
                let suggestions = if s.suggestions.is_empty() {
                    vec![draft.clone()]
                } else {
                    s.suggestions
                };
                let summary = if s.summary.is_empty() {
                    msg.text.chars().take(40).collect()
                } else {
                    s.summary
                };
                (summary, draft, suggestions)
            }
            Err(e) => return Err(format!("生成回复建议失败: {e}")),
        }
    } else {
        let draft = "收到，我稍后回复～".to_string();
        (
            msg.text.chars().take(40).collect(),
            draft.clone(),
            vec![draft],
        )
    };

    Ok(ImDraftResult {
        message_id: message_id.to_string(),
        sender: msg.sender,
        incoming: msg.text,
        summary,
        draft,
        suggestions,
        can_send,
        channel,
    })
}

pub fn send_reply(app: &AppHandle, message_id: &str, text: &str) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("empty reply".into());
    }

    let shared = app.state::<SharedState>();
    let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
    let msg = guard
        .im_inbox
        .iter_mut()
        .find(|m| m.id == message_id)
        .ok_or_else(|| "message not found".to_string())?;
    let can_send = msg.source == "clawbot"
        && msg.context_token.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
        && msg.peer_user_id.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
    let peer = msg.peer_user_id.clone();
    let token = msg.context_token.clone();
    msg.acknowledged = true;
    crate::state::save_state(app, &guard)?;
    drop(guard);

    if can_send {
        let peer = peer.ok_or_else(|| "missing peer".to_string())?;
        let token = token.ok_or_else(|| "missing context token".to_string())?;
        wechat_ilink::send_text(app, &peer, &token, text)?;
        let _ = app.emit("im-inbox-updated", ());
        return Ok("sent".into());
    }

    // Channel C / fallback: clipboard + open WeChat + try paste.
    copy_clipboard(text)?;
    match activate_wechat_and_paste() {
        Ok(()) => {
            let _ = app.emit("im-inbox-updated", ());
            Ok("pasted".into())
        }
        Err(e) => {
            let _ = open_wechat();
            let _ = app.emit("im-inbox-updated", ());
            // Still success for clipboard path; surface hint to UI via return code.
            eprintln!("[im] paste fallback: {e}");
            Ok("clipboard".into())
        }
    }
}

pub fn acknowledge(app: &AppHandle, message_id: &str) -> Result<(), String> {
    let shared = app.state::<SharedState>();
    let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
    if let Some(msg) = guard.im_inbox.iter_mut().find(|m| m.id == message_id) {
        msg.acknowledged = true;
        trim_im_inbox(&mut guard.im_inbox);
        crate::state::save_state(app, &guard)?;
        let _ = app.emit("im-inbox-updated", ());
    }
    Ok(())
}

pub fn acknowledge_all(app: &AppHandle) -> Result<usize, String> {
    let shared = app.state::<SharedState>();
    let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
    let mut n = 0usize;
    for msg in guard.im_inbox.iter_mut() {
        if !msg.acknowledged {
            msg.acknowledged = true;
            n += 1;
        }
    }
    if n > 0 {
        trim_im_inbox(&mut guard.im_inbox);
        crate::state::save_state(app, &guard)?;
        let _ = app.emit("im-inbox-updated", ());
    }
    Ok(n)
}

/// Dock-badge / window-title / NC-chrome rows that are not real friend texts.
pub fn is_noise_notif(sender: &str, text: &str) -> bool {
    let s = sender.trim();
    let t = text.trim();
    if s.is_empty() && t.is_empty() {
        return true;
    }
    let chrome_senders = [
        "通知中心",
        "应用程序",
        "窗口",
        "Dock",
        "Notification Center",
        "微信",
    ];
    // Bare "微信" + counter/title text is badge/window noise; real banners use friend names.
    if chrome_senders
        .iter()
        .any(|c| s.eq_ignore_ascii_case(c))
    {
        if t.starts_with("未读 ")
            || t.starts_with("窗口提示")
            || t.contains("未读") && t.contains("条")
            || t == "应用程序"
            || t == "日历"
            || t.eq_ignore_ascii_case("Application")
            || t.contains("微信 (")
            || t.contains("WeChat (")
        {
            return true;
        }
        // Sender alone is chrome (e.g. "窗口" / "通知中心") with short UI label.
        if s != "微信" && t.chars().count() <= 8 {
            return true;
        }
    }
    if s == "通知中心" || s == "应用程序" || s == "窗口" {
        return true;
    }
    if t == "应用程序"
        || t.eq_ignore_ascii_case("Application")
        || t.starts_with("未读 ")
        || t.starts_with("窗口提示")
        || (t.contains("未读") && t.contains("条"))
    {
        return true;
    }
    false
}

/// Drop / auto-ack historical noise so old badge spam stops counting as unread.
pub fn prune_noise_inbox(app: &AppHandle) -> Result<usize, String> {
    let shared = app.state::<SharedState>();
    let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
    let before = guard.im_inbox.len();
    let mut changed = false;
    for msg in guard.im_inbox.iter_mut() {
        if msg.source == "notif" && is_noise_notif(&msg.sender, &msg.text) {
            if !msg.acknowledged {
                msg.acknowledged = true;
                changed = true;
            }
        }
    }
    // Also remove acknowledged noise to keep the list clean.
    let noise_ids: Vec<String> = guard
        .im_inbox
        .iter()
        .filter(|m| m.source == "notif" && is_noise_notif(&m.sender, &m.text))
        .map(|m| m.id.clone())
        .collect();
    if !noise_ids.is_empty() {
        guard
            .im_inbox
            .retain(|m| !noise_ids.iter().any(|id| id == &m.id));
        changed = true;
    }
    let before_trim = guard.im_inbox.len();
    trim_im_inbox(&mut guard.im_inbox);
    if guard.im_inbox.len() != before_trim {
        changed = true;
    }
    let removed = before.saturating_sub(guard.im_inbox.len());
    if changed {
        crate::state::save_state(app, &guard)?;
        let _ = app.emit("im-inbox-updated", ());
    }
    Ok(removed)
}

/// Keep all unread messages; keep only the newest `INBOX_READ_KEEP` read ones.
/// Soft-cap unread at `INBOX_CAP_UNREAD` (drop oldest unread if exceeded).
fn trim_im_inbox(inbox: &mut Vec<crate::state::ImMessage>) {
    let mut unread: Vec<_> = inbox.iter().filter(|m| !m.acknowledged).cloned().collect();
    let mut read: Vec<_> = inbox.iter().filter(|m| m.acknowledged).cloned().collect();

    if unread.len() > INBOX_CAP_UNREAD {
        let drain = unread.len() - INBOX_CAP_UNREAD;
        unread.drain(0..drain);
    }
    if read.len() > INBOX_READ_KEEP {
        let drain = read.len() - INBOX_READ_KEEP;
        read.drain(0..drain);
    }

    // Preserve chronological order (oldest → newest) by received_at when possible.
    let mut merged = unread;
    merged.extend(read);
    merged.sort_by(|a, b| a.received_at.cmp(&b.received_at));
    *inbox = merged;
}

pub fn copy_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text.to_string()).map_err(|e| e.to_string())
}

fn wechat_app_candidates() -> [&'static str; 3] {
    [
        "/Applications/微信 2.app",
        "/Applications/微信.app",
        "/Applications/WeChat.app",
    ]
}

pub fn open_wechat() -> Result<(), String> {
    for path in wechat_app_candidates() {
        if std::path::Path::new(path).exists() {
            std::process::Command::new("open")
                .arg(path)
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    // Fallbacks by name
    for name in ["微信 2", "微信", "WeChat"] {
        let status = std::process::Command::new("open")
            .arg("-a")
            .arg(name)
            .status();
        if let Ok(s) = status {
            if s.success() {
                return Ok(());
            }
        }
    }
    Err("未找到微信应用（微信 2 / 微信 / WeChat）".into())
}

/// Activate WeChat and paste clipboard (Cmd+V). Requires Accessibility for System Events.
pub fn activate_wechat_and_paste() -> Result<(), String> {
    open_wechat()?;
    // Give WeChat a moment to become frontmost, then paste.
    let script = r#"
delay 0.55
tell application "System Events"
  set frontApp to first process whose frontmost is true
  set n to name of frontApp as text
  if n does not contain "WeChat" and n does not contain "微信" then
    try
      set frontmost of process "WeChat" to true
    end try
  end if
  delay 0.2
  keystroke "v" using {command down}
end tell
"#;
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("无法自动粘贴: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        // Clipboard already set by caller; paste failure is soft.
        return Err(format!(
            "已复制，但自动粘贴失败（请在微信输入框 Cmd+V）。{}",
            err.trim()
        ));
    }
    Ok(())
}

pub fn open_accessibility_settings() -> Result<(), String> {
    // macOS Ventura+ privacy pane deep link (best-effort).
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.Settings.PrivacySecurity.extension?Privacy_Accessibility")
        .spawn();
    Ok(())
}

/// Nudge unacknowledged important messages.
pub fn check_im_nudges(app: &AppHandle) {
    let shared = match app.try_state::<SharedState>() {
        Some(s) => s,
        None => return,
    };
    let mut guard = match shared.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let minutes = guard.settings.wechat.nudge_minutes;
    if minutes <= 0 || guard.settings.focus_mode || guard.settings.muted {
        return;
    }
    let now = Utc::now();
    let mut to_nudge: Vec<(String, String, String)> = Vec::new();
    for msg in guard.im_inbox.iter_mut() {
        if msg.acknowledged {
            continue;
        }
        let urg = msg.urgency.as_deref().unwrap_or("normal");
        if urg == "noise" {
            continue;
        }
        let Ok(received) = DateTime::parse_from_rfc3339(&msg.received_at) else {
            continue;
        };
        let age = now.signed_duration_since(received.with_timezone(&Utc));
        if age.num_minutes() < minutes as i64 {
            continue;
        }
        let already = msg
            .last_nudged_at
            .as_ref()
            .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
            .map(|t| {
                now.signed_duration_since(t.with_timezone(&Utc))
                    .num_minutes()
                    < minutes as i64
            })
            .unwrap_or(false);
        if already {
            continue;
        }
        msg.last_nudged_at = Some(now.to_rfc3339());
        let summary = msg
            .summary
            .clone()
            .unwrap_or_else(|| msg.text.chars().take(24).collect());
        to_nudge.push((msg.sender.clone(), summary, urg.to_string()));
    }
    if !to_nudge.is_empty() {
        let _ = crate::state::save_state(app, &guard);
    }
    drop(guard);

    for (sender, summary, urg) in to_nudge {
        let text = if urg == "urgent" {
            format!("还没回 {sender}：{summary}")
        } else {
            format!("记得回一下 {sender} 哦")
        };
        let payload = llm::PetSaysPayload {
            text,
            kind: "wechat".into(),
            behavior: Some("react".into()),
            detail: Some(format!("{sender} · {summary}")),
            message_id: None,
            auto_replying: None,
        };
        let _ = app.emit("pet-says", &payload);
    }
}

/// Sync pollers after settings / auth change.
pub fn sync_bridges(app: &AppHandle) {
    wechat_ilink::sync_poller(app);
    crate::wechat_notif::sync_watcher(app);
}
