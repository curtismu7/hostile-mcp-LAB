// Where every statement on the Gateway page comes from. Four tags, no others:
//   swagger   console swagger name, 2026-10-31, schema only (the field exists in the console API schema; nothing was called)
//   deck      Ping release claim (deck slides 36 and 37), UNVERIFIED on our tenant
//   invented  lab-invented (our own shape, named so nobody mistakes it for a Privilege field)
//   reading   lab reading (how we read a sentence the swagger and the deck leave open)
// The swagger has no field for entitlement-aware discovery or for the aggregate policy cap, so neither is tagged swagger.
export const TAG_TEXT = {
  swagger: "console swagger name, 2026-10-31, schema only",
  deck: "Ping release claim (deck slides 36 and 37), UNVERIFIED on our tenant",
  invented: "lab-invented",
  reading: "lab reading",
};

export const CLAIMS = [
  { id: "members", text: "An application of type mcp-aggregate has Members; each member has AppRef, Alias and ToolFilter. (modelMcpAggregateMembers, modelMcpAggregateMember, Members on modelMcpAppConfig.) These were already in the 2026-10-26 schema: not new in this release.", tags: ["swagger"] },
  { id: "alias-naming", text: "A member's tools appear in the merged catalog as Alias__tool.", tags: ["swagger"] },
  { id: "entitlement", text: "The tool list a caller receives is filtered by that caller's entitlements. The swagger has no field for it. This page models it as an allow-list per caller (key: entitled).", tags: ["deck", "invented"] },
  { id: "cap", text: "One aggregate policy caps the member tools, enforced on the listing and again at the member hop. The swagger has no field for it. This page models it as an allow-list (key: capAllow); the real field name is unknown.", tags: ["deck", "invented"] },
  { id: "unreachable", text: "A member that cannot be reached is reported, not dropped from the answer.", tags: ["deck", "reading"] },
  { id: "toolfilter", text: "ToolFilter limits a member to the tools it names; empty means no limit. The schema gives only the type (a list of strings).", tags: ["reading"] },
  { id: "registry", text: "An aggregate member must be an application the tenant already knows; an unknown AppRef is refused.", tags: ["reading"] },
  { id: "alias-rule", text: "An alias has no underscore, so the first double underscore in a name always ends the alias. A tool a member calls bank__get_balance is listed as hostile__bank__get_balance.", tags: ["invented"] },
  { id: "callers", text: "The callers (analyst, viewer), their entitlement lists, the cap list, and the three simulated tools (get_statement, bulk_export, bank__get_balance) are fixtures made for this page. The real hostile server does not serve those three.", tags: ["invented"] },
  { id: "identity", text: "Federated Identity is the display name for what the API still calls NonHumanIdentity. This page shows no identity objects; callers are plain labels.", tags: ["swagger"] },
  { id: "no-live", text: "The SE gateway is v1.261030 and does not have this release, so there is no live path. This page is an in-process simulation only. Per-user upstream OAuth to members is not simulated.", tags: ["reading"] },
];
