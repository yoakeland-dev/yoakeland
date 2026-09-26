// Parses the OSC 633 subset internal/terminal/scripts/integration.{bash,zsh} inject; rides the
// normal terminal_output stream, no wire protocol change needed. Cut-down vs VS Code's full set:
// `C` (command start), `E;<cmdline>` (zsh only), `D;<exitcode>` (command done, gutter mark),
// `P;Cwd=<path>` (tab cwd). The xterm handler below only draws gutter marks; the tab state
// (busy, last exit, cwd, title) comes from scanShellEvents, which state.svelte.ts runs on every
// chunk so a terminal nobody is looking at still reports its state.
import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";

const OSC_633 = 633;

export interface ShellIntegration {
  /** Alt+Up: jump the viewport to the nearest command boundary above it. */
  goToPreviousCommand(): void;
  /** Alt+Down: same, below the viewport. */
  goToNextCommand(): void;
  dispose(): void;
}

export function attachShellIntegration(term: Terminal): ShellIntegration {
  const marks: IMarker[] = [];
  const decorations: IDecoration[] = [];
  // A marks the line the next prompt starts on; C claims it for the command typed there, and D
  // colors that line, so the mark sits beside the command rather than the prompt after it.
  let prompt: IMarker | undefined;
  let command: IMarker | undefined;

  const osc = term.parser.registerOscHandler(OSC_633, (data) => {
    const [code, ...rest] = data.split(";");
    if (code === "A") {
      prompt?.dispose(); // an empty line's prompt, never claimed
      prompt = term.registerMarker(0);
    } else if (code === "C" && prompt) {
      command = prompt;
      prompt = undefined;
    } else if (code === "D" && command) {
      // D without a C before it is an empty prompt line, not a finished command.
      const exitCode = Number(rest[0]);
      markCommand(term, command, marks, decorations, Number.isFinite(exitCode) ? exitCode : 0);
      command = undefined;
    }
    // Always return true so the OSC 633 subset never renders as literal garbage.
    return true;
  });

  return {
    goToPreviousCommand: () => jumpToCommand(term, marks, -1),
    goToNextCommand: () => jumpToCommand(term, marks, 1),
    dispose: () => {
      osc.dispose();
      for (const d of decorations) d.dispose();
      for (const m of marks) m.dispose();
      prompt?.dispose();
      command?.dispose();
    },
  };
}

function markCommand(term: Terminal, marker: IMarker, marks: IMarker[], decorations: IDecoration[], exitCode: number) {
  marks.push(marker);
  const decoration = term.registerDecoration({ marker, x: 0, width: 1 });
  if (!decoration) return;
  decorations.push(decoration);
  decoration.onRender((el) => {
    el.style.backgroundColor = exitCode === 0 ? "var(--success)" : "var(--danger)";
    el.style.opacity = "0.7";
    el.style.borderRadius = "1px";
  });
}

function jumpToCommand(term: Terminal, marks: IMarker[], dir: -1 | 1) {
  const current = term.buffer.active.viewportY;
  const lines = marks
    .map((m) => m.line)
    .filter((line) => line >= 0)
    .sort((a, b) => a - b);

  let target: number | undefined;
  if (dir === -1) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] < current) {
        target = lines[i];
        break;
      }
    }
  } else {
    for (const line of lines) {
      if (line > current) {
        target = line;
        break;
      }
    }
  }
  if (target !== undefined) term.scrollToLine(target);
}

/** What a chunk of pty output says about its shell. `busy` is undefined when the chunk has no
 * command boundary; `exitCode` is only set by a D that closes a C (same rule as the gutter). */
export interface ShellEvents {
  busy?: boolean;
  command?: string;
  exitCode?: number;
  cwd?: string;
  title?: string;
}

// OSC 633 (shell integration) and OSC 0/2 (window title), BEL- or ST-terminated.
const OSC_RE = /\x1b\](633|0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const decoder = new TextDecoder();

// ponytail: a sequence split across two chunks is missed; the next prompt's D/P fixes it up.
export function scanShellEvents(bytes: Uint8Array, wasBusy: boolean): ShellEvents | null {
  if (!bytes.includes(0x1b)) return null;
  const text = decoder.decode(bytes);
  if (!text.includes("\x1b]")) return null;
  const out: ShellEvents = {};
  let busy = wasBusy;
  let found = false;
  for (const [, code, body] of text.matchAll(OSC_RE)) {
    found = true;
    if (code !== "633") {
      out.title = body;
      continue;
    }
    const [kind, ...rest] = body.split(";");
    if (kind === "C") {
      busy = out.busy = true;
    } else if (kind === "E") {
      out.command = rest.join(";");
    } else if (kind === "D" && busy) {
      busy = out.busy = false;
      const code = Number(rest[0]);
      out.exitCode = Number.isFinite(code) ? code : 0;
    } else if (kind === "P") {
      for (const kv of rest) if (kv.startsWith("Cwd=") && kv.length > 4) out.cwd = kv.slice(4);
    }
  }
  return found ? out : null;
}
