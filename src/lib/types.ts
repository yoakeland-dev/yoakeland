// Wire types mirroring SPEC.md §2-3. Kept intentionally loose (data as
// per-event interfaces rather than one giant discriminated union) since the
// backend is free to add fields.

export interface Envelope<T = Record<string, unknown>> {
  type: string;
  sessionId?: string;
  turnId?: string;
  toolCallId?: string;
  data?: T;
}

export interface DiffLine {
  type: " " | "+" | "-";
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  filePath: string;
  unified: string;
  hunks: DiffHunk[];
}

export interface PermissionRequestData {
  toolName: string;
  description: string;
  requiresAsk: boolean;
  cacheKey: string;
  diff: FileDiff | null;
}

export interface ToolCallRequestedData {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultData {
  toolName: string;
  output: string;
  error: string;
}

export interface TurnCompletedData {
  finishReason: "stop" | "length" | "cancelled" | "budget_exceeded" | "no_provider";
  sessionId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  context: {
    estimatedTokens: number;
    maxTokens: number;
  };
  spend: {
    sessionTotalUsd: number;
    projectTotalUsd: number;
  };
  durationMs: number;
}

export type ProviderKind = "api_key" | "cli_claude" | "cli_codex";
export type HttpProvider = "anthropic" | "openai" | "openrouter";

export interface ProviderInfo {
  name: string;
  kind: ProviderKind;
  httpProvider?: HttpProvider;
  authMethod?: "manual" | "oauth";
}

// A provider is a credential, not a model choice (SPEC.md §6b) — models are
// fetched per-provider via list_models.
// Mirrors whichever upstream's own shape close to verbatim (SPEC.md §3.2
// model_list) — OpenRouter's own context_length/pricing/reasoning fields,
// OpenAI's hand-maintained reasoningEfforts, cli_claude's reasoningEfforts/
// fastMode/contextWindows cross-walked from T3 Code's manifest (§6b), or
// absent entirely (Anthropic, cli_codex). Deliberately no common schema:
// branch on which provider you're looking at, not on which keys happen to
// be present.
export interface ModelCapabilities {
  context_length?: number;
  pricing?: { prompt?: string; completion?: string; [key: string]: unknown };
  reasoning?: { supported_efforts?: string[]; default_effort?: string; mandatory?: boolean; [key: string]: unknown };
  reasoningEfforts?: string[];
  // cli_claude only, cross-walked from T3 Code's manifest (SPEC.md §6b) —
  // informational: set_model_options ignores reasoningEffort/thinkingBudget
  // for cli_claude/cli_codex regardless of what's advertised here, and there
  // is no field yet to actually toggle fastMode for any provider.
  fastMode?: boolean;
  contextWindows?: string[];
  [key: string]: unknown;
}

export interface ModelInfo {
  id: string;
  displayName?: string;
  isFavorite?: boolean;
  isLegacy?: boolean;
  capabilities?: ModelCapabilities;
}

export interface ModelOptions {
  reasoningEffort?: string;
  thinkingBudget?: number;
  contextWindow?: number;
}

export interface SessionSummary {
  sessionId: string;
  updatedAt: string;
  messageCount: number;
  title?: string;
  archived?: boolean;
  /** Paired session for a client-side split/sidebar layout (SPEC.md §3.1
   * set_session_layout) — one-directional, set on the anchor session only. */
  linkedSessionId?: string | null;
}

export type SandboxTier = "bubblewrap" | "linux_namespaces" | "local_restricted_fallback";

export interface ProjectOpenedData {
  path: string;
  sandboxTier?: SandboxTier;
}

export interface SnapshotInfo {
  snapshotId: string;
  description: string;
  createdAt: string;
}

export interface DirectoryEntry {
  name: string;
  isDir: boolean;
}

export type DeviceType = "web" | "desktop" | "server";

export interface PeerInfo {
  peerId: string;
  name: string;
  ip: string;
  deviceType: DeviceType;
  avatar?: string;
  connectedAt: string;
}

export interface ProjectListData {
  paths: string[];
}

/** A registered per-person TCP credential (§3.1 register_token/list_tokens) —
 * never carries the raw token, same scrubbing as ProviderInfo/apiKey. */
export interface TokenInfo {
  name: string;
  email?: string;
  hasAvatar: boolean;
}

// ---- Chat-side (frontend-only) message model, built up from the wire events ----

export type ChatMode = "ask" | "auto" | "plan";

export interface ToolCallEntry {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  status: "requested" | "awaiting_permission" | "running" | "done" | "denied" | "error";
  output?: string;
  error?: string;
  diff?: FileDiff | null;
  permission?: PermissionRequestData;
  /** `message.text.length` at the moment this call was requested — lets the
   * UI render the card inline at the point it actually happened in the
   * stream instead of stacking every call above the text. Undefined for
   * calls rebuilt from session history (no position was ever recorded for
   * them), which renders them before the text, matching pre-existing
   * behavior for reloaded transcripts. */
  textOffset?: number;
  /** `message.thinking?.length` at the same moment — lets AssistantMessage
   * slice `message.thinking` back into the reasoning chunk that occurred
   * between two calls, same way `textOffset` does for answer text. A run of
   * calls still only ends on answer text (`textOffset` moving); reasoning
   * appearing mid-run doesn't end it, it becomes a `thought` step nested
   * inside that run's WorkGroup instead (see AssistantMessage.svelte). Same
   * history-rebuild caveat as `textOffset`. */
  thinkingOffset?: number;
}

/** One step in a run of activity between two spans of answer text
 * (AssistantMessage.svelte) — either a chunk of reasoning or a burst of
 * consecutive tool calls with no reasoning in between. `at` is the thought's
 * starting offset into `message.thinking`, used only as a stable render key. */
export type AssistantStep =
  | { kind: "thought"; text: string; at: number }
  | { kind: "cluster"; calls: ToolCallEntry[] };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  turnId?: string;
  text: string;
  thinking?: string;
  toolCalls: ToolCallEntry[];
  streaming: boolean;
  finish?: TurnCompletedData;
  createdAt: number;
  /** Who sent a `user` message (§3.2 session_history `author`) — persisted
   * server-side with the message, so it survives a reload that repaints the
   * transcript from history. Undefined for a message stored before the server
   * kept one, or from a client that doesn't send it — render a generic
   * label/nothing, don't treat absence as an error. */
  author?: string;
  /** That sender's picture, persisted alongside the name (§3.2
   * `authorAvatar`) — an emoji glyph or a data URL, whichever the sending
   * client uses. */
  authorAvatar?: string;
  /** Provider name / model id that generated this assistant reply —
   * initially stamped client-side at send time (state.svelte.ts's
   * addUserMessage, whatever the session is about to run with) and then
   * overwritten with the server's persisted values once turn_completed /
   * session_history confirm them (§3.2), so it stays correct across a
   * session switch instead of reverting to undefined. Undefined only for a
   * message stored before the backend persisted this field at all. */
  provider?: string;
  model?: string;
  /** How long the model round-trip that produced this assistant reply took
   * (§3.2 `generationMs`) — undefined for a message stored before the
   * backend persisted it, and for a still-streaming reply (use
   * `finish.durationMs` instead, which covers the whole turn). */
  generationMs?: number;
  /** This round-trip's own token/cost accounting (§3.2 `usage`) — not the
   * whole turn's. `inputTokens` is already the full conversation resent as
   * this round-trip's request, so it doubles as "tokens in, cumulative up
   * to this point"; `outputTokens` is just this round-trip's own reply.
   * Undefined for a message stored before the backend persisted it, and
   * for a still-streaming reply. */
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
}
