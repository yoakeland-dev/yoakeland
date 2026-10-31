<script lang="ts">
  import { tip } from "../../tooltip.svelte";
  // The browser panel when the page lives on the server (PARITY_CHECKLIST B11): a canvas showing
  // its screencast, and input sent back only while this client holds control. Phones get
  // a hidden text field, since the on-screen keyboard only opens for one.
  import { send } from "../../ipc";
  import { app, type ConnectionId } from "../../state.svelte";
  import { serverBrowsers, watchServerFrames, type ServerBrowserFrame } from "../../serverBrowser.svelte";
  import { base64ToBytes } from "../../base64";
  import { toUrl } from "../../browserUrl";
  import { openUrl } from "../../platform";
  import Icon from "../Icon.svelte";
  import EmptyState from "./EmptyState.svelte";

  let { connectionId, sessionId }: { connectionId: ConnectionId; sessionId: string } = $props();

  const st = $derived(serverBrowsers[connectionId]);
  const tabs = $derived(st?.tabs ?? []);
  const active = $derived(tabs.find((t) => t.active));
  const activeIndex = $derived(tabs.findIndex((t) => t.active));
  const operate = $derived(!!st?.canOperate);
  const control = $derived(!!st?.youControl);

  let pageHidden = $state(false);
  // Only the pane on screen watches; the server stops encoding for the rest.
  const visible = $derived.by(() => {
    const server = app.servers[connectionId];
    return (
      !pageHidden &&
      app.activeConnectionId === connectionId &&
      server?.currentSessionId === sessionId &&
      !!server.chatSidebarOpenBySession[sessionId] &&
      server.chatSidebarPanelBySession[sessionId] === "browser"
    );
  });

  const tx = (type: string, data: Record<string, unknown>) => void send(connectionId, { type, data });
  const nav = (action: string, extra: Record<string, unknown> = {}) => tx("browser_nav", { action, ...extra });

  // ---- Watching: view size (debounced) and on/off. ----
  let stageW = $state(0);
  let stageH = $state(0);
  $effect(() => {
    if (!visible || !stageW || !stageH) return;
    const [width, height] = [stageW, stageH];
    const t = setTimeout(() => tx("browser_view", { on: true, width, height, sessionId }), 150);
    return () => clearTimeout(t);
  });
  $effect(() => {
    if (!visible) return;
    return () => {
      tx("browser_view", { on: false });
      if (control) tx("browser_control", { take: false });
    };
  });

  // ---- Drawing: only the newest frame waiting is drawn; every frame is acked. ----
  let canvas = $state<HTMLCanvasElement>();
  let fw = $state(0);
  let fh = $state(0);
  // No input before the first frame: until then the frame size, and so every coordinate, is unknown.
  const input = $derived(control && fw > 0);
  let drawing = false;
  let waiting: ServerBrowserFrame | undefined;

  async function draw(first: ServerBrowserFrame) {
    if (drawing) {
      if (waiting) tx("browser_frame_ack", { seq: waiting.seq });
      waiting = first;
      return;
    }
    drawing = true;
    for (let f: ServerBrowserFrame | undefined = first; f; f = waiting) {
      waiting = undefined;
      try {
        const bmp = await createImageBitmap(new Blob([base64ToBytes(f.data) as BlobPart], { type: "image/jpeg" }));
        if (canvas) {
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) [canvas.width, canvas.height] = [bmp.width, bmp.height];
          canvas.getContext("2d")?.drawImage(bmp, 0, 0);
          [fw, fh] = [f.width, f.height];
        }
        bmp.close();
      } catch {
        // a frame that won't decode is skipped; the next one replaces it
      }
      tx("browser_frame_ack", { seq: f.seq });
    }
    drawing = false;
  }
  $effect(() => {
    if (visible) return watchServerFrames(connectionId, draw);
  });

  const scale = $derived(fw && fh && stageW && stageH ? Math.min(stageW / fw, stageH / fh) : 1);

  // ---- Input, while this client has control. ----
  const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
    (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
  const BUTTONS = ["left", "middle", "right"];

  /** Canvas CSS space to the frame's own pixels. */
  function at(e: { clientX: number; clientY: number }) {
    const r = canvas!.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
    return { x: clamp(((e.clientX - r.left) / r.width) * fw, fw), y: clamp(((e.clientY - r.top) / r.height) * fh, fh) };
  }
  const mouse = (type: string, e: PointerEvent, extra: Record<string, unknown> = {}) =>
    tx("browser_input", { kind: "mouse", type, ...at(e), modifiers: mods(e), ...extra });

  let held: string | undefined; // the mouse button down now
  let lastMove = 0;
  let lastDown = { t: 0, x: 0, y: 0, n: 0 };
  let touch: { x: number; y: number; moved: number } | undefined;
  let kb = $state<HTMLTextAreaElement>();

  function onpointerdown(e: PointerEvent) {
    if (!input || !e.isPrimary) return;
    canvas!.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      touch = { x: e.clientX, y: e.clientY, moved: 0 };
      return;
    }
    e.preventDefault();
    held = BUTTONS[e.button] ?? "left";
    const p = at(e);
    const near = Math.hypot(p.x - lastDown.x, p.y - lastDown.y) < 5 && e.timeStamp - lastDown.t < 400;
    lastDown = { t: e.timeStamp, ...p, n: near ? lastDown.n + 1 : 1 };
    mouse("down", e, { button: held, clicks: lastDown.n });
  }
  function onpointermove(e: PointerEvent) {
    if (!input || !e.isPrimary) return;
    if (touch) {
      const [dx, dy] = [touch.x - e.clientX, touch.y - e.clientY];
      touch = { x: e.clientX, y: e.clientY, moved: touch.moved + Math.abs(dx) + Math.abs(dy) };
      tx("browser_input", { kind: "wheel", ...at(e), dx: Math.round(dx / scale), dy: Math.round(dy / scale) });
      return;
    }
    if (e.timeStamp - lastMove < 33) return;
    lastMove = e.timeStamp;
    mouse("move", e, held ? { button: held } : {});
  }
  function onpointerup(e: PointerEvent) {
    if (!e.isPrimary) return;
    if (touch) {
      const tap = touch.moved < 8;
      touch = undefined;
      if (tap && input) {
        mouse("move", e);
        mouse("down", e, { button: "left", clicks: 1 });
        mouse("up", e, { button: "left", clicks: 1 });
      }
      return;
    }
    if (held) mouse("up", e, { button: held, clicks: lastDown.n });
    held = undefined;
  }
  function onpointercancel(e: PointerEvent) {
    touch = undefined;
    if (held) mouse("up", e, { button: held, clicks: lastDown.n });
    held = undefined;
  }
  /** A click (or tap) puts the keyboard on the page: focusing the hidden field is what opens a phone's. */
  const onclick = () => control && kb?.focus({ preventScroll: true });

  function wheel(el: HTMLElement) {
    const f = (e: WheelEvent) => {
      if (!input) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? fh : 1;
      tx("browser_input", { kind: "wheel", ...at(e), dx: Math.round((e.deltaX * unit) / scale), dy: Math.round((e.deltaY * unit) / scale), modifiers: mods(e) });
    };
    el.addEventListener("wheel", f, { passive: false });
    return () => el.removeEventListener("wheel", f);
  }

  /** Typing is split in two: printable characters arrive as text (`input`, which is also what phones and
   * IMEs produce), everything else as key events. */
  function onkey(e: KeyboardEvent, type: "down" | "up") {
    if (!input || e.isComposing || e.key === "Dead" || e.key === "Unidentified" || e.key === "Process") return;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if ([...e.key].length === 1 && (!mod || e.getModifierState("AltGraph"))) return;
    if (mod && e.key.toLowerCase() === "v") return; // the paste event carries the text
    e.preventDefault();
    e.stopPropagation(); // the app's own shortcuts stay out of it
    tx("browser_input", { kind: "key", type, key: e.key, code: e.code, modifiers: mods(e) });
  }
  let composing = false; // a composition (IME, a phone's word suggestions) is sent whole when it ends
  function flush() {
    if (composing) return;
    const text = kb!.value;
    kb!.value = "";
    if (text && input) tx("browser_input", { kind: "text", text });
  }
  function onbeforeinput(e: InputEvent) {
    // A phone keyboard's Backspace on the empty field doesn't come as a key event.
    if (input && e.inputType === "deleteContentBackward" && !kb!.value && !e.isComposing) {
      e.preventDefault();
      for (const type of ["down", "up"]) tx("browser_input", { kind: "key", type, key: "Backspace", code: "Backspace", modifiers: 0 });
    }
  }
  function onpaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain");
    e.preventDefault();
    if (text && input) tx("browser_input", { kind: "text", text });
  }

  // ---- Header. ----
  let address = $state("");
  let editing = $state(false);
  $effect(() => {
    if (!editing) address = !active || active.url === "about:blank" ? "" : active.url;
  });
  function go() {
    editing = false;
    nav("navigate", { url: toUrl(address) });
  }
</script>

<svelte:document onvisibilitychange={() => (pageHidden = document.hidden)} />

<div class="browser">
  {#if tabs.length > 1}
    <div class="tabs">
      {#each tabs as tab, i (i)}
        <div class="tab" class:active={tab.active}>
          <button type="button" class="tab-main" {@attach tip(tab.url)} disabled={!operate} onclick={() => nav("tab_select", { index: i })}>
            {#if tab.loading}<Icon name="loader-2" size={12} />{/if}
            <span>{tab.title || tab.url || "New tab"}</span>
          </button>
          <button type="button" class="tab-x" {@attach tip("Close tab")} aria-label="Close tab" disabled={!operate} onclick={() => nav("tab_close", { index: i })}>
            <Icon name="xmark" size={11} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="bar">
    <button type="button" class="btn" {@attach tip("Back")} aria-label="Back" disabled={!operate} onclick={() => nav("back")}>
      <Icon name="arrow-left" size={14} />
    </button>
    <button type="button" class="btn" {@attach tip("Forward")} aria-label="Forward" disabled={!operate} onclick={() => nav("forward")}>
      <Icon name="arrow-right" size={14} />
    </button>
    <button type="button" class="btn" {@attach tip("Reload")} aria-label="Reload" disabled={!operate} onclick={() => nav("reload")}>
      <Icon name={active?.loading ? "loader-2" : "refresh"} size={14} />
    </button>
    <input
      class="address"
      bind:value={address}
      placeholder="A URL, or a port on the server like 5173"
      aria-label="Address"
      title={active?.title}
      spellcheck="false"
      disabled={!operate}
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
    <button type="button" class="btn" {@attach tip("New tab")} aria-label="New tab" disabled={!operate} onclick={() => nav("tab_new")}>
      <Icon name="plus" size={14} />
    </button>
    <button
      type="button"
      class="btn"
      {@attach tip("Open in your browser")}
      aria-label="Open in your browser"
      disabled={!/^https?:/.test(active?.url ?? "")}
      onclick={() => void openUrl(active!.url)}
    >
      <Icon name="external-link" size={14} />
    </button>
  </div>

  {#if st?.available}
    <div class="status">
      <span class="who" class:agent={st.controller === "agent"} class:you={control} role="status">
        {#if control}You have control{:else if st.controller === "agent"}Agent is using the browser{:else if st.controller === "human"}Someone else has control{:else}Viewing{/if}
      </span>
      {#if operate}
        <button type="button" class="take" onclick={() => tx("browser_control", { take: !control })}>{control ? "Release" : "Take control"}</button>
      {/if}
    </div>
  {:else if st}
    <div class="error">{st.error || "The server's browser isn't available."}</div>
  {/if}

  <div class="stage" bind:clientWidth={stageW} bind:clientHeight={stageH}>
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
    <canvas
      bind:this={canvas}
      class:live={control}
      class:empty={!fw}
      aria-label="Server browser"
      style="width: {fw * scale}px; height: {fh * scale}px"
      {@attach wheel}
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      {onpointercancel}
      {onclick}
      oncontextmenu={(e) => control && e.preventDefault()}
    ></canvas>
    <textarea
      bind:this={kb}
      class="kb"
      aria-label="Type into the browser"
      autocapitalize="off"
      autocomplete="off"
      {...{ autocorrect: "off" }}
      spellcheck="false"
      onkeydown={(e) => onkey(e, "down")}
      onkeyup={(e) => onkey(e, "up")}
      oninput={flush}
      oncompositionstart={() => (composing = true)}
      oncompositionend={() => ((composing = false), flush())}
      {onbeforeinput}
      {onpaste}
    ></textarea>
    {#if !fw && st?.available}
      <div class="hint"><EmptyState icon="world-www" title="Waiting for the page" body="The server's browser is starting." /></div>
    {:else if !st}
      <div class="hint"><EmptyState icon="world-www" title="Connecting" body="Asking the server for its browser." /></div>
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
    background: var(--wash-2);
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
  .status {
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
  .btn:disabled,
  .tab-main:disabled,
  .tab-x:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .address {
    flex: 1;
    min-width: 0;
    padding: 0.21rem 0.43rem;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
  }
  .address:focus {
    outline: none;
    border-color: var(--accent);
  }
  .status {
    justify-content: space-between;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .who.agent {
    color: var(--warning);
  }
  .who.you {
    color: var(--success);
  }
  .take {
    padding: 0.14rem 0.57rem;
    background: var(--accent-dim);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
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
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.18);
  }
  canvas {
    display: block;
    flex: none;
    touch-action: none; /* a drag scrolls the page, not this panel */
    -webkit-user-select: none;
    user-select: none;
    outline: none;
  }
  canvas.live {
    cursor: default;
    box-shadow: 0 0 0 1px var(--accent);
  }
  canvas.empty {
    display: none;
  }
  /* Real size and on screen, or iOS won't raise the keyboard for it; 16px keeps it from zooming the page. */
  .kb {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    opacity: 0;
    font-size: 16px;
    resize: none;
    pointer-events: none;
  }
  .hint {
    position: absolute;
    inset: 0;
    display: flex;
    pointer-events: none;
  }
</style>
