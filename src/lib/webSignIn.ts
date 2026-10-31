// Sign-in for the browser build, which has no loopback listener: the provider redirects to
// /oauth-callback on this origin (routes/oauth-callback), whose page posts what it got over a
// BroadcastChannel, which only ever reaches pages of the same origin.
import { openUrl } from "./platform";

export const OAUTH_CHANNEL = "yoake-oauth";
export const OAUTH_CALLBACK_PATH = "/oauth-callback";
const TIMEOUT_MS = 5 * 60_000;

export interface OAuthAnswer {
  code: string;
  state?: string;
  iss?: string;
}

const nonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

let cancelCurrent: (() => void) | undefined;

/** Ends the sign-in in progress: its `wait` rejects with "sign-in cancelled". */
export const cancelWebSignIn = () => cancelCurrent?.();

/** Call it inside the click, before any await: the tab is opened now (blank) so a popup blocker
 * doesn't take the later open, and sent to the provider by `open`. */
export function startWebSignIn() {
  cancelCurrent?.();
  const win = window.open("", "_blank");
  const chan = new BroadcastChannel(OAUTH_CHANNEL);
  const n = nonce(); // OpenRouter's redirect carries no state, so the callback URL carries this instead
  let cancelled = false;
  let fail: (e: Error) => void = () => {};
  const cancel = () => {
    cancelled = true;
    fail(new Error("sign-in cancelled"));
  };
  cancelCurrent = cancel;
  return {
    callbackUrl: `${location.origin}${OAUTH_CALLBACK_PATH}?n=${n}`,
    open(url: string) {
      if (!win) return void openUrl(url);
      win.opener = null; // the provider's page gets no handle on this one
      win.location.href = url;
    },
    /** The redirect's answer. Only the redirect that carries `state` (else this sign-in's `n`) counts. */
    wait(state?: string) {
      return new Promise<OAuthAnswer>((resolve, reject) => {
        if (cancelled) return reject(new Error("sign-in cancelled"));
        const timer = setTimeout(() => reject(new Error("timed out waiting for the browser sign-in")), TIMEOUT_MS);
        fail = (e) => (clearTimeout(timer), reject(e));
        chan.onmessage = (ev: MessageEvent<{ code?: string; state?: string; n?: string; iss?: string; error?: string }>) => {
          const m = ev.data;
          if (!m || (state ? m.state !== state : m.n !== n || (!m.code && !m.error))) return;
          clearTimeout(timer);
          if (m.error) reject(new Error(`sign-in refused: ${m.error}`));
          else if (m.code) resolve({ code: m.code, state: m.state, iss: m.iss });
        };
      });
    },
    end() {
      chan.close();
      win?.close();
      if (cancelCurrent === cancel) cancelCurrent = undefined;
    },
  };
}
