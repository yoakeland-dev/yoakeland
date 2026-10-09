<script lang="ts">
  // A single-line field: a sunk well (`.ui-field`, ui.css) around a bare input. Extra attributes
  // and handlers go to the input. A password field carries its own show/hide button.
  import type { Snippet } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";
  import Icon from "../Icon.svelte";

  let {
    value = $bindable(""),
    el = $bindable(null),
    type = "text",
    invalid = false,
    disabled = false,
    reveal = true,
    prefix,
    suffix,
    class: cls = "",
    ...rest
  }: Omit<HTMLInputAttributes, "value" | "type" | "prefix" | "class"> & {
    value?: string | number;
    /** The input element, for focusing it. */
    el?: HTMLInputElement | null;
    type?: "text" | "password" | "email" | "search" | "url" | "number";
    invalid?: boolean;
    /** Password fields only: the show/hide button. */
    reveal?: boolean;
    /** Leading and trailing content inside the box (an icon, a unit). */
    prefix?: Snippet;
    suffix?: Snippet;
    class?: string;
  } = $props();

  let shown = $state(false);
</script>

<div class="ui-field {cls}" class:invalid class:disabled>
  {#if prefix}<span class="affix">{@render prefix()}</span>{/if}
  <input {...rest} bind:this={el} type={type === "password" && shown ? "text" : type} bind:value {disabled} aria-invalid={invalid || undefined} />
  {#if suffix}<span class="affix">{@render suffix()}</span>{/if}
  {#if type === "password" && reveal}
    <button type="button" class="ui-mini reveal" aria-label={shown ? "Hide" : "Show"} aria-pressed={shown} onclick={() => (shown = !shown)}>
      <Icon name={shown ? "eye-off" : "eye"} size={14} />
    </button>
  {/if}
</div>

<style>
  .reveal {
    margin-right: -0.29rem;
  }
</style>
