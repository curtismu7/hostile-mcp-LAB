// Safety rules for a deliberately hostile server. Pure functions, no I/O.
//  1. Bind loopback only, unless HOSTILE_BIND is set.
//  2. Every host named in any payload is a reserved, non-resolvable name (RFC 2606 / RFC 6761): the .invalid TLD, the
//     .example TLD, or example.com / example.net / example.org. No real host, no IP address.
import { POISON_PROMPTS, POISONS, POISON_RESOURCES } from './poisons.js';
import { ACTION_TOOLS, READ_TICKET, callResultText, rugPullTool } from './mcp/tools.js';

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export function bindHost(env = process.env) { return env.HOSTILE_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.HOSTILE_BIND) return host;
  throw new Error(`refusing to bind ${host}: this server serves hostile payloads and listens on loopback only. Set HOSTILE_BIND to opt in.`);
}

export function isReservedHost(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return /(^|\.)(invalid|example)$/.test(h) || /(^|\.)example\.(com|net|org)$/.test(h);
}

const NETWORK_URL = /\b(?:https?|wss?|ftp|sftp|ssh|smtp|tcp|udp):\/\/([^\s/?#"'<>\\]+)/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;

function stripAuthority(authority) {
  return authority.replace(/^[^@]*@/, '').replace(/:\d+$/, '');
}

// Every hostname or IP found in `text` that is not a reserved name. Empty array = clean.
export function scanHosts(text) {
  const found = new Set();
  const s = String(text);
  for (const m of s.matchAll(NETWORK_URL)) found.add(stripAuthority(m[1]).toLowerCase());
  for (const m of s.matchAll(EMAIL)) found.add(m[1].toLowerCase());
  for (const m of s.matchAll(IPV4)) found.add(m[0]);
  for (const m of s.matchAll(BARE_DOMAIN)) found.add(m[0].toLowerCase());
  return [...found].filter((h) => !isReservedHost(h)).sort();
}

// Every payload string the server can put on the wire: both rug-pull states, resources, prompts, every call result.
export function payloadCorpus() {
  const tools = [...POISONS.map((p) => p.tool), READ_TICKET, rugPullTool(1), rugPullTool(2), ...ACTION_TOOLS];
  const results = [...tools.map((t) => callResultText(t.name, { amount: 1, to: 'external-001', user: 'u', ticket_id: 'T-1' }))];
  return [
    ...tools.map((t) => ({ where: `tool ${t.name}`, text: JSON.stringify(t) })),
    ...POISON_RESOURCES.map((r) => ({ where: `resource ${r.id}`, text: JSON.stringify(r) })),
    ...POISON_PROMPTS.map((p) => ({ where: `prompt ${p.id}`, text: JSON.stringify(p) })),
    ...results.map((text, i) => ({ where: `call result ${i}`, text })),
  ];
}

// [{ where, hosts }] for every payload that names a non-reserved host. Empty array = safe.
export function scanPayloads(corpus = payloadCorpus()) {
  return corpus.map(({ where, text }) => ({ where, hosts: scanHosts(text) })).filter((x) => x.hosts.length);
}
