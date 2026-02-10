use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScheduleConfig {
    pub enabled: bool,
    pub cadence: String,           // "hourly", "daily", or "weekly"
    pub time: String,              // "09:00" (HH:MM)
    pub days_of_week: Vec<String>, // ["MON", "TUE", ...] for weekly
    pub interval: u32,             // every N hours/days/weeks
    pub start_date: Option<String>, // "2026-02-09" or null (defaults to today)
    pub end_date: Option<String>,  // "2026-12-31" or null
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScriptDef {
    pub id: String,
    pub name: String,
    pub description: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_dir: Option<String>,
    pub schedule: Option<ScheduleConfig>,
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

// ── Windows Task Scheduler integration via schtasks.exe ──

fn task_name_for_script(script_id: &str) -> String {
    format!("EdgeUtilities\\Script_{}", script_id)
}

fn convert_date_to_schtasks(iso_date: &str) -> String {
    // Convert YYYY-MM-DD to MM/DD/YYYY for schtasks
    let parts: Vec<&str> = iso_date.split('-').collect();
    if parts.len() == 3 {
        format!("{}/{}/{}", parts[1], parts[2], parts[0])
    } else {
        iso_date.to_string()
    }
}

/// Create or update a Windows scheduled task for a script
#[tauri::command]
pub fn sync_scheduled_task(script: ScriptDef) -> Result<String, String> {
    let task_name = task_name_for_script(&script.id);

    let schedule = match &script.schedule {
        Some(s) => s,
        None => {
            // No schedule configured - remove any existing task
            let _ = delete_task_internal(&task_name);
            return Ok("No schedule configured".to_string());
        }
    };

    if !schedule.enabled {
        // Try to disable existing task, or just remove it
        let _ = std::process::Command::new("schtasks")
            .args(["/Change", "/TN", &task_name, "/DISABLE"])
            .output();
        return Ok(format!("Schedule disabled for '{}'", script.name));
    }

    // Build the command string for the task
    let command_str = if script.args.is_empty() {
        script.command.clone()
    } else {
        format!("{} {}", script.command, script.args.join(" "))
    };

    let tr = if let Some(ref wd) = script.working_dir {
        if wd.is_empty() {
            format!("cmd.exe /C {}", command_str)
        } else {
            format!("cmd.exe /C cd /d \"{}\" & {}", wd, command_str)
        }
    } else {
        format!("cmd.exe /C {}", command_str)
    };

    let mut args: Vec<String> = vec![
        "/Create".to_string(),
        "/TN".to_string(),
        task_name.clone(),
        "/TR".to_string(),
        tr,
        "/F".to_string(), // Force overwrite existing
    ];

    match schedule.cadence.as_str() {
        "hourly" => {
            args.extend_from_slice(&[
                "/SC".to_string(),
                "HOURLY".to_string(),
                "/MO".to_string(),
                schedule.interval.max(1).to_string(),
            ]);
        }
        "daily" => {
            args.extend_from_slice(&[
                "/SC".to_string(),
                "DAILY".to_string(),
                "/MO".to_string(),
                schedule.interval.max(1).to_string(),
            ]);
        }
        "weekly" => {
            args.extend_from_slice(&[
                "/SC".to_string(),
                "WEEKLY".to_string(),
            ]);
            if !schedule.days_of_week.is_empty() {
                args.push("/D".to_string());
                args.push(schedule.days_of_week.join(","));
            }
            args.extend_from_slice(&[
                "/MO".to_string(),
                schedule.interval.max(1).to_string(),
            ]);
        }
        _ => {
            return Err(format!("Unknown cadence: {}", schedule.cadence));
        }
    }

    args.extend_from_slice(&["/ST".to_string(), schedule.time.clone()]);

    if let Some(ref start_date) = schedule.start_date {
        if !start_date.is_empty() {
            args.extend_from_slice(&[
                "/SD".to_string(),
                convert_date_to_schtasks(start_date),
            ]);
        }
    }

    if let Some(ref end_date) = schedule.end_date {
        if !end_date.is_empty() {
            args.extend_from_slice(&[
                "/ED".to_string(),
                convert_date_to_schtasks(end_date),
            ]);
        }
    }

    let output = std::process::Command::new("schtasks")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to create scheduled task: {}", e))?;

    if output.status.success() {
        Ok(format!("Scheduled task '{}' synced successfully", script.name))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to create scheduled task: {}", stderr.trim()))
    }
}

/// Delete a Windows scheduled task for a script
#[tauri::command]
pub fn delete_scheduled_task(script_id: String) -> Result<String, String> {
    let task_name = task_name_for_script(&script_id);
    delete_task_internal(&task_name)
}

fn delete_task_internal(task_name: &str) -> Result<String, String> {
    let output = std::process::Command::new("schtasks")
        .args(["/Delete", "/TN", task_name, "/F"])
        .output()
        .map_err(|e| format!("Failed to delete scheduled task: {}", e))?;

    if output.status.success() {
        Ok("Scheduled task deleted".to_string())
    } else {
        // Task might not exist, which is fine
        Ok("Task removed (may not have existed)".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskStatus {
    pub exists: bool,
    pub status: String,
    pub next_run: String,
    pub last_run: String,
    pub last_result: String,
}

/// Query the status of a Windows scheduled task
#[tauri::command]
pub fn get_task_status(script_id: String) -> Result<TaskStatus, String> {
    let task_name = task_name_for_script(&script_id);

    let output = std::process::Command::new("schtasks")
        .args(["/Query", "/TN", &task_name, "/FO", "LIST", "/V"])
        .output()
        .map_err(|e| format!("Failed to query task: {}", e))?;

    if !output.status.success() {
        return Ok(TaskStatus {
            exists: false,
            status: "Not scheduled".to_string(),
            next_run: String::new(),
            last_run: String::new(),
            last_result: String::new(),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    let extract = |key: &str| -> String {
        for line in stdout.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix(key) {
                return rest.trim().to_string();
            }
        }
        String::new()
    };

    Ok(TaskStatus {
        exists: true,
        status: extract("Status:"),
        next_run: extract("Next Run Time:"),
        last_run: extract("Last Run Time:"),
        last_result: extract("Last Result:"),
    })
}
