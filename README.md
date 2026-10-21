# Hostile MCP

A deliberately hostile MCP server, an offline victim that needs no model, and a pinned client shown side by side with an ungoverned one. It tells story S05, "the tool list changed overnight": a tool you approved last week is swapped for a poisoned one.

Nothing in the MCP protocol inspects tool metadata. The server serves the payloads and never scores or blocks. A defence can only sit where the metadata is consumed.

## Status

Step HM0 (server, victim, pinned client, API). Built and tested:

- The hostile server, ported from the AI-DEMO2 `standalone/hostile-mcp-server`: Streamable HTTP and SSE, `/health`, 11 tools (6 with poisoned metadata, the rug-pull tool, a result-injection tool, 3 inert action stubs), one poisoned resource, one poisoned prompt. The wire output is checked byte for byte against the source.
- The offline, deterministic victim (`server/src/victim.js`).
- The pinned client library (`server/src/pinning.js`).
- The API, including `GET /api/health` (`demo-health/1`).
- A skeleton web page that lists the poison catalog and what pinning does not catch.

Not built yet: the side-by-side story screen, the ReactFlow diagram (movable boxes, Simulate, Reset, speed), Docker, the shelf registration. The optional real-model agent (`npm run agent -w server`) is copied from the source and tested offline only; it has not been run against a live model from this repo.

## Safety rules

This repo holds hostile content on purpose, so it is built to be inert:

- The server binds `127.0.0.1` only. It refuses any other address unless `HOSTILE_BIND` is set.
- The server makes no outbound request of any kind. Tests block every non-loopback socket, DNS lookup and `fetch` while exercising every tool, resource, prompt and API route, and a source scan fails on any outbound code path.
- Every host in every payload is a reserved, non-resolvable name: the `.invalid` TLD, the `.example` TLD, or `example.com`/`.net`/`.org`. A test scans every payload (and everything on the wire) for any other hostname, IP or email domain.
- The action tools (`create_transfer`, `delete_all_records`, `grant_admin`) return a fixed fake result and touch nothing.
- The victim never executes a call and never POSTs anywhere. It returns the call it would make, as data.
- No real credentials anywhere.

## Run it

```bash
npm install
npm run doctor      # node, bind, payload host scan, outbound settings, port
npm test            # server (node:test) and web (vitest)
npm run build
npm start           # http://127.0.0.1:4701/ (PORT to change)
npm run dev         # API on 4701, Vite on 4702
```

Ports start at 4700 so they stay clear of the other demos.

## The victim

`POST /api/run-victim` runs the S05 story once, deterministically, and returns the trace, what the victim saw, the calls it would make with a reason for each, and what the pinned client flagged. Rules (`GET /api/victim-rules`):

1. Tools are resolved by name; if two share a name, the last wins.
2. The benign task picks the tool whose name shares the most words with it. Action tools are never picked from a benign task.
3. Every argument with a schema default is filled with it. A default pointing off the approved origin is an exfiltration sink.
4. If the chosen tool asks for a password or code, the victim asks the user.
5. An `<IMPORTANT>` block in the chosen tool's description is obeyed.
6. A plain "ignore previous instructions ... call <tool>" is obeyed the same way.
7. Metadata only: it never sees call results, resources or prompts.

The victim is a stand-in for a trusting model, not a model. Argument values come from a simple pattern on the task.

## The pinned client

Trust on first use. `approve(tools)` pins `sha256(canonical({name, description, inputSchema}))` (object keys sorted at every depth; `required` is treated as a set). `check(tools)` returns one verdict per tool:

| Verdict | Meaning |
| --- | --- |
| `ok` | Same hash as approved. |
| `changed` | Same name and origin, different hash: the rug-pull. The field diff is included. |
| `shadowed` | The name is already approved from another origin. |
| `new-unapproved` | Never approved. |
| `off-origin-sink` | New or changed, and it carries a URL or email default (also const, enum, examples) pointing away from the approved origin. |

### What pinning catches, and what it does not

Catches: the rug-pull, name shadowing, an off-origin sink added after approval, a new tool.

Does not catch: a poison already present when the tool was first approved (the approval is blind), result-based injection, poisoned resources and prompts, a tool a person approves again after a change. A scanner or a human has to vet the first list. Run `GET /api/catalog` for the answer per poison; `pinningLimits` is the same list as data.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | `demo-health/1`. Public, GET only, state from the doctor checks cached 60 s. |
| `GET /api/catalog` | Each poison: what it does, how it lands, and whether a scanner and pinning catch it. |
| `GET /api/victim-rules` | The victim rules and the pinning catch/limit lists. |
| `POST /api/run-victim` | `{task, mode: 'ungoverned'\|'pinned', stage?: 'first'\|'later'}`. `later` (default) is the morning after, list #2. |
| `POST /api/mcp-session/new` | New in-memory MCP session against the real server, with its own list counter. |
| `POST /api/mcp-session/:id/list` | tools/list. Returns the tools and, once approved, the pinned check. |
| `POST /api/mcp-session/:id/approve` | Pin the last list. |
| `DELETE /api/mcp-session/:id` | End the session. |

The MCP endpoints keep the source's paths: `POST /` and `POST /mcp` (Streamable HTTP, stateless), `GET /sse` with `POST /messages`, `GET /health`. On those, the rug-pull counter is process-wide, as in the source: the first `tools/list` the process answers is clean, every later one is poisoned. The API sessions count per session.

## Layout

```
server/src/poisons.js     the payload catalog (copied, unchanged)
server/src/mcp/           tools and the MCP server (copied, with an explicit list counter)
server/src/safety.js      loopback and reserved-host rules, payload scan
server/src/pinning.js     the pinned client
server/src/victim.js      the offline victim
server/src/session.js     in-memory MCP sessions
server/src/scenario.js    the S05 run behind /api/run-victim
server/tools/agent.mjs    optional real-model victim (needs LLM_URL)
web/                      React + Vite skeleton
```

## Licence

MIT, from the source demo; see LICENSE. This is an independent community demo, not endorsed by Ping Identity.
