#!/usr/bin/env node
// Mutation run for the Gateway page and its diagram: break one editable-field or diagram behaviour at a time in
// web/src/pages/Gateway.jsx or GatewayDiagram.jsx and require the page tests to fail. The file is restored after every mutant (and on exit). Run from the repo root:
//   node scripts/web-mutation.mjs [text]     (with text, only the mutants whose name contains it)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = path.join(ROOT, 'web/src/pages');
const GATEWAY = 'Gateway.jsx';
const DIAGRAM = 'GatewayDiagram.jsx';
const originals = new Map([GATEWAY, DIAGRAM].map((f) => [f, fs.readFileSync(path.join(PAGES, f), 'utf8')]));
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
  ['Cap allows checkbox does nothing', 'onChange={() => set({ capAllow: toggle(ed.capAllow, row.name) })}', 'onChange={() => {}}'],
  ['cap list replaced by the defaults', 'capAllow: ed.capOn ? ed.capAllow : null,', 'capAllow: ed.capOn ? cfg.defaults.capAllow : null,'],
  ['Entitled checkbox does nothing', 'onChange={() => set({ entitled: toggle(ed.entitled, row.name) })}', 'onChange={() => {}}'],
  ['Reachable checkbox does nothing', 'onChange={(e) => set({ reachable: { ...ed.reachable, [k]: e.target.checked } })}', 'onChange={() => {}}'],
  ['the caller is told the audit reason', 'refused: ${told(a.code)}', 'refused: ${told(g.audit.attempts.find((x) => x.name === a.name).reason ?? a.code)}'],
  ['the caller side shows the hidden count', '{g.count} tools listed</p>', '{g.count} tools listed, {g.hiddenCount} hidden</p>'],
  ['the audit pane sits inside the caller card', '<p data-testid="gw-gateway-victim"><code>{callsText(g.victim)}</code></p>', '<p data-testid="gw-gateway-victim"><code>{callsText(g.victim)}</code></p><Audit g={g} />'],
  ['alias choices cut short', 'cfg.aliasPresets.map((a) =>', 'cfg.aliasPresets.slice(0, 3).map((a) =>'],
  ['the other member alias stays selectable', 'disabled={MEMBERS.some((o) => o !== k && ed.aliases[o] === a)}', 'disabled={false}'],
  ['the alias select does nothing', 'onChange={(e) => set({ aliases: { ...ed.aliases, [k]: e.target.value } })}', 'onChange={() => {}}'],
  ['the ToolFilter input does nothing', 'onChange={(e) => set({ filterText: { ...ed.filterText, [k]: e.target.value } })}', 'onChange={() => {}}'],
  ['the Reset button leaves the aliases', 'aliases: { ...cfg.defaults.aliases },', 'aliases: { ...cfg.defaults.aliases, bank: "mail" },'],
  // One mutant per member for each editable field, in the handler (the page ignores an edit) and in the request (the edit is not sent).
  ...['bank', 'hostile'].flatMap((who) => [
    [`Reachable checkbox ignores edits for ${who}`, 'onChange={(e) => set({ reachable: { ...ed.reachable, [k]: e.target.checked } })}', `onChange={(e) => set({ reachable: { ...ed.reachable, [k]: k === "${who}" ? ed.reachable[k] : e.target.checked } })}`],
    [`ToolFilter input ignores edits for ${who}`, 'onChange={(e) => set({ filterText: { ...ed.filterText, [k]: e.target.value } })}', `onChange={(e) => set({ filterText: { ...ed.filterText, [k]: k === "${who}" ? ed.filterText[k] : e.target.value } })}`],
    [`Alias select ignores edits for ${who}`, 'onChange={(e) => set({ aliases: { ...ed.aliases, [k]: e.target.value } })}', `onChange={(e) => set({ aliases: { ...ed.aliases, [k]: k === "${who}" ? ed.aliases[k] : e.target.value } })}`],
    [`request drops the reachable edit for ${who}`, 'reachable: ed.reachable,', `reachable: { ...ed.reachable, ${who}: true },`],
    [`request drops the ToolFilter edit for ${who}`, 'split(ed.filterText[k]).length ? split(ed.filterText[k]) : null', `k === "${who}" ? null : split(ed.filterText[k]).length ? split(ed.filterText[k]) : null`],
    [`request drops the alias edit for ${who}`, 'aliases: ed.aliases,', `aliases: { ...ed.aliases, ${who}: cfg.defaults.aliases.${who} },`],
    [`Entitled checkbox ignores ${who} rows`, 'onChange={() => set({ entitled: toggle(ed.entitled, row.name) })}', `onChange={() => { if (row.key !== "${who}") set({ entitled: toggle(ed.entitled, row.name) }); }}`],
    [`Cap allows checkbox ignores ${who} rows`, 'onChange={() => set({ capAllow: toggle(ed.capAllow, row.name) })}', `onChange={() => { if (row.key !== "${who}") set({ capAllow: toggle(ed.capAllow, row.name) }); }}`],
  ]),
  ['Reset does not put the boxes back', 'setPlaced({ gateway: START, direct: START_DIRECT }); setStep(-1);', 'setStep(-1);', DIAGRAM],
  ['a drag is not kept', 'setPlaced((p) => ({ ...p, [view]: applyNodeChanges(changes, p[view]) }))', 'setPlaced((p) => p)', DIAGRAM],
  ['a drag moves both views', 'setPlaced((p) => ({ ...p, [view]: applyNodeChanges(changes, p[view]) }))', 'setPlaced((p) => ({ gateway: applyNodeChanges(changes, p.gateway), direct: applyNodeChanges(changes, p.direct) }))', DIAGRAM],
];
// Returns the failing test names; an empty list means every test passed (the mutant survived).
const run = () => {
  try { execFileSync('npx', ['vitest', 'run', 'src/pages/Gateway.test.jsx', 'src/pages/GatewayDiagram.test.jsx'], { cwd: path.join(ROOT, 'web'), stdio: 'pipe', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', STANDALONE_ENV: '/nonexistent/none.env' } }); return []; } catch (e) {
    const names = [...`${e.stdout}${e.stderr}`.matchAll(/^\s*FAIL\s+src\/pages\/Gateway\w*\.test\.jsx > (.+)$/gm)].map((m) => m[1]);
    return names.length ? names : ['(the test run failed)'];
  }
};
let survived = 0;
const restore = () => { for (const [f, text] of originals) fs.writeFileSync(path.join(PAGES, f), text); };
process.on('exit', restore);
for (const [name, find, replace, file = GATEWAY] of MUTANTS) {
  if (process.argv[2] && !name.includes(process.argv[2])) continue;
  const original = originals.get(file);
  if (original.split(find).length !== 2) { console.log(`SKIP ${name}: text not found exactly once`); survived++; continue; }
  fs.writeFileSync(path.join(PAGES, file), original.replace(find, () => replace));
  const failed = [...new Set(run())];
  restore();
  console.log(`${failed.length ? 'KILLED  ' : 'SURVIVED'} ${name}${failed.length ? ` -> ${failed[0]}` : ''}`);
  if (!failed.length) survived++;
}
process.exit(survived ? 1 : 0);
