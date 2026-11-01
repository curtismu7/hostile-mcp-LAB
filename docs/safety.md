# Safety

This repo holds hostile content on purpose, so it is built to be inert. Each rule below names the test that enforces it. Run them all with `npm test`.

| Rule | Enforced by |
| --- | --- |
| The server binds `127.0.0.1` only and refuses any other address unless `HOSTILE_BIND` is set. | `server/test/safety.test.js`: "binds loopback by default and refuses another address without HOSTILE_BIND" and "a started server is actually listening on loopback only". |
| The server makes no outbound request of any kind. | `safety.test.js`: "the server makes no outbound request: network blocked while every tool, resource and prompt is exercised" (the guard in `server/test/netguard.js` blocks every non-loopback socket, DNS lookup and `fetch`), "the guard itself works", and "server source has no outbound code path" (a source scan). The API and health tests run under the same guard. |
| Every host named in any payload is a reserved name: the `.invalid` TLD, the `.example` TLD, or the apex of `example.com`/`.net`/`.org` (not subdomains: a subdomain can resolve if someone controls the zone). Never a real host or IP. | `safety.test.js`: "every payload names only reserved hosts", "everything the server sends over the wire names only reserved hosts", and "the host scanner finds real hosts, IPs and emails" (so a clean result means something). Also `npm run doctor`, `GET /api/health` and `GET /api/safety-scan` run the same scan; a failure there makes the server refuse to start and the health light "broken". `server/test/api.test.js` covers the endpoint. |
| The action tools (`create_transfer`, `delete_all_records`, `grant_admin`) return a fixed fake result and touch nothing. | `safety.test.js`: "action tools are inert stubs: fixed text, no file, process or network access"; `server/test/mcp-server.test.js`: "create_transfer is callable and returns a (stub) result". |
| The victim never executes a call and never POSTs anywhere. It returns the call it would make, as data. | `server/test/victim.test.js`: "deterministic and side-effect free: same input, same output, no network, input not mutated". |
| Untrusted strings (descriptions, results, diffs) render as inert text in the UI. | `web/src/test/inert.test.jsx`: a script or `onerror` payload renders as text in every place the pages show untrusted text. |
| No real credentials anywhere. | `.githooks/pre-commit` and the CI `secrets` job run gitleaks. The only secret-shaped inputs are the demo's fake `external-001` account and the payload text itself. |
| The container publishes its port on loopback only. | `docker-compose.yml` publishes `127.0.0.1:${HOST_PORT}:4701`. This is a compose setting, not a unit test; the check was a live one (see the README, "Docker"). |
| The gateway simulation makes no outbound request. | `server/test/gateway-api.test.js` runs every caller, both lists, edited policies and refusals under the network guard and asserts zero attempts; the source scan in `safety.test.js` and a named check cover `gateway*.js`. |
| Hostile gateway input is bounded and never echoed. | `gateway-checks.js` (bounded, never echoed) and `gateway-api.test.js` (400 with a fixed message, nothing typed repeated in a body or a log). Lookups use Map and Set, never an object indexed by a typed key. |

## The one opt-in

Inside the container the server must listen on all interfaces, so the image sets `HOSTILE_BIND=0.0.0.0`. That is the explicit opt-in, and it is safe only because compose publishes the port on `127.0.0.1`. If you run the image some other way, publish the port the same way. Never put this server on a network you do not control: it serves hostile payloads to anything that connects, which is the point of the demo and the reason it is not safe to expose.

The container also runs as the non-root `node` user, with a read-only filesystem, all capabilities dropped and `no-new-privileges`.

## What is not covered

- The optional real-model agent (`server/tools/agent.mjs`, `npm run agent -w server`) calls `LLM_URL` if you set it. It is not part of the server, is off by default and has been tested offline only. Point it at a local model, never at a hosted one you would not send hostile text to.
- A real MCP client you connect to this server will read the hostile payloads. Whether that client obeys them is the client's behaviour, not something this repo can make safe. Use a throwaway client with no real tools attached.
