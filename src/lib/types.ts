// Wire types mirroring SPEC.md §2-3. Kept as per-event interfaces, not one discriminated union, since the backend is free to add fields.

export interface Envelope<T = Record<string, unknown>> {
  type: string;
  sessionId?: string;
  turnId?: string;
  toolCallId?: string;
  /** Set on everything a subagent does: the tool call it runs inside of (§3.2). */
  parentToolCallId?: string;
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
  diff?: FileDiff | null;
  /** A CLI agent asking to leave plan mode with the plan `plan_written` just showed (§3.2): answered with approve_plan. */
  plan?: boolean;
}

/** ACP's tool kinds: what a `cli_*` agent's native tool call does (§3.2). */
export type NativeToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "other";

/** Fields a native (`cli_*` agent) tool call carries on top of name/args, so
 * it can be rendered without knowing each agent's own tool names (§3.2). */
export interface NativeToolFields {
  native?: boolean;
  title?: string;
  kind?: NativeToolKind;
  locations?: string[];
  /** A CLI agent's call made inside its own subagent (Claude Code's Task): that call's id. */
  parentToolCallId?: string;
}

export interface ToolCallRequestedData extends NativeToolFields {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultData {
  toolName: string;
  output: string;
  error: string;
  /** Native tool calls only: the file changes the agent made (§3.2). */
  diffs?: FileDiff[];
}

export interface TurnCompletedData {
  finishReason: "stop" | "length" | "cancelled" | "budget_exceeded" | "no_provider";
  sessionId: string;
  /** Server-assigned id of the prompt this turn was anchored to, no get_session_history round trip needed. Absent if the turn ended before any message existed. */
  userMessageId?: string;
  /** Server-assigned id of the last message this turn appended (usually the final reply). Absent if nothing was appended. */
  messageId?: string;
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

export type CliKind =
  | "cli_claude"
  | "cli_codex"
  | "cli_cursor"
  | "cli_kimi"
  | "cli_opencode"
  | "cli_gemini"
  | "cli_grok"
  | "cli_deepseek"
  | "cli_amp"
  | "cli_pi"
  | "cli_ohmypi";
export type ProviderKind = "api_key" | CliKind;
export type HttpProvider = "anthropic" | "openai" | "openrouter";

export interface ProviderInfo {
  name: string;
  kind: ProviderKind;
  httpProvider?: HttpProvider;
  authMethod?: "manual" | "oauth";
}

// Mirrors whichever upstream's own shape close to verbatim (SPEC.md §3.2 model_list).
// Deliberately no common schema: branch on which provider you're looking at, not on which keys are present.
export interface ModelCapabilities {
  context_length?: number;
  pricing?: { prompt?: string; completion?: string; [key: string]: unknown };
  reasoning?: { supported_efforts?: string[]; default_effort?: string; mandatory?: boolean; [key: string]: unknown };
  reasoningEfforts?: string[];
  // Informational only: no field yet actually toggles fastMode for any provider.
  fastMode?: boolean;
  contextWindows?: string[];
  permissionModes?: ModeSpec[];
  [key: string]: unknown;
}

export interface ModelInfo {
  id: string;
  displayName?: string;
  isFavorite?: boolean;
  isLegacy?: boolean;
  capabilities?: ModelCapabilities;
}

/** One model role's assignment (SPEC.md §4f). */
export interface ModelRole {
  providerName: string;
  model?: string;
  reasoningEffort?: string;
}

export interface ModelOptions {
  reasoningEffort?: string;
  fastMode?: boolean;
  thinkingBudget?: number;
  contextWindow?: number;
}

export interface SessionSummary {
  sessionId: string;
  updatedAt: string;
  messageCount: number;
  title?: string;
  archived?: boolean;
  /** Paired session for a split/sidebar layout: one-directional, set on the anchor session only. */
  linkedSessionId?: string | null;
  /** Server-persisted mode (§4c) so a sidebar badge doesn't need the session open to know it. */
  mode?: ChatMode;
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
  /** Project-relative paths it holds a pre-turn copy of (v2.17; absent on older servers). */
  files?: string[];
}

export interface DirectoryEntry {
  name: string;
  isDir: boolean;
}

/** One entry of the server's shared notification feed (SPEC.md §3.2
 * `notification`). */
export interface ServerNotification {
  id: string;
  level: "info" | "success" | "warning" | "error";
  kind: string;
  title: string;
  body?: string;
  sessionId?: string;
  projectPath?: string;
  createdAt: string;
}

/** Health snapshot riding on every server-sent ping (SPEC.md §2a). */
export interface ServerStatus {
  uptimeSec: number;
  activeTurns: number;
  peers: number;
  openProjects: number;
  load1?: number;
  cpus: number;
  memTotalBytes?: number;
  memAvailBytes?: number;
  heapBytes: number;
  version?: string;
  queuedTurns?: number; // added in v2.15
  rateLimits?: Record<string, ProviderRateLimits>;
  spend?: { todayUsd: number; monthUsd: number };
  budgets?: SpendBudget[];
}

export interface RateWindow {
  usedPct: number;
  resetsAt?: string;
  windowMins?: number;
  /** A bucket narrower than the whole plan ("Opus", a Codex limitName). */
  label?: string;
}

export interface ProviderRateLimits {
  /** "cli_claude" | "cli_codex": which agent these numbers belong to. */
  kind?: string;
  /** Subscription tier as the CLI reports it. */
  plan?: string;
  /** RFC 3339. */
  updatedAt?: string;
  fiveHour?: RateWindow;
  sevenDay?: RateWindow;
  other?: RateWindow[];
}

export interface SpendBudget {
  scope: "session" | "server" | "project";
  period: "total" | "day" | "month";
  limitUsd: number;
  usedUsd?: number;
  projectPath?: string;
}

/** One project's git state (§3.2 git_status). */
export interface GitStatus {
  projectPath: string;
  branch: string | null;
  detached: boolean;
  dirtyFiles: number;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  /** First 50 changed paths (newer servers); `dirtyFiles` is the full count. */
  files?: { path: string; status: string }[];
}

/** One unanswered ask from a `pending_asks` snapshot (§3.2): the original
 * event's data flattened in, plus the ids needed to answer it. */
export type PendingAsk = {
  sessionId: string;
  projectPath?: string;
  turnId: string;
  toolCallId: string;
  createdAt?: string;
} & (
  | ({ kind: "permission" } & PermissionRequestData)
  | ({ kind: "question" } & AskUserQuestionData)
);

export type DeviceType = "web" | "desktop" | "server";

export interface PeerInfo {
  peerId: string;
  name: string;
  ip: string;
  deviceType: DeviceType;
  avatar?: string;
  connectedAt: string;
  /** Stable per-install id (newer clients); groups a device's rows. */
  deviceId?: string;
  /** The chat this connection last opened. */
  sessionId?: string;
  projectPath?: string;
}

export interface ProjectListData {
  paths: string[];
}

/** A registered per-person TCP credential (§3.1 register_token/list_tokens):
 * never carries the raw token, same scrubbing as ProviderInfo/apiKey. */
export interface TokenInfo {
  name: string;
  email?: string;
  hasAvatar: boolean;
}

// ---- Built-in terminal (SPEC.md §3.1/§3.2 terminal_*) ----

export type TerminalStatus = "starting" | "running" | "exited" | "error";

/** One row of terminal_list / terminal_index (§3.2). */
export interface TerminalSummary {
  terminalId: string;
  cwd?: string;
  status: TerminalStatus;
  label: string;
  exitCode?: number;
  /** What the agent named a terminal it started (terminal_start). */
  name?: string;
  /** Started by the agent rather than a person. */
  agent?: boolean;
  /** terminal_index only. */
  sessionId?: string;
  projectPath?: string;
}

/** Client-side bookkeeping only; the pty bytes never live here (see terminalBus.ts). */
export interface TerminalTab {
  terminalId: string;
  sessionId: string;
  cwd?: string;
  cols: number;
  rows: number;
  status: TerminalStatus;
  /** Shell binary name: the tab's fallback until `title` is set. */
  label: string;
  /** The shell's own OSC 0/2 "set title" sequence (scanShellEvents). */
  title?: string;
  /** User rename, or the agent's name for a tab it started; wins over `title` and `label`. */
  name?: string;
  /** Started by the agent (terminal_start). */
  agent?: boolean;
  /** A command is running (shell integration C seen, D not yet). */
  busy?: boolean;
  /** The running (or last) command line; zsh only, bash doesn't report it. */
  command?: string;
  /** Exit code of the last finished command, cleared when the next one starts. */
  lastExit?: number;
  exitCode?: number;
  pid?: number;
  sandboxTier?: SandboxTier;
  /** Last terminal_output sequence number applied (§3.2 gap-detection). */
  sequence: number;
}

// ---- Chat-side (frontend-only) message model, built up from the wire events ----

export type ChatMode = "read_only" | "read_write" | "accept_edits" | "auto" | "autonomous" | "plan";

/** What one mode does on a model's provider (SPEC.md §4c `permissionModes`). */
export interface ModeSpec {
  mode: ChatMode;
  /** "auto": the agent's own reviewer decides, asking only when it isn't sure. */
  policy: Record<"read" | "edit" | "run" | "network", "allow" | "ask" | "deny" | "auto">;
  /** "agent": its own mode or sandbox backs the policy; "yoakeland": only the permission bridge does. */
  enforcedBy: "agent" | "yoakeland";
  native?: string;
  sandbox?: boolean;
  /** On the plan entry: how the planning is done. */
  plan?: "native" | "emulated" | "yoakeland";
}

/** The model called `ask_user_question` (SPEC.md §3.1/§3.2): free-form when
 * `options` is absent, a picker otherwise. Available in every mode. */
export interface AskUserQuestionData {
  question: string;
  options?: string[];
}

export interface ToolCallEntry extends NativeToolFields {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  status: "requested" | "awaiting_permission" | "awaiting_answer" | "running" | "done" | "denied" | "error";
  output?: string;
  error?: string;
  diff?: FileDiff | null;
  /** Native tool calls: the file changes the agent's tool made (§3.2 tool_result). */
  diffs?: FileDiff[];
  permission?: PermissionRequestData;
  question?: AskUserQuestionData;
  /** `message.text.length` when this call was requested, so the UI can render the card inline
   * at that point in the stream instead of stacking every call above the text. */
  textOffset?: number;
  /** `message.thinking?.length` at the same moment, so AssistantMessage can slice `thinking` back
   * into the reasoning chunk between two calls (mirrors `textOffset` for answer text). */
  thinkingOffset?: number;
  /** What ran inside this call if it started a subagent (`subagent`, or a CLI agent's Task). */
  subagent?: SubagentRun;
}

/** A subagent's own work, built from events tagged with its call's id (§3.2 `parentToolCallId`). */
export interface SubagentRun {
  calls: ToolCallEntry[];
  text: string;
  thinking?: string;
  /** Its own turn_completed arrived (fallback subagents only; a CLI's Task ends with its result). */
  finish?: TurnCompletedData;
}

/** One step between two spans of answer text: a reasoning chunk or a burst of tool calls.
 * `at` is the thought's starting offset into `message.thinking`, used only as a stable render key. */
export type AssistantStep =
  | { kind: "thought"; text: string; at: number }
  | { kind: "cluster"; calls: ToolCallEntry[] };

export interface ChatMessage {
  id: string;
  /** Other edits/retries at this point in the conversation (§3.2 `alternateIds`), addressable via `switchBranch`. */
  alternateIds?: string[];
  role: "user" | "assistant";
  turnId?: string;
  text: string;
  thinking?: string;
  toolCalls: ToolCallEntry[];
  streaming: boolean;
  finish?: TurnCompletedData;
  createdAt: number;
  /** Who sent a `user` message (§3.2 `author`). Undefined is not an error: older messages and some clients don't send it. */
  author?: string;
  /** That sender's picture (§3.2 `authorAvatar`): an emoji glyph or a data URL. */
  authorAvatar?: string;
  /** Server-side paths a `user` message attached (§3.1 user_prompt). */
  attachments?: string[];
  /** Stamped client-side at send time, then overwritten with the server's persisted value
   * once turn_completed/session_history confirm it (§3.2), so it survives a session switch. */
  provider?: string;
  model?: string;
  /** The model round-trip's own duration (§3.2 `generationMs`); for the whole turn use `finish.durationMs`. */
  generationMs?: number;
  /** This round-trip's own token/cost accounting (§3.2 `usage`), not the whole turn's.
   * `inputTokens` is the full resent conversation, so it's cumulative; `outputTokens` is just this reply. */
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
  /** Context compactions during this turn (§4g): "clear" stubbed old tool results, "summary" summarized everything before. */
  compactions?: Compaction[];
}

export interface Compaction {
  kind: "clear" | "summary";
  tokensBefore: number;
  tokensAfter: number;
}

/** A prompt sent while its chat was mid-turn: waits server-side until that turn ends (§3.1). */
export interface QueuedPrompt {
  turnId: string;
  text: string;
  attachments?: string[];
  /** An undo was sent; the server hasn't confirmed it yet. */
  withdrawing?: boolean;
  /** Follow-ups sent after it: it's being withdrawn to go out again as one prompt with these. */
  append?: { text: string; attachments?: string[] };
}

// ---- Project files (§3.1 "Project files", v2.17) ----

export interface TreeEntry {
  name: string;
  isDir: boolean;
  isSymlink?: boolean;
  size?: number;
}

export interface FileContent {
  path: string;
  content: string;
  /** Hand back to write_file as `baseVersion`; a mismatch there means someone else saved first. */
  version?: string;
  size: number;
  binary?: boolean;
  tooLarge?: boolean;
  error?: string;
}

/** One `git status` entry with both halves: "." unchanged, "?" untracked. */
export interface GitChange {
  path: string;
  origPath?: string;
  index: string;
  worktree: string;
  conflict?: boolean;
}

export type SidebarPanel = "browser" | "snapshots" | "diffs" | "subagents" | "explorer" | "git";
