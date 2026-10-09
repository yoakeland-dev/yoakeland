// Zero-token digests of a chat, and the starter prompts for an empty one: the "pick up where you
// left off" cards and "Move to project…" both read what the client already has cached, so none of
// it costs a model call. Pure, so chatBrief.test.js can pin it.
import type { ChatMessage } from "./types";

export interface Brief {
  /** The chat's first prompt, and the latest one when that's a different message. */
  firstAsk?: string;
  lastAsk?: string;
  /** How the latest reply started. */
  lastReply?: string;
  /** Files the agent changed, most recent last. */
  files: string[];
}

export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

export function briefOf(messages: ChatMessage[]): Brief {
  const asks = messages.filter((m) => m.role === "user" && m.text.trim());
  const reply = messages.findLast((m) => m.role === "assistant" && m.text.trim());
  const files = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const c of m.toolCalls) for (const d of c.diffs ?? (c.diff ? [c.diff] : [])) if (d?.filePath) files.add(d.filePath);
  }
  return {
    firstAsk: asks[0] ? clip(asks[0].text, 200) : undefined,
    lastAsk: asks.length > 1 ? clip(asks[asks.length - 1].text, 200) : undefined,
    lastReply: reply ? clip(reply.text, 280) : undefined,
    files: [...files].slice(-6),
  };
}

/** What the first message of the new session in a project says, for the user to read and send. */
export function continuationDraft(title: string, b: Brief, imported?: { dir: string; files: number }): string {
  const lines = [`Continuing from an earlier chat, "${title}".`];
  if (imported) lines.push(`Its ${imported.files} file${imported.files === 1 ? "" : "s"} are in \`${imported.dir}/\` in this project.`);
  const got: string[] = [];
  if (b.firstAsk) got.push(`- I started with: "${b.firstAsk}"`);
  if (b.lastAsk) got.push(`- Most recently I asked: "${b.lastAsk}"`);
  if (b.lastReply) got.push(`- Your last reply began: "${b.lastReply}"`);
  if (got.length) lines.push("", "Where we got to:", ...got);
  if (b.files.length) lines.push("", `Files that chat made: ${b.files.join(", ")}.`);
  lines.push("", "Pick up from there.");
  return lines.join("\n");
}

export interface Starter {
  icon: string;
  title: string;
  prompt: string;
}

/** For a chat with no project; the workspace is its own small computer. */
export const CHAT_STARTERS: Starter[] = [
  { icon: "chart-bar", title: "Make sense of a data file", prompt: "I'll attach a CSV. Tell me what's in it, what looks off, and the three most interesting things you can find." },
  { icon: "terminal-2", title: "Write a script and try it", prompt: "Write a small script that renames the files in a folder by their date, then test it on some sample files here before showing me." },
  { icon: "brain", title: "Learn something, then get quizzed", prompt: "Explain how TLS handshakes work as if I know networking basics, then quiz me with five questions, one at a time." },
  { icon: "world", title: "Look something up", prompt: "Compare the three most popular self-hosted note-taking apps right now, with sources, and tell me which you'd pick and why." },
];

/** For an empty chat in a project: starters that fit what's there (nothing is sent to a model to pick them). */
export function projectStarters(files: string[] | undefined, dirty: number): Starter[] {
  const has = (re: RegExp) => !!files?.some((f) => re.test(f));
  const out: Starter[] = [];
  if (dirty) out.push({ icon: "git-compare", title: "Review my uncommitted changes", prompt: "Review my uncommitted changes: what do they do, and is anything wrong or missing?" });
  out.push({ icon: "list-search", title: "Show me around", prompt: "Give me a tour of this project: how it's laid out, where the entry points are, and what I should read first." });
  if (has(/(^|\/)(AGENTS|CLAUDE)\.md$/i) || has(/(^|\/)README(\.md)?$/i)) {
    out.push({ icon: "file-text", title: "Check the docs against the code", prompt: "Read the README and any AGENTS.md, then tell me where they no longer match the code." });
  }
  if (has(/(_test\.go|\.test\.[jt]sx?|\.spec\.[jt]sx?|(^|\/)tests?\/)/)) {
    out.push({ icon: "check", title: "Run the tests and fix failures", prompt: "Run the test suite and fix anything that fails, smallest change first." });
  } else {
    out.push({ icon: "check", title: "Find what's untested", prompt: "Find the most important code here with no tests and write tests for it." });
  }
  return out.slice(0, 4);
}
