'use strict';

// Small things every route that knows who you are needs.

const SESSION_COOKIE = 'dj_session';

// nginx sets X-Real-IP from the Cloudflare-restored client address; a visitor can't forge it.
const who = (req) => req.get('x-real-ip') || req.ip || 'unknown';

function cookieOf(req, name) {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

// A browser sending a cross-site request names the site it came from. Ours must match the host it asked for.
function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.get('x-forwarded-host') || req.get('host'));
  } catch {
    return false;
  }
}

module.exports = { SESSION_COOKIE, who, cookieOf, sameOrigin };
