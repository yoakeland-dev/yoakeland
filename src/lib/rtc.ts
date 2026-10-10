// WebRTC data-channel transport for browsers (the server side is cmd/yoakeland/rtc.go, SPEC §2a
// "WebRTC clients"). A page on any HTTPS origin can't open a WebSocket to a server whose
// certificate its trust store doesn't know. A data channel pins the server's DTLS *fingerprint*
// instead, and the pairing code carries it, so nothing has to be installed and no signaling server
// is involved: the answer SDP is built here from the server's address and fingerprint, and the ICE
// ufrag the browser picks is what introduces it to the server.

/** One open connection: lines out, lines in, like the WebSocket path in platform.ts. */
export interface Wire {
  send(line: string): Promise<void>;
  close(): void;
  onLine: (line: string) => void;
  onClose: (reason: string) => void;
}

// Must match rtcUfragPrefix and rtcMaxMessage in cmd/yoakeland/rtc.go.
const UFRAG_PREFIX = "yoake+rtc+v1/";
const MAX_MESSAGE = 16384;
const SEND_HIGH_WATER = 1 << 20;

const isIPv4 = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
const isIPv6 = (h: string) => h.includes(":");
/** The answer SDP needs an address literal; a hostname can't be resolved from a page. */
export const canUseRtc = (host: string) => isIPv4(host) || isIPv6(host.replace(/^\[|\]$/g, ""));

function randomUfrag(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return UFRAG_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The server's answer, as it would have sent it if there were somewhere to send it from. */
function serverAnswer(host: string, port: number, fingerprint: string, ufrag: string): string {
  const ip = host.replace(/^\[|\]$/g, "");
  const family = isIPv4(ip) ? "IP4" : "IP6";
  return [
    "v=0",
    `o=- 0 0 IN ${family} ${ip}`,
    "s=-",
    "t=0 0",
    "a=ice-lite",
    "a=group:BUNDLE 0",
    `m=application ${port} UDP/DTLS/SCTP webrtc-datachannel`,
    `c=IN ${family} ${ip}`,
    "a=mid:0",
    "a=ice-options:ice2",
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${ufrag}`,
    `a=fingerprint:sha-256 ${fingerprint}`,
    "a=setup:passive",
    "a=sctp-port:5000",
    `a=max-message-size:${MAX_MESSAGE}`,
    `a=candidate:1467250680 1 UDP 1467250680 ${ip} ${port} typ host`,
    "a=end-of-candidates",
    "",
  ].join("\r\n");
}

export async function openRtc(host: string, port: number, fingerprint: string, timeoutMs = 15000): Promise<Wire> {
  const ufrag = randomUfrag();
  const pc = new RTCPeerConnection();
  const dc = pc.createDataChannel("", { negotiated: true, id: 0 });
  dc.binaryType = "arraybuffer";

  const wire: Wire = {
    async send(line) {
      const bytes = new TextEncoder().encode(line);
      for (let at = 0; at < bytes.length; at += MAX_MESSAGE) {
        if (dc.readyState !== "open") throw new Error("connection closed");
        if (dc.bufferedAmount > SEND_HIGH_WATER) {
          dc.bufferedAmountLowThreshold = SEND_HIGH_WATER / 4;
          await new Promise<void>((resolve) => dc.addEventListener("bufferedamountlow", () => resolve(), { once: true }));
        }
        dc.send(bytes.subarray(at, at + MAX_MESSAGE));
      }
    },
    close() {
      dc.onclose = null;
      dc.close();
      pc.close();
    },
    onLine: () => {},
    onClose: () => {},
  };

  // Messages are arbitrary slices of the byte stream, so decode and split lines across them.
  const decoder = new TextDecoder();
  let pending = "";
  dc.onmessage = (e) => {
    pending += typeof e.data === "string" ? e.data : decoder.decode(e.data as ArrayBuffer, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      if (line.trim()) wire.onLine(line);
    }
  };

  const opened = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
    dc.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        clearTimeout(timer);
        reject(new Error("the server didn't answer"));
      }
    };
  });
  opened.catch(() => {});

  try {
    const offer = await pc.createOffer();
    // The ufrag is both sides' ICE username and password; the server reads it off our first STUN
    // check, so nothing else has to reach it first.
    const sdp = offer.sdp!.replace(/a=ice-ufrag:.*\r\n/, `a=ice-ufrag:${ufrag}\r\n`).replace(/a=ice-pwd:.*\r\n/, `a=ice-pwd:${ufrag}\r\n`);
    await pc.setLocalDescription({ type: "offer", sdp });
    await pc.setRemoteDescription({ type: "answer", sdp: serverAnswer(host, port, fingerprint, ufrag) });
    await opened;
  } catch (e) {
    pc.close();
    throw e;
  }
  dc.onclose = () => wire.onClose("connection closed");
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") wire.onClose("connection lost");
  };
  return wire;
}

/** Opens whichever of the server's addresses answers first and closes the rest: a QR code made on
 * a machine with several network interfaces can't know which one the phone can reach. */
export async function openRtcAny(hosts: string[], port: number, fingerprint: string): Promise<{ wire: Wire; host: string }> {
  let won = false;
  const tries = hosts.map((host) =>
    openRtc(host, port, fingerprint).then((wire) => {
      if (won) {
        wire.close();
        throw new Error("another address answered first");
      }
      won = true;
      return { wire, host };
    }),
  );
  try {
    return await Promise.any(tries);
  } catch (e) {
    throw e instanceof AggregateError ? e.errors[0] : e;
  }
}
