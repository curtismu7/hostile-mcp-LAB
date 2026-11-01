#!/usr/bin/env node
// Real-browser run of the host-run app: the gallery, the side-by-side victim run, the three-step rug-pull flow, the limits
// page and the diagram. Screenshots go to .data/e2e-screenshots (git-ignored). Not run by CI.
//
//   npm run build            (once; the server serves web/dist)
//   npm run e2e              starts the server on E2E_PORT (default 4743), drives it, stops it
//   npm run e2e -- <url>     drives a server that is already running (read-only except for its in-memory sessions)
//
// Uses the Chromium the installed Playwright resolves (`npx playwright install chromium` if missing). E2E_CHROMIUM
// is only a fallback: an executable path for when no Playwright browser can be found. Pattern from the demo shelf's scripts/e2e.mjs. The server makes no outbound request, and neither does this.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, '.data', 'e2e-screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++; };

const given = process.argv.slice(2).find((a) => a.startsWith('http'));
const port = Number(process.env.E2E_PORT) || 4743;
const base = given ? given.replace(/\/$/, '') : `http://127.0.0.1:${port}`;

let server;
if (!given) {
  if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }
  server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOSTILE_BIND: '' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ } await sleep(250); }
}
fs.rmSync(shots, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  const go = async (hash) => { await page.goto(`${base}/#/${hash}`); await page.reload(); };
  const external = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && !/^(data|blob):/.test(r.url())) external.push(r.url()); });

  // Keyboard order: the skip link is the first stop, then the nav in order; Enter on it moves focus to <main>.
  await go('gallery');
  await page.keyboard.press('Tab');
  check((await page.evaluate(() => document.activeElement.textContent)) === 'Skip to content', 'the first Tab stop is the skip link');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => document.activeElement.id) === 'main', 'the skip link moves focus to the main region');
  await go('gallery');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  check((await page.evaluate(() => document.activeElement.textContent)) === 'Gallery', 'the next Tab stop after the skip link is the first nav link');

  // Gallery
  await go('gallery');
  await page.getByTestId('poison-rug_pull').waitFor();
  check((await page.getByTestId('banner').innerText()).toLowerCase().includes('hostile'), 'banner says the server is hostile on purpose');
  check((await page.locator('[data-testid^="poison-"]').count()) === 10, 'gallery shows ten poisons');
  await shot('1-gallery');

  // Side-by-side run
  await go('run');
  // The default task is a description injection present on day one: pinning does not help, and the page must say so.
  await page.getByRole('button', { name: 'Run both clients' }).click();
  await page.getByTestId('result-pinned').waitFor();
  check((await page.getByTestId('result-pinned').innerText()) === 'POISON LANDED', 'day-one description injection lands even with pinning (the honest limit)');
  // The rug-pull task on the morning after: the pinned client withholds the swapped tool.
  await page.getByLabel('Task').selectOption({ label: 'What is the stock price of ACME? (rug-pull (the next-morning list))' });
  await page.getByRole('button', { name: 'Run both clients' }).click();
  await page.getByTestId('withheld').waitFor();
  check((await page.getByTestId('result-ungoverned').innerText()) === 'POISON LANDED', 'ungoverned: poison landed on the rug-pull task');
  check((await page.getByTestId('result-pinned').innerText()) === 'BLOCKED BY PIN', 'pinned: blocked by pin on the rug-pull task');
  check((await page.getByTestId('withheld').innerText()).includes('get_stock_price'), 'pinned run withheld get_stock_price');
  await shot('2-run-side-by-side');

  // Three-step rug-pull flow
  await go('rugpull');
  await page.getByRole('button', { name: /Approve list #1/ }).click();
  await page.getByTestId('step1').waitFor();
  await shot('3a-rugpull-approved');
  await page.getByRole('button', { name: 'Fetch list #2' }).click();
  await page.getByTestId('step2').waitFor();
  await shot('3b-rugpull-list2');
  await page.getByRole('button', { name: 'Compare the two clients' }).click();
  await page.getByTestId('step3').waitFor();
  check((await page.getByTestId('rp-pinned').innerText()).includes('changed'), 'pinned client refuses get_stock_price as changed');
  check((await page.getByTestId('rp-ungoverned').innerText()).includes('ACCEPTED'), 'ungoverned client accepts the swapped tool');
  check((await page.getByTestId('step3').innerText()).includes('Hash before'), 'the field diff and both hashes are shown');
  await shot('3c-rugpull-compare');
  await page.getByRole('button', { name: 'Reset the flow' }).click();
  await page.getByRole('button', { name: /Approve list #1/ }).and(page.locator(':enabled')).waitFor({ timeout: 5000 }).catch(() => {});

  // Invisible characters in the plain description views (steps 1 and 2). The hostile server's own text is fixed, so the
  // list response is rewritten in the browser to carry a U+200B and the matching revealed copy: this checks the page
  // renders the chip as text in real Chromium, not the server's reveal() (the server tests cover that).
  await page.route('**/api/mcp-session/*/list', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const t of body.tools) if (t.name === 'get_stock_price') { body.descriptionsRevealed[t.name] = t.description.replace(/^(\S+)/, '$1[U+200B]'); t.description = t.description.replace(/^(\S+)/, '$1\u200B'); }
    await route.fulfill({ response: res, json: body });
  });
  await page.getByRole('button', { name: /Approve list #1/ }).click();
  await page.getByTestId('step1').waitFor();
  check((await page.getByTestId('step1').locator('.chip').first().innerText()) === '[U+200B]', 'step 1 description shows the invisible character as a [U+200B] chip');
  await page.getByRole('button', { name: 'Fetch list #2' }).click();
  await page.getByTestId('step2').waitFor();
  check((await page.getByTestId('step2').locator('.chip').first().innerText()) === '[U+200B]', 'step 2 description shows the invisible character as a [U+200B] chip');
  await shot('3d-rugpull-description-chips');
  await page.unroute('**/api/mcp-session/*/list');
  await page.getByRole('button', { name: 'Reset the flow' }).click();
  await page.getByRole('button', { name: /Approve list #1/ }).and(page.locator(':enabled')).waitFor({ timeout: 5000 }).catch(() => {});
  check(await page.getByRole('button', { name: /Approve list #1/ }).isEnabled(), 'reset returns the flow to step 1');

  // Limits and diagram
  await go('limits');
  await page.getByTestId('limit-first-list-poison').waitFor();
  await shot('4-limits');
  await go('diagram');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await sleep(1500);
  await page.getByRole('button', { name: 'Reset' }).click();
  await shot('5-diagram');

  // Gateway tab: the claim banner, the demo audit pane, and a real drag that Reset undoes (jsdom cannot drag).
  await go('gateway');
  await page.getByRole('button', { name: 'Simulate' }).and(page.locator(':enabled')).waitFor({ timeout: 20000 });
  check((await page.getByTestId('claim-banner').innerText()).includes('UNVERIFIED on our tenant'), 'gateway tab carries the release-claim banner');
  check((await page.getByTestId('gw-audit').innerText()).includes('Demo audit pane'), 'gateway tab labels the hidden list as a demo audit pane');
  const gwBox = async () => { const b = await page.locator('.react-flow__node[data-id="gw"]').boundingBox(); return { x: b.x, y: b.y }; };
  await page.locator('.gw__diagram').scrollIntoViewIfNeeded();
  const before = await gwBox();
  await page.mouse.move(before.x + 20, before.y + 15);
  await page.mouse.down();
  await page.mouse.move(before.x + 20, before.y + 95, { steps: 8 });
  await page.mouse.up();
  const dragged = await gwBox();
  check(Math.abs(dragged.y - before.y) > 40, `a dragged box stays where it was dropped (moved ${Math.round(dragged.y - before.y)}px)`);
  await page.getByRole('button', { name: 'Reset' }).click();
  await sleep(500);
  const restored = await gwBox();
  check(Math.abs(restored.x - before.x) < 2 && Math.abs(restored.y - before.y) < 2, 'Reset puts the dragged box back');
  await shot('6-gateway');

  // The same diagram on a phone: the canvas is narrower than the diagram, so some labels are off-canvas until you pan. A drag
  // of a box must not make that worse: the view does not pan by itself, so no further label is pushed out of view.
  const phone = await browser.newPage({ viewport: { width: 375, height: 800 } });
  try {
    await phone.goto(`${base}/#/gateway`);
    await phone.reload();
    await phone.getByRole('button', { name: 'Simulate' }).and(phone.locator(':enabled')).waitFor({ timeout: 20000 });
    await phone.locator('.gw__diagram').scrollIntoViewIfNeeded();
    await sleep(1500);
    const labelsOutside = () => phone.evaluate(() => {
      const c = document.querySelector('.react-flow').getBoundingClientRect();
      return [...document.querySelectorAll('.react-flow__edge-textwrapper')].filter((e) => { const r = e.getBoundingClientRect(); return r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1; }).map((e) => e.textContent.trim());
    });
    const viewport = () => phone.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
    const outsideBefore = await labelsOutside();
    const viewBefore = await viewport();
    // the first box whose centre is inside the canvas (the Aggregate gateway box, which sits half behind the left edge)
    const target = await phone.evaluate(() => {
      const c = document.querySelector('.react-flow').getBoundingClientRect();
      for (const n of document.querySelectorAll('.react-flow__node')) {
        const r = n.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (x > c.left + 10 && x < c.right - 10 && y > c.top + 10 && y < c.bottom - 10) return { id: n.dataset.id, x, y };
      }
      return null;
    });
    check(target !== null, 'phone: a box is inside the canvas to drag');
    await phone.mouse.move(target.x, target.y);
    await phone.mouse.down();
    await phone.mouse.move(target.x + 60, target.y + 50, { steps: 8 });
    await phone.mouse.up();
    await sleep(700);
    const moved = await phone.locator(`.react-flow__node[data-id="${target.id}"]`).boundingBox();
    check(Math.abs(moved.x + moved.width / 2 - target.x) > 30, `phone: the dragged box moved (${target.id})`);
    check((await viewport()) === viewBefore, 'phone: dragging a box does not pan the view');
    const outsideAfter = await labelsOutside();
    check(outsideAfter.length <= outsideBefore.length, `phone: a drag pushes no further label out of view (${outsideBefore.length} off-canvas before, ${outsideAfter.length} after)`);
  } finally { await phone.close(); }

  // Safety: the browser only talked to the app itself.
  check(external.length === 0, `no request left the app origin${external.length ? `: ${external.join(', ')}` : ''}`);
} finally {
  await browser.close();
  server?.kill();
}
console.log(failures ? `\n${failures} check(s) FAILED` : `\nall checks passed; screenshots in ${path.relative(root, shots)}`);
process.exit(failures ? 1 : 0);
