<script lang="ts">
  // The title cluster shared by the full pages and the settings dialog: `server / Title`, where the
  // server is a picker when there are several, a plain label when there is one, or an icon when the
  // page is scoped to nothing in particular ("All servers"). `island` is the chrome card on the
  // full pages; `page` is the bigger title of the settings dialog.
  import type { Snippet } from "svelte";
  import Dropdown, { type DropdownItem } from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  let {
    variant = "island",
    icon,
    items = [],
    value,
    onchange,
    server,
    allIcon = "server",
    triggerTitle = "Which server to show",
    sub,
    children,
  }: {
    variant?: "island" | "page";
    /** Leading icon of the page (island only). */
    icon?: string;
    /** The servers to pick from; fewer than two and it is just a label. */
    items?: DropdownItem[];
    value?: string;
    onchange?: (v: string | undefined) => void;
    /** The server shown, for its avatar. None = scoped to every server (shows `allIcon`). */
    server?: { label: string; serverId?: string | null } | null;
    allIcon?: string;
    triggerTitle?: string;
    /** A second picker after the server (a project), shown when it has more than one choice. */
    sub?: { items: DropdownItem[]; value?: string; onchange: (v: string | undefined) => void; icon?: string; title?: string; searchable?: boolean };
    children: Snippet;
  } = $props();

  const px = $derived(variant === "page" ? 22 : 18);
  const pick = $derived(items.length > 1);
  const scoped = $derived(pick || !!server);
</script>

<svelte:element this={variant === "island" ? "h1" : "div"} class="scope-title {variant}" class:chrome-surface={variant === "island"} style="--av: {px}px">
  {#if variant === "island" && icon}<Icon name={icon as any} size={15} />{/if}
  {#if pick}
    <Dropdown {items} bind:value={() => value, (v) => onchange?.(v)} {triggerTitle} triggerClass="scope-pick" triggerIcon={server ? undefined : allIcon} triggerLead={server ? lead : undefined} contentClass="above-modal" />
  {:else if server}
    <span class="one">{@render lead()}{server.label}</span>
  {/if}
  {#if scoped}<span class="sep">/</span>{/if}
  {#if sub && sub.items.length > 1}
    <Dropdown items={sub.items} bind:value={() => sub.value, (v) => sub.onchange(v)} triggerTitle={sub.title} triggerClass="scope-pick" triggerIcon={sub.icon ?? "folder"} searchable={sub.searchable} searchPlaceholder="Search projects…" contentClass="above-modal" />
    <span class="sep">/</span>
  {/if}
  {@render children()}
</svelte:element>

{#snippet lead()}
  {#if server}<ServerAvatar name={server.label} seed={server.serverId} size={px} />{/if}
{/snippet}

<style>
  .scope-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    margin: 0;
    font-size: var(--text-body-size);
    font-weight: 600;
  }
  .scope-title.island {
    box-sizing: border-box;
    height: var(--chrome-h);
    padding: 0 calc(var(--chrome-pad) + var(--space-1));
    margin-block: calc((var(--header-line) - var(--chrome-h)) / 2);
  }
  .scope-title.page {
    font-size: 1.07rem;
    font-weight: var(--text-title-weight);
  }
  .sep,
  .one {
    color: var(--text-dim);
  }
  .one {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    white-space: nowrap;
  }
  /* Same size and weight as the title it leads into, dimmed so the title stays the focus. No box on
     hover: the colour lift and the icon turning into a chevron say it is a picker, and without
     padding the gaps either side of the separator are just the flex gap. */
  .scope-title :global(.dropdown-trigger.scope-pick) {
    height: auto;
    min-width: 0;
    gap: 0.5rem;
    padding: 0;
    border: 0;
    background: none;
    font-size: inherit;
    font-weight: inherit;
    color: var(--text-dim);
  }
  .scope-title :global(.dropdown-trigger.scope-pick .dropdown-trigger-icon) {
    width: var(--av);
    height: var(--av);
  }
  .scope-title :global(.dropdown-trigger.scope-pick:hover),
  .scope-title :global(.dropdown-trigger.scope-pick:focus-visible),
  .scope-title :global(.dropdown-trigger.scope-pick[data-state="open"]) {
    background: none;
    border: 0;
    color: var(--text);
  }
</style>
