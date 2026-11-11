<script lang="ts">
  // Dev only: every real component and its states, side by side. Hover, focus and press are forced by
  // copying each :hover/:focus/:active rule to a class, so the states need no mouse and show in a screenshot.
  import { onMount } from "svelte";
  import { app } from "$lib/state.svelte";
  import type { ToolCallEntry } from "$lib/types";
  import Button from "$lib/components/ui/Button.svelte";
  import Switch from "$lib/components/ui/Switch.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Radio from "$lib/components/ui/Radio.svelte";
  import Segmented from "$lib/components/ui/Segmented.svelte";
  import Slider from "$lib/components/ui/Slider.svelte";
  import Chip from "$lib/components/ui/Chip.svelte";
  import Badge from "$lib/components/ui/Badge.svelte";
  import TextField from "$lib/components/ui/TextField.svelte";
  import TextArea from "$lib/components/ui/TextArea.svelte";
  import Progress from "$lib/components/ui/Progress.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ChatRing from "$lib/components/ChatRing.svelte";
  import ExtIcon from "$lib/components/extensions/ExtIcon.svelte";
  import SimpleWork from "$lib/components/SimpleWork.svelte";
  import MessageBubble from "$lib/components/MessageBubble.svelte";
  import ThinkingBlock from "$lib/components/ThinkingBlock.svelte";
  import SearchInput from "$lib/components/SearchInput.svelte";
  import { toolMeta } from "$lib/toolMeta";

  const PSEUDO: [RegExp, string][] = [
    [/:hover/g, ".f-hover"],
    [/:focus-visible|:focus-within|:focus/g, ".f-focus"],
    [/:active/g, ".f-active"],
  ];
  const forced = (el: HTMLElement, state: string) => {
    if (!state) return;
    for (const n of [el, ...el.querySelectorAll("*")]) n.classList.add(`f-${state}`);
  };
  function mirrorStates() {
    const sheet = new CSSStyleSheet();
    const walk = (rules: CSSRuleList) => {
      for (const r of rules) {
        if (r instanceof CSSStyleRule && /:hover|:focus|:active/.test(r.selectorText)) {
          const sel = PSEUDO.reduce((s, [re, cls]) => s.replace(re, cls), r.selectorText);
          try {
            sheet.insertRule(`${sel}{${r.style.cssText}}`, sheet.cssRules.length);
          } catch {
            // A selector the copy can't parse only loses that one forced state.
          }
        } else if (r instanceof CSSMediaRule && matchMedia(r.conditionText).matches) walk(r.cssRules);
      }
    };
    for (const s of document.styleSheets) {
      try {
        walk(s.cssRules);
      } catch {
        // Cross-origin sheet, nothing of ours in it.
      }
    }
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }

  const ACCENTS = ["#7c9bff", "#e4515c", "#8fbf7a", "#e58bb0", "#e9b44c", "#5ec4c4"];
  const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  let accent = $state(q.get("accent") ? `#${q.get("accent")}` : app.settings.accent);
  let scheme = $state(q.has("light") ? "light" : "dark");
  $effect(() => {
    app.settings.accent = accent;
    app.settings.theme = scheme as typeof app.settings.theme;
    app.applySettings();
  });
  onMount(mirrorStates);

  const STATES = ["", "hover", "focus", "active"];
  const NAMES = ["Rest", "Hover", "Focus", "Pressed", "Disabled"];
  const VARIANTS = ["primary", "default", "ghost", "danger"] as const;

  const SWATCHES = [
    ["Ground", "--bg"], ["Panel", "--panel-bg"], ["Bubble", "--bubble-user-bg"], ["Selected", "--sidebar-active"], ["Hover", "--sidebar-hover"], ["Edge", "--panel-border"],
    ["Text", "--text"], ["Text dim", "--text-dim"], ["Accent", "--accent"], ["Lamp", "--lamp"], ["Success", "--success"], ["Danger", "--danger"], ["Info", "--info"],
  ];
  const TYPE = [
    ["Title", "--text-title", "Refine the settings dialog"],
    ["Body", "--text-body", "Sure, here's the row pattern I'd use."],
    ["Label", "--text-label", "Claude Opus 5.5 · 52s"],
    ["Heading", "--text-heading", "NEEDS YOU"],
  ];
  const call = (name: string, status: ToolCallEntry["status"], args: Record<string, unknown>, i = 0): ToolCallEntry => ({ toolCallId: `${name}${i}`, name, args, status });
  const WORK: [string, ToolCallEntry[], boolean][] = [
    ["Finished, one kind", [call("file_edit", "done", { path: "SettingsPanel.svelte" })], false],
    ["Finished, mixed", [call("file_read", "done", { path: "a.ts" }), call("bash", "done", { command: "npm test" })], false],
    ["Running", [call("bash", "running", { command: "npm test" })], true],
    ["Waiting on you", [call("bash", "awaiting_permission", { command: "rg fit" })], true],
    ["Failed", [call("bash", "error", { command: "cargo test" })], false],
  ];
  const bubble = (text: string) => ({ id: text, role: "user" as const, text, toolCalls: [], streaming: false, createdAt: Date.now(), author: "me" });
</script>

<svelte:head><title>Component sheet</title></svelte:head>

{#snippet states(variant: (typeof VARIANTS)[number], label: string)}
  {#each STATES as s}
    <td><span class="cell" {@attach (el) => forced(el, s)}><Button {variant}>{label}</Button></span></td>
  {/each}
  <td><Button {variant} disabled>{label}</Button></td>
  <td><Button {variant} loading>{label}</Button></td>
{/snippet}

{#snippet row(name: string, make: import("svelte").Snippet<[boolean]>)}
  <tr>
    <th>{name}</th>
    {#each STATES as s}
      <td><span class="cell" {@attach (el) => forced(el, s)}>{@render make(false)}</span></td>
    {/each}
    <td>{@render make(true)}</td>
  </tr>
{/snippet}

{#snippet switchOn(d: boolean)}<Switch checked disabled={d} />{/snippet}
{#snippet switchOff(d: boolean)}<Switch disabled={d} />{/snippet}
{#snippet checkOn(d: boolean)}<Checkbox checked disabled={d} label="Label" />{/snippet}
{#snippet checkOff(d: boolean)}<Checkbox disabled={d} label="Label" />{/snippet}
{#snippet radioOn(d: boolean)}<Radio group="a" value="a" disabled={d}>Label</Radio>{/snippet}
{#snippet radioOff(d: boolean)}<Radio group="a" value="b" disabled={d}>Label</Radio>{/snippet}
{#snippet seg(d: boolean)}<Segmented value="a" disabled={d} label="View" options={[{ value: "a", label: "Chat" }, { value: "b", label: "Diff" }]} />{/snippet}
{#snippet field(d: boolean)}<TextField value="yoake-gui" disabled={d} />{/snippet}
{#snippet fieldEmpty(d: boolean)}<TextField value="" placeholder="Project name" disabled={d} />{/snippet}
{#snippet fieldBad(d: boolean)}<TextField value="not a url" invalid disabled={d} />{/snippet}
{#snippet area(d: boolean)}<TextArea value="" placeholder="A longer note" disabled={d} />{/snippet}
{#snippet slider(d: boolean)}<div class="slide"><Slider value={62} disabled={d} label="Volume" /></div>{/snippet}
{#snippet chip(_d: boolean)}<Chip pressed>Filter</Chip>{/snippet}
{#snippet chipOff(_d: boolean)}<Chip pressed={false}>Filter</Chip>{/snippet}

<main>
  <header>
    <h1>Component sheet</h1>
    <div class="pick">
      {#each ACCENTS as a}
        <button aria-label={a} class:on={accent === a} style:background={a} onclick={() => (accent = a)}></button>
      {/each}
      <Segmented bind:value={scheme} label="Scheme" options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
    </div>
  </header>

  <section>
    <h2>Color</h2>
    <div class="swatches">
      {#each SWATCHES as [name, token]}
        <figure><i style:background="var({token})"></i><figcaption>{name}</figcaption></figure>
      {/each}
    </div>
    <h2>Type</h2>
    {#each TYPE as [name, token, sample]}
      <p class="type"><span>{name}</span><b style:font-size="var({token}-size)" style:font-weight="var({token}-weight)">{sample}</b></p>
    {/each}
  </section>

  <section>
    <h2>Button</h2>
    <table>
      <thead><tr><td></td>{#each [...NAMES, "Loading"] as n}<th>{n}</th>{/each}</tr></thead>
      <tbody>
        {#each VARIANTS as v}
          <tr><th>{v}</th>{@render states(v, v === "primary" ? "Allow once" : v === "danger" ? "Delete" : "Cancel")}</tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Controls</h2>
    <table>
      <thead><tr><td></td>{#each NAMES as n}<th>{n}</th>{/each}</tr></thead>
      <tbody>
        {@render row("Switch on", switchOn)}
        {@render row("Switch off", switchOff)}
        {@render row("Checkbox on", checkOn)}
        {@render row("Checkbox off", checkOff)}
        {@render row("Radio on", radioOn)}
        {@render row("Radio off", radioOff)}
        {@render row("Segmented", seg)}
        {@render row("Slider", slider)}
        {@render row("Chip pressed", chip)}
        {@render row("Chip", chipOff)}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Fields</h2>
    <table class="wide">
      <thead><tr><td></td>{#each NAMES as n}<th>{n}</th>{/each}</tr></thead>
      <tbody>
        {@render row("Filled", field)}
        {@render row("Empty", fieldEmpty)}
        {@render row("Invalid", fieldBad)}
        {@render row("Text area", area)}
      </tbody>
    </table>
    <div class="flow"><SearchInput placeholder="Search chats…" /><SearchInput placeholder="Search settings…" boxed hint="/" /></div>
  </section>

  <section>
    <h2>Status and tags</h2>
    <div class="flow">
      <span class="tag"><span class="lamp"></span>Needs you</span>
      <span class="tag"><ChatRing state="running" />Working</span>
      <span class="tag"><ChatRing state="stopped" />Stopped</span>
      <span class="tag"><ChatRing state="quiet" />Resting</span>
      <span class="tag"><ChatRing state="stop" />Stop</span>
      <span class="tag"><Spinner size="s" /><Spinner /><Spinner size="l" /></span>
    </div>
    <div class="flow">
      <Badge>Neutral</Badge><Badge tone="accent">Accent</Badge><Badge tone="success" dot>Online</Badge><Badge tone="warning" dot>Waiting</Badge><Badge tone="danger">Error</Badge><Badge mono>+12 −2</Badge>
    </div>
    <div class="flow bars"><Progress value={43} label="Context" /><Progress value={92} label="Nearly full" /><Progress label="Loading" /></div>
    <div class="flow">
      {#each ["fs", "linear", "release-notes", "review-pr", "postgres", "sentry"] as n}<ExtIcon name={n} kind="mcp" />{/each}
      <ExtIcon name="github" kind="mcp" />
    </div>
    <div class="flow icons">
      {#each [...new Set(Object.values(toolMeta).map((m) => m.icon))] as icon}<Icon name={icon} size={16} />{/each}
    </div>
  </section>

  <section>
    <h2>In a chat</h2>
    <div class="chat">
      <MessageBubble message={bubble("Rename the Subscriptions heading too.")} sessionId="sheet" />
      <MessageBubble message={bubble("Queued while the agent works.")} sessionId="sheet" queued />
      <ThinkingBlock text="The heading lives in two places." />
      {#each WORK as [name, calls, live]}
        <div class="work"><small>{name}</small>
          <SimpleWork id={name} {calls} {live} hasFinal={false} narration="" durationMs={live ? undefined : 52000}>{""}</SimpleWork>
        </div>
      {/each}
    </div>
  </section>
</main>

<style>
  :global(html),
  :global(body) {
    overflow: auto !important;
    height: auto !important;
    background: var(--bg);
  }
  main {
    max-width: 78rem;
    margin: 0 auto;
    padding: 1.5rem 1.5rem 4rem;
    color: var(--text);
    font-size: var(--text-body-size);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  h1 {
    margin: 0;
    font-size: var(--text-title-size);
    font-weight: 600;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 0.43rem;
  }
  .pick button {
    width: 1.14rem;
    height: 1.14rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
  }
  .pick button.on {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  section {
    margin-bottom: 1rem;
    padding: 1.14rem 1.29rem;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
  }
  h2 {
    margin: 0 0 0.71rem;
    font-size: var(--text-heading-size);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.71rem;
    margin-bottom: 1.14rem;
  }
  figure {
    margin: 0;
    width: 4.6rem;
  }
  figure i {
    display: block;
    height: 2.6rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
  }
  figcaption {
    margin-top: 0.29rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .type {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin: 0.29rem 0;
  }
  .type span {
    width: 5rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th {
    padding: 0.43rem 0.57rem 0.43rem 0;
    font-size: var(--text-label-size);
    font-weight: 500;
    text-align: left;
    text-transform: capitalize;
    color: var(--text-dim);
  }
  td {
    padding: 0.43rem 0.57rem 0.43rem 0;
    vertical-align: middle;
  }
  .cell {
    display: block;
  }
  /* Room for the value bubble the focused slider raises. */
  .slide {
    padding-top: 1.71rem;
  }
  .flow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.86rem;
    margin-top: 0.86rem;
  }
  .flow.bars > :global(*) {
    width: 14rem;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    font-size: var(--text-label-size);
  }
  .icons {
    color: var(--text-dim);
  }
  .chat {
    max-width: 44rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.71rem;
  }
  .work small {
    display: block;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    margin-bottom: 0.14rem;
  }
</style>
