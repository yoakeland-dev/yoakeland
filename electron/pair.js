// Pairing with a typed PIN (SPEC.md §2a, "Pairing with a PIN"): the client half. One short-lived TLS
// connection that turns "address + PIN" into the same credential a QR code gives: a one-device
// token, and the CA to trust the server with from then on. The caller connects with those as usual.
//
// The server's certificate is deliberately not checked here: there is no CA to check it against yet.
// What authenticates the server is the exchange itself (only someone who knows the PIN can finish
// it), and what rules out a man in the middle is the TLS exporter in the channel identifier: a relay
// that terminates TLS is on a different session on each side, so each side derives a different key.
import { createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { CPaceAbort, lvCat, start } from "./cpace.js";

const LABEL = "yoake/pair/v1";
const EXPORTER = "EXPORTER-yoake-pair-v1";
const MAX_FRAME_BYTES = 1024 * 1024;
const STEP_MS = 10_000; // each answer that needs no human
const APPROVAL_MS = 75_000; // the credential may wait for someone at the server to say yes (60s there)

const b64 = (b) => Buffer.from(b).toString("base64");
const key = (isk, what) => Buffer.from(hkdfSync("sha512", isk, Buffer.alloc(0), `${LABEL} ${what}`, 32));

/** What a person typed, reduced to its digits: "4821-7733" is "48217733". */
export const normalizePin = (s) => String(s ?? "").replace(/\D/g, "");

/**
 * @param {{host: string, port: number, pin: string, deviceId: string, name?: string, deviceType?: string, avatar?: string}} opts
 * @param {{onWaiting?: () => void, connect?: typeof tls.connect}} [hooks] `connect` is for tests.
 * @returns {Promise<{token: string, caPem: string}>}
 */
export async function pairWithPin({ host, port, pin, deviceId, name, deviceType, avatar }, { onWaiting, connect = tls.connect } = {}) {
  const digits = normalizePin(pin);
  if (!digits) throw new Error("Enter the PIN the server printed.");
  if (!deviceId) throw new Error("This device has no id to pair with.");

  const sock = connect({ host, port, rejectUnauthorized: false, servername: net.isIP(host) ? undefined : host });
  const frames = frameReader(sock);
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no answer from ${host}:${port}`)), STEP_MS);
      sock.once("secureConnect", () => (clearTimeout(t), resolve()));
      sock.once("error", (e) => (clearTimeout(t), reject(new Error(`couldn't connect to ${host}:${port}: ${e.message}`))));
    });

    const binding = sock.exportKeyingMaterial(32, EXPORTER, Buffer.from(LABEL));
    const sid = randomBytes(16);
    const session = start(digits, lvCat(LABEL, binding), sid, deviceId);
    const hello = { name, deviceType, avatar, deviceId, pake: { sid: b64(sid), ya: b64(session.message) } };
    sock.write(JSON.stringify({ type: "auth", data: Object.fromEntries(Object.entries(hello).filter(([, v]) => v != null)) }) + "\n");

    const reply = await frames.expect("pake_reply", STEP_MS);
    let isk;
    try {
      isk = session.finishInitiator(Buffer.from(reply.yb, "base64"), Buffer.alloc(0));
    } catch (e) {
      throw e instanceof CPaceAbort ? new Error("The server sent something invalid. Pairing was stopped.") : e;
    }
    const mac = createHmac("sha256", key(isk, "confirm")).update(lvCat(`${LABEL} client`, sid)).digest();
    sock.write(JSON.stringify({ type: "pake_confirm", data: { mac: b64(mac) } }) + "\n");

    const result = await frames.expect("pake_result", APPROVAL_MS, onWaiting);
    const sealed = Buffer.from(result.sealed, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key(isk, "seal"), sealed.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${LABEL} result`));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    let plain;
    try {
      plain = Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]);
    } catch {
      throw new Error("The server's answer didn't check out, so it doesn't know the PIN. Pairing was stopped.");
    }
    const { token, caPem } = JSON.parse(plain.toString("utf8"));
    if (!token) throw new Error("The server paired but sent no credential.");
    return { token, caPem: caPem ?? "" };
  } finally {
    sock.end(); // the client hangs up first: the server waits for it, so the credential isn't cut off
    setTimeout(() => sock.destroy(), 1000).unref();
  }
}

/** Newline-delimited JSON frames off a socket, awaited one type at a time. */
function frameReader(sock) {
  let buf = "";
  const queue = [];
  let waiter = null;
  let ended = null;
  const wake = () => waiter?.();
  sock.setEncoding("utf8");
  sock.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        queue.push(JSON.parse(line));
      } catch {
        ended = new Error("The server sent something that isn't part of the protocol.");
      }
    }
    if (buf.length > MAX_FRAME_BYTES) ended = new Error("The server sent an oversized frame.");
    wake();
  });
  sock.on("error", (e) => ((ended = new Error(`connection error: ${e.message}`)), wake()));
  sock.on("close", () => ((ended ??= new Error("The server closed the connection.")), wake()));

  return {
    /** The next frame of this type; a fatal `error` frame from the server is thrown. */
    async expect(type, timeoutMs, onPending) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        while (queue.length) {
          const f = queue.shift();
          if (f.type === type) return f.data ?? {};
          if (f.type === "error") throw new Error(f.data?.message || "pairing failed");
          if (f.type === "pairing_pending") onPending?.();
          // anything else is not part of this exchange
        }
        if (ended) throw ended;
        const left = deadline - Date.now();
        if (left <= 0) throw new Error("The server didn't answer in time.");
        await new Promise((resolve) => {
          const t = setTimeout(resolve, left);
          waiter = () => (clearTimeout(t), (waiter = null), resolve());
        });
      }
    },
  };
}
