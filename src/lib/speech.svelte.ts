import { app } from "./state.svelte";
import { plainSpeech } from "./speechText";

/** One voice at a time: `id` is the message being read, "" when quiet. */
export const speech = $state({ id: "" });

export function toggleSpeech(id: string, markdown: string) {
  const synth = window.speechSynthesis;
  const wasThis = speech.id === id;
  synth.cancel();
  speech.id = "";
  if (wasThis) return;
  const u = new SpeechSynthesisUtterance(plainSpeech(markdown));
  const done = () => {
    if (speech.id === id) speech.id = "";
  };
  u.onend = done;
  u.onerror = (e) => {
    done();
    // Cancelling our own utterance reports an error too.
    if (e.error !== "canceled" && e.error !== "interrupted" && app.activeConnectionId)
      app.toastAction(app.activeConnectionId, "Couldn't read aloud: no speech voice available");
  };
  speech.id = id;
  synth.speak(u);
}
