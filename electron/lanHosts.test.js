import test from "node:test";
import assert from "node:assert/strict";
import { pickHosts } from "./lanHosts.js";

const ip = (address, extra = {}) => ({ family: "IPv4", internal: false, address, ...extra });

test("keeps what a phone can reach, default route first, containers and link-local out", () => {
  const got = pickHosts(
    {
      lo: [ip("127.0.0.1", { internal: true })],
      docker0: [ip("172.17.0.1")],
      virbr0: [ip("192.168.122.1")],
      tailscale0: [ip("100.101.2.3")],
      wlan0: [ip("192.168.1.20"), ip("169.254.9.9")],
      eth0: [ip("10.0.0.5"), { family: "IPv6", address: "fe80::1", internal: false }],
      weird0: [ip("8.8.4.4")],
    },
    "10.0.0.5",
  );
  assert.deepEqual(got, ["10.0.0.5", "192.168.1.20", "100.101.2.3"]);
});

test("caps the list at three", () => {
  const many = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`eth${n}`, [ip(`192.168.${n}.2`)]]));
  assert.equal(pickHosts(many).length, 3);
});
