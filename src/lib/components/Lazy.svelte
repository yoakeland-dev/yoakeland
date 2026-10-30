<script lang="ts">
  // Keeps a heavy component out of the startup bundle: its chunk is fetched when the browser is
  // idle (or at once when `when` turns on) and the component mounts once `when` has been true.
  import type { Component } from "svelte";

  let {
    load,
    when = true,
    props = {},
  }: { load: () => Promise<{ default: Component<any> }>; when?: boolean; props?: Record<string, unknown> } = $props();

  let C = $state.raw<Component<any> | null>(null);
  let wanted = $state(false);
  let loading: Promise<void> | undefined;
  const start = () => (loading ??= load().then(
    (m) => void (C = m.default),
    () => void (loading = undefined), // offline web client: the next trigger retries
  ));

  $effect(() => {
    if (when) {
      wanted = true;
      start();
    }
  });
  $effect(() => {
    // Safari has no requestIdleCallback.
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(start);
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(start, 300);
    return () => clearTimeout(id);
  });
</script>

{#if C && wanted}<C {...props} />{/if}
