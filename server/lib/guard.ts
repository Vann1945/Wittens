import dns from 'node:dns';
import net from 'node:net';

/**
 * Network safety guard for outbound requests.
 * Blocks loopback, private networks, link-local ranges, cloud metadata endpoints,
 * and other non-public IP addresses before and during DNS resolution.
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

  const v6: Array<[string, number]> = [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
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

/** Validates that a URL points only to a standard public HTTP(S) destination. */
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
  if (net.isIP(host) !== 0 && !isPublicAddress(host)) {
    throw new Error('blocked address');
  }
}

/**
 * Custom DNS lookup for undici's `connect` option.
 * Rejects connections if any resolved IP address is non-public.
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
