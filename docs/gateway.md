# Gateway: entitlement-aware discovery and the aggregate policy cap

**Ping release claim (2026-11-02), UNVERIFIED on our tenant.** The SE gateway is v1.261030 and does not have this release. This app runs offline only: there is no Mock/Live toggle and no live path. The Gateway tab is an in-process simulation. Only after the feature is measured on a tenant may the label come off.

## What it shows

The hostile server seen two ways, with the same caller and the same task:

- **No gateway:** the client connects to the bank server and the hostile server and takes everything each lists, under bare names. Two tools are called `get_balance`; the last definition wins. A server that is down is simply missing.
- **Entitlement filter plus aggregate cap:** every tool is prefixed `alias__tool`; only tools the caller is entitled to and the aggregate policy allows are listed; the same decision is asked again when a call is forwarded to a member; an unreachable member is reported, not dropped. An entitled caller still receives a poisoned description word for word: the filter does not clean content. The pinned client still notices a changed tool.

## Talk track

Story S36 ("One listing, checked twice", ID provisional) is on the Gateway tab with the Allowed/Blocked switch. The Challenge, Technical and Business lines for slides 36 and 37 are on the tab and in [gateway-why-it-matters.md](gateway-why-it-matters.md), labelled as Ping claims. Present mode keeps the banner.

## Demo audit pane

A real gateway would show an administrator which tools it hid and why. The Gateway tab shows that too, so the demo can explain itself, but it is labelled **Demo audit pane** and kept apart from what the caller gets. The hidden count, the per-server offered counts, the reason for each refused probe call and the Outcome column of the policy table are the audit view. The caller sees the listed tools, whether each server is reachable, and, for a refused call, only `not available`: the same answer for a tool that is hidden by entitlement, hidden by the cap, outside the ToolFilter or does not exist, so a call cannot be used to enumerate what the caller was not shown. That uniform answer is a lab reading; the release claim does not say what a refused call returns. A call to an unreachable server gets `member unreachable`, because the listing already reports it.

## Where every statement comes from

| Statement | Tag |
| --- | --- |
| `Members`, and per member `AppRef`, `Alias`, `ToolFilter` (`modelMcpAggregateMembers`, `modelMcpAggregateMember`, `Members` on `modelMcpAppConfig`); `AppType` `mcp-aggregate`; names `Alias__tool`. Already in the 2026-10-26 schema, not new. | console swagger name, 2026-10-31, schema only |
| The listing is filtered by the caller's entitlements | Ping release claim (deck slides 36 and 37), UNVERIFIED; no swagger field; modelled as the lab-invented allow-list `entitled` |
| One policy cap, enforced on the listing and again at the member hop | Ping release claim, UNVERIFIED; no swagger field; modelled as the lab-invented allow-list `capAllow`. The real field name is unknown and none is invented |
| Unreachable member reported, not dropped | deck claim, lab reading |
| ToolFilter is an allow-list, empty means no limit | lab reading (the schema gives only the type) |
| A member must be a registered application; an unknown `AppRef` is refused | lab reading |
| An alias has no underscore, so the first `__` ends it | lab-invented |
| Callers `analyst` and `viewer`, their lists, the cap list, the tools `get_statement`, `bulk_export` and `bank__get_balance` | lab-invented fixtures (the real hostile server does not serve those three) |
| Per-user upstream OAuth to members | not simulated |

Identity wording: Federated Identity is a display name. The API object is still `NonHumanIdentity`. This tab shows no identity objects.

## Code

- `server/src/gateway.js`: the pure model (about 140 lines, no imports). `createGateway({ registry, members, capAllow })` returns `list`, `call`, `hops`, `audit`, `aliases`.
- `server/src/gateway-scenario.js`: request validation (`parseRequest`), the run (`runGateway`), `defaultPolicy`, the config the page loads.
- `server/src/gateway-fixtures.js`: callers, cap, simulated tools, the fixed task list.
- API: `GET /api/gateway/config`, `POST /api/gateway/run` with `{ stage, caller, task, policy }`. Unknown fields, a typed value that matches no tool (in the entitlement list, the cap list or a ToolFilter), and a free-text task are refused or ignored without being echoed; ignored entries are counted. An alias is the one typed value that comes back, because it is a public label in every tool name (the swagger `Alias` field): it is limited to 24 characters of a-z, 0-9 and dash, and the page says never to type a secret into it.

## Tests

- `server/test/gateway-checks.js`: the named checks (one or more per row of the feature test plan, each with a negative control) and the scenario checks (one per editable policy field).
- `server/test/gateway.test.js` runs them on the real source. `gateway-mutation.test.js` runs them on 46 mutated copies of the source, one per member for each per-member field and requires a named check to fail for each one.
- `server/test/gateway-api.test.js`: HTTP, no echo of typed values, zero outbound attempts under the network guard, hosted-mock behaviour.
- `web/src/pages/Gateway.test.jsx`: the page driven by the real engine, every editable field (including each Cap allows checkbox), the demo audit pane, Reset, Simulate.
- `web/src/pages/GatewayDiagram.test.jsx`: a drag is kept per view and Reset restores the boxes (ReactFlow is replaced by a stand-in, because jsdom cannot drag).
- `scripts/web-mutation.mjs`: 19 mutants of the page and the diagram, each of which must fail a page test. `scripts/e2e.mjs` drags a real box and presses Reset in Chromium.
