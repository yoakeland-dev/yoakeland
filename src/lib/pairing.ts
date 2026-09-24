// Bundles a remote-connect token with the server's CA cert into one copy/paste: a token alone is
// only as trustworthy as the TLS connection carrying it, and the CA lets the client verify that.
import { bytesToBase64, base64ToBytes } from "./base64";

export interface PairingCode {
  token: string;
  caPem?: string;
}

export function encodePairingCode(token: string, caPem?: string): string {
  const json = JSON.stringify(caPem ? { t: token, ca: caPem } : { t: token });
  return bytesToBase64(new TextEncoder().encode(json));
}

export function decodePairingCode(code: string): PairingCode | null {
  try {
    const json = new TextDecoder().decode(base64ToBytes(code.trim()));
    const parsed = JSON.parse(json);
    if (typeof parsed.t !== "string" || !parsed.t) return null;
    return { token: parsed.t, caPem: typeof parsed.ca === "string" ? parsed.ca : undefined };
  } catch {
    return null;
  }
}
