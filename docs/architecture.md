# Architecture

One Node process (Express, ESM) serves the hostile MCP endpoints, the demo API under `/api` and the built web app. There is no database: sessions are in memory.

```
 MCP client ----POST / | POST /mcp | GET /sse + POST /messages----> hostile MCP server  (server/src/mcp/)
                                                                      serves payloads, never scores or blocks
 web UI --------/api/*-------------------------------------------> demo API  (server/src/app.js)
                                                                      |-- session.js   in-memory MCP sessions against the real server
                                                                      |-- scenario.js  the S05 run
                                                                      |-- victim.js    offline deterministic victim
                                                                      |-- pinning.js   pinned client (trust on first use)
                                                                      `-- catalog.js, safety.js, health.js, doctor.js
```

## The pieces

| Piece | File | Job |
| --- | --- | --- |
| Hostile server | `server/src/mcp/hostile.js`, `tools.js`, `server/src/poisons.js` | 11 tools, one resource, one prompt. Copied from the source demo; the wire output is checked byte for byte (`server/test/golden.test.js`). Only change: an explicit tools/list counter so API sessions can count per session. |
| Victim | `server/src/victim.js` | A stand-in for a trusting model. Reads metadata only and returns the calls it would make, with a reason each. Rules at `GET /api/victim-rules`. No LLM, no execution. |
| Pinned client | `server/src/pinning.js` | `approve(tools)` pins a hash per tool; `check(tools)` returns a verdict per tool. |
| Sink finder | `server/src/sinks.js` | Finds URL and email defaults (also const, enum, examples) in a schema, to decide `off-origin-sink`. |
| Sessions | `server/src/session.js` | An in-memory MCP client per session, with its own list counter and its own pins. |
| Scenario | `server/src/scenario.js` | Runs the same task through the ungoverned and the pinned client. |
| Safety | `server/src/safety.js` | Loopback rule, reserved-host rule, payload scan. See [safety.md](safety.md). |
| Health | `server/src/health.js`, `doctor.js` | `GET /api/health`, contract `demo-health/1`, state cached 60 s from the doctor checks. |
| Web | `web/src/` | Gallery, run, rug-pull flow, limits, diagram, stories S05 and S14. |

## Canonicalisation

A tool's pin is `sha256(JSON.stringify(canonical({name, description, inputSchema})))`.

- Object keys are sorted at every depth.
- An array under the key `required` that holds only strings is sorted, because `required` is a set in JSON Schema: re-ordering it does not change meaning. Every other array keeps its order.
- A missing description hashes as `''` and a missing schema as `{}`.
- Anything else on the tool object (annotations, title, `_meta`) is not hashed. That is a limit: a change there goes unnoticed.

## Pinned client verdicts

`ok`, `changed` (same name and origin, different hash, with the field diff), `shadowed` (name approved from another origin), `new-unapproved`, `off-origin-sink` (new or changed, and carrying a URL or email default that points away from the approved origin). `verdict` is the most severe finding, in the order shadowed, off-origin-sink, changed, new-unapproved, ok. Approval refuses a shadowed tool (the name is already pinned from another origin) and records the rest, including any sink already present; it does not read content.

## Two list counters

The MCP endpoints keep the source's behaviour: the rug-pull counter is process-wide, so the first `tools/list` the process answers is clean and every later one is poisoned. Restart the process (or the container) to get a clean first list again. The API sessions (`/api/mcp-session/*`) count per session, which is what the rug-pull page uses, so the UI flow can be repeated without a restart.

## Where defences sit

Nothing in the MCP protocol inspects tool metadata, so a defence can only sit where the metadata is consumed: in the client or a gateway in front of it. This server never scores or blocks, by design; if it did, the demo would show a defence that real hostile servers do not provide.

## The gateway simulation (entitlement filter and aggregate cap)

A Ping release claim (2026-11-02), UNVERIFIED on our tenant: the SE gateway is v1.261030 and does not have it, so this exists only as an in-process simulation. See [gateway.md](gateway.md) for the model, the tags and the tests.

- `server/src/gateway.js` is pure and has no imports. Members carry `AppRef`, `Alias` and `ToolFilter` (console swagger names, 2026-10-31, schema only). `list(caller)` applies ToolFilter, then the caller's entitlements, then the aggregate cap, and prefixes every name `alias__tool`. `call(caller, name)` asks the same question again at the member hop before anything is forwarded.
- `server/src/gateway-scenario.js` runs it against the real hostile server over the in-memory session, next to the no-gateway listing, and runs the pinned client on the gateway listing.
- `server/src/gateway-fixtures.js` holds the callers, the cap list and three simulated tools. The real server does not serve them, so the golden wire test is untouched.
- The Gateway tab (`web/src/pages/Gateway.jsx`, `GatewayDiagram.jsx`) is the only place the feature appears. The existing diagram page, whose text says there is no gateway, is unchanged.
