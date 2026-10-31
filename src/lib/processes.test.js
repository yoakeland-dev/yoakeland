// @ts-nocheck: run by node --test, which needs the .ts import extension.
import assert from "node:assert/strict";
import test from "node:test";
import { treeRows, withCpu } from "./processes.ts";

const p = (pid, ppid, cpuTimeMs = 0) => ({ pid, ppid, startTimeMs: 1, name: `p${pid}`, status: "S", cpuTimeMs, rssBytes: 1 });

test("tree order, depth and collapse", () => {
  const list = { sampledAtMs: 0, processes: [p(1, 0), p(2, 1), p(3, 2), p(4, 1)] };
  assert.deepEqual(treeRows(list).map((r) => [r.pid, r.depth]), [[1, 0], [2, 1], [3, 2], [4, 1]]);
  assert.deepEqual(treeRows(list, new Set(["2:1"])).map((r) => r.pid), [1, 2, 4]);
});

test("cpu percent from two samples", () => {
  const a = { sampledAtMs: 1000, processes: [p(1, 0, 100)] };
  const b = { sampledAtMs: 3000, processes: [p(1, 0, 1100), p(2, 1, 50)] };
  const r = withCpu(a, b).processes;
  assert.equal(r[0].cpuPercent, 50);
  assert.equal(r[1].cpuPercent, 0); // new process: no baseline
});
