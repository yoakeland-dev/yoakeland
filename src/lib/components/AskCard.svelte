<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // The oldest pending ask (permission or question) as a card that rises out of the composer's
  // top edge; any others stack behind it. Its own buttons answer just this one ask. The composer
  // underneath stays the "tell it what to do instead" path, which answers every pending ask at
  // once (dismissAll). Keys arrive through onComposerKey, since focus stays in the composer.
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { app } from "../state.svelte";
  import { respondPermission, askUserAnswer } from "../ipc";
  import { chooseMode, sessionModes } from "../modes";
  import { metaFor, summaryFor } from "../toolMeta";
  import { findCallInMessages, subagentOwning, subagentTitle } from "../subagents";
  import { fileIconUrl } from "../fileIcons";
  import { SCOPES, alwaysAnswer, defaultSuggestion, legacyRemember } from "../permissionRules";
  import type { PendingAsk, PermissionScope } from "../types";
  import DiffView from "./DiffView.svelte";
  import Dropdown from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";

  let { sessionId, asks }: { sessionId: string; asks: PendingAsk[] } = $props();

  const server = $derived(app.active);
  const ask = $derived(asks[0]);
  // Searched by id, nested ones included: a subagent's ask carries its own turn id, not the chat's.
  const call = $derived(findCallInMessages(server?.messagesBySession[sessionId], ask.toolCallId));
  const owner = $derived(subagentOwning(server?.messagesBySession[sessionId], ask.toolCallId));

  const permission = $derived(ask.kind === "permission" ? ask : null);
  const question = $derived(ask.kind === "question" ? ask : null);

  const meta = $derived(call ? metaFor(call) : { icon: "tool", label: permission?.toolName ?? "" });
  const diff = $derived(permission?.diff ?? call?.diff ?? null);
  const command = $derived.by(() => {
    if (!call) return null;
    if (typeof call.args?.command === "string") return call.args.command;
    return call.native && call.kind === "execute" ? (call.title ?? null) : null;
  });
  // Shown relative to the project, like the changed-files list.
  const filePath = $derived.by(() => {
    const p = diff?.filePath ?? "";
    const root = ask.projectPath ? ask.projectPath.replace(/\/?$/, "/") : "";
    return root && p.startsWith(root) ? p.slice(root.length) : p;
  });
  const counts = $derived.by(() => {
    let add = 0;
    let del = 0;
    for (const h of diff?.hunks ?? []) for (const l of h.lines) l.type === "+" ? add++ : l.type === "-" && del++;
    return { add, del };
  });
  const target = $derived(diff || command ? "" : call ? summaryFor(call) : "");

  // "Always allow" picks one of the rules the server offered for this call (SPEC.md §3.2 permission_request);
  // a call it offers none for (a terminal, a chained command) can only be allowed once.
  const suggestions = $derived(permission?.suggestions ?? []);
  const legacy = $derived(!!permission && legacyRemember(permission));
  let pick = $state(0);
  let scope = $state<PermissionScope>("project");
  $effect(() => {
    void ask.toolCallId;
    pick = Math.max(0, defaultSuggestion(suggestions));
    scope = "project";
  });
  const picked = $derived(suggestions[pick]);
  const suggestionItems = $derived(suggestions.map((s, i) => ({ value: String(i), label: s.label.replaceAll("`", "") })));
  const scopeItems = SCOPES.map((s) => ({ value: s.value, label: s.label }));
  const canAlways = $derived(legacy || !!picked);
  // An edit asked about in Ask can move the chat up to Edit, instead of being asked again for the next one.
  const canAcceptEdits = $derived(
    server?.modeBySession[sessionId] === "read_write" &&
      !!diff &&
      sessionModes(server, sessionId).available.includes("accept_edits"),
  );

  const cid = () => app.activeConnectionId;
  function done() {
    server?.removeAsk(ask.toolCallId);
  }
  function allow(remember: boolean) {
    const c = cid();
    if (!c || !permission) return;
    respondPermission(c, ask.sessionId, ask.turnId, ask.toolCallId, true, remember);
    done();
  }
  function allowAlways() {
    const c = cid();
    if (!c || !permission) return;
    if (legacy) return allow(true);
    const a = alwaysAnswer(suggestions, pick, scope);
    if (!a) return;
    respondPermission(c, ask.sessionId, ask.turnId, ask.toolCallId, true, a.remember, undefined, { ruleId: a.ruleId, scope: a.scope });
    done();
  }
  /** Allows this edit and every later one in this chat. */
  function allowEdits() {
    const c = cid();
    if (c && server) chooseMode(server, c, sessionId, "accept_edits");
    allow(false);
  }
  function reject() {
    const c = cid();
    if (!c || !permission) return;
    respondPermission(c, ask.sessionId, ask.turnId, ask.toolCallId, false, false);
    done();
  }
  function answer(text: string) {
    const c = cid();
    if (!c || !question) return;
    askUserAnswer(c, ask.sessionId, ask.toolCallId, text);
    done();
  }
  const skip = () => answer("The user dismissed this question without answering.");

  /** The composer's note answers everything pending: permissions are rejected with it as the
   * reason, questions get it in place of an answer. */
  export function dismissAll(note: string) {
    const c = cid();
    if (!c || !server) return;
    for (const a of asks) {
      if (a.kind === "permission") respondPermission(c, a.sessionId, a.turnId, a.toolCallId, false, false, note);
      else askUserAnswer(c, a.sessionId, a.toolCallId, `The user dismissed this question and said instead: ${note}`);
      server.removeAsk(a.toolCallId);
    }
  }

  // Options by number or arrows, the last row being "Something else…".
  let highlight = $state(0);
  let otherOpen = $state(false);
  let otherText = $state("");
  let otherInput = $state<HTMLInputElement>();
  $effect(() => {
    void ask.toolCallId;
    highlight = 0;
    otherOpen = false;
    otherText = "";
  });
  $effect(() => {
    if (otherOpen) otherInput?.focus();
  });
  const options = $derived(question?.options ?? []);

  /** Keys from the composer. `empty`: nothing typed there, so plain keys belong to the card. */
  export function onComposerKey(e: KeyboardEvent, empty: boolean): boolean {
    if (e.key === "Escape") {
      if (permission) reject();
      else skip();
      return true;
    }
    if (!empty) return false;
    if (permission && e.key === "Enter" && !e.shiftKey) {
      if (!(e.ctrlKey || e.metaKey)) allow(false);
      else if (canAlways) allowAlways();
      return true;
    }
    if (!options.length) return false;
    const n = Number(e.key);
    if (n >= 1 && n <= Math.min(9, options.length)) {
      answer(options[n - 1]);
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      highlight = (highlight + (e.key === "ArrowDown" ? 1 : options.length)) % (options.length + 1);
      return true;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      if (highlight < options.length) answer(options[highlight]);
      else otherOpen = true;
      return true;
    }
    return false;
  }

  function onOtherKey(e: KeyboardEvent) {
    if (e.key === "Enter" && otherText.trim()) {
      e.preventDefault();
      answer(otherText.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      otherOpen = false;
    }
  }
</script>

<div
  class="ask"
  class:stacked={asks.length > 1}
  class:stacked-more={asks.length > 2}
  in:fly={{ y: 28, duration: 240, easing: cubicOut }}
  out:fly={{ y: 20, duration: 160 }}
>
  {#key ask.toolCallId}
    <div class="inner" in:fly={{ y: 8, duration: 180, easing: cubicOut }}>
      <div class="head">
        {#if permission}
          <span class="kind"><Icon name={meta.icon as any} size={14} /></span>
          <span class="verb">{meta.label}</span>
          {#if diff}
            <img class="ficon" src={fileIconUrl(filePath.split("/").pop() ?? "")} alt="" />
            <span class="name">{filePath.split("/").pop()}</span>
            <span class="dir">{filePath.split("/").slice(0, -1).join("/")}</span>
            <span class="counts"><span class="add">+{counts.add}</span> <span class="del">−{counts.del}</span></span>
          {:else if target}
            <span class="target">{target}</span>
          {/if}
        {:else if question}
          <span class="kind"><Icon name="message-question" size={14} /></span>
          <span class="question">{question.question}</span>
        {/if}
        {#if question?.total && question.total > 1}
          <span class="count">{question.index} of {question.total}</span>
        {:else if asks.length > 1}<span class="count">1 of {asks.length}</span>{/if}
      </div>
      {#if owner}
        <div class="owner"><Icon name="robot" size={12} /> Asked by subagent “{subagentTitle(owner)}”</div>
      {/if}

      {#if permission}
        {#if diff}
          <div class="diff-box"><DiffView {diff} numbered showPath={false} limit={200} /></div>
        {:else if command}
          <pre class="command selectable"><span class="prompt">$</span> {command}</pre>
        {:else if permission.description}
          <p class="desc">{permission.description}</p>
        {/if}
        <div class="actions">
          <button type="button" class="btn danger" onclick={reject}>Reject <kbd>Esc</kbd></button>
          {#if canAlways}
            <div class="always">
              {#if suggestions.length}
                <Dropdown
                  items={suggestionItems}
                  bind:value={() => String(pick), (v) => (pick = Number(v))}
                  triggerClass="ask-pick"
                  triggerTitle="What to always allow"
                />
                {#if !picked?.native}
                  <Dropdown
                    items={scopeItems}
                    bind:value={() => scope, (v) => (scope = v as PermissionScope)}
                    triggerClass="ask-pick"
                    triggerTitle="Where to remember it"
                  />
                {/if}
              {/if}
              <button type="button" class="btn" onclick={allowAlways}>Always allow <kbd>Ctrl ⏎</kbd></button>
            </div>
          {/if}
          {#if canAcceptEdits}
            <button type="button" class="btn" {@attach tip("Switch this chat to Edit: file edits go through without asking, commands still ask")} onclick={allowEdits}>Allow edits</button>
          {/if}
          <button type="button" class="btn primary" onclick={() => allow(false)}>Allow once <kbd>⏎</kbd></button>
        </div>
      {:else if question}
        {#if options.length}
          <ol class="options">
            {#each options as option, i (option)}
              <li>
                <button type="button" class:hl={i === highlight} onmouseenter={() => (highlight = i)} onclick={() => answer(option)}>
                  <span class="num">{i + 1}</span>{option}
                </button>
              </li>
            {/each}
            <li>
              {#if otherOpen}
                <div class="other">
                  <span class="num"><Icon name="pencil" size={11} /></span>
                  <input bind:this={otherInput} bind:value={otherText} onkeydown={onOtherKey} placeholder="Your answer, then Enter" />
                </div>
              {:else}
                <button
                  type="button"
                  class:hl={highlight === options.length}
                  onmouseenter={() => (highlight = options.length)}
                  onclick={() => (otherOpen = true)}
                >
                  <span class="num"><Icon name="pencil" size={11} /></span>Something else…
                </button>
              {/if}
            </li>
          </ol>
        {:else}
          <!-- svelte-ignore a11y_autofocus -->
          <div class="other free">
            <input bind:value={otherText} onkeydown={onOtherKey} placeholder="Your answer, then Enter" autofocus />
          </div>
        {/if}
        <div class="actions">
          <button type="button" class="btn" onclick={skip}>Skip <kbd>Esc</kbd></button>
        </div>
      {/if}
    </div>
  {/key}
</div>

<style>
  .ask {
    position: relative;
    /* Under the box (z-index 1), so it rises out from behind the composer's top edge. */
    z-index: 0;
    margin-bottom: 0.57rem;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: 18px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  }
  /* More asks waiting: the edges of the cards behind peek out above this one. */
  .ask.stacked::before,
  .ask.stacked-more::after {
    content: "";
    position: absolute;
    left: 12px;
    right: 12px;
    top: -6px;
    height: 6px;
    z-index: -1;
    border: 1px solid var(--float-border);
    border-bottom: none;
    border-radius: 10px 10px 0 0;
    background: var(--float-bg);
    opacity: 0.7;
  }
  .ask.stacked-more::after {
    left: 24px;
    right: 24px;
    top: -11px;
    height: 5px;
    opacity: 0.4;
  }
  .inner {
    padding: 0.71rem var(--space-1) var(--space-1);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    min-width: 0;
    padding: 0 0.29rem;
    font-size: var(--text-body-size);
    white-space: nowrap;
  }
  .kind {
    display: inline-flex;
    color: var(--accent);
  }
  .owner {
    display: flex;
    align-items: center;
    gap: 0.29rem;
    padding: 0.14rem 0.29rem 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .verb {
    font-weight: 600;
  }
  .ficon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  .name,
  .target {
    font-family: var(--code-font-family);
    font-size: var(--code-font-size);
  }
  .target,
  .dir {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dir {
    flex: 1;
    color: var(--text-dim);
    font-size: var(--text-label-size);
    direction: rtl;
    text-align: left;
  }
  .target {
    flex: 1;
    color: var(--text-dim);
  }
  .question {
    flex: 1;
    font-weight: 600;
    white-space: normal;
  }
  .counts {
    font-size: var(--text-label-size);
    font-variant-numeric: tabular-nums;
  }
  .add {
    color: var(--success, #58d68d);
  }
  .del {
    color: var(--danger);
  }
  .count {
    margin-left: auto;
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .diff-box {
    max-height: 40vh;
    overflow-y: auto;
    scrollbar-gutter: stable;
    border-radius: var(--radius-sm);
  }
  .command {
    margin: 0.43rem 0 0;
    padding: 0.5rem 0.71rem;
    background: var(--code-bg);
    color: var(--code-fg);
    border-radius: var(--radius-sm);
    font-family: var(--code-font-family);
    font-size: var(--code-font-size);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 30vh;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .prompt {
    opacity: 0.5;
    user-select: none;
  }
  .desc {
    margin: 0.29rem 0 0;
    padding: 0 0.29rem;
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.43rem;
    margin-top: var(--space-1);
  }
  /* Dropdown.svelte's trigger sits transparent inside the pill; only its hover fill shows. */
  .always {
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.07);
  }
  .always :global(.dropdown-trigger.ask-pick) {
    max-width: 14rem;
    border-color: transparent;
    border-radius: var(--radius-pill);
    padding: 0 0.7rem;
  }
  .always :global(.dropdown-trigger.ask-pick:hover),
  .always :global(.dropdown-trigger.ask-pick[data-state="open"]) {
    background: rgba(255, 255, 255, 0.08);
  }
  .always .btn {
    background: none;
  }
  .always .btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    border: none;
    border-radius: var(--radius-pill);
    height: var(--ctrl-h, 2rem);
    padding: 0 0.86rem;
    background: rgba(255, 255, 255, 0.07);
    color: var(--text);
    font-size: var(--text-label-size);
    font-weight: 600;
    cursor: pointer;
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.11);
  }
  .btn.danger {
    margin-right: auto;
    background: none;
    color: var(--danger);
  }
  .btn.danger:hover {
    background: var(--danger-dim);
  }
  .btn.primary {
    background: var(--accent);
    color: #0d1020;
  }
  .btn.primary:hover {
    background: var(--accent);
    filter: brightness(1.08);
  }
  kbd {
    padding: 0.05rem 0.3rem;
    border-radius: var(--radius-xs);
    background: rgba(255, 255, 255, 0.08);
    font-family: inherit;
    font-size: 0.66rem;
    font-weight: 500;
    opacity: 0.7;
  }
  .btn.primary kbd {
    background: rgba(0, 0, 0, 0.12);
  }
  .options {
    list-style: none;
    margin: 0.43rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .options button,
  .other {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.57rem;
    padding: 0.43rem 0.43rem;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-body-size);
    text-align: left;
    cursor: pointer;
  }
  .options button.hl {
    background: var(--sidebar-active);
  }
  .num {
    width: 1.29rem;
    height: 1.29rem;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-xs);
    background: rgba(255, 255, 255, 0.07);
    color: var(--text-dim);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }
  .other {
    background: var(--sidebar-active);
    cursor: text;
  }
  .other.free {
    margin-top: 0.43rem;
    background: rgba(255, 255, 255, 0.05);
  }
  .other input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font: inherit;
  }

  /* Phone: the composer is docked full width, so the card sits behind it, a little narrower, its
     bottom tucked under the composer's rounded top. */
  @media (max-width: 700px) {
    .ask {
      margin: 0 0.6rem -22px;
      border-width: 1px 1px 0;
      border-radius: 18px 18px 0 0;
      box-shadow: none;
    }
    .inner {
      padding-bottom: calc(var(--space-1) + 22px);
    }
    /* Tap targets: rows and buttons a thumb can hit; the number chips are keyboard shortcuts. */
    .options button,
    .other {
      min-height: 2.7rem;
    }
    .btn {
      min-height: 2.5rem;
    }
    .num {
      display: none;
    }
  }
</style>
