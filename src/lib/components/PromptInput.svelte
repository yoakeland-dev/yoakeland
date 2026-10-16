<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { fly, scale, slide } from "svelte/transition";
  import { cubicIn, cubicOut } from "svelte/easing";
  import { onDestroy, setContext, untrack } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import { app, CHAT_PROJECT } from "../state.svelte";
  import {
    sendPrompt,
    steerPrompt,
    editMessage,
    cancelEditingMessage,
    cancelTurn,
    selectProject,
    newChat,
    uploadFile,
    listFiles,
    listSkills,
    respondPermission,
    compactContext,
    setModelOptions,
  } from "../ipc";
  import { isDesktop, invoke, pickFiles, onFileDrop } from "../platform";
  import { viewport } from "../viewport.svelte";
  import { basename, shortNum } from "../format";
  import { fuzzyFilter, fuzzyIndices } from "../fuzzy";
  import { fileIconUrl } from "../fileIcons";
  import { mentionText, MENTION_RE } from "../mentions";
  import { pickableSkills, skillKindOf, slashToSkill } from "../extensions";
  import { parseSlashCommand, SLASH_COMMANDS } from "../slashCommands";
  import { liveActivity } from "../activity.svelte";
  import { sessionModes } from "../modes";
  import Icon from "./Icon.svelte";
  import AskCard from "./AskCard.svelte";
  import DotMatrix from "./DotMatrix.svelte";
  import ModelPicker from "./ModelPicker.svelte";
  import ModePicker from "./ModePicker.svelte";
  import EffortPicker from "./EffortPicker.svelte";
  import ContextRing from "./ContextRing.svelte";
  import ChatNotices from "./ChatNotices.svelte";
  import Dropdown from "./Dropdown.svelte";

  // `scrolledUp`: the transcript is well above its tail (MessageList), so the composer goes
  // compact and the status chip offers `onJump` back down.
  let {
    sessionId,
    floating,
    snap = false,
    scrolledUp = false,
    onJump,
  }: { sessionId: string; floating: boolean; snap?: boolean; scrolledUp?: boolean; onJump?: () => void } = $props();

  // Session/provider/project state lives on the active connection's ServerState; `cid` is
  // needed since ipc.ts calls are threaded per connection.
  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);

  let text = $state("");
  let textarea: HTMLTextAreaElement;
  let boxEl: HTMLFormElement | undefined = $state();
  let stackEl: HTMLDivElement | undefined = $state();
  // SlideText reads this: its text changes without rolling while the composer snaps between chats.
  setContext("snap", () => snap);

  let cursorPos = $state(0);
  let mentionIndex = $state(0);
  let mentionDismissed = $state(false);
  let skillIndex = $state(0);

  // Height only animates during the floating/docked layout morph; a content-driven resize
  // (typing) must snap instantly. `morphing` goes true when `floating` changes and back off
  // once BOTH the .stack slide and the textarea height transition finish - waiting on only
  // one let the other get cut off mid-transition when they finished a frame apart. Timeout
  // fallback covers a no-op transition that never fires transitionend.
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
  // Compact: scrolled up in a conversation with nothing waiting on an answer. Same height morph.
  const compact = $derived(scrolledUp && !floating && !(server?.asksFor(sessionId).length ?? 0));
  let prevCompact: boolean | undefined;
  $effect(() => {
    if (prevCompact !== undefined && compact !== prevCompact) {
      morphing = true;
      pendingMorphProps = new Set(["height"]);
    }
    prevCompact = compact;
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

  // Grows with content up to a cap (matches CSS max-height on textarea below), then scrolls.
  // Height is a plain style.height write, animated by `transition: height` below rather than
  // a `rows` attribute swap, which would jump a frame ahead of it.
  const MAX_TEXTAREA_HEIGHT = 240;
  function autosize() {
    if (!textarea) return;
    // Resetting to "auto" is needed to measure scrollHeight for a shrinking edit, but that
    // reflow becomes the CSS transition's "before" value if left as-is, making the morph
    // invisible. Restore the prior height and force a reflow first, so the transition has
    // the real on-screen value to interpolate from.
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
    compact;
    autosize();
  });

  // MessageList needs to know how tall the docked composer is so scrolled messages don't end
  // up hidden underneath it, see its padding-bottom. The whole stack is measured, so an ask
  // card above the box reserves its room too. Set on this chat's own column, not :root: a
  // custom property restyles everything under where it's set, and a split view's second chat
  // has its own composer.
  $effect(() => {
    if (!stackEl) return;
    const el = stackEl;
    const column = el.closest(".wrap")?.parentElement;
    if (!column) return;
    const ro = new ResizeObserver(() => column.style.setProperty("--composer-height", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  });

  const currentMode = $derived(server?.modeBySession[sessionId] ?? "read_write");
  const turnId = $derived(server?.activeTurnBySession[sessionId]);
  const projectPath = $derived(server?.projectBySession[sessionId]);
  const isChat = $derived(projectPath === CHAT_PROJECT);
  // Where the @ picker's files live: a chat's scratch directory, once the server has told us.
  const filesRoot = $derived(server?.rootOf(sessionId));
  const projectName = $derived(projectPath && !isChat ? basename(projectPath) : null);
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

  // A no_provider rejection (turn_completed §3.2, provider went unavailable mid-flight)
  // "unsends" the message server-side and hands the original text back here to restore.
  $effect(() => {
    const draft = server?.restoredDraftBySession[sessionId];
    if (draft === undefined || !server) return;
    text = draft;
    delete server.restoredDraftBySession[sessionId];
    requestAnimationFrame(() => textarea?.focus());
  });

  // Text another panel asked to add, e.g. an `@path#L10-20` mention from the editor, at the cursor.
  $effect(() => {
    const insert = server?.composerInsertBySession[sessionId];
    if (!insert || !server) return;
    delete server.composerInsertBySession[sessionId];
    const pos = Math.min(cursorPos, text.length);
    const before = text.slice(0, pos);
    const head = before + (before && !/\s$/.test(before) ? " " : "") + insert + " ";
    text = head + text.slice(pos);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(head.length, head.length);
      cursorPos = head.length;
    });
  });

  // Attachments (§3.1 user_prompt `attachments`) are paths on the server's machine. Over the
  // local socket that's this machine, so a picked file is referenced in place. A remote
  // server gets the bytes uploaded (§3.1 upload_begin); pasted files have no path either way.
  type Attachment = { key: string; name: string; path?: string; progress?: number; error?: string; thumb?: string };
  // Each chat keeps its own list, so switching chats shows its chips and a send ships only its own.
  // Lists are edited in place rather than replaced, so an upload still running for a chat finds its
  // chip even if the user has switched away meanwhile.
  let attachmentsBySession = $state<Record<string, Attachment[]>>({});
  const listFor = (sid: string): Attachment[] => (attachmentsBySession[sid] ??= []);
  const attachments = $derived(attachmentsBySession[sessionId] ?? []);
  let fileInput: HTMLInputElement | undefined = $state();
  const uploading = $derived(attachments.some((a) => !a.path && !a.error));
  onDestroy(() => {
    for (const list of Object.values(attachmentsBySession)) for (const a of list) if (a.thumb) URL.revokeObjectURL(a.thumb);
  });

  // Image attachments show a thumbnail: straight from the File when there is one, else read off
  // disk (a local path, desktop only).
  const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
  function thumbFromFile(sid: string, key: string, file: File) {
    const a = listFor(sid).find((x) => x.key === key);
    if (a && !a.thumb && file.type.startsWith("image/")) a.thumb = URL.createObjectURL(file);
  }
  function thumbFromPath(sid: string, key: string, path: string) {
    if (!isDesktop || !IMAGE_RE.test(path)) return;
    invoke<ArrayBuffer>("read_file_bytes", { path })
      .then((buf) => {
        const a = listFor(sid).find((x) => x.key === key);
        if (a && !a.thumb) a.thumb = URL.createObjectURL(new Blob([buf]));
      })
      .catch(() => {});
  }
  function addLocal(path: string) {
    const sid = sessionId;
    const list = listFor(sid);
    if (list.some((a) => a.path === path)) return;
    list.push({ key: path, name: basename(path), path });
    thumbFromPath(sid, path, path);
  }
  function removeAttachment(key: string) {
    const sid = sessionId;
    const a = listFor(sid).find((x) => x.key === key);
    if (a?.thumb) URL.revokeObjectURL(a.thumb);
    attachmentsBySession[sid] = listFor(sid).filter((x) => x.key !== key);
  }

  async function attachFile() {
    if (!cid || !connected) return;
    if (isDesktop && app.connectionMode === "local") {
      for (const path of await pickFiles({ multiple: true })) addLocal(path);
    } else {
      fileInput?.click();
    }
  }

  /** Adds a chip and uploads whatever `load` produces into it. */
  function startUpload(name: string, load: () => Promise<File>) {
    const c = cid;
    if (!c) return;
    const sid = sessionId;
    const key = crypto.randomUUID();
    listFor(sid).push({ key, name, progress: 0 });
    const entry = () => listFor(sid).find((a) => a.key === key);
    load()
      .then((file) => {
        thumbFromFile(sid, key, file);
        return uploadFile(c, file, (f) => {
          const a = entry();
          if (a) a.progress = f;
        });
      })
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

  /** Local connections use dropped paths in place; remote ones upload them. */
  function attachPaths(paths: string[]) {
    if (app.connectionMode === "local") {
      for (const path of paths) addLocal(path);
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

  // Desktop: onFileDrop covers the whole window, so only the panel under the cursor takes
  // the files. Browser handlers below stand down on desktop so a drop doesn't attach twice.
  let dragOver = $state(false);
  function underCursor({ x, y }: { x: number; y: number }): boolean {
    const el = boxEl?.closest("section.panel") ?? boxEl;
    const r = el?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  $effect(() => {
    if (!isDesktop) return;
    return onFileDrop((p) => {
      if (p.type === "leave") {
        dragOver = false;
      } else if (p.type === "enter" || p.type === "over") {
        dragOver = connected && !editingId && underCursor(p);
      } else if (p.type === "drop") {
        const hit = dragOver || (connected && !editingId && underCursor(p));
        dragOver = false;
        if (hit && p.paths.length) attachPaths(p.paths);
      }
    });
  });

  function onDragOver(e: DragEvent) {
    if (isDesktop || !e.dataTransfer?.types.includes("Files") || !connected) return;
    e.preventDefault();
    dragOver = true;
  }
  function onDrop(e: DragEvent) {
    if (isDesktop) return;
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

  // The "@query" token before the cursor, if any. Driven off list_files (§3.1) since the
  // client has no filesystem access of its own (§2a server mode).
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
    if (!mentionQuery || !filesRoot) return [];
    return fuzzyFilter(server?.filesByProject[filesRoot] ?? [], mentionQuery.query, 8);
  });

  // The "$name" token before the cursor, or "/name" as the message's first word: a skill to name in this
  // message (SPEC.md §3.1 "Skills"). Offered only the skills this chat's agent can load, and only once the
  // sign starts a word, so "$5" stays a price and a path in the middle of a sentence isn't a command.
  const agentKind = $derived(skillKindOf(server?.providers.find((p) => p.name === server?.providerBySession[sessionId])?.kind));
  const allSkills = $derived(filesRoot ? server?.skillsByProject[filesRoot]?.skills : undefined);
  const skillQuery = $derived.by(() => {
    if (mentionDismissed) return null;
    const m = /(?:^|\s)\$([A-Za-z][A-Za-z0-9._:-]{0,63}|)$/.exec(text.slice(0, cursorPos)) ?? /^\/([A-Za-z][A-Za-z0-9._:-]{0,63}|)$/.exec(text.slice(0, cursorPos));
    return m ? { start: cursorPos - m[1].length - 1, query: m[1], sign: text[cursorPos - m[1].length - 1] } : null;
  });
  const skillMatches = $derived(skillQuery ? pickableSkills(allSkills, skillQuery.query, agentKind).slice(0, 8) : []);
  const isCli = $derived(!!sessionModes(server, sessionId).cli);
  // The composer's own commands (/compact, /autocompact) share the "/" picker. Claude Code and the
  // API providers have them; any other coding agent compacts on its own terms and gets neither.
  const hasCompactCommands = $derived(!isCli || agentKind === "claude");
  const commandMatches = $derived(
    skillQuery?.sign === "/" && hasCompactCommands ? SLASH_COMMANDS.filter((c) => c.name.startsWith(skillQuery.query.toLowerCase())) : [],
  );
  const slashMatches = $derived([
    ...commandMatches.map((c) => ({ key: `/${c.name}`, name: c.name, hint: c.argumentHint, description: c.description, command: true, scope: "" })),
    ...skillMatches.map((sk) => ({ key: sk.dir, name: sk.name, hint: sk.argumentHint ?? "", description: sk.description, command: false, scope: sk.scope })),
  ]);
  const knownSkills = $derived(new Set(pickableSkills(allSkills, "", agentKind).map((s) => s.name)));
  $effect(() => {
    slashMatches;
    skillIndex = 0;
  });
  // Opening the picker rescans, so a SKILL.md added since the project was first listed is offered.
  const skillPickerOpen = $derived(!!skillQuery);
  $effect(() => {
    if (skillPickerOpen && filesRoot && cid && connected) untrack(() => listSkills(cid, filesRoot));
  });
  function pickSkill(name: string) {
    if (!skillQuery) return;
    const before = text.slice(0, skillQuery.start);
    const after = text.slice(skillQuery.start + 1 + skillQuery.query.length);
    text = `${before}${skillQuery.sign}${name} ${after.replace(/^ /, "")}`;
    const pos = before.length + name.length + 2;
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(pos, pos);
      cursorPos = pos;
    });
  }

  // The text split so mentions of known files draw as chips in a backdrop (.mirror) behind the
  // textarea, whose own text goes transparent while there are any. The chip can't pad or change
  // weight, or the backdrop's text would stop lining up with the caret.
  const knownFiles = $derived(new Set(filesRoot ? (server?.filesByProject[filesRoot] ?? []) : []));
  const composerRuns = $derived.by(() => {
    const runs: { text: string; path?: string; skill?: boolean }[] = [];
    const chips: { index: number; text: string; path?: string; skill?: boolean }[] = [];
    if (knownFiles.size) {
      for (const m of text.matchAll(new RegExp(MENTION_RE.source, "g"))) {
        // A trailing sentence period isn't part of the name, unless a line suffix follows it.
        const path = m[2] ? m[1] : [m[1], m[1].replace(/\.+$/, "")].find((p) => knownFiles.has(p));
        if (!path || !knownFiles.has(path)) continue;
        chips.push({ index: m.index, text: m[2] ? m[0] : "@" + path, path });
      }
    }
    if (knownSkills.size && (text.includes("$") || text.startsWith("/"))) {
      for (const m of text.matchAll(/(?<=^|\s)\$([A-Za-z][A-Za-z0-9._:-]{0,63})(?=$|[\s.,;:!?)])|^\/([A-Za-z][A-Za-z0-9._:-]{0,63})(?=$|[\s.,;:!?)])/g)) {
        if (knownSkills.has(m[1] ?? m[2])) chips.push({ index: m.index, text: m[0], skill: true });
      }
    }
    if (!chips.length) return runs;
    let last = 0;
    for (const c of chips.sort((a, b) => a.index - b.index)) {
      if (c.index < last) continue;
      if (c.index > last) runs.push({ text: text.slice(last, c.index) });
      runs.push({ text: c.text, path: c.path, skill: c.skill });
      last = c.index + c.text.length;
    }
    runs.push({ text: text.slice(last) });
    return runs;
  });
  let mirror = $state<HTMLDivElement>();
  $effect(() => {
    composerRuns;
    if (mirror && textarea) mirror.scrollTop = textarea.scrollTop;
  });

  /** A mention row's name or folder as runs, the fuzzy-matched characters marked. */
  function marked(path: string, from: number, to: number): { t: string; hit: boolean }[] {
    const hits = new Set(fuzzyIndices(path, mentionQuery?.query ?? ""));
    const out: { t: string; hit: boolean }[] = [];
    for (let i = from; i < to; i++) {
      const hit = hits.has(i);
      if (out.length && out[out.length - 1].hit === hit) out[out.length - 1].t += path[i];
      else out.push({ t: path[i], hit });
    }
    return out;
  }

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

  // The @ picker and file links in replies read this project's file list; opening a chat doesn't load it.
  $effect(() => {
    if (filesRoot && cid && connected && !server?.filesByProject[filesRoot]) listFiles(cid, filesRoot);
  });

  // Alphabetical, not recent-first: picking one would otherwise jump it to the top of the list.
  const projectItems = $derived(
    (server?.recentProjects ?? []).map((p) => ({ value: p, label: basename(p) })).sort((a, b) => a.label.localeCompare(b.label)),
  );
  function setProject(value: string | undefined) {
    if (value && cid) selectProject(cid, value);
  }

  // Only worth switching *between* once there's more than one: with 0 or 1
  // servers there's nothing to pick, so the plain "add/connect" button stays.
  const serverItems = $derived(
    Object.entries(app.servers).map(([scid, s]) => ({ value: scid, label: s.label })),
  );
  function setActiveServer(value: string | undefined) {
    if (!value || value === cid) return;
    // A fresh chat on that remote, so the project list and the chat itself both follow it. It
    // stays the kind you were in: a project chat lands in that remote's project (it has its own
    // list), and only a remote with none falls back to a plain chat.
    const next = app.servers[value];
    const project = isChat ? undefined : (next?.currentProjectPath ?? next?.recentProjects[0]);
    void newChat(value, project);
  }

  const animSpeed = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--anim-speed")) || 1;
  // The hero line swaps under the composer: the old one drops behind the box's top edge while the
  // new one rises out from it (same tuck as .hero.hidden).
  function tuck(node: HTMLElement, { out = false } = {}) {
    const speed = animSpeed();
    const drop = (node.closest(".stack") as HTMLElement).getBoundingClientRect().top - node.getBoundingClientRect().top;
    return {
      duration: (out ? 160 : 200) * speed,
      delay: out ? 0 : 60 * speed,
      easing: cubicOut,
      css: (t: number, u: number) => `transform: translateY(${u * drop}px); opacity: ${t}`,
    };
  }
  // A picker that fades out while its sibling slides over into the gap (the gap between them
  // closes with it, so nothing jumps when the node is finally removed).
  function collapse(node: HTMLElement) {
    const w = node.offsetWidth;
    const gap = parseFloat(getComputedStyle(node.parentElement!).columnGap) || 0;
    return {
      duration: 200 * animSpeed(),
      easing: cubicOut,
      css: (t: number, u: number) => `overflow: hidden; width: ${t * w}px; margin-right: ${-u * gap}px; opacity: ${t * t}`,
    };
  }

  // Permission requests and questions queue up; the oldest shows as a card above the composer
  // (AskCard), and the composer below becomes the "tell it what to do instead" note.
  const asks = $derived(server?.asksFor(sessionId) ?? []);
  let askCard = $state<AskCard>();
  // Keys only reach the card through the composer, so a new ask brings focus here if it's idle.
  $effect(() => {
    // Not on a phone: the keyboard would open over the card you need to answer.
    if (asks[0] && !viewport.narrow && document.activeElement === document.body) untrack(() => textarea?.focus());
  });

  const editingId = $derived(server?.editingMessageId[sessionId]);
  const editingText = $derived(
    editingId ? (server?.messagesBySession[sessionId]?.find((m) => m.id === editingId)?.text ?? "") : "",
  );

  function cancelEdit() {
    if (!cid) return;
    cancelEditingMessage(cid, sessionId);
    text = "";
  }

  function stop() {
    if (cid && turnId) cancelTurn(cid, sessionId, turnId);
  }

  // What the reply streaming right now is doing, for the status chip.
  const streamingMsg = $derived(server?.messagesBySession[sessionId]?.findLast((m) => m.streaming));
  const activity = liveActivity(() => streamingMsg);
  const showStatus = $derived(!floating && !asks.length && scrolledUp);

  // One button whose job follows the state: send, queue behind the running turn, stop it when
  // there's nothing to queue, or confirm an edit.
  const hasDraft = $derived(!!text.trim() || attachments.some((a) => a.path));
  // A plan the agent is waiting on: typing something is telling it what to change.
  const planAsk = $derived(server?.planAskFor(sessionId));
  const role = $derived<"send" | "queue" | "stop" | "confirm">(
    asks.length || (planAsk && hasDraft) ? "send" : editingId ? "confirm" : turnId && !hasDraft ? "stop" : turnId ? "queue" : "send",
  );
  const canSubmit = $derived(
    asks.length
      ? connected && !!text.trim()
      : planAsk && hasDraft
        ? connected && !!text.trim()
        : editingId
          ? connected && !!text.trim() && !turnId && !!projectPath && hasProvider
          : connected && hasDraft && !uploading && !!projectPath && hasProvider,
  );
  // A CLI agent can be given a message while it works; the server says so if this one can't.
  const canSteer = $derived(isCli);
  const primaryTitle = $derived(
    role === "stop"
      ? "Stop (Esc)"
      : asks.length
        ? "Tell it what to do instead"
        : !connected
          ? "Connect to a server first"
          : uploading
            ? "Waiting for uploads to finish"
            : !projectPath
              ? "Pick a project first"
              : !hasProvider
                ? "Pick a provider first"
                : role === "confirm"
                  ? turnId
                    ? "Wait for this turn to finish"
                    : "Send the edit"
                  : role === "queue"
                    ? canSteer
                      ? "Send into this turn (Ctrl+Enter queues until it ends)"
                      : "Queue until this turn ends"
                    : "Send",
  );

  /** Runs a /compact or /autocompact typed as the whole message; false = not one, send it as a message. */
  function runCommand(value: string): boolean {
    const cmd = hasCompactCommands ? parseSlashCommand(value) : null;
    // Claude Code runs its own /compact (and takes instructions after it), so that one is just sent.
    if (!cmd || !cid || (cmd.kind === "compact" && isCli)) return false;
    const say = (title: string) => app.toastAction(cid, title);
    if (cmd.kind === "compact") {
      if (turnId) say("Wait for this turn to finish, then /compact");
      else compactContext(cid, sessionId, cmd.instructions);
    } else if (cmd.kind === "invalid") say(cmd.message);
    else if (cmd.kind === "autocompact-help") {
      const ctx = server?.contextBySession[sessionId];
      say(
        ctx?.autoCompactOff
          ? "Auto-compact is off for this chat. /autocompact on turns it back on"
          : ctx?.budgetTokens
            ? `Compacts at ${shortNum(ctx.budgetTokens)} tokens. /autocompact off, default, or a size like 400k`
            : "/autocompact off, on, default, or a size like 400k",
      );
    } else {
      setModelOptions(cid, sessionId, { autoCompact: cmd.auto ?? undefined, autoCompactTokens: cmd.tokens ?? undefined });
      say(cmd.auto === false ? "Auto-compact is off for this chat" : cmd.tokens ? `This chat compacts at ${shortNum(cmd.tokens)} tokens` : "Auto-compact is back to the server's setting");
    }
    return true;
  }

  function submit(e?: Event, steer = true) {
    e?.preventDefault();
    const value = slashToSkill(text.trim(), knownSkills);
    if (!cid || !canSubmit) return;
    if (!planAsk && !asks.length && !editingId && runCommand(text.trim())) {
      text = "";
      return;
    }
    if (planAsk && !asks.length) {
      // A plan waiting on approval: what's typed is what to change about it.
      respondPermission(cid, sessionId, planAsk.turnId, planAsk.toolCallId, false, false, value);
      server?.removeAsk(planAsk.toolCallId);
    } else if (asks.length) {
      askCard?.dismissAll(value);
    } else if (editingId) {
      editMessage(cid, sessionId, editingId, value);
    } else if (steer && turnId && canSteer && !attachments.length && steerPrompt(cid, sessionId, value)) {
      // Into the turn that is running (steerPrompt); an agent that can't take it hands it back to the queue.
    } else {
      // Mid-turn is fine: it queues until the running turn ends (sendPrompt).
      sendPrompt(cid, sessionId, value, attachments.flatMap((a) => (a.path ? [a.path] : [])));
      for (const a of attachments) if (a.thumb) URL.revokeObjectURL(a.thumb);
      attachmentsBySession[sessionId] = [];
    }
    text = "";
  }

  // The $ picker reads this project's skills; the daemon rescans when asked, so a new SKILL.md shows up on the next chat.
  $effect(() => {
    if (filesRoot && cid && connected && !server?.skillsByProject[filesRoot]) listSkills(cid, filesRoot);
  });
  let focused = $state(false);

  // The + menu: context to add. A double click on it attaches files straight away.
  let addOpen = $state(false);
  const changedFiles = $derived(projectPath ? (server?.gitStatusByProject[projectPath]?.files ?? []) : []);
  const planClosed = $derived(!!server?.planBySession[sessionId] && server.openPlanSessionId !== sessionId);
  function mentionChanged() {
    server?.insertIntoComposer(sessionId, changedFiles.map((f) => mentionText(f.path)).join(" "));
  }

  function onKeydown(e: KeyboardEvent) {
    if (slashMatches.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        skillIndex = (skillIndex + (e.key === "ArrowDown" ? 1 : slashMatches.length - 1)) % slashMatches.length;
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSkill(slashMatches[skillIndex].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        mentionDismissed = true;
        return;
      }
    }
    if (mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mentionIndex = (mentionIndex + 1) % mentionMatches.length;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        mentionIndex = (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length;
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
    if (asks.length && askCard?.onComposerKey(e, !text.trim())) {
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && (editingId || turnId)) {
      e.preventDefault();
      if (editingId) cancelEdit();
      else stop();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // Mid-turn, steers by default (lands at the agent's next step); Ctrl/Cmd queues behind the turn instead.
      submit(e, !(e.metaKey || e.ctrlKey));
    }
  }
</script>

<div class="wrap" class:floating class:compact class:snap>
  <div class="dim" class:shown={dragOver}></div>
  <div class="stack" class:morphing bind:this={stackEl}>
    <h2 class="hero" class:hidden={!floating}>
      <!-- Keyed, so moving between an empty chat and an empty project rolls the line over
           instead of swapping it in one frame. Both lines share the grid cell while they cross. -->
      {#key projectName ?? (isChat ? "chat" : "none")}
        <span class="hero-text" in:tuck out:tuck={{ out: true }}>
          {#if projectName}What shall we build in <span class="hero-project">{projectName}</span>?{:else if isChat}What's on your mind?{:else}What shall we build?{/if}
        </span>
      {/key}
    </h2>

    {#if asks.length}
      <AskCard bind:this={askCard} {sessionId} {asks} />
    {/if}

    <div class="dock">
      <ChatNotices {sessionId} />
      <!-- Only while scrolled up: what the running turn is doing, and a way back down. Tucks
           behind the box's top edge otherwise. -->
      <div class="status" class:shown={showStatus} inert={!showStatus} aria-hidden={!showStatus}>
        {#if turnId}
          <span class="activity">
            <DotMatrix mode={activity.mode} size={12} />
            <span class="activity-label">
              {#key activity.label}
                <span in:fly={{ y: 6, duration: 140 }}>{activity.label || "Working"}</span>
              {/key}
            </span>
            <span class="activity-time">{activity.elapsed}</span>
          </span>
        {/if}
        <button type="button" class="jump" class:solo={!turnId} onclick={() => onJump?.()} {@attach tip("Jump to latest")}>
          {#if !turnId}Jump to latest{/if}
          <Icon name="arrow-narrow-down" size={14} />
        </button>
      </div>

      <form
        class="box"
        class:editing={!!editingId && !asks.length}
        class:drag-over={dragOver}
        bind:this={boxEl}
        onsubmit={submit}
        ondragover={onDragOver}
        ondragleave={() => isDesktop || (dragOver = false)}
        ondrop={onDrop}
      >
        {#if dragOver}
          <div class="drop-hint"><Icon name="paperclip" size={14} /> Drop to attach</div>
        {/if}

        {#if editingId && !asks.length}
          <div class="editing-strip" transition:slide={{ duration: 160 }}>
            <Icon name="pencil" size={12} />
            <span class="editing-label">Editing</span>
            <span class="editing-quote">{editingText}</span>
            <button type="button" class="editing-cancel" {@attach tip("Cancel editing", "Escape")} onclick={cancelEdit}>
              <kbd>Esc</kbd><Icon name="xmark" size={12} />
            </button>
          </div>
        {/if}

        {#if attachments.length && !editingId}
          <ul class="attachments" transition:slide={{ duration: 160 }}>
            {#each attachments as a (a.key)}
              <li
                class:error={!!a.error}
                {@attach tip(a.error ?? a.path ?? `Uploading ${a.name}…`)}
                in:scale={{ start: 0.9, duration: 140, easing: cubicOut }}
              >
                {#if a.error}
                  <Icon name="alert-circle" size={14} />
                {:else if a.thumb}
                  <img class="thumb" class:loading={!a.path} src={a.thumb} alt="" />
                {:else if !a.path}
                  <svg class="ring" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6" />
                    <circle cx="8" cy="8" r="6" class="bar" style:stroke-dasharray="{(a.progress ?? 0) * 37.7} 37.7" />
                  </svg>
                {:else}
                  <img class="ficon" src={fileIconUrl(a.name)} alt="" />
                {/if}
                <span class="name">{a.name}</span>
                <button type="button" {@attach tip("Remove")} onclick={() => removeAttachment(a.key)}>
                  <Icon name="xmark" size={11} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="input-area">
          {#if composerRuns.length}
            <div class="mirror" aria-hidden="true" bind:this={mirror}>{#each composerRuns as r}{#if r.skill}<span class="m-chip m-skill">{r.text}</span>{:else if r.path}<span class="m-chip"><span class="m-at" style:background-image={`url("${fileIconUrl(r.path.split("/").pop() ?? r.path)}")`}>@</span>{r.text.slice(1)}</span>{:else}{r.text}{/if}{/each}&#8203;</div>
          {/if}
          <textarea
            bind:this={textarea}
            class:decorated={composerRuns.length > 0}
            onscroll={() => mirror && textarea && (mirror.scrollTop = textarea.scrollTop)}
            bind:value={text}
            onkeydown={onKeydown}
            onpaste={onPaste}
            onkeyup={trackCursor}
            onclick={trackCursor}
            onfocus={() => (focused = true)}
            onblur={() => (focused = false)}
            oninput={() => {
              autosize();
              trackCursor();
            }}
            placeholder={asks.length
              ? asks.length > 1
                ? `Or tell it what to do instead (answers all ${asks.length})…`
                : "Or tell it what to do instead…"
              : !projectPath
                ? "Pick a project in the sidebar to chat…"
                : floating
                  ? isChat ? "Ask anything…" : "Ask anything about this project…"
                  : editingId
                    ? "Edit your message…"
                    : turnId
                      ? "Queue a follow-up…"
                      : "Reply…"}
            rows="1"
          ></textarea>
          <span class="hint" class:shown={focused && !text && !compact && !asks.length && !!projectPath} aria-hidden="true">
            <kbd>⏎</kbd> {turnId && !editingId ? (canSteer ? "steer" : "queue") : "send"} · <kbd>⇧⏎</kbd> newline
          </span>
        </div>

        <div class="toolbar-clip" inert={compact}>
          <div class="toolbar">
            <DropdownMenu.Root bind:open={addOpen}>
              <DropdownMenu.Trigger
                class="add-chip"
                {@attach tip("Add context (double-click to attach files)")}
                ondblclick={() => {
                  addOpen = false;
                  void attachFile();
                }}
              >
                <Icon name="paperclip" size={14} />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  class="context-menu"
                  side="bottom"
                  align="start"
                  sideOffset={6}
                  collisionPadding={8}
                  onCloseAutoFocus={(e) => {
                    e.preventDefault();
                    textarea?.focus();
                  }}
                >
                  <DropdownMenu.Item class="context-menu-item" disabled={!connected || !!editingId} onSelect={attachFile}>
                    <Icon name="paperclip" size={13} />
                    <span>{app.connectionMode === "local" ? "Attach files" : "Upload files"}</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item class="context-menu-item" disabled={!projectPath} onSelect={insertMention}>
                    <Icon name="at-sign" size={13} />
                    <span>Mention a file</span>
                  </DropdownMenu.Item>
                  {#if changedFiles.length}
                    <DropdownMenu.Item class="context-menu-item" onSelect={mentionChanged}>
                      <Icon name="file-diff" size={13} />
                      <span>Mention changed files ({changedFiles.length})</span>
                    </DropdownMenu.Item>
                  {/if}
                  {#if planClosed}
                    <DropdownMenu.Item class="context-menu-item" onSelect={() => server && (server.openPlanSessionId = sessionId)}>
                      <Icon name="clipboard-list" size={13} />
                      <span>Open the plan</span>
                    </DropdownMenu.Item>
                  {/if}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
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
            <div class="pickers">
              <ModelPicker {sessionId} />
              <EffortPicker {sessionId} />
              <ModePicker {sessionId} />
              <ContextRing {sessionId} />
            </div>
          </div>
        </div>

        <!-- Pinned to the corner, so it stays put while the toolbar collapses under it. -->
        <button
          type={role === "stop" ? "button" : "submit"}
          class="primary {role}"
          class:ready={role === "stop" || canSubmit}
          disabled={role !== "stop" && !canSubmit}
          {@attach tip(primaryTitle)}
          aria-label={primaryTitle}
          onclick={role === "stop" ? stop : undefined}
        >
          <span class="glyph" class:on={role === "send"}><Icon name="send" size={15} /></span>
          <span class="glyph" class:on={role === "queue"}>
            <Icon name="send" size={15} />
            <span class="badge"><Icon name="clock" size={9} /></span>
          </span>
          <span class="glyph" class:on={role === "stop"}><Icon name="player-stop" size={14} /></span>
          <span class="glyph" class:on={role === "confirm"}><Icon name="check" size={16} /></span>
        </button>
      </form>

      <!-- Sibling of the form, not a child: the form's own backdrop-filter is a backdrop root, so a
           blur inside it would have nothing to sample. -->
      {#if slashMatches.length > 0}
        <ul
          class="mentions skills"
          role="listbox"
          aria-label="Commands and skills"
          in:fly={{ y: 8, duration: 160, easing: cubicOut }}
          out:fly={{ y: 6, duration: 120, easing: cubicIn }}
        >
          {#each slashMatches as sk, i (sk.key)}
            <li role="option" aria-selected={i === skillIndex}>
              <button type="button" class:active={i === skillIndex} onclick={() => pickSkill(sk.name)}>
                <Icon name={sk.command ? "arrows-minimize" : "sparkles"} size={13} />
                <span class="m-name">{skillQuery?.sign ?? "$"}{sk.name}{#if sk.hint}<span class="m-arg"> {sk.hint}</span>{/if}</span>
                <span class="m-dir">{sk.description}</span>
                {#if sk.scope === "project"}<span class="m-scope">project</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {:else if mentionMatches.length > 0}
        <ul
          class="mentions"
          in:fly={{ y: 8, duration: 160, easing: cubicOut }}
          out:fly={{ y: 6, duration: 120, easing: cubicIn }}
        >
          {#each mentionMatches as file, i (file)}
            {@const cut = file.lastIndexOf("/") + 1}
            <li>
              <button type="button" class:active={i === mentionIndex} onclick={() => pickMention(file)}>
                <img class="ficon" src={fileIconUrl(file.slice(cut))} alt="" />
                <span class="m-name">{#each marked(file, cut, file.length) as run}{#if run.hit}<mark>{run.t}</mark>{:else}{run.t}{/if}{/each}</span>
                <span class="m-dir">{#each marked(file, 0, Math.max(0, cut - 1)) as run}{#if run.hit}<mark>{run.t}</mark>{:else}{run.t}{/if}{/each}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div
      class="float-controls"
      class:tucked={!floating}
      inert={!floating}
      aria-hidden={!floating}
    >
      {#if projectPath !== CHAT_PROJECT}
      <div class="fc-slot" transition:collapse>
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
      </div>
      {/if}
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
          {@attach tip("Servers")}
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
  /* Overlays .body instead of sharing flex flow with MessageList, so .stack below can slide
     between a bottom dock and vertical center with one animated `top`/`transform` pair. */
  .wrap {
    position: absolute;
    inset: 0;
    pointer-events: none;
    /* Own stacking context, so ::after's negative z-index only reorders against .wrap's own
       children; otherwise it'd resolve against .body (ChatPanel.svelte) and end up entirely
       behind MessageList instead of tucking under the box. */
    isolation: isolate;
  }
  /* Scrim behind the floating composer so it stays legible over a busy wallpaper (shown only
     pre-first-message). Background-only paint, no filter/blur, so it's cheap to animate. */
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
    transition: opacity calc(0.2s * var(--anim-speed, 1)) ease;
  }
  /* Moving between chats: the layout change lands in one frame, not the slide. */
  .wrap.snap :is(*, *::before, *::after) {
    transition: none !important;
  }
  .wrap.floating::before {
    /* Gone by the time the feed's cards are under it (EmptyFeed.svelte), or it would dim them. */
    opacity: clamp(0, calc(1 - var(--feed-scroll, 0px) / 160px), 1);
  }
  /* Fades scrolled-under transcript text instead of a hard cut at the box's edge. Height
     matches MessageList's reserved bottom padding (--composer-height + 56px, see .rows there,
     room for the status chip included) exactly, so it only covers the blank buffer zone, never
     an unscrolled message's footer. */
  .wrap::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(var(--composer-height, 90px) + 56px);
    background: linear-gradient(to bottom, transparent, var(--panel-bg) 65%);
    opacity: 0;
    /* Behind .stack: ::after otherwise paints after it in DOM order and would cover the box. */
    z-index: -1;
    transition: opacity calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .wrap:not(.floating)::after {
    opacity: 1;
  }
  /* Floating switches to the vertical-center equivalent using the same functions/units, so
     the browser interpolates the move instead of snapping. */
  .stack {
    --morph: calc(0.2s * var(--anim-speed, 1));
    position: absolute;
    left: 50%;
    top: calc(100% - 1.14rem);
    /* Docked width is wider since a one-line bar reads better spanning more of the panel. */
    width: min(45.71rem, calc(100% - 3.43rem));
    transform: translate(-50%, -100%);
    pointer-events: auto;
    transition:
      top var(--morph) ease,
      transform var(--morph) ease,
      width var(--morph) ease,
      translate var(--morph) ease;
  }
  .wrap.floating .stack {
    /* Carried off the top by the empty chat's feed as it scrolls (EmptyFeed.svelte). Left out of
       the transition so it tracks the wheel; docking brings it back to 0 with the morph. */
    translate: 0 calc(-1 * var(--feed-scroll, 0px));
    transition:
      top var(--morph) ease,
      transform var(--morph) ease,
      width var(--morph) ease;
    /* Centered on the visible body below the header, not the whole panel: .wrap spans behind
       the overlaid header, so a plain 50% would sit too high. */
    top: calc(50% + var(--header-height) / 2);
    width: min(36rem, calc(100% - 3.43rem));
    transform: translate(-50%, -50%);
  }
  .hero {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 1.7rem);
    display: grid;
    justify-items: center;
    transform: translateX(-50%) translateY(0);
    margin: 0;
    /* Shrinks off the panel's width (.body's container-type in ChatPanel.svelte) before it
       can overflow a narrow panel, rather than clipping or forcing it wider. */
    font-size: clamp(1.15rem, 6cqi, 1.7rem);
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    opacity: 1;
    z-index: -1;
    transition:
      opacity var(--morph, calc(0.2s * var(--anim-speed, 1))) ease,
      transform var(--morph, calc(0.2s * var(--anim-speed, 1))) ease,
      bottom var(--morph, calc(0.2s * var(--anim-speed, 1))) ease;
  }
  .hero-text {
    grid-area: 1 / 1;
  }
  /* The "No sandbox" tab sits over the box's top edge. While floating it's out of the stack's
     flow, so it can't shift the box (which is centred on the stack) when you move between a
     chat that has one and a chat that doesn't; the hero rises to clear it instead. */
  .wrap.floating :global(.notices) {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
  }
  .wrap.floating .stack:has(:global(.notices)) .hero {
    bottom: calc(100% + 3.6rem);
  }
  .fc-slot {
    display: flex;
  }
  /* Keeps its natural width while the slot collapses around it (see `collapse`), so the label is
     clipped rather than squeezed into an ellipsis. */
  .fc-slot > :global(.dropdown-trigger) {
    flex: none;
  }
  /* Slides down into the box's own footprint (sits behind it, see z-index below) instead of
     fading in place, so it visibly tucks away under the composer. */
  /* Fades as the feed carries it up, so it doesn't run under the header's pills. */
  .wrap.floating .hero:not(.hidden) {
    opacity: clamp(0, calc(1 - var(--feed-scroll, 0px) / 110px), 1);
  }
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
  /* Below the composer; slides up to tuck away behind it once the chat has a first message,
     instead of just fading in place. Left-aligned to the composer's edge. */
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
  /* Pill chrome shared by the project picker and local/remote switch. Global because the
     Dropdown's trigger element belongs to Dropdown.svelte. Nothing shows at rest (no fill,
     outline, or blur); all fade in together on hover/open. */
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
    border-color: var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    color: var(--text);
  }
  /* Restated qualified with .dropdown-trigger so this wins on specificity over Dropdown's
     own equal-specificity trigger rules, not stylesheet order (same as .mode-trigger above). */
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
    border-color: var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    color: var(--text);
  }
  .box {
    position: relative;
    /* Above .hero, .float-controls and .status (all lower), so they tuck away visibly behind
       its solid background. */
    z-index: 1;
    width: 100%;
    /* A floating surface, see the --float-* tokens in app.css: the plain panel
       fill by default, translucent over a backdrop blur when Settings >
       Appearance > Surfaces is set to Frosted. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    /* Concentric with the send button: button radius (1rem) + its inset padding (0.57rem)
       = 22px at the 14px root size. Right/bottom padding kept equal so the corners nest. */
    border-radius: 22px;
    padding: 0.71rem var(--space-1) var(--space-1);
    transition:
      border-color var(--room-fade, calc(0.15s * var(--anim-speed, 1))) ease,
      padding var(--morph) ease,
      transform calc(0.15s * var(--anim-speed, 1)) ease,
      box-shadow var(--room-fade, calc(0.15s * var(--anim-speed, 1))) ease;
  }
  .box:focus-within {
    border-color: color-mix(in srgb, var(--text) 24%, transparent);
  }
  .box.editing {
    border-color: var(--accent);
  }
  /* Dragging files over the chat: everything else dims and the composer lifts to take them. */
  .box.drag-over {
    border-color: var(--accent);
    transform: scale(1.01);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .dim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    opacity: 0;
    pointer-events: none;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .dim.shown {
    opacity: 1;
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
  .dock {
    position: relative;
  }
  /* Rises out from behind the box's top edge: tucked, it sits inside the box's footprint. */
  .status {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 0.5rem);
    z-index: 0;
    display: flex;
    align-items: center;
    gap: 0.57rem;
    max-width: calc(100% - 2rem);
    height: 1.86rem;
    padding: 0 0.29rem 0 0.71rem;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-pill);
    color: var(--text-dim);
    font-size: var(--text-label-size);
    white-space: nowrap;
    opacity: 0;
    transform: translate(-50%, calc(100% + 0.5rem)) scale(0.96);
    pointer-events: none;
    transition:
      opacity calc(0.2s * var(--anim-speed, 1)) ease,
      transform calc(0.24s * var(--anim-speed, 1)) cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .status.shown {
    opacity: 1;
    transform: translate(-50%, 0);
    pointer-events: auto;
  }
  .activity {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    color: var(--text);
  }
  .activity-label {
    position: relative;
    min-width: 0;
    max-width: 20rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .activity-time {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .jump {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.29rem;
    height: 1.43rem;
    min-width: 1.43rem;
    padding: 0 0.29rem;
    border: none;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  /* Icon-only: .status's own padding (0.71rem/0.29rem) is sized for the activity label
     beside it, not for this button alone. Cancel it out and reapply the same 0.215rem
     gap the button already gets top/bottom from being centered in the taller pill
     ((1.86rem status height - 1.43rem button height) / 2). */
  .jump.solo {
    margin: 0 -0.075rem 0 -0.495rem;
    padding: 0 0.215rem;
    background: none;
  }
  .jump:hover {
    background: rgba(255, 255, 255, 0.14);
  }
  .editing-strip {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    margin: -0.14rem 0 0.43rem;
    padding: 0.29rem 0.29rem 0.29rem 0.57rem;
    border-left: 2px solid var(--accent);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--accent);
    font-size: var(--text-label-size);
  }
  .editing-label {
    font-weight: 600;
  }
  .editing-quote {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
  }
  .editing-cancel {
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    padding: 0.14rem 0.29rem;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-dim);
    cursor: pointer;
  }
  .editing-cancel:hover {
    color: var(--text);
  }
  kbd {
    font-family: inherit;
    font-size: 0.7rem;
    opacity: 0.75;
  }
  .input-area {
    position: relative;
  }
  textarea {
    display: block;
    width: 100%;
    resize: none;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.92rem;
    line-height: 1.5;
    outline: none;
    /* Lines the text's left edge up with the + button's glyph below it. */
    padding: 0 0 0 calc((1.86rem - 14px) / 2);
    /* Matches MAX_TEXTAREA_HEIGHT in the script; scrolls internally past this instead of
       pushing the toolbar off the panel. */
    max-height: 240px;
    overflow-y: auto;
  }
  /* Draws the textarea's text, chips and all, underneath it: same box, font and wrapping. */
  .mirror {
    position: absolute;
    inset: 0;
    padding: 0 0 0 calc((1.86rem - 14px) / 2);
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: break-word;
    overflow-y: auto;
    scrollbar-color: transparent transparent;
    pointer-events: none;
  }
  textarea.decorated {
    position: relative;
    color: transparent;
    caret-color: var(--text);
  }
  /* Messages' mention chip (Markdown.svelte), minus padding: a box-shadow ring stands in for it. */
  .m-chip {
    color: color-mix(in srgb, var(--accent) 60%, var(--text));
    background: var(--accent-dim);
    box-shadow: 0 0 0 0.15em var(--accent-dim);
    border-radius: var(--radius-sm);
    box-decoration-break: clone;
  }
  .m-skill {
    color: color-mix(in srgb, var(--success) 60%, var(--text));
    background: color-mix(in srgb, var(--success) 14%, transparent);
    box-shadow: 0 0 0 0.15em color-mix(in srgb, var(--success) 14%, transparent);
  }
  .m-arg {
    font-weight: 400;
    color: var(--text-dim);
  }
  .m-scope {
    flex-shrink: 0;
    font-size: 0.68rem;
    color: var(--accent);
  }
  .skills .m-dir {
    direction: ltr;
  }
  /* The file's icon over the @ it stands in for, so the text keeps its width. */
  .m-at {
    color: transparent;
    background: center / contain no-repeat;
  }
  /* autosize() writes height on every keystroke, but only the floating/docked and compact
     morphs should animate; scoping the transition to .stack.morphing keeps typing instant. */
  .stack.morphing textarea {
    transition: height var(--morph) ease;
  }
  .hint {
    position: absolute;
    top: 0;
    right: 0;
    line-height: 1.38rem;
    color: var(--text-dim);
    font-size: var(--text-label-size);
    opacity: 0;
    pointer-events: none;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .hint.shown {
    opacity: 0.6;
  }
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
    gap: 0.36rem;
    max-width: 16rem;
    height: 1.71rem;
    padding: 0 0.29rem 0 0.29rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
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
  .thumb {
    width: 1.29rem;
    height: 1.29rem;
    border-radius: var(--radius-xs);
    object-fit: cover;
    transition: opacity calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .thumb.loading {
    opacity: 0.45;
  }
  .ficon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  .ring {
    width: 1rem;
    height: 1rem;
    transform: rotate(-90deg);
    fill: none;
    stroke-width: 2.5;
    stroke: color-mix(in srgb, var(--text) 15%, transparent);
  }
  .ring .bar {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dasharray calc(0.2s * var(--anim-speed, 1)) ease;
  }
  /* The composer's own width, rising from its top edge. */
  .mentions {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 0.43rem);
    margin: 0;
    padding: var(--space-half);
    list-style: none;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    z-index: 5;
  }
  .mentions button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 0.36rem var(--space-1);
    border-radius: var(--radius-sm);
    font-size: var(--text-label-size);
    cursor: pointer;
    white-space: nowrap;
  }
  .mentions button.active {
    background: var(--sidebar-active);
  }
  .m-name {
    font-weight: 600;
  }
  .m-dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-dim);
    direction: rtl;
    text-align: left;
  }
  mark {
    background: none;
    color: var(--accent);
  }
  /* Collapses to nothing when compact (0fr), leaving the text field and the send button. */
  .toolbar-clip {
    display: grid;
    grid-template-rows: 1fr;
    margin-top: 0.43rem;
    transition:
      grid-template-rows var(--morph) ease,
      margin-top var(--morph) ease,
      opacity var(--morph) ease;
  }
  .toolbar {
    min-height: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    /* Room for the send button pinned in the corner. */
    padding-right: 2.43rem;
  }
  .pickers {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    min-width: 0;
  }
  :global(.add-chip) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 1.86rem;
    height: 1.86rem;
    /* Border stays a real 1px box in every state rather than being dropped, so hovering
       can't nudge the chip's content by a pixel. */
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  :global(.add-chip:hover),
  :global(.add-chip[data-state="open"]) {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  /* Neutral until there's something to send, then the accent: it lights up when ready. */
  .primary {
    position: absolute;
    right: var(--space-1);
    bottom: var(--space-1);
    z-index: 1;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: none;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-dim);
    cursor: default;
    transition:
      background calc(0.15s * var(--anim-speed, 1)) ease,
      color calc(0.15s * var(--anim-speed, 1)) ease,
      bottom var(--morph) ease;
  }
  .primary.ready {
    background: var(--accent);
    color: #0d1020;
    cursor: pointer;
  }
  .primary.stop {
    background: var(--text);
    color: var(--panel-bg);
  }
  .glyph {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: scale(0.6);
    transition:
      opacity calc(0.15s * var(--anim-speed, 1)) ease,
      transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .glyph.on {
    opacity: 1;
    transform: none;
  }
  .badge {
    position: absolute;
    right: 3px;
    bottom: 3px;
    display: flex;
    padding: 1px;
    border-radius: 50%;
    background: var(--accent);
  }

  /* Scrolled up: one row, the text field and the send button beside it. */
  .wrap.compact .box {
    padding: var(--space-1);
  }
  .wrap.compact :is(textarea, .mirror) {
    padding-block: calc((2rem - 1.38rem) / 2);
    padding-right: 2.57rem;
  }
  .wrap.compact .toolbar-clip {
    grid-template-rows: 0fr;
    margin-top: 0;
    opacity: 0;
  }

  /* Narrow (a split, or a small window): tighter to the edges and less rounded, like a phone's
     composer, with the model and mode pickers merged into one icon-only pill. */
  @container (max-width: 36rem) {
    .stack,
    .wrap.floating .stack {
      width: calc(100% - 1rem);
    }
    .stack {
      top: calc(100% - 0.5rem);
    }
    .box {
      border-radius: 16px;
    }
    .hint {
      display: none;
    }
    .pickers {
      gap: 0;
      border-radius: var(--radius-pill);
      background: rgba(255, 255, 255, 0.05);
    }
    .pickers :global(.picker-trigger) {
      padding: 0 0.5rem;
    }
    .pickers :global(.trigger-label) {
      display: none;
    }
  }

  /* Phone: nothing floats. The composer and whatever stacks on it (ask, notices, status) are flush
     strips along the bottom edge, so it reads as part of the page rather than a card on it. */
  @media (max-width: 700px) {
    .stack,
    .wrap.floating .stack {
      left: 0;
      right: 0;
      top: auto;
      bottom: 0;
      width: 100%;
      transform: none;
      translate: none;
    }
    /* Full width, flush to the bottom, corners still rounded at the top. */
    .box {
      border-radius: 22px 22px 0 0;
      border-bottom-width: 0;
      padding-inline: var(--space-1);
    }
    .pickers {
      background: none;
    }
    .jump {
      height: 2.4rem;
      min-width: 2.4rem;
    }
    /* The new-chat greeting sits in the middle of what the composer leaves. */
    .hero {
      bottom: calc(100% + 24dvh);
      z-index: 0;
    }
    /* The composer carries its own fill now, so nothing needs washing out behind it. */
    .wrap::before {
      display: none;
    }
    .wrap.floating .stack:has(:global(.notices)) .hero {
      bottom: calc(100% + 24dvh);
    }
    .wrap.floating :global(.notices) {
      position: relative;
      inset: auto;
    }
    .float-controls {
      top: auto;
      bottom: calc(100% + 0.4rem);
    }
    :global(.fc-pill) {
      min-height: 2.4rem;
      background: none;
      border-color: transparent;
      box-shadow: none;
    }
    /* Wraps instead of running off the panel. */
    .hero {
      width: max-content;
      max-width: calc(100cqi - 2rem);
      white-space: normal;
      text-align: center;
      font-size: 1.3rem;
    }
    .toolbar {
      padding-right: 3.2rem;
    }
    :global(.add-chip) {
      width: 2.8rem;
      height: 2.8rem;
    }
    .pickers :global(.picker-trigger) {
      min-height: 2.8rem;
      min-width: 2.8rem;
      justify-content: center;
    }
    .hint {
      display: none;
    }
    .primary {
      width: 3rem;
      height: 3rem;
    }
    .wrap.compact :is(textarea, .mirror) {
      padding-block: calc((3rem - 1.38rem) / 2);
      padding-right: 3.2rem;
    }
  }
</style>
