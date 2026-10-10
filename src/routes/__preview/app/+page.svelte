<script lang="ts">
  // Dev only: the real app with two fake servers, for checking the UI without yoakeland.
  import { onMount } from "svelte";
  import Main from "../../+page.svelte";
  import { app, ServerState } from "$lib/state.svelte";
  import type { ChatMessage, ModeSpec, ModelInfo, SessionSummary } from "$lib/types";

  const now = Date.now();
  const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  const session = (id: string, title: string, minsAgo: number, extra: Partial<SessionSummary> = {}): SessionSummary => ({
    sessionId: id,
    title,
    updatedAt: iso(minsAgo),
    messageCount: 4,
    ...extra,
  });

  // What each kind of provider reports for permissionModes (SPEC.md §4c), for the mode picker.
  const P = (read: string, edit: string, run: string, network: string) => ({ read, edit, run, network }) as ModeSpec["policy"];
  const ladder = (by: (m: string) => ModeSpec["enforcedBy"], native: Record<string, string>, plan: ModeSpec["plan"], sandbox: boolean, auto = false): ModeSpec[] => [
    { mode: "read_only", policy: P("allow", "deny", "deny", "deny"), enforcedBy: by("read_only"), native: native.read_only },
    { mode: "read_write", policy: P("allow", "ask", "ask", "ask"), enforcedBy: by("read_write"), native: native.read_write },
    { mode: "accept_edits", policy: P("allow", "allow", "ask", "ask"), enforcedBy: by("accept_edits"), native: native.accept_edits },
    ...(auto ? [{ mode: "auto", policy: P("allow", "allow", "auto", "auto"), enforcedBy: by("auto"), native: native.auto } as ModeSpec] : []),
    { mode: "autonomous", policy: P("allow", "allow", "allow", "allow"), enforcedBy: by("autonomous"), native: native.autonomous, sandbox },
    { mode: "plan", policy: P("allow", "deny", "deny", "deny"), enforcedBy: by("plan"), native: native.plan, plan },
  ];
  const claudeModes = ladder(() => "agent", { read_only: "plan", read_write: "default", accept_edits: "acceptEdits", auto: "auto", autonomous: "bypassPermissions", plan: "plan" }, "native", true, true);
  const apiModes = ladder(() => "yoakeland", {}, "yoakeland", true);
  // An ACP agent with only build and plan: everything else is yoakeland's bridge alone.
  const acpModes = ladder((m) => (m === "read_only" || m === "read_write" || m === "plan" ? "agent" : "yoakeland"), { read_only: "plan", read_write: "build", plan: "plan" }, "native", false);
  const withModes = (id: string, displayName: string, modes: ModeSpec[], extra: Partial<ModelInfo> = {}): ModelInfo => ({
    id,
    displayName,
    ...extra,
    capabilities: { ...extra.capabilities, permissionModes: modes },
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
    s.providers = [
      { name: "claude-subscription", kind: "cli_claude" },
      { name: "my-openrouter", kind: "api_key", httpProvider: "openrouter" },
      { name: "opencode", kind: "cli_opencode" },
    ];
    for (const path of Object.keys(projects)) {
      s.mcpByProject[path] = {
        projectPath: path,
        redacted: "••••••",
        servers: [
          { name: "github", scope: "user", state: "ready", config: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "••••••" } }, remote: true, signedIn: true, tools: [
            { name: "mcp__github__create_issue", rawName: "create_issue", description: "Open an issue", enabled: true },
            { name: "mcp__github__list_prs", rawName: "list_prs", description: "List pull requests", readOnly: true, enabled: true },
          ] },
          { name: "linear", scope: "user", state: "needs_auth", config: { type: "http", url: "https://mcp.linear.app/mcp" }, remote: true, error: "This server wants you to sign in." },
          { name: "fs", scope: "project", state: "pending", approval: "pending", config: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], env: { LOG: "info" } } },
        ],
      };
      s.skillsByProject[path] = {
        projectPath: path,
        roots: [{ path: `${path}/.claude/skills`, source: "claude", scope: "project", exists: true }],
        skills: [
          { name: "review-pr", description: "Review a pull request for bugs and style", dir: `${path}/.claude/skills/review-pr`, file: "SKILL.md", scope: "project", source: "claude", agents: ["claude", "native"], enabled: true, userInvocable: true, argumentHint: "<number>", files: 2, bytes: 2100 },
          { name: "release-notes", description: "Draft release notes from merged changes", dir: "/home/me/.claude/skills/release-notes", file: "SKILL.md", scope: "user", source: "claude", agents: ["claude", "native"], enabled: true, userInvocable: true, files: 1, bytes: 900 },
        ],
      };
    }
    s.cliAvailability = { cli_claude: true, cli_codex: false, cli_kimi: true };
    s.modelsByProvider = {
      "claude-subscription": [
        withModes("claude-opus-5-5", "Claude Opus 5.5", claudeModes, {
          isFavorite: true,
          capabilities: { reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultracode"], fastMode: true },
        }),
        withModes("claude-sonnet-5", "Claude Sonnet 5", claudeModes),
        withModes("claude-haiku-4-5", "Claude Haiku 4.5", claudeModes),
      ],
      "my-openrouter": [withModes("openai/gpt-5", "GPT-5", apiModes), withModes("google/gemini-3-pro", "Gemini 3 Pro", apiModes)],
      opencode: [withModes("opencode/big-pickle", "Big Pickle", acpModes)],
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
  // dropped (its cached project stays listed, greyed), so the status bar
  // and sidebar have something to say.
  remote.activeTurnBySession = { r1: "turn-2" };
  remote.pendingAsks = [
    { kind: "permission", sessionId: "r1", projectPath: "/srv/media-stack", turnId: "turn-2", toolCallId: "t1", toolName: "bash", description: "bash on {\"command\":\"docker compose up -d\"}", requiresAsk: true, cacheKey: "bash:docker", suggestions: [{ id: "r1", label: "`docker compose up *`" }, { id: "r2", label: "`docker compose *`" }] },
  ];
  seed("vps", "remote", "work box", { "/opt/app": [session("v1", "Renew nginx certs", 60 * 10)] }).connectionStatus = "disconnected";
  app.spendToday = { day: new Date().toDateString(), usd: 4.82 };
  local.activeTurnBySession = { s2: "turn-1", s1: "turn-3" };
  // Two asks queued on the open chat (a CLI agent's question, then one of
  // its native edits): the composer shows the first with "1 of 2".
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
    { kind: "permission", sessionId: "s1", projectPath: "/home/aveline/Projects/yoake/yoake-gui", turnId: "turn-3", toolCallId: "c3", toolName: "Edit", description: "Edit SettingsPanel.svelte", requiresAsk: true, cacheKey: "", diff: noteDiff, suggestions: [{ id: "e1", label: "Edits in `src/lib/components/**`" }, { id: "e2", label: "All edits" }] },
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
  // No sandbox on yoake-gui (the mode picker, status bar and header shout about it), bubblewrap on the other.
  local.sandboxTierByProject = { "/home/aveline/Projects/yoake/yoake-gui": "local_restricted_fallback", "/home/aveline/Projects/yoakeland": "bubblewrap" };
  local.runtime = {
    maxRoundsPerTurn: 0, maxSessionCostUsd: 0, disableBashWhenUnsandboxed: false, execTimeoutSec: 60, execOutputMaxBytes: 1048576,
    terminalMemoryMaxMB: 2048, terminalPidsMax: 512, terminalReadMaxChars: 12000, terminalHistoryKB: 256, poolIdleMinutes: 30,
    poolMaxLive: 0, pricingRefreshHours: 24, browserBlockCrossOrigin: true, autoCompactTokens: 400000, compactInstructions: "",
  };
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
  // ?plan: s1 has a plan waiting for approval.
  if (new URLSearchParams(location.search).has("plan")) {
    local.modeBySession = { ...local.modeBySession, s1: "plan" };
    local.tierBeforePlan = { s1: "read_write" };
    local.planBySession = {
      s1: {
        path: "/state/plans/s1.md",
        updatedAt: Date.now(),
        content: "# Row toggle style\n\n1. Add a `Switch` row to `SettingsPanel.svelte`.\n2. Move the label and hint into one recipe.\n3. Check it at phone width.\n",
      },
    };
    local.openPlanSessionId = "s1";
  }
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
    {
      id: "mc",
      role: "compaction",
      text: "## Goal\nTighten the settings layout so every row follows one recipe.\n\n## Done\n- Agreed on a `row(label, hint)` helper\n\n## Next\n- Rename the Subscriptions heading",
      toolCalls: [],
      streaming: false,
      createdAt: now - 120_000,
      compaction: { kind: "summary", tokensBefore: 402_000, tokensAfter: 3_100 },
    },
    { id: "m3", role: "user", text: "Rename the Subscriptions heading too.", toolCalls: [], streaming: false, createdAt: now - 60_000 },
    // A native (cli_claude) turn: text, then Read, then Edit (with its diff),
    // then text, the same shape a reload rebuilds from session history.
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
  msgs[4].text += " Renamed — one more place in the hint text below.";
  msgs[4].toolCalls[2].textOffset = msgs[4].text.length;
  // s2 (?chat=s2): an API-provider turn using the new tools: two subagents working in parallel
  // (one still going, one reported back), a dev server in an agent terminal, and a browser check.
  const call = (toolCallId: string, name: string, args: Record<string, unknown>, extra: Partial<ChatMessage["toolCalls"][number]> = {}) =>
    ({ toolCallId, name, args, status: "done" as const, output: "", textOffset: 48, ...extra });
  const s2: ChatMessage[] = [
    { id: "a1", role: "user", text: "The terminal flickers on resize. Find out why, and check the demo page still renders.", toolCalls: [], streaming: false, createdAt: now - 300_000 },
    {
      id: "a2",
      role: "assistant",
      text: "I'll split the investigation and start the demo.",
      streaming: true,
      createdAt: now - 290_000,
      toolCalls: [
        call("sa1", "subagent", { description: "Trace the resize path", prompt: "Follow a window resize from ResizeObserver to xterm's fit addon in src/lib/components/TerminalView.svelte. Report every place that forces a reflow, with file:line." }, {
          status: "running",
          subagent: {
            text: "",
            calls: [
              call("sa1-1", "file_read", { path: "src/lib/components/TerminalView.svelte" }, { output: "…" }),
              call("sa1-2", "file_read", { path: "src/lib/terminalBus.ts" }, { output: "…" }),
              call("sa1-3", "bash", { command: "rg -n fit( src" }, { status: "requested" }),
            ],
          },
        }),
        call("sa2", "subagent", { description: "Check xterm addon versions", prompt: "Compare @xterm/addon-fit and @xterm/xterm versions in package.json against their changelogs for resize fixes." }, {
          output: "**@xterm/addon-fit 0.11.0** debounces nothing itself; the flicker fix landed in **xterm 6.0.1** (`refresh` no longer clears the viewport on resize).\n\n- package.json pins `^6.0.0`, lockfile has 6.0.0\n- Upgrading to 6.0.1 is a patch bump, no API changes",
          subagent: { text: "", calls: [call("sa2-1", "file_read", { path: "package.json" }, { output: "…" }), call("sa2-2", "web_fetch", { url: "https://github.com/xtermjs/xterm.js/releases" }, { output: "…" })] },
        }),
        call("tt1", "terminal_start", { command: "npm run dev", name: "dev server", wait_ms: 5000 }, { output: "terminal agent-1 (dev server): command still running\n  VITE v8.0.16  ready in 412 ms\n  ➜  Local:   http://127.0.0.1:1420/" }),
        call("br1", "browser", { action: "navigate", url: "http://localhost:1420/demo" }, { output: "URL: http://localhost:1420/demo\nTitle: Demo" }),
      ],
    },
  ];
  local.messagesBySession = { s1: msgs, s2, s3: [], s4: [] };
  local.contextBySession = { s1: { estimatedTokens: 86_000, maxTokens: 200_000, windowTokens: 200_000, budgetTokens: 64_000, source: "provider" } };
  local.spendBySession = { s1: { sessionTotalUsd: 1.37, projectTotalUsd: 12.9 } };
  local.terminalById.t5 = { ...term("t5", "s2", "bash", "running", "/home/aveline/Projects/yoake/yoake-gui"), name: "dev server", agent: true, busy: true, command: "npm run dev" };
  local.terminalsBySession.s2 = ["t2", "t5"];
  if (new URLSearchParams(location.search).get("chat") === "s2") {
    local.currentSessionId = "s2";
    local.projectBySession.s2 = local.currentProjectPath!;
    local.chatSidebarOpenBySession.s2 = true;
    local.chatSidebarPanelBySession.s2 = "subagents";
    local.terminalOpenBySession.s2 = true;
    // &ask: the running subagent is waiting on approval for its bash call.
    if (new URLSearchParams(location.search).has("ask")) {
      s2[1].toolCalls[0].subagent!.calls[2].status = "awaiting_permission";
      local.pendingAsks = [
        { kind: "permission", sessionId: "s2", projectPath: local.currentProjectPath!, turnId: "turn-9.sa1", toolCallId: "sa1-3", toolName: "bash", description: "bash on rg", requiresAsk: true, cacheKey: "" },
      ];
    }
  }
  // ?live: chats elsewhere that want you, for the header's live tabs. =many adds enough to overflow,
  // =none leaves nothing live.
  const live = new URLSearchParams(location.search).get("live");
  if (live === "none") {
    for (const srv of [local, remote]) {
      srv.activeTurnBySession = {};
      srv.finishedSessions = {};
      srv.pendingAsks = [];
    }
  } else if (live !== null) {
    if (live === "many") {
      // Named, listed chats rather than bare ids, so the tabs and cards have titles to show.
      const titles = ["Migrate settings to tabs", "Audit bash sandbox rules", "Write release notes", "Profile message list scroll", "Fix flaky terminal test", "Refactor ipc handlers"];
      const gui = "/home/aveline/Projects/yoake/yoake-gui";
      local.sessionsByProject[gui] = [...local.sessionsByProject[gui], ...titles.map((t, i) => session(`g${i + 1}`, t, 4 + i * 3))];
      for (let i = 1; i <= titles.length; i++) local.projectBySession[`g${i}`] = gui;
    }
    local.activeTurnBySession = { s2: "turn-2", ...(live === "many" ? Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`g${i}`, `turn-g${i}`])) : {}) };
    local.finishedSessions = { s3: true };
    local.pendingAsks = [
      { kind: "permission", sessionId: "s4", projectPath: local.currentProjectPath!, turnId: "turn-4", toolCallId: "a4", toolName: "bash", description: "bash on rg", requiresAsk: true, cacheKey: "" },
    ];
  }
  // ?split: the saved pairing is open, with s2 linked beside the main chat.
  if (new URLSearchParams(location.search).has("split")) {
    local.projectBySession.s2 = "/home/aveline/Projects/yoake/yoake-gui";
    local.sidebarSessionId = "s2";
    local.sessionsByProject["/home/aveline/Projects/yoake/yoake-gui"] = local.sessionsByProject["/home/aveline/Projects/yoake/yoake-gui"].map((x) =>
      x.sessionId === "s1" ? { ...x, linkedSessionId: "s2" } : x,
    );
    app.rightSidebarCollapsed = false;
  }
  // ?empty: a fresh chat in the project, for the feed under the composer. ?empty=chat: a
  // project-less one, with a couple of chats of its own to pick up.
  const emptyMode = new URLSearchParams(location.search).get("empty");
  if (emptyMode !== null) {
    if (emptyMode === "chat") {
      local.sessionsByProject["@chat"] = [
        session("c1", "Plot the CSV by month", 90, { projectPath: "/state/chats/c1" }),
        session("c2", "Rename photos by date", 60 * 30, { projectPath: "/state/chats/c2" }),
      ];
      for (const id of ["c1", "c2"]) local.projectBySession[id] = "@chat";
      local.messagesBySession.c1 = [
        { id: "u", role: "user", text: "Plot the CSV by month", toolCalls: [], streaming: false, createdAt: now - 6e6 },
        { id: "a", role: "assistant", text: "I grouped the rows by month and saved the chart as sales.png; March is the outlier.", toolCalls: [{ toolCallId: "t", name: "file_write", args: {}, status: "done", diffs: [{ filePath: "sales.png", unified: "", hunks: [] }, { filePath: "plot.py", unified: "", hunks: [] }] }], streaming: false, createdAt: now - 5e6 },
      ];
      local.newSessionInProject("@chat");
    } else {
      local.newSessionInProject("/home/aveline/Projects/yoake/yoake-gui");
    }
  }
  app.activeConnectionId = "local";

  // ?flat: flat main area. ?open=model|mode: open that composer picker.
  // &q=...: type into the model picker's search. For headless screenshots.
  const params = new URLSearchParams(location.search);
  if (params.has("flat")) app.settings.mainArea = "flat";
  onMount(() => {
    app.applySettings();
    if (params.get("ext")) app.openExtensions();
    // ?toasts: a burst of notifications every few seconds (a stack for s2, singles for the rest).
    if (params.has("toasts")) {
      let n = 0;
      const fire = (sessionId: string, level: "info" | "success" | "warning" | "error", title: string, body: string) =>
        app.toast("local", { id: `t${++n}`, level, kind: "turn_completed", title, body, sessionId, createdAt: new Date().toISOString() });
      const burst = () => {
        fire("s2", "success", "Fix terminal resize flicker finished", "3 files changed");
        setTimeout(() => fire("s2", "warning", "Needs approval: run npm test", "bash wants to run a command"), 600);
        setTimeout(() => fire("s2", "info", "Tests passed", "42 passed, 0 failed"), 1200);
        setTimeout(() => fire("s4", "error", "Persist remote tokens failed", "provider returned 529 overloaded"), 1800);
        setTimeout(() => app.toastAction("local", "Archived chat", { label: "Undo", run: () => {} }), 2400);
      };
      burst();
      setInterval(burst, 14_000);
    }
    const open = params.get("open");
    if (!open) return;
    setTimeout(() => {
      const triggers = document.querySelectorAll<HTMLElement>(".toolbar .picker-trigger");
      const t = triggers[open === "mode" ? triggers.length - 1 : open === "effort" ? triggers.length - 2 : 0];
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
