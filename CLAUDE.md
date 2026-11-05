# CLAUDE.md: Hostile MCP LAB

Tier: Demo. A deliberately hostile MCP server (11 tools, one resource, one prompt — the wire output checked byte for byte), an offline victim that needs no model, and a pinned client shown beside an ungoverned one. Story S05, "the tool list changed overnight". Node 26, Express server (`server/`), React + Vite page (`web/`), loopback only, in-memory sessions. Repo: https://github.com/curtismu7/hostile-mcp-LAB. Read `README.md` first; the rulebook is `~/Development/STANDALONE-RULES.md` (skill `standalone-demo`).

## Run and test
- `npm ci`, `npm test` (server + web + script tests), `npm run doctor`, `npm start`. Docker: `docker compose up --build -d`, publishes `127.0.0.1` only.
- Run suites on the Air (`air-test`), not on this Mac.
- `GET /api/health` answers `demo-health/1` for the shelf. `POST /api/reset` drops this visitor's MCP sessions and list counters.

## Rules that bite
- Offline only: no outbound call of any kind. The fixtures are static data; nothing about them changes between lists except the explicit tools/list counter.
- Golden test: `server/test/golden.test.js` pins the hostile server's wire output byte for byte. Do not edit the payloads without regenerating that test deliberately.
- The gateway tab is a Ping release claim (2026-11-02), UNVERIFIED on our tenant — every statement there carries its tag (console swagger name, deck claim, lab-invented, lab reading). See `docs/gateway.md`.
- `web/src/standalone-ui.css` is the vendored shared stylesheet (AI-DEMO-Standalone canonical; hash pinned in `scripts/standalone-ui.sha256`). Do not edit it. UI patterns: `AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md`; check with that repo's `scripts/check-ui-patterns.sh`.
- Story text uses cast tokens (`{{lena}}`, `{{vocab.org}}`) filled from the vertical pack (`web/src/data/verticals/`); a customer persona overrides a cast name. No real customer names.
- Node 26 only. CI is GitHub-hosted. Docker is OrbStack, never Docker Desktop. The secrets gate runs in CI with the owner's secret.
- Never edit the shared `~/Development/AI-DEMO2` checkout; it is a read-only source.
- Commits end with the Co-Authored-By line from the session's attribution reminder.

## Shelf
`docs/shelf-entry.json` registers this app. Run the parent's `scripts/check-drift.sh <this clone>` before a PR.
