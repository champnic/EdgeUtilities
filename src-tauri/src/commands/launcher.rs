use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LaunchPreset {
    pub name: String,
    pub flags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoBuild {
    pub repo_path: String,
    pub out_dir: String,
    pub exe_path: String,
    pub last_modified: String,
}

/// Launch Edge with specified flags
#[tauri::command]
pub fn launch_edge(exe_path: String, flags: Vec<String>) -> Result<String, String> {
    let mut cmd = Command::new(&exe_path);
    for flag in &flags {
        cmd.arg(flag);
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to launch Edge: {}", e))?;

    Ok(format!("Launched {} with {} flags", exe_path, flags.len()))
}

/// Get a list of commonly used Edge flags
#[tauri::command]
pub fn get_common_flags() -> Vec<LaunchPreset> {
    vec![
        LaunchPreset {
            name: "No First Run".to_string(),
            flags: vec!["--no-first-run".to_string()],
        },
        LaunchPreset {
            name: "No Browser Check".to_string(),
            flags: vec!["--no-default-browser-check".to_string()],
        },
        LaunchPreset {
            name: "No Default Apps".to_string(),
            flags: vec!["--disable-default-apps".to_string()],
        },
        LaunchPreset {
            name: "No Sync".to_string(),
            flags: vec!["--disable-sync".to_string()],
        },
        LaunchPreset {
            name: "Disable GPU".to_string(),
            flags: vec!["--disable-gpu".to_string()],
        },
        LaunchPreset {
            name: "Remote Debugging".to_string(),
            flags: vec!["--remote-debugging-port=9222".to_string()],
        },
        LaunchPreset {
            name: "Incognito".to_string(),
            flags: vec!["--inprivate".to_string()],
        },
        LaunchPreset {
            name: "Disable Extensions".to_string(),
            flags: vec!["--disable-extensions".to_string()],
        },
        LaunchPreset {
            name: "Verbose Logging".to_string(),
            flags: vec![
                "--enable-logging".to_string(),
                "--v=1".to_string(),
            ],
        },
        LaunchPreset {
            name: "WebRTC Logging".to_string(),
            flags: vec![
                "--enable-logging".to_string(),
                "--vmodule=*/webrtc/*=1".to_string(),
            ],
        },
    ]
}

/// Create a randomized temp user data directory and return its path
#[tauri::command]
pub fn create_temp_user_data_dir() -> Result<String, String> {
    let random_suffix: u32 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_millis() % 100000) as u32)
        .unwrap_or(0);

    let temp_dir = PathBuf::from("C:\\temp").join(format!("edge_profile_{}", random_suffix));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    Ok(temp_dir.to_string_lossy().to_string())
}

/// Scan repo out directories for msedge.exe builds
#[tauri::command]
pub fn get_repo_builds(repo_paths: Vec<String>) -> Result<Vec<RepoBuild>, String> {
    let mut builds = Vec::new();

    for repo_path in &repo_paths {
        let out_root = PathBuf::from(repo_path).join("out");
        if !out_root.exists() {
            continue;
        }

        if let Ok(entries) = std::fs::read_dir(&out_root) {
            for entry in entries.flatten() {
                let dir_path = entry.path();
                if !dir_path.is_dir() {
                    continue;
                }

                let exe = dir_path.join("msedge.exe");
                if exe.exists() {
                    let last_modified = std::fs::metadata(&exe)
                        .and_then(|m| m.modified())
                        .map(|t| {
                            let datetime: chrono::DateTime<chrono::Local> = t.into();
                            datetime.format("%Y-%m-%d %H:%M").to_string()
                        })
                        .unwrap_or_else(|_| "Unknown".to_string());

                    builds.push(RepoBuild {
                        repo_path: repo_path.clone(),
                        out_dir: entry.file_name().to_string_lossy().to_string(),
                        exe_path: exe.to_string_lossy().to_string(),
                        last_modified,
                    });
                }
            }
        }
    }

    Ok(builds)
}

/// Load saved presets from disk
#[tauri::command]
pub fn load_presets(config_dir: String) -> Result<Vec<LaunchPreset>, String> {
    let path = std::path::PathBuf::from(&config_dir).join("launch_presets.json");
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Save presets to disk
#[tauri::command]
pub fn save_presets(config_dir: String, presets: Vec<LaunchPreset>) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&config_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = dir.join("launch_presets.json");
    let content = serde_json::to_string_pretty(&presets).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}
