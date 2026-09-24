<script lang="ts">
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { scale } from "svelte/transition";
  import { cubicIn, cubicOut } from "svelte/easing";
  import { untrack } from "svelte";
  import { app } from "../state.svelte";
  import {
    sendPrompt,
    editMessage,
    cancelEditingMessage,
    cancelTurn,
    respondPermission,
    denyPermissionWithFeedback,
    askUserAnswer,
    selectProject,
    uploadFile,
  } from "../ipc";
  import { isDesktop } from "../platform";
  import { basename } from "../format";
  import Icon from "./Icon.svelte";
  import DiffView from "./DiffView.svelte";
  import ModelPicker from "./ModelPicker.svelte";
  import ModePicker from "./ModePicker.svelte";
  import Dropdown from "./Dropdown.svelte";

  let { sessionId, floating }: { sessionId: string; floating: boolean } =
    $props();

  // Session/provider/project state lives on the active connection's own
  // ServerState now — see the multi-server-connections plan. `cid` is
  // needed by every ipc.ts call now that they're threaded per connection.
  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);

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

  const currentMode = $derived(server?.modeBySession[sessionId] ?? "read_write");
  const turnId = $derived(server?.activeTurnBySession[sessionId]);
  const projectPath = $derived(server?.projectBySession[sessionId]);
  const projectName = $derived(projectPath ? basename(projectPath) : null);
  const hasProvider = $derived(!!server?.providerBySession[sessionId]);

  // Unsent text follows its chat: switching chats stashes it on the server
  // state (the sidebar marks chats that have one) and brings back the new
  // chat's own.
  let draftSession: string | undefined;
  $effect(() => {
    const sid = sessionId;
    untrack(() => {
      if (draftSession === sid || !server) return;
      text = server.composerDraftBySession[sid] ?? "";
      draftSession = sid;
    });
  });
  $effect(() => {
    const t = text;
    untrack(() => {
      if (!server || !draftSession) return;
      if (t.trim()) server.composerDraftBySession[draftSession] = t;
      else delete server.composerDraftBySession[draftSession];
    });
  });

  // A no_provider rejection (turn_completed, §3.2 — the selected provider
  // became unavailable between being picked and the turn actually running)
  // "unsends" the message server-state-side (state.svelte.ts removes it from
  // the transcript) and hands the original text back here to restore.
  $effect(() => {
    const draft = server?.restoredDraftBySession[sessionId];
    if (draft === undefined || !server) return;
    text = draft;
    delete server.restoredDraftBySession[sessionId];
    requestAnimationFrame(() => textarea?.focus());
  });

  // Attachments (§3.1 user_prompt `attachments`) are paths on the server's
  // machine. Over the local socket that's this machine, so a picked file is
  // referenced in place — no copy. A remote server gets the bytes uploaded
  // (§3.1 upload_begin) and we attach the path it hands back; pasted files
  // have no path at all, so they're uploaded either way.
  type Attachment = { key: string; name: string; path?: string; progress?: number; error?: string };
  let attachments = $state<Attachment[]>([]);
  let fileInput: HTMLInputElement | undefined = $state();
  const uploading = $derived(attachments.some((a) => !a.path && !a.error));

  async function attachFile() {
    if (!cid || !connected) return;
    if (isDesktop && app.connectionMode === "local") {
      const picked = await openFileDialog({ multiple: true, directory: false });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      for (const path of paths) {
        if (!attachments.some((a) => a.path === path)) {
          attachments.push({ key: path, name: basename(path), path });
        }
      }
    } else {
      fileInput?.click();
    }
  }

  /** Adds a chip and uploads whatever `load` produces into it. */
  function startUpload(name: string, load: () => Promise<File>) {
    const c = cid;
    if (!c) return;
    const key = crypto.randomUUID();
    attachments.push({ key, name, progress: 0 });
    const entry = () => attachments.find((a) => a.key === key);
    load()
      .then((file) =>
        uploadFile(c, file, (f) => {
          const a = entry();
          if (a) a.progress = f;
        }),
      )
      .then((path) => {
        const a = entry();
        if (a) a.path = path;
      })
      .catch((err: unknown) => {
        const a = entry();
        if (a) a.error = err instanceof Error ? err.message : String(err);
      });
  }

  function upload(files: Iterable<File>) {
    for (const file of files) startUpload(file.name || "pasted file", async () => file);
  }

  /** Files dropped from this machine's disk (a native Tauri drop hands us
   * paths, not File objects): referenced in place on a local connection,
   * read and uploaded for a remote one. */
  function attachPaths(paths: string[]) {
    if (app.connectionMode === "local") {
      for (const path of paths) {
        if (!attachments.some((a) => a.path === path)) attachments.push({ key: path, name: basename(path), path });
      }
      return;
    }
    for (const path of paths) {
      startUpload(basename(path), async () => {
        const buf = await invoke<ArrayBuffer>("read_file_bytes", { path }).catch((err) => {
          throw new Error(`${err}`.includes("directory") ? "folders can't be uploaded" : String(err));
        });
        return new File([buf], basename(path));
      });
    }
  }

  // Drag-and-drop. In the desktop shell the webview never sees dropped
  // files (Tauri intercepts them and reports paths + a position), so hit-test
  // that position against this chat's own panel — with a side chat open,
  // only the one under the cursor takes the files. Elsewhere, plain HTML5
  // drop events on the composer do the job.
  let dragOver = $state(false);
  function underCursor(pos: { x: number; y: number }): boolean {
    const el = boxEl?.closest("section.panel") ?? boxEl;
    const r = el?.getBoundingClientRect();
    const x = pos.x / devicePixelRatio;
    const y = pos.y / devicePixelRatio;
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  $effect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent(({ payload: p }) => {
        if (p.type === "leave") {
          dragOver = false;
        } else if (p.type === "enter" || p.type === "over") {
          dragOver = connected && !editingId && underCursor(p.position);
        } else if (p.type === "drop") {
          const hit = dragOver || (connected && !editingId && underCursor(p.position));
          dragOver = false;
          if (hit && p.paths.length) attachPaths(p.paths);
        }
      })
      .then((u) => (disposed ? u() : (unlisten = u)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  });

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files") || !connected) return;
    e.preventDefault();
    dragOver = true;
  }
  function onDrop(e: DragEvent) {
    dragOver = false;
    const files = e.dataTransfer?.files;
    if (!files?.length || !connected) return;
    e.preventDefault();
    upload(files);
  }

  function onPaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files;
    if (!files?.length || !connected) return;
    e.preventDefault();
    upload(files);
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
    const files = server?.filesByProject[projectPath] ?? [];
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
    (server?.recentProjects ?? []).map((p) => ({ value: p, label: basename(p) })),
  );
  function setProject(value: string | undefined) {
    if (value && cid) selectProject(cid, value);
  }

  // Only worth switching *between* once there's more than one — with 0 or 1
  // servers there's nothing to pick, so the plain "add/connect" button stays.
  const serverItems = $derived(
    Object.entries(app.servers).map(([scid, s]) => ({ value: scid, label: s.label })),
  );
  function setActiveServer(value: string | undefined) {
    if (value) app.activeConnectionId = value;
  }

  // While a permission_request is outstanding for this session, the composer
  // morphs into an approval card — the diff, three decisions (reject/allow
  // once/always allow), and the same text box repurposed as an optional
  // "reject and tell it what you want instead" note.
  // Every ask in this session is queued (a turn can raise several — e.g. a
  // CLI agent's multi-question AskUserQuestion); the oldest is the one shown,
  // and answering it removes only that id so the next one steps up.
  const asks = $derived(server?.asksFor(sessionId) ?? []);
  const pending = $derived(asks[0]?.kind === "permission" ? asks[0] : null);

  function respond(allowed: boolean, remember: boolean) {
    if (!pending || !cid || !server) return;
    respondPermission(
      cid,
      pending.sessionId,
      pending.turnId,
      pending.toolCallId,
      allowed,
      remember,
    );
    server.removeAsk(pending.toolCallId);
  }

  // read_write forces every bash call to Ask and drops the remember cache key
  // on that path (SPEC.md §4c) — offering "Always Allow" as if it persists is
  // misleading, so it's disabled specifically for a bash card in this mode.
  const bashAlwaysAllowDisabled = $derived(
    currentMode === "read_write" && pending?.toolName === "bash",
  );

  // ask_user_question (§3.1/§3.2) — available in every mode, queued with
  // permission asks above.
  const pendingQuestion = $derived(asks[0]?.kind === "question" ? asks[0] : null);

  function answerQuestion(answer: string) {
    if (!pendingQuestion || !cid || !server) return;
    askUserAnswer(cid, pendingQuestion.toolCallId, answer);
    server.removeAsk(pendingQuestion.toolCallId);
    text = "";
  }

  const editingId = $derived(server?.editingMessageId[sessionId]);

  function cancelEdit() {
    if (!cid) return;
    cancelEditingMessage(cid, sessionId);
    text = "";
  }

  function submit(e?: Event) {
    e?.preventDefault();
    const value = text.trim();
    if (!cid) return;
    if (pendingQuestion) {
      answerQuestion(value);
      return;
    }
    if (pending) {
      denyPermissionWithFeedback(
        cid,
        pending.sessionId,
        pending.turnId,
        pending.toolCallId,
        value,
      );
      text = "";
      return;
    }
    if (editingId) {
      if (!value || turnId || !connected || !projectPath || !hasProvider) return;
      editMessage(cid, sessionId, editingId, value);
    } else {
      const paths = attachments.flatMap((a) => (a.path ? [a.path] : []));
      if ((!value && !paths.length) || uploading || turnId || !connected || !projectPath || !hasProvider) return;
      sendPrompt(cid, sessionId, value, paths);
      attachments = [];
    }
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

    <form
      class="box"
      class:pending={pending || pendingQuestion}
      class:drag-over={dragOver}
      bind:this={boxEl}
      onsubmit={submit}
      ondragover={onDragOver}
      ondragleave={() => (dragOver = false)}
      ondrop={onDrop}
    >
      {#if dragOver}
        <div class="drop-hint"><Icon name="paperclip" size={14} /> Drop to attach</div>
      {/if}
      {#if pendingQuestion}
        <div class="permission">
          <div class="permission-head">
            <span class="permission-title">{pendingQuestion.question}</span>
            {#if asks.length > 1}<span class="ask-count">1 of {asks.length}</span>{/if}
          </div>
          {#if pendingQuestion.options}
            <div class="question-options">
              {#each pendingQuestion.options as option (option)}
                <button type="button" class="ghost" onclick={() => answerQuestion(option)}
                  >{option}</button
                >
              {/each}
            </div>
          {/if}
        </div>
      {:else if pending}
        <div class="permission">
          <div class="permission-head">
            <span class="permission-title"
              >{pending.diff?.filePath ?? pending.toolName}</span
            >
            <span class="permission-desc">{pending.description}</span>
            {#if asks.length > 1}<span class="ask-count">1 of {asks.length}</span>{/if}
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
              disabled={bashAlwaysAllowDisabled}
              title={bashAlwaysAllowDisabled
                ? "bash always asks in Read/Write mode — this can't be remembered"
                : undefined}
              onclick={() => respond(true, true)}
              >{bashAlwaysAllowDisabled ? "Always Allow (unavailable for bash)" : "Always Allow"}</button
            >
          </div>
        </div>
      {/if}

      {#if editingId && !pending && !pendingQuestion}
        <div class="editing-banner">
          <Icon name="pencil" size={12} />
          <span>Editing message — sending discards the reply that followed it</span>
          <button type="button" class="link" onclick={cancelEdit}>Cancel</button>
        </div>
      {/if}

      {#if attachments.length && !pending && !pendingQuestion && !editingId}
        <ul class="attachments">
          {#each attachments as a (a.key)}
            <li class:error={!!a.error} title={a.error ?? a.path ?? `Uploading ${a.name}…`}>
              <Icon name={a.error ? "alert-circle" : a.path ? "file" : "loader-2"} size={12} />
              <span class="name">{a.name}</span>
              {#if !a.path && !a.error}<span class="pct">{Math.round((a.progress ?? 0) * 100)}%</span>{/if}
              <button
                type="button"
                title="Remove"
                onclick={() => (attachments = attachments.filter((x) => x.key !== a.key))}
              >
                <Icon name="xmark" size={11} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="input-area" class:hidden={pendingQuestion?.options}>
        <textarea
          bind:this={textarea}
          bind:value={text}
          onkeydown={onKeydown}
          onpaste={onPaste}
          onkeyup={trackCursor}
          onclick={trackCursor}
          oninput={() => {
            autosize();
            trackCursor();
          }}
          placeholder={pendingQuestion
            ? "Type your answer…"
            : pending
              ? "Optional — reject and tell it what to do instead…"
              : !projectPath
                ? "Pick a project in the sidebar to start chatting…"
                : floating
                  ? "Ask anything about this project…"
                  : "Reply…"}
          rows="1"
        ></textarea>

        {#if mentionMatches.length > 0}
          <ul
            class="mentions"
            in:scale={{ start: 0.98, duration: 160, easing: cubicOut }}
            out:scale={{ start: 0.98, duration: 120, easing: cubicIn }}
          >
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
        <div class="left">
          {#if !pending && !pendingQuestion}
            <button
              type="button"
              class="icon-chip"
              title={app.connectionMode === "local" ? "Attach files" : "Upload and attach files"}
              disabled={!connected || !!editingId}
              onclick={attachFile}
            >
              <Icon name="paperclip" size={14} />
            </button>
            <input
              bind:this={fileInput}
              type="file"
              multiple
              hidden
              onchange={(e) => {
                const input = e.currentTarget;
                if (input.files) upload(input.files);
                input.value = "";
              }}
            />

            <ModelPicker {sessionId} />

            <ModePicker {sessionId} />

            {#if server?.planBySession[sessionId] && server.openPlanSessionId !== sessionId}
              <button
                type="button"
                class="icon-chip"
                title="Reopen this session's plan"
                onclick={() => server && (server.openPlanSessionId = sessionId)}
              >
                <Icon name="clipboard-list" size={14} />
              </button>
            {/if}
          {/if}
        </div>

        <div class="right">
          {#if turnId}
            <button
              type="button"
              class="stop"
              onclick={() => cid && turnId && cancelTurn(cid, sessionId, turnId)}
            >
              <Icon name="pause" size={13} /> Stop
            </button>
          {/if}
          {#if pendingQuestion}
            {#if !pendingQuestion.options}
              <button type="submit" class="send" disabled={!connected || !text.trim()}>
                <Icon name="send" size={13} /> Answer
              </button>
            {/if}
          {:else if pending}
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
              disabled={(!text.trim() && !attachments.some((a) => a.path)) ||
                uploading ||
                !connected ||
                !projectPath ||
                !hasProvider}
              title={!connected
                ? "Connect to yoakeland to send this"
                : uploading
                  ? "Waiting for uploads to finish"
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
        searchable={(server?.recentProjects.length ?? 0) > 6}
        searchPlaceholder="Search projects…"
        triggerClass="fc-pill"
      />
      {#if Object.keys(app.servers).length > 1}
        <Dropdown
          items={serverItems}
          bind:value={() => cid ?? undefined, setActiveServer}
          placeholder="Select a server…"
          triggerIcon={app.connectionMode === "local" ? "computer" : "cloud"}
          triggerTitle="Switch server"
          triggerClass="fc-pill"
        />
      {:else}
        <button
          type="button"
          class="fc-pill"
          title="Servers"
          onclick={() => app.openPalette("servers")}
        >
          <Icon
            name={app.connectionMode === "local" ? "computer" : "cloud"}
            size={12}
          />
          {app.connectionMode}
        </button>
      {/if}
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
    /* Own stacking context, so ::after's negative z-index (below) only
       reorders it against .wrap's own children (.stack) — without this it
       would resolve against the nearest ancestor stacking context instead
       (.body, see ChatPanel.svelte) and end up entirely behind MessageList,
       which defeats the fade rather than just tucking it under the box. */
    isolation: isolate;
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
  /* Fades scrolled-under transcript text out behind the docked composer,
     rather than having it cut off hard at the box's edge. Only shown once
     docked (there's no transcript behind the floating/empty-state composer
     to fade). Height matches MessageList's own reserved bottom padding
     (--composer-height + the same 40px gap, see .list there) exactly, so
     the fade's transparent top edge lines up with where real message
     content is allowed to sit at rest — it only ever covers the blank
     buffer zone plus whatever scrolls up into it, never a message that's
     just sitting there unscrolled (which is how a message's footer used to
     go dark: a flat 7rem band doesn't track the composer's actual size). */
  .wrap::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(var(--composer-height, 90px) + 40px);
    background: linear-gradient(to bottom, transparent, var(--panel-bg) 65%);
    opacity: 0;
    /* Behind .stack (the composer) — ::after otherwise paints after it in
       DOM order and would sit on top, covering the box instead of just the
       transcript behind it. */
    z-index: -1;
    transition: opacity calc(0.3s * var(--anim-speed, 1)) ease;
  }
  .wrap:not(.floating)::after {
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
  .box.drag-over {
    border-color: var(--accent);
  }
  .drop-hint {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.43rem;
    border-radius: inherit;
    background: color-mix(in srgb, var(--float-bg) 85%, var(--accent));
    color: var(--accent);
    font-size: 0.86rem;
    font-weight: 500;
    pointer-events: none;
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
  .ask-count {
    font-size: var(--text-label-size);
    color: var(--warning, var(--text-dim));
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
  .editing-banner {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    padding: 0.36rem 0.71rem 0;
  }
  .editing-banner .link {
    margin-left: auto;
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-size: inherit;
    cursor: pointer;
    text-decoration: underline;
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
  .input-area.hidden {
    display: none;
  }
  .question-options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .question-options button {
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.93rem;
    font-size: var(--text-label-size);
    font-weight: 600;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.07);
    color: var(--text);
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
  /* Same in/out feel as every bits-ui floating surface (app.css's floatIn/
     floatOut) — but this one's a plain {#if} block, not bits-ui, so there's
     no PresenceManager to keep it mounted through a CSS-only exit animation.
     Svelte's own `scale` transition instead (durations mirror
     --float-enter/exit-duration's un-multiplied base values — small enough
     that skipping the --anim-speed hookup here isn't worth its own reactive
     read of the custom property). */
  .attachments {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.29rem;
    margin: 0 0 0.43rem;
    padding: 0;
  }
  .attachments li {
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    max-width: 16rem;
    padding: 0.14rem 0.29rem 0.14rem 0.43rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-pill);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .attachments li.error {
    color: var(--danger);
    border-color: var(--danger-dim);
  }
  .attachments .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .attachments button {
    display: inline-flex;
    background: none;
    border: none;
    padding: 0.07rem;
    color: inherit;
    cursor: pointer;
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
