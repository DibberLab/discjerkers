'use strict';

// The home page, with the logo's address stamped with a hash of the file, so replacing
// public/img/disc-jerkers-logo.png (on GitHub, say) shows up at once instead of sitting
// behind a cached copy. Worked out once at startup; every deploy restarts the container.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LOGO = 'img/disc-jerkers-logo.png';

function homepageHtml(publicDir) {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  let v;
  try {
    v = crypto.createHash('sha1').update(fs.readFileSync(path.join(publicDir, LOGO))).digest('hex').slice(0, 10);
  } catch {
    return html; // no logo file: serve the page as it is
  }
  return html.replace(/\/img\/disc-jerkers-logo\.png(\?v=[\w-]*)?/g, `/${LOGO}?v=${v}`);
}

module.exports = { homepageHtml, LOGO };
