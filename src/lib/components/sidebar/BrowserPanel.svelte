<script lang="ts">
  import { tip } from "../../tooltip.svelte";
  // A small browser for previewing pages beside the chat, on Electron's <webview> (see
  // lockDownWebviews in electron/main.js for what a page may and may not do). The viewport can
  // be fit to the panel, forced to a device size (scaled down to fit), or held at an aspect ratio.
  import { browserGuard, browserUnguard, isDesktop, openUrl } from "../../platform";
  import { registerBrowser, type BrowserController } from "../../browserAgent.svelte";
  import { SNAPSHOT_JS, clickJs, focusJs, locateJs, scrollJs } from "../../browserSnapshot";
  import Icon from "../Icon.svelte";
  import Dropdown, { type DropdownItem } from "../Dropdown.svelte";
  import EmptyState from "./EmptyState.svelte";

  interface Webview extends HTMLElement {
    getWebContentsId(): number;
    getURL(): string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    stop(): void;
    loadURL(url: string): Promise<void>;
    openDevTools(): void;
    insertCSS(css: string): Promise<string>;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
    sendInputEvent(event: { type: string; x?: number; y?: number; button?: string; clickCount?: number; keyCode?: string; modifiers?: string[] }): void;
    insertText(text: string): Promise<void>;
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

  // Which chat this panel belongs to; the agent's browser tool drives it (browserAgent.svelte.ts).
  let { sessionId = "" }: { sessionId?: string } = $props();

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
      // Warnings and errors, for the agent's next snapshot. Numeric levels are Electron's older form.
      "console-message": (e) => {
        const level = typeof e.level === "number" ? ["debug", "info", "warning", "error"][e.level] : e.level;
        if (level !== "warning" && level !== "error") return;
        const log = consoleByTab.get(tab.id) ?? [];
        log.push(`[${level}] ${String(e.message).slice(0, 300)}${e.sourceId ? ` (${e.sourceId}:${e.line})` : ""}`);
        consoleByTab.set(tab.id, log.slice(-30));
      },
    };
    for (const [k, f] of Object.entries(handlers)) w.addEventListener(k, f);
    return {
      destroy() {
        for (const [k, f] of Object.entries(handlers)) w.removeEventListener(k, f);
      },
    };
  }

  /** Web build: an <iframe> has no navigation API and its pages are cross-origin, so history is
   * kept here and only the navigation the buttons and address bar cause is tracked. The agent's
   * browser tool needs a real webview, so it stays desktop-only (registerBrowser below).
   * ponytail: links followed inside the frame aren't seen; a server-side browser would fix that. */
  function wireFrame(el: HTMLIFrameElement, tab: Tab) {
    const hist = [tab.start];
    let i = 0;
    const sync = () => {
      const url = hist[i];
      tab.url = url;
      tab.title = /^https?:/.test(url) ? new URL(url).host : "New tab";
      tab.canBack = i > 0;
      tab.canForward = i < hist.length - 1;
    };
    const show = () => {
      tab.loading = hist[i] !== "about:blank";
      tab.error = "";
      el.src = hist[i];
      sync();
    };
    const onLoad = () => (tab.loading = false);
    el.addEventListener("load", onLoad);
    views.set(tab.id, {
      loadURL: async (url: string) => {
        hist.splice(i + 1, hist.length, url);
        i++;
        show();
      },
      goBack: () => i > 0 && (i--, show()),
      goForward: () => i < hist.length - 1 && (i++, show()),
      reload: show,
      stop: () => {
        el.src = "about:blank";
        tab.loading = false;
      },
      openDevTools: () => {},
    } as unknown as Webview);
    return { destroy: () => el.removeEventListener("load", onLoad) };
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

  // ---- The agent's side (§3.2 browser_request): it works in whichever tab is active. ----

  const consoleByTab = new Map<string, string[]>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Lets a navigation an action set off start, then waits (bounded) for it to finish. */
  async function settle(tab: Tab) {
    await sleep(250);
    for (let t = 0; tab.loading && t < 15_000; t += 100) await sleep(100);
  }

  async function snapshot(tab: Tab, w: Webview): Promise<string> {
    const text = String(await w.executeJavaScript(SNAPSHOT_JS));
    const log = consoleByTab.get(tab.id) ?? [];
    consoleByTab.set(tab.id, []);
    return log.length ? `${text}\n\nConsole since the last snapshot:\n${log.join("\n")}` : text;
  }

  const KEY_NAMES: Record<string, string> = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", " ": "Space" };
  const MODIFIERS: Record<string, string> = { ctrl: "control", control: "control", cmd: "meta", meta: "meta", alt: "alt", shift: "shift" };

  /** "Enter", "a", "Control+a": a real key press, down, typed, and up. */
  function press(w: Webview, combo: string) {
    const parts = combo.split("+");
    const key = parts.pop() || "+";
    const modifiers = parts.map((m) => MODIFIERS[m.toLowerCase()]).filter(Boolean);
    const keyCode = KEY_NAMES[key] ?? key;
    w.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    if (keyCode === "Enter") w.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
    else if (keyCode.length === 1) w.sendInputEvent({ type: "char", keyCode, modifiers });
    w.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  }

  const controller: BrowserController = {
    async run(action, args, guard) {
      const w = views.get(active.id);
      if (!guard || !w) return runAction(action, args);
      // Page-initiated navigation off the approved hosts is stopped by the main process while
      // the action runs; the agent is told, and must use navigate (which asks the user).
      const id = w.getWebContentsId();
      await browserGuard(id, guard.hosts);
      let out: string;
      try {
        out = await runAction(action, args);
      } catch (e) {
        await browserUnguard(id);
        throw e;
      }
      const blocked = await browserUnguard(id);
      if (blocked.length) {
        throw new Error(
          `blocked: the page tried to go to ${blocked[0]}, a site you haven't been cleared to visit, so the browser stayed where it was. ` +
            "To go there, call navigate with that URL; the user is asked first.",
        );
      }
      return out;
    },
  };

  async function runAction(action: string, args: Record<string, unknown>): Promise<string> {
    {
      const tab = active;
      const w = views.get(tab.id);
      if (!w) throw new Error("the browser isn't ready yet; try again");
      const ref = typeof args.ref === "string" ? args.ref : "";
      switch (action) {
        case "navigate": {
          tab.error = "";
          // A superseded load (a redirect, a client-side router taking over) rejects with
          // ERR_ABORTED; that isn't a failure. did-fail-load reports real ones on the tab.
          await w.loadURL(String(args.url)).catch((e: unknown) => {
            if (!String(e).includes("ERR_ABORTED")) tab.error ||= String(e);
          });
          break;
        }
        case "snapshot":
          break;
        case "click": {
          const at = (await w.executeJavaScript(locateJs(ref))) as { x: number; y: number; w: number; h: number; visible: boolean };
          // A real click where the element is when it can be aimed; a synthetic one when the pane
          // is hidden or the element can't be hit.
          if (at.visible && at.w > 0 && at.x >= 0 && at.y >= 0 && at.x < at.w && at.y < at.h) {
            for (const type of ["mouseDown", "mouseUp"]) w.sendInputEvent({ type, x: at.x, y: at.y, button: "left", clickCount: 1 });
          } else await w.executeJavaScript(clickJs(ref), true);
          break;
        }
        case "type": {
          await w.executeJavaScript(focusJs(ref), true);
          await w.insertText(String(args.text ?? ""));
          if (args.submit) press(w, "Enter");
          break;
        }
        case "press":
          press(w, String(args.key ?? ""));
          break;
        case "scroll":
          await w.executeJavaScript(scrollJs(ref || undefined, String(args.direction ?? "down")));
          break;
        case "evaluate": {
          const value = await w.executeJavaScript(String(args.expression), true);
          const json = JSON.stringify(value ?? null, null, 1) ?? "undefined";
          return json.length > 20_000 ? json.slice(0, 20_000) + "\n[truncated]" : json;
        }
        case "back":
        case "forward":
          if (action === "back" ? !w.canGoBack() : !w.canGoForward()) throw new Error(`nothing to go ${action} to`);
          if (action === "back") w.goBack();
          else w.goForward();
          break;
        case "reload":
          w.reload();
          break;
        default:
          throw new Error(`unknown browser action ${action}`);
      }
      await settle(tab);
      if (tab.error && ["navigate", "back", "forward", "reload"].includes(action)) throw new Error(`couldn't load the page: ${tab.error}`);
      return snapshot(tab, w);
    }
  }

  $effect(() => {
    if (sessionId && isDesktop) return registerBrowser(sessionId, controller);
  });
</script>

<div class="browser">
  {#if tabs.length > 1}
    <div class="tabs">
      {#each tabs as tab (tab.id)}
        <div class="tab" class:active={tab.id === activeId}>
          <button type="button" class="tab-main" {@attach tip(tab.url)} onclick={() => (activeId = tab.id)}>
            {#if tab.loading}<Icon name="loader-2" size={12} />{/if}
            <span>{tab.title || tab.url}</span>
          </button>
          <button type="button" class="tab-x" {@attach tip("Close tab")} onclick={() => closeTab(tab.id)}>
            <Icon name="xmark" size={11} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="bar">
    <button type="button" class="btn" {@attach tip("Back")} disabled={!active.canBack} onclick={() => views.get(active.id)?.goBack()}>
      <Icon name="arrow-left" size={14} />
    </button>
    <button type="button" class="btn" {@attach tip("Forward")} disabled={!active.canForward} onclick={() => views.get(active.id)?.goForward()}>
      <Icon name="arrow-right" size={14} />
    </button>
    <button
      type="button"
      class="btn"
      {@attach tip(active.loading ? "Stop" : "Reload")}
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
    <button type="button" class="btn" {@attach tip("New tab")} onclick={addTab}><Icon name="plus" size={14} /></button>
    <button
      type="button"
      class="btn"
      {@attach tip("Open in your browser")}
      disabled={!/^https?:/.test(active.url)}
      onclick={() => void openUrl(active.url)}
    >
      <Icon name="external-link" size={14} />
    </button>
    {#if isDesktop}
      <button type="button" class="btn" {@attach tip("Developer tools")} onclick={() => views.get(active.id)?.openDevTools()}>
        <Icon name="code" size={14} />
      </button>
    {/if}
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
      <button type="button" class="btn" {@attach tip("Swap width and height")} onclick={() => ([customW, customH] = [customH, customW])}>
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
        {#if isDesktop}
          <webview
            use:wire={tab}
            src={tab.start}
            partition="persist:yoake-browser"
            style="width: {frame.w}px; height: {frame.h}px; transform: scale({frame.scale})"
          ></webview>
        {:else}
          <!-- No allow-top-navigation: the previewed page can't take over this app. -->
          <iframe
            use:wireFrame={tab}
            title={tab.title}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            referrerpolicy="no-referrer"
            style="width: {frame.w}px; height: {frame.h}px; transform: scale({frame.scale})"
          ></iframe>
        {/if}
      </div>
    {/each}
    {#if active.url === "about:blank" && !active.loading}
      <div class="hint">
        <EmptyState icon="world-www" title="Nothing loaded" body={isDesktop
              ? "Type a URL, or just a port like 5173 for a local dev server."
              : "Type a URL. Some sites refuse to be embedded; use Open in your browser for those."}
        />
      </div>
    {/if}
  </div>
</div>

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
  /* inherit, not visible: a hidden panel (ChatSidebar's keep-layout pane) must hide it too. */
  .frame.shown {
    visibility: inherit;
  }
  .stage.framed .frame {
    box-shadow: 0 0 0 1px var(--panel-border);
  }
  webview,
  iframe {
    display: flex;
    border: 0;
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
