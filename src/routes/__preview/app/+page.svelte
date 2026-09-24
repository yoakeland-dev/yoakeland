<script lang="ts">
  // Dev-only: the real app shell with two fake servers seeded in, so the
  // sidebar, composer pickers and status bar can be looked at in a plain
  // browser (no Tauri, no yoakeland). Nothing here talks to a backend —
  // ipc.ts calls just no-op without Tauri.
  import { onMount } from "svelte";
  import Main from "../../+page.svelte";
  import { app, ServerState } from "$lib/state.svelte";
  import type { ChatMessage, SessionSummary } from "$lib/types";

  const now = Date.now();
  const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  const session = (id: string, title: string, minsAgo: number, extra: Partial<SessionSummary> = {}): SessionSummary => ({
    sessionId: id,
    title,
    updatedAt: iso(minsAgo),
    messageCount: 4,
    ...extra,
  });

  function seed(cid: string, mode: "local" | "remote", identity: string, projects: Record<string, SessionSummary[]>) {
    const s = new ServerState(
      cid,
      app,
      mode === "local"
        ? { mode, socketPath: "/run/user/1000/yoake/yoakeland.sock", binPath: "yoakeland" }
        : { mode, host: "10.0.0.5", port: 7890, token: "x" },
    );
    s.connectionStatus = "connected";
    s.serverId = `mock-${cid}`;
    s.serverIdentity = identity;
    s.recentProjects = Object.keys(projects);
    s.sessionsByProject = projects;
    s.providers = [{ name: "claude-subscription", kind: "cli_claude" }, { name: "my-openrouter", kind: "api_key", httpProvider: "openrouter" }];
    s.cliAvailability = { cli_claude: true, cli_codex: false, cli_kimi: true };
    s.modelsByProvider = {
      "claude-subscription": [
        { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", isFavorite: true },
        { id: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
        { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5" },
      ],
      "my-openrouter": [
        { id: "openai/gpt-5", displayName: "GPT-5" },
        { id: "google/gemini-3-pro", displayName: "Gemini 3 Pro" },
      ],
    };
    s.serverStatus = {
      uptimeSec: 3 * 86400 + 4 * 3600,
      activeTurns: 1,
      peers: 2,
      openProjects: 2,
      load1: 1.7,
      cpus: 8,
      memTotalBytes: 32 * 2 ** 30,
      memAvailBytes: 19 * 2 ** 30,
      heapBytes: 180 * 2 ** 20,
    };
    app.servers[cid] = s;
    return s;
  }

  const local = seed("local", "local", "laptop", {
    "/home/aveline/Projects/yoake/yoake-gui": [
      session("s1", "Refine the settings dialog", 3, { mode: "plan" }),
      session("s2", "Fix terminal resize flicker", 90),
      session("s3", "Command palette server pages", 60 * 20, { mode: "autonomous" }),
    ],
    "/home/aveline/Projects/yoakeland": [
      session("s4", "Persist remote tokens", 60 * 5),
      session("s5", "Old TLS experiment", 60 * 24 * 3, { archived: true }),
    ],
  });
  const remote = seed("remote", "remote", "homelab", {
    "/srv/media-stack": [session("r1", "Jellyfin transcoding config", 45)],
  });
  // A chat on homelab stopped on a permission ask, and a third server that's
  // dropped (its cached project stays listed, greyed) — so the status bar
  // and sidebar have something to say.
  remote.activeTurnBySession = { r1: "turn-2" };
  remote.pendingAsks = [
    { kind: "permission", sessionId: "r1", projectPath: "/srv/media-stack", turnId: "turn-2", toolCallId: "t1", toolName: "bash", description: "bash on {\"command\":\"docker compose up -d\"}", requiresAsk: true, cacheKey: "bash:docker" },
  ];
  seed("vps", "remote", "work box", { "/opt/app": [session("v1", "Renew nginx certs", 60 * 10)] }).connectionStatus = "disconnected";
  app.spendToday = { day: new Date().toDateString(), usd: 4.82 };
  local.activeTurnBySession = { s2: "turn-1", s1: "turn-3" };
  // Two asks queued on the open chat (a CLI agent's question, then one of
  // its native edits) — the composer shows the first with "1 of 2".
  const noteDiff = {
    filePath: "/home/aveline/Projects/yoake/yoake-gui/src/lib/components/SettingsPanel.svelte",
    unified: "",
    hunks: [{ oldStart: 12, oldLines: 2, newStart: 12, newLines: 2, lines: [
      { type: " " as const, content: "  <section class=\"settings-section\">" },
      { type: "-" as const, content: "    <h3>Subscriptions</h3>" },
      { type: "+" as const, content: "    <h3>Coding agents</h3>" },
    ] }],
  };
  local.pendingAsks = [
    { kind: "question", sessionId: "s1", projectPath: "/home/aveline/Projects/yoake/yoake-gui", turnId: "turn-3", toolCallId: "q1", question: "Which toggle style should the rows use?", options: ["Switch", "Checkbox"] },
    { kind: "permission", sessionId: "s1", projectPath: "/home/aveline/Projects/yoake/yoake-gui", turnId: "turn-3", toolCallId: "c3", toolName: "Edit", description: "Edit SettingsPanel.svelte", requiresAsk: true, cacheKey: "", diff: noteDiff },
  ];
  // Status bar: CLI rate limits, server-side spend, a queued turn, a session cap.
  local.serverStatus = {
    ...local.serverStatus!,
    queuedTurns: 1,
    rateLimits: {
      "claude-subscription": {
        kind: "cli_claude",
        plan: "max",
        updatedAt: iso(2),
        fiveHour: { usedPct: 55, resetsAt: iso(-120) },
        sevenDay: { usedPct: 84, resetsAt: iso(-60 * 24 * 3) },
        other: [{ windowMins: 10080, label: "Opus", usedPct: 31, resetsAt: iso(-60 * 24 * 3) }],
      },
      "codex-subscription": {
        kind: "cli_codex",
        plan: "free",
        updatedAt: iso(4),
        other: [{ windowMins: 43200, usedPct: 100, resetsAt: iso(-60 * 24 * 6) }],
      },
    },
    spend: { todayUsd: 3.1, monthUsd: 41.25 },
    budgets: [{ scope: "session", period: "total", limitUsd: 5 }],
  };
  local.gitStatusByProject = {
    "/home/aveline/Projects/yoake/yoake-gui": {
      projectPath: "/home/aveline/Projects/yoake/yoake-gui", branch: "main", detached: false, dirtyFiles: 12, ahead: 2, behind: 0, hasUpstream: true,
      files: [
        { path: "src/lib/components/GitWidget.svelte", status: "M" },
        { path: "src/lib/components/PeersWidget.svelte", status: "?" },
        { path: "src/app.css", status: "M" },
        { path: "src/lib/types.ts", status: "M" },
        { path: "src/lib/old.ts", status: "D" },
        ...Array.from({ length: 7 }, (_, i) => ({ path: `src/lib/file${i}.ts`, status: "M" })),
      ],
    },
    "/home/aveline/Projects/yoakeland": {
      projectPath: "/home/aveline/Projects/yoakeland", branch: "usage-probe", detached: false, dirtyFiles: 0, ahead: 0, behind: 3, hasUpstream: true,
    },
  };
  remote.gitStatusByProject = {
    "/srv/media-stack": { projectPath: "/srv/media-stack", branch: null, detached: true, dirtyFiles: 1, ahead: 0, behind: 0, hasUpstream: false, files: [{ path: "compose.yml", status: "M" }] },
  };
  local.peers = [
    { peerId: "p1", name: "anonymous", ip: "", deviceType: "desktop", connectedAt: iso(60 * 3) },
    { peerId: "p2", name: "Pixel 9", ip: "10.0.0.23", deviceType: "web", connectedAt: iso(12), deviceId: "dev-pixel", sessionId: "s2", projectPath: "/home/aveline/Projects/yoake/yoake-gui" },
  ];
  local.notifications = [
    { id: "n1", level: "success", kind: "turn_completed", title: "Fix terminal resize flicker finished", body: "3 files changed", sessionId: "s2", createdAt: iso(5) },
    { id: "n2", level: "error", kind: "turn_failed", title: "Persist remote tokens failed", body: "provider returned 529 overloaded", sessionId: "s4", createdAt: iso(40) },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`, level: "info" as const, kind: i % 2 ? "peer_left" : "peer_joined",
      title: `Pixel 9 ${i % 2 ? "disconnected" : "connected"}`, body: "10.0.0.23", createdAt: iso(60 + i * 30),
    })),
  ];
  local.selfPeerId = "p1";
  remote.selfPeerId = "p3";
  remote.peers = [
    { peerId: "p3", name: "anonymous", ip: "10.0.0.2", deviceType: "desktop", connectedAt: iso(60) },
    // The same phone on the second server: one row, two server badges.
    { peerId: "p5", name: "Pixel 9", ip: "10.0.0.23", deviceType: "web", connectedAt: iso(11), deviceId: "dev-pixel" },
    // An older client with no deviceId.
    { peerId: "p4", name: "cron runner", ip: "10.0.0.5", deviceType: "server", connectedAt: iso(60 * 24 * 2) },
  ];
  // Status-bar terminals: a dev server and a finished build in two chats.
  const term = (terminalId: string, sessionId: string, label: string, status: "running" | "exited", cwd: string, title?: string) => ({
    terminalId, sessionId, label, status, cwd, title, cols: 80, rows: 24, sequence: 0, exitCode: status === "exited" ? 0 : undefined,
  });
  local.terminalById = {
    t1: term("t1", "s1", "fish", "running", "/home/aveline/Projects/yoake/yoake-gui", "npm run dev"),
    t2: term("t2", "s2", "fish", "exited", "/home/aveline/Projects/yoake/yoake-gui"),
  };
  local.terminalsBySession = { s1: ["t1"], s2: ["t2"] };
  // Through the real handler: one live shell, one that exited, in a chat
  // this client never opened.
  remote.handleEvent({
    type: "terminal_index",
    data: {
      terminals: [
        { terminalId: "t3", sessionId: "r1", projectPath: "/srv/media-stack", cwd: "/srv/media-stack", status: "running", label: "bash" },
        { terminalId: "t4", sessionId: "r9", projectPath: "/srv/backups", cwd: "/srv/backups", status: "exited", label: "bash", exitCode: 1 },
      ],
    },
  } as never);
  // Sidebar markers: a pinned chat, an unread one, and an unsent draft.
  local.pinnedSessions = ["s3"];
  local.lastViewedBySession = { s4: iso(60 * 6) };
  local.composerDraftBySession = { s4: "also check the keychain fallback" };
  local.currentProjectPath = "/home/aveline/Projects/yoake/yoake-gui";
  local.currentSessionId = "s1";
  local.projectBySession = { s1: local.currentProjectPath };
  local.providerBySession = { s1: "claude-subscription" };
  local.modelBySession = { s1: "claude-opus-5-5" };
  const msgs: ChatMessage[] = [
    { id: "m1", role: "user", text: "Can you tighten up the settings layout?", toolCalls: [], streaming: false, createdAt: now - 200_000 },
    {
      id: "m2",
      role: "assistant",
      text: "Sure — here's the row pattern I'd use:\n\n```ts\nexport function row(label: string, hint?: string) {\n  return { label, hint }; // one recipe everywhere\n}\n```",
      toolCalls: [],
      streaming: false,
      createdAt: now - 180_000,
      finish: {
        finishReason: "stop",
        sessionId: "s1",
        usage: { inputTokens: 41_000, outputTokens: 2_300, totalTokens: 43_300, costUsd: 0.42 },
        context: { estimatedTokens: 86_000, maxTokens: 200_000 },
        spend: { sessionTotalUsd: 1.37, projectTotalUsd: 12.9 },
        durationMs: 14_000,
      },
    },
    { id: "m3", role: "user", text: "Rename the Subscriptions heading too.", toolCalls: [], streaming: false, createdAt: now - 60_000 },
    // A native (cli_claude) turn: text → Read → Edit (with its diff) → text,
    // the same shape a reload rebuilds from session history.
    {
      id: "m4",
      role: "assistant",
      text: "Let me find it first.",
      toolCalls: [
        { toolCallId: "c1", name: "Read", args: { file_path: noteDiff.filePath }, native: true, kind: "read", title: "Read SettingsPanel.svelte", locations: [noteDiff.filePath], status: "done", output: "…", textOffset: 21 },
        { toolCallId: "c2", name: "Edit", args: { file_path: noteDiff.filePath, old_string: "Subscriptions", new_string: "Coding agents" }, native: true, kind: "edit", title: "Edit SettingsPanel.svelte", locations: [noteDiff.filePath], status: "done", output: "ok", diffs: [noteDiff], textOffset: 21 },
        { toolCallId: "c3", name: "Edit", args: { file_path: noteDiff.filePath }, native: true, kind: "edit", title: "Edit SettingsPanel.svelte", locations: [noteDiff.filePath], status: "awaiting_permission" },
      ],
      streaming: true,
      createdAt: now - 50_000,
    },
  ];
  msgs[3].text += " Renamed — one more place in the hint text below.";
  msgs[3].toolCalls[2].textOffset = msgs[3].text.length;
  local.messagesBySession = { s1: msgs, s2: [], s3: [], s4: [] };
  app.activeConnectionId = "local";

  // ?flat — flat main area; ?open=model|mode — open that composer picker;
  // &q=… — type into the model picker's search. For headless screenshots.
  const params = new URLSearchParams(location.search);
  if (params.has("flat")) app.settings.mainArea = "flat";
  onMount(() => {
    app.applySettings();
    const open = params.get("open");
    if (!open) return;
    setTimeout(() => {
      const triggers = document.querySelectorAll<HTMLElement>(".toolbar .picker-trigger");
      const t = triggers[open === "mode" ? 1 : 0];
      for (const type of ["pointerdown", "pointerup"]) t?.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0 }));
      t?.click();
      const q = params.get("q");
      if (q)
        setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>(".picker-panel .search input");
          if (!input) return;
          input.value = q;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }, 300);
    }, 600);
  });
</script>

<Main />
