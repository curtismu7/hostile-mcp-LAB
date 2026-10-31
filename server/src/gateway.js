// A pure, in-process simulation of an MCP aggregate gateway: entitlement-aware discovery plus an aggregate policy cap.
//
// HONESTY. Everything this models is a Ping release claim (release dated 2026-11-02, deck slides 36 and 37), UNVERIFIED
// on our tenant: the SE gateway is v1.261030 and does not have it. Tags used across the app (see TAGS below):
//   console swagger name (2026-10-31, schema only)  Members, AppRef, Alias, ToolFilter, AppType mcp-aggregate, alias__tool
//   deck claim                                      entitlement-filtered listing; one policy cap enforced twice
//   lab-invented                                    every key in this file that is not a swagger name (entitled, capAllow, ...)
//   lab reading                                     how we read a sentence the swagger and the deck leave open
// The swagger has no field for entitlement-aware discovery or for the cap, so none is named after one.
//
// No imports, no I/O, no clock, no randomness: the same input always gives the same output, and the test mutates this
// file's source text, so it must stay self-contained.
//
// Hostile input is bounded (LIMITS). Lookups use Map and Set, never an object indexed by a caller-supplied key.
// A typed credential or token is never echoed: a refusal names a tool only when that tool is in the member's own
// catalog, and no response carries call arguments.

export const LIMITS = Object.freeze({ maxMembers: 8, maxToolsPerMember: 100, maxNameLength: 96, maxListEntries: 64 });
export const SEP = '__';
export const TAGS = Object.freeze({
  swagger: 'console swagger name, 2026-10-31, schema only',
  deck: 'Ping release claim (deck slides 36 and 37), UNVERIFIED on our tenant',
  invented: 'lab-invented',
  reading: 'lab reading',
});

// What this simulation does not do, as data: shown on the Limits page and in docs/threat-catalog.md.
export const GATEWAY_LIMITS = Object.freeze([
  { id: 'filter-is-not-a-scanner', text: 'The filter decides which tools a caller sees. It does not read them: an entitled tool under the cap is delivered exactly as the member wrote it, poisoned description included.' },
  { id: 'policy-is-only-as-good-as-its-author', text: 'Entitlements and the cap are written by a person. A tool you entitled and capped in stays listed after its description is rug-pulled; pinning is what notices the change.' },
  { id: 'results-not-read', text: 'The gateway decides which tools are listed and callable. It does not read what a call returns, or resources and prompts.' },
  { id: 'no-live-path', text: 'Entitlement-aware discovery and the aggregate policy cap are Ping release claims (2026-11-02), UNVERIFIED on our tenant. The SE gateway is v1.261030 and does not have them, so this exists only as an in-process simulation.' },
  { id: 'upstream-oauth-not-simulated', text: 'Per-user upstream OAuth to each member is not simulated: no token is issued, forwarded or shown here.' },
]);

// An alias has no underscore, so the first "__" in a namespaced name always ends the alias: a member that serves a tool
// called "bank__get_balance" appears as "hostile__bank__get_balance" and never as the bank's tool.
const ALIAS = /^[a-z][a-z0-9-]{0,23}$/;
const APP_REF = /^[a-z][a-z0-9/._-]{0,63}$/;
const printable = (s) => typeof s === 'string' && s.length > 0 && s.length <= LIMITS.maxNameLength && !/[\u0000-\u001F\u007F-\u009F]/.test(s);

export class GatewayConfigError extends Error {
  constructor(code) { super(`gateway configuration refused: ${code}`); this.name = 'GatewayConfigError'; this.code = code; }
}

const strings = (v) => (Array.isArray(v) && v.length <= LIMITS.maxListEntries && v.every(printable) ? new Set(v) : null);

// registry: the set of AppRef values the tenant knows (lab reading: an aggregate member must be a registered application).
// members: [{ appRef, alias, toolFilter?: string[]|null, reachable?: boolean, tools: [{name, description, inputSchema}], call?(tool, args) }]
// capAllow: string[]|null  the aggregate policy cap as an allow-list of namespaced names; null means no cap (lab-invented)
export function createGateway({ registry, members, capAllow = null }) {
  if (!(registry instanceof Set)) throw new GatewayConfigError('no_registry');
  if (!Array.isArray(members) || members.length === 0 || members.length > LIMITS.maxMembers) throw new GatewayConfigError('bad_members');
  const cap = capAllow === null ? null : strings(capAllow);
  if (capAllow !== null && cap === null) throw new GatewayConfigError('bad_cap');

  const byAlias = new Map();
  for (const m of members) {
    if (typeof m !== 'object' || m === null) throw new GatewayConfigError('bad_member');
    if (typeof m.alias !== 'string' || !ALIAS.test(m.alias)) throw new GatewayConfigError('bad_alias');
    if (byAlias.has(m.alias)) throw new GatewayConfigError('duplicate_alias');
    if (typeof m.appRef !== 'string' || !APP_REF.test(m.appRef) || !registry.has(m.appRef)) throw new GatewayConfigError('unknown_app');
    const filter = m.toolFilter == null ? null : strings(m.toolFilter);
    if (m.toolFilter != null && filter === null) throw new GatewayConfigError('bad_tool_filter');
    if (!Array.isArray(m.tools)) throw new GatewayConfigError('bad_tools');
    byAlias.set(m.alias, { alias: m.alias, appRef: m.appRef, filter, reachable: m.reachable !== false, tools: m.tools.slice(0, LIMITS.maxToolsPerMember), offered: m.tools.length, call: m.call });
  }

  const hops = []; // every call forwarded to a member: { alias, tool }

  // The one decision, asked twice: once when listing and once at the member hop. Order = ToolFilter, entitlement, cap.
  function decide(member, tool, entitled) {
    if (member.filter !== null && !member.filter.has(tool)) return 'not-in-toolfilter';
    if (!entitled.has(`${member.alias}${SEP}${tool}`)) return 'not-entitled';
    if (cap !== null && !cap.has(`${member.alias}${SEP}${tool}`)) return 'over-cap';
    return null;
  }
  const entitledSet = (caller) => {
    const set = caller && strings(caller.entitled);
    if (!set) throw new GatewayConfigError('bad_caller');
    return set;
  };

  function list(caller) {
    const entitled = entitledSet(caller);
    const tools = [];
    const hidden = [];
    const status = [];
    for (const m of byAlias.values()) {
      if (!m.reachable) { status.push({ alias: m.alias, status: 'unreachable', offered: null, listed: 0 }); continue; }
      const seen = new Set();
      let listed = 0;
      for (const t of m.tools) {
        if (!t || !printable(t.name)) { hidden.push({ name: null, alias: m.alias, reason: 'invalid-name' }); continue; }
        const name = `${m.alias}${SEP}${t.name}`;
        if (seen.has(t.name)) { hidden.push({ name, alias: m.alias, reason: 'duplicate-in-member' }); continue; }
        seen.add(t.name);
        const reason = decide(m, t.name, entitled);
        if (reason) { hidden.push({ name, alias: m.alias, reason }); continue; }
        tools.push({ name, alias: m.alias, tool: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? {} });
        listed += 1;
      }
      status.push({ alias: m.alias, status: 'ok', offered: m.offered, listed, truncated: m.offered > LIMITS.maxToolsPerMember });
    }
    return {
      tools,
      members: status,
      unreachable: status.filter((s) => s.status === 'unreachable').map((s) => s.alias),
      hidden,
    };
  }

  function call(caller, name, args) {
    const entitled = entitledSet(caller);
    const refuse = (code, stage, known = null) => ({ ok: false, code, stage, name: known });
    if (typeof name !== 'string' || name.length === 0 || name.length > LIMITS.maxNameLength * 2) return refuse('bad_name', 'gateway');
    const at = name.indexOf(SEP);
    if (at < 1) return refuse('unprefixed', 'gateway');
    const member = byAlias.get(name.slice(0, at));
    if (!member) return refuse('unknown_alias', 'gateway');
    const tool = name.slice(at + SEP.length);
    const real = member.tools.find((t) => t && t.name === tool);
    if (!real) return refuse('no_such_tool', 'member-hop');
    if (!member.reachable) return refuse('member_unreachable', 'member-hop', name);
    const reason = decide(member, tool, entitled);
    if (reason) return refuse(reason, 'member-hop', name);
    hops.push({ alias: member.alias, tool });
    return { ok: true, code: 'forwarded', stage: 'member-hop', name, forwardedTo: member.alias, result: member.call ? member.call(tool, args) : null };
  }

  return { list, call, hops: () => hops.map((h) => ({ ...h })), aliases: () => [...byAlias.keys()] };
}
