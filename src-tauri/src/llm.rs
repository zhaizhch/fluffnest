//! Thin proxy to the Go AI sidecar for LLM / weather / news / fortune.
//!
//! Business logic and HTTP clients live in `backend/` (Go). This module keeps
//! the existing Rust call sites and serde types used by `commands` / `state`.

use crate::go_bridge;
use crate::state::{LlmSettings, PetInstance};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetSaysPayload {
    pub text: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behavior: Option<String>,
    /// Optional structured detail (e.g. weather number card).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// IM message id when kind is wechat — avoids racing latestImId on the UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    /// True when ClawBot will auto-send a pet reply (UI should not also draft).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_replying: Option<bool>,
    /// IM channel (e.g. "clawbot") — UI skips draft suggestion popup for ClawBot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TextResponse {
    text: String,
}

#[derive(Debug, Deserialize)]
struct WeatherBubbleResponse {
    text: String,
    #[serde(default)]
    summary: String,
}

#[derive(Debug, Deserialize)]
struct LinesResponse {
    lines: Vec<String>,
}

pub fn generate_bubble_line(
    llm: &LlmSettings,
    pet: &PetInstance,
    kind: &str,
    action: &str,
    extra: Option<&str>,
) -> Result<String, String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
        "kind": kind,
        "action": action,
        "extra": extra,
    });
    let resp: TextResponse = go_bridge::post_json("/v1/bubble", &body)?;
    Ok(resp.text)
}

pub fn generate_chat_reply(
    llm: &LlmSettings,
    pet: &PetInstance,
    history: &[ChatMessage],
    user_message: &str,
) -> Result<String, String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
        "history": history,
        "message": user_message,
    });
    let resp: TextResponse = go_bridge::post_json("/v1/chat", &body)?;
    Ok(resp.text)
}

/// WeChat ClawBot auto-reply via full agent (tools/rules/skills/memory/cycle).
/// Returns (reply_text, host_actions) — caller applies host_actions to AppState.
pub fn generate_wechat_agent_reply(
    llm: &LlmSettings,
    pet: &PetInstance,
    history: &[ChatMessage],
    user_message: &str,
    peer_user_id: Option<&str>,
    host: Option<serde_json::Value>,
    attachments: &[crate::state::ImAttachment],
) -> Result<(String, Vec<serde_json::Value>), String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
        "history": history,
        "message": user_message,
        "city": llm.weather_city,
        "peerId": peer_user_id.unwrap_or(""),
        "channel": "wechat",
        "host": host,
        "attachments": attachments,
    });
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AgentResp {
        text: String,
        #[serde(default)]
        cycles: i32,
        #[serde(default)]
        tools_used: Vec<String>,
        #[serde(default)]
        skills_used: Vec<String>,
        #[serde(default)]
        host_actions: Vec<serde_json::Value>,
    }
    let resp: AgentResp = go_bridge::post_json("/v1/im-agent-reply", &body)?;
    if resp.cycles > 0 || !resp.tools_used.is_empty() || !resp.skills_used.is_empty() {
        eprintln!(
            "[llm] wechat agent cycles={} tools={:?} skills={:?} hostActions={}",
            resp.cycles,
            resp.tools_used,
            resp.skills_used,
            resp.host_actions.len()
        );
    }
    Ok((resp.text, resp.host_actions))
}

pub fn generate_daily_fortune(
    llm: &LlmSettings,
    pet: &PetInstance,
    date_label: &str,
    weekday: &str,
    city: &str,
    weather: Option<&str>,
) -> Result<String, String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
        "dateLabel": date_label,
        "weekday": weekday,
        "city": city,
        "weather": weather,
    });
    let resp: TextResponse = go_bridge::post_json("/v1/fortune", &body)?;
    Ok(resp.text)
}

pub fn generate_care_voice_lines(
    llm: &LlmSettings,
    pet: &PetInstance,
    kind: &str,
    count: usize,
    avoid: &[String],
) -> Result<Vec<String>, String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
        "kind": kind,
        "count": count,
        "avoid": avoid,
    });
    let resp: LinesResponse = go_bridge::post_json("/v1/care-voice", &body)?;
    Ok(resp.lines)
}

pub fn fetch_weather_summary(city: &str) -> Result<String, String> {
    let body = json!({ "city": city });
    let resp: TextResponse = go_bridge::post_json("/v1/weather", &body)?;
    Ok(resp.text)
}

/// One round-trip: weather numbers + instant personality tip (no LLM wait).
pub fn generate_weather_bubble(
    llm: &LlmSettings,
    pet: &PetInstance,
) -> Result<(String, String), String> {
    generate_weather_bubble_ex(llm, pet, &llm.weather_city, false)
}

/// Weather bubble for a specific city; `for_tomorrow` requests next-day daily forecast.
pub fn generate_weather_bubble_ex(
    llm: &LlmSettings,
    pet: &PetInstance,
    city: &str,
    for_tomorrow: bool,
) -> Result<(String, String), String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
        "city": city,
        "forTomorrow": for_tomorrow,
    });
    let resp: WeatherBubbleResponse = go_bridge::post_json("/v1/weather-bubble", &body)?;
    let summary = if resp.summary.trim().is_empty() {
        resp.text.clone()
    } else {
        resp.summary
    };
    Ok((resp.text, summary))
}

/// Background LLM polish for weather tip.
pub fn refine_weather_tip(llm: &LlmSettings, pet: &PetInstance) -> Result<String, String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
        "city": llm.weather_city,
    });
    let resp: TextResponse = go_bridge::post_json("/v1/weather-tip", &body)?;
    Ok(resp.text)
}

/// News headlines + instant personality tip (no LLM wait).
pub fn generate_news_bubble(
    llm: &LlmSettings,
    pet: &PetInstance,
) -> Result<(String, String), String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
    });
    let resp: WeatherBubbleResponse = go_bridge::post_json("/v1/news", &body)?;
    let summary = if resp.summary.trim().is_empty() {
        resp.text.clone()
    } else {
        resp.summary
    };
    Ok((resp.text, summary))
}

/// Background LLM polish for news tip.
pub fn refine_news_tip(llm: &LlmSettings, pet: &PetInstance) -> Result<String, String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
    });
    let resp: TextResponse = go_bridge::post_json("/v1/news-tip", &body)?;
    Ok(resp.text)
}

pub fn proactive_kind_behavior(kind: &str) -> &'static str {
    match kind {
        "weather" => "look",
        "joke" => "cheer",
        "news" => "wave",
        "fortune" => "magic",
        "reminder" => "react",
        "wechat" => "phone",
        _ => "wave",
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImTriageResult {
    #[serde(default)]
    pub urgency: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub react: String,
    #[serde(default)]
    pub reminder: Option<ImReminderHint>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImReminderHint {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub at: Option<String>,
    #[serde(default)]
    pub interval_minutes: Option<i32>,
}

pub fn im_triage(
    llm: &LlmSettings,
    pet: &PetInstance,
    sender: &str,
    text: &str,
) -> Result<ImTriageResult, String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
        "sender": sender,
        "text": text,
    });
    go_bridge::post_json("/v1/im-triage", &body)
}

pub fn im_draft(
    llm: &LlmSettings,
    pet: &PetInstance,
    sender: &str,
    text: &str,
) -> Result<String, String> {
    let sug = im_suggest(llm, pet, sender, text, false)?;
    if !sug.draft.is_empty() {
        return Ok(sug.draft);
    }
    sug.suggestions
        .into_iter()
        .next()
        .ok_or_else(|| "empty draft".into())
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImSuggestResponse {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub suggestions: Vec<String>,
    #[serde(default)]
    pub draft: String,
}

pub fn im_suggest(
    llm: &LlmSettings,
    pet: &PetInstance,
    sender: &str,
    text: &str,
    refresh: bool,
) -> Result<ImSuggestResponse, String> {
    let body = json!({
        "llm": llm,
        "pet": pet,
        "sender": sender,
        "text": text,
        "refresh": refresh,
    });
    go_bridge::post_json("/v1/im-suggest", &body)
}
