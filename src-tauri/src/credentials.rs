//! Remembered remote-server tokens, so every known server can reconnect on
//! startup without re-pairing. One JSON map (serverId -> token) in the app's
//! config dir, owner-read/write only — the same trust level as an SSH key or
//! `gh`'s hosts.yml.
//!
//! ponytail: plaintext file at 0600, not the OS keychain — Linux has no
//! keychain that's reliably present (Secret Service needs a running
//! gnome-keyring/kwallet; the kernel keyring doesn't survive a reboot).
//! Swap for the `keyring` crate if that ever becomes a hard requirement.

use std::{collections::HashMap, fs, io::Write, path::PathBuf};
use tauri::{AppHandle, Manager};

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("credentials.json"))
}

fn read_all(app: &AppHandle) -> HashMap<String, String> {
    store_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn load_credential(app: AppHandle, key: String) -> Option<String> {
    read_all(&app).remove(&key)
}

/// `value: None` deletes the entry.
#[tauri::command]
pub fn store_credential(app: AppHandle, key: String, value: Option<String>) -> Result<(), String> {
    let mut all = read_all(&app);
    match value {
        Some(v) => all.insert(key, v),
        None => all.remove(&key),
    };
    let path = store_path(&app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Written to a sibling and renamed over, so a crash mid-write never
    // leaves a truncated file (which would silently forget every token).
    let tmp = path.with_extension("json.tmp");
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
    let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
    f.write_all(serde_json::to_string(&all).map_err(|e| e.to_string())?.as_bytes())
        .map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}
