const MAX_ENDPOINT = 2000;
const MAX_KEY = 300;

// The server POSTs to a push endpoint, so it must name a public host: no IP literals (the URL
// parser already normalises forms like https://2130706433/ to 127.0.0.1), no localhost, no
// single-label intranet names. Any other https host is allowed.
function isPublicHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[') || host.includes(':')) return false; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  return host.includes('.');
}

export function isPushEndpoint(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_ENDPOINT) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && isPublicHost(url.hostname);
  } catch {
    return false;
  }
}

/** A push endpoint string of acceptable length (used when removing one; no host check needed). */
export const isEndpointString = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_ENDPOINT;

export const isPushKey = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY;
