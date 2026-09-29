<script lang="ts">
  // Renderless: puts the room in its quiet state while the open chat is on its top effort level.
  import { app } from "../state.svelte";
  import { sessionEffort } from "./EffortPicker.svelte";
  import { setQuietRoom } from "../quietRoom";

  const on = $derived.by(() => {
    const sid = app.active?.currentSessionId;
    if (!sid) return false;
    const { levels, current } = sessionEffort(app.active, sid);
    return !!levels && levels.length > 1 && current === levels[levels.length - 1];
  });

  $effect(() => setQuietRoom(on));
</script>
