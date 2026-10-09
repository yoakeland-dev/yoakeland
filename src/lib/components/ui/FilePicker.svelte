<script lang="ts">
  // Choose a file, or drop one. The default is a drop zone in the field well; `compact` is a plain
  // button with the file name beside it. The file is handed to `onfile`; the component keeps only its name.
  import Icon from "../Icon.svelte";
  import Button from "./Button.svelte";

  let {
    accept,
    title = "Choose a file",
    hint = "or drop it here",
    compact = false,
    disabled = false,
    onfile,
  }: {
    accept?: string;
    title?: string;
    hint?: string;
    compact?: boolean;
    disabled?: boolean;
    onfile: (file: File) => void;
  } = $props();

  let input = $state<HTMLInputElement>();
  let over = $state(false);
  let name = $state("");

  function take(file: File | undefined) {
    if (!file) return;
    name = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`;
    onfile(file);
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    over = false;
    if (!disabled) take(e.dataTransfer?.files[0]);
  }
</script>

{#if compact}
  <span class="compact">
    <Button {disabled} onclick={() => input?.click()}>{title}</Button>
    <span class="name">{name || "No file chosen"}</span>
  </span>
{:else}
  <button
    type="button"
    class="ui-field drop"
    class:over
    class:disabled
    {disabled}
    onclick={() => input?.click()}
    ondragenter={(e) => (e.preventDefault(), (over = true))}
    ondragover={(e) => (e.preventDefault(), (over = true))}
    ondragleave={() => (over = false)}
    ondrop={drop}
  >
    <span class="ico"><Icon name="file-plus" size={16} /></span>
    <span class="text"><span>{name ? "File attached" : title}</span><small>{name || hint}</small></span>
  </button>
{/if}
<input bind:this={input} type="file" {accept} hidden onchange={(e) => (take(e.currentTarget.files?.[0]), (e.currentTarget.value = ""))} />

<style>
  .compact {
    display: inline-flex;
    align-items: center;
    gap: 0.71rem;
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .drop {
    height: auto;
    padding: 0.86rem 1rem;
    gap: 0.86rem;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .drop.over {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .ico {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.29rem;
    height: 2.29rem;
    border-radius: var(--radius-xs);
    background: var(--sidebar-hover);
    color: var(--text-dim);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .text small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
</style>
