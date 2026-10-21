// Finds exfiltration sinks in a tool's inputSchema: a default, const, enum or example value that is a network URL, a
// protocol-relative URL ('//host/x') or an email address, or a 'pattern' that embeds an absolute URL, whose host is not
// the approved origin's host. Keywords are recognised by SCHEMA position, so a property merely NAMED 'default' is walked
// as a property. Used by the pinned client and by the offline victim. Still not caught: see SINK_LIMITS in pinning.js.

const URL_VALUE = /^(?:https?|wss?|ftp):\/\/([^\s/?#]+)/i;
const REL_VALUE = /^\/\/([^\s/?#]+)/;
const EMBEDDED_URL = /(?:https?|wss?|ftp):\/\/([^\s/?#()|$\[\]^]+)/i;
const EMAIL_VALUE = /^[^\s@]+@([^\s@]+)$/;

export function hostOfValue(value) {
  if (typeof value !== 'string') return null;
  const u = URL_VALUE.exec(value.trim());
  if (u) return u[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase();
  const r = REL_VALUE.exec(value.trim());
  if (r) return r[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase();
  const e = EMAIL_VALUE.exec(value.trim());
  return e ? e[1].toLowerCase() : null;
}

export function originHost(origin) {
  try { return new URL(origin).hostname.toLowerCase(); } catch { return String(origin || '').toLowerCase(); }
}

// Schema keywords whose value is a map of name -> subschema (the names are NOT keywords).
const NAME_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

// A regex 'pattern' that embeds an absolute URL: backslash escapes are removed first (https:\/\/evil\.test).
export function hostOfPattern(pattern) {
  if (typeof pattern !== 'string') return null;
  const m = EMBEDDED_URL.exec(pattern.replace(/\\(.)/g, '$1'));
  return m ? m[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase() : null;
}

// [{ path, value, host }] for every candidate value in the schema pointing away from `origin`.
export function findSinks(schema, origin) {
  const own = originHost(origin);
  const out = [];
  const check = (v, path, hostOf = hostOfValue) => {
    const host = hostOf(v);
    if (host && host !== own) out.push({ path, value: v, host });
  };
  const visit = (node, path) => {
    if (Array.isArray(node)) { node.forEach((n, i) => visit(n, `${path}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const here = path ? `${path}.${k}` : k;
      if (k === 'default' || k === 'const') check(v, here);
      else if (k === 'enum' || k === 'examples') (Array.isArray(v) ? v : []).forEach((x, i) => check(x, `${here}[${i}]`));
      else if (k === 'pattern') check(v, here, hostOfPattern);
      else if (NAME_MAPS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [name, sub] of Object.entries(v)) visit(sub, `${here}.${name}`);
      } else visit(v, here);
    }
  };
  visit(schema, '');
  return out;
}
