// The "What Privilege did" trace for the lab's own simulated gateway (gateway.js). The panel is the shared one
// (web/src/gateway-trace/GatewayTrace.jsx, record built by the vendored gatewayTrace.js); this file only turns what the
// simulation computed into that record.
//
// HONESTY. This app has no live gateway path, so every trace here is source 'mock' and every decision is basis 'checked':
// it is a result gateway.js really computed, never read off a real gateway and never invented.
//   tools/list: the counts come from listing.hidden, the reasons gateway.js recorded for each tool it left out.
//   tools/call: the decision that refused the call comes from the answer gateway.call() gave (its code) and, for a refusal
//               it reports only as "not_available", from the reason it wrote to its own audit log. The checks before it
//               passed (the call got that far) and the checks after it are 'skipped' (never reached). The order below is
//               the order call() in gateway.js evaluates them.
// What the wire looks like (the refusal text, the JSON-RPC envelope) is this lab's reading, as everywhere on the Gateway
// page: the release claim does not specify it. The host is a reserved .invalid name.
//
// The demo audit view only: decisions name the check that refused a call, which the caller is never told (the caller sees
// "not available"). So the exchanges are attached inside gateway.audit and never beside the caller's fields.
import { bearerForDisplay, mockTrace } from './gatewayTrace.js';

export const GATEWAY_URL = 'https://mcp-aggregate.gateway.invalid/mcp';

// The checks call() runs, in the order it runs them. `code` is what call() answers when that check refuses.
export const CALL_CHECKS = Object.freeze([
  { id: 'name', label: 'Name is usable', code: 'bad_name', pass: 'the name is a non-empty string of a bounded length', fail: 'the name is empty, not a string, or too long' },
  { id: 'prefix', label: 'Name has an alias prefix', code: 'unprefixed', pass: 'the name starts with a server alias and the separator', fail: 'the name has no alias prefix' },
  { id: 'alias', label: 'Alias names a member', code: 'unknown_alias', pass: 'the alias belongs to a member of this gateway', fail: 'no member has this alias' },
  { id: 'reachable', label: 'Member is reachable', code: 'member_unreachable', pass: 'the member answered', fail: 'the member is down (the listing already reports this)' },
  { id: 'exists', label: 'Member has the tool', code: 'not_available', reason: 'no_such_tool', pass: 'the member offers a tool of this name', fail: 'the member has no tool of this name; the caller is told only "not available", the same as for a hidden tool' },
  { id: 'toolfilter', label: 'ToolFilter', code: 'not_available', reason: 'not-in-toolfilter', pass: "the tool is inside the member's ToolFilter", fail: "the tool is outside the member's ToolFilter; the caller is told only \"not available\"" },
  { id: 'entitlement', label: 'Entitlement', code: 'not_available', reason: 'not-entitled', pass: "the tool is in the caller's entitlements", fail: "the tool is not in the caller's entitlements; the caller is told only \"not available\"" },
  { id: 'cap', label: 'Aggregate policy cap', code: 'not_available', reason: 'over-cap', pass: 'the aggregate cap allows the tool, or there is no cap', fail: 'the aggregate cap does not allow the tool; the caller is told only "not available"' },
]);

const told = (code) => String(code).replace(/_/g, ' ');
const sentBy = (caller) => bearerForDisplay(`<mock: no token, the simulation identifies the caller by its entitlements (${caller})>`);
const rpcOf = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
const toolBody = (id, text, isError) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) } });

// listing: what gateway.list() returned. offeredCount is not needed: the reasons say what each check removed.
export function listExchange({ step, caller, listing }) {
  const hid = (reason) => listing.hidden.filter((h) => h.reason === reason).length;
  const dropped = (n, what) => (n === 0 ? { outcome: 'pass', evidence: `${what}: it left no tool out` } : { outcome: 'info', evidence: `${what}: it left ${n} tool${n === 1 ? '' : 's'} out of this caller's listing` });
  const down = listing.unreachable;
  const names = hid('invalid-name') + hid('duplicate-in-member');
  const decisions = [
    down.length === 0
      ? { id: 'reachable', label: 'Members reachable', outcome: 'pass', evidence: 'every member answered' }
      : { id: 'reachable', label: 'Members reachable', outcome: 'info', evidence: `${down.length} member${down.length === 1 ? ' is' : 's are'} down: reported in the listing, not dropped` },
    { id: 'names', label: 'Tool names', ...dropped(names, 'invalid or duplicate names') },
    { id: 'toolfilter', label: 'ToolFilter', ...dropped(hid('not-in-toolfilter'), "each member's ToolFilter") },
    { id: 'entitlement', label: 'Entitlement', ...dropped(hid('not-entitled'), "the caller's entitlements") },
    { id: 'cap', label: 'Aggregate policy cap', ...dropped(hid('over-cap'), 'the aggregate cap') },
  ];
  const rpc = rpcOf(step, 'tools/list', {});
  const tools = listing.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  const trace = mockTrace({
    url: GATEWAY_URL, authorization: sentBy(caller), rpc, status: 200,
    body: { jsonrpc: '2.0', id: step, result: { tools } },
    decisions,
    record: `demo audit: tools/list for ${caller}, ${listing.tools.length} tool${listing.tools.length === 1 ? '' : 's'} listed, ${listing.hidden.length} left out`,
  });
  return { step, title: 'Gateway check: tools/list', status: 200, trace };
}

// result: what gateway.call() returned; reason: what it wrote to its audit log for this call (null if it wrote none).
export function callExchange({ step, caller, name, result, reason }) {
  const refusedAt = result.ok ? -1 : CALL_CHECKS.findIndex((c) => c.code === result.code && (c.reason === undefined || c.reason === reason));
  if (!result.ok && refusedAt === -1) throw new Error('gateway-exchanges: a refusal this trace does not know');
  const decisions = CALL_CHECKS.map((c, i) => {
    if (refusedAt === -1 || i < refusedAt) return { id: c.id, label: c.label, outcome: 'pass', evidence: c.pass };
    if (i === refusedAt) return { id: c.id, label: c.label, outcome: 'fail', evidence: c.fail };
    return { id: c.id, label: c.label, outcome: 'skipped', evidence: 'not reached: an earlier check refused the call' };
  });
  if (result.ok) decisions.push({ id: 'forward', label: 'Forwarded to the member', outcome: 'pass', evidence: `sent to ${result.forwardedTo}; the same decision was asked at the listing and again here` });
  const rpc = rpcOf(step, 'tools/call', { name, arguments: {} });
  const body = result.ok
    ? toolBody(step, `forwarded to ${result.forwardedTo}; the simulation does not call the member`, false)
    : toolBody(step, told(result.code), true);
  const trace = mockTrace({
    url: GATEWAY_URL, authorization: sentBy(caller), rpc, status: 200, body, decisions,
    record: result.ok ? `demo audit: ${name} forwarded to ${result.forwardedTo}` : `demo audit: ${name} refused (${reason ?? result.code})`,
  });
  return { step, title: `Gateway check: tools/call ${name}`, status: 200, trace };
}
