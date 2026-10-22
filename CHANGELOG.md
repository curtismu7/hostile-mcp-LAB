# Changelog

## 0.1.0

- HM0: server ported from the AI-DEMO2 source demo (wire output checked byte for byte), offline victim, pinned client, API, `GET /api/health` (`demo-health/1`).
- HM1: web UI (gallery, run, rug-pull flow, limits, ReactFlow diagram, stories S05 and S14).
- HM2: Dockerfile and docker-compose.yml (loopback-published port), `GET /api/safety-scan`, shelf registry entry (`docs/shelf-entry.json`), Learning Hub content pack (`content-pack.json`, generator and validator, schema copied from the ID-JAG kit), Playwright e2e (`npm run e2e`, not CI), docs (architecture, safety, limits, threat catalog, clients).
- Review fixes 2: sink detection strips invisible characters and folds NFKC/fullwidth hosts (flagging `invisible`), bounded sink scan (`scanTruncated`), iterative canonical hash, [U+XXXX] chips in rug-pull steps 1 and 2, pinned `node --test` glob test.

## Unreleased

- Mock-only hardening: UI sessions (`/api/mcp-session/*`) are bound to a server-minted `hm_ui` visitor cookie with per-visitor cap, per-visitor rate on `/new` and a 5000 global LRU cap; `HOSTILE_TRUST_PROXY` (default off) makes the mint throttle key on the X-Forwarded-For hop instead of the ingress; `MOCK_ONLY` on a non-loopback bind refuses to start without `HOSTILE_ALLOWED_HOSTS`; banner reads "Hosted, simulated".
