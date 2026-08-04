//! Microsoft Edge neural TTS (msedge-tts) — natural Mandarin for care alerts.
//! Plays via macOS `afplay` so reminder audio is not blocked by webview autoplay.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use msedge_tts::tts::client::connect;
use msedge_tts::tts::SpeechConfig;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsAudio {
    pub mime: String,
    pub base64: String,
    pub voice: String,
}

fn ensure_crypto_provider() {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        // msedge-tts / ureq / rustls 0.23 require an explicit process-level provider.
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    });
}

fn voice_short_name(personality: &str) -> &'static str {
    match personality {
        "lively" => "XiaoyiNeural",
        "clingy" => "XiaoxiaoNeural",
        "calm" => "XiaohanNeural",
        _ => "XiaoxiaoNeural",
    }
}

fn speech_config(personality: &str) -> SpeechConfig {
    let short = voice_short_name(personality);
    SpeechConfig {
        voice_name: format!(
            "Microsoft Server Speech Text to Speech Voice (zh-CN, {short})"
        ),
        audio_format: "audio-24khz-48kbitrate-mono-mp3".into(),
        pitch: 2,
        rate: -8,
        volume: 0,
    }
}

fn resolved_config(personality: &str) -> SpeechConfig {
    static VOICES: OnceLock<Vec<msedge_tts::voice::Voice>> = OnceLock::new();
    let short = voice_short_name(personality);
    let want = format!("zh-CN-{short}");

    let list = VOICES.get().or_else(|| match msedge_tts::voice::get_voices_list() {
        Ok(voices) => {
            let _ = VOICES.set(voices);
            VOICES.get()
        }
        Err(_) => None,
    });

    if let Some(list) = list {
        if let Some(v) = list.iter().find(|v| {
            v.short_name
                .as_deref()
                .is_some_and(|s| s.eq_ignore_ascii_case(&want))
                || v.name.contains(short)
        }) {
            let mut cfg = SpeechConfig::from(v);
            cfg.pitch = 2;
            cfg.rate = -8;
            return cfg;
        }
    }

    speech_config(personality)
}

fn synthesize_bytes(text: &str, personality: &str) -> Result<(Vec<u8>, String), String> {
    ensure_crypto_provider();
    let text = text.trim();
    if text.is_empty() {
        return Err("empty speech text".into());
    }
    let clipped: String = text.chars().take(80).collect();
    let config = resolved_config(personality);
    let voice_label = voice_short_name(personality).to_string();

    let mut client = connect().map_err(|e| format!("TTS 连接失败: {e}"))?;
    let audio = client
        .synthesize(&clipped, &config)
        .map_err(|e| format!("TTS 合成失败: {e}"))?;

    if audio.audio_bytes.is_empty() {
        return Err("TTS 返回空音频".into());
    }
    Ok((audio.audio_bytes, voice_label))
}

/// Synthesize one spoken line with Edge neural TTS. Returns MP3 as base64.
pub fn synthesize(text: &str, personality: &str) -> Result<TtsAudio, String> {
    let (bytes, voice) = synthesize_bytes(text, personality)?;
    Ok(TtsAudio {
        mime: "audio/mpeg".into(),
        base64: B64.encode(&bytes),
        voice,
    })
}

/// Synthesize and play through the OS speaker (bypasses WKWebView autoplay limits).
pub fn speak(text: &str, personality: &str) -> Result<(), String> {
    let (bytes, _voice) = synthesize_bytes(text, personality)?;
    play_mp3_bytes(&bytes)
}

fn play_mp3_bytes(bytes: &[u8]) -> Result<(), String> {
    let path = std::env::temp_dir().join(format!(
        "fluffnest-tts-{}.mp3",
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&path, bytes).map_err(|e| format!("写入临时音频失败: {e}"))?;

    let result = play_with_system(&path);
    let _ = std::fs::remove_file(&path);
    result
}

fn play_with_system(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("afplay")
            .arg(path)
            .status()
            .map_err(|e| format!("afplay 启动失败: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("afplay 退出码异常: {status}"));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("当前平台暂不支持系统播音，请使用前端播放".into())
    }
}
