// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The AppImage's GTK hook hard-codes GDK_BACKEND=x11, which puts us on
    // XWayland: no titlebar dragging, blurry output, resize banding. Undo it
    // on a Wayland session. YOAKE_X11=1 opts back out if the bundled libs
    // crash on some distro (tauri-apps/tauri#8541).
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_some()
        && std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::env::var_os("YOAKE_X11").is_none()
    {
        std::env::set_var("GDK_BACKEND", "wayland");
    }
    yoake_gui_lib::run()
}
