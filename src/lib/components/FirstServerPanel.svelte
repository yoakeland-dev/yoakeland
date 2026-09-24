<script lang="ts">
  // Shown in place of the chat panel whenever there's no active connection
  // (app.active is null), rather than an empty panel.
  import ConnectForm from "./ConnectForm.svelte";
</script>

<div class="wrap">
  <div class="card">
    <h1>Connect a server</h1>
    <p class="sub">
      Yoakeland runs as its own process — connect to one already running, or launch one locally.
    </p>
    <ConnectForm />
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
  }
  .card {
    width: min(28rem, 100%);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    padding: 1.7rem;
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
