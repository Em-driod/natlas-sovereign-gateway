import { BlockList, isIPv4, isIPv6 } from "node:net";

/**
 * Which reverse proxies may tell us the client's IP via X-Forwarded-For.
 *
 * Fastify walks the chain from the socket backwards and stops at the first
 * untrusted address, which becomes req.ip. We trust:
 *  - the first `hops` addresses (explicit hop count, TRUST_PROXY_HOPS), and
 *  - addresses in private/loopback ranges and Cloudflare's published edge ranges,
 *    which covers hosts like Render (client → Cloudflare → internal LB → app).
 * Entries a client injects sit to the left of the address Cloudflare recorded,
 * so they are never reached: the client's real IP is what counts.
 */
const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];
const PRIVATE_V4 = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10"];
const PRIVATE_V6 = ["::1/128", "fc00::/7", "fe80::/10"];

function build(): BlockList {
  const list = new BlockList();
  for (const c of [...CLOUDFLARE_V4, ...PRIVATE_V4]) {
    const [net, bits] = c.split("/");
    list.addSubnet(net!, Number(bits), "ipv4");
  }
  for (const c of [...CLOUDFLARE_V6, ...PRIVATE_V6]) {
    const [net, bits] = c.split("/");
    list.addSubnet(net!, Number(bits), "ipv6");
  }
  return list;
}

const KNOWN_PROXIES = build();

export function isKnownProxy(addr: string): boolean {
  const a = addr.startsWith("::ffff:") ? addr.slice(7) : addr;
  if (isIPv4(a)) return KNOWN_PROXIES.check(a, "ipv4");
  if (isIPv6(a)) return KNOWN_PROXIES.check(a, "ipv6");
  return false;
}

/** Fastify `trustProxy` function, or false when no proxy is in front (local runs). */
export function trustProxyFn(hops: number): false | ((addr: string, hop: number) => boolean) {
  if (hops <= 0) return false;
  return (addr, hop) => hop < hops || isKnownProxy(addr);
}
