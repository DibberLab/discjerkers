'use strict';

// Single-line plain text: control, bidi-override, and zero-width characters become spaces; whitespace collapses.
const isJunk = (cp) =>
  cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) ||
  (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2069) || cp === 0xfeff;

const tidy = (v) =>
  Array.from(String(v ?? ''), (ch) => (isJunk(ch.codePointAt(0)) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

module.exports = { tidy };
