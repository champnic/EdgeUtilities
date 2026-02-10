use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScriptDef {
    pub id: String,
    pub name: String,
    pub description: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_dir: Option<String>,
    pub schedule: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScriptResult {
    pub id: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

/// Run a script/command
#[tauri::command]
pub async fn run_script(script: ScriptDef) -> Result<ScriptResult, String> {
    let start = std::time::Instant::now();

    let working_dir = script
        .working_dir
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let output = tokio::process::Command::new(&script.command)
        .args(&script.args)
        .current_dir(&working_dir)
        .output()
        .await
        .map_err(|e| format!("Failed to run script: {}", e))?;

    let duration = start.elapsed();

    Ok(ScriptResult {
        id: script.id,
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms: duration.as_millis() as u64,
    })
}

/// Load saved scripts from config
#[tauri::command]
pub fn load_scripts(config_dir: String) -> Result<Vec<ScriptDef>, String> {
    let path = PathBuf::from(&config_dir).join("scripts.json");
    if !path.exists() {
        return Ok(default_scripts());
    }

    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Save scripts to config
#[tauri::command]
pub fn save_scripts(config_dir: String, scripts: Vec<ScriptDef>) -> Result<(), String> {
    let dir = PathBuf::from(&config_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = dir.join("scripts.json");
    let content = serde_json::to_string_pretty(&scripts).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

fn default_scripts() -> Vec<ScriptDef> {
    vec![
        ScriptDef {
            id: "1".to_string(),
            name: "Git Status".to_string(),
            description: "Show current git status".to_string(),
            command: "git".to_string(),
            args: vec!["status".to_string()],
            working_dir: None,
            schedule: None,
        },
        ScriptDef {
            id: "2".to_string(),
            name: "Git Fetch Origin Main".to_string(),
            description: "Fetch latest from origin main branch".to_string(),
            command: "git".to_string(),
            args: vec!["fetch".to_string(), "origin".to_string(), "main".to_string()],
            working_dir: None,
            schedule: None,
        },
        ScriptDef {
            id: "3".to_string(),
            name: "Check Disk Space".to_string(),
            description: "Show free disk space".to_string(),
            #[cfg(target_os = "windows")]
            command: "cmd".to_string(),
            #[cfg(target_os = "windows")]
            args: vec!["/C".to_string(), "wmic".to_string(), "logicaldisk".to_string(), "get".to_string(), "size,freespace,caption".to_string()],
            #[cfg(not(target_os = "windows"))]
            command: "df".to_string(),
            #[cfg(not(target_os = "windows"))]
            args: vec!["-h".to_string()],
            working_dir: None,
            schedule: None,
        },
    ]
}
