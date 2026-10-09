<script lang="ts">
  // A multi-line field in the same well as TextField. The composer has its own surface and does not use this.
  import type { HTMLTextareaAttributes } from "svelte/elements";

  let {
    value = $bindable(""),
    invalid = false,
    disabled = false,
    class: cls = "",
    ...rest
  }: Omit<HTMLTextareaAttributes, "value" | "class"> & {
    value?: string;
    invalid?: boolean;
    class?: string;
  } = $props();
</script>

<div class="ui-field area {cls}" class:invalid class:disabled>
  <textarea {...rest} bind:value {disabled} aria-invalid={invalid || undefined}></textarea>
</div>
