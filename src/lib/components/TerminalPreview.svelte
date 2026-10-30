<script lang="ts">
  // The Settings > Text & code terminal sample: a real xterm (selection, scrollbar, smooth scrolling)
  // fed fixed output, so what the settings change looks exactly like the live terminal.
  import { onDestroy, onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import { app } from "../state.svelte";
  import type { TerminalColorTheme } from "../theme";

  let { colors }: { colors: TerminalColorTheme } = $props();

  const D = "\x1b[2m", B = "\x1b[1m", G = "\x1b[32m", C = "\x1b[36m", Y = "\x1b[33m", R = "\x1b[31m", X = "\x1b[0m";
  const stamp = (s: string) => `${D}${s}${X}`;
  const PROMPT = `${G}me@yoake${X} ${C}~/project${X} $ `;
  const SAMPLE = [
    `${PROMPT}pnpm dev`,
    "",
    `${D}> project@1.0.0 dev${X}`,
    `${D}> vite${X}`,
    "",
    `  ${G}${B}VITE${X} ${G}v7.1.2${X}  ready in ${B}312${X} ms`,
    "",
    `  ${G}➜${X}  ${B}Local${X}:   ${C}http://localhost:${B}5173${X}${C}/${X}`,
    `  ${G}➜${X}  ${B}Network${X}: ${D}use ${B}--host${X}${D} to expose${X}`,
    `  ${G}➜${X}  ${D}press ${B}h + enter${X}${D} to show help${X}`,
    "",
    `${stamp("12:04:11")} ${C}[vite]${X} ${G}hmr update${X} ${D}/src/lib/components/SettingsPanel.svelte${X}`,
    `${stamp("12:04:19")} ${C}[vite]${X} ${G}hmr update${X} ${D}/src/lib/components/Markdown.svelte${X}`,
    `${stamp("12:04:19")} ${C}[vite]${X} ${G}hmr update${X} ${D}/src/lib/highlight.ts${X}`,
    `${stamp("12:04:32")} ${Y}[vite-plugin-svelte]${X} ${Y}a11y_click_events_have_key_events${X}`,
    `${D}  src/lib/components/ChatRow.svelte:88:4${X}`,
    `${stamp("12:05:02")} ${C}[vite]${X} ${Y}page reload${X} ${D}src/app.css${X}`,
    `${stamp("12:05:40")} ${C}[vite]${X} ${G}hmr update${X} ${D}/src/lib/state.svelte.ts${X} ${D}(x2)${X}`,
    `${stamp("12:06:13")} ${R}[vite] Internal server error:${X} Unexpected token`,
    `${D}  at SettingsPanel.svelte:1352:9${X}`,
    `${stamp("12:06:21")} ${C}[vite]${X} ${G}hmr update${X} ${D}/src/lib/components/SettingsPanel.svelte${X}`,
    `${D}^C${X}`,
    PROMPT,
  ].join("\r\n");

  let host: HTMLDivElement;
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  let ro: ResizeObserver | undefined;
  let retry: ReturnType<typeof setInterval> | undefined;

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  onMount(() => {
    term = new Terminal({
      fontFamily: css("--code-font-family"),
      fontSize: parseFloat(css("--code-font-size")) || 12.5,
      scrollback: 200,
      theme: colors,
      disableStdin: true,
      cursorBlink: true,
      smoothScrollDuration: app.settings.terminalSmoothScroll ? 125 : 0,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    // Cell metrics aren't measured until after the first render, so the fit above can be a no-op and
    // the terminal keeps its default 24 rows (taller than the box: no scrollbar, no wheel). Retry until
    // there's a size to fit to.
    retry = setInterval(() => {
      if (!fit?.proposeDimensions()) return;
      clearInterval(retry);
      fit.fit();
      term?.scrollToBottom();
    }, 50);
    term.write(SAMPLE);
    ro = new ResizeObserver(() => fit?.fit());
    ro.observe(host);
  });

  onDestroy(() => {
    clearInterval(retry);
    ro?.disconnect();
    term?.dispose();
  });

  $effect(() => {
    if (term) term.options.theme = colors;
  });
  $effect(() => {
    if (term) term.options.smoothScrollDuration = app.settings.terminalSmoothScroll ? 125 : 0;
  });
</script>

<!-- Focused while hovered so the cursor blinks like a live terminal's; stdin is off, so it's inert. -->
<div
  class="term-preview"
  role="presentation"
  onmouseenter={() => term?.focus()}
  onmouseleave={() => term?.blur()}
  style="background: {colors.background}; padding: {app.settings.terminalMarginY}px {app.settings.terminalMarginX}px"
>
  <div class="term-host" bind:this={host}></div>
</div>

<style>
  .term-preview {
    height: 13rem;
    overflow: hidden;
  }
  /* Wheeling past either end stays in the terminal instead of scrolling the settings page. */
  .term-preview :global(.xterm-viewport) {
    overscroll-behavior: contain;
  }
  .term-host {
    height: 100%;
  }
  .term-preview :global(.xterm),
  .term-preview :global(.xterm-viewport),
  .term-preview :global(.xterm-screen) {
    height: 100%;
    background: transparent;
  }
</style>
