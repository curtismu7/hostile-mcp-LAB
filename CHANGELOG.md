# Changelog

## 0.1.0

- HM0: server ported from the AI-DEMO2 source demo (wire output checked byte for byte), offline victim, pinned client, API, `GET /api/health` (`demo-health/1`).
- HM1: web UI (gallery, run, rug-pull flow, limits, ReactFlow diagram, stories S05 and S14).
- HM2: Dockerfile and docker-compose.yml (loopback-published port), `GET /api/safety-scan`, shelf registry entry (`docs/shelf-entry.json`), Learning Hub content pack (`content-pack.json`, generator and validator, schema copied from the ID-JAG kit), Playwright e2e (`npm run e2e`, not CI), docs (architecture, safety, limits, threat catalog, clients).
- Review fixes 2: sink detection strips invisible characters and folds NFKC/fullwidth hosts (flagging `invisible`), bounded sink scan (`scanTruncated`), iterative canonical hash, [U+XXXX] chips in rug-pull steps 1 and 2, pinned `node --test` glob test.

## Unreleased

- Release feature, simulated: entitlement-aware discovery and the MCP Aggregate policy cap (a Ping release claim dated 2026-11-02, UNVERIFIED on our tenant, no live path). `server/src/gateway.js` (pure, no imports), `gateway-scenario.js`, `POST /api/gateway/run`, `GET /api/gateway/config`, a Gateway tab with an editable policy and a two-view ReactFlow diagram, story S36, a release-claim banner on every tab and in presenter mode, a `gateway` column in the threat catalog, glossary terms and a why-it-matters document in the content pack. Tests: check battery, 56 mutants (each caught by a named check), API and network-guard tests, a web mutation run of 41 mutants. A refused call tells the caller only `not available`; the reasons, the hidden names and count and the offered counts are in a labelled demo audit pane and, in the API, under `gateway.audit`, apart from the caller's fields. An alias is chosen from a fixed list of six (a select; the API takes only those ids and answers anything else with one generic 400), and a typed ToolFilter, entitlement or cap entry that matches no tool is counted, not echoed: a typed credential never comes back in any response field.
- Mock-only hardening: UI sessions (`/api/mcp-session/*`) are bound to a server-minted `hm_ui` visitor cookie with per-visitor cap, per-visitor rate on `/new` and a 5000 global LRU cap; `HOSTILE_TRUST_PROXY` (default off) makes the mint throttle key on the X-Forwarded-For hop instead of the ingress; `MOCK_ONLY` on a non-loopback bind refuses to start without `HOSTILE_ALLOWED_HOSTS`; banner reads "Hosted, simulated".
