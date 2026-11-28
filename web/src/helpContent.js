// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: [
      "A deliberately hostile MCP server, an offline victim that needs no model, and a pinned client shown side by side with an ungoverned one. It tells story S05, \"the tool list changed overnight\": a tool you approved last week is swapped for a poisoned one.",
      "Nothing in the MCP protocol inspects tool metadata — the server serves the payloads and never scores or blocks. A defence can only sit where the metadata is consumed."
    ]
  },
  {
    heading: "What was measured, and what was not",
    body: [
      "The release claim (Ping, 2026-11-02) is UNVERIFIED on our tenant: entitlement-aware discovery and the aggregate policy cap are simulated in this process. The app runs offline only — there is no live mode and no live path until the release is on our tenant.",
      "The callers (analyst, viewer), their entitlement lists, the cap list, and the three simulated tools (get_statement, bulk_export, bank__get_balance) are fixtures made for this page; the real hostile server does not serve those three. Every tool payload is shown as inert text, and every off-box address is a reserved .invalid or example name.",
      "The pin check (fingerprint each approved tool, refuse any tool whose fingerprint later changes) is the lab's model of a defence, not a measured product reading."
    ]
  },
  {
    heading: "How to use the page",
    body: [
      "Pages (left nav): Gallery, Run the victim, Rug-pull, Gateway, Honest limits, Diagram. The header has the Mock/Real select, theme, Present, Help and Reset. Each page also has its own Show talk track / Hide talk track panel; Present (P key) opens it.",
      "Run the victim: pick a Task (What's the weather in Denver? — description injection; Check my account balance — tool shadowing; What is the stock price of ACME? — rug-pull; and more) and a When (Day one: the list as first approved / The morning after: the next list), then Run both clients.",
      "Rug-pull walks three steps: Approve list #1, Come back later, Compare; Reset the flow starts over.",
      "Gateway: edit the policy you can edit — Entitled checkboxes per tool and the cap — and watch the demo audit view's Tool / Entitled / Cap allows / Outcome table, including the pinned client's list comparison."
    ]
  },
  {
    heading: "Mock and Real",
    body: [
      "Mock is the whole demo and the only mode. Real is not available: this app has no live version — no outbound call of any kind, no tenant. The Real choice is disabled with that explanation.",
      "Hosted, simulated: sample data only, nothing leaves this server. Reset clears your MCP sessions and list counters; the fixtures never change."
    ]
  }
];
