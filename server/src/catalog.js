// GET /api/catalog: one row per poison the server can serve, with an honest answer on what catches it.
// `scanner` = a metadata scanner at ingest (this repo ships none; the answer follows the source README).
// `pinning` = the pinned client in pinning.js. yes | partial | no.
// `gateway` = the entitlement-filtered aggregate gateway simulation in gateway.js. yes | partial | no. A lab reading of a
//   Ping release claim (2026-11-02), UNVERIFIED on our tenant.
import { POISON_PROMPTS, POISON_RESOURCES, POISONS } from './poisons.js';
import { CATCHES, LIMITS } from './pinning.js';
import { GATEWAY_LIMITS } from './gateway.js';

const ROWS = {
  description_injection: {
    category: 'description', what: 'An <IMPORTANT> block in a harmless-looking tool description tells the agent to move money and keep quiet.',
    how: 'The agent reads the description as trusted context and obeys it.',
    scanner: ['yes', 'A scanner reading the description at ingest sees the block.'],
    pinning: ['no', 'Approved on first sight, the hash only proves it has not changed since.'],
    gateway: ['partial', 'Hidden only if the caller is not entitled to the tool or the cap leaves it out. An entitled caller sees the description exactly as written: the filter does not clean content.'],
  },
  schema_exfiltration: {
    category: 'schema', what: 'The inputSchema carries a callback_url whose default is an off-box address, with a note to include the full context.',
    how: 'An agent that auto-fills arguments from the schema leaks on every call.',
    scanner: ['yes', 'The off-box default is visible in the schema.'],
    pinning: ['partial', 'Not caught if it was there at approval. Flagged as off-origin-sink if it is added later.'],
    gateway: ['partial', 'Hidden if not entitled or over the cap. If it is listed, the off-box default is delivered unchanged.'],
  },
  tool_shadowing: {
    category: 'name', what: 'Reuses the name of a trusted tool, claims to be the authoritative one, and smuggles a transfer.',
    how: 'An agent that resolves tools by name picks the hostile definition.',
    scanner: ['yes', 'The primacy claim and the instruction are in the description.'],
    pinning: ['yes', 'Caught as shadowed when the name is already approved from another server.'],
    gateway: ['yes', "The alias prefix keeps the hostile get_balance apart from the bank's, so the name cannot be taken over (a lab reading of alias__tool naming)."],
  },
  action_exfil_sink: {
    category: 'schema', what: 'send_email hides an off-box bcc default with an instruction to include credentials and tokens.',
    how: 'The leak rides along on every send.',
    scanner: ['yes', 'The off-box default and the instruction are in the schema.'],
    pinning: ['partial', 'Not caught if it was there at approval. Flagged as off-origin-sink if it is added later.'],
    gateway: ['partial', 'Hidden if not entitled or over the cap. If it is listed, the hidden bcc default is delivered unchanged.'],
  },
  credential_harvest: {
    category: 'schema', what: 'verify_identity asks for the password and one-time code as ordinary parameters.',
    how: 'The agent asks the user for secrets and passes them to the server.',
    scanner: ['yes', 'Credential-named parameters and the instruction are visible.'],
    pinning: ['no', 'Nothing changed after approval, so nothing is flagged.'],
    gateway: ['partial', 'Hidden if not entitled or over the cap. If it is listed, the credential parameters are delivered unchanged.'],
  },
  imperative_injection: {
    category: 'description', what: 'A plain "ignore all previous instructions" sentence, with no tag, tells the agent to transfer money.',
    how: 'Same as the tagged form: the agent obeys text in the description.',
    scanner: ['yes', 'Pattern and intent are visible in the description.'],
    pinning: ['no', 'Approved on first sight.'],
    gateway: ['partial', 'Hidden if not entitled or over the cap. If it is listed, the sentence is delivered unchanged.'],
  },
  rug_pull: {
    category: 'dynamic', what: 'get_stock_price is clean on the first tools/list of a session and poisoned on later ones.',
    how: 'The client approved the clean version; the next list swaps the description.',
    scanner: ['partial', 'A scanner that runs once at ingest only sees the clean list. One that rescans every list catches it.'],
    pinning: ['yes', 'Caught as changed, with the field diff.'],
    gateway: ['partial', 'A tool that first appears after approval is removed unless it is entitled and under the cap. A changed description on a tool that is already listed passes; pinning still has to catch it.'],
  },
  result_injection: {
    category: 'result', what: 'read_ticket has clean metadata; the injection is in the text a call returns.',
    how: 'It reaches the model only when the result is read back.',
    scanner: ['no', 'There is nothing in the metadata to scan.'],
    pinning: ['no', 'Only metadata is hashed.'],
    gateway: ['no', 'The gateway decides which tools are listed and callable. It does not read what a call returns.'],
  },
  resource_poisoning: {
    category: 'resource', what: 'A resource whose text tells the agent to bypass approval and call create_transfer.',
    how: 'The agent reads the resource as reference material.',
    scanner: ['no', 'A tool-metadata scanner does not read resources.'],
    pinning: ['no', 'Resources are not pinned.'],
    gateway: ['no', 'This simulation lists tools only. Resources are outside it.'],
  },
  prompt_poisoning: {
    category: 'prompt', what: 'A prompt whose message tells the agent to bypass approval and call create_transfer.',
    how: 'The prompt arrives as the user turn.',
    scanner: ['no', 'A tool-metadata scanner does not read prompts.'],
    pinning: ['no', 'Prompts are not pinned.'],
    gateway: ['no', 'This simulation lists tools only. Prompts are outside it.'],
  },
};

const SUBJECT = {
  rug_pull: { kind: 'tool', name: 'get_stock_price' },
  result_injection: { kind: 'tool', name: 'read_ticket' },
};
for (const p of POISONS) SUBJECT[p.id] = { kind: 'tool', name: p.tool.name };
for (const r of POISON_RESOURCES) SUBJECT.resource_poisoning = { kind: 'resource', name: r.resource.uri };
for (const p of POISON_PROMPTS) SUBJECT.prompt_poisoning = { kind: 'prompt', name: p.prompt.name };

export function catalog() {
  const items = Object.entries(ROWS).map(([id, r]) => ({
    id,
    ...SUBJECT[id],
    category: r.category,
    what: r.what,
    how: r.how,
    scanner: { catches: r.scanner[0], note: r.scanner[1] },
    pinning: { catches: r.pinning[0], note: r.pinning[1] },
    gateway: { catches: r.gateway[0], note: r.gateway[1] },
  }));
  return { items, pinningCatches: CATCHES, pinningLimits: LIMITS, gatewayLimits: GATEWAY_LIMITS };
}
