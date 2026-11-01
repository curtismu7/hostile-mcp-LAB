# Gateway: entitlement-aware discovery and the aggregate policy cap

**Ping release claim (2026-11-02), UNVERIFIED on our tenant.** The SE gateway is v1.261030 and does not have this release. This app runs offline only: there is no Mock/Live toggle and no live path. The Gateway tab is an in-process simulation. Only after the feature is measured on a tenant may the label come off.

## What it shows

The hostile server seen two ways, with the same caller and the same task:

- **No gateway:** the client connects to the bank server and the hostile server and takes everything each lists, under bare names. Two tools are called `get_balance`; the last definition wins. A server that is down is simply missing.
- **Entitlement filter plus aggregate cap:** every tool is prefixed `alias__tool`; only tools the caller is entitled to and the aggregate policy allows are listed; the same decision is asked again when a call is forwarded to a member; an unreachable member is reported, not dropped. An entitled caller still receives a poisoned description word for word: the filter does not clean content. The pinned client still notices a changed tool.

## Talk track

Story S36 ("One listing, checked twice", ID provisional) is on the Gateway tab with the Allowed/Blocked switch. The Challenge, Technical and Business lines for slides 36 and 37 are on the tab and in [gateway-why-it-matters.md](gateway-why-it-matters.md), labelled as Ping claims. Present mode keeps the banner.

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

- `server/src/gateway.js`: the pure model (about 140 lines, no imports). `createGateway({ registry, members, capAllow })` returns `list`, `call`, `hops`, `aliases`.
- `server/src/gateway-scenario.js`: request validation (`parseRequest`), the run (`runGateway`), `defaultPolicy`, the config the page loads.
- `server/src/gateway-fixtures.js`: callers, cap, simulated tools, the fixed task list.
- API: `GET /api/gateway/config`, `POST /api/gateway/run` with `{ stage, caller, task, policy }`. Unknown fields, a typed value that matches no tool, and a free-text task are refused or ignored without being echoed.

## Tests

- `server/test/gateway-checks.js`: the named checks (one or more per row of the feature test plan, each with a negative control) and the scenario checks (one per editable policy field).
- `server/test/gateway.test.js` runs them on the real source. `gateway-mutation.test.js` runs them on 32 mutated copies of the source and requires a named check to fail for each one.
- `server/test/gateway-api.test.js`: HTTP, no echo of typed values, zero outbound attempts under the network guard, hosted-mock behaviour.
- `web/src/pages/Gateway.test.jsx`: the page driven by the real engine, every editable field, Reset, Simulate.
