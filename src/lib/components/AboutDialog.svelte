<script lang="ts">
  import SheetDialog from "./SheetDialog.svelte";
  import { Dialog } from "bits-ui";
  import { app } from "../state.svelte";
  import { fmtVersion } from "../serverVersion";
  import { buildInfo, isDesktop, openUrl, writeClipboard } from "../platform";
  import { WHATS_NEW } from "../whatsnew";
  import Icon from "./Icon.svelte";
  import Button from "./ui/Button.svelte";

  let { open = $bindable(false), onWhatsNew }: { open?: boolean; onWhatsNew?: () => void } = $props();

  const servers = $derived(Object.values(app.servers));
  const REPO = "https://github.com/yoakeland-dev";
  const client = isDesktop ? "Desktop client" : "Web client";

  let copied = $state(false);
  async function copyDetails() {
    const lines = [`yoakeland ${client.toLowerCase()} ${fmtVersion(__APP_VERSION__)}`];
    for (const s of servers) lines.push(`server ${s.label}: ${s.serverStatus?.version ? fmtVersion(s.serverStatus.version) : s.connectionStatus}`);
    for (const [k, v] of buildInfo) lines.push(`${k}: ${v}`);
    const text = lines.join("\n");
    await writeClipboard(text).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <SheetDialog class="dialog-content about">
      <Dialog.Close class="dialog-close about-close"><Icon name="xmark" size={14} /></Dialog.Close>
      <div class="mark"><img class="logo" src="logo.png" alt="" /></div>
      <Dialog.Title class="about-title">yoakeland</Dialog.Title>
      <Dialog.Description class="about-version">{client} {fmtVersion(__APP_VERSION__)}</Dialog.Description>
      {#if app.appUpdate}
        <p class="app-update">
          v{app.appUpdate.version} is available.
          {#if app.appUpdate.install === "download"}
            <button onclick={() => openUrl(app.appUpdate!.url)}>Download</button>
          {:else}
            Update it with your package manager.
          {/if}
        </p>
      {/if}
      <div class="card">
        {#if servers.length}
          <ul>
            {#each servers as s (s.connectionId)}
              <li>
                <span class="dot" class:online={s.connectionStatus === "connected"}></span>
                <span class="name">{s.label}</span>
                {#if s.outdated}<span class="old">update available</span>{/if}
                <span class="ver">{s.serverStatus?.version ? fmtVersion(s.serverStatus.version) : s.connectionStatus}</span>
              </li>
            {/each}
          </ul>
        {/if}
        <dl>
          {#each buildInfo as [k, v] (k)}
            <dt>{k}</dt><dd title={v}>{v}</dd>
          {/each}
        </dl>
      </div>
      <div class="actions">
        {#if onWhatsNew && WHATS_NEW[__APP_VERSION__]}
          <Button size="sm" variant="primary" onclick={() => { open = false; onWhatsNew(); }}>What's new</Button>
        {/if}
        <Button size="sm" onclick={copyDetails}>{copied ? "Copied" : "Copy details"}</Button>
      </div>
      <div class="links">
        <button onclick={() => openUrl(`${REPO}/yoakeland/releases`)}>Releases</button>
        <span aria-hidden="true">·</span>
        <button onclick={() => openUrl(REPO)}>GitHub</button>
      </div>
    </SheetDialog>
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
    box-shadow: var(--shadow-dialog);
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
    background: var(--wash-2);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  :global(.dialog-content.about) {
    width: min(23rem, 92vw);
    align-items: center;
    text-align: center;
    padding: 1.8rem 1.2rem 1.2rem;
  }
  :global(.about-close) {
    position: absolute;
    top: 0.57rem;
    right: 0.57rem;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 5.2rem;
    height: 5.2rem;
    margin-bottom: 0.8rem;
    border-radius: 50%;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 28%, transparent), transparent);
  }
  .logo {
    width: 3.6rem;
    height: 3.6rem;
  }
  :global(.about-title) {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  :global(.about-version) {
    margin: 0.5rem 0 0;
    padding: 0.14rem 0.7rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    background: var(--wash-2);
    border: 1px solid var(--panel-border);
    border-radius: 999px;
  }
  .card {
    align-self: stretch;
    margin-top: 1.3rem;
    padding: 0.35rem 0.85rem;
    background: var(--wash-2);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-md);
    font-size: var(--text-label-size);
    text-align: left;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0.35rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  ul + dl {
    border-top: 1px solid var(--panel-border);
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .old {
    color: var(--accent-ink);
  }
  .ver {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 1rem;
    margin: 0;
    padding: 0.55rem 0;
  }
  dt {
    color: var(--text-dim);
  }
  dd {
    margin: 0;
    min-width: 0;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    justify-content: center;
    gap: 0.43rem;
    margin-top: 1.1rem;
  }
  .links {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.8rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .links button {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .links button:hover {
    color: var(--text);
  }
  .app-update {
    margin: 0.5rem 0 0;
    font-size: var(--text-label-size);
    color: var(--accent-ink);
  }
  .app-update button {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
