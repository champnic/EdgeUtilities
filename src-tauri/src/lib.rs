mod commands;

use commands::installs::*;
use commands::launcher::*;
use commands::processes::*;
use commands::repos::*;
use commands::scripts::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // Installs
            get_edge_installs,
            find_mini_installers,
            uninstall_edge,
            install_edge,
            open_folder,
            open_url,
            // Processes
            get_edge_processes,
            terminate_process,
            debug_process,
            // Launcher
            launch_edge,
            get_common_flags,
            load_presets,
            save_presets,
            create_temp_user_data_dir,
            get_repo_builds,
            // Repos
            get_repo_branch,
            get_repo_info,
            get_common_build_targets,
            open_edge_dev_env,
            run_gclient_sync,
            create_out_dir,
            start_build,
            delete_out_dir,
            read_args_gn,
            load_repo_list,
            save_repo_list,
            // Scripts
            run_script,
            load_scripts,
            save_scripts,
            sync_scheduled_task,
            delete_scheduled_task,
            get_task_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
