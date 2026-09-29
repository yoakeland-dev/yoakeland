<script lang="ts">
  // Dev only: the mock app, to look at the effort slider and the quiet room (src/lib/quietRoom.ts).
  // The effect itself is the real one; this only flips the chat's effort and what the model reports.
  import MockApp from "../app/+page.svelte";
  import { app } from "$lib/state.svelte";

  let knownDefault = $state(true);

  const effort = $derived(app.servers.local?.modelOptionsBySession["s1"]?.reasoningEffort);
  const on = $derived(effort === "max");

  function toggle() {
    const s = app.servers.local;
    s.modelOptionsBySession = { ...s.modelOptionsBySession, s1: { ...s.modelOptionsBySession.s1, reasoningEffort: on ? "high" : "max" } };
  }

  // The mock models don't say their default effort, so the demo can add one.
  $effect(() => {
    const m = app.servers.local?.modelsByProvider["claude-subscription"]?.find((m) => m.id === "claude-opus-5-5");
    if (m) m.capabilities = knownDefault ? { reasoning: { supported_efforts: ["low", "medium", "high", "xhigh", "max"], default_effort: "high" } } : undefined;
  });
</script>

<MockApp />

<div class="knobs">
  <button class="toggle" onclick={toggle}>{on ? "max: on" : "max: off"} <span>({effort ?? "default"})</span></button>
  <label><input type="checkbox" bind:checked={knownDefault} /> model reports a default (high)</label>
</div>

<style>
  .knobs {
    position: fixed;
    top: 48px;
    right: 16px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    font: 12px/1.3 system-ui, sans-serif;
    color: #ddd;
    background: rgb(20 20 24 / 0.92);
    border: 1px solid #333;
    border-radius: 10px;
  }
  .toggle {
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 4px 6px;
    border: 1px solid #444;
    border-radius: 6px;
    cursor: pointer;
  }
  .toggle span {
    color: #888;
  }
</style>
