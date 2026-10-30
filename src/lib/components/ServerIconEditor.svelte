<script lang="ts">
  // Click a server's avatar to pick its icon and colour; the choice is stored on the server,
  // so every device sees the same one.
  import { Popover } from "bits-ui";
  import { app, type ConnectionId } from "../state.svelte";
  import { setServerIcon } from "../ipc";
  import ServerAvatar from "./ServerAvatar.svelte";
  import { tip } from "../tooltip.svelte";
  import Icon from "./Icon.svelte";
  import { SERVER_ICONS, SERVER_ICON_NAMES, serverIconMatches } from "../serverIcons";

  let { connectionId, size = 22 }: { connectionId: ConnectionId; size?: number } = $props();
  const server = $derived(app.servers[connectionId]);
  const icon = $derived(server?.serverIcon ?? {});
  const HUES = Array.from({ length: 12 }, (_, i) => i * 30);

  let query = $state("");
  const shown = $derived(SERVER_ICON_NAMES.filter((n) => serverIconMatches(n, query.trim().toLowerCase())));
  const save = (next: { name?: string; hue?: number }) => setServerIcon(connectionId, next);
</script>

{#if server}
  <Popover.Root>
    <Popover.Trigger class="server-icon-trigger" {@attach tip("Change icon")}>
      <ServerAvatar name={server.label} seed={server.serverId} {size} />
      <!-- Says "this is editable" without a label: the avatar alone reads as a static picture. -->
      <span class="sit-badge"><Icon name="pencil" size={10} /></span>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content class="sb-panel server-icon-panel above-modal" side="bottom" align="start" sideOffset={6}>
        <input class="sip-search" type="text" placeholder="Search icons…" bind:value={query} />
        <div class="sip-icons">
          {#each shown as n (n)}
            <button
              type="button"
              class="sip-icon"
              class:on={icon.name === n}
              aria-label={n.replaceAll("-", " ")}
              {@attach tip(n.replaceAll("-", " "))}
              onclick={() => save({ ...icon, name: n })}
            >
              {@html SERVER_ICONS[n]}
            </button>
          {:else}
            <span class="sip-empty">No icons match.</span>
          {/each}
        </div>
        <div class="sip-hues">
          {#each HUES as h (h)}
            <button
              type="button"
              class="sip-hue"
              class:on={icon.hue === h}
              style="background: hsl({h} 60% 48%)"
              aria-label="Hue {h}"
              onclick={() => save({ ...icon, hue: h })}
            ></button>
          {/each}
        </div>
        <button type="button" class="sip-reset" onclick={() => save({})}>Reset to initials</button>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  :global(.server-icon-trigger) {
    position: relative;
    display: inline-flex;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: 28%;
  }
  .sit-badge {
    position: absolute;
    right: -5px;
    bottom: -5px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--float-bg, var(--wash-1));
    border: 1px solid var(--panel-border);
    color: var(--text-dim);
    transition: color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  :global(.server-icon-trigger:hover) .sit-badge,
  :global(.server-icon-trigger[data-state="open"]) .sit-badge {
    color: var(--text);
  }
  :global(.server-icon-panel) {
    display: grid;
    gap: 0.6rem;
    padding: 0.7rem;
    width: 15rem;
  }
  .sip-search {
    height: 1.8rem;
    padding: 0 0.5rem;
    background: var(--wash-1);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: var(--text-label-size);
  }
  .sip-icons {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0.2rem;
    max-height: 9.5rem;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--panel-border) transparent;
  }
  .sip-icon {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-dim);
    cursor: pointer;
  }
  .sip-icon :global(svg) {
    width: 1.1rem;
    height: 1.1rem;
  }
  .sip-icon:hover {
    background: var(--wash-1);
    color: var(--text);
  }
  .sip-icon.on {
    background: var(--wash-2, var(--wash-1));
    color: var(--text);
  }
  .sip-empty {
    grid-column: 1 / -1;
    padding: 0.5rem;
    text-align: center;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .sip-hues {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0.4rem;
  }
  .sip-hue {
    aspect-ratio: 1;
    border: 2px solid transparent;
    border-radius: 30%;
    cursor: pointer;
  }
  .sip-hue.on {
    border-color: var(--text);
  }
  .sip-reset {
    justify-self: end;
    border: 0;
    background: none;
    color: var(--text-dim);
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  .sip-reset:hover {
    color: var(--text);
  }
</style>
