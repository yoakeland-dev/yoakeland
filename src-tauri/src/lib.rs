mod backend;

use backend::BackendState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            backend::probe_tcp,
            backend::probe_unix,
            backend::default_socket_path,
            backend::spawn_detached_server,
            backend::spawn_detached_unix_server,
            backend::connect_tcp,
            backend::connect_unix,
            backend::send_envelope,
            backend::disconnect,
            backend::read_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
