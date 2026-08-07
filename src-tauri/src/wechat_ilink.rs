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
const CDN_BASE: &str = "https://novac2c.cdn.weixin.qq.com/c2c";
const CHANNEL_VERSION: &str = "1.0.2";
/// Soft limit for decrypted inbound files (bytes).
const MAX_MEDIA_BYTES: usize = 10 * 1024 * 1024;

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
    message_id: i64,
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
    #[serde(default)]
    #[allow(dead_code)]
    image_item: Option<ImageItem>,
    #[serde(default)]
    voice_item: Option<VoiceItem>,
    #[serde(default)]
    file_item: Option<FileItem>,
    #[serde(default)]
    #[allow(dead_code)]
    video_item: Option<VideoItem>,
}

#[derive(Debug, Deserialize)]
struct TextItem {
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize)]
struct ImageItem {
    #[serde(default)]
    #[allow(dead_code)]
    media: Option<CdnMedia>,
    #[serde(default)]
    #[allow(dead_code)]
    aeskey: String,
}

#[derive(Debug, Deserialize)]
struct VoiceItem {
    #[serde(default)]
    #[allow(dead_code)]
    media: Option<CdnMedia>,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize)]
struct FileItem {
    #[serde(default)]
    media: Option<CdnMedia>,
    #[serde(default)]
    file_name: String,
    #[serde(default)]
    #[allow(dead_code)]
    md5: String,
    #[serde(default)]
    #[allow(dead_code)]
    len: String,
}

#[derive(Debug, Deserialize)]
struct VideoItem {
    #[serde(default)]
    #[allow(dead_code)]
    media: Option<CdnMedia>,
}

#[derive(Debug, Deserialize)]
struct CdnMedia {
    #[serde(default)]
    encrypt_query_param: String,
    #[serde(default)]
    aes_key: String,
    #[serde(default)]
    #[allow(dead_code)]
    encrypt_type: i64,
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
    eprintln!("[wechat_ilink] poller started");
    std::thread::spawn(move || {
        let mut ticks: u64 = 0;
        while !POLLER_STOP.load(Ordering::SeqCst) {
            ticks += 1;
            if let Err(e) = poll_once(&app) {
                eprintln!("[wechat_ilink] poll: {e}");
                std::thread::sleep(std::time::Duration::from_secs(3));
            }
            // Heartbeat so we can tell the poller is still alive (long-poll is otherwise silent).
            if ticks == 1 || ticks % 20 == 0 {
                eprintln!("[wechat_ilink] poller alive ticks={ticks}");
            }
        }
        POLLER_RUNNING.store(false, Ordering::SeqCst);
        eprintln!("[wechat_ilink] poller stopped");
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
        let context_token = msg.context_token.trim().to_string();
        if context_token.is_empty() || msg.from_user_id.trim().is_empty() {
            eprintln!(
                "[wechat_ilink] skip inbound without context_token/from_user_id: {}",
                short_user_id(&msg.from_user_id)
            );
            continue;
        }

        let (text, attachments) = extract_inbound_content(app, &msg);
        if text.trim().is_empty() && attachments.is_empty() {
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
                attachments,
                context_token: Some(context_token),
                peer_user_id: Some(msg.from_user_id),
            },
        );
    }
    Ok(())
}

/// Pull text + downloadable files from an inbound WeixinMessage.
fn extract_inbound_content(
    app: &AppHandle,
    msg: &WeixinMessage,
) -> (String, Vec<crate::state::ImAttachment>) {
    use crate::state::ImAttachment;

    let mut text_parts: Vec<String> = Vec::new();
    let mut attachments: Vec<ImAttachment> = Vec::new();
    let mut unsupported_media = false;

    for item in &msg.item_list {
        match item.r#type {
            1 => {
                if let Some(t) = item.text_item.as_ref() {
                    let s = t.text.trim();
                    if !s.is_empty() {
                        text_parts.push(s.to_string());
                    }
                }
            }
            2 => {
                // Images: no OCR this round.
                unsupported_media = true;
            }
            3 => {
                if let Some(v) = item.voice_item.as_ref() {
                    let s = v.text.trim();
                    if !s.is_empty() {
                        text_parts.push(s.to_string());
                    }
                }
            }
            4 => {
                if let Some(f) = item.file_item.as_ref() {
                    match download_file_item(app, msg, f) {
                        Ok(att) => {
                            text_parts.push(format!("[文件] {}", att.name));
                            attachments.push(att);
                        }
                        Err(e) => {
                            let name = if f.file_name.trim().is_empty() {
                                "未知文件".into()
                            } else {
                                f.file_name.trim().to_string()
                            };
                            eprintln!("[wechat_ilink] file download failed ({name}): {e}");
                            text_parts.push(format!("[文件] {name}（下载失败：{e}）"));
                        }
                    }
                }
            }
            5 => {
                unsupported_media = true;
            }
            _ => {}
        }
    }

    if text_parts.is_empty() && unsupported_media && attachments.is_empty() {
        text_parts.push("收到图片/视频，暂不支持识读，请发 PDF、Word、txt 或 md 文件。".into());
    }

    (text_parts.join("\n"), attachments)
}

fn download_file_item(
    app: &AppHandle,
    msg: &WeixinMessage,
    file: &FileItem,
) -> Result<crate::state::ImAttachment, String> {
    let media = file
        .media
        .as_ref()
        .ok_or_else(|| "缺少 file media".to_string())?;
    let param = media.encrypt_query_param.trim();
    if param.is_empty() {
        return Err("缺少 encrypt_query_param".into());
    }
    let key = decode_aes_key(&media.aes_key)?;
    let cipher = cdn_download(param)?;
    if cipher.len() > MAX_MEDIA_BYTES + 64 {
        return Err(format!(
            "文件过大（{} bytes，上限 {}）",
            cipher.len(),
            MAX_MEDIA_BYTES
        ));
    }
    let plain = aes128_ecb_decrypt(&cipher, &key)?;
    if plain.len() > MAX_MEDIA_BYTES {
        return Err(format!(
            "文件过大（{} bytes，上限 {}）",
            plain.len(),
            MAX_MEDIA_BYTES
        ));
    }

    let safe_name = sanitize_filename(&file.file_name);
    let id_part = if msg.message_id != 0 {
        msg.message_id.to_string()
    } else {
        uuid::Uuid::new_v4().to_string()
    };
    let dir = media_dir(app)?;
    let path = dir.join(format!("{id_part}_{safe_name}"));
    std::fs::write(&path, &plain).map_err(|e| format!("写入失败: {e}"))?;
    Ok(crate::state::ImAttachment {
        path: path.to_string_lossy().to_string(),
        name: if file.file_name.trim().is_empty() {
            safe_name.clone()
        } else {
            file.file_name.trim().to_string()
        },
        mime: guess_mime(&safe_name),
    })
}

fn media_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("wechat-media");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建媒体目录失败: {e}"))?;
    Ok(dir)
}

fn sanitize_filename(name: &str) -> String {
    let base = name
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("file.bin")
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>();
    let trimmed = base.trim().trim_start_matches('.');
    if trimmed.is_empty() {
        "file.bin".into()
    } else if trimmed.chars().count() > 120 {
        trimmed.chars().take(120).collect()
    } else {
        trimmed.to_string()
    }
}

fn guess_mime(name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    if lower.ends_with(".pdf") {
        Some("application/pdf".into())
    } else if lower.ends_with(".docx") {
        Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document".into())
    } else if lower.ends_with(".txt") {
        Some("text/plain".into())
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        Some("text/markdown".into())
    } else {
        None
    }
}

fn cdn_download(encrypt_query_param: &str) -> Result<Vec<u8>, String> {
    let client = http_client()?;
    let url = format!("{CDN_BASE}/download?encrypted_query_param={encrypt_query_param}");
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .map_err(|e| format!("CDN 下载失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("CDN 下载失败: HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .map_err(|e| format!("读取 CDN 响应失败: {e}"))?;
    Ok(bytes.to_vec())
}

/// Decode iLink AES key: base64(raw16) or base64(hex32) or bare hex32.
fn decode_aes_key(raw: &str) -> Result<[u8; 16], String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("缺少 aes_key".into());
    }
    if let Ok(bytes) = B64.decode(s.as_bytes()) {
        if bytes.len() == 16 {
            let mut out = [0u8; 16];
            out.copy_from_slice(&bytes);
            return Ok(out);
        }
        // base64(hex string of 32 chars) → 16 bytes
        if bytes.len() == 32 && bytes.iter().all(|b| b.is_ascii_hexdigit()) {
            let hex_str = String::from_utf8_lossy(&bytes);
            let decoded = hex::decode(hex_str.as_ref())
                .map_err(|e| format!("aes_key hex 解析失败: {e}"))?;
            if decoded.len() == 16 {
                let mut out = [0u8; 16];
                out.copy_from_slice(&decoded);
                return Ok(out);
            }
        }
    }
    if s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit()) {
        let decoded = hex::decode(s).map_err(|e| format!("aes_key hex 解析失败: {e}"))?;
        if decoded.len() == 16 {
            let mut out = [0u8; 16];
            out.copy_from_slice(&decoded);
            return Ok(out);
        }
    }
    Err("无法解析 aes_key（期望 16 字节）".into())
}

fn aes128_ecb_decrypt(cipher: &[u8], key: &[u8; 16]) -> Result<Vec<u8>, String> {
    crate::aes_ecb::aes128_ecb_decrypt(cipher, key)
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
