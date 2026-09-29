<script lang="ts" module>
  import { EditorView, basicSetup } from "codemirror";
  import { Compartment, EditorState } from "@codemirror/state";
  import { keymap } from "@codemirror/view";
  import { matches } from "../../keybinds.svelte";
  import { indentWithTab } from "@codemirror/commands";
  import { gotoLine } from "@codemirror/search";
  import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
  import { languages } from "@codemirror/language-data";
  import { tags as t } from "@lezer/highlight";

  // @codemirror/language-data has no Svelte entry; add it the same way it wires up Vue.
  const allLanguages = [
    ...languages,
    LanguageDescription.of({
      name: "Svelte",
      extensions: ["svelte"],
      load: () => import("@replit/codemirror-lang-svelte").then((m) => m.svelte()),
    }),
  ];

  // Same --syn-* palette, font and background as chat code blocks (Markdown.svelte), so the editor
  // follows Settings > Appearance > Code blocks.
  const highlight = HighlightStyle.define([
    { tag: [t.comment, t.meta], color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: "var(--syn-keyword)" },
    { tag: [t.string, t.regexp, t.special(t.string)], color: "var(--syn-string)" },
    { tag: [t.number, t.bool, t.null, t.atom, t.attributeName], color: "var(--syn-number)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.heading], color: "var(--syn-function)" },
    { tag: [t.typeName, t.className, t.namespace, t.tagName], color: "var(--syn-type)" },
    { tag: [t.variableName, t.definition(t.variableName)], color: "var(--syn-variable)" },
    { tag: t.strong, fontWeight: "bold" },
    { tag: t.emphasis, fontStyle: "italic" },
  ]);

  const theme = EditorView.theme({
    "&": { height: "100%", color: "var(--code-fg, var(--text))", backgroundColor: "var(--code-bg, transparent)" },
    ".cm-scroller": { fontFamily: "var(--code-font-family, ui-monospace, monospace)", fontSize: "var(--code-font-size, 0.8rem)" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-dim)", border: "none" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--accent) 7%, transparent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent) !important",
    },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    // Search/replace and go-to-line panels, in the app's own control style instead of CodeMirror's defaults.
    ".cm-panels": { backgroundColor: "var(--float-bg)", color: "var(--text)" },
    ".cm-panels-top": { borderBottom: "1px solid var(--panel-border)" },
    ".cm-panels-bottom": { borderTop: "1px solid var(--panel-border)" },
    ".cm-panel.cm-search, .cm-panel.cm-gotoLine": { padding: "0.43rem 2rem 0.43rem 0.57rem", fontSize: "var(--text-label-size)" },
    ".cm-panel input, .cm-panel button": { font: "inherit", fontSize: "var(--text-label-size)" },
    ".cm-textfield": {
      margin: "0.14rem 0.29rem 0.14rem 0",
      padding: "0.21rem 0.5rem",
      background: "rgba(255, 255, 255, 0.04)",
      border: "1px solid var(--panel-border)",
      borderRadius: "var(--radius-sm)",
      color: "var(--text)",
      outline: "none",
    },
    ".cm-textfield:focus": { borderColor: "color-mix(in srgb, var(--accent) 60%, var(--panel-border))" },
    ".cm-button": {
      margin: "0.14rem 0.29rem 0.14rem 0",
      padding: "0.21rem 0.57rem",
      backgroundImage: "none",
      background: "rgba(255, 255, 255, 0.06)",
      border: "1px solid var(--panel-border)",
      borderRadius: "var(--radius-sm)",
      color: "var(--text)",
      cursor: "pointer",
    },
    ".cm-button:hover": { background: "var(--sidebar-hover)" },
    ".cm-button:active": { backgroundImage: "none", background: "color-mix(in srgb, var(--accent) 14%, transparent)" },
    ".cm-panel.cm-search label": {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.21rem",
      marginRight: "0.57rem",
      color: "var(--text-dim)",
      fontSize: "var(--text-label-size)",
      cursor: "pointer",
    },
    ".cm-panel.cm-search input[type=checkbox]": { margin: 0, accentColor: "var(--accent)" },
    ".cm-panel.cm-search [name=close]": {
      top: "0.43rem",
      right: "0.43rem",
      padding: "0 0.36rem",
      borderRadius: "var(--radius-sm)",
      color: "var(--text-dim)",
      fontSize: "1rem",
      cursor: "pointer",
    },
    ".cm-panel.cm-search [name=close]:hover": { background: "var(--sidebar-hover)", color: "var(--text)" },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
      outline: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)",
      borderRadius: "2px",
    },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--accent) 45%, transparent)" },
    ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)" },
  });
</script>

<script lang="ts">
  import { tip } from "../../tooltip.svelte";
  import { onDestroy, untrack } from "svelte";
  import { app } from "../../state.svelte";
  import { readFile, readMedia, writeFile } from "../../ipc";
  import { refreshWhenVisible } from "../../refresh.svelte";
  import { mentionText } from "../../mentions";
  import Icon from "../Icon.svelte";

  let {
    sessionId,
    projectPath,
    path,
    from,
    to,
    visible = true,
    dirty = $bindable(false),
  }: {
    sessionId: string;
    projectPath: string;
    path: string;
    from?: number;
    to?: number;
    visible?: boolean;
    dirty?: boolean;
  } = $props();

  const server = $derived(app.active);
  const cid = $derived(app.activeConnectionId);
  const name = $derived(path.split("/").pop() ?? path);

  // Extensions the explorer previews instead of opening as text (matches the server's own
  // read_media allow-list). Decided by extension up front: read_file's 2MB text cap would
  // otherwise turn away nearly every video before the preview got a chance.
  type MediaKind = "image" | "video" | "audio" | "pdf" | "font";
  const MEDIA_KIND: Record<string, MediaKind> = {};
  for (const [kind, exts] of Object.entries({
    image: "png jpg jpeg jfif gif webp bmp ico cur svg avif apng",
    video: "mp4 m4v webm ogv mov",
    audio: "mp3 wav ogg oga opus flac m4a aac",
    pdf: "pdf",
    font: "ttf otf woff woff2",
  })) for (const ext of exts.split(" ")) MEDIA_KIND[ext] = kind as MediaKind;
  const ext = $derived(name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
  // SVG is text too: it previews by default but can flip to the editor.
  let showSource = $state(false);
  const mediaKind = $derived(showSource ? null : (MEDIA_KIND[ext] ?? null));

  let media = $state<{ kind: MediaKind; url: string; size: number; font?: FontFace } | null>(null);
  let dims = $state(""); // an image's or video's natural size, once it has loaded
  let mediaSeq = 0; // bumps on every (re)load and on destroy, so a stale fetch drops its result
  function setMedia(next: typeof media) {
    if (media && media.url !== next?.url) {
      URL.revokeObjectURL(media.url);
      if (media.font) document.fonts.delete(media.font);
    }
    media = next;
    dims = "";
  }
  const FONT_SAMPLE = "The quick brown fox jumps over the lazy dog";
  let fontSample = $state(FONT_SAMPLE);

  function formatSize(n: number) {
    return n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`;
  }

  let host = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;
  const language = new Compartment();
  const wrapping = new Compartment();
  const wrapExt = (on: boolean) => (on ? EditorView.lineWrapping : []);

  let version = $state(""); // what disk had when we last read or saved
  let notice = $state<string | null>(null); // binary, too large, or a load error: no editor then
  let conflict = $state<string | null>(null); // disk's version when it no longer matches ours
  let saving = $state(false);
  let error = $state("");
  let languageName = $state("Plain text");
  // Status line: where the cursor is and how much is selected.
  let cursor = $state({ line: 1, col: 1, chars: 0, lines: 0 });
  // The "Ask about this" pill: shown where a mouse selection was released, until it changes.
  let pill = $state<{ x: number; y: number } | null>(null);

  function select(lineFrom?: number, lineTo?: number) {
    if (!view || !lineFrom) return;
    const doc = view.state.doc;
    const a = doc.line(Math.min(lineFrom, doc.lines));
    const b = doc.line(Math.min(Math.max(lineTo ?? lineFrom, lineFrom), doc.lines));
    view.dispatch({ selection: { anchor: a.from, head: b.to }, effects: EditorView.scrollIntoView(a.from, { y: "center" }) });
  }

  async function load() {
    if (!cid) return;
    if (mediaKind) return void loadMediaPreview(mediaKind);
    const r = await readFile(cid, projectPath, path).catch((e) => ({ error: String(e) }) as const);
    if ("error" in r && r.error) return void (notice = r.error);
    if (!("content" in r)) return;
    if (r.binary) {
      version = r.version ?? "";
      return void (notice = "Binary file, not shown.");
    }
    if (r.tooLarge) return void (notice = `Too large to open here (${Math.round(r.size / 1024)} KB).`);
    notice = null;
    setMedia(null);
    version = r.version ?? "";
    if (!view) {
      view = new EditorView({
        parent: host!,
        state: EditorState.create({
          doc: r.content,
          extensions: [
            basicSetup,
            wrapping.of(wrapExt(app.settings.codeWrapLines)),
            theme,
            syntaxHighlighting(highlight),
            language.of([]),
            keymap.of([indentWithTab]),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) dirty = true;
              if (u.docChanged || u.selectionSet) {
                syncCursor();
                pill = null;
              }
            }),
            EditorView.domEventHandlers({
              scroll: () => void (pill = null),
              // Rebindable (Settings > Keyboard), so checked live rather than baked into a keymap.
              keydown: (e, v) => {
                if (matches(e, "files.save")) void save();
                else if (!(matches(e, "files.gotoLine") && gotoLine(v))) return false;
                e.preventDefault();
                return true;
              },
            }),
          ],
        }),
      });
      const desc = LanguageDescription.matchFilename(allLanguages, name);
      if (desc) languageName = desc.name;
      if (desc) desc.load().then((support) => view?.dispatch({ effects: language.reconfigure(support) }));
    } else {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.content } });
    }
    dirty = false;
    conflict = null;
    select(from, to);
  }

  async function loadMediaPreview(kind: MediaKind) {
    if (!cid) return;
    const seq = ++mediaSeq;
    notice = "Loading preview…";
    const r = await readMedia(cid, projectPath, path).catch((e) => ({ error: String(e) }) as const);
    let font: FontFace | undefined;
    if (!("error" in r) && kind === "font") {
      font = new FontFace(`yoake-preview-${seq}-${crypto.randomUUID()}`, `url(${r.url})`);
      await font.load().catch(() => (font = undefined));
    }
    if (seq !== mediaSeq) {
      if (!("error" in r)) URL.revokeObjectURL(r.url);
      return;
    }
    if ("error" in r) {
      setMedia(null);
      return void (notice = r.error);
    }
    if (kind === "font" && !font) {
      URL.revokeObjectURL(r.url);
      setMedia(null);
      return void (notice = "Couldn't load this font.");
    }
    if (font) document.fonts.add(font);
    notice = null;
    setMedia({ kind, url: r.url, size: r.size, font });
  }

  /** SVG only: flip between the rendered image and its source in the editor. */
  function toggleSource() {
    showSource = !showSource;
    mediaSeq++;
    notice = null;
    setMedia(null);
    if (!showSource) {
      // The editor's host goes away with the preview back; a fresh one is built next time.
      view?.destroy();
      view = null;
      dirty = false;
      void load();
    }
    // Otherwise the host renders now that media is gone, and its effect loads the text.
  }

  async function save(force = false) {
    if (!view || !cid || saving) return;
    saving = true;
    error = "";
    const content = view.state.doc.toString();
    try {
      const r = await writeFile(cid, projectPath, path, content, version, force);
      if (r.error) error = r.error;
      else if (r.conflict) conflict = r.version ?? "";
      else {
        version = r.version ?? "";
        conflict = null;
        if (view.state.doc.toString() === content) dirty = false;
      }
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  // Someone else (an agent, another device) may have written the file: follow along while
  // there are no local edits, otherwise flag the conflict instead of clobbering either side.
  async function checkDisk() {
    if (!cid || !view || saving) return;
    const r = await readFile(cid, projectPath, path).catch(() => null);
    if (!r || r.error || r.version === version) return;
    if (dirty) conflict = r.version ?? "";
    else void load();
  }

  // A background tab checks once it's brought forward, not on every change.
  refreshWhenVisible(() => server?.fsTickByProject[projectPath] ?? 0, () => visible, checkDisk, { delay: 300, skipFirst: true });

  // Only mounting loads; a reconnect (new connection id) mustn't reload over unsaved edits.
  $effect(() => {
    if (host) untrack(load);
  });

  // Code block settings apply live. Font changes don't resize anything CodeMirror watches, so it
  // has to be told to re-measure line heights and character widths.
  $effect(() => {
    const on = app.settings.codeWrapLines; // read first: `view?.` skips its arguments while there's no view
    view?.dispatch({ effects: wrapping.reconfigure(wrapExt(on)) });
  });
  $effect(() => {
    void app.settings.codeFontFamily;
    void app.settings.codeFontSize;
    requestAnimationFrame(() => view?.requestMeasure());
  });

  // A reveal of this same file with a new range (a mention clicked again) just moves the selection.
  $effect(() => {
    select(from, to);
  });

  onDestroy(() => {
    mediaSeq++;
    view?.destroy();
    setMedia(null);
  });

  function syncCursor() {
    if (!view) return;
    const { head, from: a, to: b } = view.state.selection.main;
    const line = view.state.doc.lineAt(head);
    const lines = a === b ? 0 : view.state.doc.lineAt(b).number - view.state.doc.lineAt(a).number + 1;
    cursor = { line: line.number, col: head - line.from + 1, chars: b - a, lines };
  }

  /** The lines a non-empty selection touches; a selection ending at a line's very start doesn't count that line. */
  function selectedLines(): [number, number] | null {
    if (!view || view.state.selection.main.empty) return null;
    const { from: a, to: b } = view.state.selection.main;
    const doc = view.state.doc;
    const first = doc.lineAt(a).number;
    let last = doc.lineAt(b).number;
    if (last > first && doc.lineAt(b).from === b) last--;
    return [first, last];
  }

  /** `@path`, or `@path#L3-9` for the lines the selection touches. */
  function mention() {
    if (!server) return;
    const lines = selectedLines();
    pill = null;
    server.insertIntoComposer(sessionId, lines ? mentionText(path, lines[0], lines[1]) : mentionText(path));
  }

  // After the mouse lets go of a selection, offer to ask about it, just below where it ended.
  function onPointerUp(e: PointerEvent) {
    if ((e.target as Element).closest(".ask-pill")) return;
    requestAnimationFrame(() => {
      if (!view || !host || view.state.selection.main.empty) return;
      const at = view.coordsAtPos(view.state.selection.main.head);
      if (!at) return;
      const box = host.getBoundingClientRect();
      pill = {
        x: Math.max(8, Math.min(at.left - box.left, box.width - 120)),
        y: Math.min(at.bottom - box.top + 6, box.height - 34),
      };
    });
  }
</script>

<div class="editor">
  <div class="bar">
    <span class="name" {@attach tip(path)}>{#if path.includes("/")}<span class="dir">{path.slice(0, path.lastIndexOf("/") + 1)}</span>{/if}{name}{#if dirty}<span class="dot" {@attach tip("Unsaved changes")}>●</span>{/if}</span>
    {#if ext === "svg"}
      <button
        type="button"
        class="btn"
        {@attach tip(showSource ? (dirty ? "Save or undo your edits to preview" : "Preview") : "Edit source")}
        disabled={showSource && dirty}
        onclick={toggleSource}
      >
        <Icon name={showSource ? "eye" : "code"} size={13} />
      </button>
    {/if}
    <button type="button" class="btn" {@attach tip("Mention in chat (the selected lines, if any)")} onclick={mention}>
      <Icon name="at-sign" size={13} />
    </button>
    <button type="button" class="btn" {@attach tip("Save", "files.save")} disabled={!dirty || saving || !!notice} onclick={() => save()}>
      <Icon name="device-floppy" size={13} />
    </button>
  </div>
  {#if conflict !== null}
    <div class="banner">
      <span>Changed on disk since you opened it.</span>
      <button type="button" onclick={() => load()}>Reload</button>
      <button type="button" class="danger" onclick={() => save(true)}>Overwrite</button>
    </div>
  {/if}
  {#if error}<div class="banner error">{error}</div>{/if}
  {#if notice}<div class="notice">{notice}</div>{/if}
  {#if media}
    {#if media.kind === "pdf"}
      <iframe class="pdf" src={media.url} title={name}></iframe>
    {:else if media.kind === "font"}
      <div class="font" style:font-family="'{media.font?.family}'">
        <input class="sample" bind:value={fontSample} placeholder={FONT_SAMPLE} spellcheck="false" aria-label="Sample text" />
        {#each [12, 16, 24, 36, 56] as px (px)}
          <div class="line" style:font-size="{px}px"><span class="px">{px}</span>{fontSample || FONT_SAMPLE}</div>
        {/each}
        <div class="glyphs">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br />abcdefghijklmnopqrstuvwxyz<br />0123456789 !?&amp;@#$%*()[]{"{}"}&lt;&gt;/\+-=.,:;'"</div>
      </div>
    {:else}
      <div class="media" class:checker={media.kind === "image"}>
        {#if media.kind === "image"}
          <img src={media.url} alt={name} onload={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            dims = `${img.naturalWidth} × ${img.naturalHeight}`;
          }} />
        {:else if media.kind === "video"}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={media.url} controls onloadedmetadata={(e) => (dims = `${e.currentTarget.videoWidth} × ${e.currentTarget.videoHeight}`)}></video>
        {:else}
          <audio src={media.url} controls></audio>
        {/if}
      </div>
    {/if}
    <div class="status">
      {#if dims}<span>{dims}</span>{/if}
      <span>{formatSize(media.size)}</span>
      <span class="spacer"></span>
      <span>{ext.toUpperCase()}</span>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="host" bind:this={host} hidden={!!notice} onpointerup={onPointerUp}>
      {#if pill}
        <button
          type="button"
          class="ask-pill"
          style="left: {pill.x}px; top: {pill.y}px"
          onpointerdown={(e) => e.preventDefault()}
          onclick={mention}
        >
          <Icon name="message-question" size={13} />
          Ask about this
        </button>
      {/if}
    </div>
  {/if}
  {#if !notice && !media}
    <div class="status">
      <span>Ln {cursor.line}, Col {cursor.col}</span>
      {#if cursor.chars}<span>{cursor.chars} selected{cursor.lines > 1 ? ` · ${cursor.lines} lines` : ""}</span>{/if}
      <span class="spacer"></span>
      <span>{languageName}</span>
    </div>
  {/if}
</div>

<style>
  .editor {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0.29rem var(--space-1);
    border-bottom: 1px solid var(--panel-border);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-size: var(--text-label-size);
  }
  .dir {
    color: var(--text-dim);
  }
  .dot {
    margin-left: 0.36rem;
    color: var(--accent);
    font-size: 0.7em;
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
    opacity: 0.4;
    cursor: default;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.36rem var(--space-1);
    font-size: var(--text-label-size);
    background: color-mix(in srgb, var(--warning) 14%, transparent);
  }
  .banner span {
    flex: 1;
  }
  .banner.error {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .banner button {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    color: var(--text);
    padding: 0.14rem 0.5rem;
    font: inherit;
    cursor: pointer;
  }
  .banner button.danger {
    color: var(--danger);
  }
  .notice {
    padding: var(--space-2);
    color: var(--text-dim);
    text-align: center;
  }
  .media {
    display: flex;
    flex: 1;
    min-height: 0;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: var(--space-2);
  }
  .media img,
  .media video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .media audio {
    width: 100%;
    max-width: 28rem;
  }
  /* Transparent pixels read as a checkerboard, not as the panel's own background. */
  .media.checker {
    background: repeating-conic-gradient(rgba(128, 128, 128, 0.16) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
  }
  .pdf {
    flex: 1;
    min-height: 0;
    border: none;
    background: #fff;
  }
  .font {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-2);
    color: var(--text);
  }
  .sample {
    width: 100%;
    margin-bottom: var(--space-2);
    padding: 0.29rem 0.5rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    font-size: 14px;
  }
  .line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
    margin-bottom: 0.5rem;
  }
  .px {
    display: inline-block;
    width: 2.2rem;
    color: var(--text-dim);
    font-family: system-ui, sans-serif;
    font-size: 0.7rem;
    vertical-align: middle;
  }
  .glyphs {
    margin-top: var(--space-2);
    font-size: 22px;
    line-height: 1.5;
    word-break: break-all;
  }
  .host {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .host {
    position: relative;
  }
  .host[hidden] {
    display: none;
  }
  .ask-pill {
    position: absolute;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    padding: 0.29rem 0.64rem;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border, var(--panel-border));
    border-radius: var(--radius-pill);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
    white-space: nowrap;
    cursor: pointer;
    animation: floatIn var(--float-enter-duration, 0.12s) ease-out;
  }
  .ask-pill:hover {
    color: var(--accent);
  }
  .status {
    display: flex;
    gap: var(--space-2);
    padding: 0.14rem var(--space-1);
    border-top: 1px solid var(--panel-border);
    font-size: 0.7rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .spacer {
    flex: 1;
  }
</style>
