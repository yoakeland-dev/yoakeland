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
  /** Rules the user may pick instead of a bare "always allow" (§3.2); answered with `ruleId`. */
  suggestions?: PermissionSuggestion[];
}

/** One "stop asking about this" option on a permission_request. `native`: a CLI agent's own rule. */
export interface PermissionSuggestion {
  id: string;
  label: string;
  tool?: string;
  pattern?: string[];
  scope?: PermissionScope;
  native?: boolean;
}

export type PermissionScope = "session" | "project" | "global";
export type PermissionDecision = "allow" | "ask" | "deny";

/** A permission rule as the server lists it (§3.1 "Permission rules"). */
export interface PermissionRule {
  id: string;
  tool: string;
  pattern: string[];
  /** The pattern as a person types it (bash: shell-quoted argv). */
  text: string;
  decision: PermissionDecision;
  scope: PermissionScope | "builtin";
  modes?: string[];
  source?: string;
  createdAt?: string;
  match?: string[];
  notMatch?: string[];
  readonly?: boolean;
}

/** `permission_rules` (§3.2): a project's rules in force, plus load problems. */
export interface PermissionRulesData {
  projectPath: string;
  rules: PermissionRule[];
  errors?: string[];
  notes?: string[];
  /** Why the request that produced this reply was refused. */
  error?: string;
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
  finishReason: "stop" | "length" | "cancelled" | "budget_exceeded" | "no_provider" | "limit_reached";
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
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
    /** No rate exists for the model: costUsd is 0 (or only the priced part), not free. */
    costUnknown?: boolean;
  };
  context: ContextData;
  spend: SpendData;
  durationMs: number;
}

/** How full the context is (§3.2 `turn_completed.context`, also on `session_history`). */
export interface ContextData {
  /** Tokens held now: the provider's count of its last request, or our estimate (see `source`). */
  estimatedTokens: number;
  /** The meter's denominator: the model's window when known, else the compaction budget. */
  maxTokens: number;
  /** The model's real window; absent when nothing knows it. */
  windowTokens?: number;
  /** The size at which yoakeland compacts the chat (API providers only in practice). */
  budgetTokens?: number;
  /** Automatic compaction is turned off for this chat (`budgetTokens` is then absent). */
  autoCompactOff?: boolean;
  /** "provider": counted by the provider; "estimated": a character heuristic; "unknown": nothing to measure yet. */
  source?: "provider" | "estimated" | "unknown";
}

export interface SpendData {
  sessionTotalUsd: number;
  projectTotalUsd: number;
  /** Some usage counted had no rate, so the true total is higher. */
  sessionCostUnknown?: boolean;
  projectCostUnknown?: boolean;
}

/** One slice of the context (§3.2 `context_breakdown`). `exact`: counted by the provider, not apportioned. */
export interface ContextCategory {
  key: string;
  label: string;
  tokens: number;
  exact: boolean;
}

/** §3.2 `context_breakdown`, the answer to `get_context_breakdown`. */
export interface ContextBreakdown {
  sessionId: string;
  model?: string;
  totalTokens: number;
  windowTokens?: number;
  /** Where the chat compacts itself; absent when the agent does that on its own terms. */
  autoCompactAt?: number;
  source: "provider" | "estimated" | "unknown";
  /** Used slices first, then `free` and `buffer`. */
  categories: ContextCategory[];
  cache?: { read: number; write: number; input: number };
  spend?: SpendData;
  error?: string;
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
  /** This chat's own compaction size, over the server's setting; absent = follow it. */
  autoCompactTokens?: number;
  /** false = this chat doesn't compact itself. */
  autoCompact?: boolean;
}

export interface SessionSummary {
  sessionId: string;
  updatedAt: string;
  messageCount: number;
  title?: string;
  archived?: boolean;
  /** The root the session runs in (§4b); the only way to learn a chat's scratch directory. */
  projectPath?: string;
  /** A chat's scratch directory size, from the "@chat" listing (a lower bound for a huge tree). */
  workspaceBytes?: number;
  /** Paired session for a split/sidebar layout: one-directional, set on the anchor session only. */
  linkedSessionId?: string | null;
  /** Server-persisted mode (§4c) so a sidebar badge doesn't need the session open to know it. */
  mode?: ChatMode;
}

export type SandboxTier = "bubblewrap" | "linux_namespaces" | "macos_seatbelt" | "local_restricted_fallback";


/** Server-wide tunables (`runtime_settings`, changed with `set_runtime_settings`, a partial update).
 * 0 means the default, or unlimited where noted; the server echoes what it actually stored. */
export interface RuntimeSettings {
  /** Pause a turn to ask "continue?" after this many model calls (0 = unlimited). */
  maxRoundsPerTurn: number;
  /** Pause a turn once its chat has spent this much, in USD (0 = unlimited). */
  maxSessionCostUsd: number;
  /** Withhold bash and the terminal tools from the model in projects with no sandbox. */
  disableBashWhenUnsandboxed: boolean;
  execTimeoutSec: number;
  execOutputMaxBytes: number;
  terminalMemoryMaxMB: number;
  terminalPidsMax: number;
  terminalReadMaxChars: number;
  terminalHistoryKB: number;
  poolIdleMinutes: number;
  poolMaxLive: number;
  pricingRefreshHours: number;
  browserBlockCrossOrigin: boolean;
  /** Context size at which chats compact themselves (0 = the built-in 64,000). */
  autoCompactTokens: number;
  /** Added to every summary compaction's prompt; it narrows what the summary stresses, it can't replace the base prompt. */
  compactInstructions: string;
}

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
  /** How loudly to raise it: urgent needs you, normal is worth knowing, quiet is bell-only. */
  priority?: "urgent" | "normal" | "quiet";
  kind: string;
  title: string;
  body?: string;
  /** How many times it happened while unread (a repeat within a minute folds in). */
  count?: number;
  sessionId?: string;
  projectPath?: string;
  toolCallId?: string;
  /** Server-side, so it follows you across devices. */
  read?: boolean;
  /** A device was in use when it was raised: don't add an OS alert on top. */
  attended?: boolean;
  createdAt: string;
}

/** One line of the server's audit log (SPEC.md §3.1 `list_audit`). */
export interface AuditEvent {
  seq: number;
  at: string;
  kind: string;
  /** The device that did it, by name; "server" for something it did on its own. */
  actor?: string;
  ip?: string;
  network?: string;
  project?: string;
  session?: string;
  tool?: string;
  target?: string;
  outcome?: string;
  detail?: Record<string, unknown>;
}

export interface AuditQuery {
  before?: number;
  limit?: number;
  kinds?: string[];
  sessionId?: string;
  projectPath?: string;
  since?: string;
}

/** SPEC.md §3.1 `set_notify_prefs`: the server-wide notification policy. */
export interface NotifyPrefs {
  urgent: boolean;
  normal: boolean;
  quiet: boolean;
  minTurnSec: number;
  muted: string[];
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
  /** The token it signed in with (not chosen by the device); absent on the local socket. */
  credential?: string;
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
  /** 1-based place among the questions raised together, so "2 of 3" holds as they're answered. */
  index?: number;
  total?: number;
}

export interface ToolCallEntry extends NativeToolFields {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  status: "requested" | "awaiting_permission" | "awaiting_answer" | "running" | "done" | "denied" | "error";
  /** Set between snapshot_capturing and snapshot_created: the file copy before this call's edit is still running. */
  snapshotting?: boolean;
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
  role: "user" | "assistant" | "compaction";
  turnId?: string;
  /** For a `compaction` row, the summary the model now sees (empty for a "clear"). */
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
  /** On a `compaction` row (§4g): where the context was compacted. */
  compaction?: Compaction;
}

export interface Compaction {
  /** "clear" stubbed old tool results, "summary" summarized everything before. */
  kind: "clear" | "summary";
  tokensBefore: number;
  tokensAfter: number;
  /** Asked for with /compact rather than the chat compacting itself. */
  manual?: boolean;
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

// ---- MCP servers and skills (SPEC.md §3.1 "MCP servers" and "Skills") ----

export type McpScope = "user" | "project";
export type McpState = "idle" | "disabled" | "pending" | "connecting" | "ready" | "needs_auth" | "failed";

/** One server as a person writes it (the shape Claude Code's .mcp.json uses). Env and header values the
 * server holds secret arrive as `redacted` from `mcp_servers`; send that back to keep the stored value. */
export interface McpServerConfig {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
  /** Also hand the server to the coding-agent CLIs (Claude Code, ACP agents). */
  agents?: boolean;
  disabledTools?: string[];
  timeoutMs?: number;
  oauth?: { clientId: string; clientSecret?: string; scope?: string };
}

export interface McpToolInfo {
  /** What the model sees (mcp__server__tool). */
  name: string;
  /** The server's own name for it. */
  rawName: string;
  title?: string;
  description?: string;
  readOnly?: boolean;
  destructive?: boolean;
  enabled: boolean;
}

export interface McpServerStatus {
  name: string;
  scope: McpScope;
  config: McpServerConfig;
  state: McpState;
  error?: string;
  stderr?: string;
  /** Project servers only: what the user decided about this exact config. */
  approval?: "approved" | "pending" | "changed" | "denied";
  info?: { name?: string; title?: string; version?: string; instructions?: string; protocol?: string; tools?: boolean; resources?: boolean; prompts?: boolean };
  tools?: McpToolInfo[];
  truncated?: number;
  signedIn?: boolean;
  remote?: boolean;
  resources?: boolean;
}

/** One server another tool already has (`mcp_import_candidates`, §3.2). `config` has every secret as `redacted`:
 * the daemon copies the real values itself, file to file, when asked to import by `id`. */
export interface McpImportCandidate {
  id: string;
  source: string;
  file: string;
  name: string;
  suggestedName: string;
  config: McpServerConfig;
  alreadyAdded?: boolean;
  nameTaken?: boolean;
  /** Why it can't be imported, when it can't. */
  unsupported?: string;
}

export interface McpImportData {
  projectPath?: string;
  candidates: McpImportCandidate[];
  problems?: string[];
  error?: string;
}

/** `mcp_servers` (§3.2): a project's MCP servers and where each stands. */
export interface McpServersData {
  projectPath: string;
  servers: McpServerStatus[];
  problems?: string[];
  /** Why the request that produced this reply was refused. */
  error?: string;
  redacted: string;
}

export type SkillScope = "user" | "project";

export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
  file: string;
  scope: SkillScope;
  /** Which folder family it was found in: yoake, agents, claude, codex, … */
  source: string;
  /** The agents that load it themselves ("native" is yoakeland's own loop). */
  agents: string[];
  alsoIn?: string[];
  shadowed?: boolean;
  enabled: boolean;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable: boolean;
  files: number;
  bytes: number;
  modified?: number;
  warnings?: string[];
}

export interface SkillsData {
  projectPath: string;
  skills: SkillInfo[];
  roots: { path: string; source: string; scope: SkillScope; exists: boolean }[];
  problems?: string[];
  error?: string;
}

export interface SkillDetailData {
  projectPath: string;
  dir: string;
  name?: string;
  body?: string;
  files?: string[];
  truncated?: boolean;
  error?: string;
}
