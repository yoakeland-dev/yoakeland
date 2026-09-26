<script lang="ts">
  import { onMount } from "svelte";
  import MessageBubble from "$lib/components/MessageBubble.svelte";
  import TerminalPanel from "$lib/components/TerminalPanel.svelte";
  import type { ChatMessage } from "$lib/types";
  import { app, ServerState } from "$lib/state.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";

  const long = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: some sample message content to force overflow.`).join("\n\n");
  const short = "Just a short message.";
  const medium = "This is a medium length message that spans a couple of lines to see where the collapse threshold kicks in and whether it clips text that should be visible.";

  function msg(id: string, text: string, author: string): ChatMessage {
    return { id, role: "user", text, toolCalls: [], streaming: false, createdAt: Date.now(), author };
  }

  // Dev only: a fake ServerState whose terminals are driven through the real event handler,
  // so the OSC 633 scanning (busy/exit/cwd/title) is what's on screen.
  const previewSessionId = "preview-terminal";
  const previewConnectionId = "preview-conn";
  const server = new ServerState(previewConnectionId, app, { mode: "local", socketPath: "", binPath: "" });
  app.servers[previewConnectionId] = server;
  app.activeConnectionId = previewConnectionId;
  server.ensureSession(previewSessionId);
  server.currentSessionId = previewSessionId;
  server.messagesBySession[previewSessionId] = [msg("seed", "hi", "me")];
  server.sessionsByProject["/home/me/yoake"] = [
    { sessionId: previewSessionId, updatedAt: new Date().toISOString(), messageCount: 1, title: "Terminal redesign" },
  ];
  server.terminalOpenBySession[previewSessionId] = true;

  const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const osc = (s: string) => `\x1b]633;${s}\x07`;
  const prompt = (cwd: string) => `${osc("D;0")}${osc(`P;Cwd=${cwd}`)}\x1b[1;32m➜\x1b[0m  \x1b[36m${cwd.replace("/home/me", "~")}\x1b[0m $ `;
  const TERMS: [string, string, string][] = [
    ["term-1", "bash", `${prompt("/home/me/yoake")}ls\r\n${osc("C")}\x1b[1;34msrc\x1b[0m  package.json\r\n${osc("D;0")}${prompt("/home/me/yoake")}`],
    ["term-2", "zsh", `${prompt("/home/me/yoake/server")}${osc("E;npm run dev")}${osc("C")}npm run dev\r\n\x1b[2m> vite dev\x1b[0m\r\n  ready in 312 ms\r\n`],
    ["term-3", "bash", `${prompt("/home/me/yoake")}${osc("C")}cargo test\r\n\x1b[1;31merror\x1b[0m: 2 tests failed\r\n${osc("D;101")}$ `],
  ];
  server.handleEvent({
    type: "terminal_list",
    data: { sessionId: previewSessionId, terminals: TERMS.map(([terminalId, label]) => ({ terminalId, label, status: "running" })) },
  });

  onMount(() => {
    // TerminalView subscribes to the bus one animation frame after mount
    // (see its own onMount), so give it a moment before publishing.
    setTimeout(() => {
      for (const [terminalId, label, history] of TERMS)
        server.handleEvent({
          type: "terminal_snapshot",
          data: { terminalId, label, status: "running", cols: 80, rows: 24, sequence: 1, history: b64(history), sandboxTier: "bubblewrap" },
        });
      server.handleEvent({ type: "terminal_output", data: { terminalId: "term-1", sequence: 2, data: b64("\x1b]0;vim README.md\x07") } });
    }, 300);
  });
</script>

<div style="max-width: 500px; margin: 40px auto; background:#1a1a1a; padding: 20px; display:flex; flex-direction:column; gap:16px;">
  <MessageBubble message={msg("m1", short, "Short")} sessionId="preview" />
  <MessageBubble message={msg("m2", medium, "Medium")} sessionId="preview" />
  <MessageBubble message={msg("m3", long, "Long")} sessionId="preview" />
</div>

<div style="height: 480px; margin: 40px auto; max-width: 900px; display:flex; flex-direction:column; border: 1px solid #333;">
  <div style="flex:1"></div>
  <TerminalPanel sessionId={previewSessionId} />
</div>

<div style="max-width: 900px; margin: 0 auto 40px;"><StatusBar /></div>
