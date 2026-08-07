//! Channel C: observe WeChat friend messages via native macOS Accessibility.
//!
//! Does **not** use `osascript` (osascript often lacks Accessibility permission).
//! Watches: Notification Center banners, Dock badge, WeChat window titles.

use crate::commands::SharedState;
use crate::im::{self, ImIngestRequest};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

static WATCHER_STOP: AtomicBool = AtomicBool::new(false);
static WATCHER_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifPermissionStatus {
    pub trusted: bool,
    pub watching: bool,
    pub notif_enabled: bool,
}

#[cfg(target_os = "macos")]
mod ax {
    use std::ffi::{c_void, CString};
    use std::ptr;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: *const c_void,
            value: *mut *mut c_void,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            c_str: *const i8,
            encoding: u32,
        ) -> *mut c_void;
        fn CFStringGetCString(
            the_string: *const c_void,
            buffer: *mut i8,
            buffer_size: isize,
            encoding: u32,
        ) -> u8;
        fn CFStringGetLength(the_string: *const c_void) -> isize;
        fn CFArrayGetCount(array: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(array: *const c_void, idx: isize) -> *const c_void;
        fn CFGetTypeID(cf: *const c_void) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFArrayGetTypeID() -> usize;
        fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: isize,
            key_call_backs: *const c_void,
            value_call_backs: *const c_void,
        ) -> *mut c_void;
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
        static kCFBooleanTrue: *const c_void;
    }

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const K_AX_ERROR_SUCCESS: i32 = 0;

    pub fn is_trusted() -> bool {
        unsafe { AXIsProcessTrusted() != 0 }
    }

    /// Show the system Accessibility permission prompt when possible.
    pub fn prompt_trust() -> bool {
        unsafe {
            let key_name = CString::new("AXTrustedCheckOptionPrompt").unwrap_or_default();
            let key = CFStringCreateWithCString(
                ptr::null(),
                key_name.as_ptr(),
                K_CF_STRING_ENCODING_UTF8,
            );
            if key.is_null() {
                return is_trusted();
            }
            let keys = [key as *const c_void];
            let values = [kCFBooleanTrue];
            let dict = CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );
            let ok = if dict.is_null() {
                AXIsProcessTrusted() != 0
            } else {
                let r = AXIsProcessTrustedWithOptions(dict) != 0;
                CFRelease(dict);
                r
            };
            CFRelease(key);
            ok
        }
    }

    fn cf_str(s: &str) -> *mut c_void {
        let c = CString::new(s).unwrap_or_default();
        unsafe { CFStringCreateWithCString(ptr::null(), c.as_ptr(), K_CF_STRING_ENCODING_UTF8) }
    }

    fn release(cf: *mut c_void) {
        if !cf.is_null() {
            unsafe { CFRelease(cf as *const c_void) };
        }
    }

    fn cf_to_string(cf: *const c_void) -> Option<String> {
        if cf.is_null() {
            return None;
        }
        unsafe {
            if CFGetTypeID(cf) != CFStringGetTypeID() {
                return None;
            }
            let len = CFStringGetLength(cf);
            if len < 0 {
                return None;
            }
            let mut buf = vec![0i8; (len as usize) * 4 + 16];
            if CFStringGetCString(
                cf,
                buf.as_mut_ptr(),
                buf.len() as isize,
                K_CF_STRING_ENCODING_UTF8,
            ) == 0
            {
                return None;
            }
            Some(
                std::ffi::CStr::from_ptr(buf.as_ptr())
                    .to_string_lossy()
                    .into_owned(),
            )
        }
    }

    fn copy_attr(element: *mut c_void, name: &str) -> *mut c_void {
        let attr = cf_str(name);
        let mut value: *mut c_void = ptr::null_mut();
        let err = unsafe { AXUIElementCopyAttributeValue(element, attr, &mut value) };
        release(attr);
        if err != K_AX_ERROR_SUCCESS {
            return ptr::null_mut();
        }
        value
    }

    fn attr_string(element: *mut c_void, name: &str) -> Option<String> {
        let v = copy_attr(element, name);
        let s = cf_to_string(v as *const c_void);
        release(v);
        s
    }

    fn collect_strings(element: *mut c_void, out: &mut Vec<String>, depth: u32, max_depth: u32) {
        if element.is_null() || depth > max_depth {
            return;
        }
        for key in [
            "AXTitle",
            "AXValue",
            "AXDescription",
            "AXAttributedDescription",
            "AXHelp",
        ] {
            if let Some(s) = attr_string(element, key) {
                let t = s.trim();
                if !t.is_empty() && t != "missing value" {
                    out.push(t.to_string());
                }
            }
        }
        // Role description sometimes carries banner text on newer macOS.
        if let Some(s) = attr_string(element, "AXRoleDescription") {
            let t = s.trim();
            if !t.is_empty() {
                out.push(t.to_string());
            }
        }

        let children = copy_attr(element, "AXChildren");
        if children.is_null() {
            return;
        }
        unsafe {
            if CFGetTypeID(children) == CFArrayGetTypeID() {
                let n = CFArrayGetCount(children);
                for i in 0..n.min(60) {
                    let child = CFArrayGetValueAtIndex(children, i) as *mut c_void;
                    collect_strings(child, out, depth + 1, max_depth);
                }
            }
        }
        release(children);
    }

    fn pids_matching(names: &[&str]) -> Vec<i32> {
        // /bin/ps is enough and avoids extra crates.
        let out = std::process::Command::new("ps")
            .args(["-axo", "pid=,comm="])
            .output();
        let Ok(out) = out else {
            return Vec::new();
        };
        let text = String::from_utf8_lossy(&out.stdout);
        let mut pids = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Some((pid_s, rest)) = line.split_once(char::is_whitespace) else {
                continue;
            };
            let Ok(pid) = pid_s.trim().parse::<i32>() else {
                continue;
            };
            let rest_l = rest.to_lowercase();
            if names.iter().any(|n| rest_l.contains(&n.to_lowercase())) {
                // Prefer main WeChat binary, skip helpers.
                if rest_l.contains("helper")
                    || rest_l.contains("crashpad")
                    || rest_l.contains("updater")
                    || rest_l.contains("appex")
                {
                    continue;
                }
                pids.push(pid);
            }
        }
        pids
    }

    fn scan_pid_strings(pid: i32, max_depth: u32) -> Vec<String> {
        let app = unsafe { AXUIElementCreateApplication(pid) };
        if app.is_null() {
            return Vec::new();
        }
        let mut out = Vec::new();
        collect_strings(app, &mut out, 0, max_depth);
        release(app);
        out
    }

    fn looks_wechat_text(s: &str) -> bool {
        let l = s.to_lowercase();
        l.contains("wechat") || s.contains("微信") || s.contains("Weixin")
    }

    /// Parse notification-center / banner strings into (sender, text).
    fn pick_message(strings: &[String]) -> Option<(String, String)> {
        let chrome = [
            "missing value",
            "组",
            "group",
            "通知",
            "通知中心",
            "应用程序",
            "Application",
            "关闭",
            "选项",
            "Clear",
            "Now",
            "现在",
        ];
        let filtered: Vec<&str> = strings
            .iter()
            .map(|s| s.trim())
            .filter(|s| {
                !s.is_empty()
                    && !chrome.iter().any(|c| s.eq_ignore_ascii_case(c))
                    && !s.eq_ignore_ascii_case("notification")
                    && !s.starts_with("窗口提示")
                    && !s.starts_with("未读 ")
            })
            .collect();
        if filtered.is_empty() {
            return None;
        }
        // Prefer a block that mentions WeChat, else any multi-line-ish pair.
        let has_wx = filtered.iter().any(|s| looks_wechat_text(s));
        if !has_wx {
            // Without an explicit WeChat marker, refuse — avoids NC chrome like「应用程序」.
            return None;
        }
        let usable: Vec<&str> = filtered
            .into_iter()
            .filter(|s| {
                looks_wechat_text(s) || (s.chars().count() >= 2 && s.chars().count() <= 80)
            })
            .collect();
        let content: Vec<&str> = usable
            .into_iter()
            .filter(|s| !looks_wechat_text(s) || s.chars().count() > 4)
            .collect();
        if content.is_empty() {
            return None;
        }
        let sender = content[0].chars().take(24).collect::<String>();
        if sender == "通知中心" || sender == "应用程序" {
            return None;
        }
        let text = if content.len() > 1 {
            content[1].chars().take(80).collect::<String>()
        } else {
            "（有新消息）".into()
        };
        if text == "应用程序" || text.starts_with("未读 ") || text.starts_with("窗口提示") {
            return None;
        }
        Some((sender, text))
    }

    pub fn scan_notification_banners() -> Option<(String, String)> {
        if !is_trusted() {
            return None;
        }
        // NotificationCenter process
        for pid in pids_matching(&["NotificationCenter", "usernoted"]) {
            let strings = scan_pid_strings(pid, 8);
            if let Some(msg) = pick_message(&strings) {
                // Only accept if WeChat-ish or generic banner with two parts
                let blob = strings.join("\n");
                if looks_wechat_text(&blob) || strings.len() >= 3 {
                    return Some(msg);
                }
            }
        }
        // Also scan system-wide for ephemeral banner windows.
        let system = unsafe { AXUIElementCreateSystemWide() };
        if !system.is_null() {
            let mut strings = Vec::new();
            collect_strings(system, &mut strings, 0, 5);
            release(system);
            let blob = strings.join("\n");
            if looks_wechat_text(&blob) {
                return pick_message(&strings);
            }
        }
        None
    }

    pub fn scan_wechat_windows() -> Option<(String, String)> {
        if !is_trusted() {
            return None;
        }
        for pid in pids_matching(&["WeChat", "微信"]) {
            let strings = scan_pid_strings(pid, 4);
            // Window titles often include unread like "微信 (2)" or chat name.
            for s in &strings {
                let t = s.trim();
                if t.contains('(') && (t.contains("微信") || t.to_lowercase().contains("wechat")) {
                    return Some(("微信".into(), format!("窗口提示：{t}")));
                }
                // Title like "[3] 张三"
                if t.starts_with('[') && t.contains(']') && t.chars().count() < 40 {
                    let rest = t.split(']').nth(1).unwrap_or("").trim();
                    if !rest.is_empty() {
                        return Some((rest.to_string(), "（有未读消息）".into()));
                    }
                }
            }
        }
        None
    }

    pub fn scan_dock_badge() -> Option<(String, String)> {
        if !is_trusted() {
            return None;
        }
        for pid in pids_matching(&["Dock"]) {
            let dock = unsafe { AXUIElementCreateApplication(pid) };
            if dock.is_null() {
                continue;
            }
            let mut strings = Vec::new();
            // Walk dock tiles looking for WeChat + status label nearby.
            collect_dock_badges(dock, &mut strings, 0);
            release(dock);
            for (name, badge) in strings {
                if looks_wechat_text(&name) || name.contains("微信") {
                    let badge = badge.trim().to_string();
                    if !badge.is_empty() && badge != "0" && badge != "missing value" {
                        return Some((
                            "微信".into(),
                            format!("未读 {badge} 条"),
                        ));
                    }
                }
            }
        }
        None
    }

    fn collect_dock_badges(
        element: *mut c_void,
        out: &mut Vec<(String, String)>,
        depth: u32,
    ) {
        if element.is_null() || depth > 6 {
            return;
        }
        let title = attr_string(element, "AXTitle")
            .or_else(|| attr_string(element, "AXDescription"))
            .unwrap_or_default();
        let badge = attr_string(element, "AXStatusLabel")
            .or_else(|| attr_string(element, "AXValue"))
            .unwrap_or_default();
        if !title.is_empty() {
            out.push((title, badge));
        }
        let children = copy_attr(element, "AXChildren");
        if children.is_null() {
            return;
        }
        unsafe {
            if CFGetTypeID(children) == CFArrayGetTypeID() {
                let n = CFArrayGetCount(children);
                for i in 0..n.min(80) {
                    let child = CFArrayGetValueAtIndex(children, i) as *mut c_void;
                    collect_dock_badges(child, out, depth + 1);
                }
            }
        }
        release(children);
    }
}

#[cfg(not(target_os = "macos"))]
mod ax {
    pub fn is_trusted() -> bool {
        false
    }
    pub fn prompt_trust() -> bool {
        false
    }
    pub fn scan_notification_banners() -> Option<(String, String)> {
        None
    }
    pub fn scan_wechat_windows() -> Option<(String, String)> {
        None
    }
    pub fn scan_dock_badge() -> Option<(String, String)> {
        None
    }
}

#[derive(Debug, Clone, Default)]
struct WatchSnapshot {
    banner: String,
    badge: String,
    window: String,
}

fn scan_once(prev: &WatchSnapshot) -> Option<(String, String, WatchSnapshot)> {
    let mut next = prev.clone();

    // Only notification banners carry friend message text.
    // Dock badge / window titles are unread counters — do NOT ingest them as inbox rows
    // (they spam "未读 N 条" and never clear when you read WeChat).
    if let Some((s, t)) = ax::scan_notification_banners() {
        let sig = format!("{s}|{t}");
        if sig != prev.banner && is_usable_banner(&s, &t) {
            next.banner = sig;
            return Some((s, t, next));
        }
        next.banner = sig;
    } else {
        // Keep previous banner signature when nothing visible.
    }

    if let Some((s, t)) = ax::scan_dock_badge() {
        next.badge = format!("{s}|{t}");
    } else {
        next.badge.clear();
    }

    if let Some((s, t)) = ax::scan_wechat_windows() {
        next.window = format!("{s}|{t}");
    }

    None
}

fn is_usable_banner(sender: &str, text: &str) -> bool {
    !im::is_noise_notif(sender, text)
}

pub fn permission_status(app: &AppHandle) -> Result<NotifPermissionStatus, String> {
    let enabled = {
        let shared = app.state::<SharedState>();
        let guard = shared.0.lock().map_err(|e| e.to_string())?;
        guard.settings.wechat.notif_enabled
    };
    Ok(NotifPermissionStatus {
        trusted: ax::is_trusted(),
        watching: WATCHER_RUNNING.load(Ordering::SeqCst),
        notif_enabled: enabled,
    })
}

pub fn ensure_accessibility_prompt() {
    let _ = ax::prompt_trust();
}

pub fn sync_watcher(app: &AppHandle) {
    let enabled = {
        let shared = match app.try_state::<SharedState>() {
            Some(s) => s,
            None => return,
        };
        let Ok(guard) = shared.0.lock() else {
            return;
        };
        guard.settings.wechat.notif_enabled
    };
    if enabled {
        ensure_accessibility_prompt();
        start_watcher(app.clone());
    } else {
        stop_watcher();
    }
}

pub fn stop_watcher() {
    WATCHER_STOP.store(true, Ordering::SeqCst);
}

fn start_watcher(app: AppHandle) {
    if WATCHER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    WATCHER_STOP.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        let mut snap = WatchSnapshot::default();
        let mut warned_untrusted = false;
        while !WATCHER_STOP.load(Ordering::SeqCst) {
            let still = {
                let shared = match app.try_state::<SharedState>() {
                    Some(s) => s,
                    None => break,
                };
                shared
                    .0
                    .lock()
                    .map(|g| g.settings.wechat.notif_enabled)
                    .unwrap_or(false)
            };
            if !still {
                break;
            }

            if !ax::is_trusted() {
                if !warned_untrusted {
                    warned_untrusted = true;
                    eprintln!(
                        "[wechat_notif] Accessibility not granted for FluffNest — open System Settings → Privacy → Accessibility and enable FluffNest/fluffnest"
                    );
                    let _ = ax::prompt_trust();
                }
                std::thread::sleep(std::time::Duration::from_secs(3));
                continue;
            }
            warned_untrusted = false;

            if let Some((sender, text, next)) = scan_once(&snap) {
                snap = next;
                let _ = im::ingest_message(
                    &app,
                    ImIngestRequest {
                        source: "notif".into(),
                        sender,
                        text,
                        attachments: vec![],
                        context_token: None,
                        peer_user_id: None,
                    },
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(1200));
        }
        WATCHER_RUNNING.store(false, Ordering::SeqCst);
    });
}
