import dns from 'node:dns';
import net from 'node:net';

/**
 * SSRF guard. Every upstream media URL comes from a third party, so before we
 * connect to it we make sure it can't point at loopback, private networks,
 * link-local ranges (cloud metadata!) or other non-public addresses.
 */

function createBlockList(): net.BlockList {
  const list = new net.BlockList();
  const v4: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  for (const [address, prefix] of v4) list.addSubnet(address, prefix, 'ipv4');

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is matched by the IPv4 rules above: Node maps
  // both ways, so a ::ffff:0:0/96 rule would wrongly block every IPv4 address.
  const v6: Array<[string, number]> = [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b::', 96], // NAT64
    ['100::', 64], // discard-only
    ['2001:db8::', 32], // documentation
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['ff00::', 8], // multicast
  ];
  for (const [address, prefix] of v6) list.addSubnet(address, prefix, 'ipv6');
  return list;
}

const blocked = createBlockList();

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const ALLOWED_PORTS = new Set(['', '80', '443']);

/** Throws when a URL must not be fetched. Hostnames are additionally checked at connect time. */
export function assertSafeMediaUrl(url: URL): void {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('unsupported protocol');
  }
  if (url.username || url.password) {
    throw new Error('credentials in url');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new Error('unsupported port');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('blocked host');
  }
  // IP literals never trigger a DNS lookup, so they have to be checked here.
  if (net.isIP(host) !== 0 && !isPublicAddress(host)) {
    throw new Error('blocked address');
  }
}

/**
 * Drop-in `lookup` for undici's `connect` option. Resolves the hostname and
 * refuses to connect if ANY returned address is non-public, which also closes
 * the DNS-rebinding window between "check" and "connect".
 */
export const guardedLookup = ((
  hostname: string,
  options: dns.LookupOptions,
  callback: (...args: unknown[]) => void,
) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);

    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((entry) => !isPublicAddress(entry.address))) {
      const blockedError = Object.assign(new Error(`blocked address for ${hostname}`), {
        code: 'EBLOCKED',
      });
      return callback(blockedError);
    }

    if (options.all) return callback(null, list);
    const first = list[0]!;
    return callback(null, first.address, first.family);
  });
}) as net.LookupFunction;
