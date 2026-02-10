use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EdgeInstall {
    pub channel: String,
    pub version: String,
    pub install_path: String,
    pub exe_path: String,
    pub is_system: bool,
    pub installed: bool,
    pub download_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MiniInstaller {
    pub filename: String,
    pub path: String,
    pub size_mb: f64,
    pub modified: String,
}

/// Detect installed Edge browsers from the Windows registry.
/// Also returns rows for channels that are NOT installed with download links.
#[tauri::command]
pub fn get_edge_installs() -> Result<Vec<EdgeInstall>, String> {
    let mut installs = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let channels = vec![
            ("Stable", "Microsoft\\Edge", "https://www.microsoft.com/en-us/edge"),
            ("Beta", "Microsoft\\Edge Beta", "https://www.microsoft.com/en-us/edge/download/insider"),
            ("Dev", "Microsoft\\Edge Dev", "https://www.microsoft.com/en-us/edge/download/insider"),
            ("Canary", "Microsoft\\Edge SxS", "https://www.microsoft.com/en-us/edge/download/insider"),
        ];

        let roots = vec![
            (HKEY_LOCAL_MACHINE, true),
            (HKEY_CURRENT_USER, false),
        ];

        let mut found_channels = std::collections::HashSet::new();

        for (root_key, _is_system_root) in &roots {
            for (channel, reg_path, download_url) in &channels {
                if found_channels.contains(*channel) {
                    continue;
                }

                let full_path = format!("SOFTWARE\\{}\\BLBeacon", reg_path);
                if let Ok(hklm) = RegKey::predef(*root_key).open_subkey(&full_path) {
                    let beacon_version: String = hklm.get_value("version").unwrap_or_default();
                    if !beacon_version.is_empty() {
                        let exe_path = find_edge_exe(reg_path, *root_key);

                        // Get accurate version from versioned subfolder
                        let version = get_accurate_version(&exe_path, &beacon_version);

                        let install_dir = exe_path
                            .as_ref()
                            .map(|p| {
                                PathBuf::from(p)
                                    .parent()
                                    .unwrap_or(&PathBuf::new())
                                    .to_string_lossy()
                                    .to_string()
                            })
                            .unwrap_or_default();

                        // Determine is_system from actual exe path, not registry root
                        let is_system = exe_path.as_ref().map(|p| {
                            let lower = p.to_lowercase();
                            lower.contains("program files") || lower.contains("program files (x86)")
                        }).unwrap_or(false);

                        found_channels.insert(channel.to_string());
                        installs.push(EdgeInstall {
                            channel: channel.to_string(),
                            version,
                            install_path: install_dir,
                            exe_path: exe_path.unwrap_or_default(),
                            is_system,
                            installed: true,
                            download_url: download_url.to_string(),
                        });
                    }
                }
            }
        }

        // Add rows for channels not found
        for (channel, _reg_path, download_url) in &channels {
            if !found_channels.contains(*channel) {
                installs.push(EdgeInstall {
                    channel: channel.to_string(),
                    version: String::new(),
                    install_path: String::new(),
                    exe_path: String::new(),
                    is_system: false,
                    installed: false,
                    download_url: download_url.to_string(),
                });
            }
        }
    }

    Ok(installs)
}

/// Get accurate version from the versioned subfolder under Application/
#[cfg(target_os = "windows")]
fn get_accurate_version(exe_path: &Option<String>, beacon_version: &str) -> String {
    if let Some(exe) = exe_path {
        if let Some(app_dir) = PathBuf::from(exe).parent() {
            if let Ok(entries) = std::fs::read_dir(app_dir) {
                let mut best_version: Option<String> = None;
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if entry.path().is_dir()
                        && name.chars().next().map_or(false, |c| c.is_ascii_digit())
                        && name.contains('.')
                    {
                        if best_version.as_ref().map_or(true, |v| name > *v) {
                            best_version = Some(name);
                        }
                    }
                }
                if let Some(v) = best_version {
                    return v;
                }
            }
        }
    }
    beacon_version.to_string()
}

#[cfg(target_os = "windows")]
fn find_edge_exe(reg_path: &str, root: winreg::HKEY) -> Option<String> {
    use winreg::RegKey;

    let clients_path = format!("SOFTWARE\\{}\\", reg_path);
    if let Ok(key) = RegKey::predef(root).open_subkey(&clients_path) {
        if let Ok(exe_path) = key.get_value::<String, _>("ExecutablePath") {
            if PathBuf::from(&exe_path).exists() {
                return Some(exe_path);
            }
        }
    }

    let program_files = std::env::var("ProgramFiles(x86)")
        .unwrap_or_else(|_| std::env::var("ProgramFiles").unwrap_or_default());
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();

    let channel_folder = reg_path.replace("Microsoft\\", "");
    let candidates = vec![
        format!("{}\\Microsoft\\{}\\Application\\msedge.exe", program_files, channel_folder),
        format!("{}\\Microsoft\\{}\\Application\\msedge.exe", local_app_data, channel_folder),
    ];

    for candidate in candidates {
        if PathBuf::from(&candidate).exists() {
            return Some(candidate);
        }
    }
    None
}

/// Open a folder in Windows Explorer
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}

/// Open a URL in the default browser
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok(())
}

/// Search for mini_installer files in the Downloads folder
#[tauri::command]
pub fn find_mini_installers(search_path: Option<String>) -> Result<Vec<MiniInstaller>, String> {
    let search_dir = if let Some(p) = search_path {
        PathBuf::from(p)
    } else {
        dirs_fallback_downloads()
    };

    let mut installers = Vec::new();

    if !search_dir.exists() {
        return Ok(installers);
    }

    if let Ok(entries) = std::fs::read_dir(&search_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            if name.to_lowercase().contains("mini_installer") && name.ends_with(".exe") {
                let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
                let size_mb = metadata.len() as f64 / (1024.0 * 1024.0);
                let modified = metadata
                    .modified()
                    .map(|t| {
                        let datetime: chrono::DateTime<chrono::Local> = t.into();
                        datetime.format("%Y-%m-%d %H:%M:%S").to_string()
                    })
                    .unwrap_or_else(|_| "Unknown".to_string());

                installers.push(MiniInstaller {
                    filename: name,
                    path: path.to_string_lossy().to_string(),
                    size_mb: (size_mb * 100.0).round() / 100.0,
                    modified,
                });
            }
        }
    }

    Ok(installers)
}

/// Uninstall an Edge channel using the system uninstaller
#[tauri::command]
pub fn uninstall_edge(exe_path: String) -> Result<String, String> {
    let setup_exe = PathBuf::from(&exe_path)
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("Installer").join("setup.exe"))
        .ok_or("Could not find setup.exe")?;

    if !setup_exe.exists() {
        return Err(format!("Setup.exe not found at: {}", setup_exe.display()));
    }

    Command::new(&setup_exe)
        .args(["--uninstall", "--force-uninstall"])
        .spawn()
        .map_err(|e| format!("Failed to start uninstaller: {}", e))?;

    Ok("Uninstall started".to_string())
}

/// Install Edge using a mini_installer with a channel flag
#[tauri::command]
pub fn install_edge(installer_path: String, channel: String) -> Result<String, String> {
    let channel_flag = match channel.to_lowercase().as_str() {
        "beta" => "--msedge-beta",
        "dev" => "--msedge-dev",
        "canary" => "--msedge-sxs",
        _ => "--msedge",
    };

    Command::new(&installer_path)
        .arg(channel_flag)
        .spawn()
        .map_err(|e| format!("Failed to start installer: {}", e))?;

    Ok(format!("Installation started with {} flag", channel_flag))
}

fn dirs_fallback_downloads() -> PathBuf {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        PathBuf::from(profile).join("Downloads")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join("Downloads")
    } else {
        PathBuf::from(".")
    }
}
