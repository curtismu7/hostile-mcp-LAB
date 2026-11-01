#!/usr/bin/env node
// Mutation run for the Gateway page: break one editable-field behaviour at a time in web/src/pages/Gateway.jsx and
// require the page tests to fail. The file is restored after every mutant (and on exit). Run from the repo root:
//   node scripts/web-mutation.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'web/src/pages/Gateway.jsx');
const original = fs.readFileSync(FILE, 'utf8');
const MUTANTS = [
  ['alias dropped from the request', 'aliases: ed.aliases,', 'aliases: {},'],
  ['ToolFilter dropped from the request', 'toolFilter: Object.fromEntries(MEMBERS.map((k) => [k, split(ed.filterText[k]).length ? split(ed.filterText[k]) : null])),', 'toolFilter: {},'],
  ['reachability dropped from the request', 'reachable: ed.reachable,', 'reachable: {},'],
  ['entitlements dropped from the request', 'entitled: ed.entitled,', 'entitled: [],'],
  ['cap switch ignored', 'capAllow: ed.capOn ? ed.capAllow : null,', 'capAllow: ed.capAllow,'],
  ['list (stage) ignored', 'stage: ed.stage,', 'stage: "later",'],
  ['caller ignored', 'caller: ed.caller,', 'caller: "analyst",'],
  ['task ignored', 'task: cfg.tasks[ed.task],', 'task: cfg.tasks[2],'],
  ['caller change keeps the old entitlements', 'set({ caller, entitled: [...cfg.callers[caller].entitled] })', 'set({ caller })'],
  ['Reset does not restore the editor', 'setEd(initialEditor(cfg));', 'setEd((e) => e);'],
];
// Returns the failing test names; an empty list means every test passed (the mutant survived).
const run = () => {
  try { execFileSync('npx', ['vitest', 'run', 'src/pages/Gateway.test.jsx'], { cwd: path.join(ROOT, 'web'), stdio: 'pipe', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', STANDALONE_ENV: '/nonexistent/none.env' } }); return []; } catch (e) {
    const names = [...`${e.stdout}${e.stderr}`.matchAll(/^\s*FAIL\s+src\/pages\/Gateway\.test\.jsx > (.+)$/gm)].map((m) => m[1]);
    return names.length ? names : ['(the test run failed)'];
  }
};
let survived = 0;
process.on('exit', () => fs.writeFileSync(FILE, original));
for (const [name, find, replace] of MUTANTS) {
  if (original.split(find).length !== 2) { console.log(`SKIP ${name}: text not found exactly once`); survived++; continue; }
  fs.writeFileSync(FILE, original.replace(find, () => replace));
  const failed = [...new Set(run())];
  fs.writeFileSync(FILE, original);
  console.log(`${failed.length ? 'KILLED  ' : 'SURVIVED'} ${name}${failed.length ? ` -> ${failed[0]}` : ''}`);
  if (!failed.length) survived++;
}
process.exit(survived ? 1 : 0);
