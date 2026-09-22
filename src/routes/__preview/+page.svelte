<script lang="ts">
  import MessageBubble from "$lib/components/MessageBubble.svelte";
  import type { ChatMessage } from "$lib/types";

  const long = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: some sample message content to force overflow.`).join("\n\n");
  const short = "Just a short message.";
  const medium = "This is a medium length message that spans a couple of lines to see where the collapse threshold kicks in and whether it clips text that should be visible.";

  function msg(id: string, text: string, author: string): ChatMessage {
    return { id, role: "user", text, toolCalls: [], streaming: false, createdAt: Date.now(), author };
  }
</script>

<div style="max-width: 500px; margin: 40px auto; background:#1a1a1a; padding: 20px; display:flex; flex-direction:column; gap:16px;">
  <MessageBubble message={msg("m1", short, "Short")} sessionId="preview" />
  <MessageBubble message={msg("m2", medium, "Medium")} sessionId="preview" />
  <MessageBubble message={msg("m3", long, "Long")} sessionId="preview" />
</div>
