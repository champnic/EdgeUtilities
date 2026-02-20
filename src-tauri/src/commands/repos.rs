use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::os::windows::process::CommandExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoInfo {
    pub path: String,
    pub current_branch: String,
    pub out_dirs: Vec<OutDir>,
    pub recent_commits: Vec<CommitInfo>,
    /// Index of the merge-base commit with main (None if on main or not found)
    pub merge_base_index: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OutDir {
    pub name: String,
    pub path: String,
    pub has_args_gn: bool,
    pub has_msedge: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

/// Detect the current git state: branch name, detached HEAD, rebase/merge in progress, etc.
fn detect_git_state(repo_path: &Path) -> String {
    let branch = run_git(repo_path, &["branch", "--show-current"])
        .unwrap_or_default()
        .trim()
        .to_string();

    if !branch.is_empty() {
        // Check for in-progress operations even when on a branch (e.g., merge conflicts)
        let git_dir = resolve_git_dir(repo_path);
        if git_dir.join("MERGE_HEAD").exists() {
            return format!("{} (merge in progress)", branch);
        }
        return branch;
    }

    // HEAD is detached — figure out why
    let git_dir = resolve_git_dir(repo_path);

    // Interactive rebase
    if git_dir.join("rebase-merge").exists() {
        let head_name = std::fs::read_to_string(git_dir.join("rebase-merge").join("head-name"))
            .unwrap_or_default()
            .trim()
            .replace("refs/heads/", "");
        let step = std::fs::read_to_string(git_dir.join("rebase-merge").join("msgnum"))
            .unwrap_or_default()
            .trim()
            .to_string();
        let total = std::fs::read_to_string(git_dir.join("rebase-merge").join("end"))
            .unwrap_or_default()
            .trim()
            .to_string();
        if !head_name.is_empty() && !step.is_empty() {
            return format!("{} (rebase {}/{})", head_name, step, total);
        }
        return format!("{}(rebasing)", if head_name.is_empty() { "HEAD ".to_string() } else { format!("{} ", head_name) });
    }

    // Non-interactive rebase (git rebase without -i)
    if git_dir.join("rebase-apply").exists() {
        let head_name = std::fs::read_to_string(git_dir.join("rebase-apply").join("head-name"))
            .unwrap_or_default()
            .trim()
            .replace("refs/heads/", "");
        let label = if head_name.is_empty() { "HEAD".to_string() } else { head_name };
        return format!("{} (rebase-apply)", label);
    }

    // Merge in progress
    if git_dir.join("MERGE_HEAD").exists() {
        return "HEAD (merge in progress)".to_string();
    }

    // Cherry-pick in progress
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return "HEAD (cherry-pick)".to_string();
    }

    // Revert in progress
    if git_dir.join("REVERT_HEAD").exists() {
        return "HEAD (revert)".to_string();
    }

    // Bisect in progress
    if git_dir.join("BISECT_LOG").exists() {
        return "HEAD (bisecting)".to_string();
    }

    // Plain detached HEAD — show the short SHA
    let short_sha = run_git(repo_path, &["rev-parse", "--short", "HEAD"])
        .unwrap_or_else(|_| "unknown".to_string())
        .trim()
        .to_string();

    format!("HEAD detached at {}", short_sha)
}

/// Resolve the actual .git directory (handles worktrees where .git is a file pointing elsewhere)
fn resolve_git_dir(repo_path: &Path) -> PathBuf {
    let dot_git = repo_path.join(".git");
    if dot_git.is_file() {
        // Worktree: .git is a file containing "gitdir: <path>"
        if let Ok(content) = std::fs::read_to_string(&dot_git) {
            if let Some(gitdir) = content.trim().strip_prefix("gitdir: ") {
                let gitdir_path = PathBuf::from(gitdir);
                if gitdir_path.is_absolute() {
                    return gitdir_path;
                }
                return repo_path.join(gitdir_path);
            }
        }
    }
    dot_git
}

/// Lightweight: fetch only the current branch name for a repo
#[tauri::command]
pub fn get_repo_branch(repo_path: String) -> Result<String, String> {
    let path = PathBuf::from(&repo_path);

    if !path.join(".git").exists() && !path.join("BUILD.gn").exists() {
        return Err(format!("{} is not a valid repo", repo_path));
    }

    Ok(detect_git_state(&path))
}

/// Full repo info: branch, out dirs, recent commits (call on expand)
#[tauri::command]
pub fn get_repo_info(repo_path: String) -> Result<RepoInfo, String> {
    let path = PathBuf::from(&repo_path);

    if !path.join(".git").exists() && !path.join("BUILD.gn").exists() {
        return Err(format!("{} is not a valid repo", repo_path));
    }

    let current_branch = detect_git_state(&path);

    let out_dirs = find_out_dirs(&path);
    let recent_commits = get_recent_commits(&path, 15);

    // Find where main branch diverges
    let merge_base_index = if current_branch == "main" {
        None
    } else {
        find_merge_base_index(&path, &recent_commits)
    };

    Ok(RepoInfo {
        path: repo_path,
        current_branch,
        out_dirs,
        recent_commits,
        merge_base_index,
    })
}

/// List available build targets for a given out dir
#[tauri::command]
pub fn get_common_build_targets() -> Vec<String> {
    vec![
        "chrome".to_string(),
        "content_shell".to_string(),
        "unit_tests".to_string(),
        "browser_tests".to_string(),
        "blink_tests".to_string(),
        "content_unittests".to_string(),
        "media_unittests".to_string(),
        "webrtc_internals_test_utils".to_string(),
        "base_unittests".to_string(),
        "net_unittests".to_string(),
        "components_unittests".to_string(),
        "mini_installer".to_string(),
    ]
}

/// Create a new out directory using autogn
#[tauri::command]
pub fn create_out_dir(repo_path: String, config_name: String, out_path: String) -> Result<String, String> {
    let src_path = PathBuf::from(&repo_path);

    let depot_tools = find_depot_tools(&src_path)
        .ok_or("Could not find depot_tools")?;

    let autogn_script = depot_tools.join("scripts").join("autogn.py");

    if !autogn_script.exists() {
        return Err(format!("autogn.py not found at {}", autogn_script.display()));
    }

    let vpython = depot_tools.join("vpython3.bat");
    let vpython_path = if vpython.exists() {
        vpython.to_string_lossy().to_string()
    } else {
        "vpython3".to_string()
    };

    let output = Command::new(&vpython_path)
        .args([
            autogn_script.to_string_lossy().as_ref(),
            &config_name,
            "-o",
            &out_path,
        ])
        .current_dir(&src_path)
        .env("PATH", prepend_to_path(&depot_tools))
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("Failed to run autogn: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("Out dir created:\n{}\n{}", stdout, stderr))
    } else {
        Err(format!("autogn failed:\n{}\n{}", stdout, stderr))
    }
}

/// Start a build using autoninja (initializes Edge dev env first)
#[tauri::command]
pub async fn start_build(
    repo_path: String,
    out_dir: String,
    target: String,
) -> Result<String, String> {
    let src_path = PathBuf::from(&repo_path);
    let depot_tools = find_depot_tools(&src_path)
        .ok_or("Could not find depot_tools")?;

    let autoninja = depot_tools.join("autoninja.bat");
    let autoninja_path = if autoninja.exists() {
        autoninja.to_string_lossy().to_string()
    } else {
        "autoninja".to_string()
    };

    // Build the init script command to set up the Edge dev environment first
    let init_script = depot_tools.join("scripts").join("setup").join("initEdgeEnv.cmd");
    let edge_root = depot_tools.parent()
        .ok_or("Could not determine Edge root directory")?;
    let src_folder = src_path.file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "src".to_string());

    let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());

    // If initEdgeEnv.cmd exists, run it first to set up build tools, then autoninja
    if init_script.exists() {
        let mut init_cmd = format!(
            "call \"{}\" \"{}\"",
            init_script.to_string_lossy(),
            edge_root.to_string_lossy()
        );
        if src_folder != "src" {
            init_cmd.push_str(&format!(" --SrcFolder {}", src_folder));
        }

        let full_cmd = format!(
            "{} && call \"{}\" -C \"{}\" {}",
            init_cmd, autoninja_path, out_dir, target
        );

        let output = tokio::process::Command::new(&comspec)
            .args(["/c", &full_cmd])
            .current_dir(&src_path)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .await
            .map_err(|e| format!("Failed to start build: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(format!("Build succeeded:\n{}", stdout))
        } else {
            Err(format!("Build failed:\n{}\n{}", stdout, stderr))
        }
    } else {
        // Fallback: run autoninja directly without init script
        let output = tokio::process::Command::new(&autoninja_path)
            .args(["-C", &out_dir, &target])
            .current_dir(&src_path)
            .env("PATH", prepend_to_path(&depot_tools))
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .await
            .map_err(|e| format!("Failed to start build: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(format!("Build succeeded:\n{}", stdout))
        } else {
            Err(format!("Build failed:\n{}\n{}", stdout, stderr))
        }
    }
}

/// Delete an out directory
#[tauri::command]
pub fn delete_out_dir(out_dir_path: String) -> Result<String, String> {
    let path = PathBuf::from(&out_dir_path);
    if !path.exists() {
        return Err("Directory not found".to_string());
    }
    std::fs::remove_dir_all(&path)
        .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
    Ok(format!("Deleted {}", path.display()))
}

/// Read args.gn for a given out directory
#[tauri::command]
pub fn read_args_gn(out_dir_path: String) -> Result<String, String> {
    let args_path = PathBuf::from(&out_dir_path).join("args.gn");
    if !args_path.exists() {
        return Err("args.gn not found".to_string());
    }
    std::fs::read_to_string(&args_path).map_err(|e| e.to_string())
}

/// Check if a directory looks like an Edge Chromium repo.
fn is_edge_repo(path: &Path) -> bool {
    let has_build_gn = path.join("BUILD.gn").exists();
    let has_edge_dir = path.join("edge").exists();
    let has_gclient = path
        .parent()
        .map(|p| p.join(".gclient").exists())
        .unwrap_or(false);
    has_build_gn && (has_edge_dir || has_gclient)
}

/// Auto-detect Edge Chromium repos by scanning drive roots for edge*/src* patterns.
#[tauri::command]
pub fn detect_repos() -> Vec<String> {
    let mut found = Vec::new();
    for drive in b'C'..=b'Z' {
        let root = PathBuf::from(format!("{}:\\", drive as char));
        if !root.exists() {
            continue;
        }
        let entries = match std::fs::read_dir(&root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if !name.starts_with("edge") || !entry.path().is_dir() {
                continue;
            }
            let sub_entries = match std::fs::read_dir(entry.path()) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for sub in sub_entries.flatten() {
                let sub_name = sub.file_name().to_string_lossy().to_lowercase();
                if sub_name.starts_with("src") && sub.path().is_dir() && is_edge_repo(&sub.path())
                {
                    found.push(sub.path().to_string_lossy().to_string());
                }
            }
        }
    }
    found.sort();
    found.dedup();
    found
}

/// Load saved repo list from disk
#[tauri::command]
pub fn load_repo_list(config_dir: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&config_dir).join("repo_list.json");
    if !path.exists() {
        // Auto-detect repos on disk when no config exists yet
        let detected = detect_repos();
        if !detected.is_empty() {
            return Ok(detected);
        }
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Save repo list to disk
#[tauri::command]
pub fn save_repo_list(config_dir: String, repos: Vec<String>) -> Result<(), String> {
    let dir = PathBuf::from(&config_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("repo_list.json");
    let content = serde_json::to_string_pretty(&repos).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Open Edge dev environment terminal (runs initEdgeEnv.cmd)
#[tauri::command]
pub fn open_edge_dev_env(repo_path: String) -> Result<(), String> {
    let src_path = PathBuf::from(&repo_path);
    let depot_tools = find_depot_tools(&src_path)
        .ok_or("Could not find depot_tools")?;

    let init_script = depot_tools.join("scripts").join("setup").join("initEdgeEnv.cmd");
    if !init_script.exists() {
        return Err(format!("initEdgeEnv.cmd not found at {}", init_script.display()));
    }

    // Derive Edge root: parent of depot_tools
    let edge_root = depot_tools.parent()
        .ok_or("Could not determine Edge root directory")?;

    let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());

    // Determine the src folder name from repo_path (e.g., "src3" from "d:\edge\src3")
    let src_folder = src_path.file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "src".to_string());

    let mut args = vec![
        "/k".to_string(),
        init_script.to_string_lossy().to_string(),
        edge_root.to_string_lossy().to_string(),
    ];

    if src_folder != "src" {
        args.push("--SrcFolder".to_string());
        args.push(src_folder);
    }

    Command::new(&comspec)
        .args(&args)
        .current_dir(&src_path)
        .creation_flags(0x00000010) // CREATE_NEW_CONSOLE
        .spawn()
        .map_err(|e| format!("Failed to open dev environment: {}", e))?;

    Ok(())
}

/// Run gclient sync -f -D in a new console window
#[tauri::command]
pub fn run_gclient_sync(repo_path: String) -> Result<(), String> {
    let src_path = PathBuf::from(&repo_path);
    let depot_tools = find_depot_tools(&src_path)
        .ok_or("Could not find depot_tools")?;

    let gclient = depot_tools.join("gclient.bat");
    let gclient_path = if gclient.exists() {
        gclient.to_string_lossy().to_string()
    } else {
        "gclient".to_string()
    };

    let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());

    Command::new(&comspec)
        .args([
            "/k",
            &gclient_path,
            "sync",
            "-f",
            "-D",
        ])
        .current_dir(&src_path)
        .env("PATH", prepend_to_path(&depot_tools))
        .creation_flags(0x00000010) // CREATE_NEW_CONSOLE
        .spawn()
        .map_err(|e| format!("Failed to run gclient sync: {}", e))?;

    Ok(())
}

fn prepend_to_path(dir: &Path) -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    format!("{};{}", dir.to_string_lossy(), current)
}

fn run_git(dir: &Path, args: &[&str]) -> Result<String, String> {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn find_out_dirs(repo_path: &Path) -> Vec<OutDir> {
    let mut dirs = Vec::new();

    let out_root = repo_path.join("out");
    if out_root.exists() {
        if let Ok(entries) = std::fs::read_dir(&out_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let has_args = path.join("args.gn").exists();
                    let has_msedge = path.join("msedge.exe").exists();
                    dirs.push(OutDir {
                        name: entry.file_name().to_string_lossy().to_string(),
                        path: path.to_string_lossy().to_string(),
                        has_args_gn: has_args,
                        has_msedge,
                    });
                }
            }
        }
    }

    dirs
}

fn get_recent_commits(repo_path: &Path, count: usize) -> Vec<CommitInfo> {
    let format = "--format=%H|%h|%s|%an|%ad";
    let date_format = "--date=short";
    let count_arg = format!("-{}", count);

    let output = run_git(repo_path, &["log", &count_arg, format, date_format]);

    match output {
        Ok(text) => text
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(5, '|').collect();
                if parts.len() == 5 {
                    Some(CommitInfo {
                        hash: parts[0].to_string(),
                        short_hash: parts[1].to_string(),
                        subject: parts[2].to_string(),
                        author: parts[3].to_string(),
                        date: parts[4].to_string(),
                    })
                } else {
                    None
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// Find the index of the merge-base commit with main/master in the recent commits list.
fn find_merge_base_index(repo_path: &Path, commits: &[CommitInfo]) -> Option<usize> {
    // Try local main, origin/main, local master, origin/master
    let merge_base_hash = run_git(repo_path, &["merge-base", "HEAD", "main"])
        .or_else(|_| run_git(repo_path, &["merge-base", "HEAD", "origin/main"]))
        .or_else(|_| run_git(repo_path, &["merge-base", "HEAD", "master"]))
        .or_else(|_| run_git(repo_path, &["merge-base", "HEAD", "origin/master"]))
        .ok()?
        .trim()
        .to_string();

    commits.iter().position(|c| c.hash == merge_base_hash)
}

fn find_depot_tools(src_path: &Path) -> Option<PathBuf> {
    let mut current = src_path.to_path_buf();
    loop {
        let dt = current.join("depot_tools");
        if dt.exists() {
            return Some(dt);
        }
        if !current.pop() {
            break;
        }
    }

    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(';') {
            let dt = PathBuf::from(dir);
            if dt.join("autoninja.bat").exists() || dt.join("autoninja").exists() {
                return Some(dt);
            }
        }
    }

    None
}
