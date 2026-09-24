<script lang="ts">
  import { onMount } from "svelte";
  import MessageBubble from "$lib/components/MessageBubble.svelte";
  import TerminalPanel from "$lib/components/TerminalPanel.svelte";
  import type { ChatMessage } from "$lib/types";
  import { app, ServerState } from "$lib/state.svelte";
  import { publishTerminalSnapshot } from "$lib/terminalBus";

  const long = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: some sample message content to force overflow.`).join("\n\n");
  const short = "Just a short message.";
  const medium = "This is a medium length message that spans a couple of lines to see where the collapse threshold kicks in and whether it clips text that should be visible.";

  function msg(id: string, text: string, author: string): ChatMessage {
    return { id, role: "user", text, toolCalls: [], streaming: false, createdAt: Date.now(), author };
  }

  // Dev only: a fake ServerState with two terminal tabs, output published by hand.
  const previewSessionId = "preview-terminal";
  const previewConnectionId = "preview-conn";
  const server = new ServerState(previewConnectionId, app, { mode: "local", socketPath: "", binPath: "" });
  app.servers[previewConnectionId] = server;
  app.activeConnectionId = previewConnectionId;
  server.ensureSession(previewSessionId);
  server.terminalOpenBySession[previewSessionId] = true;

  function seedTab(terminalId: string, label: string) {
    server.terminalById = {
      ...server.terminalById,
      [terminalId]: { terminalId, sessionId: previewSessionId, cols: 80, rows: 24, status: "running", label, sequence: 0 },
    };
    server.terminalsBySession[previewSessionId] = [...(server.terminalsBySession[previewSessionId] ?? []), terminalId];
  }
  seedTab("term-1", "bash");
  seedTab("term-2", "zsh");
  server.terminalsListedBySession[previewSessionId] = true;
  server.activeTerminalBySession[previewSessionId] = "term-1";

  const ANSI_SAMPLE =
    "\x1b[1;32m➜\x1b[0m  \x1b[36m~/yoake\x1b[0m \x1b[33mgit:(\x1b[31mmain\x1b[33m)\x1b[0m $ ls -la\r\n" +
    "\x1b[1;34mdrwxr-xr-x\x1b[0m  src\r\n" +
    "\x1b[1;34mdrwxr-xr-x\x1b[0m  src-tauri\r\n" +
    "\x1b[32m-rw-r--r--\x1b[0m  package.json\r\n" +
    "\x1b[1;31merror\x1b[0m: something went wrong\r\n" +
    "\x1b[1;33mwarning\x1b[0m: something to note\r\n" +
    "\x1b[36mcyan text\x1b[0m and \x1b[35mmagenta text\x1b[0m\r\n$ ";

  onMount(() => {
    // TerminalView subscribes to the bus one animation frame after mount
    // (see its own onMount) — give it a moment before publishing.
    setTimeout(() => {
      publishTerminalSnapshot("term-1", new TextEncoder().encode(ANSI_SAMPLE));
      publishTerminalSnapshot("term-2", new TextEncoder().encode("\x1b[35msecond tab, different shell\x1b[0m\r\n$ "));
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
