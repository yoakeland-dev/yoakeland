<script lang="ts" module>
  import type { TerminalTab } from "../types";

  // Same colors as ChatRow's status icons: info spinning while busy, success/danger for how the
  // last command ended, dim when there's nothing to say.
  export function terminalState(t: TerminalTab) {
    if (t.status === "error") return { icon: "warning", tone: "danger", text: "terminal error" } as const;
    if (t.status === "exited") return { icon: "player-stop", tone: "dim", text: `exited (${t.exitCode ?? 0})` } as const;
    if (t.status === "starting") return { icon: "loader-2", tone: "dim", spin: true, text: "starting…" } as const;
    if (t.busy) return { icon: "loader-2", tone: "info", spin: true, text: t.command ? `running ${t.command}` : "running" } as const;
    if (t.lastExit) return { icon: "circle-x", tone: "danger", text: `last command failed (${t.lastExit})` } as const;
    if (t.lastExit === 0) return { icon: "circle-check", tone: "success", text: "idle" } as const;
    return { icon: "terminal-2", tone: "dim", text: "idle" } as const;
  }
</script>

<script lang="ts">
  import Icon from "./Icon.svelte";

  let { tab, size = 13 }: { tab: TerminalTab; size?: number } = $props();
  const st = $derived(terminalState(tab));
</script>

<span class="tsi {st.tone}" class:spin={"spin" in st && st.spin} title={st.text} aria-label={st.text}>
  <Icon name={st.icon} {size} />
</span>

<style>
  .tsi {
    flex-shrink: 0;
    display: inline-flex;
  }
  .dim {
    color: var(--text-dim);
  }
  .info {
    color: var(--info);
  }
  .success {
    color: var(--success);
  }
  .danger {
    color: var(--danger);
  }
</style>
