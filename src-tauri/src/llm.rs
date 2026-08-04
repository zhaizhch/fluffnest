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
}

#[derive(Debug, Deserialize)]
struct TextResponse {
    text: String,
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

pub fn fetch_hot_headline() -> Result<String, String> {
    let body = json!({});
    let resp: TextResponse = go_bridge::post_json("/v1/news", &body)?;
    Ok(resp.text)
}

pub fn proactive_kind_behavior(kind: &str) -> &'static str {
    match kind {
        "weather" => "look",
        "joke" => "cheer",
        "news" => "wave",
        "fortune" => "magic",
        "reminder" => "react",
        _ => "wave",
    }
}
