// Where a chat changed models: the first reply by a different provider/model than the last one.
// Derived from the replies' own stamps, not from the picker, so fiddling with the picker shows
// nothing until a message is sent with the new choice (that reply is stamped as it starts), and
// a reloaded chat shows the same markers (the server persists the stamps).
export interface Stamped {
  role: string;
  provider?: string;
  model?: string;
}

export interface ModelRef {
  provider: string;
  model: string;
}

/** Message index to the model that answered before it, for each reply that changed models. */
export function handoffs(messages: Stamped[]): Map<number, ModelRef> {
  const out = new Map<number, ModelRef>();
  let prev: ModelRef | undefined;
  messages.forEach((m, i) => {
    if (m.role !== "assistant" || !m.provider || !m.model) return;
    if (prev && (prev.provider !== m.provider || prev.model !== m.model)) out.set(i, prev);
    prev = { provider: m.provider, model: m.model };
  });
  return out;
}
