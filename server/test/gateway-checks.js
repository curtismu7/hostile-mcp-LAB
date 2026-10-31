// The assertions behind the gateway tests, as named checks over a module. gateway.test.js runs them against the real
// source; gateway-mutation.test.js runs the same checks against mutated copies of the source and requires each mutant
// to be caught by a named check. Each check says which row of the feature test plan (PROMPT-ID4AI-H2 section 9) it
// covers: "MCP Aggregate" or "MCP Catalog (entitlement part)", or the hostile-server tricks the lab adds, and each pairs
// real counts with a negative control. Every Ping product claim modelled here is UNVERIFIED on our tenant.
import assert from 'node:assert/strict';
import { APP_REFS, CALLERS, DEFAULT_CAP, REGISTRY, SPOOF_TOOL, LATE_TOOL, hostileCatalog, memberTools } from '../src/gateway-fixtures.js';
import { rugPullTool } from '../src/mcp/tools.js';

const SECRET = 'SECRET_TOKEN_123';
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
      const analyst = build(mod).call(entitledOf('analyst'), 'hostile__bank__get_balance');
      assert.deepEqual([analyst.ok, analyst.code], [false, 'not-entitled']);
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
      assert.deepEqual([refused.ok, refused.code, refused.stage], [false, 'over-cap', 'member-hop']);
      assert.equal(gw.hops().length, 0, 'the member received nothing');
      const viewer = gw.call(entitledOf('viewer'), 'bank__get_statement');
      assert.deepEqual([viewer.ok, viewer.code, viewer.stage], [false, 'not-entitled', 'member-hop']);
      assert.equal(gw.hops().length, 0);
      // a tool nobody listed, guessed by name, is refused the same way
      assert.equal(gw.call(analyst, 'hostile__create_transfer').code, 'not-entitled');
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
      assert.equal(filtered.call(caller, 'hostile__create_transfer').code, 'not-in-toolfilter');
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
      assert.equal(later.call(entitledOf('analyst'), 'hostile__bulk_export').code, 'not-entitled');
      assert.equal(build(mod, { list: 1 }).call(entitledOf('analyst'), 'hostile__bulk_export').code, 'no_such_tool');
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
      assert.deepEqual(sorted(Object.keys(gw)), ['aliases', 'call', 'hops', 'list'], 'there is no unfiltered way to list');
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
      assert.equal(gw.call({ entitled: [] }, 'hostile__constructor').code, 'not-entitled');
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
    id: 'a-typed-credential-is-never-echoed', row: 'no credential echoed',
    run(mod) {
      const gw = build(mod);
      const caller = { entitled: [...CALLERS.analyst.entitled, `bank__${SECRET}`, SECRET] };
      const out = [];
      out.push(gw.list(caller));
      for (const name of [`Bearer ${SECRET}`, SECRET, `bank__${SECRET}`, `${SECRET}__get_balance`, `hostile__${SECRET}`]) out.push(gw.call(caller, name, { token: SECRET, password: SECRET }));
      out.push(gw.call(caller, 'bank__get_balance', { token: SECRET, authorization: `Bearer ${SECRET}` }));
      const err = (() => { try { build(mod, { bankAlias: SECRET }); } catch (e) { return e; } return null; })();
      out.push({ message: err?.message, code: err?.code });
      assert.equal(err?.code, 'bad_alias');
      assert.ok(!JSON.stringify(out).includes(SECRET), 'no response field or error carries what was typed');
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
      assert.deepEqual([analystLater.direct.count, analystLater.gateway.count, analystLater.gateway.hiddenCount], [15, 4, 11]);
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
      assert.equal(attempt.bank__get_balance.forwardedTo, 'bank');
      assert.equal(r.gateway.memberHops, 2);
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
      const r = await run(mod, { policy: { aliases: { hostile: 'ext' }, entitled: ['bank__get_balance', 'ext__get_weather'], capAllow: null } });
      assert.deepEqual(listOf(r), ['bank__get_balance', 'ext__get_weather']);
      assert.equal(r.members.find((m) => m.key === 'hostile').alias, 'ext');
      assert.equal(r.gateway.attempts.find((a) => a.name === 'ext__get_stock_price').code, 'not-entitled');
      const silent = await run(mod, { policy: { aliases: { hostile: 'ext' } } });
      assert.deepEqual(listOf(silent), ['bank__get_balance', 'bank__get_statement'], 'renaming without updating entitlements fails closed');
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
      assert.equal(none.gateway.hiddenCount, 15);
      assert.equal(none.gateway.memberHops, 0);
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
      assert.ok(r.gateway.hidden.some((h) => h.name === 'hostile__get_stock_price' && h.reason === 'not-in-toolfilter'));
      const bank = await run(mod, { policy: { toolFilter: { bank: ['get_statement'] } } });
      assert.ok(!listOf(bank).includes('bank__get_balance') && listOf(bank).includes('bank__get_statement'));
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
        [{ policy: { extra: 1 } }], [{ policy: { aliases: { other: 'x' } } }], [{ policy: { aliases: { bank: 'Bad' } } }], [{ policy: { aliases: { bank: 'a__b' } } }],
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
      assert.equal(r.policy.entitled.length, 5);
      assert.deepEqual(listOf(r), ['bank__get_balance', 'bank__get_statement', 'hostile__get_stock_price', 'hostile__get_weather']);
    },
  },
];
