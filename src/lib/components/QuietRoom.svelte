<script lang="ts">
  // Renderless: puts the room in its quiet state while the open chat is on its top effort level, if that is Max or Ultracode.
  import { app } from "../state.svelte";
  import { sessionEffort } from "./EffortPicker.svelte";
  import { setQuietRoom } from "../quietRoom";

  const on = $derived.by(() => {
    const sid = app.active?.currentSessionId;
    if (!sid) return false;
    const { levels, current } = sessionEffort(app.active, sid);
    // The top level, and only when that is Max or beyond: a scale that just ends at "high" isn't the extreme.
    return !!levels && levels.length > 1 && current === levels[levels.length - 1] && (current === "max" || current === "ultracode");
  });

  $effect(() => setQuietRoom(on));
</script>
