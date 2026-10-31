<script lang="ts">
  // DropdownMenu.Content (or its SubContent) that is a bottom sheet on a phone (see Sheet.svelte).
  import { DropdownMenu } from "bits-ui";
  import type { ComponentProps } from "svelte";
  import Sheet from "./Sheet.svelte";

  let {
    children,
    sub = false,
    ref = $bindable(null),
    ...rest
  }: ComponentProps<typeof DropdownMenu.Content> & { sub?: boolean } = $props();
  const Content = $derived(sub ? DropdownMenu.SubContent : DropdownMenu.Content);
</script>

<Content bind:ref {...rest}>
  {#snippet child({ props, wrapperProps })}
    <Sheet {props} {wrapperProps}>{@render children?.()}</Sheet>
  {/snippet}
</Content>
