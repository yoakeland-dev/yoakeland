<script lang="ts">
  // The box itself is the `.ui-check` recipe in ui.css, shared with Markdown's task lists.
  let {
    checked = $bindable(false),
    disabled = false,
    label,
    id,
    onchange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    label?: string;
    id?: string;
    onchange?: (checked: boolean) => void;
  } = $props();
</script>

<input type="checkbox" class="ui-check" bind:checked {disabled} {id} aria-label={label} onchange={() => onchange?.(checked)} />
