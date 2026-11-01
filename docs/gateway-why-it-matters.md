# Why it matters: MCP Gateway and MCP Aggregate

These lines are Ping claims, paraphrased from deck slides 36 and 37 of the H2 2026 Agent Privilege deck. They are UNVERIFIED on our tenant (the SE gateway is v1.261030 and does not have this release) and they are not our measurement. Put the Challenge line first when presenting.

## MCP Gateway (slide 36)

- Challenge: One shared token and every tool exposed to every caller: no attribution, no per-tool control, so security stalls adoption.
- Technical: Per-user identity, per-tool policy and injected credentials on every call, fully audited.
- Business: MCP integrations proceed under existing governance; faster time to value on agent projects.

## MCP Aggregate (slide 37)

- Challenge: Each agent-server pair needs its own connection, config and credential, so effort and attack surface grow with each pair.
- Technical: One connection, one policy cap enforced twice, one audit trail across members.
- Business: New servers join by configuration, not project work: lower per-integration cost, faster rollout.

## What this demo adds

Against a hostile MCP server, the Gateway tab shows the listing with no gateway and through an entitlement filter plus an aggregate cap, both simulated in process. Entitlement filtering and the cap have no field in the console swagger (2026-10-31): they are tagged deck claim and lab-invented. A gateway decides who sees a tool; it does not read or clean it, so an entitled caller still receives a poisoned description and the pinned client is still what notices a change.
