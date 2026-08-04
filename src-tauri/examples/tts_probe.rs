use msedge_tts::tts::client::connect;
use msedge_tts::tts::SpeechConfig;

fn main() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let config = SpeechConfig {
        voice_name: "Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)"
            .into(),
        audio_format: "audio-24khz-48kbitrate-mono-mp3".into(),
        pitch: 2,
        rate: -8,
        volume: 0,
    };
    match connect() {
        Ok(mut c) => match c.synthesize("该喝水啦，先休息一下。", &config) {
            Ok(a) => {
                println!("ok bytes={}", a.audio_bytes.len());
                let path = std::env::temp_dir().join("fluffnest-tts-probe.mp3");
                std::fs::write(&path, &a.audio_bytes).unwrap();
                let _ = std::process::Command::new("afplay").arg(&path).status();
                let _ = std::fs::remove_file(&path);
            }
            Err(e) => eprintln!("synthesize err: {e}"),
        },
        Err(e) => eprintln!("connect err: {e}"),
    }
}
