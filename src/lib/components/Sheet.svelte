<script lang="ts">
  // The one place a popover, menu or dialog decides how it is shown. bits-ui's content wrappers
  // (PopoverContent, MenuContent, SheetDialog) hand their `props` here through the `child` snippet:
  // on a phone it is a bottom sheet (or a full page), anywhere else it is exactly what bits-ui
  // would have rendered, floating at its anchor.
  //
  // A sheet keeps bits-ui's own element and wrapper, so dismissal, focus trap and presence stay
  // bits-ui's. Only the wrapper's position is replaced; dragging down closes it with Escape.
  import type { Snippet } from "svelte";
  import { viewport } from "../viewport.svelte";
  import { sheetDrag } from "../sheets";

  type Variant = "sheet" | "tall" | "page";
  let {
    props,
    wrapperProps,
    variant = "sheet",
    children,
  }: {
    props: Record<string, any>;
    /** Present for floating content (popover, menu, select); a dialog has none. */
    wrapperProps?: Record<string, any>;
    /** `tall` fills the screen below the status bar (a palette); `page` is the whole screen, faded in (settings). */
    variant?: Variant;
    children?: Snippet;
  } = $props();

  const phone = $derived(viewport.narrow);
  const state = $derived<string | undefined>(props["data-state"]);
</script>

{#if !phone}
  {#if wrapperProps}
    <div {...wrapperProps}><div {...props}>{@render children?.()}</div></div>
  {:else}
    <div {...props}>{@render children?.()}</div>
  {/if}
{:else}
  {#snippet body()}
    <div
      {...props}
      class={["sheet", variant, props.class]}
      {@attach variant === "page" ? undefined : sheetDrag()}
    >
      {#if variant !== "page"}<div class="grab" aria-hidden="true"></div>{/if}
      {@render children?.()}
    </div>
  {/snippet}
  {#if wrapperProps}
    <div class="scrim" data-state={state}></div>
    <div {...wrapperProps} class="wrap" style="position: fixed; inset: auto 0 0 0; z-index: var(--z-sheet, 140)" data-state={state}>
      {@render body()}
    </div>
  {:else}
    {@render body()}
  {/if}
{/if}

<style>
  @keyframes up {
    from {
      transform: translateY(100%);
    }
  }
  @keyframes down {
    to {
      transform: translateY(100%);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes fadeOut {
    to {
      opacity: 0;
    }
  }

  /* Behind a floating sheet; a tap on it is an outside tap, which bits-ui treats as "close". A
     dialog's own overlay does this job for dialogs. */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-sheet, 140) - 1);
    background: rgba(6, 7, 11, 0.5);
  }
  .scrim[data-state="open"] {
    animation: fade calc(0.34s * var(--anim-speed, 1)) cubic-bezier(0.32, 0.72, 0, 1);
  }
  .scrim[data-state="closed"] {
    animation: fadeOut calc(0.22s * var(--anim-speed, 1)) ease-in forwards;
    pointer-events: none;
  }
  /* A sheet on its way out must not hold the page hostage while it animates. */
  .wrap[data-state="closed"] {
    pointer-events: none;
  }

  /* `.sheet.sheet`: the content keeps its desktop class (a width, a margin, a radius) and this has
     to win without !important, so it counts twice. */
  .sheet.sheet {
    position: fixed;
    inset: auto 0 0 0;
    z-index: var(--z-sheet, 140);
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: none;
    max-height: min(78dvh, calc(var(--vvh, 100dvh) - 3rem));
    margin: 0;
    /* A dialog's desktop rule centres it with translate(-50%, -50%). */
    transform: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    border-bottom-width: 0;
    padding-bottom: max(var(--safe-bottom, 0px), var(--space-1));
    transform-origin: bottom;
    box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.35);
  }
  .sheet.sheet[data-state="open"] {
    animation: up calc(0.34s * var(--anim-speed, 1)) cubic-bezier(0.32, 0.72, 0, 1);
  }
  .sheet.sheet[data-state="closed"] {
    animation: down calc(0.22s * var(--anim-speed, 1)) ease-in forwards;
    pointer-events: none;
  }
  /* In a floating wrapper the sheet is placed by the wrapper, not by itself. */
  .wrap > .sheet.sheet {
    position: static;
  }
  .sheet.sheet.tall {
    height: calc(var(--vvh, 100dvh) - var(--safe-top, 0px) - 1.2rem);
    max-height: none;
  }
  .sheet.sheet.page {
    inset: 0;
    height: var(--vvh, 100dvh);
    max-height: none;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    padding: var(--safe-top, 0px) env(safe-area-inset-right, 0px) 0 env(safe-area-inset-left, 0px);
    background: var(--panel-bg);
    backdrop-filter: none;
    overflow: hidden;
  }
  .sheet.sheet.page[data-state="open"] {
    animation: fade var(--dialog-enter-duration, 0.2s) var(--ui-ease);
  }
  .sheet.sheet.page[data-state="closed"] {
    animation: fadeOut var(--dialog-exit-duration, 0.15s) ease-in forwards;
  }

  /* The grabber: a hint that the sheet can be pulled down. */
  .grab {
    width: 2.4rem;
    height: 4px;
    margin: 0.5rem auto 0.3rem;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--text) 22%, transparent);
  }
  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .sheet.sheet {
      animation: none !important;
    }
  }
</style>
