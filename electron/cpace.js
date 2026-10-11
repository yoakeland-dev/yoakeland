// CPace (CPACE-X25519-SHA512, draft-irtf-cfrg-cpace-21, initiator/responder): the password-
// authenticated key exchange behind pairing with a typed PIN. Same thing as
// yoakeland/internal/cpace, checked against the same test vectors (cpace.test.js); read that
// package's comment for what it buys. Only node:crypto, since this process ships no dependencies.
//
// ponytail: Elligator 2 runs on BigInt, which is not constant time. It runs once per attempt on a
// hash of the PIN, in the client's own process, so there is nothing to time. Same trade as the Go side.
import { createHash, createPrivateKey, createPublicKey, diffieHellman, randomBytes } from "node:crypto";

const DSI = Buffer.from("CPace255");
const DSI_ISK = Buffer.from("CPace255_ISK");
const HASH_BLOCK = 128; // SHA-512 input block, for the generator string's padding
const P = 2n ** 255n - 19n;
const A = 486662n;
const Z = 2n;

export class CPaceAbort extends Error {
  constructor() {
    super("cpace: aborted (invalid or low-order point)");
    this.name = "CPaceAbort";
  }
}

/** prepend_len: a LEB128 length, then the bytes. */
export function prependLen(bytes) {
  const out = [];
  let n = bytes.length;
  for (;;) {
    out.push(n < 128 ? n : (n & 0x7f) + 0x80);
    n = Math.floor(n / 128);
    if (n === 0) break;
  }
  return Buffer.concat([Buffer.from(out), bytes]);
}

/** lv_cat: every argument with its length in front. */
export function lvCat(...parts) {
  return Buffer.concat(parts.map((p) => prependLen(Buffer.from(p))));
}

export function generatorString(prs, ci, sid) {
  const zpad = Math.max(0, HASH_BLOCK - 1 - prependLen(prs).length - prependLen(DSI).length);
  return lvCat(DSI, prs, Buffer.alloc(zpad), ci, sid);
}

function mod(x) {
  const r = x % P;
  return r < 0n ? r + P : r;
}

function pow(base, exp) {
  let result = 1n;
  base = mod(base);
  for (; exp > 0n; exp >>= 1n) {
    if (exp & 1n) result = (result * base) % P;
    base = (base * base) % P;
  }
  return result;
}

const fromLE = (b) => [...b].reduceRight((acc, byte) => (acc << 8n) | BigInt(byte), 0n);

function toLE(x) {
  const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i++, x >>= 8n) out[i] = Number(x & 0xffn);
  return out;
}

/** Elligator 2 onto Curve25519's u coordinate (appendix A.5). */
function elligator2(r) {
  const v = mod(-A * pow(1n + Z * r * r, P - 2n));
  const t = mod(v * v * v + A * v * v + v);
  const legendre = pow(t, (P - 1n) / 2n); // 1, P-1 or 0
  const eps = legendre === 0n ? 0n : legendre === 1n ? 1n : -1n;
  return toLE(mod(eps * v - (1n - eps) * (A / 2n)));
}

export function calculateGenerator(prs, ci, sid) {
  const u = createHash("sha512").update(generatorString(prs, ci, sid)).digest().subarray(0, 32);
  u[31] &= 0x7f; // decodeUCoordinate ignores bit 255
  return elligator2(fromLE(u));
}

const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");

/** X25519, where a neutral (all zero) result or a rejected input is an abort. */
export function scalarMultVfy(scalar, point) {
  if (scalar.length !== 32 || point.length !== 32) throw new CPaceAbort();
  let out;
  try {
    out = diffieHellman({
      privateKey: createPrivateKey({ key: Buffer.concat([PKCS8_X25519, scalar]), format: "der", type: "pkcs8" }),
      publicKey: createPublicKey({ key: Buffer.concat([SPKI_X25519, point]), format: "der", type: "spki" }),
    });
  } catch {
    throw new CPaceAbort();
  }
  if (out.every((b) => b === 0)) throw new CPaceAbort();
  return out;
}

/**
 * Begins an exchange as either party: prs is the shared secret, ci the channel identifier, sid a
 * session id unique to this run, ad this party's associated data (carried in the transcript, so
 * the other side authenticates it). `scalar` is only for tests.
 */
export function start(prs, ci, sid, ad, scalar = randomBytes(32)) {
  prs = Buffer.from(prs);
  ci = Buffer.from(ci);
  sid = Buffer.from(sid);
  ad = Buffer.from(ad);
  const message = scalarMultVfy(scalar, calculateGenerator(prs, ci, sid));
  const isk = (peerMsg, ya, ada, yb, adb) => {
    const k = scalarMultVfy(scalar, peerMsg);
    const transcript = Buffer.concat([lvCat(ya, ada), lvCat(yb, adb)]);
    return createHash("sha512").update(Buffer.concat([lvCat(DSI_ISK, sid, k), transcript])).digest();
  };
  return {
    message,
    /** For the party that sent first, given the responder's share and associated data. */
    finishInitiator: (yb, adb) => isk(Buffer.from(yb), message, ad, Buffer.from(yb), Buffer.from(adb)),
    /** For the party that answered, given the initiator's share and associated data. */
    finishResponder: (ya, ada) => isk(Buffer.from(ya), Buffer.from(ya), Buffer.from(ada), message, ad),
  };
}
