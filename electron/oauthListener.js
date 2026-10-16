// One-shot loopback listener for an OAuth redirect (OpenRouter and MCP server sign-in). listen() opens a
// port on this machine and returns the callback URL to hand to the provider; wait() resolves with the `code`
// the browser delivers there, waitParams() with { code, state, iss } for a flow that checks them.
// One sign-in at a time; starting another cancels the first.
import http from "node:http";

const PAGE =
  '<!doctype html><meta charset="utf-8"><title>yoake</title>' +
  '<body style="font:16px system-ui;margin:4rem auto;max-width:24rem">Signed in. You can close this tab and go back to yoake.';

const DENIED =
  '<!doctype html><meta charset="utf-8"><title>yoake</title>' +
  '<body style="font:16px system-ui;margin:4rem auto;max-width:24rem">Sign-in was refused. You can close this tab and go back to yoake.';

export function createOAuthListener({ timeoutMs = 5 * 60_000 } = {}) {
  let current = null; // { result: Promise<{ code, state, iss }>, finish(err?, params?) }
  // The `state` the redirect must carry, once the flow has named one (MCP does; OpenRouter's has none).
  // Without it, any page or process that finds the port could settle the sign-in with its own code.
  let expected;

  function cancel() {
    current?.finish(new Error("sign-in cancelled"));
  }

  async function listen() {
    cancel();
    expected = undefined;
    let settled = false;
    let finish;
    const result = new Promise((resolve, reject) => {
      finish = (err, p) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
        if (err) reject(err);
        else resolve(p);
      };
    });
    result.catch(() => {}); // wait() may attach after a cancel; don't let that read as unhandled

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/callback") return void res.writeHead(404).end();
      // Not this sign-in's redirect: refuse it and keep waiting for the real one.
      if (expected !== undefined && url.searchParams.get("state") !== expected) return void res.writeHead(404).end();
      // The provider refused (the user said no): say so on the page and to the caller.
      const denied = url.searchParams.get("error");
      if (denied) {
        const why = url.searchParams.get("error_description") || denied;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" }).end(DENIED);
        return void finish(new Error(`sign-in refused: ${why}`));
      }
      const c = url.searchParams.get("code");
      if (!c) return void res.writeHead(400).end("missing code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" }).end(PAGE);
      finish(null, { code: c, state: url.searchParams.get("state") ?? undefined, iss: url.searchParams.get("iss") ?? undefined });
    });
    const timer = setTimeout(() => finish(new Error("timed out waiting for the browser sign-in")), timeoutMs);

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    }).catch((e) => {
      clearTimeout(timer);
      throw e;
    });
    current = { result, finish };
    // `localhost` is the form OpenRouter documents; browsers fall back to 127.0.0.1 if it resolves to ::1 first.
    return { callbackUrl: `http://localhost:${server.address().port}/callback` };
  }

  function expectState(state) {
    expected = typeof state === "string" && state ? state : undefined;
  }

  async function waitParams() {
    const c = current;
    if (!c) throw new Error("no sign-in in progress");
    try {
      return await c.result;
    } finally {
      if (current === c) current = null;
    }
  }

  async function wait() {
    return (await waitParams()).code;
  }

  return { listen, wait, waitParams, cancel, expectState };
}
