import type { CliKind, ModelInfo, ProviderInfo } from "./types";

/** Every `cli_*` agent the server can drive (§6b): the one table Settings'
 * toggles, the picker's tabs and message footers all read from. */
export const CLI_AGENTS: Record<CliKind, { title: string; icon: string; cli: string; defaultName: string }> = {
  cli_claude: { title: "Claude", icon: "claude", cli: "claude", defaultName: "claude-subscription" },
  cli_codex: { title: "Codex", icon: "codex", cli: "codex", defaultName: "codex-subscription" },
  cli_cursor: { title: "Cursor", icon: "cursor", cli: "cursor-agent", defaultName: "cursor-agent" },
  cli_kimi: { title: "Kimi", icon: "kimi", cli: "kimi", defaultName: "kimi-cli" },
  cli_opencode: { title: "OpenCode", icon: "opencode", cli: "opencode", defaultName: "opencode" },
  cli_grok: { title: "Grok", icon: "grok", cli: "grok", defaultName: "grok-cli" },
  cli_deepseek: { title: "DeepSeek", icon: "deepseek", cli: "dsh", defaultName: "deepseek-cli" },
  cli_amp: { title: "Amp", icon: "amp", cli: "amp", defaultName: "amp-cli" },
  cli_pi: { title: "Pi", icon: "pi", cli: "pi", defaultName: "pi-cli" },
  cli_ohmypi: { title: "Oh My Pi", icon: "pi", cli: "omp", defaultName: "oh-my-pi" },
};

// A provider is a credential, not a model choice (SPEC.md §6b); the picker's actual unit of
// selection is the model, sourced per-provider from list_models.
export interface Entry {
  provider: ProviderInfo;
  model: ModelInfo;
}

// Left-rail tabs for *direct* (non-aggregator) api_key providers only; cli_* agents and
// OpenRouter get their own tabs so an OpenRouter key doesn't bucket hundreds of models under one wrong icon.
export type Vendor = "anthropic" | "openai" | "deepseek" | "gemini" | "ollama";

// "claude" rather than "anthropic" for the vendor mark: Anthropic's logo is mono-only, Claude's isn't.
export const VENDOR_META: Record<Vendor, { label: string; icon: string }> = {
  anthropic: { label: "Anthropic", icon: "claude" },
  openai: { label: "OpenAI", icon: "openai" },
  deepseek: { label: "DeepSeek", icon: "deepseek" },
  gemini: { label: "Gemini", icon: "gemini" },
  ollama: { label: "Ollama", icon: "ollama" },
};
export const VENDOR_ORDER: Vendor[] = [
  "anthropic",
  "openai",
  "deepseek",
  "gemini",
  "ollama",
];

// Sniffed from provider name/model text: the wire protocol's httpProvider is only
// anthropic/openai/openrouter (§3.2), with no concept of e.g. a DeepSeek/Ollama endpoint.
const VENDOR_SNIFFERS: [Vendor, RegExp][] = [
  ["deepseek", /deepseek/],
  ["gemini", /gemini|google/],
  ["ollama", /ollama/],
  ["anthropic", /claude|anthropic/],
];

export function directVendorOf(p: ProviderInfo, model?: string): Vendor {
  const hay = `${p.name} ${model ?? ""}`.toLowerCase();
  for (const [id, re] of VENDOR_SNIFFERS) if (re.test(hay)) return id;
  return p.httpProvider === "anthropic" ? "anthropic" : "openai";
}

export function isOpenRouter(p: ProviderInfo): boolean {
  return p.kind === "api_key" && p.httpProvider === "openrouter";
}
/** Kinds whose accounts differ by login folder; every other agent has one login per machine. */
export const MULTI_ACCOUNT: ReadonlySet<string> = new Set(["cli_claude", "cli_codex"]);

export interface AgentGroup {
  /** Stable key: the kind, or `cli_acp:<command and args>` so each custom command is its own agent. */
  key: string;
  kind: ProviderInfo["kind"];
  title: string;
  icon: string;
  accounts: ProviderInfo[];
}

/** Coding-agent providers grouped by agent, accounts sorted by label. */
export function agentGroups(providers: ProviderInfo[]): AgentGroup[] {
  const groups = new Map<string, AgentGroup>();
  for (const p of providers.filter(isCli)) {
    const key = p.kind === "cli_acp" ? `cli_acp:${[p.command ?? p.name, ...(p.args ?? [])].join(" ")}` : p.kind;
    let g = groups.get(key);
    if (!g) {
      const meta = cliMeta(p);
      g = { key, kind: p.kind, title: p.kind === "cli_acp" ? providerLabel(p) : meta.title, icon: meta.icon, accounts: [] };
      groups.set(key, g);
    }
    g.accounts.push(p);
  }
  for (const g of groups.values()) g.accounts.sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)));
  return [...groups.values()];
}

export function isCli(p: ProviderInfo): p is ProviderInfo & { kind: CliKind | "cli_acp" } {
  return p.kind.startsWith("cli_");
}

/** Icon/title for a CLI provider, tolerating a kind newer than this client. */
export function cliMeta(p: ProviderInfo): { title: string; icon: string } {
  return CLI_AGENTS[p.kind as CliKind] ?? { title: p.name, icon: "tool" };
}

// OpenRouter model IDs are `<vendor-slug>/<model>`, and that slug is usually also a valid
// LobeHub icon slug, so try it directly rather than hand-listing 150+ vendors; only remap
// the handful of mismatches below, and let LobeIcon's `fallback` prop catch genuine misses.
const VENDOR_ICON_ALIASES: Record<string, string> = {
  google: "gemini",
  "google-ai-studio": "gemini",
  "meta-llama": "meta",
  mistralai: "mistral",
  "x-ai": "xai",
  "z-ai": "zai",
  "stepfun-ai": "stepfun",
  "inference-net": "inference",
  moonshotai: "moonshot",
  "01-ai": "yi",
  amazon: "aws",
  "arcee-ai": "arcee",
};

// Everything else falls back to title-casing the raw slug (e.g. "Nousresearch").
const VENDOR_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google",
  deepseek: "DeepSeek",
  meta: "Meta",
  mistral: "Mistral",
  qwen: "Qwen",
  xai: "xAI",
  cohere: "Cohere",
  perplexity: "Perplexity",
  ai21: "AI21",
  zai: "Z.AI",
  stepfun: "StepFun",
  inference: "Inference",
  moonshot: "Moonshot AI",
  yi: "01.AI",
  aws: "Amazon",
  arcee: "Arcee AI",
  nvidia: "NVIDIA",
  microsoft: "Microsoft",
  baidu: "Baidu",
  liquid: "Liquid AI",
  inflection: "Inflection",
  nousresearch: "Nous Research",
  minimax: "MiniMax",
  openrouter: "OpenRouter",
};

export function prettifySlug(slug: string): string {
  // A version keeps its dot: "claude-sonnet-5-5" is Sonnet 5.5, not "Sonnet 5 5".
  return slug.replace(/(\d)[-_](?=\d)/g, "$1.").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function openRouterVendorMeta(modelId: string): {
  label: string;
  icon: string;
} {
  const prefix = modelId.split("/")[0]?.toLowerCase();
  if (!prefix) return { label: "OpenRouter", icon: "openrouter" };
  // Google publishes both Gemini and Gemma under "google/"; they have distinct LobeHub marks.
  if (prefix === "google" && /gemma/.test(modelId.toLowerCase())) {
    return { label: "Gemma", icon: "gemma" };
  }
  const icon = VENDOR_ICON_ALIASES[prefix] ?? prefix;
  return { label: VENDOR_LABELS[icon] ?? prettifySlug(prefix), icon };
}

/** OpenRouter names read "Vendor: Model Name"; the vendor prefix moves to the bottom line
 * (vendorMetaFor). CLI providers with no real displayName ("sonnet", or codex's id-as-name)
 * get title-cased as a floor until the server sends a proper one. ACP agents (opencode)
 * report ids as `<vendor>/<model>`; the vendor is already the bottom line, so the prefix
 * is stripped rather than reading "OpenCode/Grok Code". */
export function titleFor(entry: Entry): string {
  if (isOpenRouter(entry.provider)) {
    const name = entry.model.displayName || entry.model.id;
    const idx = name.indexOf(":");
    if (idx > 0 && idx < 30) return name.slice(idx + 1).trim();
    return name;
  }
  if (isCli(entry.provider)) {
    // A displayName distinct from the id is a real name; keep it (minus a stray
    // `<vendor>/` prefix, in case the agent names carry one). Otherwise the id is
    // the raw slug: drop the vendor segment, then title-case it.
    const raw = entry.model.displayName || entry.model.id;
    const noVendor = raw.replace(/^[^/]+\//, "");
    if (entry.model.displayName && entry.model.displayName !== entry.model.id)
      return noVendor;
    return prettifySlug(noVendor);
  }
  return entry.model.displayName || entry.model.id;
}

/** What to show for a provider: its label; the built-in claude-/codex-subscription names read as just "subscription". */
export function providerLabel(p: ProviderInfo): string {
  if (p.label) return p.label;
  return p.name.endsWith("-subscription") ? "subscription" : p.name;
}

export function vendorMetaFor(entry: Entry): { label: string; icon: string } {
  if (entry.provider.kind === "cli_codex") return { label: "ChatGPT", icon: "codex" };
  if (isCli(entry.provider)) {
    const m = cliMeta(entry.provider);
    return { label: m.title, icon: m.icon };
  }
  if (isOpenRouter(entry.provider))
    return openRouterVendorMeta(entry.model.id);
  return VENDOR_META[directVendorOf(entry.provider, entry.model.id)];
}
