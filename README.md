# Hostile MCP

A deliberately hostile MCP server, an offline victim that needs no model, and a pinned client shown side by side with an ungoverned one. It tells story S05, "the tool list changed overnight": a tool you approved last week is swapped for a poisoned one.

Nothing in the MCP protocol inspects tool metadata. The server serves the payloads and never scores or blocks. A defence can only sit where the metadata is consumed.

## Release feature (simulated): entitlement filter and aggregate cap

The Gateway tab shows the hostile server with no gateway and through an entitlement filter plus an aggregate policy cap, both simulated in process. It is a **Ping release claim (2026-11-02), UNVERIFIED on our tenant**: the SE gateway is v1.261030 and does not have it. The app has no Mock/Live toggle and runs offline only, so the feature has no live path until the release is on our tenant. A banner on every tab, in presenter mode too, says so. See [docs/gateway.md](docs/gateway.md) for the model, the tag on every statement (console swagger name, deck claim, lab-invented, lab reading) and the tests.

## Status

Built and tested:

- The hostile server, ported from the AI-DEMO2 `standalone/hostile-mcp-server`: Streamable HTTP and SSE, `/health`, 11 tools (6 with poisoned metadata, the rug-pull tool, a result-injection tool, 3 inert action stubs), one poisoned resource, one poisoned prompt. The wire output is checked byte for byte against the source.
- The offline, deterministic victim, the pinned client library, and the API, including `GET /api/health` (`demo-health/1`) and `GET /api/safety-scan`.
- The web UI: gallery (badges: pinning, scanner, neither), run the victim (ungoverned and pinned side by side), the three-step rug-pull flow, the honest limits page, a ReactFlow diagram (movable boxes, Simulate, Reset, speed), stories S05 and S14 with the Allowed/Blocked switch and generic, airlines and banking packs, a presenter toggle, light and dark themes. Untrusted strings render as inert text only; a banner on every page says the server is hostile on purpose.
- Docker on OrbStack, a shelf registry entry, a Learning Hub content pack, and a browser e2e script (all below).

Not verified: the optional real-model agent (`npm run agent -w server`) is copied from the source and tested offline only; it has not been run against a live model from this repo. The mcp-inspector was not run (see [docs/clients.md](docs/clients.md)). The Docker image has been run on OrbStack only. The shelf registration was checked against a temporary shelf instance, not your own.

## Safety rules

This repo holds hostile content on purpose, so it is built to be inert:

- The server binds `127.0.0.1` only. It refuses any other address unless `HOSTILE_BIND` is set.
- The server makes no outbound request of any kind. Tests block every non-loopback socket, DNS lookup and `fetch` while exercising every tool, resource, prompt and API route, and a source scan fails on any outbound code path.
- Every host in every payload is a reserved, non-resolvable name: the `.invalid` TLD, the `.example` TLD, or the apex of `example.com`/`.net`/`.org` (never a subdomain). A test scans every payload (and everything on the wire) for any other hostname, IP or email domain.
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

`npm start` serves the built UI from `web/dist`, so run `npm run build` first.

Ports start at 4700 so they stay clear of the other demos.

## Docker

```bash
docker compose up --build -d      # http://127.0.0.1:4701 ; HOST_PORT=4731 to change the published port
docker compose down
```

Node 22, non-root, `NODE_ENV=production`. The server binds `0.0.0.0` inside the container (the image sets `HOSTILE_BIND`, the explicit opt-in) but compose publishes the port as `127.0.0.1:PORT:4701`, so nothing off the machine can reach it. Do not widen that. The container has a health check on `/api/health`. See [docs/safety.md](docs/safety.md).

## Hosting the mock

The env switch is `MOCK_ONLY` (the family convention); it is the same thing the SE rulebook calls `MODE=mock`. Set `MOCK_ONLY=1` where the rulebook says `MODE=mock`.

A hosted copy needs these settings, all explicit. The defaults stay loopback-only and none of this switches on by itself.

```bash
MOCK_ONLY=1                              # refuse URL/credential carriers; per-visitor rug-pull state; mock banner
HOSTILE_BIND=0.0.0.0                     # the opt-in to listen off loopback (the Docker image already sets it)
HOSTILE_ALLOWED_HOSTS=mock.hostile.example   # comma list of Host names (no ports); any other Host gets 421
HOSTILE_TRUST_PROXY=1                    # optional: number of trusted proxy hops in front (default 0 = off), see below
PORT=4701
```

- Without `HOSTILE_BIND` the server refuses a non-loopback address. `MOCK_ONLY` on a non-loopback bind refuses to start without `HOSTILE_ALLOWED_HOSTS`, so a hosted mock never answers an arbitrary Host (DNS rebinding). On loopback, with no list, there is no Host check (the local default).
- Readiness probe: `GET /api/health` returns 200 with `"state":"ready"` (and `"mode":"mock-only"` when on). The probe is subject to the Host check: the kubelet probe must set a `Host` header to an allowed name via `httpGet.httpHeaders`, or the probe's own host must be added to `HOSTILE_ALLOWED_HOSTS`. The compose health check calls `127.0.0.1`, so add that name if you set the list there.
- Visitor isolation: each MCP client gets its own rug-pull counter from a session id the server mints on `initialize` (`Mcp-Session-Id`, and an `HttpOnly; SameSite=Lax` cookie, `Secure` behind `X-Forwarded-Proto: https`). The connection address is never a state key. A request with no id, or one the server did not issue, sees a fresh state. State is held in memory (5000 visitors by default, 30 minute TTL, least recently used evicted), so run one replica or use session affinity.
- Web UI sessions (the rug-pull page, `/api/mcp-session/*`) belong to the visitor: the server mints an `hm_ui` HttpOnly cookie, a session id works only with the cookie that created it, each visitor holds at most 10 sessions and may create 30 a minute, and the global table holds 5000 (least recently used evicted). A client-invented cookie is ignored.
- Throttle source and the ingress: minting (both the MCP session id and the `hm_ui` cookie) is rate-limited per source. By default the source is the TCP connection, which behind an ingress is the ingress pod, so every visitor would share one bucket. Set `HOSTILE_TRUST_PROXY=N`, where N is the number of trusted proxy hops in front of the server (1 for a single ingress), and the source becomes the Nth entry from the right of `X-Forwarded-For`; entries a client prepends are ignored. Leave it unset when nothing trusted sits in front, since the header is then client-controlled.
- Do not bake a `.env` into an image. `.dockerignore` excludes it; keep it that way and pass settings as environment variables at run time.

## Demo shelf

[docs/shelf-entry.json](docs/shelf-entry.json) is a registry entry for the SE shelf (`demo-shelf`), catalog id D6. Do not edit the shelf repo: copy the entry into the shelf's git-ignored `.data/demos.local.json` (or merge its `demos` array into an existing file) and set `composeFile` to this checkout's absolute path.

```json
{
  "demos": [
    {
      "id": "hostile-mcp",
      "name": "Hostile MCP / rug-pull",
      "catalogId": "D6",
      "kind": "Demo",
      "description": "A deliberately hostile MCP server, an offline victim, and a pinned client shown side by side with an ungoverned one: the tool that changed overnight.",
      "url": "http://localhost:4701",
      "healthPath": "/api/health",
      "composeFile": "/absolute/path/to/hostile-mcp/docker-compose.yml",
      "composeOverlays": []
    }
  ]
}
```

With the app running on 4701 the shelf shows it as Ready. Checked against a shelf instance started from `demo-shelf` on a free port with a temporary data directory.

## Learning Hub content pack

`content-pack.json` (format `demo-content-pack/1`, schema copied to `docs/content-pack.schema.json` from the ID-JAG kit) holds the glossary (tool poisoning, tool shadowing, rug pull, trust on first use, inputSchema exfil sink, result-based injection, credential harvest, pinning), cards for the pages and the S05 and S14 stories. `sources` is empty on purpose: the only URLs in the source README are local, so none could be verified as public documentation.

```bash
npm run content-pack      # regenerate (content/terms.json + the pages + the stories) and validate with ajv
node scripts/validate-content-pack.mjs [file]
```

`npm test` fails if the committed pack is stale or does not validate.

## Browser e2e

```bash
npm run build
npm run e2e                      # starts the server on E2E_PORT (default 4743), drives it, stops it
npm run e2e -- http://127.0.0.1:4701   # drive a server that is already running
```

Drives the gallery, the side-by-side run (including the day-one limit: the poison lands even with pinning), the three-step rug-pull flow with its reset, the limits page and the diagram in a real Chromium, and fails if the browser requests anything outside the app origin. Screenshots go to `.data/e2e-screenshots` (git-ignored). It is not run by CI. It uses the Chromium that the installed Playwright resolves (`npx playwright install chromium` if it is missing). `E2E_CHROMIUM` is only a fallback: set it to an executable path if no Playwright browser can be found.

## Docs

- [docs/architecture.md](docs/architecture.md): pieces, canonicalisation, verdicts, the two list counters.
- [docs/safety.md](docs/safety.md): every safety rule and the test that enforces it.
- [docs/limits.md](docs/limits.md): what pinning catches and does not.
- [docs/gateway.md](docs/gateway.md): the entitlement filter and aggregate cap simulation, how each statement is tagged, the tests.
- [docs/gateway-why-it-matters.md](docs/gateway-why-it-matters.md): Challenge, Technical and Business lines (Ping claims, UNVERIFIED).
- [docs/threat-catalog.md](docs/threat-catalog.md): generated from the catalog data.
- [docs/clients.md](docs/clients.md): pointing a real MCP client or the inspector at it; how the Privilege demo defends the call path while pinning defends the metadata path.
- [CHANGELOG.md](CHANGELOG.md).

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
| `GET /api/safety-scan` | Runs the payload host scan now: `{ok, scanned, offenders}`. `ok` is true when every host in every payload is reserved. |
| `GET /api/catalog` | Each poison: what it does, how it lands, and whether a scanner and pinning catch it. |
| `GET /api/victim-rules` | The victim rules and the pinning catch/limit lists. |
| `POST /api/run-victim` | `{task, mode: 'ungoverned'\|'pinned', stage?: 'first'\|'later'}`. `later` (default) is the morning after, list #2. |
| `GET /api/gateway/config` | The gateway tab's starting policy, callers, tasks, tags and the UNVERIFIED status. |
| `POST /api/gateway/run` | `{stage?, caller?, task?, policy?}`: the no-gateway listing and the entitlement-filtered, capped listing side by side, probe calls, pin check. Every field is validated; nothing typed is echoed. |
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
server/src/gateway.js     the entitlement filter and aggregate cap simulation (pure)
server/src/gateway-scenario.js  the run and the request validation behind /api/gateway/run
server/tools/agent.mjs    optional real-model victim (needs LLM_URL)
web/                      React + Vite UI
content/terms.json        glossary source for the content pack
scripts/                  doctor, content pack, threat catalog, e2e
docs/                     architecture, safety, limits, catalog, clients, shelf entry
Dockerfile, docker-compose.yml
```

## Licence

MIT, from the source demo; see LICENSE. This is an independent community demo, not endorsed by Ping Identity.
