<script lang="ts">
  // Popover.Content that is a bottom sheet on a phone (see Sheet.svelte). Same props, same slot.
  import { Popover } from "bits-ui";
  import type { ComponentProps } from "svelte";
  import Sheet from "./Sheet.svelte";

  let { children, ref = $bindable(null), ...rest }: ComponentProps<typeof Popover.Content> = $props();
</script>

<Popover.Content bind:ref {...rest}>
  {#snippet child({ props, wrapperProps })}
    <Sheet {props} {wrapperProps}>{@render children?.()}</Sheet>
  {/snippet}
</Popover.Content>
