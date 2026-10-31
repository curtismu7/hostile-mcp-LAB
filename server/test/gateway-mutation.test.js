// Mutation test. Each mutant is the real source with ONE behaviour broken. The same named checks that pass on the real
// source (gateway.test.js) must fail on every mutant, and the check that catches it is named here. A mutant that
// survives (no check fails) fails this test. The mutated copy is written to a temp directory; the repo is not touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CHECKS, SCENARIO_CHECKS } from './gateway-checks.js';

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// [id, file, find, replace, the checks that must catch it]
const GATEWAY = [
  ['drop-the-alias-prefix', "const name = `${m.alias}${SEP}${t.name}`;", 'const name = t.name;', ['prefix-by-alias']],
  ['ignore-toolfilter', "if (member.filter !== null && !member.filter.has(tool)) return 'not-in-toolfilter';", '', ['toolfilter-limits-a-member']],
  ['ignore-entitlement', "if (!entitled.has(`${member.alias}${SEP}${tool}`)) return 'not-entitled';", '', ['entitlement-filters-the-listing']],
  ['invert-entitlement', "if (!entitled.has(`${member.alias}${SEP}${tool}`)) return 'not-entitled';", "if (entitled.has(`${member.alias}${SEP}${tool}`)) return 'not-entitled';", ['entitlement-filters-the-listing']],
  ['ignore-the-cap', 'if (cap !== null && !cap.has(', 'if (false && !cap.has(', ['cap-on-the-listing']],
  ['no-recheck-at-the-member-hop', 'const reason = decide(member, tool, entitled);\n    if (reason) return refuse(reason', 'const reason = null;\n    if (reason) return refuse(reason', ['cap-enforced-again-at-the-member-hop']],
  ['split-at-the-last-separator', 'const at = name.indexOf(SEP);', 'const at = name.lastIndexOf(SEP);', ['collision-and-spoof-disambiguated']],
  ['drop-unreachable-report', "status.push({ alias: m.alias, status: 'unreachable', offered: null, listed: 0 }); continue;", 'continue;', ['unreachable-member-reported-not-dropped']],
  ['call-through-an-unreachable-member', "if (!member.reachable) return refuse('member_unreachable', 'member-hop', name);", '', ['unreachable-member-reported-not-dropped']],
  ['allow-a-duplicate-alias', "if (byAlias.has(m.alias)) throw new GatewayConfigError('duplicate_alias');", '', ['hostile-configuration-is-bounded']],
  ['allow-an-unregistered-app', ' || !registry.has(m.appRef)', '', ['unknown-app-refused']],
  ['loosen-the-alias-pattern', 'const ALIAS = /^[a-z][a-z0-9-]{0,23}$/;', 'const ALIAS = /^[a-z_][a-z0-9_-]{0,23}$/;', ['hostile-configuration-is-bounded']],
  ['clean-the-description', "description: t.description ?? ''", "description: String(t.description ?? '').replace(/<IMPORTANT>[\\s\\S]*?<\\/IMPORTANT>/g, '')", ['entitled-caller-still-sees-the-poison', 'collision-and-spoof-disambiguated']],
  ['echo-the-typed-name', 'name: known })', 'name })', ['a-typed-credential-is-never-echoed']],
  ['unbounded-tools-per-member', 'm.tools.slice(0, LIMITS.maxToolsPerMember)', 'm.tools', ['hostile-configuration-is-bounded']],
  ['unbounded-caller-list', 'v.length <= LIMITS.maxListEntries && ', '', ['hostile-configuration-is-bounded']],
  ['keep-duplicate-tool-names', "if (seen.has(t.name)) { hidden.push({ name, alias: m.alias, reason: 'duplicate-in-member' }); continue; }", '', ['hostile-configuration-is-bounded']],
  ['accept-unprefixed-calls', "if (at < 1) return refuse('unprefixed', 'gateway');", '', ['hostile-configuration-is-bounded']],
];

const SCENARIO = [
  ['ignore-edited-aliases', 'policy.aliases[k] = v;', '', ['scenario-edit-alias']],
  ['ignore-edited-entitlements', "policy.entitled = nameList(p.get('entitled'), 'entitled');", "nameList(p.get('entitled'), 'entitled');", ['scenario-edit-entitled']],
  ['ignore-edited-cap', "policy.capAllow = p.get('capAllow') === null ? null : nameList(p.get('capAllow'), 'capAllow');", "p.get('capAllow') === null ? null : nameList(p.get('capAllow'), 'capAllow');", ['scenario-edit-cap']],
  ['ignore-edited-toolfilter', "policy.toolFilter[k] = v === null ? null : nameList(v, 'a tool filter');", "if (v !== null) nameList(v, 'a tool filter');", ['scenario-edit-toolfilter']],
  ['ignore-edited-reachability', 'policy.reachable[k] = v;', '', ['scenario-edit-reachable']],
  ['ignore-the-caller', 'const policy = defaultPolicy(caller);', "const policy = defaultPolicy('analyst');", ['scenario-caller-and-stage']],
  ['ignore-the-stage', 'const current = second ?? first;', 'const current = first;', ['scenario-caller-and-stage']],
  ['skip-the-pin-check', 'if (second) {\n      const gw1', 'if (false) {\n      const gw1', ['scenario-pin-still-needed']],
  ['echo-unmatched-entries', 'entitled: policy.entitled.filter((n) => known.has(n)),', 'entitled: policy.entitled,', ['scenario-never-echoes-typed-entries']],
  ['accept-unknown-fields', "if (!allow.has(k)) throw new PolicyError(`${what} has a field this simulation does not know`);", '', ['scenario-hostile-requests-bounded']],
  ['accept-free-text-tasks', "typeof task !== 'string' || !TASKS.includes(task)", "typeof task !== 'string'", ['scenario-hostile-requests-bounded']],
  ['ignore-the-chosen-task', 'return { stage, caller, task, policy };', 'return { stage, caller, task: TASKS[2], policy };', ['scenario-edit-task']],
  ['direct-view-ignores-reachability', 'if (!policy.reachable[key]) { silentlyMissing.push(key); continue; }', '', ['scenario-edit-reachable']],
  ['mutable-defaults', 'aliases: { ...DEFAULT_ALIASES },', 'aliases: DEFAULT_ALIASES_SHARED,', ['scenario-defaults-and-reset']],
];

let dir;
const tmp = () => (dir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'hostile-mcp-mutants-')));
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// The real source with imports pointed back at the repo, so only the one mutated file differs.
function load(file, source, tag) {
  const abs = source.replace(/from '\.\/([\w-]+\.js)'/g, (_m, f) => `from '${pathToFileURL(path.join(SRC, f)).href}'`);
  const out = path.join(tmp(), `${tag}-${file}`);
  fs.writeFileSync(out, abs);
  return import(`${pathToFileURL(out).href}?m=${tag}`);
}
async function failures(checks, mod) {
  const failed = [];
  for (const c of checks) { try { await c.run(mod); } catch { failed.push(c.id); } }
  return failed;
}

test('control: the unmutated copy, loaded the same way, passes every check', async () => {
  assert.deepEqual(await failures(CHECKS, await load('gateway.js', read('gateway.js'), 'control')), []);
  const scenarioMod = await load('gateway-scenario.js', read('gateway-scenario.js'), 'control');
  assert.deepEqual(await failures(SCENARIO_CHECKS, scenarioMod), []);
});

for (const [id, find, replace, mustFail] of GATEWAY) {
  test(`gateway mutant ${id} is caught by ${mustFail.join(' or ')}`, async () => {
    const source = read('gateway.js');
    assert.equal(source.split(find).length - 1, 1, 'the text to mutate occurs exactly once');
    const failed = await failures(CHECKS, await load('gateway.js', source.replace(find, () => replace), id));
    assert.ok(failed.length > 0, `mutant ${id} survived`);
    assert.ok(mustFail.some((m) => failed.includes(m)), `${id} was caught by ${failed.join(', ')}, not by ${mustFail.join(' or ')}`);
  });
}

for (const [id, find, replace, mustFail] of SCENARIO) {
  test(`scenario mutant ${id} is caught by ${mustFail.join(' or ')}`, async () => {
    const source = read('gateway-scenario.js');
    assert.equal(source.split(find).length - 1, 1, 'the text to mutate occurs exactly once');
    const mutated = id === 'mutable-defaults' ? `const DEFAULT_ALIASES_SHARED = { bank: 'bank', hostile: 'hostile' };\n${source.replace(find, () => replace)}` : source.replace(find, () => replace);
    const failed = await failures(SCENARIO_CHECKS, await load('gateway-scenario.js', mutated, id));
    assert.ok(failed.length > 0, `mutant ${id} survived`);
    assert.ok(mustFail.some((m) => failed.includes(m)), `${id} was caught by ${failed.join(', ')}, not by ${mustFail.join(' or ')}`);
  });
}
