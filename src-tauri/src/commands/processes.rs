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

    // For each process, walk up the parent chain within Edge processes to find its root
    let mut groups: HashMap<u32, Vec<ProcessInfo>> = HashMap::new();
    for proc in &edge_processes {
        let group_pid = find_root_ancestor(&edge_processes, proc.pid, &root_pids, &edge_pids);
        groups.entry(group_pid).or_default().push(proc.clone());
    }

    // Try to enrich renderer processes with URLs via Chrome DevTools Protocol
    for processes in groups.values_mut() {
        enrich_with_cdp(processes);
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
    use std::time::Duration;

    let addr = format!("127.0.0.1:{}", port);
    let sock_addr: std::net::SocketAddr = match addr.parse() {
        Ok(a) => a,
        Err(_) => return vec![],
    };

    let mut stream = match TcpStream::connect_timeout(&sock_addr, Duration::from_millis(300)) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
    stream.set_write_timeout(Some(Duration::from_millis(500))).ok();

    let request = format!(
        "GET /json HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );

    if stream.write_all(request.as_bytes()).is_err() {
        return vec![];
    }

    let mut response = Vec::new();
    let _ = stream.read_to_end(&mut response);
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

/// Try to enrich renderer processes with URLs via Chrome DevTools Protocol.
/// This works when Edge is started with --remote-debugging-port=PORT.
/// The Edge Process Viewer in src3 uses internal Mojo IPC to the browser's
/// Task Manager for URL extraction, which is not available from external apps.
fn enrich_with_cdp(processes: &mut Vec<ProcessInfo>) {
    // Find browser process command line
    let browser_args = match processes.iter().find(|p| p.process_type == "Browser") {
        Some(bp) => bp.cmd_args.clone(),
        None => return,
    };

    // Try to get debugging port from command line
    let mut port = extract_debugging_port(&browser_args);

    // Try DevToolsActivePort file
    if port.is_none() {
        if let Some(user_data_dir) = extract_user_data_dir(&browser_args) {
            port = read_devtools_active_port(&user_data_dir);
        }
    }

    let port = match port {
        Some(p) => p,
        None => return,
    };

    let targets = fetch_cdp_targets(port);

    for target in &targets {
        let url = match &target.url {
            Some(u) if !u.is_empty() && u != "about:blank" && !u.starts_with("devtools://") => u,
            _ => continue,
        };

        // Only map page/iframe targets
        let is_page = target
            .target_type
            .as_deref()
            .map_or(true, |t| t == "page" || t == "iframe" || t == "other");
        if !is_page {
            continue;
        }

        let title = target.title.as_deref().unwrap_or("");
        let display = if !title.is_empty() && title != url.as_str() {
            format!("{} \u{2014} {}", title, url)
        } else {
            url.clone()
        };

        // Map by process ID if available from CDP
        if let Some(target_pid) = target.process_id {
            if let Some(proc) = processes
                .iter_mut()
                .find(|p| p.pid == target_pid && p.url.is_empty())
            {
                proc.url = display;
            }
        }
    }
}
