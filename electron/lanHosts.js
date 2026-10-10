// The addresses a phone on the same network could reach this machine at, best first: private IPv4
// ones with the one the default route leaves by on top, then carrier-grade NAT ones (Tailscale).
// Containers, VMs, loopback and link-local are left out. Mirrors lanIPv4s in the server.
import dgram from "node:dgram";
import os from "node:os";

const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|vboxnet|vmnet|cni|flannel|lxc|lxd|podman)/;

/** The address the default route would send from; "" if there is none. Nothing is sent. */
function defaultRouteAddress() {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    sock.once("error", () => resolve(""));
    sock.connect(9, "192.0.2.1", () => {
      const a = sock.address().address;
      sock.close();
      resolve(a);
    });
  });
}

export function pickHosts(interfaces, defaultSrc = "") {
  const lan = [];
  const shared = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (VIRTUAL_IFACE.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      const [x, y] = a.address.split(".").map(Number);
      if (x === 10 || (x === 172 && y >= 16 && y < 32) || (x === 192 && y === 168)) lan.push(a.address);
      else if (x === 100 && y >= 64 && y < 128) shared.push(a.address);
    }
  }
  lan.sort((a, b) => (b === defaultSrc) - (a === defaultSrc));
  return [...lan, ...shared].slice(0, 3);
}

export async function lanHosts() {
  return pickHosts(os.networkInterfaces(), await defaultRouteAddress());
}
