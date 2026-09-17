//! Owns the single connection to a yoakeland server (§2a) — either a TCP
//! socket (auth handshake required) or, for same-machine use, a Unix domain
//! socket (§2a's "unix:" mode — no token, the OS enforces who can connect).
//!
//! The server is a standalone process the user can start on its own
//! (`yoakeland -listen ...`) and leave running independently of this UI —
//! this module never spawns it as a piped child it then owns. When asked to
//! connect locally and nothing answers yet, `spawn_detached_server`/
//! `spawn_detached_unix_server` start one *detached*: no stdin pipe, and we
//! never hold a killable handle to it, so closing this app or calling
//! `disconnect` does not take the server down with it.
//!
//! Envelopes are newline-delimited JSON in both directions (§2). We don't
//! interpret them here beyond framing + the auth handshake — everything else
//! is forwarded to the frontend verbatim as a `yoake-event` Tauri event and
//! the frontend's TS state machine (src/lib/ipc.ts) does the rest.

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, RootCertStore};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{split, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::{TcpStream, UnixStream};
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};
use tokio_rustls::TlsConnector;

const MAX_FRAME_BYTES: usize = 10 * 1024 * 1024;
const PROBE_TIMEOUT: Duration = Duration::from_millis(400);

struct Connection {
    tx: mpsc::UnboundedSender<String>,
}

#[derive(Default)]
pub struct BackendState(Arc<Mutex<Option<Connection>>>);

#[derive(Serialize, Clone)]
struct DisconnectedPayload {
    reason: String,
}

/// `~/...` isn't expanded by the OS for us — Unix socket paths are just
/// filesystem paths, so a leading `~` needs handling ourselves.
fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

fn spawn_writer_task<W>(mut writer: W, mut rx: mpsc::UnboundedReceiver<String>)
where
    W: AsyncWrite + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            if writer.write_all(line.as_bytes()).await.is_err()
                || writer.write_all(b"\n").await.is_err()
                || writer.flush().await.is_err()
            {
                break;
            }
        }
    });
}

fn spawn_reader_task<R>(app: AppHandle, reader: R, on_eof_reason: &'static str)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if line.len() > MAX_FRAME_BYTES {
                        let _ = app.emit(
                            "yoake-log",
                            format!("dropped oversized frame ({} bytes)", line.len()),
                        );
                        continue;
                    }
                    match serde_json::from_str::<Value>(&line) {
                        Ok(v) => {
                            let _ = app.emit("yoake-event", v);
                        }
                        Err(e) => {
                            let _ = app.emit("yoake-log", format!("bad frame: {e}: {line}"));
                        }
                    }
                }
                Ok(None) => {
                    let _ = app.emit(
                        "yoake-disconnected",
                        DisconnectedPayload {
                            reason: on_eof_reason.to_string(),
                        },
                    );
                    break;
                }
                Err(e) => {
                    let _ = app.emit(
                        "yoake-disconnected",
                        DisconnectedPayload {
                            reason: format!("read error: {e}"),
                        },
                    );
                    break;
                }
            }
        }
    });
}

/// Fast "is anything listening here" check — used to decide whether the local
/// project already has a yoakeland server running before offering to launch
/// one. Deliberately doesn't try to auth; a stray non-yoakeland listener on
/// the port would still read as "reachable" here, and the real `connect_tcp`
/// call right after this is what actually proves it speaks the protocol.
#[tauri::command]
pub async fn probe_tcp(host: String, port: u16) -> bool {
    tokio::time::timeout(PROBE_TIMEOUT, TcpStream::connect((host.as_str(), port)))
        .await
        .map(|r| r.is_ok())
        .unwrap_or(false)
}

/// Mirrors yoakeland's own default listen-socket resolution, so a client that
/// never sets a custom path still lands on the same socket the server picks
/// when launched with no `-socket` flag: `$XDG_RUNTIME_DIR/yoake/…`, then (on
/// macOS, where XDG_RUNTIME_DIR usually isn't set) `$TMPDIR/yoake/…`,
/// otherwise `~/.yoake/…`.
#[tauri::command]
pub fn default_socket_path() -> String {
    if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
        if !dir.is_empty() {
            return format!("{}/yoake/yoakeland.sock", dir.trim_end_matches('/'));
        }
    }
    if cfg!(target_os = "macos") {
        if let Ok(dir) = std::env::var("TMPDIR") {
            if !dir.is_empty() {
                return format!("{}/yoake/yoakeland.sock", dir.trim_end_matches('/'));
            }
        }
    }
    expand_tilde("~/.yoake/yoakeland.sock")
}

/// Same idea as `probe_tcp`, for a Unix domain socket path (§2a).
#[tauri::command]
pub async fn probe_unix(path: String) -> bool {
    let path = expand_tilde(&path);
    tokio::time::timeout(PROBE_TIMEOUT, UnixStream::connect(&path))
        .await
        .map(|r| r.is_ok())
        .unwrap_or(false)
}

async fn spawn_and_pipe_logs(app: AppHandle, bin_path: &str, args: &[String]) -> Result<(), String> {
    let mut child = Command::new(bin_path)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {bin_path}: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(stdout) = stdout {
        let app = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit("yoake-log", format!("[server] {line}"));
            }
        });
    }
    if let Some(stderr) = stderr {
        let app = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit("yoake-log", format!("[server] {line}"));
            }
        });
    }

    // Deliberately not stored anywhere and not `.wait()`ed on: dropping a
    // tokio::process::Child does not kill it, so the server outlives this
    // command (and this whole app) unless the user stops it themselves.
    drop(child);
    Ok(())
}

/// Starts a yoakeland server as an independent, detached process, listening
/// on TCP with a token (§2a). No `-project` and no provider flags (§1 of the
/// v2.1 spec): a server isn't bound to a single folder any more (§4b —
/// projects are opened on demand over the wire), and credentials are meant to
/// be registered from the client via `register_provider` (§6b/§6c), not
/// baked into how the process is launched.
#[tauri::command]
pub async fn spawn_detached_server(
    app: AppHandle,
    bin_path: String,
    host: String,
    port: u16,
    token: String,
) -> Result<(), String> {
    let args = vec![
        "-listen".to_string(),
        format!("{host}:{port}"),
        "-token".to_string(),
        token,
    ];
    spawn_and_pipe_logs(app, &bin_path, &args).await
}

/// Same as `spawn_detached_server`, but for a Unix domain socket (§2a) — no
/// `-token` at all, since the OS (via the socket file's 0600 permissions)
/// is what restricts who can connect, not a shared secret.
#[tauri::command]
pub async fn spawn_detached_unix_server(
    app: AppHandle,
    bin_path: String,
    socket_path: String,
) -> Result<(), String> {
    let args = vec![
        "-listen".to_string(),
        format!("unix:{}", expand_tilde(&socket_path)),
    ];
    spawn_and_pipe_logs(app, &bin_path, &args).await
}

/// Builds a TLS connector trusting only one specific CA (yoakeland's own
/// auto-managed one, per §2a — pair a client by copying `<-state-dir>/tls/
/// ca.pem` over once) rather than the public trust store: this is exactly
/// what §2a asks for ("trust only that certificate... not the public trust
/// store") and, importantly, needs no custom certificate-verification logic
/// of our own — it's rustls's own standard root-of-trust mechanism pointed
/// at a non-default root, not a hand-rolled TOFU/pinning verifier.
///
/// `ca_pem` empty/absent means the operator passed their own `-tls-cert`/
/// `-tls-key` (a real, publicly-issued certificate, §2a) instead of relying
/// on the auto-managed CA — in that case we fall back to the OS's own trust
/// store, same as any other TLS client would.
fn build_tls_connector(ca_pem: Option<&str>) -> Result<TlsConnector, String> {
    let mut roots = RootCertStore::empty();
    match ca_pem.map(str::trim).filter(|s| !s.is_empty()) {
        Some(pem) => {
            let mut reader = std::io::BufReader::new(pem.as_bytes());
            let certs = rustls_pemfile::certs(&mut reader)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("invalid CA certificate: {e}"))?;
            if certs.is_empty() {
                return Err("no certificate found in the provided CA file".to_string());
            }
            for cert in certs {
                roots
                    .add(cert)
                    .map_err(|e| format!("invalid CA certificate: {e}"))?;
            }
        }
        None => {
            let native = rustls_native_certs::load_native_certs();
            for cert in native.certs {
                let _ = roots.add(cert);
            }
            if roots.is_empty() {
                return Err(
                    "no CA certificate provided, and no usable certificates found in the \
                     system trust store — pair this client with the server's \
                     <-state-dir>/tls/ca.pem first"
                        .to_string(),
                );
            }
        }
    }

    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(TlsConnector::from(Arc::new(config)))
}

#[tauri::command]
pub async fn connect_tcp(
    app: AppHandle,
    state: tauri::State<'_, BackendState>,
    host: String,
    port: u16,
    token: String,
    ca_pem: Option<String>,
    name: Option<String>,
    device_type: Option<String>,
    avatar: Option<String>,
) -> Result<(), String> {
    // The TCP listener is TLS-only now (§2a) — no plaintext fallback exists
    // server-side any more, so this always negotiates TLS before the
    // envelope protocol starts.
    let tcp_stream = TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|e| format!("connect to {host}:{port} failed: {e}"))?;

    let connector = build_tls_connector(ca_pem.as_deref())?;
    let server_name = ServerName::try_from(host.clone())
        .map_err(|e| format!("invalid server hostname/IP {host:?}: {e}"))?;
    let stream = connector
        .connect(server_name, tcp_stream)
        .await
        .map_err(|e| {
            format!(
                "TLS handshake with {host}:{port} failed: {e} — is the right CA \
                 certificate paired for this server?"
            )
        })?;

    let (read_half, write_half) = split(stream);

    let (tx, rx) = mpsc::unbounded_channel();
    spawn_writer_task(write_half, rx);
    spawn_reader_task(app.clone(), read_half, "connection closed");

    let mut auth_data = serde_json::json!({"token": token});
    if let Some(name) = name {
        auth_data["name"] = serde_json::Value::String(name);
    }
    if let Some(device_type) = device_type {
        auth_data["deviceType"] = serde_json::Value::String(device_type);
    }
    if let Some(avatar) = avatar {
        auth_data["avatar"] = serde_json::Value::String(avatar);
    }
    let auth = serde_json::json!({"type": "auth", "data": auth_data});
    tx.send(auth.to_string())
        .map_err(|e| format!("failed to send auth frame: {e}"))?;

    let mut guard = state.0.lock().await;
    *guard = Some(Connection { tx });
    Ok(())
}

/// Connects over a Unix domain socket (§2a) — no auth handshake required, the
/// kernel already checked the connecting process's UID/GID against the
/// socket file's permissions before the connection was even accepted. An
/// `auth` frame is still sent, opt-in, purely to self-report identity for the
/// peer list (§3.2 `peer_list`) when any of `name`/`device_type`/`avatar` is
/// given — `token` is omitted, since file permissions are already the
/// boundary here, not a shared secret.
#[tauri::command]
pub async fn connect_unix(
    app: AppHandle,
    state: tauri::State<'_, BackendState>,
    path: String,
    name: Option<String>,
    device_type: Option<String>,
    avatar: Option<String>,
) -> Result<(), String> {
    let path = expand_tilde(&path);
    let stream = UnixStream::connect(&path)
        .await
        .map_err(|e| format!("connect to {path} failed: {e}"))?;
    let (read_half, write_half) = stream.into_split();

    let (tx, rx) = mpsc::unbounded_channel();
    spawn_writer_task(write_half, rx);
    spawn_reader_task(app.clone(), read_half, "connection closed");

    if name.is_some() || device_type.is_some() || avatar.is_some() {
        let mut auth_data = serde_json::Map::new();
        if let Some(name) = name {
            auth_data.insert("name".to_string(), serde_json::Value::String(name));
        }
        if let Some(device_type) = device_type {
            auth_data.insert("deviceType".to_string(), serde_json::Value::String(device_type));
        }
        if let Some(avatar) = avatar {
            auth_data.insert("avatar".to_string(), serde_json::Value::String(avatar));
        }
        let auth = serde_json::json!({"type": "auth", "data": auth_data});
        tx.send(auth.to_string())
            .map_err(|e| format!("failed to send auth frame: {e}"))?;
    }

    let mut guard = state.0.lock().await;
    *guard = Some(Connection { tx });
    Ok(())
}

#[tauri::command]
pub async fn send_envelope(
    state: tauri::State<'_, BackendState>,
    envelope: Value,
) -> Result<(), String> {
    let guard = state.0.lock().await;
    let conn = guard.as_ref().ok_or("not connected")?;
    conn.tx
        .send(envelope.to_string())
        .map_err(|e| format!("send failed: {e}"))
}

/// Closes this app's connection only. Never touches a server process — a
/// server spawned by `spawn_detached_server`/`spawn_detached_unix_server`, or
/// one the user started themselves, is never something this app owns the
/// lifecycle of.
#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, BackendState>) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    guard.take();
    Ok(())
}

/// Reads a small text file (used for importing a server's `ca.pem`, §2a
/// pairing) — this app has no general filesystem plugin, so this is the one
/// narrow read it needs, picked via `tauri-plugin-dialog`'s file picker on
/// the frontend and read here.
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("failed to read {path}: {e}"))
}
