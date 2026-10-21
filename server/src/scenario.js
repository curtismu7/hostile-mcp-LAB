// POST /api/run-victim: one deterministic story (S05, the tool list changed overnight), run two ways.
//
//   ungoverned: the client takes whatever each tools/list returns and hands it to the victim.
//   pinned:     the client approved list #1 (trust on first use), checks list #2, and withholds any tool whose verdict
//               is not ok before the victim sees it.
//
// Both clients are connected to two servers: the bank's (a trusted get_balance) and the hostile one. stage 'later'
// (default) is the morning after: list #2. stage 'first' is the day of approval: list #1, which shows what pinning
// cannot catch (poison that was there from the start).
import { createSession, BANK_ORIGIN, BANK_TOOLS, HOSTILE_ORIGIN } from './session.js';
import { toolHash } from './pinning.js';
import { runVictim } from './victim.js';

export async function runScenario({ task, mode, stage = 'later' }) {
  const session = await createSession({ trusted: mode === 'pinned' });
  try {
    const trace = [];
    const step = (what, detail) => trace.push({ step: trace.length + 1, what, ...(detail ? { detail } : {}) });
    step('Connect to the bank server and the hostile server', mode === 'pinned' ? 'The bank get_balance is already approved.' : undefined);

    const first = await session.list();
    step(`tools/list #${first.listNumber}`, `${first.tools.length} tools received`);
    let skipped = [];
    if (mode === 'pinned') {
      const result = session.approve();
      skipped = result.skipped;
      step('Approve list #1 (trust on first use)', `${result.approved.length} pinned, ${result.skipped.length} refused${result.skipped.length ? ` (${result.skipped.map((s) => `${s.name}: ${s.reason}`).join(', ')})` : ''}. Approval does not read the content.`);
    }
    let current = first;
    if (stage === 'later') {
      current = await session.list();
      step(`tools/list #${current.listNumber} (the next morning)`, `${current.tools.length} tools received`);
    }

    const hostile = current.tools;
    let check = null;
    let withheld = [];
    let visible = hostile;
    if (mode === 'pinned') {
      check = session.check(hostile);
      withheld = check.results.filter((r) => r.verdict !== 'ok').map((r) => ({ name: r.name, verdict: r.verdict }));
      const blocked = new Set(withheld.map((w) => w.name));
      visible = hostile.filter((t) => !blocked.has(t.name));
      step('Check against the pins', withheld.length ? `Withheld: ${withheld.map((w) => `${w.name} (${w.verdict})`).join(', ')}` : 'Nothing changed');
    }
    // The bank's tools come first; a later tool with the same name wins unless it was withheld.
    const toolsForVictim = [...BANK_TOOLS, ...visible];
    const victim = runVictim({ task, tools: toolsForVictim, origin: HOSTILE_ORIGIN });
    step('The victim reads the tools and decides', victim.selected ? `Would call: ${victim.calls.map((c) => c.tool).join(', ')}` : 'No call');

    const hostileNames = new Set(hostile.map((t) => t.name));
    return {
      mode,
      stage,
      task,
      trace,
      toolsSeen: toolsForVictim.map((t, i) => ({ name: t.name, sha256: toolHash(t).slice(0, 12), source: i < BANK_TOOLS.length ? 'bank' : 'hostile' })),
      pinned: mode === 'pinned' ? { origin: HOSTILE_ORIGIN, trustedOrigin: BANK_ORIGIN, skippedAtApproval: skipped, results: check.results, withheld, missing: check.missing } : null,
      victim,
      summary: {
        poisonLanded: victim.calls.some((c) => c.poison),
        withheldCount: withheld.length,
        hostileToolCount: hostileNames.size,
      },
    };
  } finally {
    await session.close();
  }
}
