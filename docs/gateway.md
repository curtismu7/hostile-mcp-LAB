# Gateway: entitlement-aware discovery and the aggregate policy cap

**Ping release claim (2026-11-02), partially verified on our tenant (measured 2026-11-05, gateway v1.261102).** The gateway build now carries the release: the OBO exchange leg is measured working on our tenant (gateway log: `[mcpgw] obo exchange ok … (expires in 3600s)` on a test app with `AuthMode: obo`; see `AI-DEMO2-internal/privilege/OBO-REDEEM-VERIFICATION-2026-11-05.md`), and the `ToolFilter` field from the claim is present in the current console swagger (`modelMcpAggregateMember.ToolFilter`) with a live aggregate app (`aggregate-limited`) configured with per-member filters. Still UNVERIFIED at runtime: the per-call member-hop check, the aggregate policy cap (no swagger field has appeared), and the redeemed ID-JAG leg. This app runs offline only: there is no Mock/Live toggle and no live path; the Gateway tab is an in-process simulation.

## What it shows

The hostile server seen two ways, with the same caller and the same task:

- **No gateway:** the client connects to the bank server and the hostile server and takes everything each lists, under bare names. Two tools are called `get_balance`; the last definition wins. A server that is down is simply missing.
- **Entitlement filter plus aggregate cap:** every tool is prefixed `alias__tool`; only tools the caller is entitled to and the aggregate policy allows are listed; the same decision is asked again when a call is forwarded to a member; an unreachable member is reported, not dropped. An entitled caller still receives a poisoned description word for word: the filter does not clean content. The pinned client still notices a changed tool.

## Talk track

Story S36 ("One listing, checked twice", ID provisional) is on the Gateway tab with the Allowed/Blocked switch. The Challenge, Technical and Business lines for slides 36 and 37 are on the tab and in [gateway-why-it-matters.md](gateway-why-it-matters.md), labelled as Ping claims. Present mode keeps the banner.

## Demo audit pane

A real gateway would show an administrator which tools it hid and why. The Gateway tab shows that too, so the demo can explain itself, but it is labelled **Demo audit pane** and kept apart from what the caller gets. The hidden count and names, the per-server offered counts, the reason for each refused probe call, the member-hop count and the Outcome column of the policy table are the audit view. In the API they sit under `gateway.audit`, apart from the caller's fields (`gateway.tools`, `members` with only `alias` and `status`, `unreachable`, `attempts` with only `code` and `stage`, `pin`, `victim`); on the page the audit pane is its own section, not part of the caller's card. The caller sees the listed tools, whether each server is reachable, and, for a refused call, only `not available`: the same answer for a tool that is hidden by entitlement, hidden by the cap, outside the ToolFilter or does not exist, so a call cannot be used to enumerate what the caller was not shown. That uniform answer is a lab reading; the release claim does not say what a refused call returns. A call to an unreachable server gets `member unreachable`, because the listing already reports it.

## Where every statement comes from

| Statement | Tag |
| --- | --- |
| `Members`, and per member `AppRef`, `Alias`, `ToolFilter` (`modelMcpAggregateMembers`, `modelMcpAggregateMember`, `Members` on `modelMcpAppConfig`); `AppType` `mcp-aggregate`; names `Alias__tool`. Already in the 2026-10-26 schema, not new. | console swagger name, 2026-10-31, schema only |
| The listing is filtered by the caller's entitlements | Ping release claim (deck slides 36 and 37); the `ToolFilter` field now exists in the swagger (`modelMcpAggregateMember.ToolFilter`, measured 2026-11-05) and a live aggregate app carries per-member filters; runtime filtering of a caller's listing still UNVERIFIED (blocked by the AI-policy layer); the lab models the caller-entitlement aspect as the lab-invented allow-list `entitled` |
| One policy cap, enforced on the listing and again at the member hop | Ping release claim, UNVERIFIED; no swagger field; modelled as the lab-invented allow-list `capAllow`. The real field name is unknown and none is invented |
| Unreachable member reported, not dropped | deck claim, lab reading |
| ToolFilter is an allow-list, empty means no limit | lab reading (the schema gives only the type) |
| A member must be a registered application; an unknown `AppRef` is refused | lab reading |
| An alias has no underscore, so the first `__` ends it | lab-invented |
| The aliases the page offers (`hostile`, `bank`, `vendor`, `ledger`, `files`, `mail`) | lab-invented; the Alias field is a swagger name, the list of choices is ours |
| Callers `analyst` and `viewer`, their lists, the cap list, the tools `get_statement`, `bulk_export` and `bank__get_balance` | lab-invented fixtures (the real hostile server does not serve those three) |
| Per-user upstream OAuth to members | not simulated |

Identity wording: Federated Identity is a display name. The API object is still `NonHumanIdentity`. This tab shows no identity objects.

## Code

- `server/src/gateway.js`: the pure model (about 140 lines, no imports). `createGateway({ registry, members, capAllow })` returns `list`, `call`, `hops`, `audit`, `aliases`.
- `server/src/gateway-scenario.js`: request validation (`parseRequest`), the run (`runGateway`), `defaultPolicy`, the config the page loads.
- `server/src/gateway-fixtures.js`: callers, cap, simulated tools, the fixed task list and the fixed alias list (`ALIAS_PRESETS`).
- API: `GET /api/gateway/config`, `POST /api/gateway/run` with `{ stage, caller, task, policy }`. Unknown fields, a typed value that matches no tool (in the entitlement list, the cap list or a ToolFilter), and a free-text task are refused or ignored without being echoed; ignored entries are counted. An alias is never typed: the API takes one of the fixed ids in `ALIAS_PRESETS` (`GET /api/gateway/config` lists them as `aliasPresets`) and anything else gets one generic 400 that does not repeat the input. The page offers the ids in a select, and the choice the other server holds is disabled, so no invalid alias state is ever posted. The rule: a typed credential is never echoed in any response field; a ToolFilter, entitlement or cap entry that matches no tool is counted, never shown. The response has two parts: `gateway` outside `gateway.audit` is what the caller sees, and `gateway.audit` is the demo audit view (hidden names and counts, offered counts, a reason per refused probe call, member hops). The top-level `policy` is only the count `ignoredEntries`: the entitlement and cap lists are not echoed, because a name the cap hides is a name the caller was not shown. A ToolFilter is held to the same rule: `members[]` carries `key`, `appRef`, `alias` and `reachable` and no `toolFilter`, matching names included (the page never read it; the effect of a filter is in the listing and, for the names it hid, in `gateway.audit.hidden` as `not-in-toolfilter`). The page splits the ToolFilter text on commas; the API takes a list of names and refuses a comma separated string without repeating it.

## Tests

- `server/test/gateway-checks.js`: the named checks (one or more per row of the feature test plan, each with a negative control) and the scenario checks (one per editable policy field).
- `server/test/gateway.test.js` runs them on the real source. `gateway-mutation.test.js` runs them on 63 mutated copies of the source, one per member for each per-member field and requires a named check to fail for each one.
- `server/test/gateway-api.test.js`: HTTP, no echo of typed values, zero outbound attempts under the network guard, hosted-mock behaviour.
- `web/src/pages/Gateway.test.jsx`: the page driven by the real engine, every editable field (including each Cap allows checkbox), the demo audit pane, Reset, Simulate.
- `web/src/pages/GatewayDiagram.test.jsx`: a drag is kept per view and Reset restores the boxes (ReactFlow is replaced by a stand-in, because jsdom cannot drag).
- `scripts/web-mutation.mjs`: 59 mutants of the page and the diagram, including one per server for each editable field (Alias, ToolFilter, Reachable, and the Entitled and Cap allows rows) in the handler and in the request, one per field (and per server) that Reset might leave edited, four for how the ToolFilter text is split, and one for the diagram panning while a box is dragged, each of which must fail a page test. `scripts/e2e.mjs` drags a real box and presses Reset in Chromium, and at 375px drags a box and checks the view did not pan and no further label left the canvas.
