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
import { findSinks } from './sinks.js';

// Sorted keys at every depth. `required` is a set in JSON Schema, so a string array under that key is sorted too:
// re-ordering it is not a change of meaning. Other arrays keep their order.
export function canonicalize(value, key) {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonicalize(v));
    return key === 'required' && items.every((i) => typeof i === 'string') ? [...items].sort() : items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalize(value[k], k)]));
  }
  return value;
}

export function canonicalJson(tool) {
  return JSON.stringify(canonicalize({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {},
  }));
}

export function toolHash(tool) {
  return createHash('sha256').update(canonicalJson(tool)).digest('hex');
}

// Field-level difference between two values: [{ path, change: 'added'|'removed'|'changed', before, after }].
export function diffValues(before, after, path = '') {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => diffValues(before[k], after[k], path ? `${path}.${k}` : k));
  }
  if (JSON.stringify(canonicalize(before)) === JSON.stringify(canonicalize(after))) return [];
  if (before === undefined) return [{ path, change: 'added', after }];
  if (after === undefined) return [{ path, change: 'removed', before }];
  return [{ path, change: 'changed', before, after }];
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
  { id: 're-approval', text: 'If a person approves a changed tool again, the new definition becomes the pin.' },
  { id: 'same-origin', text: 'A hostile instruction or a sink on the approved origin\'s own host is not flagged as a sink.' },
];

const SEVERITY = ['shadowed', 'off-origin-sink', 'changed', 'new-unapproved'];

export function createPinnedClient() {
  const pins = new Map(); // name -> { name, sha256, origin, approvedSinks, definition }

  const publicPin = (p) => ({ name: p.name, sha256: p.sha256, origin: p.origin, approvedSinks: p.approvedSinks });

  function approve(tools, { origin }) {
    const approved = [];
    const skipped = [];
    for (const tool of tools) {
      const existing = pins.get(tool.name);
      if (existing && existing.origin !== origin) {
        skipped.push({ name: tool.name, reason: 'shadowed', pinnedOrigin: existing.origin });
        continue;
      }
      const pin = {
        name: tool.name,
        sha256: toolHash(tool),
        origin,
        approvedSinks: findSinks(tool.inputSchema, origin).map((s) => `${s.path}=${s.value}`),
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
      let sinks = findSinks(tool.inputSchema, origin);
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
      if (sinks.length && findings.length) result.sinks = sinks;
      return result;
    });
    const seen = new Set(tools.map((t) => t.name));
    const missing = [...pins.values()].filter((p) => p.origin === origin && !seen.has(p.name)).map((p) => p.name);
    return { origin, results, missing };
  }

  return { approve, check, pins: () => [...pins.values()].map(publicPin) };
}
