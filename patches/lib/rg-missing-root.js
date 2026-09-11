'use strict';

function companyRgPathMissing(stderr, argv) {
  const separator = argv.indexOf('--');
  if (separator < 0 || separator !== argv.length - 2) return false;
  const root = argv[separator + 1];
  if (typeof root !== 'string' || !root || /[\r\n]/.test(root)) return false;
  const text = String(stderr || '').trimEnd();
  if (/[\r\n]/.test(text)) return false;
  const line = text.startsWith('rg: ') ? text.slice(4) : text;
  const prefixes = [root + ': IO error for operation on ' + root + ': ', root + ': '];
  const prefix = prefixes.find((candidate) => line.startsWith(candidate));
  if (!prefix) return false;
  const detail = line.slice(prefix.length);
  if (detail.includes('IO error')) return false;
  // Match a complete errno, not "os error 20" or incidental text in a path.
  return /^[^\r\n]+ \(os error 2\)$/.test(detail);
}

module.exports = { companyRgPathMissing };
