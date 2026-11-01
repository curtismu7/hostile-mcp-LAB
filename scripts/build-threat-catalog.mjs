#!/usr/bin/env node
// Generates docs/threat-catalog.md from the catalog data behind GET /api/catalog (server/src/catalog.js).
// Deterministic. The test in scripts/docs.test.mjs fails if the committed file is stale.
//   node scripts/build-threat-catalog.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CATALOG_DOC = path.join(ROOT, 'docs', 'threat-catalog.md');
const WORD = { yes: 'Yes', partial: 'Partly', no: 'No' };

export async function buildThreatCatalog() {
  const { catalog } = await import(pathToFileURL(path.join(ROOT, 'server/src/catalog.js')));
  const { items, pinningCatches, pinningLimits, gatewayLimits } = catalog();
  const out = [
    '# Threat catalog',
    '',
    'Generated from `server/src/catalog.js` by `node scripts/build-threat-catalog.mjs`. Do not edit by hand; the same data is served at `GET /api/catalog`.',
    '',
    '"Scanner" means a metadata scanner that reads tool descriptions and schemas at ingest. This repo ships none; the answers follow the source demo. "Pinning" is the pinned client in `server/src/pinning.js`. "Gateway" is the entitlement-filtered aggregate gateway simulation in `server/src/gateway.js`: a lab reading of a Ping release claim (2026-11-02), UNVERIFIED on our tenant.',
    '',
    '| Poison | Kind | Where it hides | Scanner | Pinning | Gateway (UNVERIFIED) |',
    '| --- | --- | --- | --- | --- | --- |',
    ...items.map((i) => `| \`${i.id}\` (\`${i.name}\`) | ${i.kind} | ${i.category} | ${WORD[i.scanner.catches]} | ${WORD[i.pinning.catches]} | ${WORD[i.gateway.catches]} |`),
    '',
  ];
  for (const i of items) {
    out.push(`## \`${i.id}\``, '', `Subject: ${i.kind} \`${i.name}\`. Hides in: ${i.category}.`, '',
      `- What it does: ${i.what}`, `- How it lands: ${i.how}`,
      `- Scanner (${WORD[i.scanner.catches]}): ${i.scanner.note}`, `- Pinning (${WORD[i.pinning.catches]}): ${i.pinning.note}`,
      `- Gateway, lab reading, UNVERIFIED (${WORD[i.gateway.catches]}): ${i.gateway.note}`, '');
  }
  out.push('## What pinning catches', '', ...pinningCatches.map((c) => `- ${c.text}`), '', '## What pinning does not catch', '', ...pinningLimits.map((l) => `- ${l.text}`), '',
    '## What the gateway simulation does not do', '', ...gatewayLimits.map((l) => `- ${l.text}`), '');
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) fs.writeFileSync(CATALOG_DOC, await buildThreatCatalog());
