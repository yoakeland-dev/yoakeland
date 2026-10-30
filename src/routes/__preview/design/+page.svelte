<script lang="ts">
  // Dev only: the design sheet. Foundations and controls are the real tokens and components; the
  // composed pieces are hand-built zoomed mocks that mirror the real component CSS. Describes DESIGN.md.
  import { onMount } from "svelte";
  import { app } from "$lib/state.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Switch from "$lib/components/ui/Switch.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Radio from "$lib/components/ui/Radio.svelte";
  import Segmented from "$lib/components/ui/Segmented.svelte";
  import Slider from "$lib/components/ui/Slider.svelte";
  import Chip from "$lib/components/ui/Chip.svelte";
  import Badge from "$lib/components/ui/Badge.svelte";
  import TextField from "$lib/components/ui/TextField.svelte";
  import NumberField from "$lib/components/ui/NumberField.svelte";
  import TextArea from "$lib/components/ui/TextArea.svelte";
  import Progress from "$lib/components/ui/Progress.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";

  onMount(() => app.applySettings());

  // Local to the controls block: swap the accent to see everything follow one hue.
  const accents = [
    { name: "Your accent", value: "" },
    { name: "Periwinkle", value: "#7c9bff" },
    { name: "Clay", value: "#d97757" },
    { name: "Moss", value: "#8fbf7a" },
    { name: "Rose", value: "#e58bb0" },
    { name: "Amber", value: "#e9b44c" },
  ];
  let accent = $state("");

  let sw1 = $state(true);
  let sw2 = $state(false);
  let ck1 = $state(true);
  let ck2 = $state(false);
  let radio = $state("b");
  let seg = $state("chat");
  let slide = $state(62);
  let effort = $state(2);
  let mode = $state(1);
  let pressed = $state(true);
  let num = $state(24);
  let text = $state("yoake-gui");

  const effortStops = [
    { key: "low", short: "Low", name: "Low" },
    { key: "medium", short: "Med", name: "Medium" },
    { key: "high", short: "High", name: "High" },
    { key: "xhigh", short: "XHi", name: "Extra high" },
    { key: "max", short: "Max", name: "Max", warm: true },
  ];
  const modeStops = [
    { key: "ask", short: "Ask", name: "Ask" },
    { key: "edit", short: "Edit", name: "Auto edit" },
    { key: "auto", short: "Auto", name: "Full auto", warm: true },
  ];

  const swatches = [
    ["Ground", "--bg"],
    ["Panel", "--panel-bg"],
    ["Statusbar", "--statusbar-bg"],
    ["Bubble", "--bubble-user-bg"],
    ["Text", "--text"],
    ["Text dim", "--text-dim"],
    ["Accent", "--accent"],
    ["Danger", "--danger"],
    ["Success", "--success"],
    ["Warning", "--warning"],
    ["Info", "--info"],
  ];
  const washes = ["--wash-1", "--wash-2", "--wash-3", "--wash-4"];

  const questions = [
    {
      q: "Goal as I now understand it: more professional and production-ready, with the comfort kept. What is the comfort?",
      a: [
        "Soft, low-contrast dark with generous spacing (keep the tonal palette and airiness; tighten shapes, type and consistency)",
        "The rounded, friendly shapes and the round typeface (keep those; tighten color, depth and density)",
        "All of it: change the finish, not the character",
      ],
      why: "“Comfort” is the thing I must not break while raising the finish. Each option protects a different part, and the answer decides how bold the radii, type and edge changes can be.",
    },
    {
      q: "How far should the finish change?",
      a: [
        "Tighten: one radius and edge system, even spacing, consistent states. Same look, fewer inconsistencies",
        "Refine: the above plus type scale and face, denser sidebar rows, clearer hierarchy in the chat",
        "Rework: a new visual world (I would run the direction round again)",
      ],
      why: "My recommendation is Refine. Tighten alone will feel like nothing changed; Rework risks the comfort.",
    },
    {
      q: "Is “The Night Desk” the right name for the language?",
      a: ["Keep it", "Something plainer (“Quiet Room”, “Lamp”)", "No name, just the rules"],
      why: "It names the idea: a dim desk, accent as the lamp. Quiet Room already exists as a max-effort mode, so a clash is possible.",
    },
    {
      q: "The composer, bubbles and ask card use 16 to 22px corners, above the 12px top tier. What should they be?",
      a: ["Snap to 12px like every other container", "Make a fourth, softer tier (18px) for chat-facing surfaces", "Leave as is"],
      why: "They are the most visible rounded things, and the main source of the “just rounded” feeling. A deliberate soft tier is a defensible look; accidental drift is not.",
    },
    {
      q: "How much surface? Too many borders look ugly, but nothing should float on nothing either.",
      a: [
        "Three levels, one rule: ground, panel, floating. Only floating things and inputs get an edge or shadow; rows and groups inside a panel use spacing and a hover wash, never boxes",
        "Same, but also drop the panel edge and separate panels from ground by tone alone",
        "Keep today's mix of edges",
      ],
      why: "I only removed the brighter top edge so far (edges are now even). The first option is my recommendation: panels stay clearly surfaces, but only a few things ever have a border, and the accent marks only what is live.",
    },
    {
      q: "Type: keep Questrial as the UI face?",
      a: ["Keep", "Try a sturdier UI face and keep Questrial for the brand only", "Not now"],
      why: "Questrial is light and round, which adds to the soft feel. It was not on your must-keep list.",
    },
    {
      q: "Light themes: first-class or best-effort?",
      a: ["First-class: audit every surface in light", "Best-effort, dark is the real product"],
      why: "The wash tokens now follow text color, so light works better, but I have only checked dark.",
    },
    {
      q: "State color on sidebar rows: the Needs you tier uses the warning tone. Should urgency use the accent instead?",
      a: ["Keep warning for urgency", "Use the accent so it follows the theme"],
      why: "Warning stays readable on any accent. Accent keeps the language to one hue but can disappear when the accent is itself yellow or orange.",
    },
    {
      q: "Mobile: same language, or its own?",
      a: ["Same tokens, same rules", "Allow larger radii and denser touch targets on mobile"],
      why: "mobile.css already overrides some tokens; this decides whether that stays an exception or becomes a rule.",
    },
  ];
</script>

<div class="sheet">
  <header class="top">
    <h1>Yoake design sheet</h1>
    <p>
      Real tokens and components from the app, plus hand-built zoomed pieces of the UI. Follows
      <code>DESIGN.md</code>. Theme and accent come from your settings.
    </p>
    <nav>
      <a href="#foundations">Foundations</a><a href="#controls">Controls</a><a href="#app">In the app</a><a href="#proposals">Proposals</a
      ><a href="#questions">Questions</a>
    </nav>
  </header>

  <section id="foundations">
    <h2>Foundations</h2>

    <h3>Color <span>one hue drives all of it</span></h3>
    <div class="swatches">
      {#each swatches as [name, v]}
        <div class="sw"><i style:background="var({v})"></i><b>{name}</b><code>{v}</code></div>
      {/each}
    </div>
    <div class="washes">
      {#each washes as w, i}
        <div class="wash" style:background="var({w})"><b>wash-{i + 1}</b><span>{[4, 6, 9, 14][i]}% of text</span></div>
      {/each}
      <div class="wash edge"><b>edge</b><span>one hairline, all sides</span></div>
    </div>

    <h3>Shape <span>radius by nesting depth</span></h3>
    <div class="shapes">
      <div class="shape lg">
        <b>lg · 12px</b><span>containers</span>
        <div class="shape sm"><b>sm · 7px</b><span>controls</span><div class="shape xs">xs · 4px</div></div>
      </div>
      <div class="shape pill">pill · toggles, tags, triggers</div>
      <div class="shape circle">50%</div>
    </div>

    <h3>Depth <span>tonal first; shadow only when it floats</span></h3>
    <div class="depth">
      <div class="card flat">At rest<br /><span>fill step + hairline</span></div>
      <div class="card" style:box-shadow="var(--shadow-pop)">Pop<br /><span>menus, toasts</span></div>
      <div class="card" style:box-shadow="var(--shadow-dialog)">Dialog<br /><span>cards, pickers</span></div>
    </div>

    <h3>Type <span>four sizes, weight does the work</span></h3>
    <div class="type">
      <p style="font-size: var(--text-title-size); font-weight: var(--text-title-weight)">Title · 1.05rem · 700</p>
      <p style="font-size: var(--text-body-size); font-weight: var(--text-body-weight)">Body · 0.85rem · 400. The quick brown fox jumps over the lazy dog.</p>
      <p style="font-size: var(--text-label-size); font-weight: var(--text-label-weight)">Label · 0.78rem · 500</p>
      <p style="font-size: var(--text-heading-size); font-weight: var(--text-heading-weight); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim)">Heading · 0.72rem · 700</p>
      <p style="font-family: var(--code-font-family); font-size: var(--code-font-size)">Mono · const answer = 42;</p>
    </div>
  </section>

  <section id="controls">
    <h2>Controls <span>the real components, zoomed 1.6×</span></h2>
    <div class="accents">
      {#each accents as a}
        <button class:on={accent === a.value} onclick={() => (accent = a.value)}>
          <i style:background={a.value || "var(--accent)"}></i>{a.name}
        </button>
      {/each}
    </div>

    <div class="grid" style:--accent={accent || undefined}>
      <div class="spec">
        <h4>Button</h4>
        <div class="row">
          <Button variant="primary">Primary</Button>
          <Button>Default</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </div>
        <div class="row">
          <Button size="sm">Small</Button>
          <Button icon aria-label="Add"><Icon name="plus" /></Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button variant="ghost" destructive>Remove</Button>
        </div>
        <p>Flat solid. Press scales the box, never the label. One primary per view.</p>
      </div>

      <div class="spec">
        <h4>Switch · Checkbox · Radio</h4>
        <div class="row">
          <Switch bind:checked={sw1} label="On" />
          <Switch bind:checked={sw2} label="Off" />
          <Checkbox bind:checked={ck1} label="Checked" />
          <Checkbox bind:checked={ck2} label="Empty" />
        </div>
        <div class="row">
          <Radio bind:group={radio} value="a">One</Radio>
          <Radio bind:group={radio} value="b">Two</Radio>
          <Radio bind:group={radio} value="c">Three</Radio>
        </div>
        <p>Sunk wells; the accent means “on”. Stretched bead stays a pill.</p>
      </div>

      <div class="spec">
        <h4>Segmented · Chip · Badge</h4>
        <div class="row">
          <Segmented
            bind:value={seg}
            label="View"
            options={[
              { value: "chat", label: "Chat" },
              { value: "diff", label: "Diff" },
              { value: "term", label: "Terminal" },
            ]}
          />
        </div>
        <div class="row">
          <Chip bind:pressed>Filter</Chip>
          <Chip>Plain</Chip>
          <Chip onremove={() => {}}>yoake-gui</Chip>
        </div>
        <div class="row">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="success" dot>Online</Badge>
          <Badge tone="warning" dot>Waiting</Badge>
          <Badge tone="danger">Error</Badge>
          <Badge mono>+12 −2</Badge>
        </div>
        <p>Selection is a raised pill. Tags are a tint of their tone.</p>
      </div>

      <div class="spec">
        <h4>Slider</h4>
        <div class="stack">
          <Slider bind:value={slide} label="Volume" format={(v) => `${v}%`} />
          <Slider bind:value={effort} stops={effortStops} defaultIndex={2} hot tone="neutral" label="Effort" />
          <Slider bind:value={mode} stops={modeStops} hot tone="neutral" label="Mode" />
        </div>
        <p>The only gradient in the set is the lamp on Effort and Mode. Held sliders never ease.</p>
      </div>

      <div class="spec">
        <h4>Fields</h4>
        <div class="stack">
          <TextField bind:value={text} placeholder="Project name" />
          <TextField value="not a url" invalid />
          <TextField value="" placeholder="Disabled" disabled />
          <NumberField bind:value={num} min={0} max={100} unit="px" label="Size" />
          <TextArea value="" placeholder="A longer note" />
        </div>
        <p>Focus lifts the fill and adds a faint accent ring; the border never turns accent.</p>
      </div>

      <div class="spec">
        <h4>Progress · Spinner</h4>
        <div class="stack">
          <Progress value={43} label="Context" />
          <Progress label="Loading" />
          <div class="row"><Spinner size="s" /><Spinner /><Spinner size="l" /></div>
        </div>
        <p>Sunk bar, solid fill. Spinners take the text color.</p>
      </div>
    </div>
  </section>

  <section id="app">
    <h2>In the app <span>hand-built from the real component styles, zoomed</span></h2>

    <div class="snaps">
      <figure>
        <div class="zoom z18 pane">
          <div class="sec">NEEDS YOU</div>
          <div class="crow attn active">
            <svg class="ico warn" viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M8 4.8v3.8M8 10.8v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
            <div class="txt"><b>Refine the settings dialog</b><span class="meta warn">Which toggle style should the rows…</span><span class="org"><i class="av">L</i>laptop/yoake-gui</span></div>
            <time>now</time>
          </div>
          <div class="crow attn">
            <svg class="ico warn" viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M8 4.8v3.8M8 10.8v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
            <div class="txt"><b>Jellyfin transcoding config</b><span class="meta warn">bash on docker compose up</span><span class="org"><i class="av h">H</i>homelab/media-stack</span></div>
            <time>44m</time>
          </div>
          <div class="sec">WORKING</div>
          <div class="crow">
            <svg class="ico info" viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.6" /><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
            <div class="txt"><span class="t">Fix terminal resize flicker</span><span class="meta dim">laptop/yoake-gui · Trace the…</span></div>
            <time>4m</time>
          </div>
          <div class="sec">READY</div>
          <div class="crow">
            <svg class="ico ok" viewBox="0 0 16 16" width="13" height="13"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <div class="txt"><span class="t">Command palette sections</span></div>
            <time>19h</time>
          </div>
        </div>
        <figcaption><b>Sidebar tiers</b> · rows are 7px, only Needs you gets an edge (warning at 35%) and a wash; Working and Ready are bare until hovered</figcaption>
      </figure>

      <figure>
        <div class="zoom z22 tabs">
          <div class="chrome-surface tab warnedge"><svg viewBox="0 0 16 16" width="13" height="13" class="warn"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M8 4.8v3.8M8 10.8v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>Jellyfin tra…</div>
          <div class="chrome-surface tab"><svg viewBox="0 0 16 16" width="13" height="13" class="info"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.6" /><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>Fix termina…</div>
        </div>
        <figcaption><b>Chrome tabs</b> · 12px island surface with the same even hairline; state shown by icon and edge tint</figcaption>
      </figure>

      <figure class="wide">
        <div class="zoom z18 bubblerow">
          <div class="bub">Rename the Subscriptions heading too, like we did in <span class="mention">Fix login</span>.</div>
          <i class="av2">🐣</i>
        </div>
        <figcaption><b>User bubble</b> · 16px corners, the softest thing in the chat; avatar is 7px square</figcaption>
      </figure>

      <figure class="wide">
        <div class="zoom z16 code">
          <div class="chead"><span>ts</span><span>⧉</span></div>
          <pre><span class="k">export function</span> <span class="f">row</span>(label: <span class="ty">string</span>, hint?: <span class="ty">string</span>) &#123;
  <span class="k">return</span> &#123; label, hint &#125;; <span class="c">// one recipe everywhere</span>
&#125;</pre>
        </div>
        <figcaption><b>Code block</b> · 7px, hairline, palette from the theme's terminal colors</figcaption>
      </figure>

      <figure class="wide">
        <div class="zoom z16 dock">
          <div class="askc">
            <div class="ah"><span class="qi">?</span><b>Which toggle style should the rows use?</b><em>1 of 2</em></div>
            <div class="opt sel"><kbd>1</kbd>Switch</div>
            <div class="opt"><kbd>2</kbd>Checkbox</div>
            <div class="opt"><kbd>↗</kbd>Something else…</div>
            <div class="skip"><span class="skipbtn">Skip <kbd>Esc</kbd></span></div>
          </div>
          <div class="composer">
            <span class="ph">Or tell it what to do instead (answers all 2)…</span>
            <div class="tool">
              <span class="picker-trigger"><svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="3" fill="#e0836a" /></svg>Claude Opus 5.5</span>
              <span class="picker-trigger">Medium</span>
              <span class="picker-trigger">Ask</span>
              <span class="send">↑</span>
            </div>
          </div>
        </div>
        <figcaption><b>Ask card and composer</b> · 18px and 22px: the two largest radii in the app, both above the 12px container tier</figcaption>
      </figure>

      <figure class="wide">
        <div class="zoom z16 statusbar">
          <span class="si">CPU 21%</span><span class="si">RAM 41%</span><span class="si warn">work box reconnecting…</span><span class="si">main <b class="ok">+12</b> <b class="bad">−2</b></span>
          <span class="grow"></span>
          <span class="si info">1 running</span><span class="si warn">2 waiting</span><span class="si">30d 100%</span><span class="si">$3.10 today</span>
        </div>
        <figcaption><b>Status bar</b> · statusbar fill, one top hairline, tabular numerals, semantic colors</figcaption>
      </figure>
    </div>
  </section>

  <section id="proposals">
    <h2>Proposals <span>fewer surfaces, quieter urgency, one finish. Same pieces, three ways</span></h2>

    {#snippet tiers(v: string)}
      <div class="zoom z18 pane pv pv-{v}">
        <div class="sec">NEEDS YOU {#if v !== "cur"}<span class="cnt">2</span>{/if}</div>
        {#each [["Refine the settings dialog", "Which toggle style should the rows…", "now", "L", true], ["Jellyfin transcoding config", "bash on docker compose up", "44m", "H", false]] as r}
          <div class="crow attn" class:active={r[4]}>
            {#if v === "cur"}
              <svg class="ico warn" viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M8 4.8v3.8M8 10.8v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
            {:else}
              <i class="lamp"></i>
            {/if}
            <div class="txt"><b>{r[0]}</b><span class="meta warn">{r[1]}</span><span class="org"><i class="av" class:h={r[3] === "H"}>{r[3]}</i>{r[3] === "L" ? "laptop/yoake-gui" : "homelab/media-stack"}</span></div>
            <time>{r[2]}</time>
          </div>
        {/each}
        <div class="sec">WORKING</div>
        <div class="crow">
          <svg class="ico info" viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.6" /><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
          <div class="txt"><span class="t">Fix terminal resize flicker</span><span class="meta dim">laptop/yoake-gui · Trace the…</span></div>
          <time>4m</time>
        </div>
        <div class="sec">READY</div>
        <div class="crow">
          <svg class="ico ok" viewBox="0 0 16 16" width="13" height="13"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <div class="txt"><span class="t">Command palette sections</span></div>
          <time>19h</time>
        </div>
      </div>
    {/snippet}

    <h3>Needs you <span>no outline; urgency is a lamp and a heavier title</span></h3>
    <div class="trio">
      <figure>{@render tiers("cur")}<figcaption><b>Today</b> · 1px warning edge plus a wash per card, three boxes in a stack</figcaption></figure>
      <figure>{@render tiers("lamp")}<figcaption><b>A · Lamp</b> · no box at all. A lit dot, bold title, a count on the label. Urgency stays where the eye already goes</figcaption></figure>
      <figure>{@render tiers("tint")}<figcaption><b>B · Tint</b> · same lamp, plus a soft warning wash (9%) and no edge, so the tier still reads as a group</figcaption></figure>
    </div>

    <h3>Ask and composer <span>one surface instead of two stacked cards</span></h3>
    <div class="duo">
      <figure>
        <div class="zoom z16 dock">
          <div class="askc">
            <div class="ah"><span class="qi">?</span><b>Which toggle style should the rows use?</b><em>1 of 2</em></div>
            <div class="opt sel"><kbd>1</kbd>Switch</div>
            <div class="opt"><kbd>2</kbd>Checkbox</div>
            <div class="skip"><span class="skipbtn">Skip <kbd>Esc</kbd></span></div>
          </div>
          <div class="composer"><span class="ph">Or tell it what to do instead…</span>
            <div class="tool"><span class="picker-trigger">Claude Opus 5.5</span><span class="picker-trigger">Medium</span><span class="send">↑</span></div>
          </div>
        </div>
        <figcaption><b>Today</b> · two floating cards, 18px and 22px, a shadow on one and a hairline on both</figcaption>
      </figure>
      <figure>
        <div class="zoom z16 dock pro">
          <div class="one">
            <div class="ah"><span class="qi">?</span><b>Which toggle style should the rows use?</b><em>1 of 2</em></div>
            <div class="opt sel"><kbd>1</kbd>Switch</div>
            <div class="opt"><kbd>2</kbd>Checkbox</div>
            <div class="rule"></div>
            <span class="ph">Or tell it what to do instead…</span>
            <div class="tool"><span class="picker-trigger">Claude Opus 5.5</span><span class="picker-trigger">Medium</span><span class="send">↑</span></div>
          </div>
        </div>
        <figcaption><b>Proposed</b> · one surface, 14px, one hairline between question and reply, no card on card</figcaption>
      </figure>
    </div>

    <h3>Chrome tabs <span>fill only</span></h3>
    <div class="duo">
      <figure>
        <div class="zoom z22 tabs">
          <div class="chrome-surface tab warnedge"><svg viewBox="0 0 16 16" width="13" height="13" class="warn"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M8 4.8v3.8M8 10.8v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>Jellyfin tra…</div>
          <div class="chrome-surface tab"><svg viewBox="0 0 16 16" width="13" height="13" class="info"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.6" /><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>Fix termina…</div>
        </div>
        <figcaption><b>Today</b> · outlined pills, one with a warning edge</figcaption>
      </figure>
      <figure>
        <div class="zoom z22 tabs pro">
          <div class="ptab on"><i class="lamp"></i>Jellyfin tra…</div>
          <div class="ptab"><svg viewBox="0 0 16 16" width="13" height="13" class="info"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.6" /><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>Fix termina…</div>
        </div>
        <figcaption><b>Proposed</b> · filled, no outline; the lamp carries urgency, same as the sidebar</figcaption>
      </figure>
    </div>

    <h3>The rule behind all of it</h3>
    <ul class="rules">
      <li>Three levels: <b>ground</b>, <b>panel</b>, <b>floating</b>. Nothing else gets a fill that reads as a card.</li>
      <li>An outline appears only where fill cannot separate: floating over content, and inputs on a same-tone surface.</li>
      <li>Rows, groups, tabs and message parts separate by space, a hover wash, or a hairline between sections. Never a box.</li>
      <li>Urgency is a <b>lamp</b> (a lit dot and a heavier title), the same everywhere: sidebar, tabs, status bar.</li>
      <li>Professional finish: tighter radii (8 / 6 / 4), a neutral UI face with tabular numerals, and one alignment grid for icon, text and time columns. The proposals above use the system UI face so you can judge the type change too.</li>
    </ul>
  </section>

  <section id="questions">
    <h2>Questions</h2>
    <p class="lede">Answer in chat by number. Nothing here is applied until you do.</p>
    <ol class="qs">
      {#each questions as item}
        <li>
          <h4>{item.q}</h4>
          <ul>
            {#each item.a as opt}<li>{opt}</li>{/each}
          </ul>
          <p>{item.why}</p>
        </li>
      {/each}
    </ol>
  </section>
</div>

<style>
  .sheet {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    padding: 0 var(--space-3) var(--space-5);
    background: var(--bg);
    color: var(--text);
    font-size: var(--text-body-size);
    scroll-behavior: smooth;
    user-select: text;
  }
  .sheet :global(*) {
    user-select: text;
  }
  .top,
  section {
    max-width: 62rem;
    margin: 0 auto;
  }
  .top {
    padding: var(--space-4) 0 var(--space-2);
  }
  h1 {
    margin: 0 0 var(--space-half);
    font-size: 1.5rem;
  }
  h2 {
    margin: var(--space-5) 0 var(--space-2);
    font-size: var(--text-title-size);
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--panel-border);
  }
  h2 span,
  h3 span {
    font-weight: 400;
    color: var(--text-dim);
    font-size: var(--text-label-size);
    margin-left: 0.5rem;
  }
  h3 {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-label-size);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }
  h4 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  p {
    margin: 0;
    color: var(--text-dim);
  }
  code {
    font-size: 0.75rem;
    color: var(--text-dim);
  }
  nav {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  nav a {
    color: var(--accent);
    text-decoration: none;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: var(--space-1);
  }
  .sw {
    display: grid;
    gap: 2px;
  }
  .sw i {
    height: 3.2rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--panel-border);
  }
  .sw b {
    font-weight: 500;
    font-size: var(--text-label-size);
  }
  .washes {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .wash {
    padding: var(--space-1);
    min-height: 3.6rem;
    border-radius: var(--radius-sm);
    display: grid;
    align-content: end;
    font-size: var(--text-label-size);
  }
  .wash span {
    color: var(--text-dim);
    font-size: 0.7rem;
  }
  .wash.edge {
    border: 1px solid var(--panel-border);
  }

  .shapes {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .shape {
    padding: var(--space-1);
    border: 1px solid var(--panel-border);
    background: var(--panel-bg);
    font-size: var(--text-label-size);
    display: grid;
    gap: 4px;
  }
  .shape span {
    color: var(--text-dim);
  }
  .shape.lg {
    border-radius: var(--radius-lg);
    padding: 5px 5px var(--space-2);
    width: 15rem;
    padding: 12px;
  }
  .shape.lg > b,
  .shape.lg > span {
    padding-left: 2px;
  }
  .shape.sm {
    border-radius: var(--radius-sm);
    margin-top: 6px;
    background: var(--wash-2);
    padding: 5px;
  }
  .shape.xs {
    border-radius: var(--radius-xs);
    background: var(--wash-3);
    padding: 2px 6px;
    justify-self: start;
    margin-top: 4px;
  }
  .shape.pill {
    border-radius: var(--radius-pill);
    padding: 6px 14px;
  }
  .shape.circle {
    border-radius: 50%;
    width: 3rem;
    height: 3rem;
    place-items: center;
  }

  .depth {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-2) 0;
  }
  .card {
    width: 10rem;
    padding: var(--space-2);
    border-radius: var(--radius-lg);
    background: var(--float-bg);
    border: 1px solid var(--panel-border);
  }
  .card span {
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .card.flat {
    background: var(--panel-bg);
  }
  .type p {
    margin: 0 0 var(--space-1);
    color: var(--text);
  }

  .accents {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    margin-bottom: var(--space-2);
  }
  .accents button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 1.86rem;
    padding: 0 0.7rem;
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    background: var(--wash-1);
    color: var(--text-dim);
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  .accents button.on {
    color: var(--text);
    background: var(--wash-3);
  }
  .accents i {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
    gap: var(--space-2);
  }
  .spec {
    padding: var(--space-2);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
    display: grid;
    gap: var(--space-2);
    align-content: start;
  }
  .spec .row,
  .spec .stack {
    zoom: 1.35;
  }
  .row {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    align-items: center;
  }
  .stack {
    display: grid;
    gap: var(--space-2);
  }
  .spec p {
    font-size: var(--text-label-size);
  }

  .snaps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: var(--space-3) var(--space-2);
  }
  figure {
    margin: 0;
    display: grid;
    gap: var(--space-1);
    align-content: start;
  }
  figure {
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  figure.wide {
    grid-column: 1 / -1;
  }
  figcaption {
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  figcaption b {
    color: var(--text);
    font-weight: 500;
  }

  .lede {
    margin-bottom: var(--space-2);
  }
  .qs {
    margin: 0;
    padding-left: 1.4rem;
    display: grid;
    gap: var(--space-3);
  }
  .qs > li::marker {
    color: var(--accent);
    font-weight: 700;
  }
  .qs h4 {
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 500;
    margin-bottom: var(--space-1);
  }
  .qs ul {
    margin: 0 0 var(--space-1);
    padding-left: 1.1rem;
    list-style: "– ";
  }
  .qs ul li {
    margin: 2px 0;
  }
  .qs p {
    font-size: var(--text-label-size);
  }
  /* Hand-built mocks of composed pieces. Each mirrors the real component's CSS (ChatRow, MessageBubble,
     PromptInput, AskCard, StatusBar) at the app's own sizes; .zN only zooms it. */
  .zoom {
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
    padding: 0.7rem;
    width: max-content;
    max-width: 100%;
    font-size: 0.8rem;
    color: var(--sidebar-fg);
  }
  .z16 { zoom: 1.6; }
  .z18 { zoom: 1.8; }
  .z22 { zoom: 2.2; }
  .zoom.pane { width: 233px; }
  .sec { font-size: 0.64rem; letter-spacing: 0.08em; color: var(--sidebar-fg-dim); padding: 0.5rem 0.4rem 0.2rem; font-weight: 700; }
  .crow { display: flex; gap: 0.57rem; align-items: flex-start; padding: 0.45rem 0.43rem 0.45rem 0.71rem; border: 1px solid transparent; border-radius: var(--radius-sm); }
  .crow.attn { background: var(--sidebar-hover); border-color: color-mix(in srgb, var(--warning) 35%, transparent); margin: 0.14rem 0; color: var(--text); }
  .crow.active { background: var(--sidebar-active); }
  .crow .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.14rem; }
  .crow .txt b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .crow .t { white-space: nowrap; }
  .crow .meta { font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .crow .org { display: flex; align-items: center; gap: 0.3rem; font-size: 0.72rem; color: var(--text-dim); }
  .crow time { font-size: 0.7rem; color: var(--sidebar-fg-dim); margin-top: 0.2rem; }
  .ico { margin-top: 0.1rem; flex-shrink: 0; }
  .warn { color: var(--warning); }
  .info { color: var(--info); }
  .ok { color: var(--success); }
  .bad { color: var(--danger); }
  .dim { color: var(--text-dim); }
  .av { display: inline-grid; place-items: center; width: 13px; height: 13px; border-radius: 3px; background: color-mix(in srgb, var(--success) 70%, var(--bg)); color: #fff; font: 700 0.55rem/1 var(--ui-font-family); font-style: normal; }
  .av.h { background: color-mix(in srgb, #b45fd0 70%, var(--bg)); }

  .zoom.tabs { display: flex; gap: 0.43rem; padding: 0.9rem; }
  .tab { display: flex; align-items: center; gap: 0.4rem; height: 33px; padding: 0 0.7rem; font-size: 0.78rem; color: var(--text); }
  .tab.warnedge { border-color: color-mix(in srgb, var(--warning) 55%, transparent); }

  .zoom.bubblerow { display: flex; justify-content: flex-end; align-items: center; gap: 0.6rem; padding: 1.2rem 1rem; width: 31rem; }
  .bub { background: var(--bubble-user-bg); border-radius: 16px; padding: 0.71rem 1rem; font-size: 0.9rem; color: var(--text); max-width: 22rem; }
  .mention { display: inline-block; padding: 0 0.4rem; border-radius: var(--radius-xs); background: var(--accent-dim); color: var(--accent); }
  .av2 { width: 26px; height: 26px; display: grid; place-items: center; border-radius: var(--radius-sm); background: var(--sidebar-hover); font-style: normal; font-size: 0.9rem; flex: none; }

  .zoom.code { padding: 0; width: 34rem; background: var(--code-bg, var(--bg)); border-radius: var(--radius-sm); overflow: hidden; }
  .chead { display: flex; justify-content: space-between; padding: 0.3rem 0.7rem; font-size: 0.7rem; color: var(--text-dim); border-bottom: 1px solid var(--panel-border); }
  .zoom.code pre { margin: 0; padding: 0.6rem 0.7rem; color: var(--code-fg, var(--text)); font-size: var(--code-font-size); line-height: 1.5; white-space: pre-wrap; }
  .k { color: var(--syn-keyword); } .f { color: var(--syn-function); } .ty { color: var(--syn-type); } .c { color: var(--syn-comment); }

  .zoom.dock { width: 40rem; background: var(--bg); padding: 1rem 1rem 0.8rem; display: grid; gap: 0.57rem; }
  .askc { background: var(--float-bg); border: 1px solid var(--float-border); border-radius: 18px; box-shadow: var(--shadow-pop); padding: 0.71rem 0.57rem 0.57rem; display: grid; gap: 2px; }
  .ah { display: flex; align-items: center; gap: 0.43rem; padding: 0 0.29rem 0.4rem; font-size: var(--text-body-size); }
  .ah em { margin-left: auto; font-style: normal; color: var(--text-dim); font-size: 0.72rem; }
  .qi { color: var(--accent); font-weight: 700; }
  .opt { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0.6rem; border-radius: var(--radius-sm); color: var(--text); }
  .opt.sel { background: var(--wash-3); }
  kbd { display: inline-grid; place-items: center; min-width: 1.1rem; height: 1.1rem; padding: 0 0.25rem; border-radius: var(--radius-xs); background: var(--wash-2); color: var(--text-dim); font: 0.68rem var(--ui-font-family); }
  .skip { display: flex; justify-content: flex-end; padding-top: 0.3rem; }
  .skipbtn { display: inline-flex; align-items: center; gap: 0.4rem; height: 1.7rem; padding: 0 0.6rem; border-radius: var(--radius-sm); background: var(--wash-2); font-size: 0.78rem; font-weight: 600; color: var(--text); }
  .composer { background: var(--float-bg); border: 1px solid var(--float-border); border-radius: 22px; padding: 0.71rem 0.57rem 0.57rem; display: grid; gap: 0.7rem; }
  .ph { padding: 0 0.4rem; color: var(--text-dim); font-style: italic; font-size: var(--text-body-size); }
  .tool { display: flex; align-items: center; gap: 0.2rem; }
  .tool .picker-trigger { pointer-events: none; }
  .send { margin-left: auto; width: 2rem; height: 2rem; border-radius: 50%; display: grid; place-items: center; background: var(--accent-dim); color: var(--accent); font-weight: 700; }

  .zoom.statusbar { display: flex; align-items: center; gap: 0.3rem; width: 62rem; padding: 0 0.57rem; height: 1.86rem; border-radius: 0; background: var(--statusbar-bg); color: var(--statusbar-fg); border: 0; border-top: 1px solid var(--panel-border); font-size: 0.72rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .si { padding: 0 0.43rem; }
  .grow { flex: 1; }
  .trio .z18 { zoom: 1.3; }
  .trio { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: var(--space-3) var(--space-2); }
  .duo .z16 { zoom: 1.1; }
  .duo .z22 { zoom: 1.5; }
  .duo { display: grid; grid-template-columns: repeat(auto-fit, minmax(27rem, 1fr)); gap: var(--space-3) var(--space-2); }
  .cnt { margin-left: 0.3rem; padding: 0 0.35rem; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--warning) 16%, transparent); color: var(--warning); letter-spacing: 0; }
  .lamp { flex-shrink: 0; width: 7px; height: 7px; margin: 0.35rem 3px 0; border-radius: 50%; background: var(--warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 20%, transparent); }
  .pv-lamp, .pv-tint, .pro { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-variant-numeric: tabular-nums; }
  .pv-lamp .crow, .pv-tint .crow { border-radius: 6px; }
  .pv-lamp .crow.attn, .pv-tint .crow.attn { border-color: transparent; background: none; margin: 0; }
  .pv-lamp .crow.attn.active { background: var(--wash-2); }
  .pv-tint .crow.attn { background: color-mix(in srgb, var(--warning) 9%, transparent); margin: 2px 0; }
  .pv-lamp .meta.warn, .pv-tint .meta.warn { color: var(--text-dim); }
  .pro .one { background: var(--float-bg); border: 1px solid var(--float-border); border-radius: 14px; box-shadow: var(--shadow-pop); padding: 0.71rem 0.57rem 0.57rem; display: grid; gap: 2px; }
  .pro .opt { border-radius: 6px; }
  .pro .rule { height: 1px; background: var(--panel-border); margin: 0.5rem -0.57rem 0.6rem; }
  .pro .ph { padding: 0 0.3rem 0.4rem; }
  .ptab { display: flex; align-items: center; gap: 0.4rem; height: 33px; padding: 0 0.7rem; border-radius: 8px; background: var(--wash-1); color: var(--text-dim); font-size: 0.78rem; }
  .ptab.on { background: var(--wash-3); color: var(--text); }
  .ptab .lamp { margin: 0 3px 0 0; }
  .rules { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.5rem; max-width: 46rem; color: var(--text); }
  .rules b { font-weight: 600; }
</style>
