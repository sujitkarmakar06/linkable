import { BlockList, isIPv4, isIPv6 } from "node:net";

// True for any address that isn't safely public: loopback, private, link-local,
// CGNAT, multicast, documentation, and IPv6 forms that embed an IPv4 address
// (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::/96 NAT64), which are unwrapped first.

const v4 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const)
  v4.addSubnet(net, bits, "ipv4");

const v6 = new BlockList();
for (const [net, bits] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["2001:db8::", 32], ["100::", 64],
] as const)
  v6.addSubnet(net, bits, "ipv6");

// Expand an IPv6 address to 8 numeric groups (handles :: and a trailing dotted IPv4).
function groups(addr: string): number[] | null {
  let a = addr.toLowerCase();
  const dotted = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (!isIPv4(dotted[1])) return null;
    const p = dotted[1].split(".").map(Number);
    a = a.slice(0, -dotted[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [head, tail] = a.split("::");
  if (a.split("::").length > 2) return null;
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  if (fill < 0) return null;
  const all = [...h, ...Array(fill).fill("0"), ...t];
  if (all.length !== 8) return null;
  const nums = all.map((g) => parseInt(g, 16));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
}

const toV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

export function isPrivateIp(input: string): boolean {
  const ip = input.replace(/^\[|\]$/g, "").split("%")[0]; // brackets and zone ids
  if (isIPv4(ip)) return v4.check(ip, "ipv4");
  if (!isIPv6(ip)) return true; // not an IP we understand: refuse
  const g = groups(ip);
  if (!g) return true;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::a.b.c.d (NAT64)
  if (zeros(5) && g[5] === 0xffff) return isPrivateIp(toV4(g[6], g[7]));
  if (zeros(6) && (g[6] !== 0 || g[7] > 1)) return isPrivateIp(toV4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIp(toV4(g[6], g[7]));
  return v6.check(ip, "ipv6");
}
