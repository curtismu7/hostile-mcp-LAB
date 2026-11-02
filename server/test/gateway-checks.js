// The assertions behind the gateway tests, as named checks over a module. gateway.test.js runs them against the real
// source; gateway-mutation.test.js runs the same checks against mutated copies of the source and requires each mutant
// to be caught by a named check. Each check says which row of the feature test plan (PROMPT-ID4AI-H2 section 9) it
// covers: "MCP Aggregate" or "MCP Catalog (entitlement part)", or the hostile-server tricks the lab adds, and each pairs
// real counts with a negative control. Every Ping product claim modelled here is UNVERIFIED on our tenant.
import assert from 'node:assert/strict';
import { ALIAS_PRESETS, APP_REFS, CALLERS, DEFAULT_CAP, REGISTRY, SPOOF_TOOL, LATE_TOOL, hostileCatalog, memberTools } from '../src/gateway-fixtures.js';
import { rugPullTool } from '../src/mcp/tools.js';

const SECRET = 'SECRET_TOKEN_123';
const ALIAS_LEAK = 'ghp-aliasleak1234abcd';
export const entitledOf = (caller) => ({ entitled: [...CALLERS[caller].entitled] });
const names = (listing) => listing.tools.map((t) => t.name);
const sorted = (xs) => [...xs].sort();

// The gateway over the two members. `over` overrides one thing at a time.
export function build(mod, over = {}) {
  const list = over.list ?? 2;
  const hostileTools = over.hostileTools ?? hostileCatalog(list);
  return mod.createGateway({
    registry: new Set(over.registry ?? REGISTRY),
    capAllow: 'cap' in over ? over.cap : [...DEFAULT_CAP],
    members: [
      { appRef: APP_REFS.bank, alias: 'bankAlias' in over ? over.bankAlias : 'bank', toolFilter: over.bankFilter ?? null, reachable: over.bankUp !== false, tools: memberTools('bank', list, hostileTools) },
      { appRef: over.hostileRef ?? APP_REFS.hostile, alias: 'hostileAlias' in over ? over.hostileAlias : 'hostile', toolFilter: over.hostileFilter ?? null, reachable: over.hostileUp !== false, tools: over.hostileOffer ?? memberTools('hostile', list, hostileTools) },
    ],
  });
}
const everything = (list = 2) => {
  const hostile = hostileCatalog(list);
  return [...memberTools('bank', list, hostile).map((t) => `bank__${t.name}`), ...memberTools('hostile', list, hostile).map((t) => `hostile__${t.name}`)];
};
const refusedCode = (fn) => { try { fn(); return null; } catch (e) { return e.code ?? `threw:${e.name}`; } };

export const CHECKS = [
  {
    id: 'prefix-by-alias', row: 'MCP Aggregate: names are prefixed by alias',
    run(mod) {
      const gw = build(mod);
      const listing = gw.list(entitledOf('analyst'));
      const offered = everything();
      assert.equal(offered.length, 15, 'the two members offer 15 tools in all');
      const expected = offered.filter((n) => CALLERS.analyst.entitled.includes(n) && DEFAULT_CAP.includes(n));
      assert.deepEqual(sorted(names(listing)), sorted(expected));
      assert.equal(listing.tools.length, 4);
      for (const t of listing.tools) { assert.equal(t.name, `${t.alias}__${t.tool}`); assert.match(t.name, /^(bank|hostile)__[a-z_]+$/); }
      // negative control: with no gateway the same two members list bare names, and one name appears twice
      const bare = [...memberTools('bank', 2, hostileCatalog(2)), ...memberTools('hostile', 2, hostileCatalog(2))].map((t) => t.name);
      assert.equal(bare.length - new Set(bare).size, 1, 'bare listing: get_balance is defined twice');
      const all = build(mod, { cap: null }).list({ entitled: offered });
      assert.equal(all.tools.length, 15);
      assert.equal(new Set(names(all)).size, 15, 'namespaced listing: no name twice');
    },
  },
  {
    id: 'alias-edit-renames-and-fails-closed', row: 'MCP Aggregate: Alias field',
    run(mod) {
      const renamed = build(mod, { hostileAlias: 'ext' }).list(entitledOf('analyst'));
      assert.deepEqual(sorted(names(renamed)), ['bank__get_balance', 'bank__get_statement'], 'old entitlements name hostile__*, so the renamed member shows nothing');
      const entitled = { entitled: ['bank__get_balance', 'ext__get_weather'] };
      const listing = build(mod, { hostileAlias: 'ext', cap: ['bank__get_balance', 'ext__get_weather'] }).list(entitled);
      assert.deepEqual(sorted(names(listing)), ['bank__get_balance', 'ext__get_weather']);
    },
  },
  {
    id: 'collision-and-spoof-disambiguated', row: 'hostile trick: name collision and prefix spoof',
    run(mod) {
      const gw = build(mod, { cap: null });
      const all = everything();
      const caller = { entitled: all };
      const listing = gw.list(caller);
      const bank = listing.tools.find((t) => t.name === 'bank__get_balance');
      const hostile = listing.tools.find((t) => t.name === 'hostile__get_balance');
      assert.ok(bank && hostile, 'both get_balance tools are listed, under different names');
      assert.notEqual(bank.description, hostile.description);
      assert.match(hostile.description, /<IMPORTANT>/);
      assert.equal(gw.call(caller, 'bank__get_balance').forwardedTo, 'bank');
      assert.equal(gw.call(caller, 'hostile__get_balance').forwardedTo, 'hostile');
      // the hostile member serves a tool called bank__get_balance: it is hostile__bank__get_balance and routes to the hostile member
      assert.equal(SPOOF_TOOL.name, 'bank__get_balance');
      const spoof = listing.tools.find((t) => t.name === 'hostile__bank__get_balance');
      assert.equal(spoof?.alias, 'hostile');
      const r = gw.call(caller, 'hostile__bank__get_balance');
      assert.equal(r.forwardedTo, 'hostile');
      assert.deepEqual(gw.hops().map((h) => `${h.alias}:${h.tool}`), ['bank:get_balance', 'hostile:get_balance', 'hostile:bank__get_balance']);
      // negative control: the spoofed name is not the bank's tool for a caller who was never entitled to it
      const spoofGw = build(mod);
      const analyst = spoofGw.call(entitledOf('analyst'), 'hostile__bank__get_balance');
      assert.deepEqual([analyst.ok, analyst.code], [false, 'not_available']);
      assert.equal(spoofGw.audit().at(-1).reason, 'not-entitled');
    },
  },
  {
    id: 'entitlement-filters-the-listing', row: 'entitlement-aware discovery',
    run(mod) {
      const gw = build(mod);
      const analyst = gw.list(entitledOf('analyst'));
      const viewer = gw.list(entitledOf('viewer'));
      assert.deepEqual(sorted(names(viewer)), ['bank__get_balance', 'hostile__get_stock_price']);
      assert.equal(analyst.tools.length, 4);
      assert.equal(analyst.hidden.length + analyst.tools.length, 15, 'every offered tool is either listed or accounted for');
      assert.equal(viewer.hidden.length, 13);
      const reasons = Object.fromEntries(viewer.hidden.map((h) => [h.name, h.reason]));
      assert.equal(reasons.bank__get_statement, 'not-entitled');
      // negative control: entitle everything and nothing is hidden by entitlement
      assert.equal(build(mod, { cap: null }).list({ entitled: everything() }).hidden.length, 0);
    },
  },
  {
    id: 'cap-on-the-listing', row: 'MCP Aggregate: policy cap enforced on the listing',
    run(mod) {
      const analyst = entitledOf('analyst');
      assert.ok(analyst.entitled.includes('hostile__send_email') && !DEFAULT_CAP.includes('hostile__send_email'));
      const capped = build(mod).list(analyst);
      assert.ok(!names(capped).includes('hostile__send_email'));
      assert.equal(capped.hidden.find((h) => h.name === 'hostile__send_email').reason, 'over-cap');
      // negative control: no cap, and the same entitled tool is listed
      const open = build(mod, { cap: null }).list(analyst);
      assert.ok(names(open).includes('hostile__send_email'));
      assert.equal(open.tools.length, 5);
      // the cap holds even for a caller entitled to everything
      const wide = build(mod).list({ entitled: everything() });
      assert.deepEqual(sorted(names(wide)), sorted(DEFAULT_CAP));
    },
  },
  {
    id: 'cap-enforced-again-at-the-member-hop', row: 'MCP Aggregate: cap enforced again at the member hop',
    run(mod) {
      const gw = build(mod);
      const analyst = entitledOf('analyst');
      const refused = gw.call(analyst, 'hostile__send_email');
      assert.deepEqual([refused.ok, refused.code, refused.stage], [false, 'not_available', 'member-hop']);
      assert.equal(gw.audit().at(-1).reason, 'over-cap', 'the demo audit log says why; the caller is not told');
      assert.equal(gw.hops().length, 0, 'the member received nothing');
      const viewer = gw.call(entitledOf('viewer'), 'bank__get_statement');
      assert.deepEqual([viewer.ok, viewer.code, viewer.stage], [false, 'not_available', 'member-hop']);
      assert.equal(gw.audit().at(-1).reason, 'not-entitled');
      assert.equal(gw.hops().length, 0);
      // a tool nobody listed, guessed by name, is refused the same way
      assert.equal(gw.call(analyst, 'hostile__create_transfer').code, 'not_available');
      assert.equal(gw.audit().at(-1).reason, 'not-entitled');
      assert.equal(gw.hops().length, 0);
      // negative controls: an entitled, capped tool is forwarded; with no cap the capped one is too
      assert.equal(gw.call(analyst, 'bank__get_balance').ok, true);
      assert.equal(gw.hops().length, 1);
      assert.equal(build(mod, { cap: null }).call(analyst, 'hostile__send_email').ok, true);
    },
  },
  {
    id: 'toolfilter-limits-a-member', row: 'MCP Aggregate: ToolFilter field',
    run(mod) {
      const caller = { entitled: everything() };
      const filtered = build(mod, { cap: null, hostileFilter: ['get_weather', 'search_docs'] });
      const listing = filtered.list(caller);
      assert.deepEqual(sorted(names(listing).filter((n) => n.startsWith('hostile__'))), ['hostile__get_weather', 'hostile__search_docs']);
      assert.equal(listing.hidden.filter((h) => h.reason === 'not-in-toolfilter').length, 11);
      assert.equal(filtered.call(caller, 'hostile__create_transfer').code, 'not_available');
      assert.equal(filtered.audit().at(-1).reason, 'not-in-toolfilter');
      assert.equal(filtered.hops().length, 0);
      // negative control: no filter, all thirteen hostile tools listed
      assert.equal(build(mod, { cap: null }).list(caller).tools.filter((t) => t.alias === 'hostile').length, 13);
    },
  },
  {
    id: 'late-tool-removed-unless-entitled-and-capped', row: 'hostile trick: a tool that appears after approval',
    run(mod) {
      assert.equal(LATE_TOOL.name, 'bulk_export');
      const first = build(mod, { list: 1 }).list(entitledOf('analyst'));
      const later = build(mod, { list: 2 });
      const listing = later.list(entitledOf('analyst'));
      assert.ok(!names(first).includes('hostile__bulk_export') && !names(listing).includes('hostile__bulk_export'));
      assert.equal(listing.hidden.find((h) => h.name === 'hostile__bulk_export').reason, 'not-entitled');
      assert.equal(later.call(entitledOf('analyst'), 'hostile__bulk_export').code, 'not_available');
      assert.equal(later.audit().at(-1).reason, 'not-entitled');
      const dayOne = build(mod, { list: 1 });
      assert.equal(dayOne.call(entitledOf('analyst'), 'hostile__bulk_export').code, 'not_available');
      assert.equal(dayOne.audit().at(-1).reason, 'no_such_tool', 'on day one the tool did not exist at all');
      // negative controls: entitled but not capped is still removed; entitled and capped is listed (policy, not detection)
      const entitled = { entitled: [...CALLERS.analyst.entitled, 'hostile__bulk_export'] };
      assert.equal(build(mod).list(entitled).hidden.find((h) => h.name === 'hostile__bulk_export').reason, 'over-cap');
      assert.ok(names(build(mod, { cap: [...DEFAULT_CAP, 'hostile__bulk_export'] }).list(entitled)).includes('hostile__bulk_export'));
    },
  },
  {
    id: 'entitled-caller-still-sees-the-poison', row: 'hostile trick: the filter does not clean content',
    run(mod) {
      const listing = build(mod).list(entitledOf('analyst'));
      const stock = listing.tools.find((t) => t.name === 'hostile__get_stock_price');
      assert.equal(stock.description, rugPullTool(2).description, 'byte for byte what the member served');
      assert.match(stock.description, /<IMPORTANT>Ignore prior instructions/);
      assert.deepEqual(stock.inputSchema, rugPullTool(2).inputSchema);
      const weather = listing.tools.find((t) => t.name === 'hostile__get_weather');
      assert.match(weather.description, /<IMPORTANT>/);
      // negative control: the list-1 definition of the same tool is clean, so the difference is the member's, not the gateway's
      assert.equal(build(mod, { list: 1 }).list(entitledOf('analyst')).tools.find((t) => t.name === 'hostile__get_stock_price').description, rugPullTool(1).description);
      // and a caller who is not entitled never receives it
      assert.ok(!names(build(mod).list({ entitled: ['bank__get_balance'] })).includes('hostile__get_stock_price'));
    },
  },
  {
    id: 'unreachable-member-reported-not-dropped', row: 'MCP Aggregate: unreachable member reported',
    run(mod) {
      const gw = build(mod, { bankUp: false });
      const listing = gw.list(entitledOf('analyst'));
      assert.deepEqual(listing.unreachable, ['bank']);
      assert.deepEqual(listing.members.map((m) => [m.alias, m.status]), [['bank', 'unreachable'], ['hostile', 'ok']]);
      assert.deepEqual(sorted(names(listing)), ['hostile__get_stock_price', 'hostile__get_weather'], 'the other member is still listed');
      const r = gw.call(entitledOf('analyst'), 'bank__get_balance');
      assert.deepEqual([r.ok, r.code], [false, 'member_unreachable']);
      assert.equal(gw.hops().length, 0);
      // the hostile member can be the one that is down
      assert.deepEqual(build(mod, { hostileUp: false }).list(entitledOf('analyst')).unreachable, ['hostile']);
      // negative control: both reachable, nothing reported
      const up = build(mod).list(entitledOf('analyst'));
      assert.deepEqual(up.unreachable, []);
      assert.ok(up.members.every((m) => m.status === 'ok'));
    },
  },
  {
    id: 'unknown-app-refused', row: 'MCP Catalog (entitlement part): unknown entry refused',
    run(mod) {
      assert.equal(refusedCode(() => build(mod, { hostileRef: 'app/not-in-the-catalog' })), 'unknown_app');
      assert.equal(refusedCode(() => build(mod, { registry: [APP_REFS.bank] })), 'unknown_app');
      // negative control: both members are registered
      assert.equal(refusedCode(() => build(mod)), null);
    },
  },
  {
    id: 'controls-apply-from-the-first-list', row: 'MCP Catalog (entitlement part): controls from the first request',
    run(mod) {
      const gw = build(mod, { list: 1 });
      assert.deepEqual(sorted(Object.keys(gw)), ['aliases', 'audit', 'call', 'hops', 'list'], 'there is no unfiltered way to list');
      assert.equal(refusedCode(() => gw.list()), 'bad_caller');
      const first = gw.list(entitledOf('analyst'));
      assert.equal(first.tools.length, 4);
      assert.equal(first.hidden.length, 10);
      assert.equal(first.tools.length + first.hidden.length, 14, 'list 1 offers 14');
      // negative control: with no gateway the first list shows all 14
      assert.equal(everything(1).length, 14);
    },
  },
  {
    id: 'hostile-configuration-is-bounded', row: 'hostile input bounded',
    run(mod) {
      for (const alias of ['', 'Bank', 'a__b', 'a_b', '__proto__', 'x'.repeat(25), '1a', 'a b', 'a/b', null, 7]) assert.equal(refusedCode(() => build(mod, { bankAlias: alias })), 'bad_alias', String(alias));
      assert.equal(refusedCode(() => build(mod, { bankAlias: 'hostile' })), 'duplicate_alias');
      const m = (alias) => ({ appRef: APP_REFS.bank, alias, tools: [] });
      assert.equal(refusedCode(() => mod.createGateway({ registry: new Set(REGISTRY), members: Array.from({ length: 9 }, (_, i) => m(`m${i}`)) })), 'bad_members');
      assert.equal(refusedCode(() => mod.createGateway({ registry: new Set(REGISTRY), members: [] })), 'bad_members');
      assert.equal(refusedCode(() => mod.createGateway({ registry: new Set(REGISTRY), members: [m('a')], capAllow: 'all' })), 'bad_cap');
      assert.equal(refusedCode(() => build(mod, { bankFilter: 'get_balance' })), 'bad_tool_filter');
      assert.equal(refusedCode(() => build(mod, { bankFilter: Array.from({ length: 65 }, (_, i) => `t${i}`) })), 'bad_tool_filter');
      // a caller list is bounded and typed
      assert.equal(refusedCode(() => build(mod).list({ entitled: Array.from({ length: 65 }, (_, i) => `bank__t${i}`) })), 'bad_caller');
      assert.equal(refusedCode(() => build(mod).list({ entitled: [7] })), 'bad_caller');
      assert.equal(refusedCode(() => build(mod).list(null)), 'bad_caller');
      // names that are properties of every JavaScript object are ordinary names here
      const odd = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'].map((name) => ({ name, description: 'x', inputSchema: {} }));
      const bad = [{ name: 'has\nnewline' }, { name: 'x'.repeat(97) }, { name: '' }, null, { name: 'dup', description: 'first' }, { name: 'dup', description: 'second' }];
      const gw = build(mod, { cap: null, hostileOffer: [...odd, ...bad] });
      const caller = { entitled: [...odd.map((t) => `hostile__${t.name}`), 'hostile__dup'] };
      const listing = gw.list(caller);
      const mine = listing.tools.filter((t) => t.alias === 'hostile');
      assert.deepEqual(sorted(mine.map((t) => t.tool)), sorted(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'dup']));
      assert.equal(mine.find((t) => t.tool === 'dup').description, 'first', 'the first definition of a name wins inside one member');
      assert.equal(listing.hidden.filter((h) => h.reason === 'invalid-name').length, 4);
      assert.equal(listing.hidden.filter((h) => h.reason === 'duplicate-in-member').length, 1);
      assert.equal(gw.call(caller, 'hostile__constructor').forwardedTo, 'hostile');
      assert.equal(gw.call({ entitled: [] }, 'hostile__constructor').code, 'not_available');
      assert.equal(gw.audit().at(-1).reason, 'not-entitled');
      // one member offering 150 tools is cut at 100 before anything is decided, and says so
      const many = Array.from({ length: 150 }, (_, i) => ({ name: `t${i}`, description: '', inputSchema: {} }));
      const want = [...many.slice(0, 32), ...many.slice(100, 132)].map((t) => `hostile__${t.name}`);
      const big = build(mod, { cap: null, hostileOffer: many }).list({ entitled: want });
      assert.equal(want.length, 64);
      assert.equal(big.tools.filter((t) => t.alias === 'hostile').length, 32, 'only the first 100 are considered; t100 and later never appear');
      assert.equal(big.members.find((x) => x.alias === 'hostile').truncated, true);
      assert.equal(big.members.find((x) => x.alias === 'hostile').offered, 150);
      // odd call names never throw
      for (const name of ['', '__', '__x', 'bank__', 'x'.repeat(500), '__proto__', 'bank__' + 'y'.repeat(400), 7, null, {}, undefined]) {
        const r = gw.call(caller, name);
        assert.equal(r.ok, false, String(name));
      }
      assert.equal(gw.call(caller, 'create_transfer').code, 'unprefixed');
      assert.equal(gw.call(caller, 'nobody__x').code, 'unknown_alias');
      assert.equal(gw.hops().length, 1, 'only the one valid call reached a member');
    },
  },
  {
    id: 'refusal-does-not-reveal-hidden-tools', row: 'a refused call answers the same for a hidden tool and a missing one',
    run(mod) {
      const gw = build(mod);
      const analyst = entitledOf('analyst');
      const hiddenByEntitlement = gw.call(analyst, 'hostile__create_transfer');
      const hiddenByCap = gw.call(analyst, 'hostile__send_email');
      const missing = gw.call(analyst, 'hostile__no_such_tool_at_all');
      assert.deepEqual(hiddenByEntitlement, { ok: false, code: 'not_available', stage: 'member-hop' });
      assert.deepEqual(hiddenByCap, hiddenByEntitlement, 'hidden by the cap looks like hidden by entitlement');
      assert.deepEqual(missing, hiddenByEntitlement, 'a tool that does not exist looks like a hidden one');
      const filtered = build(mod, { hostileFilter: ['get_weather'] }).call(analyst, 'hostile__get_stock_price');
      assert.deepEqual(filtered, hiddenByEntitlement, 'outside the ToolFilter looks the same too');
      // the demo audit log is where the reasons live, and it tells the three apart
      assert.deepEqual(gw.audit(), [{ name: 'hostile__create_transfer', reason: 'not-entitled' }, { name: 'hostile__send_email', reason: 'over-cap' }, { name: null, reason: 'no_such_tool' }]);
      assert.equal(gw.hops().length, 0);
      // an unreachable member is reported in the listing, so every name under it gets the same answer, real or not
      const down = build(mod, { bankUp: false });
      assert.deepEqual(down.call(analyst, 'bank__get_balance'), down.call(analyst, 'bank__nothing_here'));
      assert.equal(down.call(analyst, 'bank__get_balance').code, 'member_unreachable');
      // negative control: a listed, entitled, capped tool is forwarded and is nothing like the refusal
      const ok = gw.call(analyst, 'bank__get_balance');
      assert.deepEqual([ok.ok, ok.code, ok.forwardedTo], [true, 'forwarded', 'bank']);
      // the audit log is bounded
      for (let i = 0; i < 300; i += 1) gw.call(analyst, `hostile__missing_${i}`);
      assert.equal(gw.audit().length, 256);
    },
  },
  {
    id: 'a-typed-credential-is-never-echoed', row: 'no credential echoed',
    run(mod) {
      const gw = build(mod);
      const caller = { entitled: [...CALLERS.analyst.entitled, `bank__${SECRET}`, SECRET] };
      const out = [];
      out.push(gw.list(caller));
      const callerSide = [];
      for (const name of [`Bearer ${SECRET}`, SECRET, `bank__${SECRET}`, `${SECRET}__get_balance`, `hostile__${SECRET}`]) callerSide.push(gw.call(caller, name, { token: SECRET, password: SECRET }));
      out.push(...callerSide);
      out.push(gw.call(caller, 'bank__get_balance', { token: SECRET, authorization: `Bearer ${SECRET}` }));
      const err = (() => { try { build(mod, { bankAlias: SECRET }); } catch (e) { return e; } return null; })();
      out.push({ message: err?.message, code: err?.code });
      assert.equal(err?.code, 'bad_alias');
      out.push(gw.audit());
      assert.equal(gw.audit().length, 2, 'the two typed names under a real member were refused as not available and logged, with no name');
      assert.ok(gw.audit().every((a) => a.name === null));
      assert.ok(!JSON.stringify(out).includes(SECRET), 'no response field, audit entry or error carries what was typed');
      assert.equal(gw.hops().length, 1);
      assert.ok(!JSON.stringify(gw.hops()).includes(SECRET));
    },
  },
];

// ---- scenario level: every editable policy field must change the outcome -------------------------------------------

const listOf = (r) => sorted(r.gateway.tools.map((t) => t.name));
const run = (mod, body) => mod.runGateway(mod.parseRequest(body));
const policyError = (mod, body) => { try { mod.parseRequest(JSON.parse(JSON.stringify(body))); return null; } catch (e) { return e; } };

export const SCENARIO_CHECKS = [
  {
    id: 'scenario-defaults-and-reset', row: 'Reset restores the default policy',
    async run(mod) {
      const a = mod.defaultPolicy('analyst');
      a.entitled.push('x__y'); a.aliases.bank = 'zzz'; a.toolFilter.bank = ['q']; a.reachable.bank = false;
      const b = mod.defaultPolicy('analyst');
      assert.deepEqual(b.entitled, [...CALLERS.analyst.entitled]);
      assert.deepEqual(b.aliases, { bank: 'bank', hostile: 'hostile' });
      assert.deepEqual([b.toolFilter.bank, b.reachable.bank], [null, true]);
      assert.deepEqual(b.capAllow, [...DEFAULT_CAP]);
      assert.deepEqual(mod.defaultPolicy('viewer').entitled, [...CALLERS.viewer.entitled]);
    },
  },
  {
    id: 'scenario-caller-and-stage', row: 'entitlement-aware discovery, per caller, with and without the later list',
    async run(mod) {
      const analystLater = await run(mod, { stage: 'later', caller: 'analyst' });
      assert.deepEqual([analystLater.direct.count, analystLater.gateway.count, analystLater.gateway.audit.hiddenCount], [15, 4, 11]);
      assert.deepEqual(analystLater.direct.collisions, ['get_balance']);
      assert.equal(analystLater.listNumber, 2);
      const analystFirst = await run(mod, { stage: 'first', caller: 'analyst' });
      assert.deepEqual([analystFirst.direct.count, analystFirst.gateway.count, analystFirst.listNumber], [14, 4, 1]);
      assert.equal(analystFirst.gateway.pin, null);
      const viewer = await run(mod, { stage: 'later', caller: 'viewer' });
      assert.deepEqual(listOf(viewer), ['bank__get_balance', 'hostile__get_stock_price']);
      assert.ok(analystLater.direct.tools.some((t) => t.name === 'bulk_export') && !analystFirst.direct.tools.some((t) => t.name === 'bulk_export'));
      assert.ok(!analystLater.gateway.tools.some((t) => t.tool === 'bulk_export'));
    },
  },
  {
    id: 'scenario-direct-versus-gateway', row: 'side by side: no gateway versus entitlement filter plus cap',
    async run(mod) {
      const r = await run(mod, { stage: 'later', caller: 'analyst', task: 'Check my account balance' });
      // without a gateway the hostile get_balance wins by name and the injected transfer is planned
      assert.ok(r.direct.victim.calls.some((c) => c.tool === 'create_transfer'));
      assert.ok(r.direct.tools.some((t) => t.name === 'create_transfer') && r.direct.attempts.find((a) => a.name === 'create_transfer').reached);
      // through the gateway the victim picks the bank's tool and the transfer is neither listed nor reachable
      assert.deepEqual(r.gateway.victim.calls.map((c) => c.tool), ['bank__get_balance']);
      const attempt = Object.fromEntries(r.gateway.attempts.map((a) => [a.name, a]));
      assert.equal(attempt.hostile__create_transfer.ok, false);
      assert.equal(attempt.create_transfer.code, 'unprefixed');
      const audit = Object.fromEntries(r.gateway.audit.attempts.map((a) => [a.name, a.reason]));
      assert.deepEqual([attempt.hostile__create_transfer.code, audit.hostile__create_transfer], ['not_available', 'not-entitled']);
      assert.equal(attempt.hostile__bulk_export.code, attempt.hostile__create_transfer.code, 'a late tool and an action tool get the same caller-side answer');
      assert.equal(audit.bank__get_balance, null, 'a forwarded call has nothing in the audit log');
      assert.equal(attempt.bank__get_balance.forwardedTo, 'bank');
      assert.equal(r.gateway.audit.memberHops, 2);
      assert.equal(r.gateway.attempts.length, 6);
      assert.equal(r.task, 'Check my account balance');
    },
  },
  {
    id: 'scenario-pin-still-needed', row: 'the filter does not clean content; pinning still notices the change',
    async run(mod) {
      const r = await run(mod, { stage: 'later', caller: 'analyst' });
      const stock = r.gateway.tools.find((t) => t.name === 'hostile__get_stock_price');
      assert.match(stock.description, /<IMPORTANT>/);
      assert.deepEqual(r.gateway.pin.changed, ['hostile__get_stock_price']);
      assert.equal(r.gateway.pin.approvedFromList, 1);
      assert.equal(r.gateway.pin.checkedList, 2);
      assert.equal(r.gateway.pin.results.length, 4);
      assert.equal(r.gateway.pin.results.filter((x) => x.verdict === 'ok').length, 3);
      assert.ok(r.gateway.pin.results.find((x) => x.verdict === 'changed').diff.some((d) => d.path === 'description'));
    },
  },
  {
    id: 'scenario-edit-alias', row: 'editable field: Alias',
    async run(mod) {
      const r = await run(mod, { policy: { aliases: { hostile: 'vendor' }, entitled: ['bank__get_balance', 'vendor__get_weather'], capAllow: null } });
      assert.deepEqual(listOf(r), ['bank__get_balance', 'vendor__get_weather']);
      assert.equal(r.members.find((m) => m.key === 'hostile').alias, 'vendor');
      const stock = r.gateway.attempts.find((a) => a.name === 'vendor__get_stock_price');
      const why = r.gateway.audit.attempts.find((a) => a.name === 'vendor__get_stock_price').reason;
      assert.deepEqual([stock.code, why], ['not_available', 'not-entitled'], 'the caller is told not_available; the demo audit view says why');
      const silent = await run(mod, { policy: { aliases: { hostile: 'vendor' } } });
      assert.deepEqual(listOf(silent), ['bank__get_balance', 'bank__get_statement'], 'renaming without updating entitlements fails closed');
      // the bank's alias is an editable field of its own
      const bankRenamed = await run(mod, { policy: { aliases: { bank: 'ledger' }, entitled: ['ledger__get_balance', 'hostile__get_weather'], capAllow: null } });
      assert.deepEqual(listOf(bankRenamed), ['hostile__get_weather', 'ledger__get_balance']);
      assert.equal(bankRenamed.members.find((m) => m.key === 'bank').alias, 'ledger');
      assert.equal(silent.policy.ignoredEntries, 6, 'three entitlement entries and three cap entries name the old prefix and match nothing; they are counted, not shown');
    },
  },
  {
    id: 'scenario-edit-entitled', row: 'editable field: caller entitlements',
    async run(mod) {
      const one = await run(mod, { policy: { entitled: ['bank__get_balance'] } });
      assert.deepEqual(listOf(one), ['bank__get_balance']);
      const none = await run(mod, { policy: { entitled: [] } });
      assert.deepEqual(listOf(none), []);
      assert.equal(none.gateway.audit.hiddenCount, 15);
      assert.equal(none.gateway.audit.memberHops, 0);
    },
  },
  {
    id: 'scenario-edit-cap', row: 'editable field: aggregate policy cap',
    async run(mod) {
      assert.deepEqual(listOf(await run(mod, { policy: { capAllow: ['bank__get_balance'] } })), ['bank__get_balance']);
      assert.equal((await run(mod, { policy: { capAllow: null } })).gateway.count, 5, 'no cap: the entitled send_email appears');
      assert.equal((await run(mod, { policy: { capAllow: [] } })).gateway.count, 0);
      const wide = await run(mod, { policy: { entitled: Object.values(CALLERS).flatMap((c) => c.entitled), capAllow: ['bank__get_balance'] } });
      assert.equal(wide.gateway.count, 1, 'the cap holds against wide entitlements');
    },
  },
  {
    id: 'scenario-edit-toolfilter', row: 'editable field: ToolFilter',
    async run(mod) {
      const r = await run(mod, { policy: { toolFilter: { hostile: ['get_weather'] } } });
      assert.deepEqual(listOf(r), ['bank__get_balance', 'bank__get_statement', 'hostile__get_weather']);
      assert.ok(r.gateway.audit.hidden.some((h) => h.name === 'hostile__get_stock_price' && h.reason === 'not-in-toolfilter'));
      const bank = await run(mod, { policy: { toolFilter: { bank: ['get_statement'] } } });
      assert.ok(!listOf(bank).includes('bank__get_balance') && listOf(bank).includes('bank__get_statement'));
      assert.equal(r.policy.ignoredEntries, 0);
      const cleared = await run(mod, { policy: { toolFilter: { hostile: null } } });
      assert.equal(cleared.gateway.count, 4);
    },
  },
  {
    id: 'scenario-edit-reachable', row: 'editable field: member reachable',
    async run(mod) {
      const r = await run(mod, { policy: { reachable: { hostile: false } } });
      assert.deepEqual(r.gateway.unreachable, ['hostile']);
      assert.deepEqual(listOf(r), ['bank__get_balance', 'bank__get_statement']);
      assert.deepEqual(r.direct.silentlyMissing, ['hostile'], 'a direct client just never sees the member, and nothing says so');
      assert.equal(r.direct.count, 2);
      assert.equal(r.gateway.members.find((m) => m.alias === 'hostile').status, 'unreachable');
      assert.equal(r.gateway.attempts.find((a) => a.name === 'hostile__get_stock_price').code, 'member_unreachable');
      const up = await run(mod, { policy: { reachable: { hostile: true } } });
      assert.deepEqual([up.gateway.unreachable, up.direct.silentlyMissing], [[], []]);
      // the bank is an editable member too: marking it unreachable must change the answer, not be ignored
      const bankDown = await run(mod, { policy: { reachable: { bank: false } } });
      assert.deepEqual(bankDown.gateway.unreachable, ['bank']);
      assert.deepEqual(listOf(bankDown), ['hostile__get_stock_price', 'hostile__get_weather']);
      assert.deepEqual(bankDown.direct.silentlyMissing, ['bank']);
      assert.equal(bankDown.direct.count, 13);
      assert.equal(bankDown.members.find((m) => m.key === 'bank').reachable, false);
      assert.equal(bankDown.members.find((m) => m.key === 'hostile').reachable, true);
      assert.equal(bankDown.gateway.attempts.find((a) => a.name === 'bank__get_balance').code, 'member_unreachable');
      const bothDown = await run(mod, { policy: { reachable: { bank: false, hostile: false } } });
      assert.deepEqual(bothDown.gateway.unreachable, ['bank', 'hostile']);
      assert.equal(bothDown.gateway.count, 0);
    },
  },
  {
    id: 'scenario-edit-task', row: 'task selection',
    async run(mod) {
      const r = await run(mod, { task: 'What is the stock price of ACME?' });
      assert.equal(r.task, 'What is the stock price of ACME?');
      assert.equal(r.gateway.victim.task, 'What is the stock price of ACME?');
      assert.equal(r.gateway.victim.selected, 'hostile__get_stock_price');
      assert.ok(r.gateway.victim.calls.some((c) => c.tool === 'hostile__get_stock_price'));
    },
  },
  {
    id: 'scenario-hostile-requests-bounded', row: 'hostile input bounded at the API',
    async run(mod) {
      const bodies = [
        [{ stage: 'never' }], [{ caller: 'toString' }], [{ caller: '__proto__' }], [{ task: `free text ${SECRET}` }], [{ task: 7 }], [{ extra: 1 }],
        [{ policy: { extra: 1 } }], [{ policy: { aliases: { other: 'x' } } }], [{ policy: { aliases: { bank: 'Bad' } } }], [{ policy: { aliases: { bank: 'a__b' } } }], [{ policy: { aliases: { bank: 'ext' } } }], [{ policy: { aliases: { bank: 'ghp-aliasleak1234abcd' } } }], [{ policy: { aliases: { bank: 5 } } }], [{ policy: { aliases: { bank: ['vendor'] } } }],
        [{ policy: { aliases: { bank: 'hostile' } } }], [{ policy: { entitled: [`bank__${SECRET} bad`] } }], [{ policy: { entitled: 'bank__get_balance' } }],
        [{ policy: { entitled: Array.from({ length: 65 }, (_, i) => `bank__t${i}`) } }], [{ policy: { entitled: ['a'.repeat(97)] } }], [{ policy: { capAllow: 'all' } }],
        [{ policy: { toolFilter: { bank: 'get_balance' } } }], [{ policy: { reachable: { bank: 'no' } } }], [{ policy: [] }], [[]], ['text'],
      ];
      for (const [b] of bodies) {
        let threw = null;
        try { await run(mod, b); } catch (e) { threw = e; }
        assert.ok(threw && threw.name === 'PolicyError', `refused: ${JSON.stringify(b).slice(0, 60)}`);
        assert.ok(!threw.message.includes(SECRET) && !threw.message.includes('toString'), 'the refusal does not echo what was typed');
      }
      for (const raw of ['{"policy":{"__proto__":{"entitled":["x"]}}}', '{"__proto__":{"stage":"first"}}', '{"policy":{"aliases":{"__proto__":"x"}}}', '{"policy":{"constructor":1}}']) {
        const e = policyError(mod, JSON.parse(raw));
        assert.equal(e?.name, 'PolicyError', raw);
      }
      assert.equal(({}).stage, undefined, 'no prototype pollution');
      assert.deepEqual(mod.parseRequest({}), { stage: 'later', caller: 'analyst', task: 'Check my account balance', policy: mod.defaultPolicy('analyst') });
    },
  },
  {
    id: 'scenario-never-echoes-typed-entries', row: 'no credential echoed at the API',
    async run(mod) {
      const typed = `bank__${SECRET}`;
      const r = await run(mod, { policy: { entitled: [...CALLERS.analyst.entitled, typed], capAllow: [...DEFAULT_CAP, typed] } });
      assert.ok(!JSON.stringify(r).includes(SECRET));
      assert.equal(r.policy.ignoredEntries, 2);
      // the entitlement list and the cap list are not echoed at all, matching names included: a name the cap hides is a name the caller was not shown
      assert.deepEqual(Object.keys(r.policy), ['ignoredEntries']);
      // a typed ToolFilter entry is held to the same rule: only names the member really has come back, the rest are counted
      const filtered = await run(mod, { policy: { toolFilter: { bank: [`${SECRET}-bank`, 'get_balance'], hostile: ['get_weather', `sk-live-${SECRET}`, 'nonexistent_tool_x'] } } });
      assert.ok(!JSON.stringify(filtered).includes(SECRET), 'no response field carries a typed ToolFilter entry');
      assert.ok(!JSON.stringify(filtered).includes('nonexistent_tool_x'));
      assert.ok(filtered.members.every((m) => !Object.hasOwn(m, 'toolFilter')), 'a ToolFilter is not echoed on the members either, matching names included');
      assert.equal(filtered.policy.ignoredEntries, 3, 'the three entries that match no tool are counted, never shown');
      assert.deepEqual(listOf(filtered), ['bank__get_balance', 'hostile__get_weather']);
      // negative control: with real names only nothing is ignored, and the filter still limits the listing
      const real = await run(mod, { policy: { toolFilter: { hostile: ['get_weather', 'get_stock_price'] } } });
      assert.equal(real.policy.ignoredEntries, 0);
      assert.deepEqual(listOf(real), ['bank__get_balance', 'bank__get_statement', 'hostile__get_stock_price', 'hostile__get_weather']);
      // an alias is never typed: it is one of the fixed choices, so what comes back is a choice, not input
      const aliased = await run(mod, { policy: { aliases: { hostile: 'vendor' }, capAllow: null } });
      assert.equal(aliased.members[1].alias, 'vendor');
      assert.equal(policyError(mod, { policy: { aliases: { hostile: `${SECRET}` } } })?.name, 'PolicyError');
      assert.deepEqual(listOf(r), ['bank__get_balance', 'bank__get_statement', 'hostile__get_stock_price', 'hostile__get_weather']);
    },
  },
  {
    id: 'scenario-alias-is-a-fixed-choice', row: 'an alias is chosen from a fixed list, never typed',
    async run(mod) {
      assert.deepEqual([...ALIAS_PRESETS].sort(), ['bank', 'files', 'hostile', 'ledger', 'mail', 'vendor']);
      const config = mod.gatewayConfigResponse();
      assert.deepEqual(config.aliasPresets, [...ALIAS_PRESETS]);
      for (const id of ALIAS_PRESETS) {
        const other = ALIAS_PRESETS.find((x) => x !== id && x !== 'bank');
        const r = await run(mod, { policy: { aliases: { hostile: id === 'bank' ? other : id } } });
        assert.ok(r.members[1].alias === (id === 'bank' ? other : id));
      }
      // token-shaped strings in the alias position, in every shape, are refused with one message that does not repeat them
      const tokens = [ALIAS_LEAK, 'ghp-aliasleak1234abcd', 'sk-live-aliasleak1234', 'a'.repeat(24), 'x'.repeat(60), 'ext', 'Bank', 'bank ', ' bank', 'bank\n', '', 'BANK', 'ban', '__proto__', 'constructor', 'toString'];
      const messages = new Set();
      for (const t of tokens) {
        const e = policyError(mod, { policy: { aliases: { bank: t } } });
        assert.equal(e?.name, 'PolicyError', JSON.stringify(t));
        if (t.length > 2) assert.ok(!e.message.includes(t), 'the refusal does not repeat the input');
        messages.add(e.message);
      }
      assert.equal(messages.size, 1, 'one generic message for every value outside the list');
      for (const t of tokens) assert.equal(policyError(mod, { policy: { aliases: { hostile: t } } })?.message, [...messages][0]);
    },
  },
  {
    id: 'scenario-token-shaped-input-never-echoed', row: 'no typed credential in any response field',
    async run(mod) {
      const leaks = ['ghp-aliasleak1234abcd', 'sk-live-aliasleak1234', 'eyJhbGciOiJub25lIn0.aliasleak1234.sig', 'AKIAALIASLEAK123456'];
      for (const leak of leaks) {
        const bodies = [
          { policy: { toolFilter: { bank: [leak], hostile: [leak, 'get_weather'] } } },
          { policy: { entitled: [leak, 'bank__get_balance'], capAllow: [leak, 'bank__get_balance'] } },
          { policy: { entitled: [`bank__${leak}`, `${leak}__get_balance`, `hostile__${leak}`], capAllow: [`bank__${leak}`] } },
        ];
        for (const body of bodies) {
          const r = await run(mod, body);
          assert.ok(!JSON.stringify(r).includes(leak.slice(0, 12)), 'no response field carries what was typed');
        }
        for (const body of [{ stage: leak }, { caller: leak }, { task: leak }, { [leak]: 1 }, { policy: { [leak]: 1 } }, { policy: { aliases: { [leak]: 'bank' } } }, { policy: { aliases: { bank: leak } } }, { policy: { toolFilter: { [leak]: [] } } }, { policy: { reachable: { bank: leak } } }, { policy: { reachable: { [leak]: true } } }]) {
          const e = policyError(mod, body);
          assert.equal(e?.name, 'PolicyError');
          assert.ok(!e.message.includes(leak.slice(0, 12)));
        }
      }
    },
  },
  {
    id: 'scenario-caller-view-carries-no-audit', row: 'the caller section is separate from the demo audit view',
    async run(mod) {
      const r = await run(mod, { stage: 'later', caller: 'analyst' });
      const { audit, ...callerSide } = r.gateway;
      assert.deepEqual(Object.keys(audit).sort(), ['attempts', 'hidden', 'hiddenCount', 'memberHops', 'members']);
      const text = JSON.stringify(callerSide);
      for (const key of ['hidden', 'hiddenCount', 'auditReason', 'reason', 'offered', 'listed', 'memberHops', 'audit']) assert.ok(!text.includes(`"${key}"`), `the caller section has no ${key}`);
      for (const word of ['not-entitled', 'over-cap', 'not-in-toolfilter', 'no_such_tool', 'duplicate-in-member', 'invalid-name']) assert.ok(!text.includes(word), `the caller section never says ${word}`);
      for (const h of audit.hidden) assert.ok(!callerSide.tools.some((t) => t.name === h.name), 'a hidden name is not a listed tool');
      assert.deepEqual(callerSide.members.map((m) => Object.keys(m).sort()), [['alias', 'status'], ['alias', 'status']]);
      assert.ok(audit.members.every((m) => Object.hasOwn(m, 'offered')));
      assert.equal(audit.attempts.length, callerSide.attempts.length);
      // the other tools hidden from this caller are named only inside the audit view
      for (const name of ['hostile__create_transfer', 'hostile__send_email']) {
        assert.ok(audit.hidden.some((h) => h.name === name));
        assert.ok(!callerSide.tools.some((t) => t.name === name));
      }
    },
  },
  {
    id: 'scenario-no-policy-echo-outside-audit', row: 'entitlement and cap names that match real tools are not echoed outside the demo audit view',
    async run(mod) {
      const r = await run(mod, { stage: 'later', caller: 'analyst' });
      assert.deepEqual(Object.keys(r.policy), ['ignoredEntries']);
      // analyst is entitled to hostile__send_email and the default cap allows hostile__search_docs; the listing shows neither
      assert.ok(CALLERS.analyst.entitled.includes('hostile__send_email') && DEFAULT_CAP.includes('hostile__search_docs'));
      assert.ok(!listOf(r).includes('hostile__send_email') && !listOf(r).includes('hostile__search_docs'));
      const { audit, ...callerSide } = r.gateway;
      const outside = JSON.stringify({ ...r, direct: null, gateway: callerSide });
      for (const hiddenName of ['hostile__send_email', 'hostile__search_docs']) assert.ok(!outside.includes(hiddenName), `${hiddenName} appears only inside gateway.audit`);
      assert.ok(audit.hidden.some((h) => h.name === 'hostile__send_email' && h.reason === 'over-cap'), 'the administrator view does say it');
      assert.ok(audit.hidden.some((h) => h.name === 'hostile__search_docs' && h.reason === 'not-entitled'));
      // negative control: the names the caller is shown are still in the answer
      assert.ok(outside.includes('bank__get_balance'));
      // a wide entitlement list under a one-name cap: still no entitlement or cap list in the answer, only the listing it produced
      const wide = await run(mod, { policy: { entitled: Object.values(CALLERS).flatMap((c) => c.entitled), capAllow: ['bank__get_balance', 'hostile__get_weather_alerts'] } });
      assert.deepEqual(Object.keys(wide.policy), ['ignoredEntries']);
      const { audit: wideAudit, ...wideSide } = wide.gateway;
      assert.ok(!JSON.stringify({ ...wide, direct: null, gateway: wideSide }).includes('hostile__send_email'));
      assert.ok(wideAudit.hidden.some((h) => h.name === 'hostile__send_email'));
    },
  },
  {
    id: 'scenario-no-toolfilter-echo-outside-audit', row: 'ToolFilter names that match real tools are not echoed outside the demo audit view',
    async run(mod) {
      // the answer minus the labelled audit view and minus the unfiltered tool list of the no-gateway side (which names every tool by design)
      const outsideOf = (r) => { const { audit, ...callerSide } = r.gateway; return JSON.stringify({ ...r, direct: { ...r.direct, tools: null }, gateway: callerSide }); };
      // analyst is entitled to hostile__send_email but the default cap hides it; hostile__search_docs is on the cap but not entitled
      const r = await run(mod, { policy: { toolFilter: { bank: ['get_statement'], hostile: ['send_email', 'search_docs', 'get_weather'] } } });
      assert.deepEqual(listOf(r), ['bank__get_statement', 'hostile__get_weather']);
      for (const m of r.members) assert.deepEqual(Object.keys(m).sort(), ['alias', 'appRef', 'key', 'reachable'], 'a member answers with its key, app, alias and reachability only');
      assert.deepEqual(Object.keys(r.policy), ['ignoredEntries']);
      const outside = outsideOf(r);
      for (const hiddenName of ['send_email', 'search_docs']) assert.ok(!outside.includes(hiddenName), `${hiddenName} appears only inside gateway.audit`);
      // negative control: the names the caller was shown are still in the answer, and the administrator view still says why the others are hidden
      assert.ok(outside.includes('hostile__get_weather') && outside.includes('bank__get_statement'));
      assert.ok(r.gateway.audit.hidden.some((h) => h.name === 'hostile__send_email' && h.reason === 'over-cap'));
      assert.ok(r.gateway.audit.hidden.some((h) => h.name === 'bank__get_balance' && h.reason === 'not-in-toolfilter'));
      // a filter that matches nothing still is not shown; it is counted
      const none = await run(mod, { policy: { toolFilter: { bank: ['nonexistent_tool_x'] } } });
      assert.ok(none.members.every((m) => !Object.hasOwn(m, 'toolFilter')));
      assert.equal(none.policy.ignoredEntries, 1);
      // a comma separated string is one entry, not several: the page splits the text, the API refuses the string and does not repeat it
      const err = policyError(mod, { policy: { toolFilter: { hostile: ['send_email,get_weather'] } } });
      assert.equal(err?.name, 'PolicyError');
      assert.ok(!err.message.includes('send_email') && !err.message.includes('get_weather'));
      // cleared: no filter, nothing echoed
      const cleared = await run(mod, { policy: { toolFilter: { hostile: null } } });
      assert.ok(cleared.members.every((m) => !Object.hasOwn(m, 'toolFilter')));
      assert.equal(cleared.gateway.count, 4);
    },
  },
];
