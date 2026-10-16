<script lang="ts">
  import { Dialog } from "bits-ui";
  import { answerConfirm, confirmState } from "../confirm.svelte";
  import Button from "./ui/Button.svelte";

  // `pending` is cleared on answer; keep the text so it doesn't vanish during the close animation.
  let message = $state("");
  $effect(() => {
    if (confirmState.pending) message = confirmState.pending.message;
  });
</script>

<Dialog.Root open={!!confirmState.pending} onOpenChange={(o) => !o && answerConfirm(false)}>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay confirm-overlay" />
    <Dialog.Content class="dialog-content confirm">
      <Dialog.Title class="confirm-title">Are you sure?</Dialog.Title>
      <Dialog.Description class="confirm-msg">{message}</Dialog.Description>
      <div class="confirm-actions">
        <Button type="button" variant="ghost" onclick={() => answerConfirm(false)}>Cancel</Button>
        <Button type="button" variant="primary" onclick={() => answerConfirm(true)}>Confirm</Button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.dialog-overlay.confirm-overlay) {
    z-index: var(--z-confirm-backdrop);
  }
  :global(.dialog-content.confirm) {
    width: min(24rem, 92vw);
    padding: var(--space-2);
    gap: var(--space-1, 0.5rem);
    z-index: var(--z-confirm-content);
  }
  :global(.confirm-title) {
    font-weight: 600;
  }
  :global(.confirm-msg) {
    color: var(--text-dim);
    white-space: pre-wrap;
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
