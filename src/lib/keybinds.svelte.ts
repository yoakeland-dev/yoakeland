// Every rebindable shortcut. A combo is a canonical string like "Mod+Shift+K": "Mod" is Cmd on
// macOS and Ctrl elsewhere, "Ctrl" only survives on macOS (where it's a separate key). Keys come
// from `e.code` for letters, digits and punctuation, so Shift and keyboard layout don't change them.
//
// `run` actions fire from the one window listener (dispatchKeybind, wired in +page.svelte).
// Actions without one belong to a component that checks `matches()` in its own key handler,
// so they only fire where that component has focus.
import { app } from "./state.svelte";
import { navigateSessionHistory, newChat } from "./ipc";
import { sessionModes, chooseMode } from "./modes";

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Where a scoped action is live; two actions only conflict if they can fire in the same place. */
export type KeyScope = "global" | "chat" | "terminal" | "files" | "chatRow";

export interface KeyAction {
  id: string;
  label: string;
  group: string;
  scope: KeyScope;
  defaults: string[];
  /** Also fires while a terminal has focus (otherwise the shell gets the key). */
  inTerminal?: boolean;
  /** Returns false when it didn't apply, so the key falls through. */
  run?: () => boolean | void;
}

const sid = () => app.active?.currentSessionId ?? null;

function withChat(fn: (sessionId: string) => void) {
  return () => {
    const s = sid();
    if (!s || !app.active || app.fullPage) return false;
    fn(s);
  };
}

function openSettings(tab: string) {
  app.settingsTab = tab;
  app.showSettings = true;
}

function cycleMode(sessionId: string) {
  const server = app.active;
  const cid = app.activeConnectionId;
  if (!server || !cid) return;
  const { available } = sessionModes(server, sessionId);
  const cur = server.modeBySession[sessionId] ?? "read_write";
  chooseMode(server, cid, sessionId, available[(Math.max(0, available.indexOf(cur)) + 1) % available.length]);
}

export const ACTIONS: KeyAction[] = [
  // General
  { id: "palette.toggle", label: "Command palette", group: "General", scope: "global", defaults: ["Mod+K"],
    run: () => void (app.paletteOpen ? (app.paletteOpen = false) : app.openPalette()) },
  { id: "settings.open", label: "Settings", group: "General", scope: "global", defaults: ["Mod+,"], run: () => void (app.showSettings = !app.showSettings) },
  { id: "keybinds.open", label: "Keyboard shortcuts", group: "General", scope: "global", defaults: ["Mod+Shift+/"], run: () => openSettings("keyboard") },
  { id: "notifications.open", label: "Notifications", group: "General", scope: "global", defaults: [], run: () => void (app.notificationsOpen = !app.notificationsOpen) },
  { id: "extensions.toggle", label: "MCP servers and skills", group: "General", scope: "global", defaults: [], run: () => void (app.showExtensions ? (app.showExtensions = false) : app.openExtensions()) },
  { id: "usage.toggle", label: "Usage", group: "General", scope: "global", defaults: [], run: () => void (app.showUsage = !app.showUsage) },

  // View
  { id: "sidebar.toggle", label: "Toggle sidebar", group: "View", scope: "global", defaults: ["Mod+B"], run: () => app.toggleSidebar() },
  { id: "panel.toggle", label: "Toggle side panel", group: "View", scope: "global", defaults: ["Mod+Alt+B"],
    run: withChat((s) => app.active!.toggleChatSidebar(s)) },
  { id: "terminal.toggle", label: "Toggle terminal", group: "View", scope: "global", defaults: ["Ctrl+`"], inTerminal: true,
    run: withChat((s) => app.active!.toggleTerminal(s)) },
  { id: "terminal.new", label: "New terminal", group: "View", scope: "global", defaults: ["Ctrl+Shift+`"], inTerminal: true,
    run: withChat((s) => app.active!.newTerminal(s)) },
  { id: "terminal.split", label: "Split terminal", group: "View", scope: "global", defaults: ["Mod+Shift+5"], inTerminal: true,
    run: withChat((s) => app.active!.terminalOpenBySession[s] && app.active!.toggleTerminalSplit(s)) },
  { id: "terminal.maximize", label: "Maximize terminal", group: "View", scope: "global", defaults: [], inTerminal: true,
    run: withChat((s) => app.active!.terminalOpenBySession[s] && (app.terminalMaximized = !app.terminalMaximized)) },

  // Chat
  { id: "chat.new", label: "New chat", group: "Chat", scope: "global", defaults: ["Mod+N"],
    run: () => {
      const cid = app.activeConnectionId;
      const p = app.active?.currentProjectPath;
      if (cid && p) void newChat(cid, p);
      else app.openPalette("projects");
    } },
  // VS Code's Go Back/Forward: Alt+arrows and Mod+[ ] already mean something in text and the editor.
  { id: "chat.back", label: "Previous chat", group: "Chat", scope: "global", defaults: [isMac ? "Ctrl+-" : "Ctrl+Alt+-"],
    run: () => (app.activeConnectionId && app.active?.canGoBack ? navigateSessionHistory(app.activeConnectionId, "back") : false) },
  { id: "chat.forward", label: "Next chat", group: "Chat", scope: "global", defaults: ["Ctrl+Shift+-"],
    run: () => (app.activeConnectionId && app.active?.canGoForward ? navigateSessionHistory(app.activeConnectionId, "forward") : false) },
  { id: "chat.focus", label: "Focus composer", group: "Chat", scope: "global", defaults: ["Mod+L"],
    run: withChat((s) => document.querySelector<HTMLElement>(`.panel[data-session-id="${CSS.escape(s)}"] textarea`)?.focus()) },
  { id: "chat.model", label: "Change model", group: "Chat", scope: "global", defaults: ["Mod+Shift+M"],
    run: withChat((s) => (app.modelPickerRequest = { sessionId: s, at: Date.now() })) },
  { id: "chat.mode", label: "Cycle mode", group: "Chat", scope: "global", defaults: ["Mod+."], run: withChat(cycleMode) },
  { id: "chat.find", label: "Find in chat", group: "Chat", scope: "chat", defaults: ["Mod+F"] },
  ...Array.from({ length: 9 }, (_, i): KeyAction => ({
    id: `chat.pinned${i + 1}`, label: `Open pinned chat ${i + 1}`, group: "Chat", scope: "global", defaults: [`Mod+${i + 1}`],
  })),
  { id: "chat.rename", label: "Rename chat", group: "Chat list", scope: "chatRow", defaults: ["F2"] },
  { id: "chat.archive", label: "Archive chat", group: "Chat list", scope: "chatRow", defaults: ["Delete"] },

  // Terminal (while it has focus)
  { id: "terminal.find", label: "Find", group: "Terminal", scope: "terminal", defaults: ["Mod+F"] },
  { id: "terminal.copy", label: "Copy selection", group: "Terminal", scope: "terminal", defaults: ["Ctrl+Shift+C"] },
  { id: "terminal.paste", label: "Paste", group: "Terminal", scope: "terminal", defaults: ["Ctrl+Shift+V"] },
  { id: "terminal.prevCommand", label: "Previous command", group: "Terminal", scope: "terminal", defaults: ["Alt+ArrowUp"] },
  { id: "terminal.nextCommand", label: "Next command", group: "Terminal", scope: "terminal", defaults: ["Alt+ArrowDown"] },

  // Files (while the file panel has focus)
  { id: "files.quickOpen", label: "Go to file", group: "Files", scope: "files", defaults: ["Mod+P"] },
  { id: "files.close", label: "Close file", group: "Files", scope: "files", defaults: ["Mod+W"] },
  { id: "files.save", label: "Save file", group: "Files", scope: "files", defaults: ["Mod+S"] },
  { id: "files.gotoLine", label: "Go to line", group: "Files", scope: "files", defaults: ["Mod+G"] },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

const MODS = ["Mod", "Ctrl", "Alt", "Shift", "Meta"] as const;

const CODE_KEYS: Record<string, string> = {
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Space: "Space",
};

/** Folds "Ctrl" into "Mod" off macOS and orders modifiers, so equal combos compare equal. */
export function normalize(combo: string): string {
  const parts = combo.split("+");
  // A trailing "+" key would split into an empty part; there's no such key from comboFromEvent.
  const key = parts.pop()!;
  const mods = new Set(parts.map((m) => (m === "Ctrl" && !isMac ? "Mod" : m === "Cmd" ? "Mod" : m)));
  return [...MODS.filter((m) => mods.has(m)), key].join("+");
}

/** The combo a keydown spells, or null for a bare modifier press. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Unidentified"].includes(e.key)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else if (e.key === "+") key = "Plus";
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push("Mod");
  if (isMac && e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (!isMac && e.metaKey) mods.push("Meta");
  return [...mods, key].join("+");
}

/** Current binds for an action: the user's override if set (even an empty one), else the defaults. */
export function bindsFor(id: string): string[] {
  const o = app.settings.keybinds?.[id];
  return (o ?? ACTION_BY_ID.get(id)?.defaults ?? []).map(normalize);
}

export function matches(e: KeyboardEvent, id: string): boolean {
  if (recorder.active) return false;
  const c = comboFromEvent(e);
  return !!c && bindsFor(id).includes(c);
}

const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "↵", Escape: "Esc",
  Backspace: "⌫", Delete: "Del", PageUp: "PgUp", PageDown: "PgDn", Plus: "+",
};
const MOD_LABELS: Record<string, string> = isMac
  ? { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "Meta" }
  : { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Super" };

/** Display pieces for one combo, one per <kbd>. */
export function comboParts(combo: string): string[] {
  const parts = normalize(combo).split("+");
  const key = parts.pop()!;
  return [...parts.map((m) => MOD_LABELS[m] ?? m), KEY_LABELS[key] ?? key];
}

/** "Ctrl+Shift+K" style text of an action's first bind, "" if unbound. */
export function keyLabel(id: string): string {
  const b = bindsFor(id)[0];
  return b ? comboParts(b).join(isMac ? "" : "+") : "";
}

function scopesOverlap(a: KeyScope, b: KeyScope) {
  return a === b || a === "global" || b === "global";
}

/** Other actions already using `combo` where `id` could also fire. */
export function conflictsFor(id: string, combo: string): KeyAction[] {
  const self = ACTION_BY_ID.get(id);
  if (!self) return [];
  const c = normalize(combo);
  return ACTIONS.filter((a) => a.id !== id && scopesOverlap(a.scope, self.scope) && bindsFor(a.id).includes(c));
}

function save(id: string, binds: string[]) {
  const a = ACTION_BY_ID.get(id);
  const next = { ...app.settings.keybinds };
  const same = a && binds.length === a.defaults.length && binds.every((b, i) => b === normalize(a.defaults[i]));
  if (same) delete next[id];
  else next[id] = binds;
  app.settings.keybinds = next;
  app.applySettings();
}

/** Puts `combo` in slot `index` (appends past the end), taking it off anything it conflicts with. */
export function setBind(id: string, index: number, combo: string) {
  const c = normalize(combo);
  for (const other of conflictsFor(id, c)) save(other.id, bindsFor(other.id).filter((b) => b !== c));
  const binds = [...bindsFor(id)];
  const at = Math.min(index, binds.length);
  binds[at] = c;
  save(id, binds.filter((b, i) => b !== c || i === at).slice(0, 2));
}

export function removeBind(id: string, index: number) {
  save(id, bindsFor(id).filter((_, i) => i !== index));
}

export function resetBinds(id?: string) {
  if (id) {
    const next = { ...app.settings.keybinds };
    delete next[id];
    app.settings.keybinds = next;
  } else {
    app.settings.keybinds = {};
  }
  app.applySettings();
}

export function isCustomized(id: string): boolean {
  return app.settings.keybinds?.[id] !== undefined;
}

/** Set while Settings > Keyboard is capturing a combo, so nothing else reacts to it. */
export const recorder = $state({ active: false });

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** The app-wide listener: runs whichever global action the key is bound to. */
export function dispatchKeybind(e: KeyboardEvent) {
  if (recorder.active || e.defaultPrevented) return;
  const combo = comboFromEvent(e);
  if (!combo) return;
  const inTerminal = !!(e.target as Element | null)?.closest?.(".xterm");
  // A bare key (no Ctrl/Alt/Cmd, not F1-F12) bound globally shouldn't eat typing.
  const typing = !/(^|\+)(Mod|Ctrl|Alt|Meta)\+|(^|\+)F\d+$/.test(combo) && (isTextTarget(e.target) || inTerminal);
  if (typing) return;
  for (const a of ACTIONS) {
    if (!a.run || (inTerminal && !a.inTerminal)) continue;
    if (!bindsFor(a.id).includes(combo)) continue;
    if (a.run() === false) continue;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
}

/** The mouse's back/forward side buttons do what Previous/Next chat do, as in a browser. */
export function dispatchMouseNav(e: MouseEvent) {
  const id = e.button === 3 ? "chat.back" : e.button === 4 ? "chat.forward" : null;
  if (!id) return;
  e.preventDefault();
  ACTIONS.find((a) => a.id === id)?.run?.();
}
