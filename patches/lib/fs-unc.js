'use strict';

function companyFsIsUnc(p) {
  if (typeof p !== 'string') return false;
  let value = p.replace(/\//g, '\\');
  if (/^\\\\\?\\UNC\\/i.test(value)) value = '\\\\' + value.slice(8);
  // Require both server and share. Local extended paths and device namespaces
  // are not UNC shares, even though they also begin with two backslashes.
  const match = value.match(/^\\\\([^\\]+)\\([^\\]+)(?:\\|$)/);
  return !!match && match[1] !== '?' && match[1] !== '.';
}

module.exports = { companyFsIsUnc };
