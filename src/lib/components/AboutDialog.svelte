<script lang="ts">
  import { Dialog } from "bits-ui";
  import { app } from "../state.svelte";
  import Icon from "./Icon.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const servers = $derived(Object.values(app.servers));
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <Dialog.Content class="dialog-content about">
      <Dialog.Close class="dialog-close about-close"><Icon name="xmark" size={14} /></Dialog.Close>
      <img class="logo" src="logo.png" alt="" />
      <Dialog.Title class="about-title">yoakeland</Dialog.Title>
      <Dialog.Description class="about-version">Desktop client v{__APP_VERSION__}</Dialog.Description>
      {#if servers.length}
        <ul>
          {#each servers as s (s.connectionId)}
            <li>
              <span class="dot" class:online={s.connectionStatus === "connected"}></span>
              <span class="name">{s.label}</span>
              <span class="ver">{s.serverStatus?.version ? `v${s.serverStatus.version}` : s.connectionStatus}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  /* Dims only: the dialog card above it is what frosts, so the blur is the
     card's own and the background behind it stays readable. */
  :global(.dialog-overlay) {
    position: fixed;
    inset: 0;
    background: rgba(6, 7, 11, 0.5);
    z-index: var(--z-overlay-backdrop);
    animation: scrimIn var(--dialog-enter-duration) ease-out;
  }
  :global(.dialog-overlay[data-state="closed"]) {
    animation: scrimOut var(--dialog-exit-duration) ease-in;
  }
  :global(.dialog-content) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(31.43rem, 92vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    /* A floating surface, see the --float-* tokens in app.css. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
    padding: var(--space-2);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    z-index: var(--z-overlay-content);
    animation: dialogIn var(--dialog-enter-duration) ease-out;
  }
  :global(.dialog-content[data-state="closed"]) {
    animation: dialogOut var(--dialog-exit-duration) ease-in;
  }
  :global(.dialog-close) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.71rem;
    height: 1.71rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  :global(.dialog-content.about) {
    width: min(20rem, 92vw);
    align-items: center;
    text-align: center;
    padding: var(--space-3, 1.5rem) var(--space-2);
  }
  :global(.about-close) {
    position: absolute;
    top: 0.57rem;
    right: 0.57rem;
  }
  .logo {
    width: 3.5rem;
    height: 3.5rem;
    margin-bottom: 0.71rem;
  }
  :global(.about-title) {
    margin: 0;
    font-size: var(--text-title-size);
    font-weight: 600;
  }
  :global(.about-version) {
    margin: 0.21rem 0 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  ul {
    list-style: none;
    align-self: stretch;
    margin: 1.14rem 0 0;
    padding: 0.57rem 0 0;
    border-top: 1px solid var(--panel-border);
    display: flex;
    flex-direction: column;
    gap: 0.29rem;
    font-size: var(--text-label-size);
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.14rem 0.29rem;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-dim);
    flex-shrink: 0;
  }
  .dot.online {
    background: var(--success);
  }
  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ver {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
</style>
