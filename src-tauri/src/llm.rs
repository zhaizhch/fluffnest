//! OpenAI-compatible LLM + light data fetchers (weather / news) for desk-pet dialogue.

use crate::state::{LlmSettings, PetInstance};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;

const MAX_BUBBLE_CHARS: usize = 36;
const MAX_CHAT_CHARS: usize = 120;

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

fn personality_blurb(p: &str) -> &'static str {
    match p {
        "calm" => "性格安静温柔，话不多，像轻轻陪伴；语气平和、克制，偶尔会关心主人。",
        "lively" => "性格活泼开朗，爱开玩笑和用轻快语气词；容易兴奋，喜欢逗主人开心。",
        "clingy" => "性格黏人撒娇，很依赖主人；会求贴贴、吃醋式关心，语气软软的。",
        _ => "性格温和，像一只软软的桌面小伙伴。",
    }
}

fn bond_label(bond: i32) -> &'static str {
    if bond >= 220 {
        "心灵相通"
    } else if bond >= 120 {
        "挚友"
    } else if bond >= 60 {
        "好友"
    } else if bond >= 20 {
        "熟悉"
    } else {
        "初识"
    }
}

pub fn system_prompt(pet: &PetInstance) -> String {
    format!(
        "你是 macOS 桌面宠物「{name}」。\n\
         - 性格标签：{personality}\n\
         - 性格表现：{blurb}\n\
         - 与主人关系：{bond_label}（亲密度 {bond}）\n\
         - 当前心情 {mood}/100。\n\
         规则：\n\
         1. 始终用第一人称，以宠物口吻对主人说话（可叫「主人」）。\n\
         2. 每一句都必须鲜明体现上述性格，不要变成通用助手腔。\n\
         3. 默认中文；不要 markdown、不要列表、不要解释设定。\n\
         4. 气泡台词要短；聊天回复也要简洁。\n\
         5. 禁止深度思考、推理过程、分析步骤；不要输出 <think> 等内容，立刻直接给出最终台词。\n\
         6. 不讨论政治敏感与成人内容；新闻吐槽保持轻松无害。",
        name = pet.name,
        personality = pet.personality,
        blurb = personality_blurb(&pet.personality),
        bond_label = bond_label(pet.bond),
        bond = pet.bond,
        mood = pet.mood,
    )
}

fn truncate_chars(s: &str, max: usize) -> String {
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i >= max {
            break;
        }
        out.push(ch);
    }
    out.trim().to_string()
}

fn clean_line(raw: &str, max: usize) -> String {
    let mut t = raw.trim().to_string();
    for wrap in ['"', '\'', '「', '」', '“', '”'] {
        t = t.trim_matches(wrap).to_string();
    }
    t = t
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches(['-', '*', '•', '1', '.', ')', ' '])
        .to_string();
    truncate_chars(&t, max)
}

fn ensure_configured(llm: &LlmSettings) -> Result<(), String> {
    if !llm.enabled {
        return Err("请先在设置中开启 AI 对话".into());
    }
    if llm.api_key.trim().is_empty() {
        return Err("请先填写 LLM API Key".into());
    }
    if llm.api_base.trim().is_empty() || llm.model.trim().is_empty() {
        return Err("请填写 API Base 与模型名".into());
    }
    Ok(())
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Deserialize)]
struct ChoiceMessage {
    content: Option<String>,
    /// Some thinking models put chain-of-thought here — we ignore it on purpose.
    #[serde(default)]
    #[allow(dead_code)]
    reasoning_content: Option<String>,
}

#[derive(Clone, Copy)]
pub struct CompletionOpts {
    pub max_tokens: u32,
    pub timeout_secs: u64,
    pub temperature: f64,
}

impl CompletionOpts {
    pub fn bubble() -> Self {
        Self {
            max_tokens: 64,
            timeout_secs: 12,
            temperature: 0.7,
        }
    }
    pub fn chat() -> Self {
        Self {
            max_tokens: 120,
            timeout_secs: 15,
            temperature: 0.75,
        }
    }
    pub fn care_voice_batch() -> Self {
        Self {
            max_tokens: 320,
            timeout_secs: 18,
            temperature: 0.85,
        }
    }
}

fn strip_thinking(raw: &str) -> String {
    let re = Regex::new(r"(?is)<(?:think|thinking|reasoning|thought|redacted_reasoning)>.*?</(?:think|thinking|reasoning|thought|redacted_reasoning)>")
        .ok();
    let cleaned = if let Some(re) = re {
        re.replace_all(raw, "").to_string()
    } else {
        raw.to_string()
    };
    cleaned
        .lines()
        .filter(|l| {
            let t = l.trim().to_ascii_lowercase();
            !(t.starts_with("thinking:")
                || t.starts_with("reasoning:")
                || t.starts_with("分析：")
                || t.starts_with("思考："))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_fast_body(
    llm: &LlmSettings,
    messages: &[serde_json::Value],
    opts: CompletionOpts,
    with_thinking_flags: bool,
) -> serde_json::Value {
    let mut body = json!({
        "model": llm.model,
        "messages": messages,
        "temperature": opts.temperature,
        "max_tokens": opts.max_tokens,
        "stream": false,
    });
    if with_thinking_flags {
        // Common OpenAI-compatible switches to skip deep thinking / CoT.
        // Unknown keys are ignored by many gateways; on 400 we retry without them.
        body["enable_thinking"] = json!(false);
        body["thinking"] = json!({ "type": "disabled" });
        body["reasoning"] = json!({ "effort": "none", "exclude": true });
        body["reasoning_effort"] = json!("minimal");
        body["chat_template_kwargs"] = json!({ "enable_thinking": false });
    }
    body
}

pub fn chat_completion(
    llm: &LlmSettings,
    messages: Vec<serde_json::Value>,
    opts: CompletionOpts,
) -> Result<String, String> {
    ensure_configured(llm)?;
    let base = normalize_api_base(&llm.api_base);
    let url = format!("{base}/chat/completions");

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(opts.timeout_secs))
        .build()
        .map_err(|e| e.to_string())?;

    let auth = format!("Bearer {}", llm.api_key.trim());

    // Prefer fast path with thinking disabled; fall back if provider rejects extra fields.
    let attempts = [true, false];
    let mut last_err = String::from("LLM 请求失败");
    for with_flags in attempts {
        let body = build_fast_body(llm, &messages, opts, with_flags);
        let resp = client
            .post(&url)
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("网络错误: {e}"))?;

        let status = resp.status();
        let text = resp.text().map_err(|e| e.to_string())?;
        if status.is_success() {
            let parsed: ChatCompletionResponse =
                serde_json::from_str(&text).map_err(|e| format!("解析 LLM 响应失败: {e}"))?;
            let content = parsed
                .choices
                .first()
                .and_then(|c| c.message.content.as_ref())
                .map(|s| strip_thinking(s).trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "LLM 返回空内容".to_string())?;
            return Ok(content);
        }

        last_err = format!(
            "LLM 请求失败 ({status}): {}",
            truncate_chars(&text, 180)
        );
        // Only retry without flags on client/schema rejection
        if !(status.as_u16() == 400 || status.as_u16() == 422) {
            return Err(last_err);
        }
    }
    Err(last_err)
}

/// Ensure OpenAI-compatible hosts include `/v1` (e.g. DeepSeek).
fn normalize_api_base(raw: &str) -> String {
    let b = raw.trim().trim_end_matches('/').to_string();
    if b.is_empty() {
        return "https://api.openai.com/v1".into();
    }
    if b.ends_with("/v1") {
        return b;
    }
    let host = b.to_ascii_lowercase();
    if host.contains("api.deepseek.com")
        || host.contains("api.openai.com")
        || host.contains("openai.com")
        || host.contains("dashscope.aliyuncs.com")
        || host.contains("api.moonshot.cn")
        || host.contains("api.siliconflow.cn")
    {
        return format!("{b}/v1");
    }
    b
}

pub fn generate_bubble_line(
    llm: &LlmSettings,
    pet: &PetInstance,
    kind: &str,
    action: &str,
    extra: Option<&str>,
) -> Result<String, String> {
    let task = match kind {
        "click" | "interact" => format!(
            "主人刚刚对你做了「{action}」。请按你的性格说一句很短的反应（不超过 28 字）。只输出这一句，必须能听出是「{}」性格。",
            pet.personality
        ),
        "idle" => format!(
            "你正在自己玩「{action}」。偶尔轻声嘀咕一句很短的话（不超过 24 字），贴合「{}」性格。只输出这一句。",
            pet.personality
        ),
        "reminder" => format!(
            "到了提醒时间：{action}。请用你的「{}」性格温柔提醒主人一句（不超过 30 字）。只输出这一句。口语化，适合朗读。",
            pet.personality
        ),
        "care_voice" => format!(
            "你正在边跳舞边提醒主人「{action}」。请用「{}」性格说一句很口语、适合朗读的提醒（不超过 26 字）。可撒娇/俏皮/温柔，不要像播报。只输出这一句。",
            pet.personality
        ),
        "weather" => format!(
            "根据天气信息，用「{}」性格说一句关心主人的话（不超过 32 字）。天气：{}\n只输出这一句。",
            pet.personality,
            extra.unwrap_or(action)
        ),
        "joke" => format!(
            "用「{}」性格讲一句适合桌宠说的冷笑话或小俏皮话（不超过 32 字）。只输出笑话本身。",
            pet.personality
        ),
        "news" => format!(
            "下面是一条科技或娱乐圈新闻（国内外都有可能）。用「{}」性格缩成一句轻松吐槽（不超过 32 字，不要吓人、不要政治）：\n{}\n只输出这一句。",
            pet.personality,
            extra.unwrap_or(action)
        ),
        _ => format!(
            "用「{}」性格说一句很短的话（不超过 28 字），情境：{action}。只输出这一句。",
            pet.personality
        ),
    };

    let messages = vec![
        json!({"role": "system", "content": system_prompt(pet)}),
        json!({
            "role": "user",
            "content": format!("{task}\n（直接输出最终一句话，不要思考过程）")
        }),
    ];
    let raw = chat_completion(llm, messages, CompletionOpts::bubble())?;
    Ok(clean_line(&raw, MAX_BUBBLE_CHARS))
}

/// Generate a batch of spoken reminder lines for continuous care-alert TTS.
pub fn generate_care_voice_lines(
    llm: &LlmSettings,
    pet: &PetInstance,
    kind: &str,
    count: usize,
    avoid: &[String],
) -> Result<Vec<String>, String> {
    ensure_configured(llm)?;
    let count = count.clamp(4, 12);
    let topic = match kind {
        "stretch" => "久坐太久，起来活动 / 伸懒腰 / 走动",
        _ => "该喝水了，补水休息一下",
    };
    let style = match pet.personality.as_str() {
        "lively" => "活泼跳脱，爱用轻快语气词，像边跳边喊主人",
        "clingy" => "黏人撒娇，软软的，求关注式提醒",
        "calm" => "温柔克制，轻声提醒，不催促",
        _ => "温和口语",
    };

    let avoid_block = if avoid.is_empty() {
        String::new()
    } else {
        let listed: Vec<String> = avoid
            .iter()
            .rev()
            .take(16)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!(
            "\n5. 严禁重复或改写下列已说过的句子（意思接近也不行）：\n{}",
            listed
                .iter()
                .map(|s| format!("- {s}"))
                .collect::<Vec<_>>()
                .join("\n")
        )
    };

    let messages = vec![
        json!({"role": "system", "content": system_prompt(pet)}),
        json!({
            "role": "user",
            "content": format!(
                "你要边跳舞边连续提醒主人「{topic}」。\n\
                 请一口气写出 {count} 句互不重复的口语台词，供语音朗读。\n\
                 要求：\n\
                 1. 每句 8～24 个字，像真人随口说，不要播报腔、不要编号。\n\
                 2. 鲜明体现「{personality}」性格：{style}\n\
                 3. 内容都围绕这个提醒主题，但每句角度/措辞必须不同（例如关心、撒娇、俏皮、比喻各用一次）。\n\
                 4. 只输出 JSON 字符串数组，例如 [\"…\",\"…\"]，不要其它文字。{avoid_block}\n\
                 （直接输出 JSON，不要思考过程）",
                topic = topic,
                count = count,
                personality = pet.personality,
                style = style,
                avoid_block = avoid_block,
            )
        }),
    ];

    let raw = chat_completion(llm, messages, CompletionOpts::care_voice_batch())?;
    let lines = parse_line_list(&raw, count)?;
    Ok(filter_fresh_lines(lines, avoid))
}

fn normalize_speech_key(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && !"，,。.!！？?～~…、；;：:\"'「」『』".contains(*c))
        .collect::<String>()
        .to_lowercase()
}

fn filter_fresh_lines(lines: Vec<String>, avoid: &[String]) -> Vec<String> {
    let mut seen: std::collections::HashSet<String> = avoid
        .iter()
        .map(|s| normalize_speech_key(s))
        .filter(|s| !s.is_empty())
        .collect();
    let mut out = Vec::new();
    for line in lines {
        let key = normalize_speech_key(&line);
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        out.push(line);
    }
    out
}

fn parse_line_list(raw: &str, want: usize) -> Result<Vec<String>, String> {
    let trimmed = raw.trim();
    // Extract JSON array if model wrapped it in prose
    let json_slice = if let (Some(a), Some(b)) = (trimmed.find('['), trimmed.rfind(']')) {
        &trimmed[a..=b]
    } else {
        trimmed
    };

    if let Ok(arr) = serde_json::from_str::<Vec<String>>(json_slice) {
        let lines: Vec<String> = arr
            .into_iter()
            .map(|s| clean_line(&s, 28))
            .filter(|s| !s.is_empty())
            .collect();
        if !lines.is_empty() {
            return Ok(lines);
        }
    }

    // Fallback: split by newlines
    let lines: Vec<String> = trimmed
        .lines()
        .map(|l| {
            clean_line(
                l.trim_start_matches(|c: char| c.is_ascii_digit() || ".-、）)】 ".contains(c)),
                28,
            )
        })
        .filter(|s| s.chars().count() >= 4)
        .take(want)
        .collect();
    if lines.is_empty() {
        return Err("未能解析提醒台词".into());
    }
    Ok(lines)
}

pub fn generate_chat_reply(
    llm: &LlmSettings,
    pet: &PetInstance,
    history: &[ChatMessage],
    user_message: &str,
) -> Result<String, String> {
    let mut messages = vec![json!({
        "role": "system",
        "content": format!(
            "{}\n聊天时回复不超过 {} 字，像桌宠在气泡/面板里说话，可分两句但保持口语。",
            system_prompt(pet),
            MAX_CHAT_CHARS
        )
    })];

    for m in history.iter().rev().take(12).collect::<Vec<_>>().into_iter().rev() {
        let role = if m.role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        messages.push(json!({"role": role, "content": m.content}));
    }
    messages.push(json!({
        "role": "user",
        "content": format!("{user_message}\n（直接回复，不要思考过程）")
    }));

    let raw = chat_completion(llm, messages, CompletionOpts::chat())?;
    Ok(clean_line(&raw, MAX_CHAT_CHARS))
}

#[derive(Deserialize)]
struct GeoResult {
    results: Option<Vec<GeoHit>>,
}

#[derive(Deserialize)]
struct GeoHit {
    latitude: f64,
    longitude: f64,
    name: Option<String>,
    country: Option<String>,
}

#[derive(Deserialize)]
struct Forecast {
    current: Option<ForecastCurrent>,
    daily: Option<ForecastDaily>,
}

#[derive(Deserialize)]
struct ForecastCurrent {
    temperature_2m: Option<f64>,
    weather_code: Option<i32>,
    wind_speed_10m: Option<f64>,
}

#[derive(Deserialize)]
struct ForecastDaily {
    temperature_2m_max: Option<Vec<f64>>,
    temperature_2m_min: Option<Vec<f64>>,
}

fn weather_code_zh(code: i32) -> &'static str {
    match code {
        0 => "晴朗",
        1 | 2 => "多云",
        3 => "阴天",
        45 | 48 => "有雾",
        51 | 53 | 55 => "毛毛雨",
        61 | 63 | 65 => "下雨",
        71 | 73 | 75 => "下雪",
        80 | 81 | 82 => "阵雨",
        95 | 96 | 99 => "雷阵雨",
        _ => "天气一般",
    }
}

pub fn fetch_weather_summary(city: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let geo_url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1&language=zh&format=json",
        urlencoding_lite(city)
    );
    let geo: GeoResult = client
        .get(&geo_url)
        .send()
        .map_err(|e| format!("地理编码失败: {e}"))?
        .json()
        .map_err(|e| format!("地理编码解析失败: {e}"))?;

    let hit = geo
        .results
        .and_then(|v| v.into_iter().next())
        .ok_or_else(|| format!("找不到城市「{city}」"))?;

    let forecast_url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1",
        hit.latitude, hit.longitude
    );
    let forecast: Forecast = client
        .get(&forecast_url)
        .send()
        .map_err(|e| format!("天气请求失败: {e}"))?
        .json()
        .map_err(|e| format!("天气解析失败: {e}"))?;

    let cur = forecast.current.ok_or_else(|| "无当前天气".to_string())?;
    let label = hit.name.unwrap_or_else(|| city.to_string());
    let country = hit.country.unwrap_or_default();
    let code = cur.weather_code.unwrap_or(0);
    let temp = cur.temperature_2m.unwrap_or(0.0);
    let wind = cur.wind_speed_10m.unwrap_or(0.0);
    let tmax = forecast
        .daily
        .as_ref()
        .and_then(|d| d.temperature_2m_max.as_ref())
        .and_then(|v| v.first())
        .copied();
    let tmin = forecast
        .daily
        .as_ref()
        .and_then(|d| d.temperature_2m_min.as_ref())
        .and_then(|v| v.first())
        .copied();

    let range = match (tmin, tmax) {
        (Some(a), Some(b)) => format!("，今日 {}~{}℃", a.round(), b.round()),
        _ => String::new(),
    };

    Ok(format!(
        "{label}{country_bit}：{}，当前 {:.0}℃{range}，风速 {:.0} km/h",
        weather_code_zh(code),
        temp,
        wind,
        country_bit = if country.is_empty() {
            String::new()
        } else {
            format!("（{country}）")
        },
    ))
}

fn urlencoding_lite(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub fn fetch_hot_headline() -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("FluffNest/0.2 (deskpet; +https://github.com/fluffnest)")
        .build()
        .map_err(|e| e.to_string())?;

    // Tech + entertainment, domestic & international
    let feeds: &[(&str, &str)] = &[
        ("科技", "https://www.ithome.com/rss/"),
        ("科技", "https://www.solidot.org/index.rss"),
        ("科技", "https://feeds.bbci.co.uk/news/technology/rss.xml"),
        ("科技", "https://www.theverge.com/rss/index.xml"),
        ("科技", "https://techcrunch.com/feed/"),
        ("娱乐", "https://www.chinanews.com.cn/rss/entertainment.xml"),
        ("娱乐", "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml"),
        ("娱乐", "https://variety.com/feed/"),
        ("娱乐", "https://www.billboard.com/feed/"),
    ];

    let item_re =
        Regex::new(r"(?is)<item\b[^>]*>\s*<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>")
            .map_err(|e| e.to_string())?;
    // Some feeds (Atom) use <entry><title>
    let entry_re =
        Regex::new(r"(?is)<entry\b[^>]*>\s*<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>")
            .map_err(|e| e.to_string())?;

    let mut pool: Vec<(String, String)> = Vec::new();

    for &(category, url) in feeds {
        let Ok(resp) = client.get(url).send() else {
            continue;
        };
        let Ok(body) = resp.text() else {
            continue;
        };
        for re in [&item_re, &entry_re] {
            for cap in re.captures_iter(&body).take(6) {
                let title = decode_xml_title(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
                if title.chars().count() >= 6 && !looks_like_feed_meta(&title) {
                    pool.push((category.to_string(), title));
                }
            }
        }
        if pool.len() >= 24 {
            break;
        }
    }

    if pool.is_empty() {
        return Err("暂时拉不到科技/娱乐新闻".into());
    }

    // Prefer a balanced pick: shuffle-ish by time-based index
    let idx = (chrono::Local::now().timestamp() as usize).wrapping_mul(2654435761) % pool.len();
    let (category, title) = &pool[idx];
    Ok(format!("【{category}】{title}"))
}

fn decode_xml_title(raw: &str) -> String {
    raw.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace('\n', " ")
        .replace('\r', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn looks_like_feed_meta(title: &str) -> bool {
    let t = title.to_ascii_lowercase();
    t.contains("rss")
        || t.contains("subscribe")
        || t == "technology"
        || t == "entertainment"
        || title.chars().count() > 80
}

pub fn proactive_kind_behavior(kind: &str) -> &'static str {
    match kind {
        "weather" => "look",
        "joke" => "cheer",
        "news" => "wave",
        "reminder" => "react",
        _ => "wave",
    }
}
