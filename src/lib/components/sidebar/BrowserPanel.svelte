<script lang="ts">
  // A small browser for previewing pages beside the chat, on Electron's <webview> (see
  // lockDownWebviews in electron/main.js for what a page may and may not do). The viewport can
  // be fit to the panel, forced to a device size (scaled down to fit), or held at an aspect ratio.
  import { isDesktop, openUrl } from "../../platform";
  import Icon from "../Icon.svelte";
  import Dropdown, { type DropdownItem } from "../Dropdown.svelte";
  import EmptyState from "./EmptyState.svelte";

  interface Webview extends HTMLElement {
    getURL(): string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    stop(): void;
    loadURL(url: string): Promise<void>;
    openDevTools(): void;
  }
  interface Tab {
    id: string;
    start: string; // the element's src; later navigation goes through loadURL, not this
    url: string;
    title: string;
    loading: boolean;
    canBack: boolean;
    canForward: boolean;
    error: string;
  }

  const newTab = (url = "about:blank"): Tab => ({
    id: crypto.randomUUID(),
    start: url,
    url,
    title: "New tab",
    loading: false,
    canBack: false,
    canForward: false,
    error: "",
  });

  let tabs = $state<Tab[]>([newTab()]);
  let activeId = $state(tabs[0].id);
  const active = $derived(tabs.find((t) => t.id === activeId) ?? tabs[0]);
  const views = new Map<string, Webview>();

  let address = $state("");
  let editing = $state(false);
  $effect(() => {
    if (!editing) address = active.url === "about:blank" ? "" : active.url;
  });

  /** Typed text to a URL: dev-server shorthands go to http://localhost, bare words to a search. */
  function toUrl(input: string): string {
    const s = input.trim();
    if (!s) return "about:blank";
    if (/^(https?:\/\/|about:)/i.test(s)) return s;
    if (/^\d{2,5}$/.test(s)) return `http://localhost:${s}`;
    if (/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|[\w-]+\.local)(:\d+)?(\/|$)/i.test(s)) return `http://${s}`;
    if (/^\S+\.\S+$/.test(s)) return `https://${s}`;
    return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
  }

  function go() {
    editing = false;
    const url = toUrl(address);
    active.error = "";
    void views.get(active.id)?.loadURL(url).catch(() => {});
  }

  function addTab() {
    const t = newTab();
    tabs.push(t);
    activeId = t.id;
  }

  function closeTab(id: string) {
    const i = tabs.findIndex((t) => t.id === id);
    tabs.splice(i, 1);
    views.delete(id);
    if (!tabs.length) tabs.push(newTab());
    if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)].id;
  }

  function wire(el: HTMLElement, tab: Tab) {
    const w = el as Webview;
    views.set(tab.id, w);
    const sync = () => {
      tab.url = w.getURL();
      tab.canBack = w.canGoBack();
      tab.canForward = w.canGoForward();
    };
    const handlers: Record<string, (e: any) => void> = {
      "did-navigate": sync,
      "did-navigate-in-page": sync,
      "page-title-updated": (e) => (tab.title = e.title),
      "did-start-loading": () => {
        tab.loading = true;
        tab.error = "";
      },
      "did-stop-loading": () => {
        tab.loading = false;
        sync();
      },
      // Guest pages are their own document, so app.css's thin scrollbar never reaches them;
      // fires on every navigation since a new document needs it again.
      "did-finish-load": () => {
        void w
          .insertCSS("html { scrollbar-width: thin; scrollbar-color: rgba(0, 0, 0, 0.35) transparent; overflow-x: hidden; }")
          .catch(() => {});
      },
      // -3 is an aborted load (a new navigation replaced it), not a failure.
      "did-fail-load": (e) => e.isMainFrame && e.errorCode !== -3 && (tab.error = `${e.errorDescription} (${e.validatedURL})`),
    };
    for (const [k, f] of Object.entries(handlers)) w.addEventListener(k, f);
    return {
      destroy() {
        for (const [k, f] of Object.entries(handlers)) w.removeEventListener(k, f);
      },
    };
  }

  // Viewport: "fit", "WxH" (scaled down to fit), "custom" (WxH from the inputs) or "W:H".
  let viewport = $state("fit");
  const VIEWPORTS: DropdownItem[] = [
    { value: "fit", label: "Fit" },
    { value: "390x844", label: "Phone · 390×844", group: "Size" },
    { value: "820x1180", label: "Tablet · 820×1180", group: "Size" },
    { value: "1280x800", label: "Laptop · 1280×800", group: "Size" },
    { value: "1920x1080", label: "Desktop · 1920×1080", group: "Size" },
    { value: "custom", label: "Custom…", group: "Size" },
    { value: "16:9", label: "16:9", group: "Aspect ratio" },
    { value: "4:3", label: "4:3", group: "Aspect ratio" },
    { value: "1:1", label: "1:1", group: "Aspect ratio" },
    { value: "9:16", label: "9:16", group: "Aspect ratio" },
  ];
  let customW = $state(1280);
  let customH = $state(800);
  let stageW = $state(0);
  let stageH = $state(0);

  const frame = $derived.by(() => {
    const W = stageW;
    const H = stageH;
    if (viewport === "fit" || !W || !H) return { w: W, h: H, scale: 1 };
    const ratio = /^(\d+):(\d+)$/.exec(viewport);
    if (ratio) {
      const r = +ratio[1] / +ratio[2];
      const w = Math.floor(Math.min(W, H * r));
      return { w, h: Math.floor(w / r), scale: 1 };
    }
    const [w, h] = viewport === "custom" ? [Math.max(100, customW || 0), Math.max(100, customH || 0)] : viewport.split("x").map(Number);
    return { w, h, scale: Math.min(1, W / w, H / h) };
  });
</script>

{#if !isDesktop}
  <EmptyState icon="world-www" title="Desktop only" body="Previewing pages needs the desktop app." />
{:else}
  <div class="browser">
    {#if tabs.length > 1}
      <div class="tabs">
        {#each tabs as tab (tab.id)}
          <div class="tab" class:active={tab.id === activeId}>
            <button type="button" class="tab-main" title={tab.url} onclick={() => (activeId = tab.id)}>
              {#if tab.loading}<Icon name="loader-2" size={12} />{/if}
              <span>{tab.title || tab.url}</span>
            </button>
            <button type="button" class="tab-x" title="Close tab" onclick={() => closeTab(tab.id)}>
              <Icon name="xmark" size={11} />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="bar">
      <button type="button" class="btn" title="Back" disabled={!active.canBack} onclick={() => views.get(active.id)?.goBack()}>
        <Icon name="arrow-left" size={14} />
      </button>
      <button type="button" class="btn" title="Forward" disabled={!active.canForward} onclick={() => views.get(active.id)?.goForward()}>
        <Icon name="arrow-right" size={14} />
      </button>
      <button
        type="button"
        class="btn"
        title={active.loading ? "Stop" : "Reload"}
        onclick={() => (active.loading ? views.get(active.id)?.stop() : views.get(active.id)?.reload())}
      >
        <Icon name={active.loading ? "xmark" : "refresh"} size={14} />
      </button>
      <input
        class="address"
        bind:value={address}
        placeholder="localhost:5173 or a URL"
        spellcheck="false"
        onfocus={(e) => {
          editing = true;
          e.currentTarget.select();
        }}
        onblur={() => (editing = false)}
        onkeydown={(e) => {
          if (e.key === "Enter") go();
          if (e.key === "Escape") {
            editing = false;
            e.currentTarget.blur();
          }
        }}
      />
      <button type="button" class="btn" title="New tab" onclick={addTab}><Icon name="plus" size={14} /></button>
      <button
        type="button"
        class="btn"
        title="Open in your browser"
        disabled={!/^https?:/.test(active.url)}
        onclick={() => void openUrl(active.url)}
      >
        <Icon name="external-link" size={14} />
      </button>
      <button type="button" class="btn" title="Developer tools" onclick={() => views.get(active.id)?.openDevTools()}>
        <Icon name="code" size={14} />
      </button>
      <Dropdown
        items={VIEWPORTS}
        bind:value={() => viewport, (v) => (viewport = v ?? "fit")}
        triggerIcon="aspect-ratio"
        triggerTitle="Viewport size"
        triggerClass="viewport"
      />
    </div>

    {#if viewport === "custom"}
      <div class="custom">
        <input type="number" min="100" max="7680" bind:value={customW} aria-label="Width" />
        <span>×</span>
        <input type="number" min="100" max="7680" bind:value={customH} aria-label="Height" />
        <button type="button" class="btn" title="Swap width and height" onclick={() => ([customW, customH] = [customH, customW])}>
          <Icon name="arrows-exchange" size={13} />
        </button>
      </div>
    {/if}
    {#if viewport !== "fit" && frame.w}
      <div class="dims">{frame.w} × {frame.h}{frame.scale < 1 ? ` · ${Math.round(frame.scale * 100)}%` : ""}</div>
    {/if}
    {#if active.error}<div class="error">{active.error}</div>{/if}

    <div class="stage" class:framed={viewport !== "fit"} bind:clientWidth={stageW} bind:clientHeight={stageH}>
      {#each tabs as tab (tab.id)}
        <div
          class="frame"
          class:shown={tab.id === activeId}
          style="width: {frame.w * frame.scale}px; height: {frame.h * frame.scale}px"
        >
          <webview
            use:wire={tab}
            src={tab.start}
            partition="persist:yoake-browser"
            style="width: {frame.w}px; height: {frame.h}px; transform: scale({frame.scale})"
          ></webview>
        </div>
      {/each}
      {#if active.url === "about:blank" && !active.loading}
        <div class="hint">
          <EmptyState icon="world-www" title="Nothing loaded" body="Type a URL, or just a port like 5173 for a local dev server." />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .browser {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .tabs {
    display: flex;
    gap: 0.14rem;
    padding: 0.29rem var(--space-1) 0;
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    min-width: 0;
    max-width: 10rem;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    color: var(--text-dim);
  }
  .tab.active {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .tab-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.29rem;
    padding: 0.29rem 0.43rem;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  .tab-main span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-x {
    display: flex;
    padding: 0.21rem;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
  }
  .bar,
  .custom {
    display: flex;
    align-items: center;
    gap: 0.14rem;
    padding: 0.29rem var(--space-1);
  }
  .bar {
    border-bottom: 1px solid var(--panel-border);
  }
  .btn {
    display: flex;
    padding: 0.29rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .address,
  .custom input {
    min-width: 0;
    padding: 0.21rem 0.43rem;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
  }
  .address {
    flex: 1;
  }
  .address:focus {
    outline: none;
    border-color: var(--accent);
  }
  .bar :global(.viewport) {
    flex-shrink: 0;
    min-width: 0;
    max-width: 7rem;
    --ctrl-h: 1.71rem;
  }
  .custom input {
    width: 5rem;
  }
  .custom span,
  .dims {
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .dims {
    padding: 0 var(--space-1) 0.21rem;
    font-variant-numeric: tabular-nums;
  }
  .error {
    padding: 0.29rem var(--space-1);
    font-size: var(--text-label-size);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .stage {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
  .stage.framed {
    background: rgba(0, 0, 0, 0.18);
  }
  /* Stacked, not display:none, so a background tab's page keeps its layout and state. */
  .frame {
    position: absolute;
    inset: 0;
    margin: auto;
    visibility: hidden;
    overflow: hidden;
  }
  .frame.shown {
    visibility: visible;
  }
  .stage.framed .frame {
    box-shadow: 0 0 0 1px var(--panel-border);
  }
  webview {
    display: flex;
    transform-origin: 0 0;
    background: #fff;
  }
  .hint {
    position: absolute;
    inset: 0;
    display: flex;
    background: var(--panel-bg);
    pointer-events: none;
  }
</style>
