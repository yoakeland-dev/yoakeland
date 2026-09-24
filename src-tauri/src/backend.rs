//! Owns every live connection to a yoakeland server (§2a) — either a TCP
//! socket (auth handshake required) or, for same-machine use, a Unix domain
//! socket (§2a's "unix:" mode — no token, the OS enforces who can connect).
//! `BackendState` holds a map of these, one per `ConnectionId`, so a single
//! app instance can be talking to several different servers at once — each
//! `connect_tcp`/`connect_unix` call mints a fresh id and adds an entry
//! rather than replacing whatever was there.
//!
//! Each server is a standalone process the user can start on its own
//! (`yoakeland -listen ...`) and leave running independently of this UI —
//! this module never spawns it as a piped child it then owns. When asked to
//! connect locally and nothing answers yet, `spawn_detached_server`/
//! `spawn_detached_unix_server` start one *detached*: no stdin pipe, and we
//! never hold a killable handle to it, so closing this app or calling
//! `disconnect` does not take the server down with it.
//!
//! Envelopes are newline-delimited JSON in both directions (§2). We don't
//! interpret them here beyond framing + the auth handshake — everything else
//! is forwarded to the frontend verbatim as a `yoake-event` Tauri event
//! (tagged with the originating `ConnectionId`) and the frontend's TS state
//! machine (src/lib/ipc.ts) does the rest.

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, RootCertStore};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{split, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::Command;
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinHandle;
use tokio_rustls::TlsConnector;
use uuid::Uuid;

const MAX_FRAME_BYTES: usize = 10 * 1024 * 1024;
const PROBE_TIMEOUT: Duration = Duration::from_millis(400);

/// Client-minted, opaque to the server — not yoakeland's own `serverId`
/// (SPEC.md §3.2 `server_identity`), which isn't known until after this
/// connection's handshake completes. This is what lets a caller address one
/// specific connection the instant `connect_tcp`/`connect_unix` returns, and
/// what every emitted event is tagged with so the frontend can route it to
/// the right one. Mapping a `ConnectionId` to whichever `serverId` it turns
/// out to belong to is the frontend's job (src/lib/state.svelte.ts), not
/// this module's.
pub type ConnectionId = String;

struct Connection {
    tx: mpsc::UnboundedSender<String>,
    reader: JoinHandle<()>,
    writer: JoinHandle<()>,
}

/// One entry per live connection, keyed by `ConnectionId` — was a single
/// `Mutex<Option<Connection>>` when this app only ever talked to one server;
/// an `RwLock` over a map lets `send_envelope` calls to *different*
/// connections proceed concurrently instead of serializing behind one lock,
/// and lets more than one connection exist at all. `Clone` is cheap (just the
/// inner `Arc`) — needed so `spawn_reader_task` can hold its own handle to
/// clean up after itself on a connection it discovers is dead (see there).
#[derive(Default, Clone)]
pub struct BackendState(Arc<RwLock<HashMap<ConnectionId, Connection>>>);

impl BackendState {
    async fn insert(&self, connection_id: ConnectionId, conn: Connection) {
        self.0.write().await.insert(connection_id, conn);
    }

    /// Sends `line` on `connection_id`'s writer, or `"not connected"` if no
    /// such connection exists (already disconnected, or never existed).
    async fn send(&self, connection_id: &ConnectionId, line: String) -> Result<(), String> {
        let guard = self.0.read().await;
        let conn = guard.get(connection_id).ok_or("not connected")?;
        conn.tx.send(line).map_err(|e| format!("send failed: {e}"))
    }

    /// Removes and returns `connection_id`'s entry, if it exists. Callers are
    /// responsible for `.abort()`-ing the returned `Connection`'s tasks —
    /// kept a separate step (rather than folded in here) so this stays a
    /// plain map operation the tests below can exercise without needing a
    /// real reader/writer task pair.
    async fn remove(&self, connection_id: &ConnectionId) -> Option<Connection> {
        self.0.write().await.remove(connection_id)
    }
}

#[derive(Serialize, Clone)]
struct EventPayload {
    #[serde(rename = "connectionId")]
    connection_id: ConnectionId,
    envelope: Value,
}

#[derive(Serialize, Clone)]
struct LogPayload {
    #[serde(rename = "connectionId")]
    connection_id: ConnectionId,
    message: String,
}

#[derive(Serialize, Clone)]
struct DisconnectedPayload {
    #[serde(rename = "connectionId")]
    connection_id: ConnectionId,
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

fn spawn_writer_task<W>(mut writer: W, mut rx: mpsc::UnboundedReceiver<String>) -> JoinHandle<()>
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
    })
}

/// Tags every event this connection produces with `connection_id`, so a
/// frontend holding several simultaneous connections can route each one to
/// the right server's state. Returns the task's `JoinHandle` so a caller can
/// `.abort()` it explicitly on disconnect/supersession — dropping a
/// `JoinHandle` does *not* cancel the task, only losing the last reference to
/// it does (eventually, via the runtime's own cleanup), which is what used to
/// let a superseded connection's reader linger until its own socket happened
/// to error out.
///
/// On EOF or a read error — a connection dying on its own (server restart,
/// network drop, laptop sleep), as opposed to the frontend calling
/// `disconnect` — this is the only code that will ever find out, so it also
/// removes `connection_id` from `state` and aborts the writer task itself.
/// Without this, a connection that dies on its own left its `Connection`
/// (and the still-running writer, and the OS socket) in the map forever:
/// nothing but an explicit `disconnect` call ever removed an entry, and nothing
/// calls that in response to a `yoake-disconnected` event the frontend didn't
/// itself initiate (e.g. the frontend's own watchdog-timeout path does call
/// `disconnect` first, but a plain EOF does not) — every drop-then-reconnect
/// would otherwise leak one dead entry.
fn spawn_reader_task<R>(
    app: AppHandle,
    state: BackendState,
    connection_id: ConnectionId,
    reader: R,
    on_eof_reason: &'static str,
) -> JoinHandle<()>
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        let reason = loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if line.len() > MAX_FRAME_BYTES {
                        let _ = app.emit(
                            "yoake-log",
                            LogPayload {
                                connection_id: connection_id.clone(),
                                message: format!("dropped oversized frame ({} bytes)", line.len()),
                            },
                        );
                        continue;
                    }
                    match serde_json::from_str::<Value>(&line) {
                        Ok(v) => {
                            let _ = app.emit(
                                "yoake-event",
                                EventPayload {
                                    connection_id: connection_id.clone(),
                                    envelope: v,
                                },
                            );
                        }
                        Err(e) => {
                            let _ = app.emit(
                                "yoake-log",
                                LogPayload {
                                    connection_id: connection_id.clone(),
                                    message: format!("bad frame: {e}: {line}"),
                                },
                            );
                        }
                    }
                    continue;
                }
                Ok(None) => break on_eof_reason.to_string(),
                Err(e) => break format!("read error: {e}"),
            }
        };
        let _ = app.emit(
            "yoake-disconnected",
            DisconnectedPayload { connection_id: connection_id.clone(), reason },
        );
        forget_dead_connection(&state, &connection_id).await;
    })
}

/// Removes `connection_id` from `state` and aborts its writer task — the
/// cleanup a connection's reader does for itself once it discovers (via EOF
/// or a read error) that the connection is dead. Split out from
/// `spawn_reader_task` so it's exercisable without a real `AppHandle`.
async fn forget_dead_connection(state: &BackendState, connection_id: &ConnectionId) {
    if let Some(conn) = state.remove(connection_id).await {
        conn.writer.abort();
    }
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
///
/// On Windows the local transport is a named pipe, not a socket file: the
/// server's `\\.\pipe\yoakeland-<USERNAME>` (§2a).
#[tauri::command]
pub fn default_socket_path() -> String {
    if cfg!(windows) {
        return format!(r"\\.\pipe\yoakeland-{}", std::env::var("USERNAME").unwrap_or_default());
    }
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

/// Opens the local transport (§2a): a Unix domain socket, or on Windows the
/// server's named pipe.
#[cfg(unix)]
async fn open_local(path: &str) -> std::io::Result<tokio::net::UnixStream> {
    tokio::net::UnixStream::connect(path).await
}

/// Windows: a named pipe. All server instances can be momentarily busy
/// between the server accepting one client and opening the next instance,
/// so ERROR_PIPE_BUSY is retried briefly. The pipe namespace is global, so
/// the pipe is only trusted once it's confirmed to be owned by this user —
/// otherwise another local user could create the name first and receive our
/// prompts and credentials.
#[cfg(windows)]
async fn open_local(path: &str) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    use tokio::net::windows::named_pipe::ClientOptions;
    use windows_sys::Win32::Foundation::ERROR_PIPE_BUSY;
    let mut tries = 0;
    let client = loop {
        match ClientOptions::new().open(path) {
            Ok(c) => break c,
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) && tries < 40 => tries += 1,
            Err(e) => return Err(e),
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    check_pipe_owner(&client)?;
    Ok(client)
}

#[cfg(windows)]
fn check_pipe_owner(pipe: &tokio::net::windows::named_pipe::NamedPipeClient) -> std::io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree};
    use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_KERNEL_OBJECT};
    use windows_sys::Win32::Security::{
        EqualSid, GetTokenInformation, TokenUser, OWNER_SECURITY_INFORMATION, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // SAFETY: plain Win32 calls on handles we own; `owner` points into `sd`,
    // which is freed only after its last use, and `buf` is u64-aligned and
    // large enough for a TOKEN_USER plus the largest possible SID.
    unsafe {
        let (mut owner, mut sd) = (null_mut(), null_mut());
        let rc = GetSecurityInfo(
            pipe.as_raw_handle(),
            SE_KERNEL_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            null_mut(),
            null_mut(),
            &mut sd,
        );
        if rc != 0 {
            return Err(std::io::Error::from_raw_os_error(rc as i32));
        }
        let mut token = null_mut();
        let mut buf = [0u64; 32];
        let mut len = 0;
        let ok = OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) != 0
            && GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), 256, &mut len) != 0;
        let err = std::io::Error::last_os_error();
        if !token.is_null() {
            CloseHandle(token);
        }
        let same = ok && EqualSid(owner, (*buf.as_ptr().cast::<TOKEN_USER>()).User.Sid) != 0;
        LocalFree(sd);
        if !ok {
            return Err(err);
        }
        if !same {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "pipe isn't owned by this user; refusing to connect",
            ));
        }
    }
    Ok(())
}

/// Same idea as `probe_tcp`, for the local socket/pipe (§2a).
#[tauri::command]
pub async fn probe_unix(path: String) -> bool {
    let path = expand_tilde(&path);
    tokio::time::timeout(PROBE_TIMEOUT, open_local(&path))
        .await
        .map(|r| r.is_ok())
        .unwrap_or(false)
}

async fn spawn_and_pipe_logs(app: AppHandle, bin_path: &str, args: &[String]) -> Result<(), String> {
    let mut cmd = Command::new(bin_path);
    // yoakeland is a console program: without this, launching it from the
    // GUI on Windows pops up a console window that lives as long as it does.
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {bin_path}: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // No ConnectionId yet at this point — spawning the binary happens before
    // any connect_tcp/connect_unix call, so this is tagged with an empty
    // sentinel id rather than a real connection's. The frontend treats an
    // empty connectionId as an unscoped/startup log line.
    if let Some(stdout) = stdout {
        let app = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    "yoake-log",
                    LogPayload { connection_id: String::new(), message: format!("[server] {line}") },
                );
            }
        });
    }
    if let Some(stderr) = stderr {
        let app = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    "yoake-log",
                    LogPayload { connection_id: String::new(), message: format!("[server] {line}") },
                );
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
    device_id: Option<String>,
) -> Result<ConnectionId, String> {
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
    let connection_id = Uuid::new_v4().to_string();

    let (tx, rx) = mpsc::unbounded_channel();
    let writer = spawn_writer_task(write_half, rx);
    let reader = spawn_reader_task(
        app.clone(),
        state.inner().clone(),
        connection_id.clone(),
        read_half,
        "connection closed",
    );

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
    if let Some(device_id) = device_id {
        auth_data["deviceId"] = serde_json::Value::String(device_id);
    }
    let auth = serde_json::json!({"type": "auth", "data": auth_data});
    tx.send(auth.to_string())
        .map_err(|e| format!("failed to send auth frame: {e}"))?;

    state.insert(connection_id.clone(), Connection { tx, reader, writer }).await;
    Ok(connection_id)
}

/// Connects over a Unix domain socket (§2a) — no auth handshake required, the
/// kernel already checked the connecting process's UID/GID against the
/// socket file's permissions before the connection was even accepted. An
/// `auth` frame is still sent, opt-in, purely to self-report identity for the
/// peer list (§3.2 `peer_list`) when any of `name`/`device_type`/`avatar`/`device_id` is
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
    device_id: Option<String>,
) -> Result<ConnectionId, String> {
    let path = expand_tilde(&path);
    let stream = open_local(&path)
        .await
        .map_err(|e| format!("connect to {path} failed: {e}"))?;
    let (read_half, write_half) = split(stream);
    let connection_id = Uuid::new_v4().to_string();

    let (tx, rx) = mpsc::unbounded_channel();
    let writer = spawn_writer_task(write_half, rx);
    let reader = spawn_reader_task(
        app.clone(),
        state.inner().clone(),
        connection_id.clone(),
        read_half,
        "connection closed",
    );

    if name.is_some() || device_type.is_some() || avatar.is_some() || device_id.is_some() {
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
        if let Some(device_id) = device_id {
            auth_data.insert("deviceId".to_string(), serde_json::Value::String(device_id));
        }
        let auth = serde_json::json!({"type": "auth", "data": auth_data});
        tx.send(auth.to_string())
            .map_err(|e| format!("failed to send auth frame: {e}"))?;
    }

    state.insert(connection_id.clone(), Connection { tx, reader, writer }).await;
    Ok(connection_id)
}

#[tauri::command]
pub async fn send_envelope(
    state: tauri::State<'_, BackendState>,
    connection_id: ConnectionId,
    envelope: Value,
) -> Result<(), String> {
    state.send(&connection_id, envelope.to_string()).await
}

/// Closes one specific connection. Never touches a server process — a server
/// spawned by `spawn_detached_server`/`spawn_detached_unix_server`, or one the
/// user started themselves, is never something this app owns the lifecycle
/// of. Explicitly `.abort()`s both the reader and writer tasks rather than
/// just dropping the map entry: dropping a `JoinHandle` does not cancel its
/// task, only `.abort()` does — this is what makes disconnecting (or a new
/// connection superseding an old one) actually stop the old reader instead of
/// leaving it running until its socket happens to error out on its own.
#[tauri::command]
pub async fn disconnect(
    state: tauri::State<'_, BackendState>,
    connection_id: ConnectionId,
) -> Result<(), String> {
    if let Some(conn) = state.remove(&connection_id).await {
        conn.reader.abort();
        conn.writer.abort();
    }
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

/// Raw bytes of a local file dropped onto the composer, so it can be
/// uploaded to a *remote* server as an attachment (SPEC.md §3.1
/// upload_begin). Returned as a binary IPC response (an ArrayBuffer on the
/// JS side) rather than a JSON number array, which would balloon a
/// multi-megabyte file. Only ever called with paths from a native drop event.
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    tokio::fs::read(&path)
        .await
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("failed to read {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A `Connection` whose reader/writer tasks just spin, incrementing an
    /// atomic counter, until aborted — a stand-in for a real socket's
    /// reader/writer pair that lets us prove `.abort()` actually stops them,
    /// without needing a real TCP/Unix connection.
    fn spinning_connection() -> (Connection, Arc<AtomicUsize>, Arc<AtomicUsize>) {
        let reader_ticks = Arc::new(AtomicUsize::new(0));
        let writer_ticks = Arc::new(AtomicUsize::new(0));
        let (tx, _rx) = mpsc::unbounded_channel();

        let r = reader_ticks.clone();
        let reader = tokio::spawn(async move {
            loop {
                r.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });
        let w = writer_ticks.clone();
        let writer = tokio::spawn(async move {
            loop {
                w.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });

        (Connection { tx, reader, writer }, reader_ticks, writer_ticks)
    }

    #[tokio::test]
    async fn send_envelope_to_unknown_connection_errors() {
        let state = BackendState::default();
        let err = state.send(&"nonexistent".to_string(), "{}".to_string()).await.unwrap_err();
        assert_eq!(err, "not connected");
    }

    #[tokio::test]
    async fn two_connections_are_independent() {
        let state = BackendState::default();
        let (tx_a, mut rx_a) = mpsc::unbounded_channel();
        let (tx_b, mut rx_b) = mpsc::unbounded_channel();
        let noop = || tokio::spawn(async { std::future::pending::<()>().await });

        state.insert("a".into(), Connection { tx: tx_a, reader: noop(), writer: noop() }).await;
        state.insert("b".into(), Connection { tx: tx_b, reader: noop(), writer: noop() }).await;

        state.send(&"a".to_string(), "hello-a".to_string()).await.unwrap();
        state.send(&"b".to_string(), "hello-b".to_string()).await.unwrap();

        assert_eq!(rx_a.recv().await.unwrap(), "hello-a");
        assert_eq!(rx_b.recv().await.unwrap(), "hello-b");
    }

    /// Guards a second, previously-latent leak: a connection that dies on its
    /// own (EOF/read error, as opposed to an explicit `disconnect` call) must
    /// still remove itself from `BackendState` and stop its writer task —
    /// see spawn_reader_task's doc comment. This is the cleanup that code
    /// path calls once it detects EOF/an error; testing it directly avoids
    /// needing a real `AppHandle` (spawn_reader_task itself isn't
    /// constructible in a plain unit test).
    #[tokio::test]
    async fn forget_dead_connection_removes_entry_and_aborts_writer() {
        let state = BackendState::default();
        let (conn, _reader_ticks, writer_ticks) = spinning_connection();
        let connection_id = "will-drop".to_string();
        state.insert(connection_id.clone(), conn).await;

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(writer_ticks.load(Ordering::SeqCst) > 0, "writer should have been running");

        forget_dead_connection(&state, &connection_id).await;

        let writer_at_cleanup = writer_ticks.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(
            writer_ticks.load(Ordering::SeqCst),
            writer_at_cleanup,
            "the writer task should have been aborted, not left running",
        );
        assert_eq!(
            state.send(&connection_id, "x".to_string()).await,
            Err("not connected".to_string()),
            "the dead connection's entry should be gone from BackendState",
        );
    }

    /// Guards the actual fix in this rewrite: removing a connection must stop
    /// its reader/writer tasks, not just drop the map entry a caller can no
    /// longer reach. Before this change, superseding/disconnecting a
    /// connection only dropped the sender, which stopped the writer (its
    /// `rx.recv()` returns `None`) but left the reader running indefinitely.
    #[tokio::test]
    async fn remove_aborts_reader_and_writer_tasks() {
        let state = BackendState::default();
        let (conn, reader_ticks, writer_ticks) = spinning_connection();
        state.insert("a".into(), conn).await;

        // Let both tasks tick at least once so we know they were really running.
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(reader_ticks.load(Ordering::SeqCst) > 0);
        assert!(writer_ticks.load(Ordering::SeqCst) > 0);

        let conn = state.remove(&"a".to_string()).await.expect("connection should exist");
        conn.reader.abort();
        conn.writer.abort();

        let reader_at_abort = reader_ticks.load(Ordering::SeqCst);
        let writer_at_abort = writer_ticks.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(20)).await;

        // Aborted tasks stop ticking almost immediately; a lingering task
        // (the bug this guards against) would keep incrementing.
        assert_eq!(reader_ticks.load(Ordering::SeqCst), reader_at_abort);
        assert_eq!(writer_ticks.load(Ordering::SeqCst), writer_at_abort);

        // And the connection is genuinely gone, not just its tasks stopped.
        assert_eq!(
            state.send(&"a".to_string(), "x".to_string()).await,
            Err("not connected".to_string())
        );
    }
}
