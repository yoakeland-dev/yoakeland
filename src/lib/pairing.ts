// Bundles a remote-connect token with the server's CA cert into one copy/paste: a token alone is
// only as trustworthy as the TLS connection carrying it, and the CA lets the client verify that.
import { bytesToBase64, base64ToBytes } from "./base64.ts";

export interface PairingCode {
  token: string;
  caPem?: string;
  /** Where the server is, when the code is opened on a page that isn't served by that server. */
  host?: string;
  port?: number;
  /** The server's DTLS certificate fingerprint: what a WebRTC connection pins (rtc.ts). */
  rtcFp?: string;
}

export function encodePairingCode(token: string, caPem?: string, where?: { host: string; port: number; rtcFp: string }): string {
  const json = JSON.stringify({ t: token, ...(caPem ? { ca: caPem } : {}), ...(where ? { h: where.host, p: where.port, fp: where.rtcFp } : {}) });
  return bytesToBase64(new TextEncoder().encode(json));
}

export function decodePairingCode(code: string): PairingCode | null {
  try {
    const json = new TextDecoder().decode(base64ToBytes(code.trim()));
    const parsed = JSON.parse(json);
    if (typeof parsed.t !== "string" || !parsed.t) return null;
    // A code from the server's console has the fingerprint but not an address; a QR code has both.
    const where = typeof parsed.h === "string" && Number.isInteger(parsed.p);
    return {
      token: parsed.t,
      caPem: typeof parsed.ca === "string" ? parsed.ca : undefined,
      host: where ? parsed.h : undefined,
      port: where ? parsed.p : undefined,
      rtcFp: typeof parsed.fp === "string" ? parsed.fp : undefined,
    };
  } catch {
    return null;
  }
}

/** The hosted web client: static files, no server of ours behind it. With a fingerprint the QR
 * code opens it with the server's address and fingerprint, and the page connects straight to the
 * server over WebRTC, so the phone doesn't have to trust anything. */
export const HOSTED_APP_URL = "https://app.yoake.land";

/** What the QR code on the desktop encodes. Everything rides in the fragment, so it never reaches
 * any server or its logs. Without a fingerprint (an older server) it opens the server's own page,
 * which the phone must trust the server's CA to load. */
export function pairingUrl(host: string, port: number, token: string, rtcFp?: string, appUrl = HOSTED_APP_URL): string {
  if (rtcFp) return `${appUrl}/#pair=${encodePairingCode(token, undefined, { host, port, rtcFp })}`;
  return `https://${host}:${port}/#pair=${encodePairingCode(token)}`;
}
