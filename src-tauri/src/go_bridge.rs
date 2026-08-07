//! Spawn and talk to the Go AI sidecar (`fluffnest-ai`).
//!
//! The sidecar owns LLM / weather / news / fortune network work. Rust keeps
//! Tauri shell duties and persists app state.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
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
            && !self.base_url.is_empty()
            && health_ok(&self.http, &self.base_url)
        {
            return Ok(());
        }
        // One retry: hot-reload / leftover kills often fail the first spawn.
        match self.restart() {
            Ok(()) => Ok(()),
            Err(first) => {
                eprintln!("[fluffnest] Go AI sidecar first start failed: {first}; retrying…");
                std::thread::sleep(Duration::from_millis(200));
                self.restart().map_err(|second| format!("{second}（初次失败：{first}）"))
            }
        }
    }

    fn restart(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.base_url.clear();

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
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Go AI 服务无 stderr".to_string())?;

        let err_buf = Arc::new(Mutex::new(String::new()));
        let err_buf_bg = Arc::clone(&err_buf);
        std::thread::spawn(move || {
            let mut r = BufReader::new(stderr);
            let mut line = String::new();
            while r.read_line(&mut line).ok().unwrap_or(0) > 0 {
                eprint!("[fluffnest-ai] {line}");
                if let Ok(mut g) = err_buf_bg.lock() {
                    if g.len() < 4000 {
                        g.push_str(&line);
                    }
                }
                line.clear();
            }
        });

        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let deadline = Instant::now() + Duration::from_secs(10);
        let addr = loop {
            if Instant::now() > deadline {
                let detail = take_err(&err_buf);
                let status = reap(&mut child);
                return Err(format!(
                    "Go AI 服务启动超时{status}{detail}"
                ));
            }
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    // Give stderr drain a moment to capture the fatal log line.
                    std::thread::sleep(Duration::from_millis(50));
                    let detail = take_err(&err_buf);
                    let status = reap(&mut child);
                    return Err(format!(
                        "Go AI 服务意外退出{status}{detail}"
                    ));
                }
                Ok(_) => {
                    let t = line.trim();
                    if let Some(rest) = t.strip_prefix("FLUFFNEST_AI_READY ") {
                        break rest.trim().to_string();
                    }
                    // Ignore unrelated stdout lines.
                }
                Err(e) => {
                    let detail = take_err(&err_buf);
                    let status = reap(&mut child);
                    return Err(format!(
                        "读取 Go AI 就绪信号失败: {e}{status}{detail}"
                    ));
                }
            }
        };

        // Drain remaining stdout so the pipe never blocks.
        std::thread::spawn(move || {
            let mut sink = Vec::new();
            let _ = reader.read_to_end(&mut sink);
        });

        self.base_url = format!("http://{addr}");
        self.child = Some(child);

        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            if health_ok(&self.http, &self.base_url) {
                return Ok(());
            }
            // If child already died, fail fast with stderr.
            if let Some(c) = self.child.as_mut() {
                if let Ok(Some(status)) = c.try_wait() {
                    let detail = take_err(&err_buf);
                    self.child = None;
                    self.base_url.clear();
                    return Err(format!(
                        "Go AI 服务在就绪后退出 ({status}){detail}"
                    ));
                }
            }
            std::thread::sleep(Duration::from_millis(40));
        }
        let detail = take_err(&err_buf);
        Err(format!(
            "Go AI 服务健康检查失败 (url={}){detail}",
            self.base_url
        ))
    }
}

fn take_err(buf: &Arc<Mutex<String>>) -> String {
    let s = buf
        .lock()
        .map(|g| g.trim().to_string())
        .unwrap_or_default();
    if s.is_empty() {
        String::new()
    } else {
        format!("；日志：{s}")
    }
}

fn reap(child: &mut Child) -> String {
    let _ = child.kill();
    match child.wait() {
        Ok(status) => format!(" ({status})"),
        Err(_) => String::new(),
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
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    // Prefer src-tauri/binaries over next-to-exe: `npm run build:go` may overwrite
    // target/debug/fluffnest-ai while an old sidecar still holds the vnode; macOS
    // then SIGKILLs subsequent execs of that path.
    let stable = [
        manifest.join("binaries").join(format!("fluffnest-ai-{triple}")),
        manifest.join("binaries").join("fluffnest-ai"),
        manifest.join("../backend/bin").join("fluffnest-ai"),
        manifest
            .join("../backend/bin")
            .join(format!("fluffnest-ai-{triple}")),
    ];
    for c in &stable {
        if c.is_file() {
            return Ok(c.canonicalize().unwrap_or_else(|_| c.clone()));
        }
    }

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
            .timeout(Duration::from_secs(90))
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
        g.base_url.clear();
    }
}

pub fn post_json<T: serde::de::DeserializeOwned>(
    path: &str,
    body: &impl serde::Serialize,
) -> Result<T, String> {
    // Hold the bridge lock only long enough to ensure the sidecar is up and
    // to clone the client/URL. Never hold it across the LLM HTTP round-trip —
    // otherwise triage / auto-reply /「重新建议」serialize and look broken.
    let (http, url) = {
        let mut g = bridge().lock().map_err(|e| e.to_string())?;
        g.ensure_running()?;
        (g.http.clone(), format!("{}{path}", g.base_url))
    };
    let resp = http
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
    serde_json::from_str(&text).map_err(|e| format!("Go AI 响应解析失败: {e} / {text}"))
}

#[derive(serde::Deserialize)]
struct ErrorBody {
    error: String,
}
