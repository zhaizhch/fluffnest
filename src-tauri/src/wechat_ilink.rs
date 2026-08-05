//! WeChat ClawBot / iLink Bot API client (official personal Bot channel).

use crate::commands::SharedState;
use crate::im::{self, ImIngestRequest};
use crate::state::WechatAuth;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

const DEFAULT_BASE: &str = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION: &str = "1.0.2";

static POLLER_STOP: AtomicBool = AtomicBool::new(false);
static POLLER_RUNNING: AtomicBool = AtomicBool::new(false);
static LOGIN_QR: Mutex<Option<PendingQr>> = Mutex::new(None);

#[derive(Debug, Clone)]
struct PendingQr {
    qrcode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatLoginStart {
    pub qrcode: String,
    /// Data-URL or raw base64 image content for panel display.
    pub qr_image: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatStatus {
    pub logged_in: bool,
    pub clawbot_enabled: bool,
    pub polling: bool,
    pub account_label: Option<String>,
}

#[derive(Debug, Deserialize)]
struct QrcodeResp {
    #[serde(default)]
    qrcode: String,
    #[serde(default)]
    qrcode_img_content: String,
}

#[derive(Debug, Deserialize)]
struct QrStatusResp {
    #[serde(default)]
    status: String,
    #[serde(default)]
    bot_token: String,
    #[serde(default)]
    baseurl: String,
}

#[derive(Debug, Deserialize)]
struct UpdatesResp {
    #[serde(default)]
    ret: i64,
    #[serde(default)]
    msgs: Vec<WeixinMessage>,
    #[serde(default)]
    get_updates_buf: String,
}

#[derive(Debug, Deserialize)]
struct WeixinMessage {
    #[serde(default)]
    from_user_id: String,
    #[serde(default)]
    message_type: i64,
    #[serde(default)]
    context_token: String,
    #[serde(default)]
    item_list: Vec<MessageItem>,
    #[serde(default)]
    group_id: String,
}

#[derive(Debug, Deserialize)]
struct MessageItem {
    #[serde(default)]
    r#type: i64,
    #[serde(default)]
    text_item: Option<TextItem>,
}

#[derive(Debug, Deserialize)]
struct TextItem {
    #[serde(default)]
    text: String,
}

fn http_client() -> Result<&'static reqwest::blocking::Client, String> {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    Ok(CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(45))
            .build()
            .expect("http client")
    }))
}

fn random_wechat_uin() -> String {
    let n = (uuid::Uuid::new_v4().as_u128() & 0xffff_ffff) as u32;
    B64.encode(n.to_string().as_bytes())
}

/// iLink returns `qrcode_img_content` as a WeChat deep-link URL (not an image).
/// Encode that URL into a PNG data-URL so the panel `<img>` can display it.
fn qr_data_url_from_payload(payload: &str) -> Result<String, String> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Err("二维码内容为空".into());
    }
    if trimmed.starts_with("data:image/") {
        return Ok(trimmed.to_string());
    }
    // Rare: raw base64 PNG/JPEG without data: prefix
    if !trimmed.starts_with("http")
        && !trimmed.contains("://")
        && trimmed.len() > 200
        && trimmed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
    {
        return Ok(format!("data:image/png;base64,{trimmed}"));
    }

    use image::Luma;
    use qrcode::QrCode;
    use std::io::Cursor;

    let code = QrCode::new(trimmed.as_bytes()).map_err(|e| format!("生成二维码失败: {e}"))?;
    let img = code
        .render::<Luma<u8>>()
        .min_dimensions(240, 240)
        .dark_color(Luma([0u8]))
        .light_color(Luma([255u8]))
        .build();
    let mut png = Cursor::new(Vec::new());
    img.write_to(&mut png, image::ImageFormat::Png)
        .map_err(|e| format!("编码二维码 PNG 失败: {e}"))?;
    Ok(format!(
        "data:image/png;base64,{}",
        B64.encode(png.into_inner())
    ))
}

fn auth_headers(token: Option<&str>) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
    let mut h = HeaderMap::new();
    h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    h.insert(
        "AuthorizationType",
        HeaderValue::from_static("ilink_bot_token"),
    );
    h.insert("SKRouteTag", HeaderValue::from_static("1001"));
    if let Ok(v) = HeaderValue::from_str(&random_wechat_uin()) {
        h.insert("X-WECHAT-UIN", v);
    }
    if let Some(t) = token.filter(|s| !s.is_empty()) {
        if let Ok(v) = HeaderValue::from_str(&format!("Bearer {t}")) {
            h.insert(AUTHORIZATION, v);
        }
    }
    h
}

fn resolve_base(auth: &WechatAuth) -> String {
    let b = auth.base_url.trim();
    if b.is_empty() {
        DEFAULT_BASE.into()
    } else {
        b.trim_end_matches('/').to_string()
    }
}

pub fn start_login(app: &AppHandle) -> Result<WechatLoginStart, String> {
    let client = http_client()?;
    let url = format!("{DEFAULT_BASE}/ilink/bot/get_bot_qrcode?bot_type=3");
    let resp = client
        .get(&url)
        .headers(auth_headers(None))
        .send()
        .map_err(|e| format!("获取登录二维码失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("获取登录二维码失败: HTTP {}", resp.status()));
    }
    let body: QrcodeResp = resp
        .json()
        .map_err(|e| format!("解析二维码响应失败: {e}"))?;
    if body.qrcode.is_empty() {
        return Err("二维码为空，请确认微信 ClawBot / iLink 可用".into());
    }
    // `qrcode_img_content` is a WeChat deep-link URL to encode into a scannable QR image.
    let payload = if !body.qrcode_img_content.trim().is_empty() {
        body.qrcode_img_content.trim().to_string()
    } else {
        body.qrcode.clone()
    };
    let qr_image = qr_data_url_from_payload(&payload)?;
    *LOGIN_QR.lock().map_err(|e| e.to_string())? = Some(PendingQr {
        qrcode: body.qrcode.clone(),
    });
    let _ = app.emit(
        "wechat-login-status",
        json!({ "status": "waiting", "qrcode": body.qrcode }),
    );
    Ok(WechatLoginStart {
        qrcode: body.qrcode,
        qr_image,
    })
}

pub fn poll_login_status(app: &AppHandle) -> Result<WechatStatus, String> {
    let qrcode = {
        let g = LOGIN_QR.lock().map_err(|e| e.to_string())?;
        g.as_ref().map(|q| q.qrcode.clone())
    };
    let Some(qrcode) = qrcode else {
        return status(app);
    };

    let client = http_client()?;
    let url = format!("{DEFAULT_BASE}/ilink/bot/get_qrcode_status?qrcode={qrcode}");
    let resp = client
        .get(&url)
        .headers(auth_headers(None))
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .map_err(|e| format!("轮询扫码状态失败: {e}"))?;
    if !resp.status().is_success() {
        return status(app);
    }
    let body: QrStatusResp = resp
        .json()
        .map_err(|e| format!("解析扫码状态失败: {e}"))?;

    if body.status == "confirmed" && !body.bot_token.is_empty() {
        {
            let shared = app.state::<SharedState>();
            let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
            guard.wechat_auth.bot_token = body.bot_token.clone();
            guard.wechat_auth.base_url = if body.baseurl.is_empty() {
                DEFAULT_BASE.into()
            } else {
                body.baseurl.clone()
            };
            guard.wechat_auth.get_updates_buf.clear();
            guard.wechat_auth.account_label = Some("ClawBot".into());
            guard.settings.wechat.clawbot_enabled = true;
            // ClawBot DMs are meant for chatting with the pet — auto-reply on by default.
            guard.settings.wechat.auto_reply_from_wechat = true;
            crate::state::save_state(app, &guard)?;
        }
        *LOGIN_QR.lock().map_err(|e| e.to_string())? = None;
        let _ = app.emit("wechat-login-status", json!({ "status": "confirmed" }));
        sync_poller(app);
    } else {
        let _ = app.emit(
            "wechat-login-status",
            json!({ "status": body.status, "qrcode": qrcode }),
        );
    }
    status(app)
}

pub fn logout(app: &AppHandle) -> Result<WechatStatus, String> {
    stop_poller();
    {
        let shared = app.state::<SharedState>();
        let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
        guard.wechat_auth = WechatAuth::default();
        guard.settings.wechat.clawbot_enabled = false;
        crate::state::save_state(app, &guard)?;
    }
    *LOGIN_QR.lock().map_err(|e| e.to_string())? = None;
    let _ = app.emit("wechat-login-status", json!({ "status": "logged_out" }));
    status(app)
}

pub fn status(app: &AppHandle) -> Result<WechatStatus, String> {
    let shared = app.state::<SharedState>();
    let guard = shared.0.lock().map_err(|e| e.to_string())?;
    Ok(WechatStatus {
        logged_in: !guard.wechat_auth.bot_token.is_empty(),
        clawbot_enabled: guard.settings.wechat.clawbot_enabled,
        polling: POLLER_RUNNING.load(Ordering::SeqCst),
        account_label: guard.wechat_auth.account_label.clone(),
    })
}

pub fn stop_poller() {
    POLLER_STOP.store(true, Ordering::SeqCst);
}

pub fn sync_poller(app: &AppHandle) {
    let (enabled, has_token) = {
        let shared = match app.try_state::<SharedState>() {
            Some(s) => s,
            None => return,
        };
        let Ok(guard) = shared.0.lock() else {
            return;
        };
        (
            guard.settings.wechat.clawbot_enabled,
            !guard.wechat_auth.bot_token.is_empty(),
        )
    };
    if enabled && has_token {
        start_poller(app.clone());
    } else {
        stop_poller();
    }
}

fn start_poller(app: AppHandle) {
    if POLLER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    POLLER_STOP.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        while !POLLER_STOP.load(Ordering::SeqCst) {
            if let Err(e) = poll_once(&app) {
                eprintln!("[wechat_ilink] poll: {e}");
                std::thread::sleep(std::time::Duration::from_secs(3));
            }
        }
        POLLER_RUNNING.store(false, Ordering::SeqCst);
    });
}

fn poll_once(app: &AppHandle) -> Result<(), String> {
    let (token, base, buf) = {
        let shared = app.state::<SharedState>();
        let guard = shared.0.lock().map_err(|e| e.to_string())?;
        if !guard.settings.wechat.clawbot_enabled || guard.wechat_auth.bot_token.is_empty() {
            POLLER_STOP.store(true, Ordering::SeqCst);
            return Ok(());
        }
        (
            guard.wechat_auth.bot_token.clone(),
            resolve_base(&guard.wechat_auth),
            guard.wechat_auth.get_updates_buf.clone(),
        )
    };

    let client = http_client()?;
    let url = format!("{base}/ilink/bot/getupdates");
    let body = json!({
        "get_updates_buf": buf,
        "base_info": { "channel_version": CHANNEL_VERSION }
    });
    let resp = client
        .post(&url)
        .headers(auth_headers(Some(&token)))
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("getupdates HTTP {}", resp.status()));
    }
    let parsed: UpdatesResp = resp.json().map_err(|e| e.to_string())?;
    if parsed.ret != 0 && parsed.ret != -1 {
        // -1 / timeout-ish: still update cursor if provided
    }

    if !parsed.get_updates_buf.is_empty() {
        let shared = app.state::<SharedState>();
        let mut guard = shared.0.lock().map_err(|e| e.to_string())?;
        guard.wechat_auth.get_updates_buf = parsed.get_updates_buf;
        let _ = crate::state::save_state(app, &guard);
    }

    for msg in parsed.msgs {
        // message_type 1 = user inbound (per iLink docs)
        if msg.message_type != 1 {
            continue;
        }
        let text = msg
            .item_list
            .iter()
            .find_map(|i| {
                if i.r#type == 1 {
                    i.text_item.as_ref().map(|t| t.text.clone())
                } else {
                    None
                }
            })
            .unwrap_or_default();
        if text.trim().is_empty() {
            continue;
        }
        let context_token = msg.context_token.trim().to_string();
        if context_token.is_empty() || msg.from_user_id.trim().is_empty() {
            eprintln!(
                "[wechat_ilink] skip inbound without context_token/from_user_id: {}",
                short_user_id(&msg.from_user_id)
            );
            continue;
        }
        let sender = if msg.group_id.is_empty() {
            short_user_id(&msg.from_user_id)
        } else {
            format!("群·{}", short_user_id(&msg.from_user_id))
        };
        let _ = im::ingest_message(
            app,
            ImIngestRequest {
                source: "clawbot".into(),
                sender,
                text,
                context_token: Some(context_token),
                peer_user_id: Some(msg.from_user_id),
            },
        );
    }
    Ok(())
}

fn short_user_id(id: &str) -> String {
    let base = id.split('@').next().unwrap_or(id);
    if base.chars().count() <= 10 {
        base.to_string()
    } else {
        format!("{}…", base.chars().take(8).collect::<String>())
    }
}

pub fn send_text(
    app: &AppHandle,
    to_user_id: &str,
    context_token: &str,
    text: &str,
) -> Result<(), String> {
    let to_user_id = to_user_id.trim();
    let context_token = context_token.trim();
    let text = text.trim();
    if to_user_id.is_empty() {
        return Err("缺少 to_user_id，无法发到微信".into());
    }
    if context_token.is_empty() {
        return Err("缺少 context_token，无法发到微信会话".into());
    }
    if text.is_empty() {
        return Err("回复内容为空".into());
    }

    let (token, base) = {
        let shared = app.state::<SharedState>();
        let guard = shared.0.lock().map_err(|e| e.to_string())?;
        if guard.wechat_auth.bot_token.is_empty() {
            return Err("未登录微信 ClawBot".into());
        }
        (
            guard.wechat_auth.bot_token.clone(),
            resolve_base(&guard.wechat_auth),
        )
    };
    let client = http_client()?;
    let url = format!("{base}/ilink/bot/sendmessage");
    let client_id = format!(
        "fluffnest:{}-{}",
        chrono::Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let body = json!({
        "msg": {
            "from_user_id": "",
            "to_user_id": to_user_id,
            "client_id": client_id,
            "message_type": 2,
            "message_state": 2,
            "context_token": context_token,
            "item_list": [{
                "type": 1,
                "text_item": { "text": text }
            }]
        },
        "base_info": { "channel_version": CHANNEL_VERSION }
    });
    let resp = client
        .post(&url)
        .headers(auth_headers(Some(&token)))
        .json(&body)
        .send()
        .map_err(|e| format!("发送到微信失败: {e}"))?;
    let status = resp.status();
    let raw = resp.text().unwrap_or_default();
    if !status.is_success() {
        return Err(format!("发送到微信失败: HTTP {status} {raw}"));
    }
    // Prefer business errcode/ret when present (HTTP 200 can still mean session expired).
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
        let ret = v.get("ret").and_then(|x| x.as_i64()).unwrap_or(0);
        let errcode = v.get("errcode").and_then(|x| x.as_i64()).unwrap_or(0);
        if ret == -14 || errcode == -14 {
            return Err("ClawBot 登录已过期，请重新扫码".into());
        }
        if ret != 0 || errcode != 0 {
            return Err(format!("发送到微信失败: ret={ret} errcode={errcode} {raw}"));
        }
    }
    eprintln!(
        "[wechat_ilink] sent to {} ({} chars)",
        short_user_id(to_user_id),
        text.chars().count()
    );
    Ok(())
}
