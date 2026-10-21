// Pinned client: trust on first use for MCP tool metadata.
//
// approve(tools)  records, per tool, sha256(canonical({name, description, inputSchema})) and the approved definition.
// check(tools)    compares a later list against the pins and returns a verdict per tool:
//   ok               same hash as approved
//   changed          same name and origin, different hash (the rug-pull); the field diff is included
//   shadowed         the name is pinned from a different origin (another server or session)
//   new-unapproved   never approved
//   off-origin-sink  the tool is new or changed AND carries a default/const/enum/example URL or email whose host is not
//                    the approved origin's host (an added exfiltration sink)
// `verdict` is the most severe finding (shadowed > off-origin-sink > changed > new-unapproved > ok); `findings` has all.
//
// What this does NOT do is judge content: it only notices change. See LIMITS.
import { createHash } from 'node:crypto';
import { SCAN_MAX_DEPTH, scanSinks } from './sinks.js';

// Canonical JSON: sorted keys at every depth. `required` is a set in JSON Schema, so a string array under that key is
// sorted too: re-ordering it is not a change of meaning. Other arrays keep their order. Built with an explicit stack, so
// a schema nested thousands of levels deep hashes instead of overflowing the call stack.
export function canonicalString(value) {
  const out = [];
  const stack = [[value, undefined]];
  while (stack.length) {
    const [v, key] = stack.pop();
    if (typeof v === 'string' && key === RAW) { out.push(v); continue; }
    if (Array.isArray(v)) {
      const items = key === 'required' && v.every((i) => typeof i === 'string') ? [...v].sort() : v;
      stack.push([']', RAW]);
      for (let i = items.length - 1; i >= 0; i--) { stack.push([items[i], undefined]); if (i) stack.push([',', RAW]); }
      stack.push(['[', RAW]);
    } else if (v && typeof v === 'object') {
      const keys = Object.keys(v).sort().filter((k) => v[k] !== undefined && typeof v[k] !== 'function' && typeof v[k] !== 'symbol');
      stack.push(['}', RAW]);
      for (let i = keys.length - 1; i >= 0; i--) { stack.push([v[keys[i]], keys[i]]); stack.push([`${i ? ',' : ''}${JSON.stringify(keys[i])}:`, RAW]); }
      stack.push(['{', RAW]);
    } else out.push(v === undefined || typeof v === 'function' || typeof v === 'symbol' ? 'null' : JSON.stringify(v));
  }
  return out.join('');
}
const RAW = Symbol('raw');

export function canonicalJson(tool) {
  return canonicalString({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {},
  });
}

export function toolHash(tool) {
  return createHash('sha256').update(canonicalJson(tool)).digest('hex');
}

// Characters a reader cannot see or cannot tell apart: zero-width, bidi controls, soft hyphen, tag characters, other
// control characters (not tab or newline), and the Cyrillic, Greek and fullwidth forms that stand in for Latin letters.
const HIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u034F\u061C\u0370-\u03FF\u0400-\u04FF\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFF01-\uFF5E\uFFA0\u{E0000}-\u{E007F}]/gu;

// The text with every hidden or confusable character replaced by a visible [U+XXXX] chip.
export function reveal(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return text.replace(HIDDEN, (c) => `[U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]`);
}

// Field-level difference between two values: [{ path, change: 'added'|'removed'|'changed', before, after }].
// Below SCAN_MAX_DEPTH levels the subtrees are compared as a whole (by canonical form) and shown as a placeholder, so a
// hostile schema cannot overflow the stack here.
const TOO_DEEP = `[subtree nested deeper than ${SCAN_MAX_DEPTH} levels, not shown]`;
export function diffValues(before, after, path = '', depth = 0) {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) && isObj(after) && depth < SCAN_MAX_DEPTH) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => diffValues(before[k], after[k], path ? `${path}.${k}` : k, depth + 1));
  }
  const same = (before === undefined || after === undefined) ? before === after : canonicalString(before) === canonicalString(after);
  if (same) return [];
  if (depth >= SCAN_MAX_DEPTH) { before = before === undefined ? undefined : TOO_DEEP; after = after === undefined ? undefined : TOO_DEEP; }
  const entry = before === undefined ? { path, change: 'added', after }
    : after === undefined ? { path, change: 'removed', before } : { path, change: 'changed', before, after };
  // Revealed copies, so a change that looks identical on screen is visibly different.
  if (before !== undefined) entry.beforeRevealed = reveal(before);
  if (after !== undefined) entry.afterRevealed = reveal(after);
  entry.hiddenChars = entry.beforeRevealed !== (typeof before === 'string' ? before : JSON.stringify(before)) || entry.afterRevealed !== (typeof after === 'string' ? after : JSON.stringify(after));
  return [entry];
}

export function diffTools(before, after) {
  return diffValues(
    { description: before.description ?? '', inputSchema: before.inputSchema ?? {} },
    { description: after.description ?? '', inputSchema: after.inputSchema ?? {} },
  );
}

export const CATCHES = [
  { id: 'rug-pull', text: 'A tool whose name, description or inputSchema changed after approval (the field diff is shown).' },
  { id: 'shadowing', text: 'A tool that reuses a name already approved from a different origin.' },
  { id: 'added-sink', text: 'A new or changed tool that carries a URL or email default pointing away from the approved origin.' },
  { id: 'new-tool', text: 'A tool that was never approved.' },
];

export const LIMITS = [
  { id: 'first-list-poison', text: 'A poisoned tool approved on first sight stays approved. Pinning records what was accepted; it does not judge it. A scanner or a human must vet the first list.' },
  { id: 'blind-sink', text: 'An off-origin sink already present at approval is recorded, not blocked.' },
  { id: 'result-injection', text: 'Only tool metadata is hashed. Instructions inside a tool call result are never seen.' },
  { id: 'resources-prompts', text: 'Resources and prompts are not tools and are not pinned.' },
  { id: 'scan-truncated', text: 'The sink scan reads at most 100 levels and 20000 nodes of a schema. A tool that exceeds either is flagged scanTruncated and whatever lies beyond the budget was not examined (it is still hashed in full, so any change is still caught).' },
  { id: 're-approval', text: 'If a person approves a changed tool again, the new definition becomes the pin.' },
  { id: 'free-text-urls', text: 'Sink detection reads only schema values (default, const, enum, examples and URLs inside pattern). A URL or email written in a free-text description, a title, or inside a non-string default (an object or array) is not found as a sink.' },
  { id: 'same-origin', text: 'A hostile instruction or a sink on the approved origin\'s own host is not flagged as a sink.' },
];

const SEVERITY = ['shadowed', 'off-origin-sink', 'changed', 'new-unapproved'];

export function createPinnedClient() {
  const pins = new Map(); // name -> { name, sha256, origin, approvedSinks, definition }

  const publicPin = (p) => ({ name: p.name, sha256: p.sha256, origin: p.origin, approvedSinks: p.approvedSinks, ...(p.scanTruncated && { scanTruncated: true }) });

  function approve(tools, { origin }) {
    const approved = [];
    const skipped = [];
    for (const tool of tools) {
      const existing = pins.get(tool.name);
      if (existing && existing.origin !== origin) {
        skipped.push({ name: tool.name, reason: 'shadowed', pinnedOrigin: existing.origin });
        continue;
      }
      const scan = scanSinks(tool.inputSchema, origin);
      const pin = {
        name: tool.name,
        sha256: toolHash(tool),
        origin,
        approvedSinks: scan.sinks.map((s) => `${s.path}=${s.value}`),
        scanTruncated: scan.truncated,
        definition: { description: tool.description ?? '', inputSchema: tool.inputSchema ?? {} },
      };
      pins.set(tool.name, pin);
      approved.push(publicPin(pin));
    }
    return { approved, skipped };
  }

  function check(tools, { origin }) {
    const results = tools.map((tool) => {
      const sha256 = toolHash(tool);
      const pin = pins.get(tool.name);
      const findings = [];
      let diff;
      const scan = scanSinks(tool.inputSchema, origin);
      let sinks = scan.sinks;
      if (!pin) {
        findings.push('new-unapproved');
      } else if (pin.origin !== origin) {
        findings.push('shadowed');
      } else if (pin.sha256 !== sha256) {
        findings.push('changed');
        diff = diffTools(pin.definition, tool);
        sinks = sinks.filter((s) => !pin.approvedSinks.includes(`${s.path}=${s.value}`));
      } else {
        sinks = []; // unchanged: whatever it carried was approved
      }
      if (sinks.length && findings.length) findings.push('off-origin-sink');
      const verdict = SEVERITY.find((v) => findings.includes(v)) ?? 'ok';
      const result = { name: tool.name, verdict, findings, sha256 };
      if (pin) result.pinnedOrigin = pin.origin;
      if (diff) result.diff = diff;
      if (scan.truncated) result.scanTruncated = true;
      if (sinks.length && findings.length) result.sinks = sinks;
      return result;
    });
    const seen = new Set(tools.map((t) => t.name));
    const missing = [...pins.values()].filter((p) => p.origin === origin && !seen.has(p.name)).map((p) => p.name);
    return { origin, results, missing };
  }

  return { approve, check, pins: () => [...pins.values()].map(publicPin) };
}
