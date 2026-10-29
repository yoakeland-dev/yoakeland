// Pure Discord Rich Presence settings/template code. Kept free of app state so the Electron
// main process, the settings page and the presence sync can all share one definition.

/** The yoakeland Discord application; users can override it per device with their own application. */
export const DEFAULT_DISCORD_CLIENT_ID = "1564111675915903046";

export type DiscordActivityType = "playing" | "listening" | "watching" | "competing";

/** Which field Discord shows in the member-list status text. */
export type DiscordStatusDisplayType = "name" | "state" | "details";

/** Chat presence always, editor presence whenever the editor is focused (auto), or always. */
export type DiscordPresenceMode = "auto" | "chat" | "editor";

/** Reset the editor timer per open file, or once per workspace. */
export type DiscordEditorTimerScope = "file" | "workspace";

export interface DiscordRpcSettings {
  /** Off by default: nothing connects until the user asks for it. */
  enabled: boolean;
  /** Overrides the built-in application id when set. */
  clientId: string;
  /** Whether the card follows chat, the editor, or whichever is focused. */
  mode: DiscordPresenceMode;
  activityType: DiscordActivityType;
  /** Optional override for the application name shown on the card. */
  name: string;
  /** Template for the first line, e.g. "{status} in {project}". */
  details: string;
  /** Opened when the details line is clicked. */
  detailsUrl: string;
  /** Template for the second line, e.g. "{chat}". */
  state: string;
  /** Opened when the state line is clicked. */
  stateUrl: string;
  statusDisplayType: DiscordStatusDisplayType;
  /** Keep showing something while no chat is open. */
  showWhenIdle: boolean;
  /** Never show a card while in a plain chat with no project open. */
  hideOnChats: boolean;
  idleDetails: string;
  idleState: string;
  largeImage: string;
  largeText: string;
  /** Opened when the large image is clicked. */
  largeUrl: string;
  smallImage: string;
  smallText: string;
  /** Opened when the small image is clicked. */
  smallUrl: string;
  /** Editor card lines. */
  editorDetails: string;
  editorDetailsUrl: string;
  editorState: string;
  editorStateUrl: string;
  editorTimerScope: DiscordEditorTimerScope;
  editorLargeImage: string;
  editorLargeText: string;
  editorLargeUrl: string;
  editorSmallImage: string;
  editorSmallText: string;
  editorSmallUrl: string;
  showButtons: boolean;
  button1Label: string;
  button1Url: string;
  button2Label: string;
  button2Url: string;
}

/** What the public GET /oauth2/applications/{id}/rpc endpoint reports — used by the settings preview. */
export interface DiscordApplicationInfo {
  name: string;
  /** Icon hash; pair with discordAppIconUrl to get a CDN address. */
  icon: string;
  /** Uploaded art, keyed by name; `type` is "png" or "gif" (Discord asset type 2 = animated). */
  assets: { id: string; name: string; type: "png" | "gif" }[];
}

export const discordAssetCdnUrl = (clientId: string, assetId: string): string =>
  `https://cdn.discordapp.com/app-assets/${clientId}/${assetId}.png`;

export const discordAppIconCdnUrl = (clientId: string, icon: string): string =>
  `https://cdn.discordapp.com/app-icons/${clientId}/${icon}.png`;

export interface DiscordActivity {
  type: number;
  name?: string;
  status_display_type?: number;
  details?: string;
  details_url?: string;
  state?: string;
  state_url?: string;
  /** Unix milliseconds, matching the gateway Activity object that SET_ACTIVITY accepts. */
  timestamps?: { start: number };
  assets?: {
    large_image?: string;
    large_text?: string;
    large_url?: string;
    small_image?: string;
    small_text?: string;
    small_url?: string;
  };
  buttons?: { label: string; url: string }[];
}

export interface DiscordPresenceContext {
  /** Repository/project name, without a path. "Chat" when the surface has no repository. */
  project: string;
  /** True when this is a plain chat surface (a scratch chat, no repository behind it). */
  regularChat: boolean;
  /** Current chat title. Empty means no chat is open. */
  chat: string;
  /** "Working", "Waiting for you", "Idle", ... */
  status: string;
  server: string;
}

/** What the editor is showing, plus the display name of its language. */
export interface DiscordEditorContext {
  /** File name only, e.g. "App.svelte". */
  file: string;
  /** Project-relative path, e.g. "src/App.svelte". */
  path: string;
  project: string;
  language: string;
  server: string;
}

export const DEFAULT_DISCORD_RPC: DiscordRpcSettings = {
  enabled: false,
  clientId: "",
  mode: "auto",
  activityType: "playing",
  name: "",
  details: "{status} in {project}",
  detailsUrl: "",
  state: "{chat}",
  stateUrl: "",
  statusDisplayType: "name",
  showWhenIdle: false,
  hideOnChats: false,
  idleDetails: "Taking a break",
  idleState: "yoakeland",
  largeImage: "logo",
  largeText: "yoakeland",
  largeUrl: "",
  smallImage: "",
  smallText: "",
  smallUrl: "",
  editorDetails: "Editing {file}",
  editorDetailsUrl: "",
  editorState: "{project} · {language}",
  editorStateUrl: "",
  editorTimerScope: "file",
  editorLargeImage: "logo",
  editorLargeText: "{language}",
  editorLargeUrl: "",
  editorSmallImage: "",
  editorSmallText: "",
  editorSmallUrl: "",
  showButtons: false,
  button1Label: "",
  button1Url: "",
  button2Label: "",
  button2Url: "",
};

export const DISCORD_PRESENCE_MODES: { value: DiscordPresenceMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "chat", label: "Chat" },
  { value: "editor", label: "Editor" },
];

export const DISCORD_EDITOR_TIMER_SCOPES: { value: DiscordEditorTimerScope; label: string }[] = [
  { value: "file", label: "Per file" },
  { value: "workspace", label: "Per workspace" },
];

const ACTIVITY_TYPES: Record<DiscordActivityType, number> = {
  playing: 0,
  listening: 2,
  watching: 3,
  competing: 5,
};

const STATUS_DISPLAY_TYPES: Record<DiscordStatusDisplayType, number> = {
  name: 0,
  state: 1,
  details: 2,
};

export const DISCORD_STATUS_DISPLAY_TYPES: { value: DiscordStatusDisplayType; label: string }[] = [
  { value: "name", label: "App name" },
  { value: "state", label: "State" },
  { value: "details", label: "Details" },
];

export const DISCORD_TEMPLATE_VARS = ["app", "project", "chat", "status", "server"] as const;
export const DISCORD_EDITOR_TEMPLATE_VARS = ["app", "project", "file", "filePath", "language", "languageKey", "server"] as const;

/** Asset-key friendly language slug, e.g. "C++" -> "cpp", matching the conventional icon keys. */
const LANGUAGE_KEYS: Record<string, string> = {
  "c++": "cpp",
  "c#": "csharp",
  "f#": "fsharp",
  "objective-c": "objectivec",
  "objective-c++": "objectivecpp",
  "plain text": "text",
  "shell script": "shell",
  "visual basic": "vb",
  "vb.net": "vbnet",
  "restructuredtext": "rst",
};
export function discordLanguageKey(language: string): string {
  const name = String(language ?? "").trim().toLowerCase();
  return LANGUAGE_KEYS[name] ?? name.replace(/[^a-z0-9]+/g, "");
}

/** Replaces {name} placeholders; unknown placeholders disappear rather than leaking braces. */
export function renderDiscordTemplate(template: string, vars: Record<string, string>): string {
  return String(template ?? "")
    .replace(/\{(\w+)\}/g, (_match, key: string) => Object.hasOwn(vars, key) ? vars[key] : "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function resolveDiscordClientId(settings: Pick<DiscordRpcSettings, "clientId">): string {
  return settings.clientId.trim() || DEFAULT_DISCORD_CLIENT_ID;
}

/** True once the settings describe a connection worth attempting. */
export function discordRpcConfigured(settings: DiscordRpcSettings): boolean {
  return settings.enabled && /^\d{16,22}$/.test(resolveDiscordClientId(settings));
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** Only plain http(s) links are meaningful to Discord; anything else is dropped. */
function httpUrl(value: string, max = 512): string {
  const url = String(value ?? "").trim();
  return url.length <= max && /^https?:\/\/\S+$/i.test(url) ? url : "";
}

function button(label: string, url: string): { label: string; url: string } | null {
  const l = clip(label.trim(), 32);
  const u = httpUrl(url, 512);
  if (!l || !u) return null;
  return { label: l, url: u };
}

interface ArtworkSettings {
  image: string;
  text: string;
  url: string;
  smallImage: string;
  smallText: string;
  smallUrl: string;
}

function buildActivity(
  settings: DiscordRpcSettings,
  lines: { details: string; state: string; detailsUrl: string; stateUrl: string },
  artwork: ArtworkSettings,
  vars: Record<string, string>,
  startedAt: number,
): DiscordActivity | null {
  const activity: DiscordActivity = { type: ACTIVITY_TYPES[settings.activityType] ?? 0 };
  const name = clip(String(settings.name ?? "").trim(), 128);
  if (name) activity.name = name;
  if (settings.statusDisplayType !== "name") {
    const display = STATUS_DISPLAY_TYPES[settings.statusDisplayType];
    if (display !== undefined) activity.status_display_type = display;
  }
  if (lines.details) {
    activity.details = lines.details;
    const url = httpUrl(lines.detailsUrl);
    if (url) activity.details_url = url;
  }
  if (lines.state) {
    activity.state = lines.state;
    const url = httpUrl(lines.stateUrl);
    if (url) activity.state_url = url;
  }
  if (startedAt > 0) activity.timestamps = { start: startedAt };

  const assets: NonNullable<DiscordActivity["assets"]> = {};
  const largeImage = renderDiscordTemplate(artwork.image, vars);
  if (largeImage) {
    assets.large_image = clip(largeImage, 256);
    if (artwork.text.trim()) assets.large_text = clip(renderDiscordTemplate(artwork.text, vars), 128);
    const url = httpUrl(artwork.url);
    if (url) assets.large_url = url;
  }
  const smallImage = renderDiscordTemplate(artwork.smallImage, vars);
  if (smallImage) {
    assets.small_image = clip(smallImage, 256);
    if (artwork.smallText.trim()) assets.small_text = clip(renderDiscordTemplate(artwork.smallText, vars), 128);
    const url = httpUrl(artwork.smallUrl);
    if (url) assets.small_url = url;
  }
  if (Object.keys(assets).length) activity.assets = assets;

  if (settings.showButtons) {
    const buttons = [button(settings.button1Label, settings.button1Url), button(settings.button2Label, settings.button2Url)].filter(
      (b): b is { label: string; url: string } => b !== null,
    );
    if (buttons.length) activity.buttons = buttons;
  }

  // A timer alone shows nothing worth a slow update; require real content as well.
  const hasContent = !!(activity.name || activity.details || activity.state || activity.assets || activity.buttons);
  return hasContent ? activity : null;
}

/** Builds the chat activity Discord receives. Returns null when there is nothing to show. */
export function buildDiscordActivity(
  settings: DiscordRpcSettings,
  context: DiscordPresenceContext,
  startedAt: number,
): DiscordActivity | null {
  // "Idle" means no real chat content, project or not: a fresh empty chat surfaces as idle,
  // and a plain (no-repository) chat can be hidden entirely.
  const idle = !context.chat;
  if (idle && !settings.showWhenIdle) return null;
  if (!idle && context.regularChat && settings.hideOnChats) return null;

  const vars: Record<string, string> = {
    app: "yoakeland",
    project: context.project || "yoakeland",
    chat: context.chat || "No chat open",
    status: context.status || "Composing",
    server: context.server || "",
  };
  const details = clip(renderDiscordTemplate(idle ? settings.idleDetails : settings.details, vars), 128);
  const state = clip(renderDiscordTemplate(idle ? settings.idleState : settings.state, vars), 128);

  return buildActivity(
    settings,
    { details, state, detailsUrl: settings.detailsUrl, stateUrl: settings.stateUrl },
    {
      image: settings.largeImage,
      text: settings.largeText,
      url: settings.largeUrl,
      smallImage: settings.smallImage,
      smallText: settings.smallText,
      smallUrl: settings.smallUrl,
    },
    vars,
    !idle ? startedAt : 0,
  );
}

/** Builds the editor activity. Returns null when no file is open. */
export function buildDiscordEditorActivity(
  settings: DiscordRpcSettings,
  context: DiscordEditorContext,
  startedAt: number,
): DiscordActivity | null {
  if (!context.file) return null;
  const vars: Record<string, string> = {
    app: "yoakeland",
    project: context.project || "yoakeland",
    file: context.file,
    filePath: context.path,
    language: context.language || "Plain text",
    languageKey: discordLanguageKey(context.language),
    server: context.server || "",
  };
  const details = clip(renderDiscordTemplate(settings.editorDetails, vars), 128);
  const state = clip(renderDiscordTemplate(settings.editorState, vars), 128);

  return buildActivity(
    settings,
    { details, state, detailsUrl: settings.editorDetailsUrl, stateUrl: settings.editorStateUrl },
    {
      image: settings.editorLargeImage,
      text: settings.editorLargeText,
      url: settings.editorLargeUrl,
      smallImage: settings.editorSmallImage,
      smallText: settings.editorSmallText,
      smallUrl: settings.editorSmallUrl,
    },
    vars,
    startedAt,
  );
}
