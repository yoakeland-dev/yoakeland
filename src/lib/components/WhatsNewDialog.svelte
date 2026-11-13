<script lang="ts">
  import SheetDialog from "./SheetDialog.svelte";
  import { Dialog } from "bits-ui";
  import { WHATS_NEW } from "../whatsnew";
  import { fmtVersion } from "../serverVersion";
  import { openUrl } from "../platform";
  import Button from "./ui/Button.svelte";
  import Icon from "./Icon.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const entry = WHATS_NEW[__APP_VERSION__];
  const releaseUrl = `https://github.com/yoakeland-dev/yoakeland/releases/tag/v${__APP_VERSION__}`;
</script>

{#if entry}
  <Dialog.Root bind:open>
    <Dialog.Portal>
      <Dialog.Overlay class="dialog-overlay" />
      <SheetDialog class="dialog-content whatsnew">
        <div class="hero">
          {#if entry.image}<img src={entry.image} alt="" />{:else}<img class="mark" src="logo.png" alt="" />{/if}
        </div>
        <div class="body">
          <Dialog.Description class="eyebrow">What's new in {fmtVersion(__APP_VERSION__)}</Dialog.Description>
          <Dialog.Title class="whatsnew-title">{entry.title}</Dialog.Title>
          <ul>
            {#each entry.items as it (it.title)}
              <li>
                <span class="chip"><Icon name={it.icon as never} size={15} /></span>
                <div><b>{it.title}</b><span>{it.body}</span></div>
              </li>
            {/each}
          </ul>
        </div>
        <div class="foot">
          <Button variant="ghost" onclick={() => openUrl(releaseUrl)}><Icon name="brand-github" size={14} />View release</Button>
          <Dialog.Close>{#snippet child({ props })}<Button {...props} variant="primary">Got it</Button>{/snippet}</Dialog.Close>
        </div>
      </SheetDialog>
    </Dialog.Portal>
  </Dialog.Root>
{/if}

<style>
  :global(.dialog-content.whatsnew) {
    width: min(31rem, 92vw);
    padding: 0.36rem;
    overflow: hidden;
  }
  .hero {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: calc(var(--radius-lg) - 0.36rem);
    overflow: hidden;
    background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 55%, transparent), color-mix(in srgb, var(--accent) 8%, transparent));
  }
  /* The graphic sets its own height from its aspect ratio; a very tall one is cropped. */
  .hero img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 14rem;
    object-fit: cover;
  }
  .hero:has(img.mark) {
    height: 9.5rem;
  }
  .hero img.mark {
    width: 4rem;
    height: 4rem;
    object-fit: contain;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 1.2rem 1rem 0.4rem;
    overflow-y: auto;
    min-height: 0;
  }
  /* Stays put while the list scrolls. */
  .foot {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.64rem 0.64rem 0.28rem;
    border-top: 1px solid var(--panel-border);
  }
  :global(.eyebrow) {
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--accent-ink);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  :global(.whatsnew-title) {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  ul {
    list-style: none;
    margin: 0.6rem 0 0.8rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: 0.86rem;
  }
  li div {
    display: flex;
    flex-direction: column;
    gap: 0.21rem;
    min-width: 0;
  }
  li div span {
    color: var(--text-dim);
    font-size: var(--text-body-size);
    line-height: 1.5;
  }
  .chip {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: var(--radius-md);
    color: var(--accent-ink);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .body :global(button) {
    align-self: flex-end;
  }
</style>
