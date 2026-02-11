use serde::{Deserialize, Serialize};
use sysinfo::{System, ProcessesToUpdate, ProcessRefreshKind, UpdateKind};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: String,
    pub exe_path: String,
    pub cmd_args: Vec<String>,
    pub process_type: String,
    pub memory_mb: f64,
    pub cpu_percent: f32,
    pub url: String,
    pub instance_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessGroup {
    pub browser_pid: u32,
    pub browser_exe: String,
    pub channel: String,
    pub instance_type: String,
    pub host_app: String,
    pub processes: Vec<ProcessInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CdpPageInfo {
    pub process_id: Option<u32>,
    pub url: String,
    pub target_type: Option<String>,
}

/// Get all running Edge processes, grouped by parent browser process
#[tauri::command]
pub fn get_edge_processes() -> Result<Vec<ProcessGroup>, String> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_exe(UpdateKind::Always)
            .with_memory()
            .with_cpu(),
    );

    let mut edge_processes: Vec<ProcessInfo> = Vec::new();

    for (pid, process) in sys.processes() {
        let exe_path = process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let name = process.name().to_string_lossy().to_string();

        if name.to_lowercase().contains("msedge") || exe_path.to_lowercase().contains("msedge") {
            let cmd_args: Vec<String> = process.cmd().iter().map(|s| s.to_string_lossy().to_string()).collect();

            let process_type = detect_process_type(&cmd_args);
            let memory_mb = process.memory() as f64 / (1024.0 * 1024.0);
            let url = extract_url(&cmd_args);
            let instance_type = detect_instance_type(&cmd_args, &exe_path);

            edge_processes.push(ProcessInfo {
                pid: pid.as_u32(),
                parent_pid: process.parent().map(|p| p.as_u32()),
                name,
                exe_path,
                cmd_args,
                process_type,
                memory_mb: (memory_mb * 100.0).round() / 100.0,
                cpu_percent: process.cpu_usage(),
                url,
                instance_type,
            });
        }
    }

    // Build a set of all Edge PIDs for quick lookup
    let edge_pids: std::collections::HashSet<u32> = edge_processes.iter().map(|p| p.pid).collect();

    // Find root Edge processes: those whose parent is NOT another Edge process
    let root_pids: Vec<u32> = edge_processes
        .iter()
        .filter(|p| {
            match p.parent_pid {
                Some(ppid) => !edge_pids.contains(&ppid),
                None => true,
            }
        })
        .map(|p| p.pid)
        .collect();

    // Group processes by root ancestor
    let mut groups: HashMap<u32, Vec<ProcessInfo>> = HashMap::new();
    for proc in &edge_processes {
        let group_pid = find_root_ancestor(&edge_processes, proc.pid, &root_pids, &edge_pids);
        groups.entry(group_pid).or_default().push(proc.clone());
    }

    let mut result: Vec<ProcessGroup> = groups
        .into_iter()
        .map(|(browser_pid, mut processes)| {
            let browser_proc = processes.iter().find(|p| p.pid == browser_pid);
            let browser_exe = browser_proc.map(|p| p.exe_path.clone()).unwrap_or_default();
            let channel = detect_channel(&browser_exe);

            // Determine group instance type: check all processes in the group
            let instance_type = processes.iter()
                .map(|p| p.instance_type.as_str())
                .find(|t| *t == "WebView2" || *t == "Copilot")
                .unwrap_or("Browser")
                .to_string();

            // For WebView2/Copilot groups, find the host app from the parent process
            let host_app = if instance_type == "WebView2" || instance_type == "Copilot" {
                detect_host_app(&sys, browser_pid)
            } else {
                String::new()
            };

            processes.sort_by_key(|p| p.pid);

            ProcessGroup {
                browser_pid,
                browser_exe,
                channel,
                instance_type,
                host_app,
                processes,
            }
        })
        .collect();

    // Sort groups: regular browsers first, then WebView2, then others
    result.sort_by(|a, b| {
        let order = |t: &str| match t {
            "Browser" => 0,
            "WebView2" => 1,
            "Copilot" => 2,
            _ => 3,
        };
        order(&a.instance_type).cmp(&order(&b.instance_type))
            .then(a.browser_pid.cmp(&b.browser_pid))
    });

    Ok(result)
}

/// Terminate a process by PID
#[tauri::command]
pub fn terminate_process(pid: u32) -> Result<String, String> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let pid = sysinfo::Pid::from_u32(pid);

    if let Some(process) = sys.process(pid) {
        process.kill();
        Ok(format!("Process {} terminated", pid))
    } else {
        Err(format!("Process {} not found", pid))
    }
}

/// Launch a debugger attached to a process
#[tauri::command]
pub fn debug_process(pid: u32, include_children: bool) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        // Try debuggers in order: WinDbg Preview (windbgx), classic windbg, then VS JIT debugger
        let debuggers: Vec<(&str, Vec<String>)> = vec![
            (
                "windbgx.exe",
                if include_children {
                    vec![format!("-p"), format!("{}", pid), "-o".to_string()]
                } else {
                    vec![format!("-p"), format!("{}", pid)]
                },
            ),
            (
                "windbg.exe",
                if include_children {
                    vec![format!("-p"), format!("{}", pid), "-o".to_string()]
                } else {
                    vec![format!("-p"), format!("{}", pid)]
                },
            ),
            ("vsjitdebugger.exe", vec![format!("-p"), format!("{}", pid)]),
        ];

        for (debugger, args) in &debuggers {
            match std::process::Command::new(debugger)
                .args(args)
                .spawn()
            {
                Ok(_) => return Ok(format!("{} attached to process {}", debugger, pid)),
                Err(_) => continue,
            }
        }

        Err("No debugger found. Install Visual Studio (vsjitdebugger), WinDbg Preview (windbgx), or WinDbg (windbg).".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = include_children;
        std::process::Command::new("lldb")
            .args(["-p", &pid.to_string()])
            .spawn()
            .map_err(|e| format!("Failed to launch debugger: {}", e))?;
        Ok(format!("Debugger attached to process {}", pid))
    }
}

fn detect_process_type(cmd_args: &[String]) -> String {
    let joined = cmd_args.join(" ");
    if joined.contains("--type=renderer") {
        if joined.contains("--extension-process") {
            "Extension".to_string()
        } else {
            "Renderer".to_string()
        }
    } else if joined.contains("--type=gpu-process") {
        "GPU".to_string()
    } else if joined.contains("--type=utility") {
        "Utility".to_string()
    } else if joined.contains("--type=crashpad-handler") {
        "Crashpad".to_string()
    } else if joined.contains("--type=ppapi") {
        "Plugin".to_string()
    } else if joined.contains("--type=broker") {
        "Broker".to_string()
    } else if !joined.contains("--type=") {
        "Browser".to_string()
    } else {
        let type_start = joined.find("--type=").unwrap_or(0) + 7;
        let type_end = joined[type_start..].find(' ').map(|i| i + type_start).unwrap_or(joined.len());
        joined[type_start..type_end].to_string()
    }
}

/// Detect whether this is a WebView2, Copilot, or regular browser instance
fn detect_instance_type(cmd_args: &[String], exe_path: &str) -> String {
    let joined = cmd_args.join(" ");
    let lower = joined.to_lowercase();
    let exe_lower = exe_path.to_lowercase();

    // WebView2 detection
    if lower.contains("--webview-exe-name")
        || lower.contains("--embedded-browser-webview")
        || exe_lower.contains("webview2")
        || lower.contains("--webview2")
    {
        // Check for Copilot specifically
        if lower.contains("copilot") || lower.contains("m365") {
            return "Copilot".to_string();
        }
        return "WebView2".to_string();
    }

    // Copilot sidebar detection
    if lower.contains("copilot") {
        return "Copilot".to_string();
    }

    "Browser".to_string()
}

/// Extract URL from renderer command line args
fn extract_url(cmd_args: &[String]) -> String {
    for arg in cmd_args {
        // Some renderers have the URL as the last arg without a flag
        if arg.starts_with("http://") || arg.starts_with("https://") {
            return arg.clone();
        }
        // PWA apps launched with --app=URL
        if let Some(url) = arg.strip_prefix("--app=") {
            return url.to_string();
        }
    }
    String::new()
}

fn detect_channel(exe_path: &str) -> String {
    let lower = exe_path.to_lowercase();
    if lower.contains("edge sxs") || lower.contains("canary") {
        "Canary".to_string()
    } else if lower.contains("edge dev") {
        "Dev".to_string()
    } else if lower.contains("edge beta") {
        "Beta".to_string()
    } else if lower.contains("\\out\\") {
        "Local Build".to_string()
    } else {
        "Stable".to_string()
    }
}

/// For WebView2 groups, find the hosting application by looking at the parent process
/// of the root msedge.exe, or --webview-exe-name in the command line args.
fn detect_host_app(sys: &System, browser_pid: u32) -> String {
    let pid = sysinfo::Pid::from_u32(browser_pid);
    if let Some(proc) = sys.process(pid) {
        // First check command line for --webview-exe-name=<name>
        for arg in proc.cmd() {
            let arg_str = arg.to_string_lossy();
            if let Some(name) = arg_str.strip_prefix("--webview-exe-name=") {
                return name.to_string();
            }
        }
        // Fall back to parent process name
        if let Some(parent_pid) = proc.parent() {
            if let Some(parent) = sys.process(parent_pid) {
                let parent_name = parent.name().to_string_lossy().to_string();
                // Don't report msedge as host
                if !parent_name.to_lowercase().contains("msedge") {
                    return parent_name;
                }
            }
        }
    }
    String::new()
}

fn find_root_ancestor(
    processes: &[ProcessInfo],
    pid: u32,
    root_pids: &[u32],
    edge_pids: &std::collections::HashSet<u32>,
) -> u32 {
    if root_pids.contains(&pid) {
        return pid;
    }
    let mut current = pid;
    for _ in 0..20 {
        if root_pids.contains(&current) {
            return current;
        }
        if let Some(proc) = processes.iter().find(|p| p.pid == current) {
            if let Some(ppid) = proc.parent_pid {
                if edge_pids.contains(&ppid) {
                    current = ppid;
                } else {
                    // Parent is not an Edge process, so current is the root
                    return current;
                }
            } else {
                return current;
            }
        } else {
            return current;
        }
    }
    current
}

/// Extract debugging port from browser process command line
fn extract_debugging_port(cmd_args: &[String]) -> Option<u16> {
    for arg in cmd_args {
        if let Some(port_str) = arg.strip_prefix("--remote-debugging-port=") {
            if let Ok(port) = port_str.parse::<u16>() {
                if port > 0 {
                    return Some(port);
                }
            }
        }
    }
    None
}

/// Extract user data dir from command line args
fn extract_user_data_dir(cmd_args: &[String]) -> Option<String> {
    for arg in cmd_args {
        if let Some(dir) = arg.strip_prefix("--user-data-dir=") {
            return Some(dir.trim_matches('"').to_string());
        }
    }
    None
}

/// Try to read DevToolsActivePort file to get debugging port
fn read_devtools_active_port(user_data_dir: &str) -> Option<u16> {
    let path = std::path::Path::new(user_data_dir).join("DevToolsActivePort");
    if let Ok(contents) = std::fs::read_to_string(&path) {
        if let Some(first_line) = contents.lines().next() {
            if let Ok(port) = first_line.trim().parse::<u16>() {
                return Some(port);
            }
        }
    }
    None
}

#[derive(Debug, Deserialize)]
struct CdpTarget {
    title: Option<String>,
    url: Option<String>,
    #[serde(rename = "type")]
    target_type: Option<String>,
    #[serde(rename = "processId")]
    process_id: Option<u32>,
    #[allow(dead_code)]
    id: Option<String>,
}

/// Dechunk HTTP chunked transfer encoding
fn dechunk_body(body: &str) -> String {
    let mut result = String::new();
    let mut remaining = body;
    loop {
        let line_end = match remaining.find("\r\n") {
            Some(pos) => pos,
            None => break,
        };
        let size_str = remaining[..line_end].trim();
        let chunk_size = match usize::from_str_radix(size_str, 16) {
            Ok(0) => break,
            Ok(s) => s,
            Err(_) => break,
        };
        remaining = &remaining[line_end + 2..];
        let chunk_end = chunk_size.min(remaining.len());
        result.push_str(&remaining[..chunk_end]);
        remaining = &remaining[chunk_end..];
        if remaining.starts_with("\r\n") {
            remaining = &remaining[2..];
        }
    }
    result
}

/// Fetch CDP targets from a Chrome DevTools Protocol debugging port
fn fetch_cdp_targets(port: u16) -> Vec<CdpTarget> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::{Duration, Instant};

    let addr = format!("127.0.0.1:{}", port);
    let sock_addr: std::net::SocketAddr = match addr.parse() {
        Ok(a) => a,
        Err(_) => return vec![],
    };

    let mut stream = match TcpStream::connect_timeout(&sock_addr, Duration::from_millis(200)) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stream.set_read_timeout(Some(Duration::from_millis(500))).ok();
    stream.set_write_timeout(Some(Duration::from_millis(200))).ok();

    let request = format!(
        "GET /json HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );

    if stream.write_all(request.as_bytes()).is_err() {
        return vec![];
    }

    // Read response fully — retry on partial reads until connection closes or time budget exhausted
    let mut response = Vec::new();
    let read_start = Instant::now();
    let read_budget = Duration::from_secs(1);
    loop {
        if read_start.elapsed() > read_budget {
            break;
        }
        let mut buf = vec![0u8; 8192];
        match stream.read(&mut buf) {
            Ok(0) => break, // Connection closed
            Ok(n) => response.extend_from_slice(&buf[..n]),
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut => break,
            Err(_) => break,
        }
    }
    let response_str = String::from_utf8_lossy(&response);

    // Separate headers from body
    let body = match response_str.find("\r\n\r\n") {
        Some(pos) => {
            let headers = &response_str[..pos];
            let raw_body = &response_str[pos + 4..];
            if headers.to_lowercase().contains("transfer-encoding: chunked") {
                dechunk_body(raw_body)
            } else {
                raw_body.to_string()
            }
        }
        None => return vec![],
    };

    // Find JSON array in body
    let json_str = match (body.find('['), body.rfind(']')) {
        (Some(start), Some(end)) if start < end => &body[start..=end],
        _ => return vec![],
    };

    serde_json::from_str(json_str).unwrap_or_default()
}

/// Diagnostic: return raw CDP target info for a given debugging port
#[tauri::command]
pub fn get_cdp_debug_info(port: u16) -> Result<String, String> {
    let targets = fetch_cdp_targets(port);
    if targets.is_empty() {
        return Err(format!("No targets found on port {}. Is Edge running with --remote-debugging-port={}?", port, port));
    }
    let summary: Vec<String> = targets.iter().map(|t| {
        format!(
            "type={:?} processId={:?} url={:?} title={:?} id={:?}",
            t.target_type, t.process_id, t.url, t.title, t.id
        )
    }).collect();
    Ok(summary.join("\n"))
}

/// Get the browser-level WebSocket debugger URL from /json/version
fn get_browser_ws_url(port: u16) -> Option<String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::{Duration, Instant};

    let addr = format!("127.0.0.1:{}", port);
    let sock_addr: std::net::SocketAddr = addr.parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&sock_addr, Duration::from_millis(200)).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(500))).ok();
    stream.set_write_timeout(Some(Duration::from_millis(200))).ok();

    let request = format!(
        "GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );
    stream.write_all(request.as_bytes()).ok()?;

    let mut response = Vec::new();
    let read_start = Instant::now();
    loop {
        if read_start.elapsed() > Duration::from_secs(1) { break; }
        let mut buf = vec![0u8; 4096];
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => response.extend_from_slice(&buf[..n]),
            Err(_) => break,
        }
    }
    let response_str = String::from_utf8_lossy(&response);
    let body = response_str.split("\r\n\r\n").nth(1)?;

    // Handle chunked encoding
    let json_str = if body.contains("webSocketDebuggerUrl") {
        body.to_string()
    } else {
        dechunk_body(body)
    };

    let v: serde_json::Value = serde_json::from_str(&json_str).ok()?;
    v.get("webSocketDebuggerUrl")?.as_str().map(|s| s.to_string())
}

/// Target info as returned by CDP WebSocket protocol
#[derive(Debug, Deserialize)]
struct CdpWsTargetInfo {
    #[serde(rename = "targetId")]
    target_id: Option<String>,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    target_type: Option<String>,
    title: Option<String>,
    url: Option<String>,
    pid: Option<u32>,
}

/// Fetch page targets with PIDs via CDP WebSocket.
/// Uses Target.attachToTarget(flatten:true) to populate the pid field.
fn fetch_cdp_targets_ws(port: u16) -> Vec<CdpPageInfo> {
    use tungstenite::{connect, Message};
    use std::time::{Duration, Instant};

    let ws_url = match get_browser_ws_url(port) {
        Some(url) => url,
        None => return vec![],
    };

    let (mut socket, _response) = match connect(&ws_url) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    // Set underlying stream to non-blocking with timeout
    if let tungstenite::stream::MaybeTlsStream::Plain(ref s) = socket.get_ref() {
        s.set_read_timeout(Some(Duration::from_millis(500))).ok();
        s.set_write_timeout(Some(Duration::from_millis(500))).ok();
    }

    let budget = Instant::now();
    let max_time = Duration::from_secs(3);

    // Step 1: Get all targets (pages, service workers, iframes, etc.)
    let get_targets_msg = r#"{"id":1,"method":"Target.getTargets"}"#;
    if socket.send(Message::Text(get_targets_msg.to_string())).is_err() {
        let _ = socket.close(None);
        return vec![];
    }

    // Read until we get the id:1 response
    let mut page_targets: Vec<CdpWsTargetInfo> = Vec::new();
    loop {
        if budget.elapsed() > max_time { break; }
        match socket.read() {
            Ok(Message::Text(text)) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if v.get("id").and_then(|i| i.as_u64()) == Some(1) {
                        if let Some(infos) = v.pointer("/result/targetInfos") {
                            if let Ok(targets) = serde_json::from_value::<Vec<CdpWsTargetInfo>>(infos.clone()) {
                                page_targets = targets;
                            }
                        }
                        break;
                    }
                }
            }
            Ok(_) => continue,
            Err(_) => break,
        }
    }

    if page_targets.is_empty() {
        let _ = socket.close(None);
        return vec![];
    }

    // Step 2: Attach to each target to get PIDs
    let mut results: Vec<CdpPageInfo> = Vec::new();
    let mut msg_id: u64 = 10;
    let mut pending_attaches: HashMap<u64, String> = HashMap::new(); // msg_id -> target_id
    let mut sessions_to_detach: Vec<String> = Vec::new();
    let mut target_id_to_result_idx: HashMap<String, usize> = HashMap::new(); // target_id -> results index

    for target in &page_targets {
        let target_id = match &target.target_id {
            Some(id) => id.clone(),
            None => continue,
        };

        let ttype = target.target_type.as_deref().unwrap_or("page");

        // Skip target types that aren't interesting
        let dominated = matches!(ttype, "browser" | "webview" | "auction_worklet");
        if dominated { continue; }

        let url = match &target.url {
            Some(u) if !u.is_empty()
                && u != "about:blank"
                && !u.starts_with("devtools://")
                && !u.starts_with("chrome-extension://")
                && !u.starts_with("edge://") => u.clone(),
            _ => continue,
        };

        let friendly_type = match ttype {
            "page" => None,
            "service_worker" => Some("Service Worker"),
            "shared_worker" => Some("Shared Worker"),
            "worker" => Some("Worker"),
            "iframe" => Some("iframe"),
            "background_page" => Some("Background Page"),
            other => Some(other),
        };

        let title = target.title.as_deref().unwrap_or("");
        let display = if !title.is_empty() && title != url.as_str() {
            format!("{} \u{2014} {}", title, url)
        } else {
            url.clone()
        };

        let target_type_str = friendly_type.map(|s| s.to_string());

        // If PID is already populated and non-zero, use it directly
        if let Some(pid) = target.pid.filter(|&p| p > 0) {
            results.push(CdpPageInfo {
                process_id: Some(pid),
                url: display,
                target_type: target_type_str,
            });
            continue;
        }

        // Need to attach to get the PID
        let attach_msg = format!(
            r#"{{"id":{},"method":"Target.attachToTarget","params":{{"targetId":"{}","flatten":true}}}}"#,
            msg_id, target_id
        );
        if socket.send(Message::Text(attach_msg)).is_err() {
            continue;
        }
        pending_attaches.insert(msg_id, target_id.clone());

        // Store display URL and track its index for PID fill-in later
        let idx = results.len();
        target_id_to_result_idx.insert(target_id, idx);
        results.push(CdpPageInfo {
            process_id: None, // Will be filled from attachedToTarget event
            url: display,
            target_type: target_type_str,
        });

        msg_id += 1;
    }

    // Read responses to collect PIDs from attachedToTarget events
    // Map target_id -> (pid, session_id)
    let mut target_pids: HashMap<String, u32> = HashMap::new();
    let mut responses_needed = pending_attaches.len();

    if responses_needed > 0 {
        loop {
            if budget.elapsed() > max_time || responses_needed == 0 { break; }
            match socket.read() {
                Ok(Message::Text(text)) => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                        // Handle attachedToTarget event
                        if v.get("method").and_then(|m| m.as_str()) == Some("Target.attachedToTarget") {
                            if let Some(params) = v.get("params") {
                                let pid = params.pointer("/targetInfo/pid")
                                    .and_then(|p| p.as_u64())
                                    .map(|p| p as u32)
                                    .filter(|&p| p > 0);
                                let tid = params.pointer("/targetInfo/targetId")
                                    .and_then(|t| t.as_str())
                                    .map(|s| s.to_string());
                                let session_id = params.get("sessionId")
                                    .and_then(|s| s.as_str())
                                    .map(|s| s.to_string());

                                if let (Some(pid), Some(tid)) = (pid, tid) {
                                    target_pids.insert(tid, pid);
                                }
                                if let Some(sid) = session_id {
                                    sessions_to_detach.push(sid);
                                }
                            }
                        }
                        // Handle attach response (decrements counter)
                        if let Some(id) = v.get("id").and_then(|i| i.as_u64()) {
                            if pending_attaches.contains_key(&id) {
                                responses_needed -= 1;
                            }
                        }
                    }
                }
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    }

    // Fill in PIDs from attachedToTarget events using target_id -> result index map
    for (tid, pid) in &target_pids {
        if let Some(&idx) = target_id_to_result_idx.get(tid) {
            if idx < results.len() {
                results[idx].process_id = Some(*pid);
            }
        }
    }

    // Detach from all sessions (best effort)
    for session_id in &sessions_to_detach {
        let detach_msg = format!(
            r#"{{"id":{},"method":"Target.detachFromTarget","params":{{"sessionId":"{}"}}}}"#,
            msg_id, session_id
        );
        let _ = socket.send(Message::Text(detach_msg));
        msg_id += 1;
    }

    let _ = socket.close(None);

    // Only return entries with PIDs
    results.into_iter().filter(|p| p.process_id.is_some()).collect()
}

/// Fetch CDP URLs for all running Edge browser groups.
/// Returns a map of debugging port -> list of (processId, display URL).
/// Uses WebSocket CDP protocol to attach to targets and get real PIDs.
/// Called separately from get_edge_processes so the process list renders instantly.
#[tauri::command]
pub fn get_cdp_urls() -> Result<HashMap<u16, Vec<CdpPageInfo>>, String> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_exe(UpdateKind::Always),
    );

    let mut result: HashMap<u16, Vec<CdpPageInfo>> = HashMap::new();

    for (_pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_string();
        let exe_path = process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        if !name.to_lowercase().contains("msedge") && !exe_path.to_lowercase().contains("msedge") {
            continue;
        }
        let cmd_args: Vec<String> = process.cmd().iter().map(|s| s.to_string_lossy().to_string()).collect();
        if detect_process_type(&cmd_args) != "Browser" {
            continue;
        }

        let mut port = extract_debugging_port(&cmd_args);
        if port.is_none() {
            if let Some(user_data_dir) = extract_user_data_dir(&cmd_args) {
                port = read_devtools_active_port(&user_data_dir);
            }
        }
        let port = match port {
            Some(p) => p,
            None => continue,
        };

        if result.contains_key(&port) {
            continue;
        }

        let pages = fetch_cdp_targets_ws(port);
        if !pages.is_empty() {
            result.insert(port, pages);
        }
    }

    Ok(result)
}
