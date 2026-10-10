<script lang="ts">
  import "../app.css";
  // After app.css: its phone overrides of the :root tokens must come later in the cascade.
  import "../lib/mobile.css";
  let { children } = $props();
</script>

{@render children()}
