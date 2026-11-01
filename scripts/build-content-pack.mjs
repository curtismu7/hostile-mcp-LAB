#!/usr/bin/env node
/**
 * Generates content-pack.json (repo root). Format: docs/content-pack.schema.json (a copy of the ID-JAG kit's schema).
 * Glossary from content/terms.json; cards from the web pages and the stories in web/src/data/stories.
 * Deterministic: lists sorted by id, 2-space JSON, no timestamps. The git commit is recorded only when passed
 * (--commit=<sha>), so a plain run is reproducible.
 *
 * Sources: none. The only URLs in this demo's source README are local or cluster addresses; no public documentation URL
 * appears there, and this pack lists only URLs it can verify from the repo.
 *
 *   node scripts/build-content-pack.mjs [--commit=<sha>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_PATH = path.join(ROOT, 'content-pack.json');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const CARDS = [
  { id: 'gallery', label: 'Poison gallery', description: 'Every payload the server can serve, with what a scanner and pinning each catch.', group: 'try-it', href: '/#/gallery', terms: ['tool-poisoning', 'tool-shadowing', 'input-schema-exfil-sink', 'credential-harvest', 'result-based-injection'] },
  { id: 'run', label: 'Run the victim', description: 'The same task through an ungoverned client and a pinned client, side by side. No model needed.', group: 'try-it', href: '/#/run', terms: ['pinning'] },
  { id: 'rugpull', label: 'Rug-pull flow', description: 'Approve list 1, come back later, compare: the tool that changed overnight.', group: 'try-it', href: '/#/rugpull', terms: ['rug-pull', 'trust-on-first-use', 'pinning'], story: 'S05' },
  { id: 'limits', label: 'Honest limits', description: 'What pinning does not catch: a first-list poison it approved blindly, result injection, resources and prompts.', group: 'concept', href: '/#/limits', terms: ['trust-on-first-use', 'result-based-injection'], story: 'S14' },
  { id: 'gateway', label: 'Gateway: entitlement filter and cap', description: 'The hostile server with no gateway and through an entitlement filter plus an aggregate policy cap, both simulated. A Ping release claim (2026-11-02), UNVERIFIED on our tenant; no live path.', group: 'try-it', href: '/#/gateway', terms: ['mcp-aggregate', 'entitlement-aware-discovery', 'aggregate-policy-cap', 'alias-prefix', 'tool-shadowing'], story: 'S36' },
  { id: 'gateway-why', label: 'Why it matters: MCP Gateway and MCP Aggregate', description: 'Challenge, technical and business value as Ping states them (slides 36 and 37). Ping claims, UNVERIFIED on our tenant, not our measurement.', group: 'reference', href: '/#/gateway', terms: ['mcp-aggregate'], story: 'S36' },
  { id: 'diagram', label: 'Diagram', description: 'Server, client, pin check, victim and planned call. Movable boxes, Simulate, Reset.', group: 'concept', href: '/#/diagram' },
];

export function buildPack({ commit } = {}) {
  const pkg = readJson('package.json');
  const stories = fs.readdirSync(path.join(ROOT, 'web/src/data/stories')).filter((f) => f.endsWith('.json')).map((f) => ({ f, s: readJson(`web/src/data/stories/${f}`) }))
    .map(({ f, s }) => ({ id: s.id, title: s.title, say: s.say, file: `web/src/data/stories/${f}` })).sort(byId);
  const ids = new Set(stories.map((s) => s.id));
  const pack = {
    schema: 'demo-content-pack/1',
    id: 'hostile-mcp',
    title: 'Hostile MCP / rug-pull',
    version: pkg.version,
    ...(commit ? { source: { repo: 'hostile-mcp', commit } } : {}),
    demo: { id: 'hostile-mcp', name: 'Hostile MCP', catalog: 'D6', baseUrl: 'http://localhost:4701', doctor: '/api/health', tags: ['mcp', 'tool-poisoning', 'rug-pull', 'pinning', 'mcp-aggregate', 'unverified-release-claim'] },
    glossary: readJson('content/terms.json').sort(byId),
    sources: [],
    cards: CARDS.map(({ href, ...c }) => ({ ...c, action: { type: 'route', href } })).sort(byId),
    diagrams: [{ id: 'metadata-path', label: 'Where the tool metadata is consumed', href: '/#/diagram' }, { id: 'gateway-checks', label: 'Where the entitlement filter and the cap sit (simulation, UNVERIFIED)', href: '/#/gateway' }],
    stories,
    documents: [{ id: 'gateway-why-it-matters', path: 'docs/gateway-why-it-matters.md', title: 'Why it matters: MCP Gateway and MCP Aggregate (Ping claims, UNVERIFIED)' }],
  };
  for (const c of pack.cards) if (c.story && !ids.has(c.story)) throw new Error(`card ${c.id} names unknown story ${c.story}`);
  return pack;
}

export const serialize = (pack) => `${JSON.stringify(pack, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = process.argv.find((a) => a.startsWith('--commit='))?.slice(9);
  fs.writeFileSync(PACK_PATH, serialize(buildPack({ commit })));
  console.log(`wrote ${path.relative(process.cwd(), PACK_PATH) || PACK_PATH}`);
}
