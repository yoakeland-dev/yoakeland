<script lang="ts">
  // Where a web sign-in (MCP server, OpenRouter) comes back to. It hands the answer to the app tab
  // that started it (webSignIn.ts) and has nothing else to do.
  import { onMount } from "svelte";
  import { OAUTH_CHANNEL } from "../../lib/webSignIn";

  let message = $state("Finishing sign-in…");

  onMount(() => {
    const q = new URLSearchParams(location.search);
    history.replaceState(null, "", location.pathname); // don't leave the code in history
    // A provider that appends "?code=…" to a URL that already has a query leaves it inside `n`.
    const [n, tail] = (q.get("n") ?? "").split("?");
    const code = q.get("code") ?? (tail ? new URLSearchParams(tail).get("code") : null);
    const error = q.get("error_description") || q.get("error");
    if (!code && !error) {
      message = "Nothing to finish here. Start the sign-in from yoake.";
      return;
    }
    new BroadcastChannel(OAUTH_CHANNEL).postMessage({ code, error, n: n || undefined, state: q.get("state") ?? undefined, iss: q.get("iss") ?? undefined });
    message = error ? "Sign-in was refused. You can close this tab and go back to yoake." : "Signed in. You can close this tab and go back to yoake.";
    window.close();
  });
</script>

<svelte:head><title>yoake</title></svelte:head>

<main>{message}</main>

<style>
  main {
    max-width: 24rem;
    margin: 4rem auto;
    padding: 0 1rem;
    font: 16px system-ui, sans-serif;
    color: var(--text);
  }
</style>
