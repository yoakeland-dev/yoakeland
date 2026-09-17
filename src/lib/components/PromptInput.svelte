<script lang="ts">
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
  import { app } from "../state.svelte";
  import {
    sendPrompt,
    cancelTurn,
    setPlanMode,
    respondPermission,
    denyPermissionWithFeedback,
    selectProject,
  } from "../ipc";
  import { isDesktop } from "../platform";
  import { basename } from "../format";
  import type { ChatMode } from "../types";
  import type { ComponentProps } from "svelte";
  import Icon from "./Icon.svelte";
  import DiffView from "./DiffView.svelte";
  import ModelPicker from "./ModelPicker.svelte";
  import Dropdown from "./Dropdown.svelte";

  let { sessionId, floating }: { sessionId: string; floating: boolean } =
    $props();

  let text = $state("");
  let textarea: HTMLTextAreaElement;
  let boxEl: HTMLFormElement | undefined = $state();
  let stackEl: HTMLDivElement | undefined = $state();
  let cursorPos = $state(0);
  let mentionIndex = $state(0);
  let mentionDismissed = $state(false);

  // The box's height should only *animate* while the composer is morphing
  // between its floating and docked layouts — a plain content-driven resize
  // (typing a longer line) must snap instantly instead of lagging behind the
  // keystroke. `morphing` is true for exactly the span of that layout
  // transition: flipped on the instant `floating` changes, and back off once
  // BOTH things it's waiting on have actually finished animating — the
  // .stack's own slide (top) and the textarea's height shrink/grow. Waiting
  // on only one of the two let the other get cut off mid-transition (a
  // visible snap) whenever they finished a frame apart, which they always
  // did since autosize() used to run a rAF late. A timeout fallback covers
  // the case where one of the two properties doesn't actually change (no
  // transitionend fires for a no-op transition).
  let morphing = $state(false);
  let pendingMorphProps = new Set<string>();
  let prevFloating: boolean | undefined;
  $effect(() => {
    if (prevFloating !== undefined && floating !== prevFloating) {
      morphing = true;
      pendingMorphProps = new Set(["top", "height"]);
    }
    prevFloating = floating;
  });
  function onMorphPropEnd(prop: string) {
    pendingMorphProps.delete(prop);
    if (pendingMorphProps.size === 0) morphing = false;
  }
  $effect(() => {
    if (!stackEl) return;
    const el = stackEl;
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "top") onMorphPropEnd("top");
    };
    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
  });
  $effect(() => {
    if (!textarea) return;
    const el = textarea;
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "height")
        onMorphPropEnd("height");
    };
    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
  });
  $effect(() => {
    if (!morphing || !stackEl) return;
    const ms =
      parseFloat(getComputedStyle(stackEl).transitionDuration) * 1000 || 400;
    const t = setTimeout(() => {
      morphing = false;
      pendingMorphProps.clear();
    }, ms + 50);
    return () => clearTimeout(t);
  });

  // Grows with content up to a cap, then scrolls internally — matches the
  // CSS max-height on textarea below. The empty/floating state gets a taller
  // floor (an inviting landing box) than the docked one-liner default; both
  // floors and the content-driven height itself are plain style.height
  // writes, animated by the `transition: height` on textarea below rather
  // than a `rows` attribute swap, which would jump a frame ahead of it.
  const MAX_TEXTAREA_HEIGHT = 240;
  function autosize() {
    if (!textarea) return;
    // Measuring scrollHeight requires resetting to "auto" first (otherwise a
    // shrinking edit can't be detected — scrollHeight would still reflect
    // the old, larger explicit height). But that reset is itself a forced
    // reflow, and for short content it resolves to nearly the same height as
    // the target — which then becomes the CSS transition's "before" value
    // instead of what was actually on screen, making the morph's height
    // transition invisible (a snap) instead of visible. Restoring the prior
    // explicit height and forcing a reflow before writing the target gives
    // the transition a real starting point to interpolate from.
    const prevHeight = textarea.style.height;
    textarea.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    const minHeight = lineHeight * (floating ? 3 : 1);
    const target =
      Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT),
      ) + "px";
    if (prevHeight) {
      textarea.style.height = prevHeight;
      void textarea.offsetHeight;
    }
    textarea.style.height = target;
  }
  $effect(() => {
    text;
    floating;
    autosize();
  });

  // MessageList needs to know how tall the docked composer is so scrolled
  // messages don't end up hidden underneath it — see its padding-bottom.
  $effect(() => {
    if (!boxEl) return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--composer-height",
        `${boxEl!.offsetHeight}px`,
      );
    });
    ro.observe(boxEl);
    return () => ro.disconnect();
  });

  // One entry per mode drives both the dropdown's options and its trigger: the
  // option list is derived off it (see modeItems) and the trigger reads its
  // icon/hint off the active entry, so a mode is only ever described once.
  type Mode = {
    id: ChatMode;
    label: string;
    hint: string;
    icon: ComponentProps<typeof Icon>["name"];
    // Color this mode's trigger and menu row light up to on hover/open. Only
    // Auto carries one: it's the mode that stops asking before each tool call,
    // so it's the one worth flagging. Everything untinted lights up to --text.
    tint?: string;
  };

  const modes: Mode[] = [
    {
      id: "ask",
      label: "Ask",
      hint: "Ask before every tool call",
      icon: "question-mark",
    },
    {
      id: "auto",
      label: "Auto",
      hint: "Auto-approve tool calls",
      icon: "player-track-next",
      tint: "var(--warning)",
    },
    {
      id: "plan",
      label: "Plan",
      hint: "Draft a plan before acting — the model only gets read-only tools",
      icon: "clipboard-list",
    },
  ];

  const MODE_BY_ID = Object.fromEntries(modes.map((m) => [m.id, m])) as Record<
    ChatMode,
    Mode
  >;
  const modeItems = modes.map(({ id, label }) => ({ value: id, label }));

  /** The two colors a mode's text/icon can be in — at rest, and lit (hovered,
     keyboard-highlighted, or with the menu open). A tinted mode wears its tint
     in *both* states, so Auto stays visibly amber until you switch away from
     it; untinted modes stay quiet until something lights them. Emitted as
     inline custom properties because the trigger element belongs to
     Dropdown.svelte (reached by inheritance from .left) while each menu row
     sets its own. */
  function modeColors(mode: Mode): string {
    const rest = mode.tint ?? "var(--text-dim)";
    const lit = mode.tint ?? "var(--text)";
    return `--mode-rest: ${rest}; --mode-lit: ${lit}`;
  }

  const currentMode = $derived(app.modeBySession[sessionId] ?? "auto");
  const currentModeMeta = $derived(MODE_BY_ID[currentMode]);
  const turnId = $derived(app.activeTurnBySession[sessionId]);
  const projectPath = $derived(app.projectBySession[sessionId]);
  const projectName = $derived(projectPath ? basename(projectPath) : null);
  const hasProvider = $derived(!!app.providerBySession[sessionId]);

  // A no_provider rejection (turn_completed, §3.2 — the selected provider
  // became unavailable between being picked and the turn actually running)
  // "unsends" the message server-state-side (state.svelte.ts removes it from
  // the transcript) and hands the original text back here to restore.
  $effect(() => {
    const draft = app.restoredDraftBySession[sessionId];
    if (draft === undefined) return;
    text = draft;
    delete app.restoredDraftBySession[sessionId];
    requestAnimationFrame(() => textarea?.focus());
  });

  function setMode(m: ChatMode) {
    const wasPlan = app.modeBySession[sessionId] === "plan";
    app.modeBySession[sessionId] = m;
    app.setLastUsedMode(m);
    if (m === "plan" && !wasPlan) setPlanMode(sessionId, true);
    else if (wasPlan && m !== "plan") setPlanMode(sessionId, false);
  }

  /** Dropdown only deals in strings (`DropdownItem.value`), so the mode union
   * is narrowed back here — the sole place a selected value crosses over. */
  function setModeValue(value: string | undefined) {
    if (value === "ask" || value === "auto" || value === "plan") setMode(value);
  }

  // Attaching only works when this client's disk *is* the server's disk —
  // otherwise the path we'd insert wouldn't resolve to anything on the
  // machine actually running the model's tools. Byte upload for the
  // remote/web case needs a wire message that doesn't exist yet (§3.1 has no
  // upload endpoint); tracked for later, not stubbed here.
  const canAttach = $derived(isDesktop && app.connectionMode === "local");

  async function attachFile() {
    if (!canAttach) return;
    const path = await openFileDialog({ multiple: false, directory: false });
    if (!path || Array.isArray(path)) return;
    const pos = textarea?.selectionStart ?? text.length;
    text = text.slice(0, pos) + `@${path} ` + text.slice(pos);
    const newPos = pos + path.length + 2;
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(newPos, newPos);
      cursorPos = newPos;
    });
  }

  function insertMention() {
    const pos = textarea?.selectionStart ?? text.length;
    text = text.slice(0, pos) + "@" + text.slice(pos);
    mentionDismissed = false;
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(pos + 1, pos + 1);
      cursorPos = pos + 1;
    });
  }

  // The "@query" token immediately before the cursor, if any — driven off
  // list_files (§3.1) since the client has no filesystem access of its own
  // (the project may not even be on this machine — see §2a server mode).
  const mentionQuery = $derived.by(() => {
    if (mentionDismissed) return null;
    const upToCursor = text.slice(0, cursorPos);
    const at = upToCursor.lastIndexOf("@");
    if (at === -1) return null;
    const query = upToCursor.slice(at + 1);
    if (/\s/.test(query)) return null;
    return { start: at, query };
  });

  const mentionMatches = $derived.by(() => {
    if (!mentionQuery || !projectPath) return [];
    const files = app.filesByProject[projectPath] ?? [];
    const q = mentionQuery.query.toLowerCase();
    return (q ? files.filter((f) => f.toLowerCase().includes(q)) : files).slice(
      0,
      8,
    );
  });

  $effect(() => {
    mentionMatches;
    mentionIndex = 0;
  });

  function pickMention(path: string) {
    if (!mentionQuery) return;
    const before = text.slice(0, mentionQuery.start);
    const after = text.slice(
      mentionQuery.start + 1 + mentionQuery.query.length,
    );
    text = `${before}@${path} ${after}`;
    const pos = before.length + path.length + 2;
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(pos, pos);
      cursorPos = pos;
    });
  }

  function trackCursor() {
    cursorPos = textarea?.selectionStart ?? text.length;
    mentionDismissed = false;
  }

  const connected = $derived(app.connectionStatus === "connected");

  const projectItems = $derived(
    app.recentProjects.map((p) => ({ value: p, label: basename(p) })),
  );
  function setProject(value: string | undefined) {
    if (value) selectProject(value);
  }

  // While a permission_request is outstanding for this session, the composer
  // morphs into an approval card — the diff, three decisions (reject/allow
  // once/always allow), and the same text box repurposed as an optional
  // "reject and tell it what you want instead" note.
  const pending = $derived(
    app.pendingPermission?.sessionId === sessionId
      ? app.pendingPermission
      : null,
  );

  function respond(allowed: boolean, remember: boolean) {
    if (!pending) return;
    respondPermission(
      pending.sessionId,
      pending.turnId,
      pending.toolCallId,
      allowed,
      remember,
    );
    app.pendingPermission = null;
  }

  function submit(e?: Event) {
    e?.preventDefault();
    const value = text.trim();
    if (pending) {
      denyPermissionWithFeedback(
        pending.sessionId,
        pending.turnId,
        pending.toolCallId,
        value,
      );
      text = "";
      return;
    }
    if (!value || turnId || !connected || !projectPath || !hasProvider) return;
    sendPrompt(sessionId, value);
    text = "";
  }

  function onKeydown(e: KeyboardEvent) {
    if (mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mentionIndex = (mentionIndex + 1) % mentionMatches.length;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        mentionIndex =
          (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length;
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionMatches[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        mentionDismissed = true;
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      submit(e);
    }
  }
</script>

<div class="wrap" class:floating>
  <div class="stack" class:morphing bind:this={stackEl}>
    <h2 class="hero" class:hidden={!floating}>
      {#if projectName}What shall we build in <span class="hero-project"
          >{projectName}</span
        >?{:else}What shall we build?{/if}
    </h2>

    <form class="box" class:pending bind:this={boxEl} onsubmit={submit}>
      {#if pending}
        <div class="permission">
          <div class="permission-head">
            <span class="permission-title"
              >{pending.diff?.filePath ?? pending.toolName}</span
            >
            <span class="permission-desc">{pending.description}</span>
          </div>
          {#if pending.diff}
            <DiffView diff={pending.diff} />
          {/if}
          <div class="permission-actions">
            <button
              type="button"
              class="deny"
              onclick={() => respond(false, false)}>Reject</button
            >
            <button
              type="button"
              class="ghost"
              onclick={() => respond(true, false)}>Allow Once</button
            >
            <button
              type="button"
              class="allow"
              onclick={() => respond(true, true)}>Always Allow</button
            >
          </div>
        </div>
      {/if}

      <div class="input-area">
        <textarea
          bind:this={textarea}
          bind:value={text}
          onkeydown={onKeydown}
          onkeyup={trackCursor}
          onclick={trackCursor}
          oninput={() => {
            autosize();
            trackCursor();
          }}
          placeholder={pending
            ? "Optional — reject and tell it what to do instead…"
            : !projectPath
              ? "Pick a project in the sidebar to start chatting…"
              : floating
                ? "Ask anything about this project…"
                : "Reply…"}
          rows="1"
        ></textarea>

        {#if mentionMatches.length > 0}
          <ul class="mentions">
            {#each mentionMatches as file, i (file)}
              <li>
                <button
                  type="button"
                  class:active={i === mentionIndex}
                  onclick={() => pickMention(file)}
                >
                  {file}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="toolbar">
        <!-- The mode trigger lives inside the Dropdown component, which owns its
           own styles — so the active mode's colors reach it as inherited
           custom properties from here rather than as a style on the trigger
           itself (see the .mode-trigger rules below). -->
        <div class="left" style={modeColors(currentModeMeta)}>
          {#if !pending}
            <button
              type="button"
              class="icon-chip"
              title={canAttach
                ? "Attach a local file"
                : "Requires a local server connection — remote upload isn't supported yet"}
              disabled={!canAttach}
              onclick={attachFile}
            >
              <Icon name="paperclip" size={14} />
            </button>

            <ModelPicker {sessionId} />

            <Dropdown
              items={modeItems}
              bind:value={() => currentMode, setModeValue}
              triggerIcon={currentModeMeta.icon}
              triggerTitle={currentModeMeta.hint}
              triggerClass="mode-trigger"
            >
              {#snippet item({ value, label, selected })}
                {@const mode = MODE_BY_ID[value as ChatMode]}
                <span class="mode-item" style={modeColors(mode)}>
                  <Icon name={mode.icon} size={13} />
                  <span class="dropdown-item-label" title={mode.hint}
                    >{label}</span
                  >
                </span>
                {#if selected}<Icon name="check" size={11} />{/if}
              {/snippet}
            </Dropdown>
          {/if}
        </div>

        <div class="right">
          {#if turnId}
            <button
              type="button"
              class="stop"
              onclick={() => cancelTurn(sessionId, turnId)}
            >
              <Icon name="pause" size={13} /> Stop
            </button>
          {/if}
          {#if pending}
            <button
              type="submit"
              class="send"
              disabled={!connected}
              title={text.trim()
                ? "Reject and send this instead"
                : "Reject with no note"}
            >
              <Icon name="send" size={13} />
              {text.trim() ? "Reject & send" : "Reject"}
            </button>
          {:else if !turnId}
            <button
              type="button"
              class="icon-chip"
              title="Mention a file (@path)"
              onclick={insertMention}
            >
              <Icon name="at-sign" size={14} />
            </button>
            <button
              type="submit"
              class="send icon-only"
              disabled={!text.trim() ||
                !connected ||
                !projectPath ||
                !hasProvider}
              title={!connected
                ? "Connect to yoakeland to send this"
                : !projectPath
                  ? "Pick a project first"
                  : !hasProvider
                    ? "Pick a provider first"
                    : "Send"}
            >
              <Icon name="send" size={15} />
            </button>
          {/if}
        </div>
      </div>
    </form>

    <div
      class="float-controls"
      class:tucked={!floating}
      inert={!floating}
      aria-hidden={!floating}
    >
      <Dropdown
        items={projectItems}
        bind:value={() => projectPath, setProject}
        placeholder="Select a project…"
        triggerIcon="folder"
        triggerTitle="Switch project"
        searchable={app.recentProjects.length > 6}
        searchPlaceholder="Search projects…"
        triggerClass="fc-pill"
      />
      <button
        type="button"
        class="fc-pill"
        title="Switch between a local and remote server"
        onclick={() => (app.showConnectModal = true)}
      >
        <Icon
          name={app.connectionMode === "local" ? "computer" : "cloud"}
          size={12}
        />
        {app.connectionMode}
      </button>
    </div>
  </div>
</div>

<style>
  /* The composer always overlays .body (an absolute inset:0 layer) instead
     of sharing flex flow with MessageList — that's what lets .stack below
     slide between a bottom dock and a vertical center with one animated
     `top`/`transform` pair instead of two incompatible layouts. */
  .wrap {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  /* A big soft scrim behind the floating composer so it stays legible over a
     busy/dark wallpaper (only shown pre-first-message — see .wallpaper.visible
     in ChatPanel.svelte) — pure background-only paint, no filter/blur, so it's
     cheap to animate. Fades out the instant the chat stops floating (first
     message sent) since there's no wallpaper left behind the docked composer
     to need it. */
  .wrap::before {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(
      42rem 30rem at 50% calc(50% + var(--header-height) / 2),
      var(--panel-bg) 0%,
      transparent 70%
    );
    opacity: 0;
    transition: opacity calc(0.3s * var(--anim-speed, 1)) ease;
  }
  .wrap.floating::before {
    opacity: 1;
  }
  /* Bottom-anchored by default: sits `top` from the wrap's own bottom edge,
     pulled up by its own full height via the translateY(-100%). Floating
     switches both to the vertical-center equivalent — same functions, same
     units, so the browser interpolates the move instead of snapping. */
  .stack {
    --morph: calc(0.2s * var(--anim-speed, 1));
    position: absolute;
    left: 50%;
    top: calc(100% - 1.14rem);
    /* Docked width — wider, since a one-line bar reads better spanning more
       of the panel. The floating (new-chat) width below is narrower on
       purpose: a tall, inviting landing box rather than a wide one-liner. */
    width: min(45.71rem, calc(100% - 3.43rem));
    transform: translate(-50%, -100%);
    pointer-events: auto;
    transition:
      top var(--morph) ease,
      transform var(--morph) ease,
      width var(--morph) ease;
  }
  .wrap.floating .stack {
    /* Centered on the visible body below the header, not on the whole panel
       — .wrap spans the full panel behind the overlaid header, so a plain
       50% reads as sitting too high relative to the content area you can
       actually see. */
    top: calc(50% + var(--header-height) / 2);
    width: min(36rem, calc(100% - 3.43rem));
    transform: translate(-50%, -50%);
  }
  .hero {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 1.7rem);
    transform: translateX(-50%) translateY(0);
    margin: 0;
    /* Shrinks off the panel's own width (see .body's container-type in
       ChatPanel.svelte) before it can overflow a narrow panel — e.g. main
       chat squeezed by an open sidebar/side-panel — rather than clipping or
       forcing the panel wider. */
    font-size: clamp(1.15rem, 6cqi, 1.7rem);
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    opacity: 1;
    z-index: -1;
    transition:
      opacity var(--morph, calc(0.2s * var(--anim-speed, 1))) ease,
      transform var(--morph, calc(0.2s * var(--anim-speed, 1))) ease;
  }
  /* Slides down into the box's own footprint (it sits behind it — see the
     box's z-index below) instead of just fading in the empty air above where
     the box used to be, so it visibly tucks away under the composer rather
     than leaving a hole that then pops shut once the fade finishes. */
  .hero.hidden {
    opacity: 0;
    transform: translateX(-50%) translateY(calc(1.7rem + 100%));
    pointer-events: none;
  }
  .hero-project {
    font-family: var(--logo-font-family);
    font-weight: 800;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: var(--accent);
  }
  /* Below the composer, not above — sits right under the box and, once the
     chat has a first message, slides up to tuck away behind it instead of
     just fading in place. Left-aligned to the composer's own edge (no
     translateX centering) so it lines up with the toolbar row above it. */
  .float-controls {
    position: absolute;
    left: 0;
    top: calc(100% + 0.86rem);
    transform: translateY(0);
    display: flex;
    gap: var(--space-1);
    opacity: 1;
    z-index: -1;
    transition:
      transform var(--morph, calc(0.2s * var(--anim-speed, 1))) ease,
      opacity var(--morph, calc(0.2s * var(--anim-speed, 1))) ease;
  }
  /* Slides up into the box's footprint (same tuck-under treatment as
     .hero.hidden above) rather than stopping just short of its edge. */
  .float-controls.tucked {
    transform: translateY(calc(-0.86rem - 100%));
    opacity: 0;
    pointer-events: none;
  }
  /* Pill chrome shared by the two idle controls under the composer — the
     project picker (a Dropdown) and the local/remote switch (a plain button,
     since it opens the connect modal rather than picking from a list). Global
     because the Dropdown's trigger element belongs to Dropdown.svelte. Nothing
     shows at rest — no fill, no outline, and no blur (a backdrop-filter would
     frost the background under a control that isn't drawing anything) — and
     fill, outline and blur all fade in together on hover/open, same as every
     other trigger in this composer. */
  :global(.fc-pill) {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    height: 1.86rem;
    max-width: 16rem;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    border-radius: var(--radius-pill);
    padding: 0 var(--space-1);
    font-size: var(--text-label-size);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      border-color calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  :global(.fc-pill:hover),
  :global(.fc-pill:focus-within),
  :global(.fc-pill:focus-visible) {
    background: var(--float-hover-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border-color: var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    color: var(--text);
  }
  /* Dropdown's own trigger already lands on several of those properties at
     equal specificity (a --ctrl-h-tall, --radius-sm rectangle), so they're
     restated here — qualified with .dropdown-trigger so this wins on
     specificity rather than on stylesheet order, same as .mode-trigger
     above. */
  :global(.dropdown-trigger.fc-pill) {
    height: 1.86rem;
    max-width: 16rem;
    border-color: transparent;
    border-radius: var(--radius-pill);
    color: var(--text-dim);
  }
  :global(.dropdown-trigger.fc-pill:hover),
  :global(.dropdown-trigger.fc-pill:focus-visible),
  :global(.dropdown-trigger.fc-pill[data-state="open"]) {
    background: var(--float-hover-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border-color: var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    color: var(--text);
  }
  .box {
    position: relative;
    /* Above .hero and .float-controls (both z-index: -1) so they tuck away
       visibly behind its solid background instead of just fading in the
       open air next to it. */
    z-index: 1;
    width: 100%;
    /* A floating surface — see the --float-* tokens in app.css: the plain panel
       fill by default, translucent over a backdrop blur when Settings >
       Appearance > Surfaces is set to Frosted. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    /* Concentric with the send button in the bottom-right corner: button
       radius (1rem, since it's a 2rem circle) + the box's own right/bottom
       padding (0.57rem) it sits inset by = 1.57rem, i.e. 22px at the 14px
       root size. Right and bottom padding below are kept equal so that gap
       is actually uniform on both axes — that's what makes the corners
       nest instead of just approximately lining up. */
    border-radius: 22px;
    padding: 0.71rem var(--space-1) var(--space-1);
  }
  .box.pending {
    border-color: var(--accent);
  }
  .permission {
    margin-bottom: 0.71rem;
    padding-bottom: 0.71rem;
    border-bottom: 1px solid var(--panel-border);
  }
  .permission-head {
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
    margin-bottom: var(--space-half);
  }
  .permission-title {
    font-size: var(--text-body-size);
    font-weight: 600;
    font-family: ui-monospace, monospace;
  }
  .permission-desc {
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .permission-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .permission-actions button {
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.93rem;
    font-size: var(--text-label-size);
    font-weight: 600;
    cursor: pointer;
  }
  .permission-actions .deny {
    background: var(--danger-dim);
    color: var(--danger);
  }
  .permission-actions .ghost {
    background: rgba(255, 255, 255, 0.07);
    color: var(--text);
  }
  .permission-actions .allow {
    background: var(--accent);
    color: #0d1020;
  }
  .input-area {
    position: relative;
  }
  textarea {
    width: 100%;
    resize: none;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.92rem;
    line-height: 1.5;
    outline: none;
    /* Matches MAX_TEXTAREA_HEIGHT in the script — grows with the prompt up
       to this, then scrolls internally instead of pushing the toolbar off
       the bottom of the panel. */
    max-height: 240px;
    overflow-y: auto;
  }
  /* autosize() writes a plain height in px on every keystroke as well as on
     the floating/docked floor swap — but only the latter should visibly
     animate. Scoping the transition to .stack.morphing (set only for the
     span of that floating/docked morph, see the script) means a resize
     while typing snaps instantly instead of lagging a beat behind the
     keystroke. */
  .stack.morphing textarea {
    transition: height var(--morph) ease;
  }
  .mentions {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin: 0 0 0.43rem;
    padding: var(--space-half);
    list-style: none;
    max-width: min(25.71rem, 100%);
    max-height: 14.29rem;
    overflow-y: auto;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-sm);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    z-index: 5;
  }
  .mentions button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0.43rem var(--space-1);
    border-radius: var(--radius-sm);
    font-size: var(--text-label-size);
    font-family: ui-monospace, monospace;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mentions button.active {
    background: var(--sidebar-active);
    color: var(--text);
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.43rem;
    gap: var(--space-1);
  }
  .left {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    flex-wrap: wrap;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 0.43rem;
  }
  .icon-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.86rem;
    height: 1.86rem;
    /* Transparent chrome, like every other control in the toolbar: the fill
       only shows up on hover (below). The border stays a real 1px box in
       every state rather than being dropped, so hovering can't nudge the
       chip's content by a pixel or reflow the row. */
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .icon-chip:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .icon-chip:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* The mode dropdown is styled by Dropdown.svelte itself (its trigger is
     element-agnostic there); these rules only bend it into this toolbar's row
     — same height as the chips beside it, pill-shaped like the model picker
     pill it sits next to, and no outline on hover/open. The rest/lit colors
     come in as custom properties (see modeColors): a mode with a tint holds it
     in both states, the others sit at --text-dim until hovered. Qualified with
     .dropdown-trigger on purpose: at equal specificity the winner would
     otherwise come down to stylesheet injection order between this file and
     Dropdown.svelte, rather than anything declared here. */
  :global(.dropdown-trigger.mode-trigger) {
    height: 1.86rem;
    border-radius: var(--radius-pill);
    color: var(--mode-rest, var(--text-dim));
  }
  :global(.dropdown-trigger.mode-trigger:hover),
  :global(.dropdown-trigger.mode-trigger:focus-visible),
  :global(.dropdown-trigger.mode-trigger[data-state="open"]) {
    background: rgba(255, 255, 255, 0.06);
    border-color: transparent;
    color: var(--mode-lit, var(--text));
  }
  /* Icon + label as one leading cluster, so the row's own space-between
     leaves the trailing check on the far edge where Dropdown puts it. The
     cluster holds the row's color, so the icon and label dim and light up
     together as the row is hovered/highlighted. */
  .mode-item {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    min-width: 0;
    color: var(--mode-rest, var(--text-dim));
    transition: color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  :global(.dropdown-item[data-highlighted]) .mode-item {
    color: var(--mode-lit, var(--text));
  }
  .send,
  .stop {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    border: none;
    border-radius: var(--radius-pill);
    padding: 0.5rem var(--space-2);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }
  .send {
    background: var(--accent);
    color: #0d1020;
  }
  .send:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* 2rem circle → 1rem corner radius, the send-button half of .box's
     concentric-corner border-radius calculation above. */
  .send.icon-only {
    width: 2rem;
    height: 2rem;
    padding: 0;
    justify-content: center;
  }
  .stop {
    background: var(--danger-dim);
    color: var(--danger);
  }
</style>
