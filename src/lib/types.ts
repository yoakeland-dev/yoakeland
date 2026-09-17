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
}

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
}
