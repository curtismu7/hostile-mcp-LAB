# Honest limits

Pinning catches a tool that **changes** after approval. It does not decide whether the thing approved was good.

Catches:

- The rug-pull: a tool whose name, description or inputSchema differs from what was approved (the field diff is shown).
- Name shadowing: a tool that reuses a name already approved from another origin.
- An off-origin sink added after approval: a URL or email default pointing away from the approved origin.
- A tool that was never approved.

Does not catch:

- **A first-list poison it approved blindly.** The hash of a poisoned tool matches itself forever. A scanner or a human has to vet the list at first approval. In the UI, the default task on the run page shows exactly this: the poison lands even with the pin.
- **Result-based injection.** Only metadata is hashed; instructions inside a call result are never seen.
- **Poisoned resources and prompts.** They are not tools and are not pinned.
- **A person who approves a changed tool again.** The new definition becomes the pin.
- **Changes outside name, description and inputSchema** (annotations, titles, `_meta`).
- **A sink or instruction on the approved origin's own host.**

Per-poison answers, including what a metadata scanner would catch, are in [threat-catalog.md](threat-catalog.md).

Also not verified here: the victim is a stand-in for a trusting model, not a model. It shows what a client that obeys metadata would do. It does not measure how often a real model is fooled.

## What the gateway simulation does not do

A Ping release claim (2026-11-02), UNVERIFIED on our tenant. Generated copy: [threat-catalog.md](threat-catalog.md).

- The filter decides which tools a caller sees. It does not read them: an entitled tool under the cap is delivered exactly as the member wrote it, poisoned description included.
- Entitlements and the cap are written by a person. A tool you entitled and capped in stays listed after its description is rug-pulled; pinning is what notices the change.
- It decides which tools are listed and callable. It does not read call results, resources or prompts.
- There is no live path. Per-user upstream OAuth to members is not simulated.
