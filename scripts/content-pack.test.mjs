import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PACK_PATH, buildPack, serialize } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

test('content-pack.json is exactly what the generator produces (run: node scripts/build-content-pack.mjs)', () => {
  assert.equal(fs.readFileSync(PACK_PATH, 'utf8'), serialize(buildPack()), 'content-pack.json is stale; regenerate it and commit the result');
});

test('the generator is deterministic', () => assert.equal(serialize(buildPack()), serialize(buildPack())));

test('content-pack.json validates against docs/content-pack.schema.json', () => {
  assert.deepEqual(validatePack(JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'))), []);
});

test('the validator rejects a broken pack', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['no-such-term'];
  delete pack.title;
  assert.ok(validatePack(pack).length >= 2);
});

test('the pack has the eight required terms and no source URLs that are not verified', () => {
  const pack = buildPack();
  for (const id of ['tool-poisoning', 'tool-shadowing', 'rug-pull', 'trust-on-first-use', 'input-schema-exfil-sink', 'result-based-injection', 'credential-harvest', 'pinning']) assert.ok(pack.glossary.some((g) => g.id === id), id);
  assert.deepEqual(pack.sources, []);
  assert.ok(pack.stories.some((s) => s.id === 'S05'));
});

test('a commit is recorded only when passed', () => {
  assert.equal(buildPack().source, undefined);
  assert.equal(buildPack({ commit: 'abc1234' }).source.commit, 'abc1234');
});

test('the gateway cards, story and why-it-matters document are in the pack and labelled as Ping claims', () => {
  const pack = buildPack();
  const gw = pack.cards.find((c) => c.id === 'gateway');
  assert.equal(gw.story, 'S36');
  assert.match(gw.description, /UNVERIFIED on our tenant/);
  assert.ok(pack.stories.some((s) => s.id === 'S36'));
  for (const id of ['mcp-aggregate', 'entitlement-aware-discovery', 'aggregate-policy-cap', 'alias-prefix']) assert.ok(pack.glossary.some((g) => g.id === id), id);
  for (const id of ['entitlement-aware-discovery', 'aggregate-policy-cap']) assert.match(pack.glossary.find((g) => g.id === id).definition, /UNVERIFIED on our tenant/);
  const doc = pack.documents.find((d) => d.id === 'gateway-why-it-matters');
  assert.match(doc.title, /Ping claims, UNVERIFIED/);
  assert.ok(fs.existsSync(new URL(`../${doc.path}`, import.meta.url)));
});

test('the why-it-matters document and the page carry the same Challenge, Technical and Business text', () => {
  const md = fs.readFileSync(new URL('../docs/gateway-why-it-matters.md', import.meta.url), 'utf8');
  const why = JSON.parse(fs.readFileSync(new URL('../web/src/data/whyItMatters.json', import.meta.url), 'utf8'));
  assert.deepEqual(why.rows.map((r) => r.slide), [36, 37]);
  for (const r of why.rows) {
    assert.ok(md.includes(`${r.feature} (slide ${r.slide})`));
    for (const k of ['challenge', 'technical', 'business']) assert.ok(md.includes(`- ${k[0].toUpperCase()}${k.slice(1)}: ${r[k]}`), `${r.slide} ${k}`);
  }
  assert.match(md, /UNVERIFIED on our tenant/);
  assert.match(md, /not our measurement/);
});
