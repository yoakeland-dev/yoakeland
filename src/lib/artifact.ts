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


/** What the page can do besides draw: tell the app how tall it is, keep links from taking the frame
 * anywhere, and talk back. `yoake.submit(obj)` (only inside a click/keypress, so a page can't submit on
 * its own) sends the user's choice to the assistant; `yoake.log(...)`, console output and uncaught errors
 * are kept for the assistant's artifact_logs tool. The app relays these as artifact_event. */
const reporter = (id: string) =>
  `<script>(()=>{const id=${JSON.stringify(id)},post=m=>top.postMessage({yoakeArtifact:id,...m},"*");` +
  `const p=()=>post({h:document.documentElement.scrollHeight});` +
  `new ResizeObserver(p).observe(document.documentElement);addEventListener("load",p);p();` +
  `addEventListener("click",e=>{if(e.target.closest&&e.target.closest("a"))e.preventDefault()});` +
  `const str=a=>{try{return typeof a==="string"?a:a instanceof Error?a.stack||a.message:JSON.stringify(a)}catch{return String(a)}};` +
  `let n=0;const log=(kind,args)=>{if(n++<200)post({kind,data:args.map(str).join(" ").slice(0,4000)})};` +
  `for(const k of["log","info","warn","error"]){const o=console[k];console[k]=(...a)=>{log(k==="error"?"error":"log",a);o.apply(console,a)}}` +
  `addEventListener("error",e=>log("error",[e.message+(e.lineno?" (line "+e.lineno+")":"")]));` +
  `addEventListener("unhandledrejection",e=>log("error",["Unhandled rejection: ",e.reason]));` +
  `window.yoake={log:(...a)=>log("log",a),submit:o=>{if(!navigator.userActivation||!navigator.userActivation.isActive)return false;post({kind:"submit",data:o});return true}};` +
  `})()</script>`;

/** The page for one frame. The agent's source comes after the base styles, so it overrides them. */
export function artifactSrcdoc(source: string, id: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<style>${tokenCss()}${BASE_CSS}</style></head><body>${reporter(id)}${source}</body></html>`
  );
}

/** What the app does with an event from a page: send it on as artifact_event. */
export type ArtifactSink = (kind: "submit" | "log" | "error", data: unknown) => void;

/** The window of the artifact's page: the one frame inside the shell. */
const pageWindow = (shell: HTMLIFrameElement): Window | undefined => shell.contentWindow?.frames[0];

const frames = new Map<string, { frame: HTMLIFrameElement; sink?: ArtifactSink }>();
let listening = false;

/** Puts the artifact in `host`, replacing whatever was there. The frame grows to its page's height.
 * `sink` receives what the page submits and logs. */
export function showArtifact(host: HTMLElement, source: string, sink?: ArtifactSink) {
  if (!listening) {
    listening = true;
    addEventListener("message", (e) => {
      const d = e.data as { yoakeArtifact?: string; h?: number; kind?: string; data?: unknown } | null;
      const entry = d && typeof d.yoakeArtifact === "string" ? frames.get(d.yoakeArtifact) : undefined;
      if (!entry || e.source !== pageWindow(entry.frame)) return;
      if (typeof d?.h === "number") entry.frame.style.height = Math.min(Math.max(d.h, 24), 1200) + "px";
      else if (d?.kind === "submit" || d?.kind === "log" || d?.kind === "error") entry.sink?.(d.kind, d.data);
    });
  }
  for (const [id, f] of frames) if (!f.frame.isConnected) frames.delete(id);
  const id = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = "Artifact";
  // The page runs in a frame of its own inside this one (static/artifact-shell.html): sandboxed
  // without allow-same-origin, so it can't reach the app's storage or DOM, at a real URL with a CSP of
  // its own (srcdoc, data: and blob: frames inherit the app's script-src 'self', which blocks the
  // page's inline scripts), and held by a shell whose policy keeps it from navigating to another host.
  // The page's HTML is posted in once both have loaded.
  frame.src = "/artifact-shell.html";
  const doc = artifactSrcdoc(source, id);
  frame.addEventListener("load", () => pageWindow(frame)?.postMessage({ yoakeDoc: doc }, "*"), { once: true });
  frames.set(id, { frame, sink });
  host.replaceChildren(frame);
}
