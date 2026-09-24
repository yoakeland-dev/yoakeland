// Terminal I/O is raw bytes over the wire, base64-encoded (SPEC.md §3.1
// terminal_input, §3.2 terminal_snapshot/terminal_output) rather than a plain
// JSON string, since a pty's output isn't guaranteed to be valid UTF-8.
// btoa/atob is chunked because `String.fromCharCode(...bytes)` blows the call
// stack on a large-enough scrollback dump.
const CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
