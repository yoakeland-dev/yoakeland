<script lang="ts">
  // Shown in place of the chat panel whenever there's no active connection
  // (app.active is null), rather than an empty panel.
  import { app } from "../state.svelte";
  import Button from "./ui/Button.svelte";
  import Icon from "./Icon.svelte";
</script>

<div class="wrap">
  <div class="card">
    <h1>No server connected</h1>
    <p class="sub">Yoakeland runs as its own process. Add a server to get started.</p>
    <Button type="button" onclick={() => app.openAddServer()}>
      <Icon name="plus" size={14} />
      Add server
    </Button>
  </div>
</div>

<style>
  .wrap {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .card {
    width: min(28rem, 100%);
    text-align: center;
  }
  h1 {
    margin: 0 0 var(--space-half);
    font-size: var(--text-title-size);
    font-weight: var(--text-title-weight);
    color: var(--text);
  }
  .sub {
    margin: 0 0 1.29rem;
    color: var(--text-dim);
    font-size: var(--text-body-size);
  }
</style>
