// Parses the OSC 633 subset internal/terminal/scripts/integration.{bash,zsh}
// inject into the shell's own prompt hooks — see shellintegration.go for
// why this needs no wire protocol change: the bytes already ride inside the
// normal terminal_output/history stream every other pty write does, this
// just interprets ones that were always flowing through.
//
// Subset handled (see the shell scripts for why this is a cut-down version
// of VS Code's full OSC 633 set): `A` (prompt start — swallowed, no action
// yet), `B` (prompt end — zsh only, swallowed), `C` (command start — zsh
// only, swallowed), `D;<exitcode>` (previous command finished — drives the
// gutter mark), `P;Cwd=<path>` (cwd report — drives the live tab cwd).
import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";

const OSC_633 = 633;

export interface ShellIntegration {
  /** Alt+Up — jump the viewport to the nearest command boundary above it. */
  goToPreviousCommand(): void;
  /** Alt+Down — same, below the viewport. */
  goToNextCommand(): void;
  dispose(): void;
}

export function attachShellIntegration(term: Terminal, onCwd: (cwd: string) => void): ShellIntegration {
  const marks: IMarker[] = [];
  const decorations: IDecoration[] = [];

  const osc = term.parser.registerOscHandler(OSC_633, (data) => {
    const [code, ...rest] = data.split(";");
    if (code === "D") {
      const exitCode = Number(rest[0]);
      markCommandBoundary(term, marks, decorations, Number.isFinite(exitCode) ? exitCode : 0);
    } else if (code === "P") {
      for (const kv of rest) {
        const eq = kv.indexOf("=");
        if (eq === -1) continue;
        if (kv.slice(0, eq) === "Cwd") {
          const cwd = kv.slice(eq + 1);
          if (cwd) onCwd(cwd);
        }
      }
    }
    // "A"/"B"/"C" carry no payload we act on yet — still return true so
    // none of the OSC 633 subset ever renders as literal garbage.
    return true;
  });

  return {
    goToPreviousCommand: () => jumpToCommand(term, marks, -1),
    goToNextCommand: () => jumpToCommand(term, marks, 1),
    dispose: () => {
      osc.dispose();
      for (const d of decorations) d.dispose();
      for (const m of marks) m.dispose();
    },
  };
}

// markCommandBoundary drops a marker (and a small colored gutter
// decoration, green/red by exitCode) on the line the cursor sits on right
// now — the OSC 633;D handler fires from the shell's precmd hook, which
// runs before the prompt text itself is printed, so the cursor is already
// on the blank line the upcoming prompt will occupy. That's the same line
// VS Code's own command decorations anchor to.
function markCommandBoundary(term: Terminal, marks: IMarker[], decorations: IDecoration[], exitCode: number) {
  const marker = term.registerMarker(0);
  if (!marker) return;
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
