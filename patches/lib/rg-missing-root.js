'use strict';

function companyRgPathMissing(stderr, argv) {
  const separator = argv.indexOf('--');
  if (separator < 0 || separator !== argv.length - 2) return false;
  const root = argv[separator + 1];
  if (typeof root !== 'string' || !root || /[\r\n]/.test(root)) return false;
  const text = String(stderr || '').trimEnd();
  if (/[\r\n]/.test(text)) return false;
  const prefix = root + ': IO error for operation on ' + root + ': ';
  const line = text.startsWith('rg: ') ? text.slice(4) : text;
  if (!line.startsWith(prefix)) return false;
  // Match a complete errno, not "os error 20" or incidental text in a path.
  return /^[^\r\n]+ \(os error 2\)$/.test(line.slice(prefix.length));
}

module.exports = { companyRgPathMissing };
