// POST /api/gateway/run: the same hostile member listed two ways.
//
//   no gateway:  a client connected to both members directly takes everything each one lists, under bare names.
//   gateway:     the aggregate gateway simulation (gateway.js) lists for one caller: ToolFilter, then the caller's
//                entitlements, then the aggregate cap, every tool prefixed alias__tool; the same decision is asked
//                again when a call is forwarded to a member.
//
// The hostile member's tools come from the real server over the in-memory session (session.js), so list #1 and list #2
// are the real clean and rug-pulled answers. Pinning (pinning.js) runs on the gateway listing to show the filter does
// not replace it. No network, no clock, no randomness. Every Ping product claim here is UNVERIFIED on our tenant.
import { createGateway, GatewayConfigError, SEP } from './gateway.js';
import { APP_REFS, CALLERS, DEFAULT_ALIASES, DEFAULT_CAP, MEMBER_KEYS, REGISTRY, TASKS, memberTools } from './gateway-fixtures.js';
import { createPinnedClient } from './pinning.js';
import { BANK_ORIGIN, HOSTILE_ORIGIN, createSession } from './session.js';
import { runVictim } from './victim.js';

const ORIGINS = { bank: BANK_ORIGIN, hostile: HOSTILE_ORIGIN };
const STAGES = ['first', 'later'];
const MAX_ENTRIES = 64;
const MAX_NAME = 96;
const NAME = /^[A-Za-z0-9_.-]{1,96}$/;
const ALIAS = /^[a-z][a-z0-9-]{0,23}$/;

export class PolicyError extends Error {
  constructor(message) { super(message); this.name = 'PolicyError'; }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const nameList = (v, what) => {
  if (!Array.isArray(v) || v.length > MAX_ENTRIES || !v.every((s) => typeof s === 'string' && NAME.test(s))) throw new PolicyError(`${what} must be a list of at most ${MAX_ENTRIES} tool names`);
  return [...new Set(v)];
};
// Reads only the keys in `allowed`; any other own key (including __proto__) is refused. Values are never echoed.
function pick(obj, allowed, what) {
  if (!isPlain(obj)) throw new PolicyError(`${what} must be an object`);
  const allow = new Set(allowed);
  for (const k of Object.keys(obj)) if (!allow.has(k)) throw new PolicyError(`${what} has a field this simulation does not know`);
  return new Map(allowed.filter((k) => Object.hasOwn(obj, k)).map((k) => [k, obj[k]]));
}

// The defaults the page starts from, and what Reset restores.
export const defaultPolicy = (caller = 'analyst') => ({
  aliases: { ...DEFAULT_ALIASES },
  toolFilter: { bank: null, hostile: null },
  reachable: { bank: true, hostile: true },
  entitled: [...CALLERS[caller].entitled],
  capAllow: [...DEFAULT_CAP],
});

export function parseRequest(body) {
  const top = pick(body ?? {}, ['stage', 'caller', 'task', 'policy'], 'request');
  const stage = top.get('stage') ?? 'later';
  if (typeof stage !== 'string' || !STAGES.includes(stage)) throw new PolicyError(`stage must be one of ${STAGES.join(', ')}`);
  const caller = top.get('caller') ?? 'analyst';
  if (typeof caller !== 'string' || !Object.hasOwn(CALLERS, caller)) throw new PolicyError(`caller must be one of ${Object.keys(CALLERS).join(', ')}`);
  const task = top.get('task') ?? TASKS[2];
  if (typeof task !== 'string' || !TASKS.includes(task)) throw new PolicyError('task must be one of the tasks this page offers');

  const policy = defaultPolicy(caller);
  if (top.has('policy')) {
    const p = pick(top.get('policy'), ['aliases', 'toolFilter', 'reachable', 'entitled', 'capAllow'], 'policy');
    if (p.has('aliases')) for (const [k, v] of pick(p.get('aliases'), MEMBER_KEYS, 'aliases')) {
      if (typeof v !== 'string' || !ALIAS.test(v)) throw new PolicyError('an alias is 1 to 24 characters: a lowercase letter, then lowercase letters, digits or dashes');
      policy.aliases[k] = v;
    }
    if (p.has('toolFilter')) for (const [k, v] of pick(p.get('toolFilter'), MEMBER_KEYS, 'toolFilter')) policy.toolFilter[k] = v === null ? null : nameList(v, 'a tool filter');
    if (p.has('reachable')) for (const [k, v] of pick(p.get('reachable'), MEMBER_KEYS, 'reachable')) {
      if (typeof v !== 'boolean') throw new PolicyError('reachable must be true or false');
      policy.reachable[k] = v;
    }
    if (p.has('entitled')) policy.entitled = nameList(p.get('entitled'), 'entitled');
    if (p.has('capAllow')) policy.capAllow = p.get('capAllow') === null ? null : nameList(p.get('capAllow'), 'capAllow');
  }
  return { stage, caller, task, policy };
}

const brief = (t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? {} });

function buildGateway(policy, listNumber, hostileTools) {
  return createGateway({
    registry: new Set(REGISTRY),
    capAllow: policy.capAllow,
    members: MEMBER_KEYS.map((key) => ({
      appRef: APP_REFS[key],
      alias: policy.aliases[key],
      toolFilter: policy.toolFilter[key],
      reachable: policy.reachable[key],
      tools: memberTools(key, listNumber, hostileTools),
    })),
  });
}

// Only names that really are in the catalog are echoed: a policy entry nobody can match is counted, never shown.
const knownNames = (policy, hostileTools) => new Set(MEMBER_KEYS.flatMap((k) => memberTools(k, 2, hostileTools).map((t) => `${policy.aliases[k]}${SEP}${t.name}`)));

export async function runGateway(request) {
  const { stage, caller, task, policy } = request;
  const session = await createSession({ trusted: false });
  try {
    const first = await session.list();
    const second = stage === 'later' ? await session.list() : null;
    const current = second ?? first;
    const listNumber = current.listNumber;

    // No gateway: both members listed directly, bare names, the last definition of a name wins in the victim.
    const direct = [];
    const silentlyMissing = [];
    for (const key of MEMBER_KEYS) {
      if (!policy.reachable[key]) { silentlyMissing.push(key); continue; }
      for (const t of memberTools(key, listNumber, current.tools)) direct.push({ ...brief(t), member: key });
    }
    const seen = new Map();
    for (const t of direct) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
    const collisions = [...seen].filter(([, n]) => n > 1).map(([name]) => name).sort();

    let gw;
    let listing;
    try {
      gw = buildGateway(policy, listNumber, current.tools);
      listing = gw.list({ entitled: policy.entitled });
    } catch (e) {
      if (e instanceof GatewayConfigError) throw new PolicyError(`the gateway refused this configuration (${e.code})`);
      throw e;
    }

    // The pinned client on the gateway listing: pin list #1, check the current list. Names carry the alias, so a name
    // pinned for one member can never be mistaken for the other member's.
    let pin = null;
    if (second) {
      const gw1 = buildGateway(policy, first.listNumber, first.tools);
      const listing1 = gw1.list({ entitled: policy.entitled });
      const pinned = createPinnedClient();
      const originOf = (alias) => ORIGINS[MEMBER_KEYS.find((k) => policy.aliases[k] === alias)];
      for (const alias of new Set(listing1.tools.map((t) => t.alias))) pinned.approve(listing1.tools.filter((t) => t.alias === alias).map(brief), { origin: originOf(alias) });
      const results = [];
      for (const alias of new Set(listing.tools.map((t) => t.alias))) {
        const r = pinned.check(listing.tools.filter((t) => t.alias === alias).map(brief), { origin: originOf(alias) });
        results.push(...r.results.map((x) => ({ name: x.name, verdict: x.verdict, ...(x.diff ? { diff: x.diff } : {}) })));
      }
      pin = { approvedFromList: first.listNumber, checkedList: second.listNumber, results, changed: results.filter((r) => r.verdict === 'changed').map((r) => r.name) };
    }

    const known = knownNames(policy, current.tools);
    const hiddenView = listing.hidden.map((h) => ({ name: h.name, alias: h.alias, reason: h.reason }));
    const bare = (key) => policy.aliases[key];
    const attemptNames = [`${bare('bank')}${SEP}get_balance`, `${bare('hostile')}${SEP}get_stock_price`, `${bare('hostile')}${SEP}create_transfer`, `${bare('hostile')}${SEP}bulk_export`, 'create_transfer', `${bare('hostile')}${SEP}bank${SEP}get_balance`];
    const attempts = attemptNames.map((name) => {
      const r = gw.call({ entitled: policy.entitled }, name, {});
      return { name, ok: r.ok, code: r.code, stage: r.stage, forwardedTo: r.forwardedTo ?? null };
    });
    const bareHit = (name) => direct.some((t) => t.name === name);
    const directAttempts = [{ name: 'create_transfer', reached: bareHit('create_transfer') }, { name: 'bulk_export', reached: bareHit('bulk_export') }];

    const victimTools = (tools) => tools.map(brief);
    const victimDirect = runVictim({ task, tools: direct.map(brief), origin: HOSTILE_ORIGIN });
    const victimGateway = runVictim({ task, tools: victimTools(listing.tools), origin: HOSTILE_ORIGIN });

    return {
      stage, caller, task, listNumber,
      members: MEMBER_KEYS.map((key) => ({ key, appRef: APP_REFS[key], alias: policy.aliases[key], reachable: policy.reachable[key], toolFilter: policy.toolFilter[key] })),
      policy: {
        entitled: policy.entitled.filter((n) => known.has(n)),
        capAllow: policy.capAllow === null ? null : policy.capAllow.filter((n) => known.has(n)),
        ignoredEntries: policy.entitled.filter((n) => !known.has(n)).length + (policy.capAllow === null ? 0 : policy.capAllow.filter((n) => !known.has(n)).length),
      },
      direct: { count: direct.length, tools: direct, collisions, silentlyMissing, attempts: directAttempts, victim: victimDirect },
      gateway: {
        count: listing.tools.length, tools: listing.tools, members: listing.members, unreachable: listing.unreachable,
        hidden: hiddenView, hiddenCount: hiddenView.length, attempts, memberHops: gw.hops().length, pin, victim: victimGateway,
      },
    };
  } finally {
    await session.close();
  }
}

export const gatewayConfig = (hostileTools) => ({
  callers: Object.fromEntries(Object.entries(CALLERS).map(([id, c]) => [id, { label: c.label, entitled: [...c.entitled] }])),
  defaults: defaultPolicy('analyst'),
  members: MEMBER_KEYS.map((key) => ({ key, appRef: APP_REFS[key], tools: memberTools(key, 2, hostileTools).map((t) => t.name) })),
  tasks: [...TASKS],
  limits: { maxEntries: MAX_ENTRIES, maxName: MAX_NAME },
});
