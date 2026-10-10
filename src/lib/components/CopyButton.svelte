<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import Icon from "./Icon.svelte";

  let { text, label = "Copy" }: { text: string; label?: string } = $props();
  let done = $state(false);

  function copy() {
    void navigator.clipboard?.writeText(text);
    done = true;
    setTimeout(() => (done = false), 1200);
  }
</script>

<button class="action" onclick={copy} aria-label={label} {@attach tip(done ? "Copied" : label)}>
  <Icon name={done ? "check" : "copy"} size={12} />
</button>

<style>
  .action {
    display: inline-flex;
    align-items: center;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
  }
  .action:hover {
    color: var(--text);
  }

  @media (max-width: 700px) {
    .action {
      padding: 0.55rem 0.45rem;
      margin: -0.55rem -0.2rem;
    }
  }
</style>
