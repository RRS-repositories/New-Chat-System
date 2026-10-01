// Per-person IP address restriction: the pure parts.
//
// A manager can limit a person to certain addresses in the CRM's permission editor
// (users.ip_restriction, a list of single addresses and CIDR ranges). The CRM enforces it;
// the chat accepts the same sign-in token, so it must enforce it too, or a restricted person
// could still use chat from anywhere. The rules here match the CRM's lib/ip-restriction.js.
import net from 'node:net';

/** One saved entry as { address, prefix, family }, or null when it is not an address or range. */
export function parseIpEntry(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split('/');
  if (parts.length > 2) return null;
  const address = parts[0].replace(/^::ffff:/i, '');
  const version = net.isIP(address);
  if (!version) return null;
  const max = version === 4 ? 32 : 128;
  const family = version === 4 ? 'ipv4' : 'ipv6';
  if (parts.length === 1) return { address, prefix: max, family };
  if (!/^\d{1,3}$/.test(parts[1])) return null;
  const prefix = Number(parts[1]);
  return prefix > max ? null : { address, prefix, family };
}

/**
 * Whether this list lets this address in.
 * An empty list, or a list with no usable entry, restricts nothing (never "deny everyone").
 */
export function ipAllowedBy(list, ip) {
  if (!Array.isArray(list) || list.length === 0) return true;
  const entries = list.map(parseIpEntry).filter(Boolean);
  if (entries.length === 0) return true;
  const version = net.isIP(ip || '');
  if (!version) return false;
  const allow = new net.BlockList();
  for (const e of entries) allow.addSubnet(e.address, e.prefix, e.family);
  return allow.check(ip, version === 4 ? 'ipv4' : 'ipv6');
}

/**
 * The address an access decision is made on: Cloudflare's own header, else the connection's address.
 * The x-forwarded-for chain is not used: a caller can add to it.
 */
export function accessIp(headers, connectionAddress) {
  const header = headers?.['cf-connecting-ip'];
  const fromCloudflare =
    typeof header === 'string'
      ? header
          .split(',')[0]
          .trim()
          .replace(/^::ffff:/i, '')
      : '';
  if (net.isIP(fromCloudflare)) return fromCloudflare;
  const direct = typeof connectionAddress === 'string' ? connectionAddress.trim().replace(/^::ffff:/i, '') : '';
  return net.isIP(direct) ? direct : '';
}
