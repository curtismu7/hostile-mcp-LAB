import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { CATALOG_DOC, buildThreatCatalog } from './build-threat-catalog.mjs';

test('docs/threat-catalog.md is exactly what the generator produces (run: node scripts/build-threat-catalog.mjs)', async () => {
  assert.equal(fs.readFileSync(CATALOG_DOC, 'utf8'), await buildThreatCatalog());
});

test('docs/shelf-entry.json is a valid shelf registry entry for D6 on port 4701', () => {
  const { demos } = JSON.parse(fs.readFileSync(new URL('../docs/shelf-entry.json', import.meta.url), 'utf8'));
  assert.equal(demos.length, 1);
  const d = demos[0];
  assert.match(d.id, /^[a-z0-9-]{2,41}$/);
  assert.equal(d.catalogId, 'D6');
  assert.equal(d.url, 'http://localhost:4701');
  assert.equal(d.healthPath, '/api/health');
  assert.ok(d.composeFile.startsWith('/') && d.composeFile.endsWith('docker-compose.yml'));
});
