// Inline artifacts: a ```artifact fence holds a small HTML page the agent wrote (a chart, a form, a
// widget), which Markdown.svelte shows in a sandboxed frame under the message. The page can't touch
// the app (no same-origin, no network: see the CSP below) and starts out in the app's own look through
// the tokens and classes below; it restyles by overriding the tokens in its own <style>.

/** Token name -> the app CSS variable it starts from (and a fallback for a variable the theme leaves out). */
const TOKENS: Record<string, [string, string]> = {
  "--bg": ["--code-bg", "#ffffff"],
  "--fg": ["--text", "#1b1c22"],
  "--muted": ["--text-dim", "#6b6f80"],
  "--accent": ["--accent", "#7c9bff"],
  "--border": ["--panel-border", "rgba(128,128,128,.25)"],
  "--danger": ["--danger", "#ff6b6b"],
  "--success": ["--success", "#58d68d"],
  "--warning": ["--warning", "#f0b429"],
  "--radius": ["--radius-sm", "7px"],
};

/** The app's current theme as a `:root { ... }` the artifact starts from. Concrete values, since the
 * frame can't see the app's variables. */
function tokenCss(): string {
  const cs = getComputedStyle(document.documentElement);
  const probe = document.createElement("span");
  document.body.append(probe);
  const concrete = (v: string) => {
    probe.style.color = v;
    return probe.style.color && getComputedStyle(probe).color;
  };
  const out = Object.entries(TOKENS).map(([name, [from, fb]]) => {
    const v = cs.getPropertyValue(from).trim() || fb;
    return `${name}:${name === "--radius" ? v : concrete(v) || fb}`;
  });
  probe.remove();
  out.push(
    `--surface:color-mix(in srgb,var(--fg) 6%,var(--bg))`,
    `--accent-soft:color-mix(in srgb,var(--accent) 18%,var(--bg))`,
    `--font:${getComputedStyle(document.body).fontFamily}`,
    `--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`,
    `color-scheme:${getComputedStyle(document.documentElement).colorScheme || "normal"}`,
  );
  return `:root{${out.join(";")}}`;
}

// What the agent gets for free. Keep in step with the artifact paragraph in the server's system prompt.
const BASE_CSS = `
*{box-sizing:border-box}
body{margin:0;padding:12px;background:transparent;color:var(--fg);font:14px/1.5 var(--font)}
h1,h2,h3{margin:0 0 .5em;line-height:1.25}h1{font-size:1.35em}h2{font-size:1.15em}h3{font-size:1em}
p{margin:0 0 .75em}a{color:var(--accent)}code,pre{font-family:var(--mono);font-size:.9em}
.muted{color:var(--muted)}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px}
.stat b{display:block;font-size:1.6em;line-height:1.2}.stat span{color:var(--muted);font-size:.85em}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--accent-soft);font-size:.8em}
.ok{color:var(--success)}.warn{color:var(--warning)}.bad{color:var(--danger)}
.bar{height:8px;border-radius:999px;background:var(--surface);overflow:hidden}.bar>i{display:block;height:100%;background:var(--accent)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--border)}th{color:var(--muted);font-weight:500}
button,input,select,textarea{font:inherit;color:inherit;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:5px 10px}
button{cursor:pointer}button.primary{background:var(--accent);border-color:transparent;color:#fff}
svg{max-width:100%}
`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'";

/** Tells the app how tall the page is, and keeps links from taking the frame anywhere. */
const reporter = (id: string) =>
  `<script>(()=>{const p=()=>parent.postMessage({yoakeArtifact:${JSON.stringify(id)},h:document.documentElement.scrollHeight},"*");` +
  `new ResizeObserver(p).observe(document.documentElement);addEventListener("load",p);p();` +
  `addEventListener("click",e=>{if(e.target.closest&&e.target.closest("a"))e.preventDefault()})})()</script>`;

/** The page for one frame's `srcdoc`. The agent's source comes after the base styles, so it overrides them. */
export function artifactSrcdoc(source: string, id: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<style>${tokenCss()}${BASE_CSS}</style></head><body>${source}${reporter(id)}</body></html>`
  );
}

const frames = new Map<string, HTMLIFrameElement>();
let listening = false;

/** Puts the artifact in `host`, replacing whatever was there. The frame grows to its page's height. */
export function showArtifact(host: HTMLElement, source: string) {
  if (!listening) {
    listening = true;
    addEventListener("message", (e) => {
      const d = e.data as { yoakeArtifact?: string; h?: number } | null;
      const f = d && typeof d.yoakeArtifact === "string" ? frames.get(d.yoakeArtifact) : undefined;
      if (!f || e.source !== f.contentWindow || typeof d?.h !== "number") return;
      f.style.height = Math.min(Math.max(d.h, 24), 1200) + "px";
    });
  }
  for (const [id, f] of frames) if (!f.isConnected) frames.delete(id);
  const id = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts"); // no allow-same-origin: it can't reach the app's storage or DOM
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = "Artifact";
  frame.srcdoc = artifactSrcdoc(source, id);
  frames.set(id, frame);
  host.replaceChildren(frame);
}
