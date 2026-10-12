// Security headers on every response.
//
// The Content Security Policy tells the browser what this page is allowed to load and run:
// only our own scripts, our own API and live connection, images and media from us or made in
// the page (blob:, data:), and only the CRM (and the chat itself) may put the chat inside a
// frame. Calls need the microphone and screen capture, so those are allowed for this site
// only; the camera and location are switched off.

/** The pages allowed to show the chat in a frame: the chat itself and the CRM. */
export const DEFAULT_FRAME_ANCESTORS = ['https://crm.rowanroseclaims.co.uk', 'https://rowanroseclaims.co.uk'];

const cspFor = (frameAncestors) =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // React sets inline style attributes
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors 'self'${frameAncestors.map((o) => ` ${o}`).join('')}`,
  ].join('; ');

/**
 * The headers middleware for the given frame ancestors (the CRM's addresses by default). There
 * is no X-Frame-Options: it cannot name another site, and every browser the firm uses reads
 * the frame-ancestors rule instead.
 */
export function createSecurityHeaders(frameAncestors = DEFAULT_FRAME_ANCESTORS) {
  const csp = cspFor(frameAncestors);
  return function securityHeaders(_req, res, next) {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self), display-capture=(self)');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export const securityHeaders = createSecurityHeaders();
export const CONTENT_SECURITY_POLICY = cspFor(DEFAULT_FRAME_ANCESTORS);
