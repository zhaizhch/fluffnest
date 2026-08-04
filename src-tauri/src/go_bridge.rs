//! Spawn and talk to the Go AI sidecar (`fluffnest-ai`).
//!
//! The sidecar owns LLM / weather / news / fortune network work. Rust keeps
//! Tauri shell duties and persists app state.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

static BRIDGE: OnceLock<Mutex<GoBridge>> = OnceLock::new();

struct GoBridge {
    child: Option<Child>,
    base_url: String,
    /// Shared blocking HTTP client (connection reuse to localhost).
    http: reqwest::blocking::Client,
}

impl GoBridge {
    fn ensure_running(&mut self) -> Result<(), String> {
        if self.child.as_mut().map(|c| c.try_wait().ok().flatten().is_none()) == Some(true)
            && health_ok(&self.http, &self.base_url)
        {
            return Ok(());
        }
        self.restart()
    }

    fn restart(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let bin = resolve_sidecar_bin()?;
        let mut child = Command::new(&bin)
            .arg("--addr")
            .arg("127.0.0.1:0")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|e| format!("启动 Go AI 服务失败 ({bin:?}): {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Go AI 服务无 stdout".to_string())?;
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let deadline = Instant::now() + Duration::from_secs(8);
        let addr = loop {
            if Instant::now() > deadline {
                let _ = child.kill();
                return Err("Go AI 服务启动超时".into());
            }
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = child.kill();
                    return Err("Go AI 服务意外退出".into());
                }
                Ok(_) => {
                    let t = line.trim();
                    if let Some(rest) = t.strip_prefix("FLUFFNEST_AI_READY ") {
                        break rest.trim().to_string();
                    }
                }
                Err(e) => {
                    let _ = child.kill();
                    return Err(format!("读取 Go AI 就绪信号失败: {e}"));
                }
            }
        };

        // Drain remaining stdout on a side thread so the pipe never blocks.
        std::thread::spawn(move || {
            let mut sink = String::new();
            while reader.read_line(&mut sink).ok().unwrap_or(0) > 0 {
                sink.clear();
            }
        });

        self.base_url = format!("http://{addr}");
        self.child = Some(child);

        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            if health_ok(&self.http, &self.base_url) {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(40));
        }
        Err("Go AI 服务健康检查失败".into())
    }
}

fn health_ok(http: &reqwest::blocking::Client, base: &str) -> bool {
    http.get(format!("{base}/health"))
        .timeout(Duration::from_millis(400))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn resolve_sidecar_bin() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("FLUFFNEST_AI_BIN") {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Ok(path);
        }
    }

    let triple = current_target_triple();
    let names = [format!("fluffnest-ai-{triple}"), "fluffnest-ai".into()];

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in &names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Ok(candidate);
                }
                if let Some(contents) = dir.parent() {
                    for sub in ["Resources", "MacOS", "binaries"] {
                        let c = contents.join(sub).join(name);
                        if c.is_file() {
                            return Ok(c);
                        }
                    }
                }
            }
        }
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest.join("binaries").join(format!("fluffnest-ai-{triple}")),
        manifest.join("binaries").join("fluffnest-ai"),
        manifest.join("../backend/bin").join("fluffnest-ai"),
        manifest
            .join("../backend/bin")
            .join(format!("fluffnest-ai-{triple}")),
    ];
    for c in candidates {
        if c.is_file() {
            return Ok(c.canonicalize().unwrap_or(c));
        }
    }

    Err(
        "找不到 fluffnest-ai。请先运行: npm run build:go 或 scripts/build-go-sidecar.sh"
            .into(),
    )
}

fn current_target_triple() -> String {
    std::env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| std::env::var("TARGET"))
        .unwrap_or_else(|_| {
            if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
                "aarch64-apple-darwin".into()
            } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
                "x86_64-apple-darwin".into()
            } else {
                "unknown".into()
            }
        })
}

fn bridge() -> &'static Mutex<GoBridge> {
    BRIDGE.get_or_init(|| {
        let http = reqwest::blocking::Client::builder()
            .pool_max_idle_per_host(8)
            .tcp_nodelay(true)
            .timeout(Duration::from_secs(35))
            .build()
            .expect("http client");
        Mutex::new(GoBridge {
            child: None,
            base_url: String::new(),
            http,
        })
    })
}

/// Start the Go sidecar early during app setup (non-fatal on failure).
pub fn start() {
    match bridge().lock() {
        Ok(mut g) => {
            if let Err(e) = g.ensure_running() {
                eprintln!("[fluffnest] Go AI sidecar: {e}");
            }
        }
        Err(e) => eprintln!("[fluffnest] Go AI sidecar lock: {e}"),
    }
}

pub fn shutdown() {
    if let Ok(mut g) = bridge().lock() {
        if let Some(mut child) = g.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn post_json<T: serde::de::DeserializeOwned>(
    path: &str,
    body: &impl serde::Serialize,
) -> Result<T, String> {
    let mut g = bridge().lock().map_err(|e| e.to_string())?;
    g.ensure_running()?;
    let url = format!("{}{path}", g.base_url);
    let resp = g
        .http
        .post(&url)
        .json(body)
        .send()
        .map_err(|e| format!("Go AI 请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        if let Ok(err) = serde_json::from_str::<ErrorBody>(&text) {
            return Err(err.error);
        }
        return Err(format!("Go AI 错误 ({status}): {text}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("解析 Go AI 响应失败: {e}"))
}

#[derive(serde::Deserialize)]
struct ErrorBody {
    error: String,
}
