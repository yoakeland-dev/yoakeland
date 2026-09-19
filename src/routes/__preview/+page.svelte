<script lang="ts">
  import MessageBubble from "$lib/components/MessageBubble.svelte";

  const long = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: some sample message content to force overflow.`).join("\n\n");
  const short = "Just a short message.";
  const medium = "This is a medium length message that spans a couple of lines to see where the collapse threshold kicks in and whether it clips text that should be visible.";
</script>

<div style="max-width: 500px; margin: 40px auto; background:#1a1a1a; padding: 20px; display:flex; flex-direction:column; gap:16px;">
  <MessageBubble text={short} author="Short" />
  <MessageBubble text={medium} author="Medium" />
  <MessageBubble text={long} author="Long" />
</div>
