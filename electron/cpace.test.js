// Run with: node --test electron/
// Every expected value is copied from draft-irtf-cfrg-cpace-21, appendices A and B.1: the same
// vectors yoakeland/internal/cpace is checked against, so the two sides agree because the draft says so.
import assert from "node:assert/strict";
import test from "node:test";
import { CPaceAbort, calculateGenerator, generatorString, lvCat, prependLen, scalarMultVfy, start } from "./cpace.js";

const hex = (s) => Buffer.from(s.replace(/\s+/g, ""), "hex");
const PRS = Buffer.from("Password");
const CI = Buffer.from("\x0bA_initiator\x0bB_responder", "latin1");
const SID = hex("7e4b4791d6a8ef019b936c79fb7f2c57");
const VEC = {
  g: "d04bf6d41f6a289632a2e929fa29bebd51092512a7829fdde7d314b62f05a73f",
  ya: "1d13c89278cdadd826f6d8d7f887701430f8380ddc17611cdd6dc989ce0c9f32",
  yb: "248cccf6d5cdc3646f0ad593f9e6cef4e69d4945f8372e623512ecea32185623",
  yaScalar: "21b4f4bd9e64ed355c3eb676a28ebedaf6d8f17bdc365995b319097153044080",
  ybScalar: "848b0779ff415f0af4ea14df9dd1d3c29ac41d836c7808896c4eba19c51ac40a",
  k: "5b067effbdc0b2a0e1d907b21ebb25cfedb96a852179a847c37e43ee71322c6b",
  isk:
    "6e19b875f7a561d6b3ca3dbb9ef42ac55de3e717881018204b8922b4d5e53bb2" +
    "aa82c300bea7b65d2b671da71922ddf6472301b79bc270adfa8bf413285f2263",
};

test("string utilities", () => {
  assert.equal(prependLen(Buffer.alloc(0)).toString("hex"), "00");
  assert.equal(lvCat("1234", "5", "", "678").toString("hex"), "043132333401350003363738");
  const long = prependLen(Buffer.alloc(200));
  assert.deepEqual([long[0], long[1], long.length], [0xc8, 0x01, 202]);
});

test("generator string and generator match the draft", () => {
  assert.equal(
    generatorString(PRS, CI, SID).toString("hex"),
    "0843506163653235350850617373776f72646d000000000000000000" +
      "00000000000000000000000000000000000000000000000000000000" +
      "00000000000000000000000000000000000000000000000000000000" +
      "00000000000000000000000000000000000000000000000000000000" +
      "00000000000000000000000000000000180b415f696e69746961746f" +
      "720b425f726573706f6e646572107e4b4791d6a8ef019b936c79fb7f" +
      "2c57",
  );
  assert.equal(calculateGenerator(PRS, CI, SID).toString("hex"), VEC.g);
});

test("messages, shared point and ISK match the draft", () => {
  const a = start(PRS, CI, SID, "ADa", hex(VEC.yaScalar));
  const b = start(PRS, CI, SID, "ADb", hex(VEC.ybScalar));
  assert.equal(a.message.toString("hex"), VEC.ya);
  assert.equal(b.message.toString("hex"), VEC.yb);
  assert.equal(scalarMultVfy(hex(VEC.yaScalar), hex(VEC.yb)).toString("hex"), VEC.k);
  assert.equal(scalarMultVfy(hex(VEC.ybScalar), hex(VEC.ya)).toString("hex"), VEC.k);
  const iskA = a.finishInitiator(b.message, "ADb");
  const iskB = b.finishResponder(a.message, "ADa");
  assert.equal(iskA.toString("hex"), VEC.isk);
  assert.deepEqual(iskA, iskB);
});

test("low-order points abort and the rest match the draft (B.1.10)", () => {
  const s = hex("af46e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449aff");
  const cases = [
    ["0000000000000000000000000000000000000000000000000000000000000000", null],
    ["0100000000000000000000000000000000000000000000000000000000000000", null],
    ["ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", null],
    ["e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800", null],
    ["5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157", null],
    ["edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", null],
    ["daffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "d8e2c776bbacd510d09fd9278b7edcd25fc5ae9adfba3b6e040e8d3b71b21806"],
    ["eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", null],
    ["dbffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "c85c655ebe8be44ba9c0ffde69f2fe10194458d137f09bbff725ce58803cdb38"],
    ["d9ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "db64dafa9b8fdd136914e61461935fe92aa372cb056314e1231bc4ec12417456"],
    ["cdeb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b880", "e062dcd5376d58297be2618c7498f55baa07d7e03184e8aada20bca28888bf7a"],
    ["4c9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f11d7", "993c6ad11c4c29da9a56f7691fd0ff8d732e49de6250b6c2e80003ff4629a175"],
  ];
  cases.forEach(([u, q], i) => {
    if (q === null) assert.throws(() => scalarMultVfy(s, hex(u)), CPaceAbort, `u${i.toString(16)}`);
    else assert.equal(scalarMultVfy(s, hex(u)).toString("hex"), q, `u${i.toString(16)}`);
  });
});

test("a weak share stops the exchange from either side", () => {
  const a = start("12345678", "", Buffer.alloc(16), "");
  const b = start("12345678", "", Buffer.alloc(16), "");
  for (const weak of [Buffer.alloc(32), Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]), Buffer.alloc(31), Buffer.alloc(0)]) {
    assert.throws(() => a.finishInitiator(weak, ""), CPaceAbort);
    assert.throws(() => b.finishResponder(weak, ""), CPaceAbort);
  }
});

test("both sides agree only when the PIN, channel and associated data match", () => {
  const sid = Buffer.from("0123456789abcdef");
  const run = (prsA, prsB, ciA, ciB, adaSeen, adbSeen) => {
    const a = start(prsA, ciA, sid, "ada");
    const b = start(prsB, ciB, sid, "adb");
    return [a.finishInitiator(b.message, adbSeen), b.finishResponder(a.message, adaSeen)];
  };
  const [x, y] = run("48217733", "48217733", "ci", "ci", "ada", "adb");
  assert.deepEqual(x, y);
  assert.equal(x.length, 64);
  for (const [name, [p, q]] of Object.entries({
    "wrong PIN": run("48217733", "48217734", "ci", "ci", "ada", "adb"),
    "different channel": run("48217733", "48217733", "ci", "other", "ada", "adb"),
    "tampered initiator AD": run("48217733", "48217733", "ci", "ci", "evil", "adb"),
    "tampered responder AD": run("48217733", "48217733", "ci", "ci", "ada", "evil"),
  })) {
    assert.notDeepEqual(p, q, name);
  }
});

// The two implementations in one process pair: Go's output for the draft's inputs is checked in
// cpace_test.go; this only guards the JS side against drifting from the vectors above if someone
// edits one test and not the other.
test("the JS and Go test files carry the same ISK vector", async () => {
  const { readFile } = await import("node:fs/promises");
  const go = await readFile(new URL("../../yoakeland/internal/cpace/cpace_test.go", import.meta.url), "utf8").catch(() => null);
  if (go === null) return; // the Go tree isn't next to this one
  assert.ok(go.includes(VEC.isk.slice(0, 64)) && go.includes(VEC.isk.slice(64)));
});
