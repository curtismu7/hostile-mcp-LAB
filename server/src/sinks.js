// Finds exfiltration sinks in a tool's inputSchema: a default, const, enum or example value that is a network URL, a
// protocol-relative URL ('//host/x') or an email address, or a 'pattern' that embeds an absolute URL, whose host is not
// the approved origin's host. Keywords are recognised by SCHEMA position, so a property merely NAMED 'default' is walked
// as a property. Used by the pinned client and by the offline victim. Still not caught: see SINK_LIMITS in pinning.js.

const URL_VALUE = /^(?:https?|wss?|ftp):\/\/([^\s/?#]+)/i;
const REL_VALUE = /^\/\/([^\s/?#]+)/;
const EMBEDDED_URL = /(?:https?|wss?|ftp):\/\/([^\s/?#()|$\[\]^]+)/i;
const EMAIL_VALUE = /^[^\s@]+@([^\s@]+)$/;

// Invisible characters that can hide in front of, or inside, a URL: format characters (zero-width, bidi, BOM, soft hyphen,
// tag characters), other control characters (not tab/newline), variation selectors and the blank Hangul fillers.
const INVISIBLE = /[\p{Cf}\u0000-\u0008\u000E-\u001F\u007F-\u009F\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180D\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/gu;
// Full stops a URL parser treats as '.', which NFKC leaves alone (U+3002, U+FF61); NFKC itself folds fullwidth forms.
const DOTS = /[\u3002\uFF61]/g;

// The value with invisible characters removed and compatibility forms folded (NFKC), plus whether any were removed.
export function normalise(value) {
  const stripped = value.replace(INVISIBLE, '');
  return { text: stripped.normalize('NFKC').replace(DOTS, '.'), invisible: stripped.length !== value.length };
}

const hostFrom = (h) => h.replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase();

// { host, invisible } for a candidate value; host is null when it is not a URL/email. `invisible` is true when the value
// contained invisible characters, which is itself part of the finding.
export function inspectValue(value) {
  if (typeof value !== 'string') return { host: null, invisible: false };
  const { text, invisible } = normalise(value);
  const t = text.trim();
  const u = URL_VALUE.exec(t) || REL_VALUE.exec(t);
  if (u) return { host: hostFrom(u[1]), invisible };
  const e = EMAIL_VALUE.exec(t);
  return { host: e ? e[1].toLowerCase() : null, invisible };
}

export function hostOfValue(value) {
  return inspectValue(value).host;
}

export function originHost(origin) {
  try { return new URL(origin).hostname.toLowerCase(); } catch { return String(origin || '').toLowerCase(); }
}

// Schema keywords whose value is a map of name -> subschema (the names are NOT keywords).
const NAME_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

// A regex 'pattern' that embeds an absolute URL: backslash escapes are removed first (https:\/\/evil\.test).
export function inspectPattern(pattern) {
  if (typeof pattern !== 'string') return { host: null, invisible: false };
  const { text, invisible } = normalise(pattern);
  const m = EMBEDDED_URL.exec(text.replace(/\\(.)/g, '$1'));
  return { host: m ? hostFrom(m[1]) : null, invisible };
}

export function hostOfPattern(pattern) {
  return inspectPattern(pattern).host;
}

// The walk is bounded so a hostile schema cannot exhaust the stack or the CPU: past either budget the scan stops and
// reports `truncated` instead of throwing. Real tool schemas are far below both.
export const SCAN_MAX_DEPTH = 100;
export const SCAN_MAX_NODES = 20000;

// { sinks: [{ path, value, host, invisible? }], truncated } for every candidate value pointing away from `origin`.
export function scanSinks(schema, origin) {
  const own = originHost(origin);
  const sinks = [];
  let truncated = false;
  let nodes = 0;
  const check = (v, path, inspect = inspectValue) => {
    const { host, invisible } = inspect(v);
    if (host && host !== own) sinks.push({ path, value: v, host, ...(invisible && { invisible: true }) });
  };
  // Iterative depth-first walk (explicit stack, children pushed in reverse so output order matches a recursive walk).
  const stack = [[schema, '', 0]];
  while (stack.length) {
    const [node, path, depth] = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (depth > SCAN_MAX_DEPTH || ++nodes > SCAN_MAX_NODES) { truncated = true; continue; }
    const kids = [];
    if (Array.isArray(node)) {
      node.forEach((n, i) => kids.push([n, `${path}[${i}]`, depth + 1]));
    } else {
      for (const [k, v] of Object.entries(node)) {
        const here = path ? `${path}.${k}` : k;
        if (k === 'default' || k === 'const') check(v, here);
        else if (k === 'enum' || k === 'examples') (Array.isArray(v) ? v : []).forEach((x, i) => check(x, `${here}[${i}]`));
        else if (k === 'pattern') check(v, here, inspectPattern);
        else if (NAME_MAPS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
          for (const [name, sub] of Object.entries(v)) kids.push([sub, `${here}.${name}`, depth + 1]);
        } else kids.push([v, here, depth + 1]);
      }
    }
    // Sinks found above were pushed in order; children are visited after, deepest-first reversed to keep document order.
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return { sinks, truncated };
}

export const findSinks = (schema, origin) => scanSinks(schema, origin).sinks;
