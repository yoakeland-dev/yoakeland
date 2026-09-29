// Subagents (§3.2 `parentToolCallId`): a call that starts one (yoakeland's own `subagent` tool, or
// a CLI agent's Task) collects what ran inside it on `call.subagent`, rather than in the chat's
// main timeline.
import type { ChatMessage, ToolCallEntry } from "./types";

export function isSubagentCall(call: Pick<ToolCallEntry, "name" | "native">): boolean {
  return call.name === "subagent" || (!!call.native && (call.name === "Task" || call.name === "Agent"));
}

/** The call with this id among `calls` or anything nested inside them. */
export function findCall(calls: ToolCallEntry[], id: string): ToolCallEntry | undefined {
  for (const c of calls) {
    if (c.toolCallId === id) return c;
    const inner = c.subagent && findCall(c.subagent.calls, id);
    if (inner) return inner;
  }
  return undefined;
}

/** Newest first, since a live event is almost always about the latest turn. */
export function findCallInMessages(messages: ChatMessage[] | undefined, id: string): ToolCallEntry | undefined {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    const hit = findCall(messages![i].toolCalls, id);
    if (hit) return hit;
  }
  return undefined;
}

/** Every subagent call in a chat, oldest first, for the Subagents panel. */
export function subagentCalls(messages: ChatMessage[] | undefined): ToolCallEntry[] {
  const out: ToolCallEntry[] = [];
  const walk = (calls: ToolCallEntry[]) => {
    for (const c of calls) {
      if (isSubagentCall(c)) out.push(c);
      if (c.subagent) walk(c.subagent.calls);
    }
  };
  for (const m of messages ?? []) walk(m.toolCalls);
  return out;
}

export const IN_FLIGHT = new Set<ToolCallEntry["status"]>(["requested", "awaiting_permission", "awaiting_answer", "running"]);

/** Short title for a subagent call: what the model said it's for. */
export function subagentTitle(call: ToolCallEntry): string {
  const d = call.args?.description;
  return (typeof d === "string" && d) || call.title || "Subagent";
}

/** The subagent call whose own work includes call `id`, if any. */
export function subagentOwning(messages: ChatMessage[] | undefined, id: string): ToolCallEntry | undefined {
  const walk = (calls: ToolCallEntry[]): ToolCallEntry | undefined => {
    for (const c of calls) {
      if (!c.subagent) continue;
      if (c.subagent.calls.some((k) => k.toolCallId === id)) return c;
      const deeper = walk(c.subagent.calls);
      if (deeper) return deeper;
    }
    return undefined;
  };
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    const hit = walk(messages![i].toolCalls);
    if (hit) return hit;
  }
  return undefined;
}
