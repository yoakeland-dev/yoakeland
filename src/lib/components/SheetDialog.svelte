<script lang="ts">
  // Dialog.Content that is a bottom sheet on a phone: `tall` for a palette, `page` for settings.
  import { Dialog } from "bits-ui";
  import type { ComponentProps } from "svelte";
  import Sheet from "./Sheet.svelte";

  let {
    children,
    variant = "sheet",
    ref = $bindable(null),
    ...rest
  }: ComponentProps<typeof Dialog.Content> & { variant?: "sheet" | "tall" | "page" } = $props();
</script>

<Dialog.Content bind:ref {...rest}>
  {#snippet child({ props })}
    <Sheet {props} {variant}>{@render children?.()}</Sheet>
  {/snippet}
</Dialog.Content>
